import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendOtp = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth-client', () => ({ authClient: { phoneNumber: { sendOtp } } }))

import { codeRequestError, requestPhoneCode, verifyWhatsAppHref } from './phone-code'

describe('codeRequestError', () => {
  it('turns each refusal of the code route into its own message', () => {
    expect(codeRequestError({ code: 'INVALID_PHONE_NUMBER', status: 400 }).messageKey).toBe('auth.whatsapp.errors.invalidNumber')
    expect(codeRequestError({ code: 'NUMBER_TAKEN', status: 400 }).messageKey).toBe('auth.whatsapp.errors.NUMBER_TAKEN')
    expect(codeRequestError({ code: 'NUMBER_NOT_ALLOWED', status: 400 }).messageKey).toBe('auth.whatsapp.errors.numberNotAllowed')
    expect(codeRequestError({ code: 'WHATSAPP_CODES_OFF', status: 404 }).messageKey).toBe('auth.whatsapp.errors.unavailable')
    expect(codeRequestError({ code: 'UNAUTHORIZED', status: 401 }).messageKey).toBe('auth.whatsapp.errors.UNAUTHORIZED')
    expect(codeRequestError({ status: 401 }).messageKey).toBe('auth.whatsapp.errors.UNAUTHORIZED')
    expect(codeRequestError({ code: 'SOMETHING_ELSE', status: 500 }).messageKey).toBe('common.genericError')
  })

  it('reports the wait of a limited request, and tells a short wait from a daily limit', () => {
    expect(codeRequestError({ code: 'PHONE_CODE_LIMITED', status: 429, retryAfter: 42 })).toEqual({
      ok: false,
      messageKey: 'auth.whatsapp.errors.codeWait',
      code: 'PHONE_CODE_LIMITED',
      retryAfter: 42,
    })
    expect(codeRequestError({ code: 'PHONE_CODE_LIMITED', status: 429, retryAfter: 40_000 })).toMatchObject({
      messageKey: 'auth.whatsapp.errors.codeLimited',
      retryAfter: 40_000,
    })
    expect(codeRequestError({ code: 'PHONE_CODE_LIMITED', status: 429 })).toMatchObject({ messageKey: 'auth.whatsapp.errors.codeLimited', retryAfter: null })
  })

  it('treats a bare 429 from the rate limiter as "too many attempts"', () => {
    expect(codeRequestError({ status: 429 }).messageKey).toBe('auth.errors.tooManyAttempts')
  })
})

describe('requestPhoneCode', () => {
  beforeEach(() => sendOtp.mockReset())

  it('sends the number in E.164 form', async () => {
    sendOtp.mockResolvedValue({ data: { message: 'code sent' }, error: null })
    expect(await requestPhoneCode('677 12 34 56')).toEqual({ ok: true, phone: '+237677123456' })
    expect(sendOtp).toHaveBeenCalledWith({ phoneNumber: '+237677123456' })
  })

  it('refuses text that is not a number without calling the server', async () => {
    expect(await requestPhoneCode('abc')).toMatchObject({ ok: false, code: 'INVALID_PHONE_NUMBER' })
    expect(sendOtp).not.toHaveBeenCalled()
  })

  it('returns the server error, and a generic one when the request itself fails', async () => {
    sendOtp.mockResolvedValueOnce({ data: null, error: { code: 'PHONE_CODE_LIMITED', status: 429, retryAfter: 30 } })
    expect(await requestPhoneCode('+237677123456')).toMatchObject({ ok: false, code: 'PHONE_CODE_LIMITED', retryAfter: 30 })
    sendOtp.mockRejectedValueOnce(new Error('offline'))
    expect(await requestPhoneCode('+237677123456')).toMatchObject({ ok: false, messageKey: 'common.genericError' })
  })
})

describe('verifyWhatsAppHref', () => {
  it('carries the number, the alerts choice and where to go next', () => {
    expect(verifyWhatsAppHref('+237677123456', { alerts: true, next: '/join/abc' })).toBe(
      '/verify-whatsapp?phone=%2B237677123456&alerts=1&next=%2Fjoin%2Fabc',
    )
  })

  it('leaves out what is not set, and the number when there is none', () => {
    expect(verifyWhatsAppHref('+237677123456')).toBe('/verify-whatsapp?phone=%2B237677123456')
    expect(verifyWhatsAppHref(null)).toBe('/verify-whatsapp')
    expect(verifyWhatsAppHref(null, { error: 'NUMBER_TAKEN' })).toBe('/verify-whatsapp?error=NUMBER_TAKEN')
  })
})
