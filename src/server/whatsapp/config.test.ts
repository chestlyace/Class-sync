import { describe, expect, it } from 'vitest'
import { isAllowedWhatsAppNumber, normalizePhone, whatsAppConfig } from './config'

const full = {
  WHATSAPP_AWS_REGION: 'eu-west-1',
  WHATSAPP_AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/clasync',
  WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id-0123',
  WHATSAPP_DISPLAY_NUMBER: '+237600000000',
  WHATSAPP_SNS_TOPIC_ARN: 'arn:aws:sns:eu-west-1:123456789012:wa',
}

describe('whatsAppConfig', () => {
  it('reads all required variables', () => {
    expect(whatsAppConfig(full)).toEqual({
      region: 'eu-west-1',
      roleArn: full.WHATSAPP_AWS_ROLE_ARN,
      phoneNumberId: full.WHATSAPP_PHONE_NUMBER_ID,
      displayNumber: '+237600000000',
      topicArn: full.WHATSAPP_SNS_TOPIC_ARN,
      cap: 2000,
    })
  })

  it('is null when one variable is missing', () => {
    expect(whatsAppConfig({ ...full, WHATSAPP_PHONE_NUMBER_ID: '' })).toBeNull()
    expect(whatsAppConfig({ ...full, WHATSAPP_SNS_TOPIC_ARN: undefined })).toBeNull()
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
