import { randomUUID } from 'node:crypto'
import { AppError } from '../errors.js'

const PROJECTION_DELETE_ORDER = [
  'graph_edges',
  'graph_nodes',
  'graph_revisions',
  'confirmed_relations',
  'topology_candidates',
  'classified_objects',
  'source_geometries',
  'source_features',
]

const DATASET_VERSION_SELECT = `
  SELECT payload
  FROM dataset_versions
  WHERE id = $1
`

/**
 * PostgreSQL adapter for the current aggregate contract.
 *
 * The JSONB payload is the PostgreSQL aggregate representation used by the
 * application runtime. Indexed tables are written in the same transaction as
 * that payload; JSON files are not part of the PostgreSQL-primary path.
 */
export class PostgresDatasetVersionRepository {
  constructor(pool, {
    activationHooks = {},
    clock = () => new Date(),
  } = {}) {
    if (typeof pool?.query !== 'function' || typeof pool?.connect !== 'function') {
      throw new TypeError('PostgreSQL pool harus menyediakan query() dan connect().')
    }
    this.pool = pool
    this.activationHooks = activationHooks
    this.clock = clock
  }

  /**
   * Runs application-level mutations on one PostgreSQL client.
   *
   * The scoped repository deliberately exposes only the operations needed by
   * the aggregate mutation seam. Callers can use the returned client with
   * other PostgreSQL-backed collaborators, such as the audit log, and all
   * writes will commit or roll back together.
   */
  async withTransaction(operation) {
    if (typeof operation !== 'function') {
      throw new TypeError('Callback transaksi PostgreSQL wajib berupa fungsi.')
    }
    return this.#withTransaction(async (client) => operation({
      client,
      repository: {
        get: (id) => this.#getWithExecutor(client, id, { forUpdate: true }),
        list: () => this.#listWithExecutor(client),
        update: (id, updater, options) => this.#updateWithExecutor(
          client,
          id,
          updater,
          options,
        ),
      },
    }))
  }

  async create(record, { verify = null } = {}) {
    const normalized = assertRecord(record)
    return this.#withTransaction(async (client) => {
      try {
        await insertDatasetVersion(client, normalized, this.clock)
        await replaceProjections(client, normalized)
      } catch (error) {
        throw mapDatabaseError(error)
      }
      await verify?.({
        client,
        datasetVersionId: normalized.datasetVersion.id,
      })
      return structuredClone(normalized)
    })
  }

  async get(id) {
    return this.#getWithExecutor(this.pool, id)
  }

  async list() {
    return this.#listWithExecutor(this.pool)
  }

  async update(id, updater, { expectedRevision, projectionMode = 'full' } = {}) {
    assertSafeId(id)
    return this.#withTransaction((client) => this.#updateWithExecutor(
      client,
      id,
      updater,
      { expectedRevision, projectionMode },
    ))
  }

  async findActive(datasetId, { excludeId } = {}) {
    const resolved = await this.resolveActiveVersion({ datasetId })
    if (resolved && resolved.record.datasetVersion.id !== excludeId) {
      return resolved.record
    }
    return null
  }

  async resolveActiveVersion({
    datasetId,
    branchId,
  } = {}) {
    assertDatasetContext(datasetId)
    const pointerResult = await this.pool.query(
      `SELECT dataset_id, branch_id, dataset_version_id,
          previous_dataset_version_id, revision, activated_by, activated_at,
          migrated_from_legacy_status
       FROM dataset_active_pointers
       WHERE dataset_id = $1
         AND ($2::text IS NULL OR branch_id = $2)
       ORDER BY branch_id ASC`,
      [datasetId, branchId ?? null],
    )
    if ((pointerResult.rows ?? []).length > 1 && !branchId) {
      throw activeVersionIntegrityError()
    }
    const pointerRow = pointerResult.rows?.[0]
    if (pointerRow) {
      const record = await this.get(pointerRow.dataset_version_id)
      const pointer = pointerFromRow(pointerRow)
      assertPointerIntegrity(pointer, record, { datasetId, branchId })
      return { pointer, record }
    }

    const legacyResult = await this.pool.query(
      `SELECT payload
       FROM dataset_versions
       WHERE dataset_id = $1
         AND ($2::text IS NULL OR branch_id = $2)
         AND status = 'active'
       ORDER BY id ASC`,
      [datasetId, branchId ?? null],
    )
    const legacyActive = (legacyResult.rows ?? []).map(payloadFromRow)
    if (legacyActive.length > 1) throw activeVersionIntegrityError()
    if (!legacyActive.length) return null
    const record = legacyActive[0]
    return {
      pointer: {
        schemaVersion: '1.0.0',
        datasetId,
        branchId: record.datasetVersion.branchId,
        datasetVersionId: record.datasetVersion.id,
        previousVersionId: null,
        activatedBy: record.datasetVersion.activatedBy ?? null,
        activatedAt: record.datasetVersion.activatedAt ?? null,
        revision: 'legacy',
      },
      record,
    }
  }

  async activateVersionAtomically({
    datasetVersionId,
    actorId,
    activatedAt,
    expectedActiveVersionId,
    validateTarget,
  }) {
    assertSafeId(datasetVersionId)
    const activationContext = {
      datasetId: null,
      branchId: null,
      previousVersionId: null,
      newVersionId: datasetVersionId,
    }
    try {
      return await this.#withTransaction(async (client) => {
        const targetResult = await client.query(
          DATASET_VERSION_SELECT,
          [datasetVersionId],
        )
        if (!targetResult.rows?.length) throw datasetVersionNotFound()
        const target = payloadFromRow(targetResult.rows[0])
        const { datasetId, branchId } = target.datasetVersion
        assertDatasetContext(datasetId)
        if (!branchId) {
          throw new AppError('Branch dataset version tidak tersedia.', {
            code: 'invalid_branch_id',
            statusCode: 400,
          })
        }
        activationContext.datasetId = datasetId
        activationContext.branchId = branchId

        // A transaction advisory lock also serializes the first activation,
        // where no pointer row exists yet to lock with SELECT ... FOR UPDATE.
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [`${datasetId}\u0000${branchId}`],
        )
        const datasetRowsResult = await client.query(
          `SELECT payload
           FROM dataset_versions
           WHERE dataset_id = $1 AND branch_id = $2
           ORDER BY id ASC
           FOR UPDATE`,
          [datasetId, branchId],
        )
        const datasetRecords = (datasetRowsResult.rows ?? []).map(payloadFromRow)
        const lockedTarget = datasetRecords.find((record) => (
          record.datasetVersion.id === datasetVersionId
        ))
        if (!lockedTarget) throw datasetVersionNotFound()
        if (lockedTarget.datasetVersion.status === 'active') {
          throw new AppError('Dataset version ini sudah aktif.', {
            code: 'dataset_version_already_active',
            statusCode: 409,
          })
        }

        const pointerResult = await client.query(
          `SELECT dataset_id, branch_id, dataset_version_id,
              previous_dataset_version_id, revision, activated_by, activated_at,
              migrated_from_legacy_status
           FROM dataset_active_pointers
           WHERE dataset_id = $1 AND branch_id = $2
           FOR UPDATE`,
          [datasetId, branchId],
        )
        const pointerRow = pointerResult.rows?.[0] ?? null
        const activeRecords = datasetRecords.filter(({ datasetVersion }) => (
          datasetVersion.status === 'active'
        ))
        if (!pointerRow && activeRecords.length > 1) {
          throw activeVersionIntegrityError()
        }
        const previous = pointerRow
          ? datasetRecords.find((record) => (
            record.datasetVersion.id === pointerRow.dataset_version_id
          )) ?? null
          : activeRecords[0] ?? null
        if (pointerRow && !previous) throw activeVersionIntegrityError()
        const previousVersionId = previous?.datasetVersion.id ?? null
        activationContext.previousVersionId = previousVersionId
        if (expectedActiveVersionId !== undefined
          && expectedActiveVersionId !== previousVersionId) {
          throw new AppError(
            'Dataset aktif telah berubah sejak preview dimuat. Muat ulang sebelum aktivasi.',
            {
              code: 'stale_activation_request',
              statusCode: 409,
              details: {
                expectedActiveVersionId,
                currentActiveVersionId: previousVersionId,
              },
            },
          )
        }
        await validateTarget?.(structuredClone(lockedTarget))

        const revision = randomUUID()
        const archivedRecords = []
        for (const record of activeRecords) {
          if (record.datasetVersion.id === datasetVersionId) continue
          const archived = withDatasetState(record, {
            status: 'archived',
            publicationStatus: 'archived',
            archivedAt: activatedAt,
            archivedBy: actorId,
            activePointerRevision: null,
          })
          archived.recordRevision = normalizeRecordRevision(record.recordRevision) + 1
          await updateDatasetVersion(client, archived, this.clock)
          await setGraphRevisionStatus(client, archived, 'superseded')
          archivedRecords.push(archived)
        }
        const activated = withDatasetState(lockedTarget, {
          status: 'active',
          publicationStatus: 'published',
          activatedBy: actorId,
          activatedAt,
          activePointerRevision: revision,
        })
        activated.recordRevision = normalizeRecordRevision(lockedTarget.recordRevision) + 1
        await updateDatasetVersion(client, activated, this.clock)
        await setGraphRevisionStatus(client, activated, 'active')
        await this.activationHooks.beforePointerCommit?.({
          datasetId,
          branchId,
          previousVersionId,
          newVersionId: datasetVersionId,
        })
        const pointer = {
          schemaVersion: '1.0.0',
          datasetId,
          branchId,
          datasetVersionId,
          previousVersionId,
          activatedBy: actorId,
          activatedAt,
          revision,
        }
        await client.query(
          `INSERT INTO dataset_active_pointers (
             dataset_id, branch_id, dataset_version_id,
             previous_dataset_version_id, revision, activated_by, activated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (dataset_id, branch_id) DO UPDATE SET
             dataset_version_id = EXCLUDED.dataset_version_id,
             previous_dataset_version_id = EXCLUDED.previous_dataset_version_id,
             revision = EXCLUDED.revision,
             activated_by = EXCLUDED.activated_by,
             activated_at = EXCLUDED.activated_at,
             migrated_from_legacy_status = false`,
          [
            datasetId,
            branchId,
            datasetVersionId,
            previousVersionId,
            revision,
            actorId,
            activatedAt,
          ],
        )
        return {
          activated: structuredClone(activated),
          archivedRecords: structuredClone(archivedRecords),
          previous: previous ? structuredClone(previous) : null,
          pointer,
        }
      })
    } catch (error) {
      error.activationContext = activationContext
      throw error
    }
  }

  async #getWithExecutor(executor, id, { forUpdate = false } = {}) {
    assertSafeId(id)
    const query = forUpdate
      ? `${DATASET_VERSION_SELECT.trim()} FOR UPDATE`
      : DATASET_VERSION_SELECT
    const result = await executor.query(query, [id])
    if (!result.rows?.length) throw datasetVersionNotFound()
    return payloadFromRow(result.rows[0])
  }

  async #listWithExecutor(executor) {
    const result = await executor.query(
      'SELECT payload FROM dataset_versions ORDER BY id ASC',
    )
    return (result.rows ?? []).map(payloadFromRow)
  }

  async #updateWithExecutor(executor, id, updater, {
    expectedRevision,
    projectionMode = 'full',
  } = {}) {
    assertSafeId(id)
    const currentResult = await executor.query(
      `${DATASET_VERSION_SELECT.trim()} FOR UPDATE`,
      [id],
    )
    if (!currentResult.rows?.length) throw datasetVersionNotFound()
    const current = payloadFromRow(currentResult.rows[0])
    const currentRevision = normalizeRecordRevision(current.recordRevision)
    if (expectedRevision !== undefined && currentRevision !== expectedRevision) {
      throw staleRecordRevision(id, expectedRevision, currentRevision)
    }
    const next = typeof updater === 'function'
      ? await updater(structuredClone(current))
      : { ...current, ...updater }
    const normalized = assertRecord({
      ...next,
      recordRevision: currentRevision + 1,
    }, id)
    try {
      await updateDatasetVersion(executor, normalized, this.clock)
      if (projectionMode === 'topology-review') {
        await replaceTopologyReviewProjections(executor, current, normalized)
      } else {
        await replaceProjections(executor, normalized)
      }
    } catch (error) {
      throw mapDatabaseError(error)
    }
    return structuredClone(normalized)
  }

  async #withTransaction(operation) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await operation(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw mapDatabaseError(error)
    } finally {
      client.release?.()
    }
  }
}

