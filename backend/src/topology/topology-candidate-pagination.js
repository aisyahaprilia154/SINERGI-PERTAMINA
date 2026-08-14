import { createHash } from 'node:crypto'
import { AppError } from '../errors.js'

export const DEFAULT_CANDIDATE_PAGE_SIZE = 100
export const MAX_CANDIDATE_PAGE_SIZE = 500
export const MAX_CANDIDATE_RESPONSE_BYTES = 2 * 1024 * 1024
export const CANDIDATE_STATUSES = Object.freeze([
  'candidate',
  'ambiguous',
  'confirmed',
  'rejected',
  'revoked',
])
export const CANDIDATE_TYPES = Object.freeze([
  'endpoint_device',
  'inline_device',
  'endpoint_endpoint',
  'intersection_with_junction',
  'explicit_metadata',
  'line_label_connection',
  'line_label_attachment',
  'manual_relation',
])

/**
 * In-memory postings are the JSON-repository equivalent of the status/site/
 * family indexes that the PostgreSQL adapter will provide later. The query
 * always returns the canonical score/id order, regardless of posting order.
 */
export class TopologyCandidateQueryIndex {
  constructor(candidates = []) {
    this.all = [...candidates].sort(compareCandidates)
    this.byStatus = buildPostingIndex(this.all, (candidate) => candidate.candidateStatus)
    this.bySite = buildPostingIndex(this.all, (candidate) => [
      candidate.siteId,
      candidate.sourceSiteId,
      candidate.sourcePathSiteId,
    ])
    this.byNetworkFamily = buildPostingIndex(this.all, (candidate) => (
      candidate.networkFamily
    ))
    this.byCandidateType = buildPostingIndex(this.all, (candidate) => (
      candidate.candidateType
    ))
    this.byProposalStatus = buildPostingIndex(this.all, (candidate) => (
      candidate.proposalStatus
    ))
    this.byId = new Map(this.all.map((candidate) => [candidate.candidateId, candidate]))
  }

  query({
    status,
    site,
    networkFamily,
    candidateType,
    proposalStatus,
    minScore,
    maxScore,
    minDistance,
    maxDistance,
    assetSearch,
    requiredTopologyOnly,
  } = {}) {
    const postingSets = [
      status ? this.byStatus.get(status) : null,
      site ? this.bySite.get(site) : null,
      networkFamily ? this.byNetworkFamily.get(networkFamily) : null,
      candidateType ? this.byCandidateType.get(candidateType) : null,
      proposalStatus ? this.byProposalStatus.get(proposalStatus) : null,
    ].filter(Boolean)
    const allowed = postingSets.length
      ? postingSets.sort((left, right) => left.size - right.size)[0]
      : null
    const source = allowed
      ? [...allowed].map((candidateId) => this.byId.get(candidateId)).filter(Boolean)
      : minScore === null || minScore === undefined
        ? this.all
        : this.all.slice(0, firstScoreBelow(this.all, minScore))
    return source.filter((candidate) => {
      if (allowed && !allowed.has(candidate.candidateId)) return false
      if (status && candidate.candidateStatus !== status) return false
      if (site && !candidateSite(candidate, site)) return false
      if (networkFamily && candidate.networkFamily !== networkFamily) return false
      if (candidateType && candidate.candidateType !== candidateType) return false
      if (proposalStatus && candidate.proposalStatus !== proposalStatus) return false
      if (minScore !== null && minScore !== undefined
        && scoreValue(candidate) < minScore) return false
      if (maxScore !== null && maxScore !== undefined
        && scoreValue(candidate) > maxScore) return false
      if (minDistance !== null && minDistance !== undefined
        && distanceValue(candidate) < minDistance) return false
      if (maxDistance !== null && maxDistance !== undefined
        && distanceValue(candidate) > maxDistance) return false
      if (assetSearch && !candidateAssetSearch(candidate).includes(assetSearch)) return false
      if (requiredTopologyOnly && candidate.topologyRequired !== true) return false
      return true
    })
  }
}

