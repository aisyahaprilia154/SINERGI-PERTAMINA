const LINE_ROLES = Object.freeze([
  ['cctv-cable', /\bcctv\b.*\b(cable|kabel|backbone)\b|\b(cable|kabel|backbone)\b.*\bcctv\b/i],
  ['fiber-optic', /\b(fiber|fibre)\b|\bf[.\s_-]*o\b/i],
  ['lan-line', /\b(lan|utp)\b.*\b(cable|kabel|line|jalur)\b|\b(cable|kabel|line|jalur)\b.*\b(lan|utp)\b/i],
  ['power-cable', /\b(power|pln|listrik)\b/i],
])

const NODE_ROLES = Object.freeze([
  ['junction-box', /\b(junction\s*box|jb(?:\s*cctv)?)\b/i],
  ['access-point', /\b(access\s*point|ap)\b/i],
  ['switch', /\b(switch|router|core\s*device)\b/i],
  ['server', /\bserver\b/i],
  ['nvr', /\bnvr\b/i],
  ['otb', /\botb\b/i],
  ['pole', /\b(tiang|pole)\b/i],
  ['cctv', /\b(cctv|camera|kamera|ip\s*camera)\b/i],
])

export const TOPOLOGY_COMPATIBILITY_CONFIG = Object.freeze({
  lineToNode: Object.freeze({
    'cctv-cable': Object.freeze([
      'cctv',
      'junction-box',
      'switch',
      'nvr',
      'server',
    ]),
    'fiber-optic': Object.freeze([
      'otb',
      'junction-box',
      'switch',
    ]),
    'lan-line': Object.freeze([
      // UTP routes in the Pengapon source are also used as physical CCTV
      // access cabling. The line remains owned by the LAN/UTP network; these
      // endpoint roles only allow evidence-backed attachment to that route.
      'cctv',
      'junction-box',
      'switch',
      'access-point',
      'server',
    ]),
    'power-cable': Object.freeze([
      'pole',
    ]),
  }),
  lineIntersections: Object.freeze([
    Object.freeze(['cctv-cable', 'cctv-cable']),
    Object.freeze(['fiber-optic', 'fiber-optic']),
    Object.freeze(['lan-line', 'lan-line']),
    Object.freeze(['power-cable', 'power-cable']),
  ]),
  explicitMetadataAliases: Object.freeze({
    connectedTo: Object.freeze(['connected_to', 'connectedTo']),
    sourceAssetId: Object.freeze(['source_asset_id', 'sourceAssetId']),
    targetAssetId: Object.freeze(['target_asset_id', 'targetAssetId']),
    parentAssetId: Object.freeze(['parent_asset_id', 'parentAssetId']),
    upstreamAssetId: Object.freeze(['upstream_asset_id', 'upstreamAssetId']),
    downstreamAssetId: Object.freeze(['downstream_asset_id', 'downstreamAssetId']),
    relationType: Object.freeze(['relation_type', 'relationType']),
  }),
})

export function classifyTopologyLine(assetLike) {
  const value = semanticText(assetLike)
  return LINE_ROLES.find(([, pattern]) => pattern.test(value))?.[0] ?? 'unsupported-line'
}

export function classifyTopologyNode(assetLike) {
  const value = semanticText(assetLike)
  return NODE_ROLES.find(([, pattern]) => pattern.test(value))?.[0] ?? 'unsupported-node'
}

export function isTopologyPointLineCompatible(node, line) {
  const lineRole = line.lineRole || classifyTopologyLine(line)
  const nodeRole = node.nodeRole || classifyTopologyNode(node)
  return TOPOLOGY_COMPATIBILITY_CONFIG.lineToNode[lineRole]?.includes(nodeRole) === true
}

export function areTopologyLinesCompatible(left, right) {
  const leftRole = left.lineRole || classifyTopologyLine(left)
  const rightRole = right.lineRole || classifyTopologyLine(right)
  return TOPOLOGY_COMPATIBILITY_CONFIG.lineIntersections.some(([first, second]) => (
    (first === leftRole && second === rightRole)
    || (first === rightRole && second === leftRole)
  ))
}

export function normalizeTopologyMetadataKey(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function semanticText(assetLike) {
  return [
    assetLike?.category,
    assetLike?.assetType,
    assetLike?.type,
    assetLike?.name,
    assetLike?.sourceFolderPath,
  ].filter(Boolean).join(' ')
}
