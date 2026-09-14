import { createHash } from 'node:crypto'

export const TOPOLOGY_ROOT_ASSIGNMENT_SCHEMA_VERSION = '1.0.0'
export const TOPOLOGY_PRESENTATION_SCHEMA_VERSION = '2.0.0'

export function applyTopologyRootAssignments(bundle = {}, overrides = []) {
  const sourceNodes = asArray(bundle.classifiedNodes)
  const normalizedOverrides = normalizeRootOverrides(overrides, sourceNodes)
  const overrideByAssetId = new Map(normalizedOverrides
    .filter(({ status }) => status !== 'stale')
    .map((item) => [item.assetId, item]))

  const classifiedNodes = sourceNodes.map((sourceNode) => {
    const node = restoreRootBaseSemantics(sourceNode)
    const assetId = nodeId(node)
    const override = overrideByAssetId.get(assetId)
    const automatic = automaticRootDecision(node)
    const promoted = override?.action === 'promote'
    const demoted = override?.action === 'demote'
    const root = promoted || (!demoted && automatic.root)
    if (!root) {
      if (!demoted) return structuredClone(node)
      return {
        ...structuredClone(node),
        rootBaseTopologyRole: node.topologyRole ?? 'unknown',
        rootBaseDiagramClass: node.diagramClass ?? null,
        rootBaseJbProfileId: node.jbProfileId ?? null,
        topologyRole: junctionLike(node) ? 'junction' : 'endpoint',
        diagramClass: junctionLike(node)
          ? (String(node.diagramClass ?? '').includes('extended')
            ? 'junction-extended'
            : 'junction-peer')
          : 'endpoint',
        rootZoneKey: null,
        topologyAliases: [],
        rootAssignmentSource: 'manual_admin',
        rootAssignmentConfidence: 1,
      }
    }
    const zoneKey = normalizeZoneKey(override?.zoneKey ?? inferRootZone(node))
    const aliases = unique([
      ...inferRootAliases(node, zoneKey),
      ...asArray(override?.aliases).map(normalizeAlias),
    ].filter(Boolean))
    return {
      ...structuredClone(node),
      rootBaseTopologyRole: node.topologyRole ?? 'unknown',
      rootBaseDiagramClass: node.diagramClass ?? null,
      rootBaseJbProfileId: node.jbProfileId ?? null,
      topologyRole: 'root',
      diagramClass: 'rack-root',
      rootZoneKey: zoneKey,
      topologyAliases: aliases,
      rootAssignmentSource: override ? 'manual_admin' : automatic.source,
      rootAssignmentConfidence: override ? 1 : automatic.confidence,
      // A JB Server remains a physical junction_box asset, while the logical
      // hub profile supplies one deterministic proxy port per labelled path.
      jbProfileId: 'builtin:server_rack',
    }
  })

  const rootAssignments = classifiedNodes
    .filter(({ topologyRole }) => topologyRole === 'root')
    .map((node) => ({
      assetId: nodeId(node),
      stableAssetId: node.stableAssetId ?? null,
      areaKey: areaKeyFor(node),
      areaName: areaNameFor(node),
      zoneKey: node.rootZoneKey ?? 'utama',
      aliases: structuredClone(node.topologyAliases ?? []),
      source: node.rootAssignmentSource ?? 'automatic',
      confidence: node.rootAssignmentConfidence ?? 0,
      sourceName: node.sourceName ?? null,
    }))
    .sort(compareAssignments)

  return {
    ...structuredClone(bundle),
    classifiedNodes,
    topologyRootOverrides: normalizedOverrides,
    rootAssignments,
    rootAssignmentSchemaVersion: TOPOLOGY_ROOT_ASSIGNMENT_SCHEMA_VERSION,
  }
}

