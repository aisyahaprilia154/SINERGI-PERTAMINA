import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import {AppError} from '../errors.js'

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
      `SELECT id, username, email, password_hash, role,auth_version
       FROM sinergi.app_users
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
      authVersion:Number(account.auth_version),
    }
  }

  async resolveSession(user){
    const row=(await this.pool.query('SELECT id,username,email,role,active,auth_version FROM sinergi.app_users WHERE id=$1',[user.id])).rows[0]
    if(!row?.active||Number(row.auth_version)!==user.authVersion)throw new AppError('Sesi sudah berakhir. Masuk kembali.',{code:'session_revoked',statusCode:401})
    return {id:row.id,username:row.username,name:row.username,email:row.email,role:row.role,authVersion:Number(row.auth_version)}
  }

  async markSeen(userId){await this.pool.query('UPDATE sinergi.app_users SET last_seen_at=now() WHERE id=$1 AND active',[userId])}

  async list(){return (await this.pool.query('SELECT id,username,email,role,active,created_at,updated_at,last_seen_at FROM sinergi.app_users ORDER BY username')).rows.map(publicAccount)}

  async manage({actorId,userId=null,body={},resetPassword=false}){
    const password=body.password
    if((!userId||resetPassword)&&(typeof password!=='string'||password.length<8||password.length>1024))throw new AppError('Password harus terdiri dari 8–1024 karakter.',{code:'invalid_password',statusCode:400})
    if(!userId&&!/^[a-z0-9._-]{1,64}$/.test(String(body.username ?? '').trim().toLowerCase()))throw new AppError('Username tidak valid.',{code:'invalid_username',statusCode:400})
    if(body.role!==undefined&&!['Administrator','Viewer'].includes(body.role))throw new AppError('Role tidak valid.',{code:'invalid_role',statusCode:400})
    if(body.active!==undefined&&typeof body.active!=='boolean')throw new AppError('Status akun tidak valid.',{code:'invalid_active',statusCode:400})
    const email=body.email===undefined?undefined:String(body.email ?? '').trim().toLowerCase()||null
    if(email&&(email.length>254||!/^\S+@\S+\.\S+$/.test(email)))throw new AppError('Email tidak valid.',{code:'invalid_email',statusCode:400})
    const passwordHash=(!userId||resetPassword)?await hashPassword(password):null
    const client=await this.pool.connect()
    try{
      await client.query('BEGIN')
      // Serialize role/status changes so two administrators cannot concurrently
      // remove the final active administrator.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('sinergi.user-management'))")
      let row,event,details,revoked=false
      if(!userId){
        row=(await client.query('INSERT INTO sinergi.app_users(id,username,email,password_hash,role,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
          [randomUUID(),String(body.username).trim().toLowerCase(),email ?? null,passwordHash,body.role ?? 'Viewer',body.active ?? true])).rows[0]
        event='user.created';details={userId:row.id,username:row.username,role:row.role,active:row.active}
      }else{
        const before=(await client.query('SELECT * FROM sinergi.app_users WHERE id=$1 FOR UPDATE',[userId])).rows[0]
        if(!before)throw new AppError('Pengguna tidak ditemukan.',{code:'user_not_found',statusCode:404})
        if(body.expectedUpdatedAt!==before.updated_at.toISOString())throw new AppError('Data pengguna berubah. Muat ulang sebelum menyimpan.',{code:'user_conflict',statusCode:409})
        const next={role:body.role ?? before.role,active:body.active ?? before.active,email:email===undefined?before.email:email}
        const count=Number((await client.query("SELECT count(*) FROM sinergi.app_users WHERE active AND role='Administrator'")).rows[0].count)
        protectLastAdministrator(before,next,count)
        revoked=resetPassword||next.role!==before.role||next.active!==before.active
        row=(await client.query('UPDATE sinergi.app_users SET email=$2,role=$3,active=$4,password_hash=COALESCE($5,password_hash),auth_version=auth_version+$6,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
          [userId,next.email,next.role,next.active,passwordHash,revoked?1:0])).rows[0]
        event=resetPassword?'user.password_reset':'user.updated';details={userId,username:row.username,before:{email:before.email,role:before.role,active:before.active},after:next,sessionsRevoked:revoked}
      }
      await client.query('INSERT INTO sinergi.audit_events(id,event,actor_id,details) VALUES($1,$2,$3,$4)',[randomUUID(),event,actorId,JSON.stringify(details)])
      await client.query('COMMIT');return {user:publicAccount(row),sessionsRevoked:revoked}
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{})
      if(error.code==='23505')throw new AppError('Username atau email sudah dipakai.',{code:'user_exists',statusCode:409})
      throw error
    }finally{client.release()}
  }

  async save({ username, password, role, email = null }) {
    const name = String(username ?? '').trim().toLowerCase()
    if (!/^[a-z0-9._-]{1,64}$/.test(name)) throw new TypeError('Username tidak valid.')
    if (typeof password !== 'string' || !password || password.length > 1024) {
      throw new TypeError('Kata sandi tidak valid.')
    }
    if (!['Administrator', 'Viewer'].includes(role)) throw new TypeError('Role tidak valid.')
    const salt = randomBytes(16).toString('hex')
    const digest = (await scrypt(password, salt, 64)).toString('hex')
      const result = await this.pool.query(
        `INSERT INTO sinergi.app_users(id, username, email, password_hash, role) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(username) DO UPDATE SET email=EXCLUDED.email,password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,active=true,auth_version=sinergi.app_users.auth_version+1,updated_at=now()
         RETURNING id,username,role`, [randomUUID(),name,email,`scrypt$${salt}$${digest}`,role],
      )
      return result.rows[0]
  }
}

async function hashPassword(password){const salt=randomBytes(16).toString('hex');return `scrypt$${salt}$${(await scrypt(password,salt,64)).toString('hex')}`}
function publicAccount(row){return {id:row.id,username:row.username,email:row.email,role:row.role,active:row.active,createdAt:row.created_at,updatedAt:row.updated_at,lastSeenAt:row.last_seen_at}}
export function protectLastAdministrator(before,next,count){
  if(before.active&&before.role==='Administrator'&&(!next.active||next.role!=='Administrator')&&count<=1)throw new AppError('Administrator aktif terakhir harus tetap tersedia.',{code:'last_administrator',statusCode:409})
}
