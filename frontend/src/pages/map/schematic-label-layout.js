import { truncateAssetLabel } from '../../domain/asset-display-name.js'

/**
 * Adds render-only label lines. Full identity values remain on the graph node
 * and are available to SVG title/tooltip output.
 */
export function placeNodeLabels(nodes, {
  maxLineLength = 18,
  maxLines = 2,
} = {}) {
  return nodes.map((node) => {
    if (node.isVirtual) {
      return {
        ...node,
        labelLines: [],
      }
    }
    const sourceLabel = node.shortLabel || node.shortName || node.name || node.id
    return {
      ...node,
      labelLines: splitLabel(sourceLabel, maxLineLength, maxLines),
    }
  })
}

export function splitLabel(value, maxLineLength = 18, maxLines = 2) {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (!normalized) return []
  if (normalized.length <= maxLineLength) return [normalized]

  const words = normalized.split(' ')
  const lines = []
  let current = ''
  for (const word of words) {
    if (lines.length === maxLines) break
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxLineLength) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    current = word
  }
  if (current && lines.length < maxLines) lines.push(current)

  if (lines.length === 1 && words.length === 1) {
    const first = normalized.slice(0, maxLineLength)
    const second = normalized.slice(maxLineLength)
    lines.splice(0, 1, first, second)
  }
  const consumed = lines.join(' ').replaceAll('…', '').length
  const truncated = consumed < normalized.length
  if (truncated && lines.length) {
    lines[lines.length - 1] = truncateAssetLabel(lines.at(-1), maxLineLength)
  }
  return lines.slice(0, maxLines)
}
