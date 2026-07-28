import { AppError } from '../errors.js'

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
  }

  authenticate(request) {
    const authorization = request.headers.authorization
    const match = typeof authorization === 'string'
      ? authorization.match(/^Bearer\s+(.+)$/i)
      : null
    if (!match) {
      throw new AppError('Autentikasi diperlukan.', {
        code: 'authentication_required',
        statusCode: 401,
      })
    }

    const user = this.usersByToken.get(match[1])
    if (!user?.id) {
      throw new AppError('Token autentikasi tidak valid.', {
        code: 'invalid_token',
        statusCode: 401,
      })
    }
    return user
  }
}

export function requireAdministrator(request, authenticator) {
  const user = authenticator.authenticate(request)
  if (user.role.toLowerCase() !== 'administrator') {
    throw new AppError('Hanya Administrator yang dapat mengunggah dataset.', {
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

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : []
}
