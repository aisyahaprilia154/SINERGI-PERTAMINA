import { geometryIntersectsGeographicBounds } from './geographic-bounds.js'
import {
  assetMarkerTitle,
  createLeafletAssetIcon,
  createLeafletAssetTooltip,
} from './leaflet-map-icons.js'
import {
  collectTraceGeographicPositions,
  collectTraceGeometryIds,
  collectGeographicPositions,
  expandLeafletGeometryParts,
  geometryToLeafletLatLngs,
  isNetworkVisible,
  leafletZoomTier,
  networkToLeafletBounds,
  positionsToLeafletBounds,
  toLeafletLatLng,
} from './leaflet-map-state.js'
import {
  calculateLeafletLabelVisibility,
  calculateLeafletMarkerLayout,
  isAssetVisibleAtZoom,
  isGeometryVisibleAtZoom,
  isLeafletCoreNode,
} from './leaflet-map-lod.js'

export function createLeafletLayerRegistry(leaflet, map, {
  assets,
  networks,
  geometries,
  topologyGraph = null,
  onSelectAsset,
  onSelectNetwork,
  config,
  colors,
}) {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  const geometriesById = new Map(geometries.map((geometry) => [geometry.id, geometry]))
  const geometriesBySourceId = groupBySourceGeometry(geometries)
  const networksById = new Map(networks.map((network) => [network.id, network]))
  const networkIdsByGeometryId = new Map()
  networks.forEach((network) => {
    ;(network.geometryIds ?? []).forEach((geometryId) => {
      networkIdsByGeometryId.set(geometryId, [
        ...(networkIdsByGeometryId.get(geometryId) ?? []),
        network.id,
      ])
    })
  })

  const pathRenderers = {
    polygon: leaflet.svg({ pane: 'sinergi-polygons', padding: 0.5 }),
    line: leaflet.svg({ pane: 'sinergi-lines', padding: 0.5 }),
    relation: leaflet.svg({ pane: 'sinergi-relations', padding: 0.5 }),
  }
  const markerRecords = new Map()
  const geometryRecords = []
  const relationRecords = []
  let highlightedNetworkId = null
  let state = {
    selectedNetworkIds: new Set(),
    selectedAssetId: null,
    traceNodeIds: [],
    traceRelationIds: [],
    traceGeometryIds: new Set(),
    connectedNodeIds: [],
    selectableAssetIds: null,
    dimOthers: true,
  }

  geometries.forEach((sourceGeometry) => {
    const networkIds = geometryNetworkIds(sourceGeometry, networkIdsByGeometryId)
    const network = networksById.get(networkIds[0])
    if (!network) return
    expandLeafletGeometryParts(sourceGeometry).forEach((geometry) => {
      const layer = createGeometryLayer(leaflet, geometry, {
        renderer: geometry.geometryType === 'polygon'
          ? pathRenderers.polygon
          : pathRenderers.line,
        pane: geometry.geometryType === 'polygon'
          ? 'sinergi-polygons'
          : 'sinergi-lines',
      })
      if (!layer) return
      const record = {
        sourceGeometry,
        geometry,
        layer,
        network,
        networkIds,
        visible: false,
      }
      layer.bindTooltip(createLeafletGeometryTooltip(sourceGeometry, network), {
        className: 'sinergi-leaflet-tooltip sinergi-leaflet-path-tooltip',
        direction: 'top',
        opacity: 1,
        sticky: true,
      })
      layer.on('click', () => {
        const selectedNetworkId = networkIds.find((id) => state.selectedNetworkIds.has(id))
          || networkIds[0]
        if (selectedNetworkId) onSelectNetwork(selectedNetworkId, {
          geometryId: sourceGeometry.id,
        })
      })
      layer.on('mouseover', () => {
        layer.setStyle(geometryStyle(record, state, highlightedNetworkId, {
          hovered: true,
          zoomTier: leafletZoomTier(map.getZoom(), config),
          traced: isTraceGeometry(record, state.traceGeometryIds),
          traceColor: colors.primary,
        }))
      })
      layer.on('mouseout', () => {
        layer.setStyle(geometryStyle(record, state, highlightedNetworkId, {
          zoomTier: leafletZoomTier(map.getZoom(), config),
          traced: isTraceGeometry(record, state.traceGeometryIds),
          traceColor: colors.primary,
        }))
      })
      geometryRecords.push(record)
    })
  })

  createRelationRecords({
    leaflet,
    pathRenderer: pathRenderers.relation,
    relations: collectTopologyRelations(topologyGraph, networks),
    networksById,
    assetsById,
    geometriesBySourceId,
  }).forEach((record) => {
    record.layer.on('click', () => onSelectNetwork(record.networkId))
    relationRecords.push(record)
  })

  assets.forEach((asset) => {
    const latLng = toLeafletLatLng(asset.coordinate)
    if (!latLng) return
    const marker = leaflet.marker(latLng, {
      keyboard: true,
      riseOnHover: true,
      pane: 'sinergi-markers',
      title: assetMarkerTitle(asset),
    })
    marker.bindTooltip(createLeafletAssetTooltip(asset), {
      className: 'sinergi-leaflet-tooltip',
      direction: 'top',
      opacity: 1,
      sticky: false,
    })
    marker.on('click', () => {
      if (state.selectableAssetIds && !state.selectableAssetIds.has(asset.id)) return
      onSelectAsset(asset.id)
    })
    markerRecords.set(asset.id, {
      asset,
      marker,
      networkIds: asset.networkIds?.length
        ? asset.networkIds
        : networks
          .filter((network) => network.nodeIds?.includes(asset.id))
          .map((network) => network.id),
      visible: false,
    })
  })

  const dataBounds = positionsToLeafletBounds(
    leaflet,
    collectGeographicPositions(assets, geometries),
  )

  function applyState() {
    const zoomTier = leafletZoomTier(map.getZoom(), config)
    geometryRecords.forEach((record) => {
      const networkVisible = isNetworkVisible(record.networkIds, {
        ...state,
        highlightedNetworkId,
      })
      const visible = networkVisible
        && isGeometryVisibleAtZoom(record.geometry, zoomTier)
      setLayerVisible(map, record.layer, visible)
      record.visible = visible
      if (visible) {
        record.layer.setStyle(geometryStyle(record, state, highlightedNetworkId, {
          zoomTier,
          traced: isTraceGeometry(record, state.traceGeometryIds),
          traceColor: colors.primary,
        }))
      }
    })

    relationRecords.forEach((record) => {
      const visible = relationVisible(record, state, highlightedNetworkId)
      setLayerVisible(map, record.layer, visible)
      record.visible = visible
      if (visible) {
        record.layer.setStyle(relationStyle(
          record,
          state,
          highlightedNetworkId,
          colors,
          zoomTier,
        ))
        if (record.traceEdge) record.layer.bringToFront()
      }
    })

    const visibleMarkerRecords = [...markerRecords.values()]
      .filter(({ asset, networkIds }) => (
        isNetworkVisible(networkIds, {
          ...state,
          highlightedNetworkId,
          assetId: asset.id,
        })
        && isAssetVisibleAtZoom(asset, zoomTier, state)
      ))
      .map((record) => ({
        ...record,
        point: map.latLngToContainerPoint(record.marker.getLatLng()),
      }))
    const markerLayout = calculateLeafletMarkerLayout(visibleMarkerRecords, {
      selectedAssetId: state.selectedAssetId,
      traceNodeIds: state.traceNodeIds,
      minimumDistance: zoomTier === 'high' ? 30 : 26,
    })
    const visibleLabelIds = calculateLeafletLabelVisibility(
      visibleMarkerRecords,
      markerLayout,
      {
        selectedAssetId: state.selectedAssetId,
        traceNodeIds: state.traceNodeIds,
        zoomTier,
      },
    )

    markerRecords.forEach((record) => {
      const { asset, marker, networkIds } = record
      const networkVisible = isNetworkVisible(networkIds, {
        ...state,
        highlightedNetworkId,
        assetId: asset.id,
      })
      const visible = networkVisible && isAssetVisibleAtZoom(asset, zoomTier, state)
      setLayerVisible(map, marker, visible)
      record.visible = visible
      if (!visible) return

      const selected = asset.id === state.selectedAssetId
      const traceIndex = state.traceNodeIds.indexOf(asset.id)
      const traceRole = traceIndex === 0
        ? 'start'
        : traceIndex === state.traceNodeIds.length - 1 && traceIndex > 0
          ? 'end'
          : null
      const connected = state.connectedNodeIds.includes(asset.id)
        || state.traceNodeIds.includes(asset.id)
      const muted = (state.traceNodeIds.length > 0 && !connected && !selected)
        || (!networkIds.some((id) => state.selectedNetworkIds.has(id))
          && highlightedNetworkId
          && !networkIds.includes(highlightedNetworkId)
          && !connected)
      const selectable = !state.selectableAssetIds || state.selectableAssetIds.has(asset.id)
      const network = networksById.get(
        networkIds.find((id) => id === highlightedNetworkId)
          || networkIds.find((id) => state.selectedNetworkIds.has(id))
          || networkIds[0],
      )
      marker.setIcon(createLeafletAssetIcon(leaflet, {
        asset,
        color: network?.color || colors.border,
        selected,
        connected,
        traceRole,
        muted,
        selectable,
        zoomTier,
        visualOffset: markerLayout.get(asset.id),
        showLabel: visibleLabelIds.has(asset.id),
        important: isLeafletCoreNode(asset),
        isolated: asset.relationCount === 0,
      }))
      marker.setOpacity(muted ? 0.28 : selectable ? 1 : 0.42)
      marker.setZIndexOffset(
        selected ? 1200 : traceRole ? 900 : isLeafletCoreNode(asset) ? 600 : 0,
      )
    })
  }

  function setState(next) {
    if (next.selectedNetworkIds) {
      state.selectedNetworkIds = new Set(next.selectedNetworkIds)
    }
    if ('selectedAssetId' in next) state.selectedAssetId = next.selectedAssetId
    if (next.traceNodeIds) state.traceNodeIds = [...next.traceNodeIds]
    if (next.traceRelationIds) state.traceRelationIds = [...next.traceRelationIds]
    if (next.connectedNodeIds) state.connectedNodeIds = [...next.connectedNodeIds]
    if ('selectableAssetIds' in next) {
      state.selectableAssetIds = next.selectableAssetIds
        ? new Set(next.selectableAssetIds)
        : null
    }
    if ('dimOthers' in next) state.dimOthers = Boolean(next.dimOthers)
    updateTraceEdgeFlags(
      relationRecords,
      state.traceNodeIds,
      state.traceRelationIds,
    )
    state.traceGeometryIds = collectTraceGeometryIds({
      topologyGraph,
      traceNodeIds: state.traceNodeIds,
      traceRelationIds: state.traceRelationIds,
    })
    applyState()
  }

  function setHighlightedNetworkId(networkId) {
    highlightedNetworkId = networksById.has(networkId) ? networkId : null
    applyState()
  }

  function getVisibleAssetIds(bounds) {
    if (!bounds?.isValid?.()) return []
    return [...markerRecords.values()]
      .filter((record) => record.visible && bounds.contains(record.marker.getLatLng()))
      .map(({ asset }) => asset.id)
      .sort()
  }

  function getVisibleGeometryIds(geographicBounds) {
    if (!geographicBounds) return []
    return [...new Set(geometryRecords
      .filter((record) => record.visible)
      .filter(({ geometry }) => (
        geometryIntersectsGeographicBounds(geometry.coordinates, geographicBounds)
      ))
      .map(({ sourceGeometry }) => sourceGeometry.id))]
      .sort()
  }

  function getNetworkBounds(networkId) {
    return networkToLeafletBounds(leaflet, networksById.get(networkId), {
      assetsById,
      geometriesById,
    })
  }

  function getAssetBounds(assetIds) {
    const positions = (assetIds ?? [])
      .map((assetId) => assetsById.get(assetId)?.coordinate)
      .filter(Boolean)
    return positionsToLeafletBounds(leaflet, positions)
  }

  function getTraceBounds({
    nodeIds = state.traceNodeIds,
    relationIds = state.traceRelationIds,
  } = {}) {
    return positionsToLeafletBounds(leaflet, collectTraceGeographicPositions({
      assets,
      geometries,
      topologyGraph,
      traceNodeIds: nodeIds,
      traceRelationIds: relationIds,
    }))
  }

  function getAssetLatLng(assetId) {
    return markerRecords.get(assetId)?.marker.getLatLng() ?? null
  }

  function destroy() {
    markerRecords.forEach(({ marker }) => {
      marker.off()
      marker.remove()
    })
    geometryRecords.forEach(({ layer }) => {
      layer.off()
      layer.remove()
    })
    relationRecords.forEach(({ layer }) => {
      layer.off()
      layer.remove()
    })
  }

  return {
    setState,
    setHighlightedNetworkId,
    refreshForZoom: applyState,
    refreshForViewport: applyState,
    getVisibleAssetIds,
    getVisibleGeometryIds,
    getNetworkBounds,
    getAssetBounds,
    getTraceBounds,
    getAssetLatLng,
    getDataBounds: () => dataBounds,
    destroy,
  }
}

