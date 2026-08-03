const CATEGORY_TYPES = Object.freeze({
  cable_to_asset: Object.freeze([
    'endpoint_device',
    'inline_device',
    'intersection_with_junction',
    'line_label_attachment',
  ]),
  asset_to_asset: Object.freeze([
    'explicit_metadata',
    'line_label_connection',
  ]),
  cable_to_cable: Object.freeze([
    'endpoint_endpoint',
  ]),
  unresolved: Object.freeze([
    'unresolved',
  ]),
})

export const RELATION_CATEGORIES = Object.freeze([
  Object.freeze({
    id: 'all',
    label: 'Semua relasi',
    description: 'Tampilkan semua kandidat',
  }),
  Object.freeze({
    id: 'cable_to_asset',
    label: 'Kabel ke aset',
    description: 'Endpoint, attachment, dan junction',
  }),
  Object.freeze({
    id: 'asset_to_asset',
    label: 'Aset ke aset',
    description: 'Koneksi antar-device',
  }),
  Object.freeze({
    id: 'cable_to_cable',
    label: 'Kabel ke kabel',
    description: 'Sambungan antar-segmen',
  }),
  Object.freeze({
    id: 'unresolved',
    label: 'Belum ada pasangan',
    description: 'Butuh target manual',
  }),
  Object.freeze({
    id: 'other',
    label: 'Relasi lainnya',
    description: 'Tipe relasi baru atau khusus',
  }),
])

const CATEGORY_BY_TYPE = new Map(
  Object.entries(CATEGORY_TYPES).flatMap(([categoryId, candidateTypes]) => (
    candidateTypes.map((candidateType) => [candidateType, categoryId])
  )),
)

const CATEGORY_IDS = new Set(RELATION_CATEGORIES.map(({ id }) => id))

export function isRelationCategoryId(value) {
  return CATEGORY_IDS.has(value)
}

export function relationCategoryForCandidate(candidate) {
  return CATEGORY_BY_TYPE.get(candidate?.candidateType) ?? 'other'
}
