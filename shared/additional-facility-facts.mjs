// Operational corrections confirmed by the facility owner. No proximity inference.
import { unsafeAutomaticMount } from './mounting-policy.mjs'
export function facilityKey(asset) {
  const values = [asset?.locationGroupKey, asset?.areaKey, asset?.locationGroupName,
    ...String(asset?.sourceFolderPath ?? '').replaceAll('\\', '/').split('/')]
  const normalized = values.map(value => String(value ?? '').trim().toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
  const aliases = new Map([
    ['dppu-yia', 'dppu-yia'],
    ['booster-kutawinangun', 'booster-kutawinangun'],
    ['ft-pengapon', 'ft-pengapon-semarang'],
    ['ft-pengapon-semarang', 'ft-pengapon-semarang'],
  ])
  return normalized.map(value => aliases.get(value)).find(Boolean)
}
export function factCode(asset) {
  return String(asset?.sourceName ?? asset?.name ?? '').trim().toUpperCase()
    .replace(/^C-/, 'CAM-')
    .replace(/\.WP$/, '-WP').replace(/\s+WP$/, '-WP')
    .replace(/^(JB-CCTV-|BC-|DC-|CAM-|T-|JB-)0+(\d)/, '$1$2')
    .replace(/-EXP$/, '')
}
const yia = [
  ['SERVER', 'JB-CCTV-10-WP'], ['SERVER', 'JB-CCTV-1-WP'],
  ['JB-CCTV-9-WP', 'JB-CCTV-9.1-WP'], ['BC-21', 'JB-CCTV-9.1-WP'],
  ['JB-CCTV-15-WP', 'JB-CCTV-15.1-WP'], ['JB-CCTV-15-WP', 'JB-CCTV-15.2-WP'],
  ['BC-37', 'JB-CCTV-15.1-WP'], ['BC-38', 'JB-CCTV-15.1-WP'],
  ['BC-41', 'JB-CCTV-15.2-WP'], ['DC-39', 'JB-CCTV-15-WP'],
  ['JB-CCTV-13-WP', 'JB-CCTV-13.1-WP'], ['JB-CCTV-13-WP', 'JB-CCTV-13.2-WP'],
  ['JB-CCTV-13-WP', 'JB-CCTV-13.3-WP'], ['DC-32', 'JB-CCTV-13-WP'],
  ['BC-28', 'JB-CCTV-12-WP'], ['BC-29', 'JB-CCTV-12-WP'],
]
const booster = [['SERVER', 'JB-1'], ['JB-1', 'JB-4'], ['JB-1', 'JB-5'],
  ['CAM-12', 'JB-2'], ['CAM-13', 'JB-2'],
  ...[6, 7, 8, 9, 10].map(n => [`CAM-${n}`, 'JB-1']),
  ...[16, 17, 18].map(n => [`CAM-${n}`, 'JB-6'])]
const mountFacts = {
  'dppu-yia': [['JB-CCTV-9.1-WP', 'T-5'], ['BC-21', 'T-5'],
    ['JB-CCTV-15.1-WP', 'T-8'], ['BC-37', 'T-8'], ['BC-38', 'T-8'],
    ['JB-CCTV-15.2-WP', 'T-7'], ['BC-41', 'T-7'], ['BC-28', 'T-14'], ['BC-29', 'T-14']],
  'booster-kutawinangun': [['JB-1', 'T-4'], ['CAM-9', 'T-4'], ['CAM-10', 'T-4'],
    ['JB-6', 'T-8'], ['CAM-16', 'T-8']],
  // FT Pengapon: these are field-confirmed physical groupings. They are
  // deliberately kept separate from the inferred network graph.
  'ft-pengapon-semarang': [
    ['JB-6', 'T-6'], ['CAM-6', 'T-6'], ['CAM-30', 'T-6'],
    ['JB-10', 'T-10'], ['CAM-10', 'T-10'], ['CAM-35', 'T-10'], ['CAM-36', 'T-10'],
    ['JB-15', 'T-15'], ['CAM-15', 'T-15'],
    ['JB-13', 'T-13'], ['CAM-13', 'T-13'],
    ['JB-14', 'T-14'], ['CAM-14', 'T-14'],
    ['JB-17.1-WP', 'T-17'], ['CAM-17', 'T-17'],
    ['JB-18.1-WP', 'T-18'], ['CAM-18', 'T-18'], ['CAM-43', 'T-18'],
    ['CAM-37', 'T-21'], ['JB-11.1', 'T-21'],
  ],
}
const idOf = a => a.canonicalAssetId ?? a.assetId ?? a.id
function resolvePairs(assets, rules) {
  const result = []
  for (const [site, pairs] of Object.entries(rules)) {
    const index = new Map()
    for (const asset of assets.filter(a => facilityKey(a) === site)) {
      if (['cable_path', 'visual_only', 'visual'].includes(asset.objectRole)) continue
      const code = factCode(asset)
      index.set(code, [...(index.get(code) ?? []), asset])
    }
    for (const [a, b] of pairs) {
      if (index.get(a)?.length !== 1 || index.get(b)?.length !== 1) continue
      result.push({sourceAssetId: idOf(index.get(a)[0]), targetAssetId: idOf(index.get(b)[0])})
    }
  }
  return result
}
export function additionalRelations(assets) {
  return resolvePairs(assets, {'dppu-yia': yia, 'booster-kutawinangun': booster})
    .map(pair => ({...pair, id: `facility-facts/2026-09-15:${pair.sourceAssetId}:${pair.targetAssetId}`,
      relationType: 'connected-to', relationKind: 'device_edge', direction: 'undirected',
      verificationStatus: 'confirmed', provenance: 'facility_topology_correction', traversable: true}))
}
export function additionalExpectation(asset) {
  const site = facilityKey(asset), code = factCode(asset)
  if (site === 'dppu-yia') {
    if (['JB-CCTV-15-WP', 'JB-CCTV-12-WP'].includes(code)) return 'standalone'
    if (code === 'DC-39') return 'indoor'
  }
  if (site === 'booster-kutawinangun' && ['CAM-6', 'CAM-7', 'CAM-8', 'CAM-17', 'CAM-18'].includes(code)) return 'indoor'
  // FT Pengapon confirms these two assets are not on T-015. No replacement
  // pole ID was supplied, so keep them separate instead of guessing one.
  if (site === 'ft-pengapon-semarang' && [
    'JB-15.1-WP', 'CAM-42', 'JB-17', 'JB-18', 'JB-19', 'JB-19.2-WP',
    'CAM-21', 'CAM-22', 'CAM-48',
  ].includes(code)) return 'standalone'
  return null
}
export function additionalConflict(edge, byId) {
  const a = byId.get(edge.sourceAssetId ?? edge.sourceNodeId ?? edge.sourcePathAssetId), b = byId.get(edge.targetAssetId ?? edge.targetNodeId)
  if (facilityKey(a) === 'booster-kutawinangun' && facilityKey(b) === 'booster-kutawinangun') {
    const codes = new Set([factCode(a), factCode(b)])
    // Confirmed camera ownership is authoritative even when the correct JB is
    // missing or ambiguous in an import. Never substitute a different JB.
    if (booster.some(([camera, owner]) => camera.startsWith('CAM-') && codes.has(camera)
      && [...codes].some(code => code.startsWith('JB-') && code !== owner))) return true
    // These two inferred JB peer edges contradict the confirmed Booster topology.
    if (codes.has('JB-1') && codes.has('JB-2')) return true
    if (codes.has('JB-2') && codes.has('JB-6')) return true
  }
  if (facilityKey(a) !== 'dppu-yia' || facilityKey(b) !== 'dppu-yia') return false
  const codes = new Set([factCode(a), factCode(b)])
  return codes.has('SERVER') && codes.has('JB-CCTV-4-WP')
    || codes.has('JB-CCTV-8-WP') && codes.has('JB-CCTV-9.1-WP')
}
export function correctAdditionalMounts(relations, assets) {
  const facts = resolvePairs(assets, mountFacts)
  const overrides = new Set(facts.map(r => r.sourceAssetId))
  const excluded = new Set(assets.filter(additionalExpectation).map(idOf))
  const byId = new Map(assets.map(asset => [idOf(asset), asset]))
  return [...relations.filter(r => {
    if (unsafeAutomaticMount(r) || overrides.has(r.sourceAssetId) || excluded.has(r.sourceAssetId)) return false
    const asset = byId.get(r.sourceAssetId), pole = byId.get(r.targetAssetId)
    // Explicit user correction: Cam-13 is not installed on T-08.
    return !(facilityKey(asset) === 'booster-kutawinangun' && factCode(asset) === 'CAM-13'
      && facilityKey(pole) === 'booster-kutawinangun' && factCode(pole) === 'T-8')
  }),
    ...facts.map(r => ({...r, id: `facility-mount:${r.sourceAssetId}:${r.targetAssetId}`,
      relationId: `facility-mount:${r.sourceAssetId}:${r.targetAssetId}`,
      relationType: 'mounted_on', relationKind: 'installation_attachment',
      verificationStatus: 'confirmed', provenance: 'facility_topology_correction'}))]
}