function createGeometryLayer(leaflet, geometry, options) {
  const latLngs = geometryToLeafletLatLngs(geometry)
  if (!latLngs) return null
  if (geometry.geometryType === 'line_string' && latLngs.length >= 2) {
    return leaflet.polyline(latLngs, {
      ...options,
      interactive: true,
      bubblingMouseEvents: false,
    })
  }
  if (geometry.geometryType === 'polygon' && latLngs.length) {
    return leaflet.polygon(latLngs, {
      ...options,
      interactive: true,
      bubblingMouseEvents: false,
    })
  }
  return null
}

function geometryStyle(record, state, highlightedNetworkId, {
  hovered = false,
  zoomTier = 'medium',
  traced = false,
  traceColor = null,
} = {}) {
  const { geometry, network, networkIds } = record
  const selected = networkIds.some((id) => state.selectedNetworkIds.has(id))
  const emphasized = networkIds.includes(highlightedNetworkId) || hovered
  const tracing = state.traceNodeIds.length > 0
  const dimmed = tracing || (highlightedNetworkId && !emphasized) || (!selected && state.dimOthers)
  if (geometry.geometryType === 'polygon') {
    const fillOpacity = emphasized ? 0.16 : selected ? 0.09 : dimmed ? 0.025 : 0.05
    return {
      color: network.color,
      weight: emphasized ? 2.2 : selected ? 1.6 : 1,
      opacity: emphasized ? 0.9 : selected ? 0.72 : 0.32,
      fillColor: network.color,
      fillOpacity,
      fillRule: 'evenodd',
    }
  }
  const line = lineStyle(network.lineRole, zoomTier)
  const opacity = traced
    ? 1
    : emphasized ? 1
      : selected ? 0.94
        : dimmed ? (zoomTier === 'low' ? 0.07 : 0.16)
          : zoomTier === 'low' && line.role === 'minor' ? 0.12 : 0.34
  return {
    color: traced ? traceColor || network.color : network.color,
    weight: traced
      ? line.weight + 2.5
      : Math.max(1.25, line.weight + (emphasized ? 1.5 : selected ? 0 : -0.5)),
    opacity,
    dashArray: line.dashArray,
    lineCap: 'round',
    lineJoin: 'round',
  }
}

