import { createHash } from 'node:crypto'

const READ_METHODS = Object.freeze([
  'get',
  'list',
  'findActive',
  'resolveActiveVersion',
])

const WRITE_METHODS = Object.freeze([
  'create',
  'update',
  'activateVersionAtomically',
])

const SHADOW_REPORT_SCHEMA_VERSION = '1.0.0'

/**
 * Keeps the legacy repository as the only application source of truth while
 * comparing read results with a migrated repository. The shadow repository is
 * deliberately never used for writes or publication decisions.
 */
export class ShadowDatasetVersionRepository {
  constructor({
    primaryRepository,
    shadowRepository,
    reporter = null,
    clock = () => new Date(),
    awaitComparison = true,
    comparisonTimeoutMilliseconds = 5_000,
    maxRetainedReports = 100,
  } = {}) {
    assertRepository(primaryRepository, 'primaryRepository')
    assertRepository(shadowRepository, 'shadowRepository')
    if (reporter !== null && typeof reporter !== 'function') {
      throw new TypeError('Shadow reporter harus berupa function atau null.')
    }
    this.primaryRepository = primaryRepository
    this.shadowRepository = shadowRepository
    this.reporter = reporter
    this.clock = clock
    this.awaitComparison = awaitComparison !== false
    this.comparisonTimeoutMilliseconds = normalizeTimeout(
      comparisonTimeoutMilliseconds,
    )
    this.maxRetainedReports = Math.max(1, Number(maxRetainedReports) || 1)
    this.reports = []
  }

