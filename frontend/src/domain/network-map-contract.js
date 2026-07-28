/**
 * Contract version for data consumed by the SINERGI network map.
 * The project uses JavaScript, so JSDoc and lightweight runtime guards are used
 * instead of TypeScript declarations.
 */
export const NETWORK_MAP_CONTRACT_VERSION = '1.0.0'

/**
 * GeoJSON-compatible geometry. `null` is retained as an explicit value when a
 * parser record has no geometry; validation reports it as a warning.
 *
 * @typedef {{
 *   type: string,
 *   coordinates?: unknown[],
 *   geometries?: MapGeometry[]
 * } | null} MapGeometry
 */

/**
 * @typedef {string | Record<string, unknown> | null} AssetLocation
 */

/**
 * @typedef {Object} AssetNode
 * @property {string} id
 * @property {string} assetId
 * @property {string} name
 * @property {string} category
 * @property {string} type
 * @property {string} branchId
 * @property {AssetLocation} location
 * @property {MapGeometry} geometry
 * @property {Record<string, unknown>} properties
 * @property {string | null} layerId
 * @property {string} datasetVersionId
 */

/**
 * @typedef {Object} AssetRelation
 * @property {string} id
 * @property {string} sourceAssetId References AssetNode.assetId.
 * @property {string} targetAssetId References AssetNode.assetId.
 * @property {string} relationType
 * @property {string=} pathAssetId
 * @property {string=} layerId
 * @property {Record<string, unknown>=} metadata
 */

/**
 * Bounds use GeoJSON order: [west, south, east, north].
 *
 * @typedef {Object} AssetNetwork
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {string[]} assetIds References AssetNode.assetId.
 * @property {string[]} relationIds
 * @property {[number, number, number, number]=} bounds
 * @property {string} colorToken
 * @property {boolean} isDefaultVisible
 */

/**
 * @typedef {Object} MapContext
 * @property {string} branchId
 * @property {string} datasetVersionId
 * @property {string} datasetVersionName
 * @property {string=} sourceFilename
 * @property {string[]} selectedNetworkIds
 * @property {string=} selectedAssetId
 * @property {string=} traceFrom
 * @property {string=} traceTo
 */

/**
 * @typedef {Object} NetworkMapData
 * @property {string} contractVersion
 * @property {MapContext} context
 * @property {AssetNode[]} assets
 * @property {AssetRelation[]} relations
 * @property {AssetNetwork[]} networks
 * @property {string[]} warnings
 */

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0
const isOptionalString = (value) => value === undefined || isNonEmptyString(value)
const isNullableString = (value) => value === null || isNonEmptyString(value)
const isStringArray = (value) => Array.isArray(value) && value.every(isNonEmptyString)

export function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isMapGeometry(value) {
  if (value === null) return true
  if (!isPlainRecord(value) || !isNonEmptyString(value.type)) return false
  if (value.type === 'GeometryCollection') {
    return Array.isArray(value.geometries) && value.geometries.every(isMapGeometry)
  }
  return Array.isArray(value.coordinates)
}

export function isAssetNode(value) {
  return isPlainRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.assetId)
    && isNonEmptyString(value.name)
    && isNonEmptyString(value.category)
    && isNonEmptyString(value.type)
    && isNonEmptyString(value.branchId)
    && (value.location === null || typeof value.location === 'string' || isPlainRecord(value.location))
    && isMapGeometry(value.geometry)
    && isPlainRecord(value.properties)
    && isNullableString(value.layerId)
    && isNonEmptyString(value.datasetVersionId)
}

export function isAssetRelation(value) {
  return isPlainRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.sourceAssetId)
    && isNonEmptyString(value.targetAssetId)
    && isNonEmptyString(value.relationType)
    && isOptionalString(value.pathAssetId)
    && isOptionalString(value.layerId)
    && (value.metadata === undefined || isPlainRecord(value.metadata))
}

export function isAssetNetwork(value) {
  const validBounds = value?.bounds === undefined
    || (Array.isArray(value.bounds) && value.bounds.length === 4 && value.bounds.every(Number.isFinite))

  return isPlainRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.name)
    && isNonEmptyString(value.category)
    && isStringArray(value.assetIds)
    && isStringArray(value.relationIds)
    && validBounds
    && isNonEmptyString(value.colorToken)
    && typeof value.isDefaultVisible === 'boolean'
}