export function paginateCandidates(candidates, {
  status = null,
  site = null,
  networkFamily = null,
  candidateType = null,
  proposalStatus = null,
  minScore = null,
  maxScore = null,
  minDistance = null,
  maxDistance = null,
  assetSearch = null,
  requiredTopologyOnly = false,
  cursor = null,
  limit = DEFAULT_CANDIDATE_PAGE_SIZE,
  graphRevision = null,
  candidateRevision,
} = {}) {
  const normalized = normalizeCandidateQuery({
    status,
    site,
    networkFamily,
    candidateType,
    proposalStatus,
    minScore,
    maxScore,
    minDistance,
    maxDistance,
    assetSearch,
    requiredTopologyOnly,
    cursor,
    limit,
  })
  const index = candidates instanceof TopologyCandidateQueryIndex
    ? candidates
    : new TopologyCandidateQueryIndex(candidates)
  const currentCandidateRevision = candidateRevision
    ?? createCandidateCollectionRevision(index.all)
  const filtered = index.query(normalized)
  const cursorValue = normalized.cursor
    ? decodeCandidateCursor(normalized.cursor, {
      graphRevision,
      candidateRevision: currentCandidateRevision,
      query: candidateQuerySignature(normalized),
    })
    : null
  const start = cursorValue
    ? filtered.findIndex((candidate) => isAfterCursor(candidate, cursorValue))
    : 0
  const offset = start < 0 ? filtered.length : start
  const page = filtered.slice(offset, offset + normalized.limit)
  const last = page.at(-1)
  const hasNextPage = offset + page.length < filtered.length
  return {
    items: structuredClone(page),
    nextCursor: hasNextPage
      ? encodeCandidateCursor({
        score: scoreValue(last),
        candidateId: last.candidateId,
        graphRevision,
        candidateRevision: currentCandidateRevision,
        query: candidateQuerySignature(normalized),
      })
      : null,
    pageInfo: {
      limit: normalized.limit,
      hasNextPage,
      total: filtered.length,
    },
    filteredCandidates: filtered,
    candidateRevision: currentCandidateRevision,
  }
}

export function normalizeCandidateQuery({
  status,
  site,
  networkFamily,
  candidateType,
  proposalStatus,
  minScore,
  maxScore,
  minDistance,
  maxDistance,
  assetSearch,
  requiredTopologyOnly,
  cursor,
  limit,
} = {}) {
  const normalizedStatus = normalizeOptionalEnum(status, CANDIDATE_STATUSES, 'status')
  const normalizedSite = normalizeOptionalText(site, 'site')
  const normalizedFamily = normalizeOptionalText(networkFamily, 'networkFamily')
  const normalizedCandidateType = normalizeOptionalEnum(
    candidateType,
    CANDIDATE_TYPES,
    'candidateType',
  )
  const normalizedProposalStatus = normalizeOptionalText(proposalStatus, 'proposalStatus')
  const normalizedMinScore = normalizeScore(minScore, 'minScore')
  const normalizedMaxScore = normalizeScore(maxScore, 'maxScore')
  if (normalizedMinScore !== null && normalizedMaxScore !== null
    && normalizedMinScore > normalizedMaxScore) {
    throw new AppError('Rentang score candidate tidak valid.', {
      code: 'invalid_topology_candidate_filter',
      statusCode: 400,
      details: { field: 'score' },
    })
  }
  const normalizedMinDistance = normalizeDistance(minDistance, 'minDistance')
  const normalizedMaxDistance = normalizeDistance(maxDistance, 'maxDistance')
  if (normalizedMinDistance !== null && normalizedMaxDistance !== null
    && normalizedMinDistance > normalizedMaxDistance) {
    throw new AppError('Rentang jarak candidate tidak valid.', {
      code: 'invalid_topology_candidate_filter',
      statusCode: 400,
      details: { field: 'distance' },
    })
  }
  const normalizedAssetSearch = normalizeOptionalText(assetSearch, 'assetSearch')
  const normalizedRequiredTopologyOnly = normalizeBoolean(
    requiredTopologyOnly,
    'requiredTopologyOnly',
  )
  const normalizedCursor = cursor ? normalizeCursorText(cursor) : null
  const normalizedLimit = normalizeLimit(limit)
  return {
    status: normalizedStatus,
    site: normalizedSite,
    networkFamily: normalizedFamily,
    candidateType: normalizedCandidateType,
    proposalStatus: normalizedProposalStatus,
    minScore: normalizedMinScore,
    maxScore: normalizedMaxScore,
    minDistance: normalizedMinDistance,
    maxDistance: normalizedMaxDistance,
    assetSearch: normalizedAssetSearch?.toLocaleLowerCase('id') ?? null,
    requiredTopologyOnly: normalizedRequiredTopologyOnly,
    cursor: normalizedCursor,
    limit: normalizedLimit,
  }
}