async function insertDatasetVersion(client, record, clock) {
  await client.query(
    `INSERT INTO dataset_versions (
       id, dataset_id, branch_id, version_name, source_filename,
       source_storage_key, source_size, source_checksum, contract_version,
       validation_status, publication_status, status, active_pointer_revision,
       payload, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14::jsonb, $15, $15
     )`,
    datasetVersionValues(record, clock),
  )
}

async function updateDatasetVersion(client, record, clock) {
  await client.query(
    `UPDATE dataset_versions
     SET dataset_id = $2,
         branch_id = $3,
         version_name = $4,
         source_filename = $5,
         source_storage_key = $6,
         source_size = $7,
         source_checksum = $8,
         contract_version = $9,
         validation_status = $10,
         publication_status = $11,
         status = $12,
         active_pointer_revision = $13,
         payload = $14::jsonb,
         updated_at = $15
     WHERE id = $1`,
    datasetVersionValues(record, clock),
  )
}

async function setGraphRevisionStatus(client, record, status) {
  const revision = record.topologyGraph?.graphRevision
  if (!revision) return
  await client.query(
    `UPDATE graph_revisions
     SET status = $3
     WHERE dataset_version_id = $1 AND revision = $2`,
    [record.datasetVersion.id, revision, status],
  )
}