export function normalizeRootOverrides(overrides = [], nodes = []) {
  const aliases = new Map()
  asArray(nodes).forEach((node) => {
    const id = nodeId(node)
    if (!id) return
    for (const value of nodeIdentityAliases(node)) aliases.set(String(value), id)
  })
  return asArray(overrides).map((item) => {
    const requested = String(item?.assetId ?? item?.stableAssetId ?? '').trim()
    const assetId = aliases.get(requested) ?? requested
    const node = asArray(nodes).find((candidate) => nodeId(candidate) === assetId)
    return {
      ...structuredClone(item),
      assetId,
      stableAssetId: node?.stableAssetId ?? item?.stableAssetId ?? null,
      action: item?.action === 'demote' ? 'demote' : 'promote',
      zoneKey: item?.zoneKey ? normalizeZoneKey(item.zoneKey) : null,
      aliases: unique(asArray(item?.aliases).map(normalizeAlias).filter(Boolean)),
      status: node ? (item?.status === 'inherited' ? 'inherited' : 'active') : 'stale',
    }
  }).filter(({ assetId }) => Boolean(assetId))
}

export function inheritTopologyRootOverrides(previousRecord = {}, nextBundle = {}) {
  const previousNodes = asArray(previousRecord.topologyInputBundle?.classifiedNodes)
  const nextNodes = asArray(nextBundle.classifiedNodes)
  const nextByStableId = new Map(nextNodes
    .filter(({ stableAssetId }) => Boolean(stableAssetId))
    .map((node) => [String(node.stableAssetId), node]))
  const previousById = new Map(previousNodes.map((node) => [nodeId(node), node]))
  const inherited = []
  const reviewItems = []
  asArray(previousRecord.topologyRootOverrides).forEach((override) => {
    const previous = previousById.get(String(override.assetId ?? ''))
    const stableAssetId = override.stableAssetId ?? previous?.stableAssetId ?? null
    const next = stableAssetId ? nextByStableId.get(String(stableAssetId)) : null
    if (!next) {
      reviewItems.push({
        ...structuredClone(override),
        stableAssetId,
        status: 'stale',
        reasonCode: 'stable_asset_not_found_in_new_version',
      })
      return
    }
    inherited.push({
      ...structuredClone(override),
      assetId: nodeId(next),
      stableAssetId,
      status: 'inherited',
    })
  })
  return { overrides: inherited, reviewItems }
}