export function isMapContext(value) {
  return isPlainRecord(value)
    && isNonEmptyString(value.branchId)
    && isNonEmptyString(value.datasetVersionId)
    && isNonEmptyString(value.datasetVersionName)
    && isOptionalString(value.sourceFilename)
    && isStringArray(value.selectedNetworkIds)
    && isOptionalString(value.selectedAssetId)
    && isOptionalString(value.traceFrom)
    && isOptionalString(value.traceTo)
}

/**
 * Validates both individual shapes and cross-references.
 *
 * @param {unknown} value
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateNetworkMapData(value) {
  const errors = []
  const warnings = []

  if (!isPlainRecord(value)) {
    return { valid: false, errors: ['NetworkMapData harus berupa object.'], warnings }
  }
  if (!isMapContext(value.context)) errors.push('MapContext tidak valid.')
  if (!Array.isArray(value.assets)) errors.push('assets harus berupa array.')
  if (!Array.isArray(value.relations)) errors.push('relations harus berupa array.')
  if (!Array.isArray(value.networks)) errors.push('networks harus berupa array.')
  if (errors.length) return { valid: false, errors, warnings }

  const nodeIds = new Set()
  const assetIds = new Set()
  const relationIds = new Set()
  const networkIds = new Set()

  value.assets.forEach((asset, index) => {
    if (!isAssetNode(asset)) {
      errors.push(`AssetNode pada index ${index} tidak valid.`)
      return
    }
    if (nodeIds.has(asset.id)) errors.push(`AssetNode id duplikat: ${asset.id}.`)
    if (assetIds.has(asset.assetId)) errors.push(`AssetNode assetId duplikat: ${asset.assetId}.`)
    nodeIds.add(asset.id)
    assetIds.add(asset.assetId)
    if (asset.branchId !== value.context.branchId) {
      errors.push(`Asset ${asset.id} berasal dari branch berbeda.`)
    }
    if (asset.datasetVersionId !== value.context.datasetVersionId) {
      errors.push(`Asset ${asset.id} berasal dari dataset version berbeda.`)
    }
    if (asset.geometry === null) warnings.push(`Asset ${asset.assetId} tidak memiliki geometry.`)
  })

  value.relations.forEach((relation, index) => {
    if (!isAssetRelation(relation)) {
      errors.push(`AssetRelation pada index ${index} tidak valid.`)
      return
    }
    if (relationIds.has(relation.id)) errors.push(`AssetRelation id duplikat: ${relation.id}.`)
    relationIds.add(relation.id)
    if (!assetIds.has(relation.sourceAssetId)) {
      errors.push(`Relation ${relation.id} memiliki sourceAssetId yang tidak dikenal.`)
    }
    if (!assetIds.has(relation.targetAssetId)) {
      errors.push(`Relation ${relation.id} memiliki targetAssetId yang tidak dikenal.`)
    }
    if (relation.pathAssetId && !assetIds.has(relation.pathAssetId)) {
      warnings.push(`Relation ${relation.id} memiliki pathAssetId yang tidak dikenal.`)
    }
  })

  value.networks.forEach((network, index) => {
    if (!isAssetNetwork(network)) {
      errors.push(`AssetNetwork pada index ${index} tidak valid.`)
      return
    }
    if (networkIds.has(network.id)) errors.push(`AssetNetwork id duplikat: ${network.id}.`)
    networkIds.add(network.id)
    network.assetIds.forEach((id) => {
      if (!assetIds.has(id)) errors.push(`Network ${network.id} merujuk asset yang tidak dikenal: ${id}.`)
    })
    network.relationIds.forEach((id) => {
      if (!relationIds.has(id)) errors.push(`Network ${network.id} merujuk relation yang tidak dikenal: ${id}.`)
    })
  })

  value.context.selectedNetworkIds.forEach((id) => {
    if (!networkIds.has(id)) warnings.push(`selectedNetworkIds memuat network yang tidak dikenal: ${id}.`)
  })
  for (const key of ['selectedAssetId', 'traceFrom', 'traceTo']) {
    const id = value.context[key]
    if (id && !assetIds.has(id)) warnings.push(`${key} merujuk asset yang tidak dikenal: ${id}.`)
  }

  return { valid: errors.length === 0, errors, warnings }
}
