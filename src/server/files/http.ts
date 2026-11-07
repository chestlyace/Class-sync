import { AppError } from '@/server/core/errors'
import type { FileInfo } from './service'

/** `"` `\` and anything outside printable ASCII become `_` in the plain `filename=` fallback. */
function asciiFallback(name: string): string {
  return name
    .toWellFormed()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]|["\\]/g, '_')
}

/** RFC 5987 `ext-value` encoding: percent-encode everything outside `attr-char`. */
function rfc5987(name: string): string {
  // encodeURIComponent throws on lone surrogates.
  return encodeURIComponent(name.toWellFormed()).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function contentDisposition(name: string, inline: boolean): string {
  return `${inline ? 'inline' : 'attachment'}; filename="${asciiFallback(name)}"; filename*=UTF-8''${rfc5987(name)}`
}

/**
 * The response for `GET /api/files/[fileId]`. Streams the body. The type comes from our allow-list
 * (never sniffed). Images and Word files get `CSP: sandbox` so a crafted file can't run script in
 * our origin; PDFs don't, because the sandbox stops browsers' built-in PDF viewers (PDF scripts run
 * inside the viewer, not in our origin). Content-Length only once the size has been confirmed.
 */
export function fileResponse(file: {
  info: FileInfo
  stream: ReadableStream<Uint8Array>
  inline: boolean
  confirmed: boolean
}): Response {
  const headers: Record<string, string> = {
    'Content-Type': file.info.mimeType,
    'Content-Disposition': contentDisposition(file.info.name, file.inline),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
  }
  if (file.confirmed) headers['Content-Length'] = String(file.info.sizeBytes)
  if (file.info.mimeType !== 'application/pdf') headers['Content-Security-Policy'] = 'sandbox'
  return new Response(file.stream, { status: 200, headers })
}

const STATUS: Record<AppError['code'], number> = {
  UNAUTHENTICATED: 401,
  EMAIL_UNVERIFIED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
}

/**
 * Maps errors to HTTP for the file and upload routes. Bodies are generic: an error code and, for
 * VALIDATION/CONFLICT, the reason. Never a message (FORBIDDEN must not explain itself).
 */
export function errorResponse(err: unknown, opts: { quiet?: boolean } = {}): Response {
  const headers = { 'Cache-Control': 'no-store' }
  if (!(err instanceof AppError)) {
    if (!opts.quiet) console.error('[files] unexpected error', err)
    return Response.json({ error: 'INTERNAL' }, { status: 500, headers })
  }
  const reason = typeof err.details?.reason === 'string' ? err.details.reason : undefined
  if (err.code === 'FORBIDDEN' || err.code === 'EMAIL_UNVERIFIED') {
    return Response.json({ error: 'FORBIDDEN' }, { status: 403, headers })
  }
  const status = err.code === 'VALIDATION' && reason === 'size' ? 413 : STATUS[err.code]
  const withReason = (err.code === 'VALIDATION' || err.code === 'CONFLICT') && reason
  return Response.json(withReason ? { error: err.code, reason } : { error: err.code }, { status, headers })
}
