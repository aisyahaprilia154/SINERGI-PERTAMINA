export function serializeActiveDatasetKml({
  activeContext,
  assets,
  assetIds = null,
}) {
  const includedIds = assetIds ? new Set(assetIds) : null
  const visibleAssets = (assets ?? []).filter((asset) => (
    asset?.id && (!includedIds || includedIds.has(asset.id))
  ))
  const placemarks = visibleAssets.flatMap((asset) => {
    const geometries = (asset.geometry ?? []).filter(hasGeometryCoordinates)
    if (!geometries.length) return []
    return [serializePlacemark(asset, geometries)]
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(activeContext?.version || 'Dataset aktif SINERGI')}</name>
    <description>${escapeXml(
      `Export read-only SINERGI untuk ${activeContext?.branchName || activeContext?.branchId || ''}.`,
    )}</description>
${placemarks.join('\n')}
  </Document>
</kml>
`
}

export function downloadActiveDatasetKml(options, filename) {
  const content = serializeActiveDatasetKml(options)
  downloadBlob(
    new Blob([content], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' }),
    safeKmlFilename(filename),
  )
}

export function collectSelectedNetworkAssetIds(networks, selectedNetworkIds) {
  const selected = new Set(selectedNetworkIds ?? [])
  return [...new Set((networks ?? [])
    .filter((network) => selected.has(network.id))
    .flatMap((network) => network.assetIds ?? network.nodeIds ?? []))]
}

function serializePlacemark(asset, geometries) {
  const geometryMarkup = geometries.length === 1
    ? serializeGeometry(geometries[0])
    : `<MultiGeometry>${geometries.map(serializeGeometry).join('')}</MultiGeometry>`
  return `    <Placemark>
      <name>${escapeXml(asset.name || asset.id)}</name>
      <ExtendedData>
        <Data name="asset_id"><value>${escapeXml(asset.id)}</value></Data>
        <Data name="asset_name"><value>${escapeXml(asset.name || asset.id)}</value></Data>
        <Data name="category"><value>${escapeXml(asset.category || '')}</value></Data>
        <Data name="asset_type"><value>${escapeXml(asset.type || '')}</value></Data>
        <Data name="location"><value>${escapeXml(asset.location || '')}</value></Data>
      </ExtendedData>
      ${geometryMarkup}
    </Placemark>`
}

function serializeGeometry(geometry) {
  if (geometry.geometryType === 'point') {
    return `<Point>${serializeAltitudeMode(geometry)}<coordinates>${
      serializePosition(geometry.coordinates)
    }</coordinates></Point>`
  }
  if (geometry.geometryType === 'line_string') {
    return `<LineString>${serializeAltitudeMode(geometry)}<coordinates>${
      serializePositions(geometry.coordinates)
    }</coordinates></LineString>`
  }
  if (geometry.geometryType === 'polygon') {
    const [outerRing, ...innerRings] = geometry.coordinates ?? []
    return `<Polygon>${serializeAltitudeMode(geometry)}${
      outerRing ? `<outerBoundaryIs><LinearRing><coordinates>${
        serializePositions(outerRing)
      }</coordinates></LinearRing></outerBoundaryIs>` : ''
    }${innerRings.map((ring) => (
      `<innerBoundaryIs><LinearRing><coordinates>${
        serializePositions(ring)
      }</coordinates></LinearRing></innerBoundaryIs>`
    )).join('')}</Polygon>`
  }
  if (geometry.geometryType === 'multi_geometry') {
    return `<MultiGeometry>${(geometry.coordinates ?? [])
      .map(serializeGeometry)
      .join('')}</MultiGeometry>`
  }
  return ''
}

function serializeAltitudeMode(geometry) {
  return geometry.altitudeMode
    ? `<altitudeMode>${escapeXml(geometry.altitudeMode)}</altitudeMode>`
    : ''
}

function serializePositions(positions) {
  return (positions ?? []).map(serializePosition).filter(Boolean).join(' ')
}

function serializePosition(position) {
  if (!Array.isArray(position) || position.length < 2) return ''
  return position
    .slice(0, 3)
    .map((coordinate) => String(coordinate))
    .join(',')
}

function hasGeometryCoordinates(geometry) {
  if (!geometry?.geometryType) return false
  if (geometry.geometryType === 'point') return serializePosition(geometry.coordinates) !== ''
  return Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0
}

function safeKmlFilename(filename) {
  const normalized = String(filename || 'sinergi-dataset.kml')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized.toLowerCase().endsWith('.kml') ? normalized : `${normalized}.kml`
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
