import { createElement } from 'react'
import { Resend } from 'resend'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/server/db'
import { opsEvent, user } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { makeUser } from '@/test/factories'
import { setEmailDbForTests } from './db'
import { sendEmail } from './send'

vi.mock('resend', () => ({ Resend: vi.fn() }))

const message = { to: 'ada@example.com', subject: 'Hello', react: createElement('p', null, 'Hi'), kind: 'verify' as const }

let db: Db
beforeAll(async () => {
  db = await createTestDb()
  setEmailDbForTests(db)
})
afterAll(() => setEmailDbForTests(null))
beforeEach(async () => {
  await db.delete(opsEvent)
})

describe('sendEmail without RESEND_API_KEY', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('throws a clear error in production instead of silently dropping the email', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RESEND_API_KEY', '')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await expect(sendEmail(message)).rejects.toThrow(/RESEND_API_KEY is not set/)
    expect(info).not.toHaveBeenCalled()
  })

  it('logs recipient and subject (never the body) and resolves outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('RESEND_API_KEY', '')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await expect(sendEmail(message)).resolves.toBeUndefined()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('not sent'), { to: 'ada@example.com', subject: 'Hello' })
  })
})

describe('sendEmail with EMAIL_ALLOWLIST', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('skips a recipient who is not on the list, without sending or throwing', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('EMAIL_ALLOWLIST', 'other@example.com')
    vi.stubEnv('RESEND_API_KEY', 're_test')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await expect(sendEmail(message)).resolves.toBeUndefined()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('EMAIL_ALLOWLIST'), { to: 'ada@example.com', subject: 'Hello' })
    expect(Resend).not.toHaveBeenCalled()
  })
})

describe('sendEmail health events and suspension', () => {
  const send = vi.fn()
  beforeEach(() => {
    send.mockReset()
    vi.mocked(Resend).mockImplementation(function () {
      return { emails: { send } } as unknown as Resend
    })
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('VERCEL_ENV', 'production')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('records email_sent with the kind and a masked address', async () => {
    send.mockResolvedValue({ data: { id: 'x' }, error: null })
    await sendEmail(message)
    const rows = await db.select().from(opsEvent)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'email_sent', ok: true, detail: { kind: 'verify', to: 'a***@example.com' } })
    expect(JSON.stringify(rows[0]!.detail)).not.toContain('ada@')
  })

  it('sets the reply-to to support@, or to SUPPORT_EMAIL when set', async () => {
    send.mockResolvedValue({ data: { id: 'x' }, error: null })
    await sendEmail(message)
    expect(send.mock.calls[0]![0]).toMatchObject({ replyTo: 'support@clasync.online' })
    vi.stubEnv('SUPPORT_EMAIL', 'help@example.com')
    await sendEmail(message)
    expect(send.mock.calls[1]![0]).toMatchObject({ replyTo: 'help@example.com' })
  })

  it('records email_failed and still throws when Resend reports an error', async () => {
    send.mockResolvedValue({ data: null, error: { message: 'domain not verified' } })
    await expect(sendEmail(message)).rejects.toThrow('Failed to send email: domain not verified')
    const rows = await db.select().from(opsEvent)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'email_failed',
      ok: false,
      detail: { kind: 'verify', to: 'a***@example.com', error: 'domain not verified' },
    })
  })

  it('records nothing when no key is set or the recipient is not allowed', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('NODE_ENV', 'development')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    await sendEmail(message)
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('EMAIL_ALLOWLIST', 'other@example.com')
    await sendEmail(message)
    expect(await db.select().from(opsEvent)).toHaveLength(0)
  })

  it('records email_failed and throws the real error when the provider error has no message', async () => {
    send.mockResolvedValue({ data: null, error: {} })
    await expect(sendEmail(message)).rejects.toThrow('Failed to send email')
    expect(await db.select().from(opsEvent)).toMatchObject([{ kind: 'email_failed', ok: false, detail: { error: '' } }])
  })

  it('sends nothing and records nothing to a suspended user', async () => {
    // Stored lower-cased, as Better Auth does; the address to send to may be spelled otherwise.
    const u = await makeUser(db, { email: 'suspended@example.com' })
    await db.update(user).set({ suspendedAt: new Date() }).where(eq(user.id, u.id))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await expect(sendEmail({ ...message, to: 'Suspended@Example.com' })).resolves.toBeUndefined()
    expect(send).not.toHaveBeenCalled()
    expect(await db.select().from(opsEvent)).toHaveLength(0)
    expect(JSON.stringify(info.mock.calls).toLowerCase()).not.toContain('suspended@')
  })

  it('does not change what happens when recording fails', async () => {
    send.mockResolvedValue({ data: { id: 'x' }, error: null })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setEmailDbForTests({
      ...db,
      select: db.select.bind(db),
      insert: () => {
        throw new Error('db gone')
      },
    } as unknown as Db)
    try {
      await expect(sendEmail(message)).resolves.toBeUndefined()
    } finally {
      setEmailDbForTests(db)
    }
  })
})
