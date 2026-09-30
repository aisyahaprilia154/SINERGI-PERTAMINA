import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const DUMMY_SALT = Buffer.alloc(16).toString('hex')

export class PostgresAccountStore {
  constructor(pool) {
    if (!pool?.query) throw new TypeError('Pool PostgreSQL wajib tersedia.')
    this.pool = pool
  }

  async verify(identifier, password) {
    const name = String(identifier ?? '').trim().toLowerCase()
    if (!name || name.length > 254 || typeof password !== 'string' || password.length > 1024) {
      return null
    }
    const result = await this.pool.query(
      `SELECT id, username, email, password_hash, role, branch_ids, dataset_ids
       FROM app_users
       WHERE active = true AND (username = $1 OR lower(email) = $1)
       LIMIT 1`,
      [name],
    )
    const account = result.rows[0]
    const [, salt, digest] = account?.password_hash?.split('$') ?? []
    const expected = digest && /^[a-f0-9]{128}$/.test(digest)
      ? Buffer.from(digest, 'hex') : Buffer.alloc(64)
    const derived = await scrypt(password, salt || DUMMY_SALT, 64)
    if (!account || !timingSafeEqual(derived, expected)) return null
    return {
      id: account.id,
      name: account.username,
      username: account.username,
      email: account.email,
      role: account.role,
      branchIds: account.branch_ids,
      datasetIds: account.dataset_ids,
      permissions: [],
    }
  }

  async save({ username, password, role, email = null, branchIds = [], datasetIds = [] }) {
    const name = String(username ?? '').trim().toLowerCase()
    if (!/^[a-z0-9._-]{1,64}$/.test(name)) throw new TypeError('Username tidak valid.')
    if (typeof password !== 'string' || !password || password.length > 1024) {
      throw new TypeError('Kata sandi tidak valid.')
    }
    if (!['Administrator', 'Viewer'].includes(role)) throw new TypeError('Role tidak valid.')
    const salt = randomBytes(16).toString('hex')
    const digest = (await scrypt(password, salt, 64)).toString('hex')
    const result = await this.pool.query(
      `INSERT INTO app_users
         (id, username, email, password_hash, role, branch_ids, dataset_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (username) DO UPDATE SET
         email = EXCLUDED.email,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         branch_ids = EXCLUDED.branch_ids,
         dataset_ids = EXCLUDED.dataset_ids,
         active = true,
         updated_at = now()
       RETURNING id, username, role`,
      [randomUUID(), name, email, `scrypt$${salt}$${digest}`, role, branchIds, datasetIds],
    )
    return result.rows[0]
  }
}
