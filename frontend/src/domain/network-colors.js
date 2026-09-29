// Operational cable palette aligned with the Google Earth convention used by
// the field plan. Keep these values stable across map, schematic, and topology
// renderers so a cable keeps the same meaning in every view.
export const OPERATIONAL_NETWORK_COLORS = Object.freeze({
  power: '#d32f2f',
  'fiber-optic': '#0d47a1',
  lan: '#2e7d32',
  infrastructure: '#f9a825',
})

export const OPERATIONAL_NETWORK_SOFT_COLORS = Object.freeze({
  power: '#fdecec',
  'fiber-optic': '#e8eef9',
  lan: '#e8f3ea',
  infrastructure: '#fff8df',
})
