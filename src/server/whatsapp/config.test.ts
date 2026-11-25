import { describe, expect, it } from 'vitest'
import { isAllowedWhatsAppNumber, normalizePhone, whatsAppConfig, whatsAppVerificationEnabled } from './config'

const full = {
  WHATSAPP_AWS_REGION: 'eu-west-1',
  WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id-0123',
  WHATSAPP_DISPLAY_NUMBER: '+237600000000',
  WHATSAPP_SNS_TOPIC_ARN: 'arn:aws:sns:eu-west-1:123456789012:wa',
  AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  AWS_SECRET_ACCESS_KEY: 'secret-example',
}

describe('whatsAppConfig', () => {
  it('reads the four required variables and signs in with the access key', () => {
    expect(whatsAppConfig(full)).toEqual({
      region: 'eu-west-1',
      roleArn: null,
      accessKey: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret-example' },
      phoneNumberId: full.WHATSAPP_PHONE_NUMBER_ID,
      displayNumber: '+237600000000',
      topicArn: full.WHATSAPP_SNS_TOPIC_ARN,
      cap: 2000,
    })
  })

  it('is null when one required variable is missing', () => {
    expect(whatsAppConfig({ ...full, WHATSAPP_PHONE_NUMBER_ID: '' })).toBeNull()
    expect(whatsAppConfig({ ...full, WHATSAPP_SNS_TOPIC_ARN: undefined })).toBeNull()
    expect(whatsAppConfig({ ...full, WHATSAPP_AWS_REGION: ' ' })).toBeNull()
    expect(whatsAppConfig({ ...full, WHATSAPP_DISPLAY_NUMBER: undefined })).toBeNull()
  })

  it('is null without a way to sign in to AWS', () => {
    expect(whatsAppConfig({ ...full, AWS_SECRET_ACCESS_KEY: '' })).toBeNull()
    expect(whatsAppConfig({ ...full, AWS_ACCESS_KEY_ID: undefined })).toBeNull()
  })

  it('uses a role on Vercel and ignores the runtime\'s own AWS keys there', () => {
    const roleArn = 'arn:aws:iam::123456789012:role/clasync'
    expect(whatsAppConfig({ ...full, VERCEL: '1' })).toBeNull()
    expect(whatsAppConfig({ ...full, VERCEL: '1', WHATSAPP_AWS_ROLE_ARN: roleArn })).toMatchObject({ roleArn, accessKey: null })
  })

  it('stays off on staging and previews, on in production', () => {
    expect(whatsAppConfig({ ...full, APP_ENV: 'staging' })).toBeNull()
    expect(whatsAppConfig({ ...full, VERCEL_ENV: 'preview' })).toBeNull()
    expect(whatsAppConfig({ ...full, APP_ENV: 'production' })).not.toBeNull()
  })

  it('reads the monthly cap and falls back to 2000 when invalid', () => {
    expect(whatsAppConfig({ ...full, WHATSAPP_MONTHLY_CAP: '500' })?.cap).toBe(500)
    expect(whatsAppConfig({ ...full, WHATSAPP_MONTHLY_CAP: 'abc' })?.cap).toBe(2000)
    expect(whatsAppConfig({ ...full, WHATSAPP_MONTHLY_CAP: '-5' })?.cap).toBe(2000)
  })
})

describe('isAllowedWhatsAppNumber', () => {
  const env = { WHATSAPP_ALLOWLIST: '+237600000001, +237600000002' }
  it('accepts listed numbers only', () => {
    expect(isAllowedWhatsAppNumber('+237600000001', env)).toBe(true)
    expect(isAllowedWhatsAppNumber('+237600000002', env)).toBe(true)
    expect(isAllowedWhatsAppNumber('+237699999999', env)).toBe(false)
  })
  it('matches entries written without the plus sign', () => {
    expect(isAllowedWhatsAppNumber('+237600000001', { WHATSAPP_ALLOWLIST: '237600000001' })).toBe(true)
  })
  it('allows nobody when the list has only invalid entries', () => {
    expect(isAllowedWhatsAppNumber('+237600000001', { WHATSAPP_ALLOWLIST: 'abc, 12' })).toBe(false)
  })
  it('allows everyone when the list is unset or empty', () => {
    expect(isAllowedWhatsAppNumber('+237699999999', {})).toBe(true)
    expect(isAllowedWhatsAppNumber('+237699999999', { WHATSAPP_ALLOWLIST: '  ' })).toBe(true)
  })
})

describe('normalizePhone', () => {
  it('adds the plus sign Meta leaves out', () => {
    expect(normalizePhone('237612345678')).toBe('+237612345678')
    expect(normalizePhone('+237612345678')).toBe('+237612345678')
  })
  it('rejects values that are not 8 to 15 digits', () => {
    expect(normalizePhone('12')).toBeNull()
    expect(normalizePhone('1234567890123456')).toBeNull()
    expect(normalizePhone('abc')).toBeNull()
  })
})

describe('whatsAppVerificationEnabled', () => {
  it('is off without WHATSAPP_OTP_ENABLED, even with the full config', () => {
    expect(whatsAppVerificationEnabled(full)).toBe(false)
    expect(whatsAppVerificationEnabled({ ...full, WHATSAPP_OTP_ENABLED: 'false' })).toBe(false)
  })

  it('is off on staging', () => {
    expect(whatsAppVerificationEnabled({ ...full, WHATSAPP_OTP_ENABLED: 'true', APP_ENV: 'staging' })).toBe(false)
  })

  it('is off when WhatsApp itself is not configured', () => {
    expect(whatsAppVerificationEnabled({ WHATSAPP_OTP_ENABLED: 'true' })).toBe(false)
  })

  it('is on with the full config and WHATSAPP_OTP_ENABLED=true', () => {
    expect(whatsAppVerificationEnabled({ ...full, WHATSAPP_OTP_ENABLED: 'true' })).toBe(true)
  })
})