  async get(datasetVersionId) {
    const primary = await this.#readPrimary('get', [datasetVersionId])
    await this.#handleComparison(
      this.#compareRecord('get', datasetVersionId, primary, {
        shadowMethod: 'get',
        shadowArgs: [datasetVersionId],
      }),
    )
    return primary
  }

  async list() {
    const primary = await this.#readPrimary('list', [])
    await this.#handleComparison(this.#compareList(primary))
    return primary
  }

  async findActive(datasetId, options) {
    const args = [datasetId, options]
    const primary = await this.#readPrimary('findActive', args)
    await this.#handleComparison(
      this.#compareRecord('findActive', primary?.datasetVersion?.id ?? datasetId, primary, {
        shadowMethod: 'findActive',
        shadowArgs: args,
        primaryAvailable: true,
      }),
    )
    return primary
  }

  async resolveActiveVersion(options) {
    const args = [options]
    const primary = await this.#readPrimary('resolveActiveVersion', args)
    await this.#handleComparison(this.#compareResolvedActive(primary, args))
    return primary
  }

  async compareDatasetVersion(datasetVersionId, { primaryRecord } = {}) {
    const primary = primaryRecord === undefined
      ? await this.#readPrimary('get', [datasetVersionId])
      : primaryRecord
    const report = await this.#compareRecord(
      'get',
      datasetVersionId,
      primary,
      {
        shadowMethod: 'get',
        shadowArgs: [datasetVersionId],
      },
    )
    await this.#storeReport(report)
    return structuredClone(report)
  }

  getLastComparison(datasetVersionId = null) {
    const reports = datasetVersionId === null
      ? this.reports
      : this.reports.filter((report) => (
        report.datasetVersionId === datasetVersionId
      ))
    const report = reports.at(-1)
    return report ? structuredClone(report) : null
  }

  listComparisons() {
    return structuredClone(this.reports)
  }

  clearComparisons() {
    this.reports = []
  }

  async #readPrimary(method, args) {
    return this.primaryRepository[method](...args)
  }

  async #handleComparison(reportPromise) {
    const store = reportPromise.then((report) => this.#storeReport(report))
    if (this.awaitComparison) {
      await store
      return
    }
    void store.catch(() => {})
  }

  async #compareRecord(
    operation,
    datasetVersionId,
    primary,
    {
      shadowMethod,
      shadowArgs,
      primaryAvailable = true,
    } = {},
  ) {
    const shadowOutcome = await this.#safeShadowRead(shadowMethod, shadowArgs)
    const primaryOutcome = {
      ok: primaryAvailable,
      value: primary,
    }
    return this.#buildReport({
      operation,
      datasetVersionId,
      primaryOutcome,
      shadowOutcome,
      comparison: primaryOutcome.ok && shadowOutcome.ok
        ? compareDatasetRecords(primary, shadowOutcome.value)
        : null,
    })
  }

  async #compareList(primary) {
    const shadowOutcome = await this.#safeShadowRead('list', [])
    if (!shadowOutcome.ok) {
      return this.#buildReport({
        operation: 'list',
        datasetVersionId: null,
        primaryOutcome: { ok: true, value: primary },
        shadowOutcome,
        comparison: null,
      })
    }

    const primaryIndex = indexRecords(primary)
    const shadowIndex = indexRecords(shadowOutcome.value)
    const primaryById = primaryIndex.records
    const shadowById = shadowIndex.records
    const recordReports = []
    const mismatches = []
    for (const datasetVersionId of primaryIndex.duplicateIds) {
      mismatches.push({ code: 'duplicate_primary_record_id', datasetVersionId })
    }
    for (const datasetVersionId of shadowIndex.duplicateIds) {
      mismatches.push({ code: 'duplicate_shadow_record_id', datasetVersionId })
    }
    for (const datasetVersionId of [
      ...new Set([...primaryById.keys(), ...shadowById.keys()]),
    ].sort()) {
      const primaryRecord = primaryById.get(datasetVersionId)
      const shadowRecord = shadowById.get(datasetVersionId)
      if (!primaryRecord || !shadowRecord) {
        mismatches.push({
          code: primaryRecord
            ? 'record_missing_in_shadow'
            : 'record_extra_in_shadow',
          datasetVersionId,
        })
        continue
      }
      const comparison = compareDatasetRecords(primaryRecord, shadowRecord)
      recordReports.push({
        datasetVersionId,
        equal: comparison.equal,
        mismatchCount: comparison.mismatches.length,
        primaryFingerprint: comparison.primaryFingerprint,
        shadowFingerprint: comparison.shadowFingerprint,
      })
      if (!comparison.equal) {
        mismatches.push(...comparison.mismatches.map((mismatch) => ({
          ...mismatch,
          datasetVersionId,
        })))
      }
    }
    return this.#buildReport({
      operation: 'list',
      datasetVersionId: null,
      primaryOutcome: { ok: true, value: primary },
      shadowOutcome,
      comparison: {
        equal: mismatches.length === 0,
        primaryFingerprint: fingerprint(primary),
        shadowFingerprint: fingerprint(shadowOutcome.value),
        mismatches,
        recordReports,
      },
    })
  }

  async #compareResolvedActive(primary, args) {
    const shadowOutcome = await this.#safeShadowRead(
      'resolveActiveVersion',
      args,
    )
    const primaryOutcome = {
      ok: true,
      value: primary,
    }
    const comparison = primaryOutcome.ok && shadowOutcome.ok
      ? compareResolvedActive(primary, shadowOutcome.value)
      : null
    return this.#buildReport({
      operation: 'resolveActiveVersion',
      datasetVersionId: primary?.record?.datasetVersion?.id
        ?? shadowOutcome.value?.record?.datasetVersion?.id
        ?? null,
      primaryOutcome,
      shadowOutcome,
      comparison,
    })
  }

  async #safeShadowRead(method, args) {
    try {
      const value = await withTimeout(
        this.shadowRepository[method](...args),
        this.comparisonTimeoutMilliseconds,
      )
      return { ok: true, value }
    } catch (error) {
      return {
        ok: false,
        errorCode: String(error?.code ?? error?.name ?? 'shadow_read_failed'),
      }
    }
  }

  #buildReport({
    operation,
    datasetVersionId,
    primaryOutcome,
    shadowOutcome,
    comparison,
  }) {
    const primaryAvailable = primaryOutcome.ok
    const shadowAvailable = shadowOutcome.ok
    const mismatches = comparison?.mismatches
      ?? (!shadowAvailable
        ? [{
          code: 'shadow_read_failed',
          errorCode: shadowOutcome.errorCode ?? 'shadow_record_not_found',
        }]
        : !primaryAvailable
          ? [{ code: 'primary_record_not_found' }]
          : [])
    return {
      schemaVersion: SHADOW_REPORT_SCHEMA_VERSION,
      mode: 'shadow_read_compare',
      operation,
      datasetVersionId,
      comparedAt: this.clock().toISOString(),
      sourceOfTruth: 'primary',
      publication: {
        attempted: false,
        published: false,
        shadowWrites: 0,
      },
      primary: {
        available: primaryAvailable,
        ...(primaryOutcome.errorCode ? { errorCode: primaryOutcome.errorCode } : {}),
      },
      shadow: {
        available: shadowAvailable,
        ...(shadowOutcome.errorCode ? { errorCode: shadowOutcome.errorCode } : {}),
      },
      equal: Boolean(
        primaryAvailable && shadowAvailable && comparison?.equal === true,
      ),
      ...(comparison?.primaryFingerprint
        ? { primaryFingerprint: comparison.primaryFingerprint }
        : {}),
      ...(comparison?.shadowFingerprint
        ? { shadowFingerprint: comparison.shadowFingerprint }
        : {}),
      ...(comparison?.recordReports ? { recordReports: comparison.recordReports } : {}),
      mismatches: mismatches.slice(0, 100),
    }
  }

  async #storeReport(report) {
    this.reports.push(structuredClone(report))
    if (this.reports.length > this.maxRetainedReports) {
      this.reports.splice(0, this.reports.length - this.maxRetainedReports)
    }
    if (this.reporter) {
      await Promise.resolve(this.reporter(structuredClone(report))).catch(() => {})
    }
  }
}

