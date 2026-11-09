import { describe, expect, it } from 'vitest'
import { safeNextPath } from './next-path'
import { isOAuthSignIn, needsFullNavigation, oauthResumePath } from './oauth-resume'

const signed = {
  response_type: 'code',
  client_id: 'abc',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  scope: 'openid offline_access clasync:read clasync:write',
  state: 's1',
  code_challenge: 'x'.repeat(43),
  code_challenge_method: 'S256',
  resource: 'https://clasync.example/api/mcp',
  exp: '1794178447',
  ba_iat: '1794177847732',
  ba_param: ['ba_iat', 'client_id'],
  sig: 'abc=',
}

describe('oauth resume', () => {
  it('detects a signed authorization query', () => {
    expect(isOAuthSignIn(signed)).toBe(true)
    expect(isOAuthSignIn({ next: '/t/X' })).toBe(false)
    expect(isOAuthSignIn({ client_id: 'abc' })).toBe(false)
  })

  it('rebuilds the authorize request without the signature, as a safe next path', () => {
    const path = oauthResumePath(signed)!
    expect(path.startsWith('/api/auth/oauth2/authorize?')).toBe(true)
    const params = new URL(path, 'https://x').searchParams
    expect(params.get('client_id')).toBe('abc')
    expect(params.get('scope')).toBe('openid offline_access clasync:read clasync:write')
    expect(params.get('resource')).toBe('https://clasync.example/api/mcp')
    for (const k of ['sig', 'exp', 'ba_iat', 'ba_param']) expect(params.has(k)).toBe(false)
    expect(safeNextPath(path)).toBe(path)
    expect(oauthResumePath({ next: '/x' })).toBeNull()
  })

  it('route handler paths need a full navigation', () => {
    expect(needsFullNavigation('/api/auth/oauth2/authorize?x=1')).toBe(true)
    expect(needsFullNavigation('/courses/1')).toBe(false)
  })
})
