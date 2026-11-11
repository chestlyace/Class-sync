import { describe, expect, it } from 'vitest'
import { sentryEnvironment } from './sentry-environment'

describe('sentryEnvironment', () => {
  it('names production', () => {
    expect(sentryEnvironment('production', 'main')).toBe('production')
  })

  it('names the Development preview staging, and other previews preview', () => {
    expect(sentryEnvironment('preview', 'Development')).toBe('staging')
    expect(sentryEnvironment('preview', 'feat/sentry')).toBe('preview')
    expect(sentryEnvironment('preview', undefined)).toBe('preview')
  })

  it('treats anything off Vercel as development', () => {
    expect(sentryEnvironment(undefined, undefined)).toBe('development')
    expect(sentryEnvironment('development', 'main')).toBe('development')
  })
})