function lineStyle(role, zoomTier) {
  const tierAdjustment = zoomTier === 'low' ? -0.5 : zoomTier === 'high' ? 0.5 : 0
  if (role === 'fiber-backbone') {
    return { role: 'backbone', weight: 5.5 + tierAdjustment, dashArray: null }
  }
  if (role === 'fiber-distribution') {
    return { role: 'distribution', weight: 4 + tierAdjustment, dashArray: null }
  }
  if (role === 'cctv-cable') {
    return { role: 'distribution', weight: 3.5 + tierAdjustment, dashArray: null }
  }
  if (role === 'lan') {
    return { role: 'minor', weight: 2 + tierAdjustment, dashArray: '9 7' }
  }
  return { role: 'minor', weight: 2.5 + tierAdjustment, dashArray: null }
}

function createRelationRecords({
  leaflet,
  pathRenderer,
  relations,
  networksById,
  assetsById,
  geometriesBySourceId,
}) {
  const records = []
  const seen = new Set()
  relations.forEach((relation) => {
    const sourceAssetId = relation.sourceAssetId || relation.sourceNodeId
    const targetAssetId = relation.targetAssetId || relation.targetNodeId
    const key = relation.id || [
      sourceAssetId,
      targetAssetId,
      relation.relationType,
    ].sort().join('|')
    if (!sourceAssetId || !targetAssetId || seen.has(key)) return
    const source = assetsById.get(sourceAssetId)
    const target = assetsById.get(targetAssetId)
    if (!source || !target) return
    const network = networksById.get(relation.networkId)
      || [...networksById.values()].find(({ nodeIds = [] }) => (
        nodeIds.includes(sourceAssetId) && nodeIds.includes(targetAssetId)
      ))
    if (!network) return
    seen.add(key)

    const sourceGeometryIds = relation.sourceGeometryIds?.length
      ? relation.sourceGeometryIds
      : [
        relation.pathGeometryId,
        relation.sourceGeometryId,
      ].filter(Boolean)
    const pathGeometries = sourceGeometryIds.flatMap(
      (geometryId) => geometriesBySourceId.get(geometryId) ?? [],
    ).filter(({ geometryType }) => geometryType === 'line_string')
    const latLngs = pathGeometries.length
      ? pathGeometries
        .map(geometryToLeafletLatLngs)
        .filter((path) => path?.length >= 2)
      : [source.coordinate, target.coordinate].map(toLeafletLatLng).filter(Boolean)
    if (!latLngs.length) return

    const layer = leaflet.polyline(latLngs, {
      renderer: pathRenderer,
      pane: 'sinergi-relations',
      interactive: true,
      bubblingMouseEvents: false,
    })
    layer.bindTooltip(createLeafletRelationTooltip(relation, network), {
      className: 'sinergi-leaflet-tooltip sinergi-leaflet-path-tooltip',
      direction: 'top',
      opacity: 1,
      sticky: true,
    })
    records.push({
      relation,
      layer,
      networkId: relation.networkId || network.id,
      network,
      sourceAssetId,
      targetAssetId,
      hasPathGeometry: pathGeometries.length > 0,
      traceEdge: false,
      visible: false,
    })
  })
  return records
}

