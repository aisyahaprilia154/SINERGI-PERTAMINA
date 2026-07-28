/**
 * Contract boundary for normalized KML/KMZ import results.
 *
 * The repository uses JavaScript, therefore JSDoc and lightweight runtime
 * guards are used instead of TypeScript declarations.
 */
export const KML_IMPORT_CONTRACT_VERSION = '1.0.0'

export const DATASET_VERSION_STATUSES = Object.freeze([
  'processing',
  'draft',
  'valid',
  'invalid',
  'active',
  'archived',
])

export const VALIDATION_STATUSES = Object.freeze(['pending', 'valid', 'invalid'])
export const PUBLICATION_STATUSES = Object.freeze(['unpublished', 'published', 'archived'])
export const GEOMETRY_TYPES = Object.freeze(['point', 'line_string', 'polygon', 'multi_geometry'])
export const IMPORT_ISSUE_SEVERITIES = Object.freeze(['error', 'warning', 'information'])

/**
 * @typedef {Object} ImportSummary
 * @property {number} totalFolders
 * @property {number} totalPlacemarks
 * @property {number} totalAssets
 * @property {number} totalPoints
 * @property {number} totalLines
 * @property {number} totalPolygons
 * @property {number} totalRelations
 * @property {number} newAssets
 * @property {number} updatedAssets
 * @property {number} unchangedAssets
 * @property {number} removedAssets
 * @property {number} errors
 * @property {number} warnings
 */

/**
 * `sourceStorageKey` is optional while parsing, but must be populated by the
 * persistence layer before a version can be activated.
 *
 * @typedef {Object} DatasetVersion
 * @property {string} id
 * @property {string} datasetId
 * @property {string} branchId
 * @property {string} versionName
 * @property {string=} versionNote
 * @property {boolean=} officialSourceConfirmed
 * @property {string} sourceFilename
 * @property {string} sourceMimeType
 * @property {number} sourceSize
 * @property {string} checksum
 * @property {string=} sourceStorageKey
 * @property {string} importedBy
 * @property {string} importedAt
 * @property {string=} activatedBy
 * @property {string=} activatedAt
 * @property {'pending'|'valid'|'invalid'} validationStatus
 * @property {'unpublished'|'published'|'archived'} publicationStatus
 * @property {'processing'|'draft'|'valid'|'invalid'|'active'|'archived'} status
 * @property {ImportSummary} summary
 */

/**
 * @typedef {Object} AssetLayer
 * @property {string} id
 * @property {string} datasetVersionId
 * @property {string=} parentLayerId
 * @property {string} sourceFolderPath
 * @property {string} name
 * @property {string} category
 * @property {number} displayOrder
 * @property {boolean} defaultVisible
 * @property {string=} sourceStyleId
 */

/**
 * @typedef {Object} AssetNode
 * @property {string} id
 * @property {string} datasetVersionId
 * @property {string} layerId
 * @property {string} assetId
 * @property {string} name
 * @property {string} category
 * @property {string} type
 * @property {string} branchId
 * @property {string|Record<string, unknown>=} location
 * @property {Record<string, unknown>} properties
 * @property {string=} sourcePlacemarkId
 */

/**
 * `coordinates` is normalized for rendering and spatial operations, while
 * `sourceGeometry` preserves the parser representation without mutation.
 *
 * @typedef {Object} AssetGeometry
 * @property {string} id
 * @property {string} assetNodeId
 * @property {'point'|'line_string'|'polygon'|'multi_geometry'} geometryType
 * @property {unknown[]} coordinates
 * @property {string=} altitudeMode
 * @property {Record<string, unknown>} sourceGeometry
 * @property {[number, number, number, number]=} bounds
 */

/**
 * @typedef {Object} AssetRelation
 * @property {string} id
 * @property {string} datasetVersionId
 * @property {string} sourceAssetId
 * @property {string} targetAssetId
 * @property {string} relationType
 * @property {string=} pathAssetId
 * @property {string=} sourceMetadataKey
 * @property {Record<string, unknown>=} metadata
 */

/**
 * @typedef {Object} ImportIssue
 * @property {string} id
 * @property {string} datasetVersionId
 * @property {'error'|'warning'|'information'} severity
 * @property {string} issueCode
 * @property {string} message
 * @property {string=} sourceFolderPath
 * @property {string=} sourcePlacemarkName
 * @property {string=} assetId
 * @property {string=} geometryReference
 * @property {boolean} canActivate
 */