export function summarizeCandidates(candidates) {
  const summary = {
    candidate: 0,
    ambiguous: 0,
    confirmed: 0,
    rejected: 0,
    revoked: 0,
  }
  candidates.forEach(({ candidateStatus }) => {
    if (Object.hasOwn(summary, candidateStatus)) summary[candidateStatus] += 1
  })
  return summary
}

export function createCandidateCollectionRevision(candidates = []) {
  const canonical = [...candidates]
    .sort((left, right) => compareCandidateIds(left.candidateId, right.candidateId))
    .map((candidate) => structuredClone(candidate))
  const digest = createHash('sha256')
    .update(stableStringify(canonical))
    .digest('hex')
    .slice(0, 32)
  return `topology-candidates:${digest}`
}

export function compareCandidates(left, right) {
  return scoreValue(right) - scoreValue(left)
    || compareCandidateIds(left.candidateId, right.candidateId)
}

function buildPostingIndex(candidates, keyFor) {
  const index = new Map()
  candidates.forEach((candidate) => {
    const rawKeys = keyFor(candidate)
    const keys = Array.isArray(rawKeys) ? rawKeys : [rawKeys]
    keys.forEach((rawKey) => {
      const key = rawKey === undefined || rawKey === null ? '' : String(rawKey)
      if (!key) return
      const posting = index.get(key) ?? new Set()
      posting.add(candidate.candidateId)
      index.set(key, posting)
    })
  })
  return index
}

function candidateSite(candidate, site) {
  return [candidate.siteId, candidate.sourceSiteId, candidate.sourcePathSiteId]
    .filter(Boolean)
    .includes(site)
}

function scoreValue(candidate) {
  const score = Number(candidate?.score)
  return Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY
}

function firstScoreBelow(candidates, minScore) {
  let low = 0
  let high = candidates.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (scoreValue(candidates[middle]) >= minScore) low = middle + 1
    else high = middle
  }
  return low
}

function isAfterCursor(candidate, cursor) {
  return scoreValue(candidate) < cursor.score
    || (scoreValue(candidate) === cursor.score
      && compareCandidateIds(candidate.candidateId, cursor.candidateId) > 0)
}

function encodeCandidateCursor({
  score,
  candidateId,
  graphRevision,
  candidateRevision,
  query,
}) {
  return Buffer.from(JSON.stringify({
    score: Number.isFinite(score) ? score : null,
    candidateId,
    graphRevision: graphRevision ?? null,
    candidateRevision: candidateRevision ?? null,
    query,
  })).toString('base64url')
}

function decodeCandidateCursor(value, {
  graphRevision,
  candidateRevision,
  query,
}) {
  if (String(value).length > 1024) invalidCursor()
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
  } catch {
    invalidCursor()
  }
  if (!parsed || typeof parsed !== 'object'
    || typeof parsed.candidateId !== 'string'
    || (parsed.score !== null && !Number.isFinite(Number(parsed.score)))
    || typeof parsed.query !== 'string') {
    invalidCursor()
  }
  if (parsed.query !== query) {
    throw new AppError('Cursor candidate tidak cocok dengan filter yang diminta.', {
      code: 'topology_candidate_cursor_query_mismatch',
      statusCode: 400,
    })
  }
  if (parsed.graphRevision !== (graphRevision ?? null)
    || parsed.candidateRevision !== (candidateRevision ?? null)) {
    throw new AppError('Cursor candidate sudah stale karena data berubah.', {
      code: 'topology_candidate_cursor_stale',
      statusCode: 409,
      details: {
        requestedGraphRevision: parsed.graphRevision,
        currentGraphRevision: graphRevision ?? null,
        requestedCandidateRevision: parsed.candidateRevision,
        currentCandidateRevision: candidateRevision ?? null,
      },
    })
  }
  return {
    score: parsed.score === null ? Number.NEGATIVE_INFINITY : Number(parsed.score),
    candidateId: parsed.candidateId,
  }
}

