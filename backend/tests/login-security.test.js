import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { LoginLimiter, createClientAddressResolver } from '../src/security/login-security.js'
import { PostgresAccountStore } from '../src/security/account-store.js'
import { TokenAuthenticator } from '../src/security/authorization.js'
import { createOperationalApp } from '../src/operational-app.js'
import { createConfig } from '../src/config.js'

test('five failures, independent clients, recovery, normalization and successful reset', () => {
  let now = 1_000
  const limiter = new LoginLimiter({ now: () => now })
  for (let n = 0; n < 5; n++) limiter.begin('ip', n % 2 ? ' ADMIN ' : 'admin')(false)
  assert.throws(() => limiter.begin('ip', 'admin'), { code: 'login_rate_limited', retryAfter: 900 })
  limiter.begin('other-ip', 'admin')(true)
  now += 900_000
  limiter.begin('ip', 'admin')(true)
  for (let n = 0; n < 4; n++) limiter.begin('ip', 'admin')(false)
  limiter.begin('ip', 'admin')(true)
  limiter.begin('ip', 'admin')(false)
})

test('IP limits survive changing usernames and parallel attempts cannot bypass pair limits', () => {
  const limiter = new LoginLimiter()
  for (let n = 0; n < 30; n++) limiter.begin('ip', `user-${n}`)(true)
  assert.throws(() => limiter.begin('ip', 'new-user'), { statusCode: 429 })
  // An interrupted/internal verification releases its reservation without counting a bad password.
  for (let n = 0; n < 6; n++) limiter.begin('concurrent', 'admin')()
  const pending = Array.from({ length: 5 }, () => limiter.begin('concurrent', 'admin'))
  assert.throws(() => limiter.begin('concurrent', 'admin'), { statusCode: 429 })
  pending.forEach(finish => { finish(false); finish(false) })
  assert.throws(() => limiter.begin('concurrent', 'admin'), { statusCode: 429 })
})

test('bounded storage fails closed and expired entries are automatically released', () => {
  let now = 0
  const limiter = new LoginLimiter({ maxEntries: 4, now: () => now })
  limiter.begin('one', 'private-identifier')(false)
  limiter.begin('two', 'private-identifier')(false)
  assert.throws(() => limiter.begin('three', 'admin'), { statusCode: 429 })
  assert.equal(limiter.entries.size, 4)
  assert.equal(JSON.stringify([...limiter.entries]).includes('private-identifier'), false)
  now = 900_001
  limiter.begin('three', 'admin')(true)
  assert.ok(limiter.entries.size <= 2)
})

test('forwarded addresses require explicit trust; invalid chains fail back to the peer', () => {
  const request = (peer, header) => ({ socket: { remoteAddress: peer }, headers: { 'x-forwarded-for': header } })
  assert.equal(createClientAddressResolver()(request('::ffff:127.0.0.1', '1.2.3.4')), '127.0.0.1')
  const resolve = createClientAddressResolver(['10.20.0.0/24', '::1'])
  assert.equal(resolve(request('10.20.0.3', 'spoof, 1.2.3.4')), '10.20.0.3')
  assert.equal(resolve(request('10.20.0.3', '6.6.6.6, 1.2.3.4, 10.20.0.2')), '1.2.3.4')
  assert.equal(resolve(request('::1', '1.2.3.4')), '1.2.3.4')
  assert.throws(() => createClientAddressResolver(['0.0.0.0/999']), TypeError)
})

test('all create/reset entrypoints reject short passwords before touching the database', async () => {
  const store = new PostgresAccountStore({ query() { throw new Error('Database must not be touched') } })
  for (const password of ['', '12345678901234', null, 'x'.repeat(1025)]) {
    await assert.rejects(store.save({ username: 'viewer', password, role: 'Viewer' }), TypeError)
    await assert.rejects(store.manage({ body: { username: 'viewer', password } }), { code: 'invalid_password' })
    await assert.rejects(store.manage({ userId: 'user', resetPassword: true, body: { password } }), { code: 'invalid_password' })
  }
})

test('account CLI rejects a short password from stdin before connecting', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/create-account.mjs', import.meta.url)), '--username=test-user', '--role=Viewer'], {
    input: '12345678901234\n', encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, SINERGI_DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/sinergi_security_unreachable' },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /15–1024/)
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|12345678901234/)
})

test('HTTP throttling, generic errors, old-password login, headers, revocation and sanitized security logs', async () => {
  let now = 100_000, failPresence = false
  const logs = [], user = { id: 'known-user', name: 'admin', role: 'Administrator' }
  const auth = new TokenAuthenticator({}, { now: () => now })
  const accounts = { async verify(identifier, password) { return identifier === 'admin' && password === 'old' ? user : null }, async markSeen() { if(failPresence)throw new Error('private database failure payload') }, async resolveSession(value) { return value } }
  const repository = { checkpoints: {}, pool: { async query() { return { rows: [] } } } }
  const server = createOperationalApp({ repository, importService: {}, fileStore: {}, config: createConfig({}, { dataRoot: path.join(os.tmpdir(), 'sinergi-security-http') }), authenticator: auth, accountStore: accounts, loginLimiter: new LoginLimiter({ now: () => now }), securityLogger: record => logs.push(record) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const login = (identifier, password, spoof = '') => fetch(url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': spoof }, body: JSON.stringify({ identifier, password }) })
  try {
    for (let n = 0; n < 5; n++) {
      const response = await login('secret-identifier', 'secret-password', `1.2.3.${n}`)
      assert.equal(response.status, 401)
      assert.equal((await response.json()).error.message, 'Username atau kata sandi salah.')
    }
    const limited = await login('secret-identifier', 'secret-password')
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '900')
    now += 900_000
    assert.equal((await login('secret-identifier', 'secret-password')).status, 401)
    const response = await login('admin', 'old'), session = await response.json()
    assert.equal(response.status, 200); assert.equal(session.expiresInSeconds, 28800)
    assert.equal(response.headers.get('x-frame-options'), 'DENY')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/)
    const headers = { authorization: `Bearer ${session.token}` }
    assert.equal((await fetch(url + '/api/auth/logout', { method: 'POST', headers })).status, 200)
    assert.equal((await fetch(url + '/api/auth/me', { headers })).status, 401)
    const viewer = auth.issueSession({ id: 'viewer', role: 'Viewer' })
    assert.equal((await fetch(url + '/api/admin/users', { headers: { authorization: `Bearer ${viewer.token}` } })).status, 403)
    const fresh = await (await login('admin', 'old')).json()
    now += 8 * 60 * 60 * 1000
    assert.equal((await fetch(url + '/api/auth/me', { headers: { authorization: `Bearer ${fresh.token}` } })).status, 401)
    failPresence=true
    const successes=logs.filter(record=>record.event==='auth.login_succeeded').length
    assert.equal((await login('admin','old')).status,500)
    assert.equal(logs.filter(record=>record.event==='auth.login_succeeded').length,successes)
    failPresence=false
    for (const event of ['auth.login_failed', 'auth.login_throttled', 'auth.login_succeeded', 'auth.logout', 'auth.access_denied']) assert.ok(logs.some(record => record.event === event), event)
    const serialized = JSON.stringify(logs)
    for (const secret of ['secret-identifier', 'secret-password', 'private database failure payload', session.token, fresh.token, '1.2.3.']) assert.equal(serialized.includes(secret), false)
    for (const record of logs) assert.deepEqual(Object.keys(record).sort(), ['actorId', 'event', 'requestId', 'status', 'timestamp'].filter(key => key !== 'actorId' || record.actorId).sort())
  } finally { await new Promise(resolve => server.close(resolve)) }
})
