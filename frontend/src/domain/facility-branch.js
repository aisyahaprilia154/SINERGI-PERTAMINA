const FACILITY_BRANCH_NAMES = Object.freeze({
  'booster-kutawinangun': 'Kebumen',
  'ft-tegal-baru': 'Tegal',
  'dppu-yia': 'Yogyakarta',
  'ft-pengapon': 'Semarang',
  'ft-pengapon-semarang': 'Semarang',
  'ft-rewulu': 'Yogyakarta',
  'ft-maos': 'Cilacap',
  'ft-lomanis': 'Cilacap',
  'ft-cilacap': 'Cilacap',
  'itc-lpg-cilacap': 'Cilacap',
  'itc-lpg-cilacapap': 'Cilacap',
})

export function branchNameForFacility(facility, fallback = '') {
  const candidates = [
    facility?.key,
    facility?.locationGroupKey,
    facility?.name,
    facility,
  ]
  for (const candidate of candidates) {
    const key = normalizeFacilityKey(candidate)
    if (key && FACILITY_BRANCH_NAMES[key]) return FACILITY_BRANCH_NAMES[key]
  }
  return String(fallback ?? '').replace(/^kantor\s+cabang\s+/i, '').trim()
}

function normalizeFacilityKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