function datasetVersionValues(record, clock) {
  const version = record.datasetVersion
  return [
    version.id,
    requiredText(version.datasetId, 'datasetId'),
    requiredText(version.branchId, 'branchId'),
    String(version.versionName ?? version.id),
    version.sourceFilename ?? null,
    version.sourceStorageKey ?? null,
    integerOrNull(version.sourceSize),
    version.checksum ?? record.sourceChecksum ?? null,
    record.contractVersion ?? '1.0.0',
    version.validationStatus ?? record.validation?.status ?? 'pending',
    version.publicationStatus ?? 'unpublished',
    version.status ?? 'processing',
    version.activePointerRevision ?? null,
    JSON.stringify(record),
    clock().toISOString(),
  ]
}

async function replaceProjections(client, record) {
  const datasetVersionId = record.datasetVersion.id
  for (const table of PROJECTION_DELETE_ORDER) {
    await client.query(`DELETE FROM ${table} WHERE dataset_version_id = $1`, [
      datasetVersionId,
    ])
  }

  for (const feature of asArray(record.sourceFeatures)) {
    const sourceFeatureId = requiredText(feature.sourceFeatureId, 'sourceFeatureId')
    await client.query(
      `INSERT INTO source_features (
         dataset_version_id, source_feature_id, source_feature_key,
         source_element_type, source_folder_path, source_name, source_kml_id,
         visibility, source_fingerprint, raw_properties, payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)`,
      [
        datasetVersionId,
        sourceFeatureId,
        feature.sourceFeatureKey ?? null,
        feature.sourceElementType ?? 'unknown',
        feature.sourceFolderPath ?? null,
        feature.sourceName ?? null,
        feature.sourceKmlId ?? null,
        feature.visibility !== false,
        feature.sourceFingerprint ?? null,
        JSON.stringify(feature.rawProperties ?? {}),
        JSON.stringify(feature),
      ],
    )
  }

  for (const geometry of asArray(record.sourceGeometries)) {
    const geometryId = requiredText(geometry.geometryId, 'geometryId')
    const geometryType = requiredText(
      geometry.geometryType ?? geometry.type,
      'geometryType',
    )
    await client.query(
      `INSERT INTO source_geometries (
         dataset_version_id, source_geometry_id, source_feature_id,
         geometry_part_identity, geometry_type, geometry, coordinates,
         source_coordinate_text, source_vertex_order_preserved, valid,
         geometry_fingerprint, payload
       ) VALUES (
         $1, $2, $3, $4, $5,
         CASE WHEN $6::text IS NULL THEN NULL
           ELSE ST_SetSRID(ST_GeomFromGeoJSON($6::text), 4326) END,
         $7::jsonb, $8::jsonb, $9, $10, $11, $12::jsonb
       )`,
      [
        datasetVersionId,
        geometryId,
        requiredText(geometry.sourceFeatureId, 'sourceFeatureId'),
        geometry.geometryPartIdentity ?? null,
        geometryType,
        geoJsonForGeometry(geometry),
        jsonValue(geometry.coordinates),
        jsonValue(geometry.sourceCoordinateText),
        geometry.sourceVertexOrderPreserved !== false,
        geometry.valid !== false,
        geometry.geometryFingerprint ?? null,
        JSON.stringify(geometry),
      ],
    )
  }

  for (const object of asArray(record.classifiedObjects)) {
    const objectId = requiredText(object.classifiedObjectId, 'classifiedObjectId')
    await client.query(
      `INSERT INTO classified_objects (
         dataset_version_id, classified_object_id, source_feature_id, asset_id,
         canonical_asset_id, stable_asset_id, site_id, object_role,
         network_family, asset_type, category, classification_status,
         classification_score, classification_evidence, geometry_ids, payload
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         $14::jsonb, $15::jsonb, $16::jsonb
       )`,
      [
        datasetVersionId,
        objectId,
        object.sourceFeatureId ?? null,
        object.assetId ?? null,
        object.canonicalAssetId ?? null,
        object.stableAssetId ?? null,
        requiredText(object.siteId, 'siteId'),
        requiredText(object.objectRole, 'objectRole'),
        requiredText(object.networkFamily, 'networkFamily'),
        object.assetType ?? null,
        object.category ?? null,
        requiredText(object.classificationStatus, 'classificationStatus'),
        numberOrNull(object.classificationScore),
        JSON.stringify(object.classificationEvidence ?? []),
        JSON.stringify(object.geometryIds ?? []),
        JSON.stringify(object),
      ],
    )
  }

  for (const candidate of asArray(record.topologyCandidates)) {
    const candidateId = requiredText(candidate.candidateId, 'candidateId')
    await client.query(
      `INSERT INTO topology_candidates (
         dataset_version_id, candidate_id, candidate_type, source_endpoint_id,
         source_geometry_id, source_path_asset_id, target_asset_id,
         target_endpoint_id, target_path_asset_id, site_id, network_family,
         candidate_status, proposal_status, score, score_margin, evidence,
         revision, payload
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16::jsonb, $17, $18::jsonb
       )`,
      [
        datasetVersionId,
        candidateId,
        requiredText(candidate.candidateType, 'candidateType'),
        candidate.sourceEndpointId ?? null,
        candidate.sourceGeometryId ?? candidate.sourceGeometryIds?.[0] ?? null,
        candidate.sourcePathAssetId ?? null,
        candidate.targetAssetId ?? null,
        candidate.targetEndpointId ?? null,
        candidate.targetPathAssetId ?? null,
        candidate.siteId ?? null,
        candidate.networkFamily ?? null,
        requiredText(candidate.candidateStatus, 'candidateStatus'),
        requiredText(candidate.proposalStatus, 'proposalStatus'),
        numberOrNull(candidate.score),
        numberOrNull(candidate.scoreMargin),
        JSON.stringify(candidate.evidence ?? []),
        integerOrZero(candidate.revision),
        JSON.stringify(candidate),
      ],
    )
  }

  for (const relation of asArray(record.confirmedRelations)) {
    const relationId = requiredText(
      relation.relationId ?? relation.id,
      'relationId',
    )
    await client.query(
      `INSERT INTO confirmed_relations (
         dataset_version_id, relation_id, candidate_id, source_asset_id,
         target_asset_id, relation_type, relation_kind, direction, provenance,
         verification_status, verified_by, verified_at, audit_event_id,
         evidence, payload
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         $14::jsonb, $15::jsonb
       )`,
      [
        datasetVersionId,
        relationId,
        relation.candidateId ?? null,
        requiredText(relation.sourceAssetId, 'sourceAssetId'),
        requiredText(relation.targetAssetId, 'targetAssetId'),
        relation.relationType ?? 'connected-to',
        relation.relationKind ?? null,
        relation.direction ?? 'undirected',
        relation.provenance ?? 'unknown',
        relation.verificationStatus ?? relation.relationStatus ?? 'confirmed',
        relation.verifiedBy ?? null,
        relation.verifiedAt ?? null,
        relation.auditEventId ?? null,
        JSON.stringify(relation.evidence ?? []),
        JSON.stringify(relation),
      ],
    )
  }

  await insertGraphProjection(client, record)
}