function relationVisible(record, state, highlightedNetworkId) {
  const active = state.selectedNetworkIds.has(record.networkId)
  const emphasized = record.networkId === highlightedNetworkId
  const touchesSelected = state.selectedAssetId
    && [record.sourceAssetId, record.targetAssetId].includes(state.selectedAssetId)
  return record.traceEdge
    || touchesSelected
    || emphasized
    || (active && !record.hasPathGeometry)
}

function relationStyle(record, state, highlightedNetworkId, colors, zoomTier) {
  const emphasized = record.networkId === highlightedNetworkId
  const touchesSelected = state.selectedAssetId
    && [record.sourceAssetId, record.targetAssetId].includes(state.selectedAssetId)
  return {
    color: record.traceEdge ? colors.primary : record.network.color,
    weight: record.traceEdge
      ? 4.5
      : emphasized || touchesSelected ? 2.6
        : zoomTier === 'low' ? 1.25 : 1.7,
    opacity: record.traceEdge ? 1 : emphasized || touchesSelected ? 0.78 : 0.38,
    dashArray: null,
    lineCap: 'round',
    lineJoin: 'round',
  }
}

function isTraceGeometry(record, traceGeometryIds) {
  return traceGeometryIds.has(record.geometry.id)
    || traceGeometryIds.has(record.geometry.sourceGeometryId)
    || traceGeometryIds.has(record.sourceGeometry.id)
    || traceGeometryIds.has(record.sourceGeometry.sourceGeometryId)
}

