import { describe, expect, it } from 'vitest'
import { formString, optionalCoordinate } from './form-data'

function fd(entries: Record<string, string>): FormData {
  const data = new FormData()
  for (const [k, v] of Object.entries(entries)) data.set(k, v)
  return data
}

describe('formString', () => {
  it('returns the string value', () => {
    expect(formString(fd({ name: 'HND 2' }), 'name')).toBe('HND 2')
  })

  it('returns an empty string for a missing field or a file', () => {
    const data = new FormData()
    data.set('upload', new Blob(['x']))
    expect(formString(data, 'name')).toBe('')
    expect(formString(data, 'upload')).toBe('')
  })
})

describe('optionalCoordinate', () => {
  it('is undefined for a missing or blank field', () => {
    expect(optionalCoordinate(fd({}), 'latitude')).toBeUndefined()
    expect(optionalCoordinate(fd({ latitude: '  ' }), 'latitude')).toBeUndefined()
  })

  it('parses a number', () => {
    expect(optionalCoordinate(fd({ latitude: '4.0511' }), 'latitude')).toBe(4.0511)
  })

  it('throws VALIDATION naming the field for junk', () => {
    expect(() => optionalCoordinate(fd({ latitude: 'abc' }), 'latitude')).toThrow(
      expect.objectContaining({ code: 'VALIDATION', details: { fields: ['latitude'] } }),
    )
    expect(() => optionalCoordinate(fd({ longitude: 'Infinity' }), 'longitude')).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    )
  })
})