export function buildTopologyPresentation(bundle = {}, graph = {}) {
  const resolvedBundle = bundle.rootAssignments
    ? bundle
    : applyTopologyRootAssignments(bundle, bundle.topologyRootOverrides)
  const sourceNodes = asArray(resolvedBundle.classifiedNodes)
  const sourceById = new Map(sourceNodes.map((node) => [nodeId(node), node]))
  const graphById = new Map(asArray(graph.nodes).map((node) => [nodeId(node), node]))
  const nodes = sourceNodes.map((node) => ({
    ...structuredClone(node),
    ...structuredClone(graphById.get(nodeId(node)) ?? {}),
    id: nodeId(node),
    sourceName: node.sourceName ?? graphById.get(nodeId(node))?.sourceName ?? null,
    sourceFolderPath: node.sourceFolderPath
      ?? graphById.get(nodeId(node))?.sourceFolderPath
      ?? null,
    topologyRole: node.topologyRole,
    diagramClass: node.diagramClass,
    rootZoneKey: node.rootZoneKey ?? null,
    topologyAliases: structuredClone(node.topologyAliases ?? []),
  })).filter(({ id }) => Boolean(id))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edges = asArray(graph.edges).filter((edge) => (
    nodeById.has(edgeSource(edge)) && nodeById.has(edgeTarget(edge))
  ))
  const adjacency = new Map(nodes.map(({ id }) => [id, new Set()]))
  edges.forEach((edge) => {
    const sourceId = edgeSource(edge)
    const targetId = edgeTarget(edge)
    adjacency.get(sourceId)?.add(targetId)
    adjacency.get(targetId)?.add(sourceId)
  })
  const roots = nodes.filter((node) => node.topologyRole === 'root')
  const rootsByArea = groupBy(roots, areaKeyFor)
  const components = connectedComponents(nodes, adjacency)
  const componentByNodeId = new Map()
  components.forEach((component) => component.forEach((id) => componentByNodeId.set(id, component)))
  const pathHints = presentationPathHints(resolvedBundle, nodes)
  const rootForComponent = new Map()
  components.forEach((component) => {
    const members = component.map((id) => nodeById.get(id)).filter(Boolean)
    const areaKey = areaKeyFor(members[0])
    const areaRoots = rootsByArea.get(areaKey) ?? []
    const connectedRoots = members.filter(({ topologyRole }) => topologyRole === 'root')
    const candidates = connectedRoots.length ? connectedRoots : areaRoots
    if (!candidates.length) return
    const hinted = candidates
      .map((root) => ({ root, score: pathHintScore(root, members, pathHints) }))
      .sort((left, right) => right.score - left.score || compareRootNodes(left.root, right.root))
    const selected = hinted[0]?.score > 0
      ? hinted[0].root
      : [...candidates].sort((left, right) => (
        componentDistance(left, members, resolvedBundle)
          - componentDistance(right, members, resolvedBundle)
        || compareRootNodes(left, right)
      ))[0]
    rootForComponent.set(component, selected)
  })

  const unmappedAssetIds = []
  const hierarchy = []
  const backboneGaps = []
  components.forEach((component) => {
    const members = component.map((id) => nodeById.get(id)).filter(Boolean)
    const selectedRoot = rootForComponent.get(component) ?? null
    const containsRoot = Boolean(selectedRoot && component.includes(selectedRoot.id))
    const junctions = members.filter(junctionLike).sort(comparePresentationEntry)
    const endpointOnly = !containsRoot && junctions.length === 0
    if (endpointOnly) {
      members.forEach((node) => {
        unmappedAssetIds.push(node.id)
        hierarchy.push(presentationNode(node.id, null, null, 'unmapped', 'no_confirmed_parent'))
      })
      return
    }
    const entry = !containsRoot ? junctions[0] ?? null : null
    if (selectedRoot && entry) {
      backboneGaps.push({
        id: `backbone-gap:${selectedRoot.id}:${entry.id}`,
        sourceAssetId: selectedRoot.id,
        targetAssetId: entry.id,
        areaKey: areaKeyFor(entry),
        rootZoneKey: selectedRoot.rootZoneKey ?? 'utama',
        verificationStatus: 'unconfirmed',
        relationStatus: 'backbone_unconfirmed',
        reasonCode: 'component_without_confirmed_root_path',
      })
    }
    members.forEach((node) => {
      if (node.topologyRole === 'root') {
        hierarchy.push(presentationNode(
          node.id, node.id, null, 'root', 'verified_root', node.rootZoneKey,
        ))
        return
      }
      hierarchy.push(presentationNode(
        node.id,
        selectedRoot?.id ?? null,
        entry?.id === node.id ? selectedRoot?.id ?? null : null,
        containsRoot ? 'confirmed_component' : 'backbone_unconfirmed',
        containsRoot ? 'confirmed_root_path' : 'component_without_confirmed_root_path',
        selectedRoot?.rootZoneKey,
      ))
    })
  })
  const rootItems = roots.map((root) => ({
    assetId: root.id,
    stableAssetId: sourceById.get(root.id)?.stableAssetId ?? null,
    areaKey: areaKeyFor(root),
    areaName: areaNameFor(root),
    zoneKey: root.rootZoneKey ?? 'utama',
    aliases: structuredClone(root.topologyAliases ?? []),
    source: root.rootAssignmentSource ?? 'automatic',
    confidence: root.rootAssignmentConfidence ?? 0,
    sourceName: root.sourceName ?? null,
  })).sort(compareAssignments)
  const content = {
    schemaVersion: TOPOLOGY_PRESENTATION_SCHEMA_VERSION,
    graphRevision: graph.graphRevision ?? null,
    roots: rootItems,
    nodes: hierarchy.sort((left, right) => left.assetId.localeCompare(right.assetId)),
    backboneGaps: backboneGaps.sort((left, right) => left.id.localeCompare(right.id)),
    unmappedAssetIds: unique(unmappedAssetIds).sort(),
  }
  return {
    ...content,
    presentationRevision: `topology-presentation:${createHash('sha256')
      .update(JSON.stringify(content))
      .digest('hex')}`,
  }
}