function updateTraceEdgeFlags(records, traceNodeIds, traceRelationIds = []) {
  const relationIds = new Set(traceRelationIds)
  const traceEdges = new Set(
    traceNodeIds.slice(1).map((assetId, index) => (
      [traceNodeIds[index], assetId].sort().join('|')
    )),
  )
  records.forEach((record) => {
    record.traceEdge = relationIds.has(record.relation.id)
      || traceEdges.has([record.sourceAssetId, record.targetAssetId].sort().join('|'))
  })
}

function groupBySourceGeometry(geometries) {
  const grouped = new Map()
  geometries.forEach((geometry) => {
    const sourceId = geometry.sourceGeometryId || geometry.id
    ;[geometry.id, sourceId].filter(Boolean).forEach((geometryId) => {
      const existing = grouped.get(geometryId) ?? []
      if (!existing.some(({ id }) => id === geometry.id)) {
        grouped.set(geometryId, [...existing, geometry])
      }
    })
  })
  return grouped
}

function setLayerVisible(map, layer, visible) {
  if (visible && !map.hasLayer(layer)) layer.addTo(map)
  if (!visible && map.hasLayer(layer)) layer.removeFrom(map)
}

function collectTopologyRelations(topologyGraph, networks) {
  if (Array.isArray(topologyGraph?.edges)) {
    return topologyGraph.edges.map((edge) => ({
      ...edge,
      sourceAssetId: edge.sourceAssetId || edge.sourceNodeId,
      targetAssetId: edge.targetAssetId || edge.targetNodeId,
    }))
  }
  return networks.flatMap((network) => (network.relations ?? []).map((relation) => ({
    ...relation,
    networkId: relation.networkId || network.id,
  })))
}

