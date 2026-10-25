import { createHash } from 'node:crypto'
import { BlockList, isIP } from 'node:net'
import { AppError } from '../errors.js'

const WINDOW = 15 * 60 * 1000
const normalizeAddress = value => String(value ?? '').replace(/^::ffff:/i, '')

// Forwarded addresses are used only behind an explicitly configured proxy.
export function createClientAddressResolver(proxies = []) {
  const trusted = new BlockList()
  for (const entry of proxies) {
    const [address, prefix, extra] = entry.split('/')
    const version = isIP(address), type = version === 4 ? 'ipv4' : 'ipv6'
    if (!version || extra !== undefined || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128)))) throw new TypeError('SINERGI_TRUSTED_PROXIES tidak valid.')
    if (prefix === undefined) trusted.addAddress(address, type)
    else trusted.addSubnet(address, Number(prefix), type)
  }
  const allowed = address => isIP(address) && trusted.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6')
  return request => {
    const peer = normalizeAddress(request.socket?.remoteAddress)
    if (!allowed(peer)) return peer || 'unknown'
    const header = request.headers['x-forwarded-for']
    if (typeof header !== 'string' || header.length > 2048) return peer
    const chain = header.split(',').map(value => normalizeAddress(value.trim()))
    if (chain.length > 16 || chain.some(address => !isIP(address))) return peer
    return [...chain].reverse().find(address => !allowed(address)) ?? chain[0] ?? peer
  }
}

export class LoginLimiter {
  constructor({ now = Date.now, maxEntries = 10_000 } = {}) {
    this.now = now
    this.maxEntries = maxEntries
    this.entries = new Map()
    this.lastCleanup = 0
  }

  begin(address, identifier) {
    const now = this.now()
    if (now - this.lastCleanup >= 60_000 || this.entries.size >= this.maxEntries) {
      for (const [key, value] of this.entries) if (value.expires <= now) this.entries.delete(key)
      this.lastCleanup = now
    }
    const hash = value => createHash('sha256').update(value).digest('hex')
    const ipKey = `ip:${hash(address)}`
    const pairKey = `pair:${hash(`${address}\0${String(identifier ?? '').trim().toLowerCase().slice(0, 254)}`)}`
    const entry = key => {
      let value = this.entries.get(key)
      if (value?.expires <= now) { this.entries.delete(key); value = null }
      if (!value) {
        if (this.entries.size >= this.maxEntries) this.reject(now + 60_000)
        value = { expires: now + WINDOW, attempts: 0, failures: 0, pending: 0 }
        this.entries.set(key, value)
      }
      return value
    }
    const ip = entry(ipKey)
    if (ip.attempts >= 30) this.reject(ip.expires)
    ip.attempts++
    const pair = entry(pairKey)
    if (pair.failures + pair.pending >= 5) this.reject(pair.expires)
    pair.pending++
    let finished = false
    return success => {
      if (finished) return
      finished = true
      pair.pending--
      if (success === true) {
        pair.failures = 0
        if (!pair.pending && this.entries.get(pairKey) === pair) this.entries.delete(pairKey)
      } else if (success === false) pair.failures++
    }
  }

  reject(expires) {
    const error = new AppError('Terlalu banyak percobaan masuk. Coba lagi nanti.', { code: 'login_rate_limited', statusCode: 429 })
    error.retryAfter = Math.max(1, Math.ceil((expires - this.now()) / 1000))
    throw error
  }
}

export function logSecurity(write, event, { requestId, actorId, status }, now = Date.now) {
  // Only these explicit fields may reach the sink. Never spread request/error objects.
  const record = { timestamp: new Date(now()).toISOString(), event, requestId, status }
  if (actorId) record.actorId = String(actorId).replace(/[\r\n\x00-\x1f]/g, '').slice(0, 128)
  try { write(record) } catch { console.error(JSON.stringify({ event: 'security.log_failed', requestId })) }
}
