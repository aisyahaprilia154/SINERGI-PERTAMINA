export class AppError extends Error {
  constructor(message, {
    code = 'internal_error',
    statusCode = 500,
    details,
    expose = statusCode < 500,
    cause,
  } = {}) {
    super(message, { cause })
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
    this.expose = expose
  }
}

export function asAppError(error) {
  if (error instanceof AppError) return error
  return new AppError('Terjadi kesalahan internal saat memproses import.', {
    cause: error,
  })
}