/**
 * Review mutations already carry a complete aggregate for correctness, but
 * their indexed PostgreSQL projections only need the changed topology rows.
 * Source features, geometries, and classified objects are immutable after
 * import and must not be deleted/reinserted for every reviewer click.
 */
async function replaceTopologyReviewProjections(client, previous, record) {
  const datasetVersionId = record.datasetVersion.id
  const previousCandidates = new Map(asArray(previous.topologyCandidates).map((candidate) => (
    [candidate.candidateId, candidate]
  )))
  const nextCandidates = new Map(asArray(record.topologyCandidates).map((candidate) => (
    [candidate.candidateId, candidate]
  )))
  const previousRelations = new Map(asArray(previous.confirmedRelations).map((relation) => (
    [relation.relationId ?? relation.id, relation]
  )))
  const nextRelations = new Map(asArray(record.confirmedRelations).map((relation) => (
    [relation.relationId ?? relation.id, relation]
  )))

  for (const [relationId] of previousRelations) {
    if (nextRelations.has(relationId)) continue
    await client.query(
      'DELETE FROM confirmed_relations WHERE dataset_version_id = $1 AND relation_id = $2',
      [datasetVersionId, relationId],
    )
  }
  for (const [candidateId, candidate] of nextCandidates) {
    if (jsonValuesEqual(previousCandidates.get(candidateId), candidate)) continue
    await upsertTopologyCandidate(client, datasetVersionId, candidate)
  }
  for (const [relationId, relation] of nextRelations) {
    if (jsonValuesEqual(previousRelations.get(relationId), relation)) continue
    await upsertConfirmedRelation(client, datasetVersionId, relation)
  }
  for (const [candidateId] of previousCandidates) {
    if (nextCandidates.has(candidateId)) continue
    await client.query(
      'DELETE FROM topology_candidates WHERE dataset_version_id = $1 AND candidate_id = $2',
      [datasetVersionId, candidateId],
    )
  }

  const previousGraphRevision = previous.topologyGraph?.graphRevision
  const nextGraphRevision = record.topologyGraph?.graphRevision
  if (nextGraphRevision && nextGraphRevision !== previousGraphRevision) {
    await insertGraphProjection(client, record)
    if (previousGraphRevision) {
      await client.query(
        `UPDATE graph_revisions
         SET status = 'superseded'
         WHERE dataset_version_id = $1
           AND revision = $2
           AND revision <> $3`,
        [datasetVersionId, previousGraphRevision, nextGraphRevision],
      )
    }
  }
}

