import { describe, expect, it } from 'vitest'
import { firstName, initials } from './person-name'

describe('firstName', () => {
  it('returns the first word of a plain name', () => {
    expect(firstName('Achille Ebai')).toBe('Achille')
  })

  it('skips a title at the start of the name', () => {
    expect(firstName('Dr. Achille Ebai')).toBe('Achille')
    expect(firstName('Prof Marie Ngo')).toBe('Marie')
    expect(firstName('Mme Carine Talla')).toBe('Carine')
    expect(firstName('dr achille')).toBe('achille')
  })

  it('skips several titles in a row', () => {
    expect(firstName('Prof. Dr. Paul Biya')).toBe('Paul')
  })

  it('keeps the whole name when it is only a title', () => {
    expect(firstName('Dr.')).toBe('Dr.')
  })

  it('keeps a first name that merely starts like a title', () => {
    expect(firstName('Drake Mbah')).toBe('Drake')
    expect(firstName('Mrinal Fon')).toBe('Mrinal')
  })
})

describe('initials', () => {
  it('uses the first and last words', () => {
    expect(initials('Achille Ebai')).toBe('AE')
    expect(initials('Jean Paul Essomba')).toBe('JE')
  })

  it('leaves out a title', () => {
    expect(initials('Dr. Achille Ebai')).toBe('AE')
  })

  it('handles a single word and an empty name', () => {
    expect(initials('achille')).toBe('A')
    expect(initials('   ')).toBe('?')
  })
})
