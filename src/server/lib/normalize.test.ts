import { describe, expect, it } from 'vitest'
import { normalizeKey } from './normalize'

describe('normalizeKey', () => {
  it('collapses case and whitespace', () =>
    expect(normalizeKey('  University of   Buea ')).toBe('university of buea'))

  it('treats tabs and newlines as whitespace', () =>
    expect(normalizeKey('Buea\t\n Town')).toBe('buea town'))

  it('returns an empty string for blank input', () => expect(normalizeKey('   ')).toBe(''))

  it('folds accents so "Universite" and "Université" share a key', () => {
    expect(normalizeKey('Université de Buéa')).toBe('universite de buea')
    expect(normalizeKey('Universite de Buea')).toBe(normalizeKey('Université de Buea'))
    expect(normalizeKey('LYCÉE BILINGUE D’ÉTOUG-ÉBÉ')).toBe('lycee bilingue d’etoug-ebe')
  })

  it('gives decomposed and precomposed input the same key', () => {
    const precomposed = 'Ecole Normale Sup\u00e9rieure'
    const decomposed = 'Ecole Normale Supe\u0301rieure'
    expect(normalizeKey(decomposed)).toBe(normalizeKey(precomposed))
    expect(normalizeKey(decomposed)).toBe('ecole normale superieure')
  })
})