async function upsertTopologyCandidate(client, datasetVersionId, candidate) {
  await client.query(
    `INSERT INTO topology_candidates (
       dataset_version_id, candidate_id, candidate_type, source_endpoint_id,
       source_geometry_id, source_path_asset_id, target_asset_id,
       target_endpoint_id, target_path_asset_id, site_id, network_family,
       candidate_status, proposal_status, score, score_margin, evidence,
       revision, payload
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       $15, $16::jsonb, $17, $18::jsonb
     )
     ON CONFLICT (dataset_version_id, candidate_id) DO UPDATE SET
       candidate_type = EXCLUDED.candidate_type,
       source_endpoint_id = EXCLUDED.source_endpoint_id,
       source_geometry_id = EXCLUDED.source_geometry_id,
       source_path_asset_id = EXCLUDED.source_path_asset_id,
       target_asset_id = EXCLUDED.target_asset_id,
       target_endpoint_id = EXCLUDED.target_endpoint_id,
       target_path_asset_id = EXCLUDED.target_path_asset_id,
       site_id = EXCLUDED.site_id,
       network_family = EXCLUDED.network_family,
       candidate_status = EXCLUDED.candidate_status,
       proposal_status = EXCLUDED.proposal_status,
       score = EXCLUDED.score,
       score_margin = EXCLUDED.score_margin,
       evidence = EXCLUDED.evidence,
       revision = EXCLUDED.revision,
       payload = EXCLUDED.payload,
       updated_at = now()` ,
    [
      datasetVersionId,
      candidate.candidateId,
      requiredText(candidate.candidateType, 'candidateType'),
      candidate.sourceEndpointId ?? null,
      candidate.sourceGeometryId ?? candidate.sourceGeometryIds?.[0] ?? null,
      candidate.sourcePathAssetId ?? null,
      candidate.targetAssetId ?? null,
      candidate.targetEndpointId ?? null,
      candidate.targetPathAssetId ?? null,
      candidate.siteId ?? null,
      candidate.networkFamily ?? null,
      requiredText(candidate.candidateStatus, 'candidateStatus'),
      requiredText(candidate.proposalStatus, 'proposalStatus'),
      numberOrNull(candidate.score),
      numberOrNull(candidate.scoreMargin),
      JSON.stringify(candidate.evidence ?? []),
      integerOrZero(candidate.revision),
      JSON.stringify(candidate),
    ],
  )
}

