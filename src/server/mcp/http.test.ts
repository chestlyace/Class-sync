import { z } from 'zod'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
import { AppError } from '@/server/core/errors'
import type { Db } from '@/server/db'
import { createTestDb } from '@/test/db'
import { ctxFor, makeUser } from '@/test/factories'
import { createTestAuth, registerClient, runOAuthFlow, signUp, TEST_ORIGIN } from '@/test/mcp-oauth'
import type { McpAuthDeps, McpCaller } from './auth'
import { createAccessToken, type AuthInstance } from './connections'
import { handleMcpPost, mcpMethodNotAllowed, mcpPreflight } from './http'
import { runTool } from './server'
import { defineTool } from './tool'

type RpcResponse = { jsonrpc: '2.0'; id: number; result?: Record<string, unknown>; error?: { code: number; message: string } }

let nextId = 1
function rpc(method: string, params: Record<string, unknown>, token?: string) {
  return new Request(`${TEST_ORIGIN}/api/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  })
}

/** The JSON-RPC message of a response, sent as JSON or as a server-sent event. */
async function readRpc(res: Response): Promise<RpcResponse> {
  const text = await res.text()
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter(Boolean)
    return JSON.parse(data[data.length - 1]) as RpcResponse
  }
  return JSON.parse(text) as RpcResponse
}

const INIT = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'vitest', version: '1.0.0' },
}

describe('POST /api/mcp', () => {
  let db: Db
  let auth: AuthInstance
  let deps: McpAuthDeps
  let key: string
  const original = config.requireEmailVerification

  beforeAll(async () => {
    setConfigForTests({ requireEmailVerification: false })
    db = await createTestDb()
    auth = createTestAuth(db)
    deps = { auth, db, origin: TEST_ORIGIN }
    const lecturer = ctxFor(db, await makeUser(db, { role: 'lecturer', name: 'Dr Ngono', email: 'ngono@example.com' }))
    key = (await createAccessToken(lecturer, { name: 'CLI', expiresInDays: 30 }, auth)).key
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })
  afterAll(() => {
    setConfigForTests({ requireEmailVerification: original })
    vi.restoreAllMocks()
  })

  it('unauthenticated: 401 with the resource metadata challenge and CORS', async () => {
    const res = await handleMcpPost(rpc('initialize', INIT), deps)
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${TEST_ORIGIN}/.well-known/oauth-protected-resource/api/mcp", scope="offline_access clasync:read clasync:write"`,
    )
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-expose-headers')).toContain('www-authenticate')
  })

  it('with a personal access token: initialize, tools/list, then tools/call whoami', async () => {
    const init = await handleMcpPost(rpc('initialize', INIT, key), deps)
    expect(init.status).toBe(200)
    const initMsg = await readRpc(init)
    expect(initMsg.result).toMatchObject({ serverInfo: { name: 'clasync' } })

    const list = await readRpc(await handleMcpPost(rpc('tools/list', {}, key), deps))
    const tools = (list.result?.tools ?? []) as { name: string; annotations?: { readOnlyHint?: boolean } }[]
    expect(tools.map((t) => t.name)).toContain('whoami')
    expect(tools.find((t) => t.name === 'whoami')?.annotations?.readOnlyHint).toBe(true)

    const call = await readRpc(await handleMcpPost(rpc('tools/call', { name: 'whoami', arguments: {} }, key), deps))
    expect(call.result?.isError).toBeFalsy()
    const expected = { name: 'Dr Ngono', email: 'ngono@example.com', locale: 'en', classes: 0, courses: 0 }
    expect(call.result?.structuredContent).toEqual(expected)
    expect(JSON.parse((call.result?.content as { text: string }[])[0].text)).toEqual(expected)
  }, 30_000)

  it("a student's key gets 403", async () => {
    const student = await makeUser(db, { role: 'student' })
    const { key: studentKey } = await auth.api.createApiKey({ body: { name: 's', userId: student.id } })
    const res = await handleMcpPost(rpc('tools/list', {}, studentKey), deps)
    expect(res.status).toBe(403)
  })

  it('with an OAuth access token from the authorization flow', async () => {
    const clientId = await registerClient(auth)
    const { cookie } = await signUp(auth, 'lecturer', 'oauth-route@example.com')
    const { tokens } = await runOAuthFlow(auth, { clientId, cookie })
    const call = await readRpc(await handleMcpPost(rpc('tools/call', { name: 'whoami', arguments: {} }, tokens.access_token), deps))
    expect(call.result?.structuredContent).toMatchObject({ email: 'oauth-route@example.com' })
  }, 30_000)

  it('GET is 405 and OPTIONS answers the CORS preflight', async () => {
    expect(mcpMethodNotAllowed().status).toBe(405)
    const pre = mcpPreflight()
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-headers')).toContain('authorization')
  })
})

describe('runTool', () => {
  let caller: McpCaller
  beforeAll(async () => {
    const db = await createTestDb()
    caller = { ctx: ctxFor(db, await makeUser(db, { role: 'lecturer' })), scopes: ['clasync:read'], clientId: 'c' }
  })

  const tool = (scope: 'clasync:read' | 'clasync:write', run: () => Promise<unknown>) =>
    defineTool({ name: 't', title: 'T', description: 'd', scope, input: z.object({}), run })

  it('refuses a tool whose scope the caller lacks, naming the scope', async () => {
    const run = vi.fn()
    const res = await runTool(tool('clasync:write', run), caller, {})
    expect(run).not.toHaveBeenCalled()
    expect(res.isError).toBe(true)
    expect(JSON.parse((res.content[0] as { text: string }).text)).toMatchObject({ error: 'INSUFFICIENT_SCOPE', requiredScope: 'clasync:write' })
  })

  it('maps AppError to a tool error with code, message and details', async () => {
    const res = await runTool(tool('clasync:read', async () => { throw new AppError('CONFLICT', 'Already published', { id: 'a1' }) }), caller, {})
    expect(res.isError).toBe(true)
    expect(JSON.parse((res.content[0] as { text: string }).text)).toEqual({ error: 'CONFLICT', message: 'Already published', id: 'a1' })
  })

  it('hides unknown errors behind a generic message', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await runTool(tool('clasync:read', async () => { throw new Error('db exploded: secret detail') }), caller, {})
    expect(res.isError).toBe(true)
    expect((res.content[0] as { text: string }).text).not.toContain('secret detail')
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('returns arrays as text only (structuredContent must be an object)', async () => {
    const res = await runTool(tool('clasync:read', async () => [1, 2]), caller, {})
    expect(res.structuredContent).toBeUndefined()
    expect((res.content[0] as { text: string }).text).toBe('[1,2]')
  })
})
