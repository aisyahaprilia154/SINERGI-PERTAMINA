import path from 'node:path'
import { DEFAULT_RELATION_ENGINE_CONFIG } from './topology/semantic-relation-engine.js'

const MEBIBYTE = 1024 * 1024

export const DEFAULT_METADATA_ALIASES = Object.freeze({
  assetId: ['asset_id', 'assetId', 'Asset ID', 'ASSET_ID', 'kode_aset'],
  assetName: ['asset_name', 'assetName', 'Asset Name', 'nama_aset'],
  category: ['category', 'asset_category', 'kategori'],
  assetType: ['asset_type', 'assetType', 'Asset Type', 'type', 'jenis_aset'],
  branchId: ['branch_id', 'branchId', 'Branch ID', 'kode_cabang'],
  branchName: ['branch_name', 'branchName', 'Branch Name', 'nama_cabang'],
  location: ['location', 'lokasi', 'asset_location'],
  ipAddress: ['ip_address', 'ipAddress', 'IP Address', 'ip'],
  hostname: ['hostname', 'host_name', 'Host Name'],
  status: ['status', 'asset_status'],
  connectedTo: ['connected_to', 'connectedTo', 'Connected To'],
  parentAssetId: ['parent_asset_id', 'parentAssetId', 'Parent Asset ID'],
  upstreamAssetId: ['upstream_asset_id', 'upstreamAssetId', 'Upstream Asset ID'],
  downstreamAssetId: ['downstream_asset_id', 'downstreamAssetId', 'Downstream Asset ID'],
  sourceAssetId: ['source_asset_id', 'sourceAssetId', 'Source Asset ID'],
  targetAssetId: ['target_asset_id', 'targetAssetId', 'Target Asset ID'],
  relationType: ['relation_type', 'relationType', 'Relation Type'],
})

export const DEFAULT_FOLDER_MAPPINGS = Object.freeze([
  {
    category: 'CCTV',
    aliases: [
      'CCTV',
      'Camera',
      'Kamera',
      'Titik CCTV',
      'Jaringan CCTV',
      'Titik Camera',
      'Camera Fix Dome',
      'Camera Fixed',
      'IP Camera',
      'View',
      'View CCTV',
      'View Camera',
    ],
  },
  {
    category: 'CCTV Cable',
    aliases: ['Kabel CCTV', 'CCTV Cable', 'Backbone CCTV'],
  },
  {
    category: 'CCTV Junction Box',
    aliases: [
      'JB',
      'JB CCTV',
      'Junction Box CCTV',
      'Junction Box',
      'Juction Box',
      'Jucntion Box',
      'JB Rekomendasi',
      'JB-Rekomendasi',
    ],
  },
  { category: 'NVR', aliases: ['NVR'] },
  {
    category: 'Fiber Optic',
    aliases: [
      'Fiber Optic',
      'Fibre Optic',
      'FO',
      'Jalur FO',
      'FO Rekomendasi',
      'Jaringan Fiber Optic',
    ],
  },
  { category: 'LAN', aliases: ['LAN', 'UTP', 'Jaringan LAN'] },
  {
    category: 'Infrastructure',
    aliases: [
      'Switch',
      'Server',
      'OTB',
      'Rack',
      'Core',
      'Router',
      'Tiang',
      'Titik',
      'Titik Lokasi',
      'Power',
      'Power PLN',
      'Power AC 220',
      'Power Rekomendasi',
      'STP Rekomendasi',
      'Infrastruktur',
      'Jaringan Infrastruktur',
    ],
  },
  {
    category: 'Peripheral',
    aliases: ['Access Point', 'AP', 'Printer', 'Peripheral', 'Jaringan Peripheral'],
  },
])

export const DEFAULT_RELATION_MAPPINGS = Object.freeze([
  {
    mode: 'owner-target',
    targetField: 'connectedTo',
    relationType: 'connected-to',
    separator: ',',
    unresolvedSeverity: 'warning',
  },
  {
    mode: 'explicit-pair',
    sourceField: 'sourceAssetId',
    targetField: 'targetAssetId',
    relationTypeField: 'relationType',
    relationType: 'connected-to',
    unresolvedSeverity: 'error',
  },
  {
    mode: 'owner-target',
    targetField: 'parentAssetId',
    relationType: 'parent',
    separator: ',',
    unresolvedSeverity: 'warning',
  },
  {
    mode: 'owner-target',
    targetField: 'upstreamAssetId',
    relationType: 'upstream',
    separator: ',',
    unresolvedSeverity: 'warning',
  },
  {
    mode: 'owner-target',
    targetField: 'downstreamAssetId',
    relationType: 'downstream',
    separator: ',',
    unresolvedSeverity: 'warning',
  },
])