function candidateQuerySignature(query) {
  return JSON.stringify({
    status: query.status ?? null,
    site: query.site ?? null,
    networkFamily: query.networkFamily ?? null,
    candidateType: query.candidateType ?? null,
    proposalStatus: query.proposalStatus ?? null,
    minScore: query.minScore ?? null,
    maxScore: query.maxScore ?? null,
    minDistance: query.minDistance ?? null,
    maxDistance: query.maxDistance ?? null,
    assetSearch: query.assetSearch ?? null,
    requiredTopologyOnly: query.requiredTopologyOnly === true,
  })
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_CANDIDATE_PAGE_SIZE
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CANDIDATE_PAGE_SIZE) {
    throw new AppError(`Limit candidate harus 1-${MAX_CANDIDATE_PAGE_SIZE}.`, {
      code: 'invalid_topology_candidate_limit',
      statusCode: 400,
    })
  }
  return parsed
}

function normalizeScore(value, field = 'score') {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new AppError(`${field} candidate harus berada di antara 0 dan 1.`, {
      code: 'invalid_topology_candidate_score',
      statusCode: 400,
      details: { field },
    })
  }
  return parsed
}

function normalizeDistance(value, field) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000000) {
    throw new AppError(`${field} candidate harus berada di antara 0 dan 1000000 meter.`, {
      code: 'invalid_topology_candidate_distance',
      statusCode: 400,
      details: { field },
    })
  }
  return parsed
}

function normalizeBoolean(value, field) {
  if (value === undefined || value === null || value === '' || value === false) return false
  if (value === true || value === 'true' || value === '1' || value === 1) return true
  if (value === 'false' || value === '0' || value === 0) return false
  throw new AppError(`Filter candidate ${field} tidak valid.`, {
    code: 'invalid_topology_candidate_filter',
    statusCode: 400,
    details: { field },
  })
}

function distanceValue(candidate) {
  const distance = Number(candidate?.distanceMeters)
  return Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY
}

function candidateAssetSearch(candidate) {
  return [
    candidate?.sourceAssetId,
    candidate?.sourcePathAssetId,
    candidate?.sourceEndpointId,
    candidate?.targetAssetId,
    candidate?.targetPathAssetId,
    candidate?.targetEndpointId,
  ].filter(Boolean).join(' ').toLocaleLowerCase('id')
}

function normalizeOptionalEnum(value, allowed, field) {
  if (value === undefined || value === null || value === '' || value === 'all') return null
  if (!allowed.includes(value)) {
    throw new AppError(`Filter candidate ${field} tidak didukung.`, {
      code: 'invalid_topology_candidate_filter',
      statusCode: 400,
      details: { field, allowed },
    })
  }
  return value
}

function normalizeOptionalText(value, field) {
  if (value === undefined || value === null || value === '') return null
  const text = String(value).trim()
  if (!text || text.length > 128 || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new AppError(`Filter candidate ${field} tidak valid.`, {
      code: 'invalid_topology_candidate_filter',
      statusCode: 400,
      details: { field },
    })
  }
  return text
}

function normalizeCursorText(value) {
  const text = String(value)
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length > 1024) invalidCursor()
  return text
}

function compareCandidateIds(left, right) {
  const leftText = String(left)
  const rightText = String(right)
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0
}

function stableStringify(value) {
  if (value === undefined) return '"__undefined__"'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(',')}}`
}

function invalidCursor() {
  throw new AppError('Cursor candidate tidak valid atau rusak.', {
    code: 'invalid_topology_candidate_cursor',
    statusCode: 400,
  })
}
