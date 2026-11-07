import { describe, expect, it } from 'vitest'
import { resolveLocale } from './locale'

describe('resolveLocale', () => {
  it('prefers the signed-in user locale over cookie and header', () => {
    expect(resolveLocale({ userLocale: 'fr', cookie: 'en', acceptLanguage: 'en-US' })).toBe('fr')
  })

  it('uses the cookie when there is no user locale', () => {
    expect(resolveLocale({ cookie: 'fr' })).toBe('fr')
  })

  it('falls back to the Accept-Language header', () => {
    expect(resolveLocale({ acceptLanguage: 'fr-CM,fr;q=0.9,en;q=0.8' })).toBe('fr')
  })

  it('defaults to English for unsupported languages', () => {
    expect(resolveLocale({ acceptLanguage: 'de-DE' })).toBe('en')
    expect(resolveLocale({})).toBe('en')
  })

  it('ignores invalid user locale values', () => {
    expect(resolveLocale({ userLocale: 'xx' })).toBe('en')
    expect(resolveLocale({ userLocale: 'xx', cookie: 'fr' })).toBe('fr')
  })

  it('respects quality ordering in Accept-Language', () => {
    expect(resolveLocale({ acceptLanguage: 'de;q=0.9,en;q=0.5,fr;q=0.8' })).toBe('fr')
  })
})
