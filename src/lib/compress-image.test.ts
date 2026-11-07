import { describe, expect, it } from 'vitest'
import { shouldCompress } from './compress-image'

const MB = 1024 * 1024

describe('shouldCompress', () => {
  it('compresses a 2 MB JPEG', () => {
    expect(shouldCompress({ type: 'image/jpeg', size: 2 * MB })).toBe(true)
  })

  it('leaves a 1 MB JPEG alone', () => {
    expect(shouldCompress({ type: 'image/jpeg', size: 1 * MB })).toBe(false)
  })

  it('leaves HEIC alone, whatever its size (browsers cannot draw it on a canvas)', () => {
    expect(shouldCompress({ type: 'image/heic', size: 3 * MB })).toBe(false)
    expect(shouldCompress({ type: 'image/heif', size: 3 * MB })).toBe(false)
  })

  it('never touches a PDF or a Word file', () => {
    expect(shouldCompress({ type: 'application/pdf', size: 5 * MB })).toBe(false)
    expect(
      shouldCompress({ type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 5 * MB }),
    ).toBe(false)
  })

  it('compresses large PNG and WebP images too', () => {
    expect(shouldCompress({ type: 'image/png', size: 2 * MB })).toBe(true)
    expect(shouldCompress({ type: 'image/webp', size: 2 * MB })).toBe(true)
  })

  it('reads the type case-insensitively and rejects nonsense sizes', () => {
    expect(shouldCompress({ type: 'IMAGE/JPEG', size: 2 * MB })).toBe(true)
    expect(shouldCompress({ type: 'image/jpeg', size: Number.NaN })).toBe(false)
  })
})
