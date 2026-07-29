import {
  createZipArchive,
  sanitizeDownloadFilename,
} from '../../utils/zip-archive.js'

export function serializeActiveDatasetKml({
  activeContext,
  assets,
  layers = [],
  assetIds = null,
  relations = [],
  scopeLabel = 'Dataset aktif',
}) {
  assertSupportedContext(activeContext)
  const includedIds = assetIds ? new Set(assetIds) : null
  const visibleAssets = (assets ?? []).filter((asset) => (
    asset?.id
      && (!asset.datasetVersionId || asset.datasetVersionId === activeContext?.datasetVersionId)
      && (!activeContext?.siteScopeId || asset.siteScopeId === activeContext.siteScopeId)
      && (!includedIds || includedIds.has(asset.id))
  ))
  const exportedIds = new Set(visibleAssets.map(({ id }) => id))
  const relationsBySource = groupRelations(
    relations.filter((relation) => (
      exportedIds.has(relation.sourceNodeId || relation.sourceAssetId)
      && exportedIds.has(relation.targetNodeId || relation.targetAssetId)
    )),
  )
  const placemarks = visibleAssets.flatMap((asset) => {
    const geometries = (asset.geometry ?? []).filter(hasGeometryCoordinates)
    if (!geometries.length) return []
    return [{
      asset,
      markup: serializePlacemark(asset, geometries, relationsBySource.get(asset.id) ?? []),
    }]
  })
  const documentContent = serializeLayerHierarchy({
    layers,
    placemarks,
    activeContext,
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(activeContext?.version || 'Dataset aktif SINERGI')}</name>
    <description>${escapeXml(
      `${scopeLabel}. Export read-only SINERGI untuk site ${
        activeContext?.siteScopeName || activeContext?.branchName || activeContext?.branchId || ''
      } pada branch ${activeContext?.branchId || ''}.`,
    )}</description>
${documentContent}
  </Document>
</kml>
`
}

function assertSupportedContext(activeContext) {
  if (!activeContext?.siteScopeId) return
  if (activeContext.siteScopeId !== 'pengapon' || activeContext.branchId !== 'semarang') {
    throw new Error(
      'Contextual export prototype hanya tersedia untuk site Pengapon pada branch Semarang.',
    )
  }
  if (!String(activeContext.datasetVersionId ?? '').trim()) {
    throw new Error('Dataset version aktif tidak tersedia untuk contextual export.')
  }
}

export function createActiveDatasetExport(options, filename, format = 'kml') {
  const content = serializeActiveDatasetKml(options)
  const extension = format === 'kmz' ? '.kmz' : '.kml'
  const safeName = withExtension(filename, extension)
  if (format === 'kmz') {
    return {
      blob: new Blob([createZipArchive([{ name: 'doc.kml', data: content }])], {
        type: 'application/vnd.google-earth.kmz',
      }),
      filename: safeName,
      content,
    }
  }
  return {
    blob: new Blob([content], {
      type: 'application/vnd.google-earth.kml+xml;charset=utf-8',
    }),
    filename: safeName,
    content,
  }
}

export function downloadActiveDatasetKml(options, filename, format = 'kml') {
  const exported = createActiveDatasetExport(options, filename, format)
  downloadBlob(exported.blob, exported.filename)
}

export function collectSelectedNetworkAssetIds(networks, selectedNetworkIds) {
  const selected = new Set(selectedNetworkIds ?? [])
  return [...new Set((networks ?? [])
    .filter((network) => selected.has(network.id))
    .flatMap((network) => network.assetIds ?? network.nodeIds ?? []))]
}

export function collectVisibleLayerAssetIds(assets, visibleLayerIds) {
  const visible = new Set(visibleLayerIds ?? [])
  return (assets ?? [])
    .filter((asset) => visible.has(asset.layerId))
    .map(({ id }) => id)
}

export function collectFocusedAssetIds(topologyGraph, selectedAssetId, depth = 1) {
  if (!selectedAssetId) return []
  const maximumDepth = Math.max(1, Math.min(2, Number(depth) || 1))
  const virtualNodeIds = new Set((topologyGraph?.nodes ?? [])
    .filter((node) => node.isVirtual || String(node.id).startsWith('virtual-junction:'))
    .map(({ id }) => id))
  const adjacency = new Map()
  ;(topologyGraph?.edges ?? []).forEach((edge) => {
    const source = edge.sourceNodeId || edge.sourceAssetId
    const target = edge.targetNodeId || edge.targetAssetId
    if (!source || !target) return
    adjacency.set(source, [...(adjacency.get(source) ?? []), target])
    adjacency.set(target, [...(adjacency.get(target) ?? []), source])
  })
  const ids = new Set([selectedAssetId])
  const bestDepth = new Map([[selectedAssetId, 0]])
  const queue = [{ id: selectedAssetId, depth: 0 }]
  while (queue.length) {
    const current = queue.shift()
    if (current.depth >= maximumDepth) continue
    for (const neighborId of adjacency.get(current.id) ?? []) {
      const neighborDepth = current.depth + (virtualNodeIds.has(neighborId) ? 0 : 1)
      if (neighborDepth > maximumDepth) continue
      if ((bestDepth.get(neighborId) ?? Number.POSITIVE_INFINITY) <= neighborDepth) continue
      bestDepth.set(neighborId, neighborDepth)
      ids.add(neighborId)
      queue.push({ id: neighborId, depth: neighborDepth })
    }
  }
  return [...ids]
}

export function collectTraceAssetIds(tracePath) {
  return [...new Set(tracePath ?? [])]
}

export function createContextualExportFilename(
  activeContext,
  scope,
  exportedAt = new Date(),
) {
  const date = new Date(exportedAt)
  const dateToken = Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10)
  const site = activeContext?.siteScopeName
    || activeContext?.branchName
    || activeContext?.siteScopeId
    || 'Pengapon'
  const version = activeContext?.version || 'aktif'
  return sanitizeDownloadFilename(
    `SINERGI_${safeFilenameToken(site)}_${safeFilenameToken(scope)}_${
      safeFilenameToken(version)
    }_${dateToken}`,
    `SINERGI_Pengapon_Export_${dateToken}`,
  )
}

export function collectViewportAssetIds(
  assets,
  visibleAssetIds,
  visibleGeometryIds,
) {
  const nodeIds = new Set(visibleAssetIds ?? [])
  const geometryIds = new Set(visibleGeometryIds ?? [])
  return (assets ?? [])
    .filter((asset) => (
      nodeIds.has(asset.id)
      || (asset.geometry ?? []).some((geometry) => (
        geometryIds.has(geometry.id)
        || geometryIds.has(geometry.sourceGeometryId)
      ))
    ))
    .map(({ id }) => id)
}

function serializePlacemark(asset, geometries, relations) {
  const preservesSourceMultiGeometry = geometries.some((geometry) => (
    geometry.sourceGeometry?.type === 'MultiGeometry'
    || geometry.sourceGeometry?.geometryType === 'multi_geometry'
    || geometry.geometryType === 'multi_geometry'
  ))
  const geometryMarkup = geometries.length === 1 && !preservesSourceMultiGeometry
    ? serializeGeometry(geometries[0])
    : `<MultiGeometry>${geometries.map(serializeGeometry).join('')}</MultiGeometry>`
  const metadata = collectMetadata(asset, relations)
  return `    <Placemark${asset.sourcePlacemarkId ? ` id="${escapeXml(asset.sourcePlacemarkId)}"` : ''}>
      <name>${escapeXml(asset.sourceName || asset.name || asset.id)}</name>
      <visibility>${asset.sourceStatus === 'hidden' ? '0' : '1'}</visibility>
      <ExtendedData>
${metadata.map(([key, value]) => (
    `        <Data name="${escapeXml(key)}"><value>${escapeXml(value)}</value></Data>`
  )).join('\n')}
      </ExtendedData>
      ${geometryMarkup}
    </Placemark>`
}

function collectMetadata(asset, relations) {
  const semantic = asset.properties?.semanticMetadata?.values
    ?? asset.properties?.semanticMetadata
    ?? {}
  const extended = asset.properties?.extendedData ?? {}
  const entries = new Map()
  Object.entries({ ...extended, ...semantic }).forEach(([key, value]) => {
    if (value == null || typeof value === 'object') return
    if (/description/i.test(key)) value = stripMarkup(value)
    entries.set(key, value)
  })
  entries.set('asset_id', asset.assetId || asset.id)
  entries.set('asset_name', asset.sourceName || asset.name || asset.id)
  entries.set('category', asset.category || '')
  entries.set('asset_type', asset.type || '')
  entries.set('location', asset.location || '')
  if (asset.layerId) entries.set('sinergi_layer_id', asset.layerId)
  if (relations.length) {
    entries.set('connected_to', relations.map((relation) => (
      relation.targetNodeId || relation.targetAssetId
    )).join(','))
    entries.set('relation_type', relations.map((relation) => (
      relation.relationType || 'connected_to'
    )).join(','))
    entries.set('sinergi_relations', JSON.stringify(relations.map((relation) => ({
      source_asset_id: relation.sourceNodeId || relation.sourceAssetId,
      target_asset_id: relation.targetNodeId || relation.targetAssetId,
      relation_type: relation.relationType || 'connected_to',
      relation_source: relation.relationSource || 'explicit',
      ...(relation.sourceGeometryId ? { source_geometry_id: relation.sourceGeometryId } : {}),
      ...(relation.metadata ? { metadata: sanitizeMetadata(relation.metadata) } : {}),
    }))))
  }
  return [...entries]
}

function groupRelations(relations) {
  const grouped = new Map()
  relations.forEach((relation) => {
    const source = relation.sourceNodeId || relation.sourceAssetId
    grouped.set(source, [...(grouped.get(source) ?? []), relation])
  })
  return grouped
}

function serializeLayerHierarchy({ layers, placemarks, activeContext }) {
  const scopedLayers = (layers ?? []).filter((layer) => (
    layer?.id
    && (!activeContext?.siteScopeId || layer.siteScopeId === activeContext.siteScopeId)
  ))
  if (!scopedLayers.length) return placemarks.map(({ markup }) => markup).join('\n')

  const layerById = new Map(scopedLayers.map((layer) => [layer.id, layer]))
  const childrenByParent = new Map()
  scopedLayers.forEach((layer) => {
    const parentId = layerById.has(layer.parentLayerId) ? layer.parentLayerId : null
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), layer])
  })
  const placemarksByLayer = new Map()
  const unlayered = []
  placemarks.forEach((record) => {
    if (!layerById.has(record.asset.layerId)) {
      unlayered.push(record.markup)
      return
    }
    placemarksByLayer.set(record.asset.layerId, [
      ...(placemarksByLayer.get(record.asset.layerId) ?? []),
      record.markup,
    ])
  })

  const renderFolder = (layer, ancestors = new Set()) => {
    if (ancestors.has(layer.id)) return ''
    const nextAncestors = new Set([...ancestors, layer.id])
    const childMarkup = (childrenByParent.get(layer.id) ?? [])
      .map((child) => renderFolder(child, nextAncestors))
      .filter(Boolean)
    const ownPlacemarks = placemarksByLayer.get(layer.id) ?? []
    if (!ownPlacemarks.length && !childMarkup.length) return ''
    return `    <Folder>
      <name>${escapeXml(layer.name)}</name>
      <visibility>${layer.defaultVisible === false ? '0' : '1'}</visibility>
${[...ownPlacemarks, ...childMarkup].join('\n')}
    </Folder>`
  }
  const folders = (childrenByParent.get(null) ?? [])
    .map((layer) => renderFolder(layer))
    .filter(Boolean)
  return [...unlayered, ...folders].join('\n')
}

function serializeGeometry(geometry) {
  const geometryType = normalizedGeometryType(geometry)
  if (geometryType === 'point') {
    return `<Point>${serializeAltitudeMode(geometry)}<coordinates>${serializePosition(geometry.coordinates)}</coordinates></Point>`
  }
  if (geometryType === 'line_string') {
    return `<LineString>${serializeAltitudeMode(geometry)}<coordinates>${serializePositions(geometry.coordinates)}</coordinates></LineString>`
  }
  if (geometryType === 'polygon') {
    const [outerRing, ...innerRings] = geometry.coordinates ?? []
    return `<Polygon>${serializeAltitudeMode(geometry)}${
      outerRing ? `<outerBoundaryIs><LinearRing><coordinates>${serializePositions(outerRing)}</coordinates></LinearRing></outerBoundaryIs>` : ''
    }${innerRings.map((ring) => (
      `<innerBoundaryIs><LinearRing><coordinates>${serializePositions(ring)}</coordinates></LinearRing></innerBoundaryIs>`
    )).join('')}</Polygon>`
  }
  if (geometryType === 'multi_geometry') {
    return `<MultiGeometry>${(geometry.coordinates ?? []).map(serializeGeometry).join('')}</MultiGeometry>`
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
  return position.slice(0, 3).map((coordinate) => String(coordinate)).join(',')
}

function hasGeometryCoordinates(geometry) {
  const geometryType = normalizedGeometryType(geometry)
  if (!geometryType) return false
  if (geometryType === 'point') return serializePosition(geometry.coordinates) !== ''
  return Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0
}

function normalizedGeometryType(geometry) {
  const value = geometry?.geometryType || geometry?.type
  return {
    Point: 'point',
    LineString: 'line_string',
    Polygon: 'polygon',
    MultiGeometry: 'multi_geometry',
  }[value] || value
}

function withExtension(filename, extension) {
  const base = sanitizeDownloadFilename(filename || 'sinergi-dataset')
    .replace(/\.(kml|kmz)$/i, '')
  return `${base}${extension}`
}

function stripMarkup(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeMetadata(value) {
  if (Array.isArray(value)) return value.map(sanitizeMetadata)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => (
      [key, /description/i.test(key) ? stripMarkup(item) : sanitizeMetadata(item)]
    )))
  }
  return typeof value === 'string' ? value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') : value
}

function safeFilenameToken(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'Export'
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
