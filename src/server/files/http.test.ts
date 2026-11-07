import { describe, expect, it } from 'vitest'
import { AppError } from '@/server/core/errors'
import { contentDisposition, errorResponse, fileResponse } from './http'

describe('contentDisposition', () => {
  it('gives an ASCII fallback and an RFC 5987 UTF-8 name', () => {
    expect(contentDisposition('Énoncé TP "1".pdf', true)).toBe(
      `inline; filename="Enonce TP _1_.pdf"; filename*=UTF-8''%C3%89nonc%C3%A9%20TP%20%221%22.pdf`,
    )
    expect(contentDisposition("l'essai (v2).docx", false)).toBe(
      `attachment; filename="l'essai (v2).docx"; filename*=UTF-8''l%27essai%20%28v2%29.docx`,
    )
  })
  it('never lets a name break out of the header', () => {
    const header = contentDisposition('a\r\nSet-Cookie: x=1;\\.pdf', false)
    expect(header).not.toMatch(/[\r\n]/)
    expect(header.startsWith('attachment; filename="a__Set-Cookie: x=1;_.pdf"; ')).toBe(true)
  })
})

describe('fileResponse', () => {
  it('sets the safety headers', () => {
    const res = fileResponse(
      { info: { id: 'f', name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 3 }, stream: new ReadableStream(), inline: true },
    )
    expect(res.status).toBe(200)
    expect(Object.fromEntries(res.headers)).toMatchObject({
      'content-type': 'application/pdf',
      'content-length': '3',
      'content-disposition': `inline; filename="a.pdf"; filename*=UTF-8''a.pdf`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': 'sandbox',
    })
  })
})

describe('errorResponse', () => {
  it('maps AppError codes to HTTP statuses with generic bodies', async () => {
    const cases: [AppError | Error, number][] = [
      [new AppError('UNAUTHENTICATED'), 401],
      [new AppError('FORBIDDEN', 'secret detail about file 123'), 403],
      [new AppError('EMAIL_UNVERIFIED'), 403],
      [new AppError('NOT_FOUND'), 404],
      [new AppError('VALIDATION', 'x', { reason: 'type' }), 400],
      [new AppError('VALIDATION', 'x', { reason: 'size' }), 413],
      [new AppError('CONFLICT', 'x', { reason: 'closed' }), 409],
      [new Error('boom'), 500],
    ]
    for (const [err, status] of cases) {
      const res = errorResponse(err, { quiet: true })
      expect(res.status, String(err.message)).toBe(status)
      const body = await res.text()
      expect(body).not.toContain('secret')
      expect(body).not.toContain('boom')
    }
    expect(await errorResponse(new AppError('VALIDATION', 'x', { reason: 'type' })).json()).toEqual({
      error: 'VALIDATION',
      reason: 'type',
    })
  })
})