export function overlayTopologyPresentation(graph = {}, presentation = {}) {
  const presentationById = new Map(asArray(presentation.nodes)
    .map((item) => [item.assetId, item]))
  return {
    ...structuredClone(graph),
    nodes: asArray(graph.nodes).map((node) => {
      const item = presentationById.get(nodeId(node))
      return item ? { ...structuredClone(node), ...structuredClone(item) } : structuredClone(node)
    }),
    presentationHierarchy: {
      schemaVersion: presentation.schemaVersion ?? TOPOLOGY_PRESENTATION_SCHEMA_VERSION,
      nodes: structuredClone(presentation.nodes ?? []),
    },
  }
}

export function rootAssignmentCandidates(bundle = {}, overrides = []) {
  const resolved = applyTopologyRootAssignments(bundle, overrides)
  const overrideById = new Map(asArray(resolved.topologyRootOverrides)
    .map((item) => [item.assetId, item]))
  return asArray(resolved.classifiedNodes)
    .filter((node) => node.objectRole === 'device_node' && (
      node.topologyRole === 'root' || junctionLike(node) || serverLike(node)
    ))
    .map((node) => ({
      assetId: nodeId(node),
      stableAssetId: node.stableAssetId ?? null,
      sourceName: node.sourceName ?? null,
      areaKey: areaKeyFor(node),
      areaName: areaNameFor(node),
      topologyRole: node.topologyRole,
      diagramClass: node.diagramClass ?? null,
      rootZoneKey: node.rootZoneKey ?? null,
      aliases: structuredClone(node.topologyAliases ?? []),
      assignmentSource: node.rootAssignmentSource ?? null,
      assignmentConfidence: node.rootAssignmentConfidence ?? 0,
      override: structuredClone(overrideById.get(nodeId(node)) ?? null),
      evidence: structuredClone(node.classificationEvidence ?? []),
    }))
    .sort((left, right) => left.areaName.localeCompare(right.areaName, 'id')
      || Number(right.topologyRole === 'root') - Number(left.topologyRole === 'root')
      || String(left.sourceName).localeCompare(String(right.sourceName), 'id'))
}

export function areaKeyFor(value = {}) {
  if (value.locationGroupKey) return String(value.locationGroupKey)
  const name = areaNameFor(value)
  return slug(name || 'lainnya') || 'lainnya'
}

export function areaNameFor(value = {}) {
  if (value.locationGroupName) return String(value.locationGroupName)
  const segments = String(value.sourceFolderPath ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean)
  const index = segments.findIndex((item) => item.toUpperCase() === 'RJBT')
  return index >= 0 ? segments[index + 1] ?? 'Lainnya' : 'Lainnya'
}

function automaticRootDecision(node) {
  const explicit = node.topologyRole === 'root'
  if (explicit) return { root: true, source: node.classificationSource ?? 'explicit_metadata', confidence: 1 }
  if (node.diagramClass === 'rack-root'
    || normalize(node.canonicalAssetType ?? node.assetType) === 'server rack'
    || normalize(node.category) === 'server rack'
    || normalize(node.jbProfileId).includes('server rack')) {
    return { root: true, source: 'canonical_server_rack', confidence: 0.98 }
  }
  if (strictRootName(node.sourceName)) {
    return { root: true, source: 'strict_name', confidence: 0.9 }
  }
  return { root: false, source: null, confidence: 0 }
}

