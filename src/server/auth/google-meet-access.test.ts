import { beforeAll, describe, expect, it } from 'vitest'
import { MEET_LINK_PARAMS as SHARED_PARAMS, MEET_SCOPES } from '@/lib/google-meet-scopes'
import type { Db } from '@/server/db'
import { account } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'
import { googleMeetAccess, MEET_LINK_PARAMS } from './google-meet-access'

describe('googleMeetAccess', () => {
  let db: Db

  beforeAll(async () => {
    db = await createTestDb()
  })

  async function link(userId: string, scope: string | null, providerId = 'google') {
    const id = crypto.randomUUID()
    await db.insert(account).values({ id, accountId: `g-${id}`, providerId, userId, scope })
    return id
  }

  it('is null without a Google account', async () => {
    const u = await makeUser(db)
    expect(await googleMeetAccess(db, u.id)).toBeNull()
    await link(u.id, null, 'credential')
    expect(await googleMeetAccess(db, u.id)).toBeNull()
  })

  it('is not granted with sign-in scopes only', async () => {
    const u = await makeUser(db)
    const id = await link(u.id, 'openid,email,profile')
    expect(await googleMeetAccess(db, u.id)).toEqual({ accountId: id, granted: false })
  })

  it('is not granted with a missing scope or none stored', async () => {
    const one = await makeUser(db)
    await link(one.id, `openid,${MEET_SCOPES[0]}`)
    expect((await googleMeetAccess(db, one.id))?.granted).toBe(false)
    const none = await makeUser(db)
    await link(none.id, null)
    expect((await googleMeetAccess(db, none.id))?.granted).toBe(false)
  })

  it('is granted with both Meet scopes, comma or space separated', async () => {
    const commas = await makeUser(db)
    const a = await link(commas.id, `openid,email,${MEET_SCOPES.join(',')}`)
    expect(await googleMeetAccess(db, commas.id)).toEqual({ accountId: a, granted: true })

    const spaces = await makeUser(db)
    const b = await link(spaces.id, `openid email ${MEET_SCOPES.join(' ')}`)
    expect(await googleMeetAccess(db, spaces.id)).toEqual({ accountId: b, granted: true })
  })

  it('re-exports the link parameters', () => {
    expect(MEET_LINK_PARAMS).toBe(SHARED_PARAMS)
  })
})
