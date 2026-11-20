import { beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '@/server/db'
import { verification } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'
import { describeResetLink } from './reset-link'

const HOUR = 60 * 60 * 1000

describe('describeResetLink', () => {
  let db: Db
  let email: string
  let userId: string

  beforeAll(async () => {
    db = await createTestDb()
    const user = await makeUser(db)
    email = user.email
    userId = user.id
  })

  async function addLink(token: string, expiresAt: Date) {
    await db.insert(verification).values({
      id: `v-${token}`,
      identifier: `reset-password:${token}`,
      value: userId,
      expiresAt,
    })
  }

  it('names the account of a live link, so the page can show it and password managers can save under it', async () => {
    await addLink('live-token', new Date(Date.now() + HOUR))
    expect(await describeResetLink('live-token', { db })).toEqual({ status: 'valid', email })
  })

  it('reports an expired link before anyone types a password', async () => {
    await addLink('old-token', new Date(Date.now() - HOUR))
    expect(await describeResetLink('old-token', { db })).toEqual({ status: 'invalid' })
  })

  it('reports an unknown or already used link', async () => {
    expect(await describeResetLink('no-such-token', { db })).toEqual({ status: 'invalid' })
  })

  it('reports a missing token', async () => {
    expect(await describeResetLink(null, { db })).toEqual({ status: 'invalid' })
  })

  it('does not treat another kind of link as a reset link', async () => {
    await db.insert(verification).values({ id: 'v-other', identifier: 'other-token', value: userId, expiresAt: new Date(Date.now() + HOUR) })
    expect(await describeResetLink('other-token', { db })).toEqual({ status: 'invalid' })
  })
})