/**
 * @typedef {Object} KmlImportResult
 * @property {string} contractVersion
 * @property {DatasetVersion} datasetVersion
 * @property {AssetLayer[]} layers
 * @property {AssetNode[]} assets
 * @property {AssetGeometry[]} geometries
 * @property {AssetRelation[]} relations
 * @property {ImportIssue[]} issues
 */

const SUMMARY_FIELDS = [
  'totalFolders',
  'totalPlacemarks',
  'totalAssets',
  'totalPoints',
  'totalLines',
  'totalPolygons',
  'totalRelations',
  'newAssets',
  'updatedAssets',
  'unchangedAssets',
  'removedAssets',
  'errors',
  'warnings',
]

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0
const isOptionalString = (value) => value === undefined || isNonEmptyString(value)
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0

export function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isImportSummary(value) {
  return isPlainRecord(value)
    && SUMMARY_FIELDS.every((field) => isNonNegativeInteger(value[field]))
}

export function isDatasetVersion(value) {
  return isPlainRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.datasetId)
    && isNonEmptyString(value.branchId)
    && isNonEmptyString(value.versionName)
    && isOptionalString(value.versionNote)
    && (
      value.officialSourceConfirmed === undefined
      || typeof value.officialSourceConfirmed === 'boolean'
    )
    && isNonEmptyString(value.sourceFilename)
    && isNonEmptyString(value.sourceMimeType)
    && isNonNegativeInteger(value.sourceSize)
    && isNonEmptyString(value.checksum)
    && isOptionalString(value.sourceStorageKey)
    && isNonEmptyString(value.importedBy)
    && isNonEmptyString(value.importedAt)
    && isOptionalString(value.activatedBy)
    && isOptionalString(value.activatedAt)
    && VALIDATION_STATUSES.includes(value.validationStatus)
    && PUBLICATION_STATUSES.includes(value.publicationStatus)
    && DATASET_VERSION_STATUSES.includes(value.status)
    && isImportSummary(value.summary)
}

export function isAssetLayer(value) {
  return isPlainRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.datasetVersionId)
    && isOptionalString(value.parentLayerId)
    && isNonEmptyString(value.sourceFolderPath)
    && isNonEmptyString(value.name)
    && isNonEmptyString(value.category)
    && isNonNegativeInteger(value.displayOrder)
    && typeof value.defaultVisible === 'boolean'
    && isOptionalString(value.sourceStyleId)
}

export function isAssetNode(value) {
  return isPlainRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.datasetVersionId)
    && isNonEmptyString(value.layerId)
    && isNonEmptyString(value.assetId)
    && isNonEmptyString(value.name)
    && isNonEmptyString(value.category)
    && isNonEmptyString(value.type)
    && isNonEmptyString(value.branchId)
    && (
      value.location === undefined
      || typeof value.location === 'string'
      || isPlainRecord(value.location)
    )
    && isPlainRecord(value.properties)
    && isOptionalString(value.sourcePlacemarkId)
}

function isPosition(value) {
  return Array.isArray(value)
    && value.length >= 2
    && value.length <= 3
    && value.every(Number.isFinite)
    && value[0] >= -180
    && value[0] <= 180
    && value[1] >= -90
    && value[1] <= 90
}

function isLineCoordinates(value) {
  return Array.isArray(value) && value.length >= 2 && value.every(isPosition)
}

function isPolygonCoordinates(value) {
  return Array.isArray(value)
    && value.length >= 1
    && value.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isPosition))
}

function isMultiGeometryCoordinates(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((geometry) => (
      isPlainRecord(geometry)
      && GEOMETRY_TYPES.includes(geometry.geometryType)
      && geometry.geometryType !== 'multi_geometry'
      && isCoordinatesForType(geometry.geometryType, geometry.coordinates)
    ))
}

function isCoordinatesForType(geometryType, coordinates) {
  if (geometryType === 'point') return isPosition(coordinates)
  if (geometryType === 'line_string') return isLineCoordinates(coordinates)
  if (geometryType === 'polygon') return isPolygonCoordinates(coordinates)
  if (geometryType === 'multi_geometry') return isMultiGeometryCoordinates(coordinates)
  return false
}

