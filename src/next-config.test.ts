import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadRedirects() {
  vi.resetModules()
  const { default: cfg } = await import('../next.config')
  return cfg.redirects!()
}

describe('next.config redirects', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('never sends staging to the production host', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('BETTER_AUTH_URL', 'https://staging.clasync.online')
    expect(await loadRedirects()).toEqual([])
  })

  it('sends other production hosts to the canonical one', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('BETTER_AUTH_URL', 'https://clasync.online')
    const rules = await loadRedirects()
    expect(rules).toHaveLength(1)
    expect(rules[0]!.destination.startsWith('https://clasync.online/')).toBe(true)
  })
})
