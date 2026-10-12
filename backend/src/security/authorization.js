import { AppError } from '../errors.js'
import { randomBytes } from 'node:crypto'

const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000
export const ONLINE_TIMEOUT_MS = 90 * 1000
export const HEARTBEAT_INTERVAL_MS = 30 * 1000

export class TokenAuthenticator {
  constructor(tokenConfiguration = {}, {now=Date.now}={}) {
    this.now=now
    this.usersByToken = new Map(
      Object.entries(tokenConfiguration).map(([token, user]) => [
        token,
        {
          id: String(user?.id ?? ''),
          role: String(user?.role ?? ''),
          name: String(user?.name ?? user?.id ?? ''),        },
      ]),
    )
    this.sessions = new Map()
  }

  issueSession(user) {
    const token = randomBytes(32).toString('base64url')
    this.sessions.set(token, { user, expiresAt: this.now() + SESSION_LIFETIME_MS,lastSeenAt:this.now(),lastPersistedAt:0 })
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= this.now() || this.sessions.size > 1024) this.sessions.delete(key)
    }
    return { token, expiresInSeconds: SESSION_LIFETIME_MS / 1000 }
  }

  revoke(request) {
    const token = bearerToken(request)
    if (token) this.sessions.delete(token)
  }

  isSession(request){return this.sessions.has(bearerToken(request))}

  revokeUser(userId){
    for(const [token,session] of this.sessions)if(session.user.id===userId)this.sessions.delete(token)
  }

  updateSessionUser(request,user){const session=this.sessions.get(bearerToken(request));if(session)session.user=user}

  touch(request){
    const session=this.sessions.get(bearerToken(request));if(!session)return false
    session.lastSeenAt=this.now()
    if(this.now()-session.lastPersistedAt<HEARTBEAT_INTERVAL_MS)return false
    session.lastPersistedAt=this.now();return true
  }

  isOnline(userId){
    const now=this.now()
    return [...this.sessions.values()].some(s=>s.user.id===userId&&s.expiresAt>now&&now-s.lastSeenAt<ONLINE_TIMEOUT_MS)
  }

  authenticate(request) {
    const token = bearerToken(request)
    if (!token) {
      throw new AppError('Autentikasi diperlukan.', {
        code: 'authentication_required',
        statusCode: 401,
      })
    }

    const session = this.sessions.get(token)
    if (session && session.expiresAt <= this.now()) this.sessions.delete(token)
    const user = session?.expiresAt > this.now()
      ? session.user : this.usersByToken.get(token)
    if (!user?.id) {
      throw new AppError('Token autentikasi tidak valid.', {
        code: 'invalid_token',
        statusCode: 401,
      })
    }
    return user
  }
}

function bearerToken(request) {
  const authorization = request.headers.authorization
  return typeof authorization === 'string'
    ? authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
    : null
}

export function requireAdministrator(request, authenticator) {
  const user = authenticator.authenticate(request)
  if (user.role.toLowerCase() !== 'administrator') {
    throw new AppError('Tindakan ini hanya tersedia untuk Administrator.', {
      code: 'forbidden',
      statusCode: 403,
    })
  }
  return user
}
