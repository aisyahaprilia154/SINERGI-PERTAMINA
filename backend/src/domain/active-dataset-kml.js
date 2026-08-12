const KML_NAMESPACE = 'http://www.opengis.net/kml/2.2'

export function serializeActiveDatasetKml({
  datasetVersion = {},
  activePointer = {},
  items = [],
  filter = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const placemarks = items.flatMap((item) => item.geometries
    .filter((geometry) => geometry.valid)
    .map((geometry) => serializePlacemark(item, geometry)))
  const metadata = [
    ['dataset_version_id', datasetVersion.id],
    ['dataset_version_name', datasetVersion.versionName],
    ['dataset_id', datasetVersion.datasetId],
    ['branch_id', datasetVersion.branchId],
    ['publication_profile', datasetVersion.publicationProfile ?? 'map_only'],
    ['active_pointer_revision', activePointer.revision],
    ['generated_at', generatedAt],
    ['filter', JSON.stringify(filter)],
  ]
    .map(([name, value]) => `<Data name="${escapeXml(name)}"><value>${escapeXml(value)}</value></Data>`)
    .join('')
  const name = `SINERGI ${datasetVersion.versionName ?? datasetVersion.id ?? 'active dataset'}`
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<kml xmlns="${KML_NAMESPACE}"><Document>`,
    `<name>${escapeXml(name)}</name>`,
    `<ExtendedData>${metadata}</ExtendedData>`,
    placemarks.join(''),
    '</Document></kml>',
  ].join('')
}

export function safeActiveKmlFilename({ datasetVersion = {}, siteId = null } = {}) {
  const base = [
    'sinergi',
    datasetVersion.datasetId,
    datasetVersion.versionName ?? datasetVersion.id,
    siteId,
    'active',
  ].filter(Boolean).join('-')
  const normalized = String(base)
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 120)
  return `${normalized || 'sinergi-active-dataset'}.kml`
}

function serializePlacemark(item, geometry) {
  const data = [
    ['asset_id', item.assetId],
    ['stable_asset_id', item.stableAssetId],
    ['canonical_asset_id', item.canonicalAssetId],
    ['asset_name', item.name],
    ['category', item.category],
    ['asset_type', item.assetType],
    ['network_family', item.networkFamily],
    ['site_id', item.siteId],
    ['source_status', item.sourceStatus],
    ['source_feature_id', item.sourceFeatureId],
  ].map(([name, value]) => (
    `<Data name="${escapeXml(name)}"><value>${escapeXml(value)}</value></Data>`
  )).join('')
  return [
    '<Placemark>',
    `<name>${escapeXml(item.name ?? item.assetId)}</name>`,
    `<ExtendedData>${data}</ExtendedData>`,
    serializeGeometry(geometry),
    '</Placemark>',
  ].join('')
}

function serializeGeometry(geometry) {
  const altitudeMode = geometry.altitudeMode
    ? `<altitudeMode>${escapeXml(geometry.altitudeMode)}</altitudeMode>`
    : ''
  if (geometry.geometryType === 'point') {
    return `<Point>${altitudeMode}<coordinates>${coordinate(geometry.coordinates)}</coordinates></Point>`
  }
  if (geometry.geometryType === 'line_string') {
    return `<LineString>${altitudeMode}<coordinates>${coordinates(geometry.coordinates)}</coordinates></LineString>`
  }
  if (geometry.geometryType === 'polygon') {
    const [outer, ...inner] = geometry.coordinates ?? []
    return [
      '<Polygon>',
      altitudeMode,
      `<outerBoundaryIs><LinearRing><coordinates>${coordinates(outer)}</coordinates></LinearRing></outerBoundaryIs>`,
      inner.map((ring) => (
        `<innerBoundaryIs><LinearRing><coordinates>${coordinates(ring)}</coordinates></LinearRing></innerBoundaryIs>`
      )).join(''),
      '</Polygon>',
    ].join('')
  }
  if (geometry.geometryType === 'multi_geometry') {
    const parts = Array.isArray(geometry.coordinates)
      ? geometry.coordinates
      : []
    return `<MultiGeometry>${parts.map((part) => {
      const child = part && typeof part === 'object' && !Array.isArray(part)
        ? part
        : { coordinates: part }
      return serializeGeometry({
        ...geometry,
        ...child,
        geometryType: child.geometryType ?? inferGeometryType(child.coordinates),
        coordinates: child.coordinates,
      })
    }).join('')}</MultiGeometry>`
  }
  return ''
}

function inferGeometryType(coordinates) {
  if (isPosition(coordinates)) return 'point'
  if (Array.isArray(coordinates) && coordinates.every(isPosition)) return 'line_string'
  if (Array.isArray(coordinates) && coordinates.every((ring) => (
    Array.isArray(ring) && ring.every(isPosition)
  ))) return 'polygon'
  return 'line_string'
}

function coordinates(values) {
  return (Array.isArray(values) ? values : [])
    .filter(isPosition)
    .map(coordinate)
    .join(' ')
}

function coordinate(value) {
  if (!isPosition(value)) return ''
  const [longitude, latitude, altitude] = value
  return [longitude, latitude, altitude].filter((item) => item !== undefined).join(',')
}

function isPosition(value) {
  return Array.isArray(value) && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]))
    && Number(value[0]) >= -180 && Number(value[0]) <= 180
    && Number(value[1]) >= -90 && Number(value[1]) <= 90
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u001f\u007f]/g, '')
}
