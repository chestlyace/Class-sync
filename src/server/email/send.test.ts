import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendEmail } from './send'

const message = { to: 'ada@example.com', subject: 'Hello', react: createElement('p', null, 'Hi') }

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
