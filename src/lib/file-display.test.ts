import { describe, expect, it } from 'vitest'
import { displayKind } from './file-display'

describe('displayKind', () => {
  it('shows PDFs in a frame', () => {
    expect(displayKind('application/pdf')).toBe('pdf')
  })

  it('shows JPEG, PNG and WebP as images', () => {
    expect(displayKind('image/jpeg')).toBe('image')
    expect(displayKind('image/png')).toBe('image')
    expect(displayKind('IMAGE/WEBP ')).toBe('image')
  })

  it('offers HEIC/HEIF and Word files as downloads', () => {
    expect(displayKind('image/heic')).toBe('download')
    expect(displayKind('image/heif')).toBe('download')
    expect(displayKind('application/msword')).toBe('download')
    expect(displayKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('download')
    expect(displayKind('')).toBe('download')
  })
})
