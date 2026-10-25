export const MIN_PASSWORD_LENGTH = 15
export const MAX_PASSWORD_LENGTH = 1024
export function validNewPassword(value) {
  return typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH && value.length <= MAX_PASSWORD_LENGTH
}