export function compareDatasetRecords(primary, shadow) {
  const primarySections = recordSections(primary)
  const shadowSections = recordSections(shadow)
  const sections = [...new Set([
    ...Object.keys(primarySections),
    ...Object.keys(shadowSections),
  ])].sort()
  const mismatches = sections.flatMap((section) => {
    const primarySection = primarySections[section]
    const shadowSection = shadowSections[section]
    const primaryFingerprint = fingerprint(primarySection)
    const shadowFingerprint = fingerprint(shadowSection)
    return primaryFingerprint === shadowFingerprint
      ? []
      : [{
        code: 'section_mismatch',
        section,
        primaryCount: sectionCount(primarySection),
        shadowCount: sectionCount(shadowSection),
        primaryFingerprint,
        shadowFingerprint,
      }]
  })
  return {
    equal: mismatches.length === 0,
    primaryFingerprint: fingerprint(primarySections),
    shadowFingerprint: fingerprint(shadowSections),
    mismatches,
  }
}

function compareResolvedActive(primary, shadow) {
  const primarySections = {
    pointer: normalizeValue(primary?.pointer),
    record: recordSections(primary?.record),
  }
  const shadowSections = {
    pointer: normalizeValue(shadow?.pointer),
    record: recordSections(shadow?.record),
  }
  const mismatches = Object.keys(primarySections).flatMap((section) => {
    const primaryFingerprint = fingerprint(primarySections[section])
    const shadowFingerprint = fingerprint(shadowSections[section])
    return primaryFingerprint === shadowFingerprint
      ? []
      : [{
        code: 'section_mismatch',
        section,
        primaryCount: sectionCount(primarySections[section]),
        shadowCount: sectionCount(shadowSections[section]),
        primaryFingerprint,
        shadowFingerprint,
      }]
  })
  return {
    equal: mismatches.length === 0,
    primaryFingerprint: fingerprint(primarySections),
    shadowFingerprint: fingerprint(shadowSections),
    mismatches,
  }
}

function recordSections(record) {
  if (!record || typeof record !== 'object') return {}
  return Object.fromEntries(Object.keys(record).sort().map((key) => [
    key,
    normalizeSection(key, record[key]),
  ]))
}

function normalizeSection(key, value) {
  if (key === 'topologyGraph') return normalizeGraph(value)
  if (key === 'degreeByNode') return normalizeValue(value)
  if (!Array.isArray(value)) return normalizeValue(value)
  return normalizeCollection(value, collectionIdentityFor(key))
}