export function isAssetGeometry(value) {
  const validBounds = value?.bounds === undefined
    || (
      Array.isArray(value.bounds)
      && value.bounds.length === 4
      && value.bounds.every(Number.isFinite)
    )

  return isPlainRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.assetNodeId)
    && GEOMETRY_TYPES.includes(value.geometryType)
    && isCoordinatesForType(value.geometryType, value.coordinates)
    && isOptionalString(value.altitudeMode)
    && isPlainRecord(value.sourceGeometry)
    && validBounds
}

export function isAssetRelation(value) {
  return isPlainRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.datasetVersionId)
    && isNonEmptyString(value.sourceAssetId)
    && isNonEmptyString(value.targetAssetId)
    && isNonEmptyString(value.relationType)
    && isOptionalString(value.pathAssetId)
    && isOptionalString(value.sourceMetadataKey)
    && (value.metadata === undefined || isPlainRecord(value.metadata))
}

export function isImportIssue(value) {
  return isPlainRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.datasetVersionId)
    && IMPORT_ISSUE_SEVERITIES.includes(value.severity)
    && isNonEmptyString(value.issueCode)
    && isNonEmptyString(value.message)
    && isOptionalString(value.sourceFolderPath)
    && isOptionalString(value.sourcePlacemarkName)
    && isOptionalString(value.assetId)
    && isOptionalString(value.geometryReference)
    && typeof value.canActivate === 'boolean'
}

