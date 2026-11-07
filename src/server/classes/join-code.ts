import { AppError } from '@/server/core/errors'

/** Uppercase letters and digits without the look-alikes I, O, 0 and 1. */
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const JOIN_CODE_LENGTH = 6

const MATRICULE_MIN = 2
const MATRICULE_MAX = 30

/** A random 6-character code. 256 is divisible by 32, so a byte modulo 32 is unbiased. */
export function generateJoinCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(JOIN_CODE_LENGTH))
  let code = ''
  for (const b of bytes) code += JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length]
  return code
}

/** Trim, drop spaces and dashes, uppercase. Does not validate; lookups simply fail on junk. */
export function normalizeJoinCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase()
}

/** True when `code` (already normalised) has the shape of a join code. */
export function isWellFormedJoinCode(code: string): boolean {
  return (
    code.length === JOIN_CODE_LENGTH && [...code].every((ch) => JOIN_CODE_ALPHABET.includes(ch))
  )
}

/** Trim, uppercase, collapse whitespace; 2-30 characters or `VALIDATION`. */
export function normalizeMatricule(input: string): string {
  const value = input.trim().replace(/\s+/g, ' ').toUpperCase()
  if (value.length < MATRICULE_MIN || value.length > MATRICULE_MAX) {
    throw new AppError('VALIDATION', 'Invalid input', { fields: ['matricule'] })
  }
  return value
}