function normalizeGraph(graph) {
  if (!graph || typeof graph !== 'object') return null
  return {
    ...normalizeValue(graph),
    nodes: normalizeCollection(graph.nodes, entityIdentity),
    edges: normalizeCollection(graph.edges, entityIdentity),
    components: normalizeCollection(graph.components, entityIdentity),
    isolatedNodeIds: [...new Set(graph.isolatedNodeIds ?? [])].sort(),
  }
}

function normalizeCollection(value, identity) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeValue(item))
    .sort((left, right) => {
      const leftId = identity(left)
      const rightId = identity(right)
      return leftId.localeCompare(rightId)
        || stableStringify(left).localeCompare(stableStringify(right))
    })
}

function collectionIdentityFor(key) {
  if (key === 'sourceFeatures') return entityIdentityBy('sourceFeatureId')
  if (key === 'sourceGeometries') return entityIdentityBy('geometryId', 'sourceGeometryId')
  if (key === 'classifiedObjects') return entityIdentityBy('classifiedObjectId')
  if (key === 'topologyCandidates') return entityIdentityBy('candidateId')
  if (key === 'confirmedRelations') return entityIdentityBy('relationId', 'id')
  if (key === 'relations') return entityIdentityBy('relationId', 'id')
  if (key === 'topologyUnresolved') return entityIdentity
  if (key === 'topologyEligibilityIssues') return entityIdentity
  if (key === 'topologyLineworkIssues') return entityIdentity
  if (key === 'topologyCandidateHistory') return entityIdentity
  if (key === 'topologyRuns') return entityIdentity
  if (key === 'auditEvents') return entityIdentityBy('id')
  if (key === 'accuracyEvaluations') return entityIdentityBy('evaluationId', 'id')
  return entityIdentity
}

function entityIdentityBy(...keys) {
  return (value) => {
    for (const key of keys) {
      if (value?.[key] !== undefined && value?.[key] !== null) {
        return String(value[key])
      }
    }
    return entityIdentity(value)
  }
}

function entityIdentity(value) {
  if (value === null || typeof value !== 'object') return String(value)
  return String(
    value.id
      ?? value.nodeId
      ?? value.edgeId
      ?? value.componentId
      ?? value.assetId
      ?? stableStringify(value),
  )
}

function indexRecords(records) {
  const indexed = new Map()
  const duplicateIds = []
  for (const record of Array.isArray(records) ? records : []) {
    const datasetVersionId = String(record?.datasetVersion?.id ?? record?.id ?? '')
    if (!datasetVersionId) continue
    if (indexed.has(datasetVersionId)) duplicateIds.push(datasetVersionId)
    indexed.set(datasetVersionId, record)
  }
  return { records: indexed, duplicateIds: [...new Set(duplicateIds)].sort() }
}

function sectionCount(value) {
  if (Array.isArray(value)) return value.length
  if (value && typeof value === 'object') return Object.keys(value).length
  return value === null || value === undefined ? 0 : 1
}

function fingerprint(value) {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`
}

function stableStringify(value) {
  return JSON.stringify(normalizeValue(value))
}

function normalizeValue(value) {
  if (value === undefined) return null
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(normalizeValue)
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key,
    normalizeValue(value[key]),
  ]))
}

function assertRepository(repository, name) {
  if (!repository || typeof repository !== 'object') {
    throw new TypeError(`${name} harus berupa repository object.`)
  }
  for (const method of READ_METHODS) {
    if (typeof repository[method] !== 'function') {
      throw new TypeError(`${name}.${method}() wajib tersedia.`)
    }
  }
}

function normalizeTimeout(value) {
  if (value === null || value === false) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5_000
}

function withTimeout(promise, milliseconds) {
  if (milliseconds === null) return promise
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('Shadow read timeout.'), {
        code: 'shadow_read_timeout',
      }))
    }, milliseconds)
    timer.unref?.()
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      clearTimeout(timer)
    })
  })
}

for (const method of WRITE_METHODS) {
  Object.defineProperty(ShadowDatasetVersionRepository.prototype, method, {
    value: function delegatedWrite(...args) {
      return this.primaryRepository[method](...args)
    },
  })
}