/**
 * Validates record shapes, version isolation, hierarchy, and cross-references.
 *
 * @param {unknown} value
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateKmlImportResult(value) {
  const errors = []
  const warnings = []

  if (!isPlainRecord(value)) {
    return { valid: false, errors: ['KmlImportResult harus berupa object.'], warnings }
  }
  if (value.contractVersion !== KML_IMPORT_CONTRACT_VERSION) {
    errors.push('Versi contract hasil import tidak dikenal.')
  }
  if (!isDatasetVersion(value.datasetVersion)) errors.push('DatasetVersion tidak valid.')
  for (const collection of ['layers', 'assets', 'geometries', 'relations', 'issues']) {
    if (!Array.isArray(value[collection])) errors.push(`${collection} harus berupa array.`)
  }
  if (errors.length) return { valid: false, errors, warnings }

  const versionId = value.datasetVersion.id
  const branchId = value.datasetVersion.branchId
  const layerIds = new Set()
  const assetNodeIds = new Set()
  const assetIds = new Set()
  const geometryIds = new Set()
  const relationIds = new Set()
  const issueIds = new Set()
  const parentByLayerId = new Map()

  value.layers.forEach((layer, index) => {
    if (!isAssetLayer(layer)) {
      errors.push(`AssetLayer pada index ${index} tidak valid.`)
      return
    }
    if (layerIds.has(layer.id)) errors.push(`AssetLayer id duplikat: ${layer.id}.`)
    if (layer.datasetVersionId !== versionId) {
      errors.push(`AssetLayer ${layer.id} berasal dari dataset version berbeda.`)
    }
    layerIds.add(layer.id)
    parentByLayerId.set(layer.id, layer.parentLayerId)
  })

  value.layers.forEach((layer) => {
    if (layer.parentLayerId && !layerIds.has(layer.parentLayerId)) {
      errors.push(`AssetLayer ${layer.id} memiliki parentLayerId yang tidak dikenal.`)
    }
  })
  detectLayerCycles(parentByLayerId).forEach((layerId) => {
    errors.push(`Hierarchy AssetLayer mengandung cycle pada ${layerId}.`)
  })

  value.assets.forEach((asset, index) => {
    if (!isAssetNode(asset)) {
      errors.push(`AssetNode pada index ${index} tidak valid.`)
      return
    }
    if (assetNodeIds.has(asset.id)) errors.push(`AssetNode id duplikat: ${asset.id}.`)
    if (assetIds.has(asset.assetId)) errors.push(`Asset ID duplikat: ${asset.assetId}.`)
    if (asset.datasetVersionId !== versionId) {
      errors.push(`AssetNode ${asset.id} berasal dari dataset version berbeda.`)
    }
    if (asset.branchId !== branchId) {
      errors.push(`AssetNode ${asset.id} berasal dari branch berbeda.`)
    }
    if (!layerIds.has(asset.layerId)) {
      errors.push(`AssetNode ${asset.id} memiliki layerId yang tidak dikenal.`)
    }
    assetNodeIds.add(asset.id)
    assetIds.add(asset.assetId)
  })

  value.geometries.forEach((geometry, index) => {
    if (!isAssetGeometry(geometry)) {
      errors.push(`AssetGeometry pada index ${index} tidak valid.`)
      return
    }
    if (geometryIds.has(geometry.id)) errors.push(`AssetGeometry id duplikat: ${geometry.id}.`)
    if (!assetNodeIds.has(geometry.assetNodeId)) {
      errors.push(`AssetGeometry ${geometry.id} memiliki assetNodeId yang tidak dikenal.`)
    }
    geometryIds.add(geometry.id)
  })

  value.relations.forEach((relation, index) => {
    if (!isAssetRelation(relation)) {
      errors.push(`AssetRelation pada index ${index} tidak valid.`)
      return
    }
    if (relationIds.has(relation.id)) errors.push(`AssetRelation id duplikat: ${relation.id}.`)
    if (relation.datasetVersionId !== versionId) {
      errors.push(`AssetRelation ${relation.id} berasal dari dataset version berbeda.`)
    }
    if (!assetIds.has(relation.sourceAssetId)) {
      errors.push(`AssetRelation ${relation.id} memiliki sourceAssetId yang tidak dikenal.`)
    }
    if (!assetIds.has(relation.targetAssetId)) {
      errors.push(`AssetRelation ${relation.id} memiliki targetAssetId yang tidak dikenal.`)
    }
    if (relation.pathAssetId && !assetIds.has(relation.pathAssetId)) {
      errors.push(`AssetRelation ${relation.id} memiliki pathAssetId yang tidak dikenal.`)
    }
    relationIds.add(relation.id)
  })

  value.issues.forEach((issue, index) => {
    if (!isImportIssue(issue)) {
      errors.push(`ImportIssue pada index ${index} tidak valid.`)
      return
    }
    if (issueIds.has(issue.id)) errors.push(`ImportIssue id duplikat: ${issue.id}.`)
    if (issue.datasetVersionId !== versionId) {
      errors.push(`ImportIssue ${issue.id} berasal dari dataset version berbeda.`)
    }
    issueIds.add(issue.id)
  })

  const blockingIssues = value.issues.filter((issue) => issue.canActivate === false)
  if (value.datasetVersion.status === 'active' && blockingIssues.length) {
    errors.push('Dataset version aktif masih memiliki issue yang memblokir aktivasi.')
  }
  if (value.datasetVersion.status === 'active' && !value.datasetVersion.sourceStorageKey) {
    errors.push('Dataset version aktif wajib merujuk file sumber asli yang tersimpan.')
  }

  const actualErrors = value.issues.filter((issue) => issue.severity === 'error').length
  const actualWarnings = value.issues.filter((issue) => issue.severity === 'warning').length
  if (value.datasetVersion.summary.errors !== actualErrors) {
    errors.push('ImportSummary.errors tidak sesuai dengan jumlah ImportIssue error.')
  }
  if (value.datasetVersion.summary.warnings !== actualWarnings) {
    errors.push('ImportSummary.warnings tidak sesuai dengan jumlah ImportIssue warning.')
  }
  if (value.datasetVersion.summary.totalAssets !== value.assets.length) {
    errors.push('ImportSummary.totalAssets tidak sesuai dengan jumlah AssetNode.')
  }
  if (value.datasetVersion.summary.totalRelations !== value.relations.length) {
    errors.push('ImportSummary.totalRelations tidak sesuai dengan jumlah AssetRelation.')
  }

  return { valid: errors.length === 0, errors, warnings }
}

function detectLayerCycles(parentByLayerId) {
  const cycles = new Set()

  for (const layerId of parentByLayerId.keys()) {
    const path = new Set()
    let currentId = layerId
    while (currentId) {
      if (path.has(currentId)) {
        cycles.add(currentId)
        break
      }
      path.add(currentId)
      currentId = parentByLayerId.get(currentId)
    }
  }

  return cycles
}