async function upsertConfirmedRelation(client, datasetVersionId, relation) {
  const relationId = requiredText(relation.relationId ?? relation.id, 'relationId')
  await client.query(
    `INSERT INTO confirmed_relations (
       dataset_version_id, relation_id, candidate_id, source_asset_id,
       target_asset_id, relation_type, relation_kind, direction, provenance,
       verification_status, verified_by, verified_at, audit_event_id,
       evidence, payload
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14::jsonb, $15::jsonb
     )
     ON CONFLICT (dataset_version_id, relation_id) DO UPDATE SET
       candidate_id = EXCLUDED.candidate_id,
       source_asset_id = EXCLUDED.source_asset_id,
       target_asset_id = EXCLUDED.target_asset_id,
       relation_type = EXCLUDED.relation_type,
       relation_kind = EXCLUDED.relation_kind,
       direction = EXCLUDED.direction,
       provenance = EXCLUDED.provenance,
       verification_status = EXCLUDED.verification_status,
       verified_by = EXCLUDED.verified_by,
       verified_at = EXCLUDED.verified_at,
       audit_event_id = EXCLUDED.audit_event_id,
       evidence = EXCLUDED.evidence,
       payload = EXCLUDED.payload,
       updated_at = now()` ,
    [
      datasetVersionId,
      relationId,
      relation.candidateId ?? null,
      requiredText(relation.sourceAssetId, 'sourceAssetId'),
      requiredText(relation.targetAssetId, 'targetAssetId'),
      relation.relationType ?? 'connected-to',
      relation.relationKind ?? null,
      relation.direction ?? 'undirected',
      relation.provenance ?? 'unknown',
      relation.verificationStatus ?? relation.relationStatus ?? 'confirmed',
      relation.verifiedBy ?? null,
      relation.verifiedAt ?? null,
      relation.auditEventId ?? null,
      JSON.stringify(relation.evidence ?? []),
      JSON.stringify(relation),
    ],
  )
}

function jsonValuesEqual(left, right) {
  return left === undefined && right === undefined
    || JSON.stringify(left) === JSON.stringify(right)
}