function restoreRootBaseSemantics(node) {
  if (node?.rootAssignmentSource !== 'manual_admin'
    || node.rootBaseTopologyRole === undefined) return structuredClone(node)
  const restored = {
    ...structuredClone(node),
    topologyRole: node.rootBaseTopologyRole,
    diagramClass: node.rootBaseDiagramClass ?? null,
    jbProfileId: node.rootBaseJbProfileId ?? null,
    rootZoneKey: null,
    topologyAliases: [],
    rootAssignmentSource: null,
    rootAssignmentConfidence: 0,
  }
  delete restored.rootBaseTopologyRole
  delete restored.rootBaseDiagramClass
  delete restored.rootBaseJbProfileId
  return restored
}

function strictRootName(value) {
  const name = normalize(value)
  return /^server(?:\s|$)/.test(name)
    || /^rack server(?:\s|$)/.test(name)
    || /^server rack(?:\s|$)/.test(name)
    || /^jb rack server$/.test(name)
}

function serverLike(node) {
  return /(^|\s)(server|rack server|server rack)(\s|$)/.test(normalize([
    node.sourceName,
    node.assetType,
    node.category,
  ].filter(Boolean).join(' ')))
}

function junctionLike(node) {
  const value = normalize([node.assetType, node.category, node.sourceName].filter(Boolean).join(' '))
  return node.topologyRole === 'junction'
    || String(node.diagramClass ?? '').startsWith('junction')
    || /(^|\s)(junction box|junction|jb)(\s|$)/.test(value)
}

function inferRootZone(node) {
  const name = normalize(node.sourceName)
  if (/\butara\b/.test(name)) return 'utara'
  if (/\bselatan\b/.test(name)) return 'selatan'
  if (/\bcr\b/.test(name)) return 'cr'
  return 'utama'
}

function inferRootAliases(node, zoneKey) {
  const name = normalizeAlias(node.sourceName)
  if (zoneKey === 'utara') return [name, 'server utara', 'sr utara', 'sr-utara']
  if (zoneKey === 'selatan') return [name, 'server selatan', 'sr selatan', 'sr']
  if (zoneKey === 'cr') return [name, 'server cr', 'cr']
  if (/rack server|server rack/.test(name)) return [name, 'server', 'rs', 'sr']
  return [name, 'server', 'sr', 'svr']
}

function presentationPathHints(bundle, nodes) {
  const nodesByArea = groupBy(nodes, areaKeyFor)
  return asArray(bundle.classifiedPaths).flatMap((path) => {
    const areaKey = areaKeyFor(path)
    const local = nodesByArea.get(areaKey) ?? []
    const label = normalizeAlias(path.sourceName)
    if (!label) return []
    const matchedNodeIds = local.filter((node) => labelMatchesNode(label, node)).map(({ id }) => id)
    return [{ areaKey, label, matchedNodeIds }]
  })
}

function pathHintScore(root, members, hints) {
  const memberIds = new Set(members.map(({ id }) => id))
  return hints.filter((hint) => hint.areaKey === areaKeyFor(root)
    && asArray(root.topologyAliases).some((alias) => tokenContains(hint.label, alias))
    && hint.matchedNodeIds.some((id) => memberIds.has(id))).length
}

function labelMatchesNode(label, node) {
  const aliases = [node.sourceName, ...asArray(node.topologyAliases)]
  return aliases.some((alias) => tokenContains(label, normalizeAlias(alias)))
}

function tokenContains(label, alias) {
  if (!alias) return false
  const source = ` ${normalizeAlias(label)} `
  const target = ` ${normalizeAlias(alias)} `
  return source.includes(target)
}

