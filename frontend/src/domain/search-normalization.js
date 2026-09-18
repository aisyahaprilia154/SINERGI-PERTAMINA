/**
 * Shared search normalization for asset and topology lookups.
 *
 * The source data uses several equivalent spellings for one identity, such
 * as `JB-015`, `JB 15`, and `JB015`. Keep matching tolerant without mutating
 * the labels shown to the user.
 */
export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function compactSearchText(value) {
  return normalizeSearchText(value).replace(/[^\p{L}\p{N}]/gu, '')
}

function canonicalSearchKey(value) {
  return compactSearchText(value).replace(/([a-z])0+(\d)/g, '$1$2')
}

export function searchMatchScore(values, query) {
  const normalizedQuery = normalizeSearchText(query)
  const compactQuery = compactSearchText(query)
  const canonicalQuery = canonicalSearchKey(query)
  if (!canonicalQuery.length) return 0

  const queryTokens = normalizedQuery.split(' ').filter(Boolean)
  let best = 0
  for (const value of Array.isArray(values) ? values : [values]) {
    const normalizedValue = normalizeSearchText(value)
    if (!normalizedValue) continue
    const compactValue = compactSearchText(value)
    const canonicalValue = canonicalSearchKey(value)
    const tokens = normalizedValue.split(' ').filter(Boolean)
    const canonicalTokens = tokens.map(canonicalSearchKey)

    if (normalizedValue === normalizedQuery
      || compactValue === compactQuery
      || canonicalValue === canonicalQuery) {
      best = Math.max(best, 100)
      continue
    }
    if (normalizedValue.startsWith(normalizedQuery)
      || compactValue.startsWith(compactQuery)
      || canonicalValue.startsWith(canonicalQuery)) {
      best = Math.max(best, 88)
      continue
    }
    if (normalizedValue.includes(normalizedQuery)
      || compactValue.includes(compactQuery)
      || canonicalValue.includes(canonicalQuery)) {
      best = Math.max(best, 72)
      continue
    }
    if (queryTokens.every((token) => tokens.some((candidate) => candidate.includes(token)))
      || queryTokens.every((token) => canonicalTokens.some((candidate) => (
        candidate.includes(canonicalSearchKey(token))
      )))) {
      best = Math.max(best, 68)
      continue
    }

    const fuzzyCandidates = [canonicalValue, ...canonicalTokens]
    if (fuzzyCandidates.some((candidate) => withinSearchEditDistance(
      candidate,
      canonicalQuery,
    ))) best = Math.max(best, 36)
  }
  return best
}

function withinSearchEditDistance(left, right) {
  if (!left || !right) return false
  if (Math.abs(left.length - right.length) > fuzzyDistanceLimit(right.length)) return false
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    let rowMinimum = current[0]
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      const distance = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost,
      )
      current[column] = distance
      rowMinimum = Math.min(rowMinimum, distance)
    }
    if (rowMinimum > fuzzyDistanceLimit(right.length)) return false
    previous = current
  }
  return previous[right.length] <= fuzzyDistanceLimit(right.length)
}

function fuzzyDistanceLimit(length) {
  if (length < 3) return 0
  return Math.min(2, Math.max(1, Math.floor(length * 0.2)))
}
