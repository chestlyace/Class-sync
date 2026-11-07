import { redirect } from 'next/navigation'
import { describe, expect, it } from 'vitest'
import { AppError } from '@/server/core/errors'
import { toActionResult } from './action-result'

describe('toActionResult', () => {
  it('wraps a successful result', async () => {
    await expect(toActionResult(async () => ({ id: 'c1' }))).resolves.toEqual({
      ok: true,
      data: { id: 'c1' },
    })
  })

  it('turns an AppError into a failure with its code and details', async () => {
    const result = await toActionResult(async () => {
      throw new AppError('CONFLICT', 'exists', { existingSchoolId: 's1' })
    })
    expect(result).toEqual({ ok: false, code: 'CONFLICT', details: { existingSchoolId: 's1' } })
  })

  it('omits details when the AppError has none', async () => {
    const result = await toActionResult(async () => {
      throw new AppError('FORBIDDEN')
    })
    expect(result).toEqual({ ok: false, code: 'FORBIDDEN' })
    expect(result).not.toHaveProperty('details')
  })

  it('rethrows a plain Error', async () => {
    const boom = new Error('boom')
    await expect(
      toActionResult(async () => {
        throw boom
      }),
    ).rejects.toBe(boom)
  })

  it("lets Next's redirect through", async () => {
    await expect(
      toActionResult(async () => {
        redirect('/classes/c1')
      }),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
  })
})
