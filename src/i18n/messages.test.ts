import { describe, expect, it } from 'vitest'
import en from '../../messages/en.json'
import fr from '../../messages/fr.json'

function flatten(obj: unknown, prefix = ''): Record<string, unknown> {
  if (obj === null || typeof obj !== 'object') return { [prefix]: obj }
  return Object.entries(obj as Record<string, unknown>).reduce<Record<string, unknown>>(
    (acc, [key, value]) => Object.assign(acc, flatten(value, prefix ? `${prefix}.${key}` : key)),
    {},
  )
}

describe('messages', () => {
  const flatEn = flatten(en)
  const flatFr = flatten(fr)

  it('has the same key paths in en and fr', () => {
    expect(Object.keys(flatFr).sort()).toEqual(Object.keys(flatEn).sort())
  })

  it('has no empty strings', () => {
    for (const [file, flat] of [['en', flatEn], ['fr', flatFr]] as const) {
      for (const [key, value] of Object.entries(flat)) {
        expect(typeof value, `${file}:${key}`).toBe('string')
        expect((value as string).trim(), `${file}:${key}`).not.toBe('')
      }
    }
  })

  it('has an errors entry for every ErrorCode', () => {
    const codes = ['UNAUTHENTICATED', 'EMAIL_UNVERIFIED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'CONFLICT']
    for (const code of codes) {
      expect(flatEn[`errors.${code}`], code).toBeTruthy()
      expect(flatFr[`errors.${code}`], code).toBeTruthy()
    }
  })

  it('has the required namespaces', () => {
    for (const ns of ['common', 'auth', 'nav', 'schools', 'classes', 'courses', 'errors']) {
      expect(Object.keys(en)).toContain(ns)
      expect(Object.keys(fr)).toContain(ns)
    }
  })
})