export function createConfig(env = process.env, overrides = {}) {
  const dataRoot = path.resolve(overrides.dataRoot ?? env.SINERGI_DATA_ROOT ?? '.data')
  const databaseUrl = overrides.database?.databaseUrl
    ?? env.SINERGI_DATABASE_URL
    ?? null
  const storageMode = normalizeStorageMode(
    overrides.storageMode
      ?? env.SINERGI_STORAGE_MODE
      ?? (databaseUrl ? 'postgres' : 'json'),
  )
  const allowedBranchIds = overrides.allowedBranchIds
    ?? splitList(env.SINERGI_BRANCH_IDS)
  const datasetIdsByBranch = overrides.datasetIdsByBranch
    ?? parseJsonObject(env.SINERGI_BRANCH_DATASETS, {})
  const authTokens = overrides.authTokens
    ?? parseJsonObject(env.SINERGI_AUTH_TOKENS, {})

  return {
    port: numberFrom(env.SINERGI_PORT, overrides.port ?? 5000),
    host: overrides.host ?? env.SINERGI_HOST ?? '127.0.0.1',
    dataRoot,
    storageMode,
    database: {
      databaseUrl,
      shadowDatabaseUrl: overrides.database?.shadowDatabaseUrl
        ?? env.SINERGI_SHADOW_DATABASE_URL
        ?? null,
      poolMax: overrides.database?.poolMax
        ?? numberFrom(env.SINERGI_DATABASE_POOL_MAX, 10),
      idleTimeoutMilliseconds: overrides.database?.idleTimeoutMilliseconds
        ?? numberFrom(env.SINERGI_DATABASE_IDLE_TIMEOUT_MS, 30_000),
      connectionTimeoutMilliseconds: overrides.database?.connectionTimeoutMilliseconds
        ?? numberFrom(env.SINERGI_DATABASE_CONNECTION_TIMEOUT_MS, 5_000),
      ssl: overrides.database?.ssl
        ?? booleanFrom(env.SINERGI_DATABASE_SSL, false),
      shadowAwaitComparison: overrides.database?.shadowAwaitComparison
        ?? booleanFrom(env.SINERGI_SHADOW_AWAIT_COMPARISON, false),
    },
    allowedBranchIds,
    datasetIdsByBranch,
    authTokens,
    upload: {
      maxFileSize: overrides.upload?.maxFileSize
        ?? numberFrom(env.SINERGI_MAX_UPLOAD_BYTES, 50 * MEBIBYTE),
      maxArchiveEntries: overrides.upload?.maxArchiveEntries
        ?? numberFrom(env.SINERGI_MAX_ARCHIVE_ENTRIES, 1000),
      maxExtractedSize: overrides.upload?.maxExtractedSize
        ?? numberFrom(env.SINERGI_MAX_EXTRACTED_BYTES, 250 * MEBIBYTE),
      maxCompressionRatio: overrides.upload?.maxCompressionRatio
        ?? numberFrom(env.SINERGI_MAX_COMPRESSION_RATIO, 100),
      maxKmlSize: overrides.upload?.maxKmlSize
        ?? numberFrom(env.SINERGI_MAX_KML_BYTES, 50 * MEBIBYTE),
    },
    metadataAliases: overrides.metadataAliases
      ?? parseJsonObject(env.SINERGI_METADATA_ALIASES, DEFAULT_METADATA_ALIASES),
    sourceIdentityFallback: normalizeSourceIdentityFallback(
      overrides.sourceIdentityFallback ?? env.SINERGI_SOURCE_IDENTITY_FALLBACK,
    ),
    folderMappings: overrides.folderMappings
      ?? parseJsonArray(env.SINERGI_FOLDER_MAPPINGS, DEFAULT_FOLDER_MAPPINGS),
    relationMappings: overrides.relationMappings
      ?? parseJsonArray(env.SINERGI_RELATION_MAPPINGS, DEFAULT_RELATION_MAPPINGS),
    topology: {
      searchRadiusMeters: overrides.topology?.searchRadiusMeters
        ?? overrides.topology?.endpointToleranceMeters
        ?? numberFrom(
          env.SINERGI_TOPOLOGY_ENDPOINT_TOLERANCE_METERS,
          DEFAULT_RELATION_ENGINE_CONFIG.searchRadiusMeters,
        ),
      inlineSearchRadiusMeters: overrides.topology?.inlineSearchRadiusMeters
        ?? overrides.topology?.pointOnLineToleranceMeters
        ?? numberFrom(
          env.SINERGI_TOPOLOGY_POINT_LINE_TOLERANCE_METERS,
          DEFAULT_RELATION_ENGINE_CONFIG.inlineSearchRadiusMeters,
        ),
      intersectionToleranceMeters: overrides.topology?.intersectionToleranceMeters
        ?? numberFrom(
          env.SINERGI_TOPOLOGY_INTERSECTION_TOLERANCE_METERS,
          DEFAULT_RELATION_ENGINE_CONFIG.intersectionToleranceMeters,
        ),
      minimumInlineEndpointDistanceMeters:
        overrides.topology?.minimumInlineEndpointDistanceMeters
        ?? numberFrom(
          env.SINERGI_TOPOLOGY_MIN_INLINE_ENDPOINT_METERS,
          DEFAULT_RELATION_ENGINE_CONFIG.minimumInlineEndpointDistanceMeters,
        ),
      distanceSigmaMeters: overrides.topology?.distanceSigmaMeters
        ?? numberFrom(
          env.SINERGI_TOPOLOGY_DISTANCE_SIGMA_METERS,
          DEFAULT_RELATION_ENGINE_CONFIG.distanceSigmaMeters,
        ),
      acceptanceThreshold: overrides.topology?.acceptanceThreshold
        ?? unitNumberFrom(
          env.SINERGI_TOPOLOGY_ACCEPTANCE_THRESHOLD,
          DEFAULT_RELATION_ENGINE_CONFIG.acceptanceThreshold,
        ),
      ambiguityScoreMargin: overrides.topology?.ambiguityScoreMargin
        ?? unitNumberFrom(
          env.SINERGI_TOPOLOGY_AMBIGUITY_SCORE_MARGIN,
          DEFAULT_RELATION_ENGINE_CONFIG.ambiguityScoreMargin,
        ),
      autoConfirmSpatialInference: overrides.topology?.autoConfirmSpatialInference
        ?? booleanFrom(env.SINERGI_TOPOLOGY_AUTO_CONFIRM_SPATIAL, false),
      autoConfirmExplicitMetadata: overrides.topology?.autoConfirmExplicitMetadata
        ?? booleanFrom(env.SINERGI_TOPOLOGY_AUTO_CONFIRM_EXPLICIT, true),
      heldOutPrecision: overrides.topology?.heldOutPrecision
        ?? optionalUnitNumberFrom(env.SINERGI_TOPOLOGY_HELD_OUT_PRECISION),
      pathAccuracy: overrides.topology?.pathAccuracy
        ?? optionalUnitNumberFrom(env.SINERGI_TOPOLOGY_PATH_ACCURACY),
      maxCandidateCount: overrides.topology?.maxCandidateCount
        ?? numberFrom(
          env.SINERGI_TOPOLOGY_MAX_CANDIDATES,
          DEFAULT_RELATION_ENGINE_CONFIG.maxCandidateCount,
        ),
    },
    validation: {
      requireAssetName: overrides.validation?.requireAssetName
        ?? booleanFrom(env.SINERGI_REQUIRE_ASSET_NAME, false),
      requiredMetadataFields: overrides.validation?.requiredMetadataFields
        ?? splitList(env.SINERGI_REQUIRED_METADATA_FIELDS),
    },
    jobs: {
      concurrency: overrides.jobs?.concurrency
        ?? numberFrom(env.SINERGI_JOB_CONCURRENCY, 1),
      leaseMilliseconds: overrides.jobs?.leaseMilliseconds
        ?? numberFrom(env.SINERGI_JOB_LEASE_MS, 5 * 60 * 1000),
      lockStaleMilliseconds: overrides.jobs?.lockStaleMilliseconds
        ?? numberFrom(env.SINERGI_JOB_LOCK_STALE_MS, 5 * 60 * 1000),
      pollMilliseconds: overrides.jobs?.pollMilliseconds
        ?? numberFrom(env.SINERGI_JOB_POLL_MS, 100),
    },
  }
}

function normalizeSourceIdentityFallback(value) {
  return String(value ?? 'folder-path-name').trim().toLowerCase() === 'folder-path-name'
    ? 'folder-path-name'
    : 'none'
}

function normalizeStorageMode(value) {
  const normalized = String(value ?? 'json').trim().toLowerCase()
  if (normalized === 'json' || normalized === 'shadow' || normalized === 'postgres') {
    return normalized
  }
  throw new TypeError('SINERGI_STORAGE_MODE harus berupa json, shadow, atau postgres.')
}

function splitList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function numberFrom(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function unitNumberFrom(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback
}

function optionalUnitNumberFrom(value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null
}

function parseJsonObject(value, fallback) {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function parseJsonArray(value, fallback) {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function booleanFrom(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}
