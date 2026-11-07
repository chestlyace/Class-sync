import { afterEach, describe, expect, it, vi } from 'vitest'
import { orEmptyOnError } from './fallback'

describe('orEmptyOnError', () => {
  afterEach(() => vi.restoreAllMocks())

  it('passes the list through when loading works', async () => {
    await expect(orEmptyOnError('open check-ins', async () => [1, 2])).resolves.toEqual([1, 2])
  })

  it('falls back to [] and logs server-side when loading fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = new Error('db down')
    await expect(
      orEmptyOnError('open check-ins', async () => {
        throw boom
      }),
    ).resolves.toEqual([])
    expect(log).toHaveBeenCalledWith('[dashboard] open check-ins failed to load', boom)
  })
})
