export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'EMAIL_UNVERIFIED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'

export class AppError extends Error {
  readonly code: ErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
}