function componentDistance(root, members, bundle) {
  const coordinateByGeometryId = new Map(asArray(bundle.geometries).map((geometry) => [
    geometry.geometryId,
    pointCoordinate(geometry),
  ]))
  const rootCoordinate = nodeCoordinate(root, coordinateByGeometryId)
  if (!rootCoordinate) return Number.MAX_SAFE_INTEGER
  const distances = members
    .map((node) => nodeCoordinate(node, coordinateByGeometryId))
    .filter(Boolean)
    .map((coordinate) => squaredDistance(rootCoordinate, coordinate))
  return distances.length ? Math.min(...distances) : Number.MAX_SAFE_INTEGER
}

function nodeCoordinate(node, coordinateByGeometryId) {
  if (Array.isArray(node.coordinate)) return node.coordinate
  return asArray(node.geometryIds).map((id) => coordinateByGeometryId.get(id)).find(Boolean) ?? null
}

function pointCoordinate(geometry) {
  const type = String(geometry.geometryType ?? geometry.type ?? '').toLowerCase()
  if (type !== 'point') return null
  const value = geometry.coordinates
  return Array.isArray(value) && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))
    ? [Number(value[0]), Number(value[1])]
    : null
}

function squaredDistance(left, right) {
  return (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2
}

function connectedComponents(nodes, adjacency) {
  const components = []
  const seen = new Set()
  nodes.forEach(({ id }) => {
    if (seen.has(id)) return
    const component = []
    const queue = [id]
    while (queue.length) {
      const current = queue.shift()
      if (seen.has(current)) continue
      seen.add(current)
      component.push(current)
      ;[...(adjacency.get(current) ?? [])].sort().forEach((next) => queue.push(next))
    }
    components.push(component.sort())
  })
  return components
}

function presentationNode(assetId, layoutRootId, layoutParentId, status, reasonCode, zoneKey = null) {
  return {
    assetId,
    ...(status === 'root' ? {
      topologyRole: 'root',
      diagramClass: 'rack-root',
    } : {}),
    layoutRootId,
    layoutParentId,
    layoutRelationStatus: status,
    reasonCode,
    rootZoneKey: zoneKey ?? null,
  }
}

function comparePresentationEntry(left, right) {
  const tier = (node) => node.diagramClass === 'junction-peer' ? 0 : 1
  return tier(left) - tier(right) || String(left.sourceName ?? left.id)
    .localeCompare(String(right.sourceName ?? right.id), 'id')
}

function compareRootNodes(left, right) {
  return String(left.rootZoneKey ?? '').localeCompare(String(right.rootZoneKey ?? ''), 'id')
    || String(left.id).localeCompare(String(right.id), 'id')
}

function compareAssignments(left, right) {
  return left.areaName.localeCompare(right.areaName, 'id')
    || left.zoneKey.localeCompare(right.zoneKey, 'id')
    || left.assetId.localeCompare(right.assetId, 'id')
}

function nodeIdentityAliases(node) {
  return unique([
    nodeId(node),
    node.stableAssetId,
    node.canonicalAssetId,
    node.assetId,
    node.onboardingIdentity,
    node.legacyAssetId,
    ...Object.values(node.identityAliases ?? {}).flatMap(asArray),
  ].filter(Boolean))
}

function nodeId(node) {
  return node?.canonicalAssetId ?? node?.assetId ?? node?.id ?? null
}

function edgeSource(edge) {
  return edge?.sourceAssetId ?? edge?.sourceNodeId ?? null
}

function edgeTarget(edge) {
  return edge?.targetAssetId ?? edge?.targetNodeId ?? null
}

function normalizeZoneKey(value) {
  return slug(value || 'utama') || 'utama'
}

function normalizeAlias(value) {
  return normalize(value).replace(/\s+/g, ' ').trim()
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function slug(value) {
  return normalize(value).replace(/\s+/g, '-')
}

function groupBy(values, keyFor) {
  const result = new Map()
  asArray(values).forEach((value) => {
    const key = keyFor(value)
    result.set(key, [...(result.get(key) ?? []), value])
  })
  return result
}

function unique(values) {
  return [...new Set(values)]
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}