function geometryNetworkIds(geometry, networkIdsByGeometryId) {
  const candidates = [
    geometry.id,
    geometry.sourceGeometryId,
  ].filter(Boolean)
  return [...new Set(candidates.flatMap(
    (geometryId) => networkIdsByGeometryId.get(geometryId) ?? [],
  ))]
}

function createLeafletGeometryTooltip(geometry, network) {
  const type = {
    line_string: 'Jalur',
    polygon: 'Area',
    multi_geometry: 'MultiGeometry',
  }[geometry.geometryType] || 'Geometri'
  return `
    <strong>${escapeHtml(network.shortName || network.name)}</strong>
    <span>${escapeHtml(type)} geografis</span>
    <small>${escapeHtml(network.categoryLabel || network.type || 'Jaringan aset')}</small>
  `
}

function createLeafletRelationTooltip(relation, network) {
  const status = relation.relationStatus === 'admin_confirmed'
    ? 'Dikonfirmasi Administrator'
    : 'Relasi eksplisit terkonfirmasi'
  return `
    <strong>${escapeHtml(network.shortName || network.name)}</strong>
    <span>${escapeHtml(relation.relationType || 'Koneksi aset')}</span>
    <small>${escapeHtml(status)}</small>
  `
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export const leafletMapLayerInternals = {
  collectTopologyRelations,
  geometryNetworkIds,
  lineStyle,
}
