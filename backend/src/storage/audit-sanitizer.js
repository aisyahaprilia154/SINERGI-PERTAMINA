const BLOCKED_AUDIT_KEYS = /token|authorization|password|secret/i
const MAX_AUDIT_DEPTH = 8

export function sanitizeAuditDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {}
  const sanitized = sanitizeValue(details, new WeakSet(), 0)
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized
    : {}
}

function sanitizeValue(value, ancestors, depth) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return String(value)
  if (typeof value !== 'object') return undefined
  if (depth >= MAX_AUDIT_DEPTH) return '[depth-limited]'
  if (ancestors.has(value)) return '[circular]'

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value
        .map((item) => sanitizeValue(item, ancestors, depth + 1))
        .filter((item) => item !== undefined)
    }

    const output = {}
    for (const [key, nestedValue] of Object.entries(value)) {
      if (BLOCKED_AUDIT_KEYS.test(key)) continue
      const sanitized = sanitizeValue(nestedValue, ancestors, depth + 1)
      if (sanitized !== undefined) output[key] = sanitized
    }
    return output
  } finally {
    ancestors.delete(value)
  }
}
