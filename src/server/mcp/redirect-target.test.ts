import { describe, expect, it } from 'vitest'
import { describeRedirect, isRegisteredRedirect } from './redirect-target'

describe('describeRedirect', () => {
  it('known hosted assistants (https, domain or subdomain)', () => {
    expect(describeRedirect('https://claude.ai/api/mcp/auth_callback')).toEqual({ display: 'claude.ai', kind: 'assistant' })
    expect(describeRedirect('https://chatgpt.com/connector_platform_oauth_redirect')).toEqual({ display: 'chatgpt.com', kind: 'assistant' })
    expect(describeRedirect('https://platform.openai.com/cb')).toEqual({ display: 'platform.openai.com', kind: 'assistant' })
    expect(describeRedirect('https://claude.com/cb')?.kind).toBe('assistant')
  })

  it('look-alikes and plain http are not known assistants', () => {
    expect(describeRedirect('https://claude.ai.evil.example/cb')).toEqual({ display: 'claude.ai.evil.example', kind: 'other' })
    expect(describeRedirect('https://evilclaude.ai/cb')?.kind).toBe('other')
    expect(describeRedirect('http://claude.ai/cb')?.kind).toBe('other')
    expect(describeRedirect('https://attacker.example/steal')).toEqual({ display: 'attacker.example', kind: 'other' })
  })

  it('loopback apps on this computer show host and port', () => {
    expect(describeRedirect('http://localhost:33418/callback')).toEqual({ display: 'localhost:33418', kind: 'loopback' })
    expect(describeRedirect('http://127.0.0.1:9999/cb')).toEqual({ display: '127.0.0.1:9999', kind: 'loopback' })
    expect(describeRedirect('http://[::1]:8080/cb')).toEqual({ display: '[::1]:8080', kind: 'loopback' })
  })

  it('custom schemes show the scheme', () => {
    expect(describeRedirect('cursor://anysphere.cursor-mcp/oauth/callback')).toEqual({ display: 'cursor://anysphere.cursor-mcp', kind: 'other' })
    expect(describeRedirect('com.example.app:/oauth')).toEqual({ display: 'com.example.app:', kind: 'other' })
    expect(describeRedirect('not a url')).toBeNull()
  })
})

describe('isRegisteredRedirect', () => {
  it('matches exactly, or loopback http with any port', () => {
    expect(isRegisteredRedirect(['https://claude.ai/cb'], 'https://claude.ai/cb')).toBe(true)
    expect(isRegisteredRedirect(['https://claude.ai/cb'], 'https://claude.ai/cb2')).toBe(false)
    expect(isRegisteredRedirect(['http://localhost/callback'], 'http://localhost:5555/callback')).toBe(true)
    expect(isRegisteredRedirect(['http://localhost:1/callback'], 'http://localhost:2/other')).toBe(false)
    expect(isRegisteredRedirect(['https://a.example:1/cb'], 'https://a.example:2/cb')).toBe(false)
  })
})