async function insertGraphProjection(client, record) {
  const graph = record.topologyGraph
  if (!graph?.graphRevision) return
  const status = record.datasetVersion.status === 'active' ? 'active' : 'validated'
  const revisionResult = await client.query(
    `INSERT INTO graph_revisions (
       dataset_version_id, revision, parent_revision, status, validation,
       node_count, edge_count, payload
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb)
       ON CONFLICT (dataset_version_id, revision) DO NOTHING
       RETURNING graph_revision_id`,
    [
      record.datasetVersion.id,
      graph.graphRevision,
      record.topologyGraph.parentGraphRevision ?? null,
      status,
      jsonValue(record.topologyValidation),
      asArray(graph.nodes).length,
      asArray(graph.edges).length,
      JSON.stringify(graph),
    ],
  )
  let graphRevisionId = revisionResult.rows?.[0]?.graph_revision_id
  if (graphRevisionId === undefined || graphRevisionId === null) {
    const existing = await client.query(
      `SELECT graph_revision_id
       FROM graph_revisions
       WHERE dataset_version_id = $1 AND revision = $2`,
      [record.datasetVersion.id, graph.graphRevision],
    )
    graphRevisionId = existing.rows?.[0]?.graph_revision_id
    if (graphRevisionId !== undefined && graphRevisionId !== null) {
      await client.query(
        `UPDATE graph_revisions
         SET status = $3,
             validation = $4::jsonb,
             node_count = $5,
             edge_count = $6,
             payload = $7::jsonb
         WHERE graph_revision_id = $1 AND dataset_version_id = $2`,
        [
          graphRevisionId,
          record.datasetVersion.id,
          status,
          jsonValue(record.topologyValidation),
          asArray(graph.nodes).length,
          asArray(graph.edges).length,
          JSON.stringify(graph),
        ],
      )
      return graphRevisionId
    }
  }
  if (graphRevisionId === undefined || graphRevisionId === null) {
    throw new Error('PostgreSQL tidak mengembalikan graph_revision_id.')
  }
  for (const node of asArray(graph.nodes)) {
    const nodeId = requiredText(node.id ?? node.assetId, 'graphNodeId')
    await client.query(
      `INSERT INTO graph_nodes (
         graph_revision_id, dataset_version_id, node_id, asset_id, site_id,
         network_family, source_geometry_id, location, payload
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
           CASE WHEN $8::text IS NULL THEN NULL
             ELSE ST_SetSRID(ST_GeomFromGeoJSON($8::text), 4326) END,
         $9::jsonb
       )`,
      [
        graphRevisionId,
        record.datasetVersion.id,
        nodeId,
        node.assetId ?? node.canonicalAssetId ?? null,
        node.siteId ?? null,
        node.networkFamily ?? null,
        node.sourceGeometryId ?? null,
        geoJsonForPoint(node.location),
        JSON.stringify(node),
      ],
    )
  }
  for (const edge of asArray(graph.edges)) {
    const edgeId = requiredText(edge.id ?? edge.edgeId, 'graphEdgeId')
    const sourceRelationIds = asArray(edge.sourceRelationIds)
    await client.query(
      `INSERT INTO graph_edges (
         graph_revision_id, dataset_version_id, edge_id, relation_id,
         source_node_id, target_node_id, verification_status,
         source_geometry_ids, payload
       ) VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7::jsonb, $8::jsonb)`,
      [
        graphRevisionId,
        record.datasetVersion.id,
        edgeId,
        edge.relationId ?? (sourceRelationIds.length === 1 ? sourceRelationIds[0] : null),
        requiredText(edge.sourceNodeId ?? edge.sourceAssetId, 'sourceNodeId'),
        requiredText(edge.targetNodeId ?? edge.targetAssetId, 'targetNodeId'),
        JSON.stringify(edge.sourceGeometryIds ?? []),
        JSON.stringify(edge),
      ],
    )
  }
}

function withDatasetState(record, {
  status,
  publicationStatus,
  activePointerRevision,
  ...fields
}) {
  return {
    ...structuredClone(record),
    datasetVersion: {
      ...record.datasetVersion,
      status,
      publicationStatus,
      ...fields,
      ...(activePointerRevision !== undefined ? { activePointerRevision } : {}),
    },
  }
}

function pointerFromRow(row) {
  return {
    schemaVersion: '1.0.0',
    datasetId: row.dataset_id,
    branchId: row.branch_id,
    datasetVersionId: row.dataset_version_id,
    previousVersionId: row.previous_dataset_version_id ?? null,
    activatedBy: row.activated_by ?? null,
    activatedAt: timestampValue(row.activated_at),
    revision: row.revision,
    ...(row.migrated_from_legacy_status ? { migratedFromLegacyStatus: true } : {}),
  }
}

