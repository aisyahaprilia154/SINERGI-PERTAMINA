/** KML colors are AABBGGRR, never CSS RRGGBB. */
export function networkFromKmlLineColor(value) {
  const color = String(value ?? '').trim().toLowerCase().replace(/^#/, '')
  if (!/^[0-9a-f]{8}$/.test(color) || parseInt(color.slice(0, 2), 16) === 0) return null
  const [b, g, r] = [2, 4, 6].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  if (max < 0.25 || delta / max < 0.45) return null
  const hue = ((max === r ? (g - b) / delta : max === g
    ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360
  return hue >= 200 && hue <= 260 ? 'fiber_optic'
    : hue >= 80 && hue <= 170 ? 'lan' : null
}
