import { AppError } from '../errors.js'
import { randomBytes } from 'node:crypto'

const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000

export class TokenAuthenticator {
  constructor(tokenConfiguration = {}) {
    this.usersByToken = new Map(
      Object.entries(tokenConfiguration).map(([token, user]) => [
        token,
        {
          id: String(user?.id ?? ''),
          role: String(user?.role ?? ''),
          name: String(user?.name ?? user?.id ?? ''),
          permissions: normalizeStringList(user?.permissions),
          branchIds: normalizeStringList(user?.branchIds),
          datasetIds: normalizeStringList(user?.datasetIds),
        },
      ]),
    )
    this.sessions = new Map()
  }

  issueSession(user) {
    const token = randomBytes(32).toString('base64url')
    this.sessions.set(token, { user, expiresAt: Date.now() + SESSION_LIFETIME_MS })
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= Date.now() || this.sessions.size > 1024) this.sessions.delete(key)
    }
    return { token, expiresInSeconds: SESSION_LIFETIME_MS / 1000 }
  }

  revoke(request) {
    const token = bearerToken(request)
    if (token) this.sessions.delete(token)
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
    if (session && session.expiresAt <= Date.now()) this.sessions.delete(token)
    const user = session?.expiresAt > Date.now()
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

export function requireDatasetSourceDownload(user, datasetVersion) {
  if (user.role.toLowerCase() === 'administrator') return user
  const allowed = user.permissions.includes('dataset:source:download')
    && (
      user.datasetIds.includes('*')
      || user.datasetIds.includes(datasetVersion.datasetId)
      || user.branchIds.includes('*')
      || user.branchIds.includes(datasetVersion.branchId)
    )
  if (!allowed) {
    throw new AppError('Anda tidak mempunyai akses untuk mengunduh file sumber ini.', {
      code: 'forbidden',
      statusCode: 403,
    })
  }
  return user
}

export function requireBranchAccess(user, { datasetId, branchId } = {}) {
  if (user.role.toLowerCase() === 'administrator') return user
  const hasExplicitScope = user.branchIds.length > 0 || user.datasetIds.length > 0
  if (!hasExplicitScope) return user
  const allowed = user.branchIds.includes('*')
    || user.branchIds.includes(branchId)
    || user.datasetIds.includes('*')
    || user.datasetIds.includes(datasetId)
  if (!allowed) {
    throw new AppError('Anda tidak mempunyai akses ke branch dataset aktif ini.', {
      code: 'forbidden_branch',
      statusCode: 403,
    })
  }
  return user
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : []
}