function assertPointerIntegrity(pointer, record, { datasetId, branchId }) {
  if (pointer.datasetId !== datasetId
    || record.datasetVersion.datasetId !== datasetId
    || pointer.datasetVersionId !== record.datasetVersion.id
    || pointer.branchId !== record.datasetVersion.branchId
    || (branchId && pointer.branchId !== branchId)) {
    throw activeVersionIntegrityError()
  }
}

function payloadFromRow(row) {
  const payload = typeof row.payload === 'string'
    ? JSON.parse(row.payload)
    : row.payload
  return structuredClone(payload ?? {})
}

function geoJsonForGeometry(geometry) {
  if (geometry.valid === false) return null
  const type = {
    point: 'Point',
    Point: 'Point',
    line_string: 'LineString',
    LineString: 'LineString',
    polygon: 'Polygon',
    Polygon: 'Polygon',
  }[geometry.geometryType ?? geometry.type]
  if (!type || geometry.coordinates === undefined) return null
  return JSON.stringify({ type, coordinates: geometry.coordinates })
}

function geoJsonForPoint(location) {
  const coordinates = Array.isArray(location)
    ? location
    : Array.isArray(location?.coordinates) ? location.coordinates : null
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null
  if (!coordinates.slice(0, 2).every((value) => Number.isFinite(Number(value)))) return null
  return JSON.stringify({
    type: 'Point',
    coordinates: coordinates.slice(0, 2).map(Number),
  })
}

function mapDatabaseError(error) {
  if (error instanceof AppError) return error
  if (error?.code === '23505' && error.constraint === 'dataset_versions_pkey') {
    return new AppError('Dataset version sudah tersedia.', {
      code: 'dataset_version_exists',
      statusCode: 409,
      cause: error,
    })
  }
  if (error?.code === '23505' && error.constraint === 'dataset_versions_one_active_idx') {
    return new AppError('Ditemukan lebih dari satu dataset version aktif.', {
      code: 'active_version_integrity_error',
      statusCode: 409,
      cause: error,
    })
  }
  if (error?.code === '42P01') {
    return new AppError('Schema PostgreSQL belum siap. Jalankan migration terlebih dahulu.', {
      code: 'database_schema_not_ready',
      statusCode: 503,
      cause: error,
    })
  }
  return error
}

function datasetVersionNotFound() {
  return new AppError('Dataset version tidak ditemukan.', {
    code: 'dataset_version_not_found',
    statusCode: 404,
  })
}

function activeVersionIntegrityError() {
  return new AppError('Pointer dataset aktif tidak konsisten.', {
    code: 'active_version_integrity_error',
    statusCode: 409,
  })
}

function normalizeRecordRevision(value) {
  const revision = Number(value)
  return Number.isInteger(revision) && revision >= 0 ? revision : 0
}

function staleRecordRevision(datasetVersionId, expectedRevision, currentRevision) {
  return new AppError('Dataset version berubah sejak dibaca.', {
    code: 'dataset_version_stale_revision',
    statusCode: 409,
    details: {
      datasetVersionId,
      expectedRevision,
      currentRevision,
    },
  })
}

function assertRecord(record, expectedId = null) {
  if (!record || typeof record !== 'object' || !record.datasetVersion?.id) {
    throw new TypeError('Record dataset version tidak valid.')
  }
  assertSafeId(record.datasetVersion.id)
  if (expectedId && record.datasetVersion.id !== expectedId) {
    throw new AppError('Updater mengubah ID dataset version.', {
      code: 'dataset_version_identity_changed',
      statusCode: 409,
    })
  }
  return structuredClone(record)
}

function assertSafeId(id) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(String(id))) {
    throw new AppError('Identifier dataset version tidak valid.', {
      code: 'invalid_dataset_version_id',
      statusCode: 400,
    })
  }
}

function assertDatasetContext(datasetId) {
  if (!String(datasetId ?? '').trim()) {
    throw new AppError('Dataset ID wajib tersedia.', {
      code: 'invalid_dataset_id',
      statusCode: 400,
    })
  }
}

function requiredText(value, field) {
  const text = String(value ?? '').trim()
  if (!text) throw new TypeError(`${field} wajib tersedia untuk projection PostgreSQL.`)
  return text
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function jsonValue(value) {
  return value === undefined || value === null ? null : JSON.stringify(value)
}

function numberOrNull(value) {
  return value === undefined || value === null || value === ''
    ? null
    : Number(value)
}

function integerOrNull(value) {
  return value === undefined || value === null || value === ''
    ? null
    : Number.isInteger(Number(value)) ? Number(value) : null
}

function integerOrZero(value) {
  return integerOrNull(value) ?? 0
}

function timestampValue(value) {
  if (value === undefined || value === null) return null
  return value instanceof Date ? value.toISOString() : String(value)
}
