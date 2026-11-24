import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'

let testDb: Awaited<ReturnType<typeof createTestDb>>
const linkToken = vi.fn()
// The route runs on the app's own database; here it runs the real service on a test database.
vi.mock('@/server/broadcasts/unsubscribe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/broadcasts/unsubscribe')>()
  return {
    ...actual,
    unsubscribeLinkToken: (token: string) => {
      linkToken(token)
      return actual.unsubscribeByToken(testDb, token)
    },
  }
})

import { describeUnsubscribeLink, unsubscribeTokenFor } from '@/server/broadcasts/unsubscribe'
import { GET, POST } from './route'

const url = (token: string) => `http://localhost/api/unsubscribe/${encodeURIComponent(token)}`
const context = (token: string) => ({ params: Promise.resolve({ token }) })
const post = (token: string) =>
  POST(new Request(url(token), { method: 'POST', body: 'List-Unsubscribe=One-Click' }), context(token))
const get = (token: string) => GET(new Request(url(token), { method: 'GET' }), context(token))

describe('/api/unsubscribe/[token]', () => {
  beforeAll(async () => {
    testDb = await createTestDb()
  })
  beforeEach(() => {
    linkToken.mockReset()
  })

  /** 'valid' while announcements are on, 'already' once they are off (a read that changes nothing). */
  const linkState = (token: string) => describeUnsubscribeLink(token, { db: testDb })

  it('POST answers 200 for an unknown or malformed token and changes nothing', async () => {
    const person = await makeUser(testDb)
    const real = await unsubscribeTokenFor(testDb, person.id)

    for (const token of ['A'.repeat(32), 'short', 'has spaces in it and is long enough', "x'; drop table user; --xxxxxxxx"]) {
      const response = await post(token)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('')
    }
    expect(linkToken).toHaveBeenCalledTimes(4)
    expect(await linkState(real)).toBe('valid')
  })

  it('POST with a real token turns announcements off', async () => {
    const person = await makeUser(testDb)
    const token = await unsubscribeTokenFor(testDb, person.id)

    expect((await post(token)).status).toBe(200)
    expect(await linkState(token)).toBe('already')
  })

  it('GET redirects to the unsubscribe page with 303 and changes nothing', async () => {
    const person = await makeUser(testDb)
    const token = await unsubscribeTokenFor(testDb, person.id)

    const response = await get(token)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`/unsubscribe/${token}`)
    expect(linkToken).not.toHaveBeenCalled()
    expect(await linkState(token)).toBe('valid')
  })
})
