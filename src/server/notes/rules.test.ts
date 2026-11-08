import { describe, expect, it } from 'vitest'
import { MAX_FILE_BYTES } from '@/server/assignments/rules'
import { hostOf, isAllowedResourceFile, parseLinkUrl, parseTitle, swapPositions } from './rules'

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const PPT = 'application/vnd.ms-powerpoint'

describe('parseTitle', () => {
  it('trims and requires 1 to 200 characters', () => {
    expect(parseTitle('  Cell membranes ')).toBe('Cell membranes')
    expect(parseTitle('   ')).toBeNull()
    expect(parseTitle('a'.repeat(200))).toBe('a'.repeat(200))
    expect(parseTitle('a'.repeat(201))).toBeNull()
    expect(parseTitle(42)).toBeNull()
    expect(parseTitle(undefined)).toBeNull()
  })
})

describe('parseLinkUrl', () => {
  it('accepts http and https only and returns the normalised href', () => {
    expect(parseLinkUrl('javascript:alert(1)')).toBeNull()
    expect(parseLinkUrl('ftp://example.com/x')).toBeNull()
    expect(parseLinkUrl('not a url')).toBeNull()
    expect(parseLinkUrl('')).toBeNull()
    expect(parseLinkUrl(null)).toBeNull()
    expect(parseLinkUrl(' https://www.geeksforgeeks.org/dbms/ ')).toBe('https://www.geeksforgeeks.org/dbms/')
    expect(parseLinkUrl('http://example.com')).toBe('http://example.com/')
  })

  it('refuses a URL over 2000 characters', () => {
    expect(parseLinkUrl('https://example.com/' + 'a'.repeat(1980))).not.toBeNull()
    expect(parseLinkUrl('https://example.com/' + 'a'.repeat(2000))).toBeNull()
  })
})

describe('hostOf', () => {
  it('drops www.', () => {
    expect(hostOf('https://www.geeksforgeeks.org/dbms/')).toBe('geeksforgeeks.org')
    expect(hostOf('https://docs.example.com/a')).toBe('docs.example.com')
  })
})

describe('isAllowedResourceFile', () => {
  it('accepts the assignment types and PowerPoint', () => {
    expect(isAllowedResourceFile('slides.pptx', PPTX, 1000)).toBe('ok')
    expect(isAllowedResourceFile('old.ppt', PPT, 1000)).toBe('ok')
    expect(isAllowedResourceFile('notes.pdf', 'application/pdf', 1000)).toBe('ok')
  })

  it('refuses other types, mismatched extensions and big files', () => {
    expect(isAllowedResourceFile('x.exe', 'application/x-msdownload', 1000)).toBe('type')
    expect(isAllowedResourceFile('slides.ppt', PPTX, 1000)).toBe('type')
    expect(isAllowedResourceFile('slides.pptx', 'application/pdf', 1000)).toBe('type')
    expect(isAllowedResourceFile('big.pdf', 'application/pdf', 21 * 1024 * 1024)).toBe('size')
    expect(isAllowedResourceFile('ok.pdf', 'application/pdf', MAX_FILE_BYTES)).toBe('ok')
    expect(isAllowedResourceFile('empty.pdf', 'application/pdf', 0)).toBe('size')
    expect(isAllowedResourceFile('x.pptx', 'constructor', 10)).toBe('type')
  })
})

describe('swapPositions', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('moves an item up or down by one', () => {
    expect(swapPositions(list, 'b', 'up')?.map((x) => x.id)).toEqual(['b', 'a', 'c'])
    expect(swapPositions(list, 'b', 'down')?.map((x) => x.id)).toEqual(['a', 'c', 'b'])
    expect(list.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('returns null when it cannot move', () => {
    expect(swapPositions(list, 'a', 'up')).toBeNull()
    expect(swapPositions(list, 'c', 'down')).toBeNull()
    expect(swapPositions(list, 'zzz', 'up')).toBeNull()
  })
})
