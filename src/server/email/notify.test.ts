import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendNotifications, setResendClientFactoryForTests, type Notification } from './notify'
import { runAfterResponse, setAfterResponseForTests } from '@/server/lib/after-response'

function items(n: number): Notification[] {
  return Array.from({ length: n }, (_, i) => ({
    to: `student${i}@example.com`,
    locale: i % 2 ? 'fr' : 'en',
    subject: `Subject ${i}`,
    react: createElement('p', null, `Hi ${i}`),
  }))
}

describe('sendNotifications without RESEND_API_KEY', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    setResendClientFactoryForTests(null)
  })

  it('skips everything, warns once with the count and never throws in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('RESEND_API_KEY', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(sendNotifications(items(3))).resolves.toEqual({ sent: 0, skipped: 3, failed: 0 })
    expect(warn).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).toContain('3')
    expect(logged).not.toContain('@example.com')
  })

  it('skips quietly for an empty list', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(sendNotifications([])).resolves.toEqual({ sent: 0, skipped: 0, failed: 0 })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('sendNotifications with a key', () => {
  const send = vi.fn()

  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    send.mockReset()
    setResendClientFactoryForTests(() => ({ batch: { send } }))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    setResendClientFactoryForTests(null)
  })

  it('sends 230 items in 3 batch calls of at most 100', async () => {
    send.mockResolvedValue({ data: { data: [] }, error: null })
    const result = await sendNotifications(items(230))
    expect(result).toEqual({ sent: 230, skipped: 0, failed: 0 })
    expect(send).toHaveBeenCalledTimes(3)
    expect(send.mock.calls.map((c) => c[0].length)).toEqual([100, 100, 30])
    expect(send.mock.calls[0]![0][0]).toMatchObject({ to: 'student0@example.com', subject: 'Subject 0' })
  })

  it('retries a failing batch once and counts it as failed when the retry fails too', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    send
      .mockResolvedValueOnce({ data: { data: [] }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'boom again' } })
    const result = await sendNotifications(items(150))
    expect(result).toEqual({ sent: 100, skipped: 0, failed: 50 })
    expect(send).toHaveBeenCalledTimes(3)
    expect(error).toHaveBeenCalled()
  })

  it('counts a batch as sent when the single retry succeeds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    send
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
      .mockResolvedValueOnce({ data: { data: [] }, error: null })
    await expect(sendNotifications(items(10))).resolves.toEqual({ sent: 10, skipped: 0, failed: 0 })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('never throws when the client itself throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    send.mockRejectedValue(new Error('network down'))
    await expect(sendNotifications(items(5))).resolves.toEqual({ sent: 0, skipped: 0, failed: 5 })
  })

  it('never throws when the client cannot be built', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setResendClientFactoryForTests(() => {
      throw new Error('bad key')
    })
    await expect(sendNotifications(items(2))).resolves.toEqual({ sent: 0, skipped: 0, failed: 2 })
  })
})

describe('runAfterResponse', () => {
  afterEach(() => {
    setAfterResponseForTests(null)
    vi.restoreAllMocks()
  })

  it('hands the task to the test runner', async () => {
    const captured: Array<() => Promise<void>> = []
    setAfterResponseForTests((task) => captured.push(task))
    const task = vi.fn(async () => {})
    runAfterResponse(task)
    expect(task).not.toHaveBeenCalled()
    expect(captured).toHaveLength(1)
    await captured[0]!()
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('outside a request scope falls back to fire-and-forget and logs failures', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const task = vi.fn(async () => {
      throw new Error('late failure')
    })
    expect(() => runAfterResponse(task)).not.toThrow()
    await vi.waitFor(() => expect(error).toHaveBeenCalled())
    expect(task).toHaveBeenCalledTimes(1)
  })
})
