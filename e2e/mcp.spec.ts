import { createHash, randomBytes } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { EN, expectNoHorizontalScroll, signUp, userPages } from './helpers'

/**
 * AI assistants (MCP), end to end. A lecturer creates a personal access token in Settings, copies
 * it from the page and calls /api/mcp with it (initialize, then whoami); after revoking it the
 * same call is refused. The endpoint's 401 points at the protected-resource metadata. Then an
 * assistant registers itself (OAuth dynamic registration), the lecturer allows it on the consent
 * page (PKCE S256, resource = /api/mcp), the code is exchanged for a token that works on /api/mcp,
 * the assistant shows under Connected apps, and disconnecting it there makes its token useless.
 * One serial scenario per project (desktop, then 360 px mobile), with one fresh lecturer each.
 */

type RpcMessage = { jsonrpc: '2.0'; id: number; result?: Record<string, unknown>; error?: { code: number; message: string } }

const INIT = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'playwright', version: '1.0.0' } }

let nextId = 1

/** One JSON-RPC call to /api/mcp, the way an MCP client sends it. */
function mcpCall(request: APIRequestContext, token: string | null, method: string, params: Record<string, unknown>) {
  return request.post('/api/mcp', {
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': INIT.protocolVersion,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    data: { jsonrpc: '2.0', id: nextId++, method, params },
  })
}

/** The JSON-RPC message of a response sent as JSON or as server-sent events (the last `data:` line). */
async function readRpc(res: Awaited<ReturnType<typeof mcpCall>>): Promise<RpcMessage> {
  const text = await res.text()
  if ((res.headers()['content-type'] ?? '').includes('text/event-stream')) {
    const data = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
    return JSON.parse(data[data.length - 1]) as RpcMessage
  }
  return JSON.parse(text) as RpcMessage
}

/** initialize, then tools/call whoami: the name of the lecturer the token acts as. */
async function whoami(request: APIRequestContext, token: string): Promise<string> {
  const init = await mcpCall(request, token, 'initialize', INIT)
  expect(init.status(), 'initialize').toBe(200)
  expect((await readRpc(init)).result).toMatchObject({ serverInfo: { name: 'clasync' } })
  const call = await mcpCall(request, token, 'tools/call', { name: 'whoami', arguments: {} })
  expect(call.status(), 'tools/call whoami').toBe(200)
  const message = await readRpc(call)
  expect(message.result?.isError).toBeFalsy()
  return (message.result?.structuredContent as { name: string }).name
}

async function expectRefused(request: APIRequestContext, token: string) {
  const res = await mcpCall(request, token, 'tools/call', { name: 'whoami', arguments: {} })
  expect(res.status()).toBe(401)
  expect(res.headers()['www-authenticate']).toContain('resource_metadata=')
}

const tokenRow = (page: Page, name: string) => page.getByTestId('token-row').filter({ hasText: name })
const appRow = (page: Page, name: string) => page.getByTestId('app-row').filter({ hasText: name })

test('AI assistants: access tokens, OAuth consent and connected apps', async ({
  browser,
  request,
  baseURL,
  viewport,
  userAgent,
  isMobile,
  hasTouch,
  deviceScaleFactor,
}, testInfo) => {
  const run = `${Date.now().toString(36)}-${testInfo.project.name}`
  const lecturerName = 'Lea Lecturer'
  const tokenName = `Laptop CLI ${run}`
  const clientName = `E2E Assistant ${run}`
  const origin = baseURL!.replace(/\/$/, '')

  const { newUserPage, closeAll } = userPages(browser, { baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor })

  try {
    const lecturer = await newUserPage({ locale: 'en-US', permissions: ['clipboard-read', 'clipboard-write'] })

    await test.step('the lecturer signs up and finds the AI assistants section in Settings', async () => {
      await signUp(lecturer, { name: lecturerName, email: `e2e-mcp-${run}@example.test`, role: 'lecturer' }, EN)
      await lecturer.goto('/settings')
      await expect(lecturer.getByRole('heading', { level: 2, name: 'AI assistants' })).toBeVisible()
      await expect(lecturer.getByTestId('connector-url')).toHaveText(`${origin}/api/mcp`)
      // The how-tos: Claude by default, then the mcp.json snippet for other tools.
      await expect(lecturer.getByText('Choose Add custom connector and paste the URL.')).toBeVisible()
      await lecturer.getByRole('tab', { name: 'Other tools' }).click()
      await expect(lecturer.getByText('"Authorization": "Bearer <your token>"')).toBeVisible()
      await expect(lecturer.getByText('No assistant connected yet')).toBeVisible()
      await expectNoHorizontalScroll(lecturer)
    })

    let key = ''
    await test.step('creates a personal access token and copies it from the page', async () => {
      await lecturer.getByLabel('Token name', { exact: true }).fill(tokenName)
      await expect(lecturer.getByLabel('Expires', { exact: true })).toHaveValue('90')
      await lecturer.getByRole('button', { name: 'Create token', exact: true }).click()
      const shown = lecturer.getByTestId('new-token')
      await expect(shown).toHaveText(/^cls_[A-Za-z0-9]{64}$/)
      await expect(lecturer.getByText("Copy it now — you won't see it again.")).toBeVisible()
      key = (await shown.innerText()).trim()
      await lecturer.getByRole('button', { name: 'Copy the token', exact: true }).click()
      expect(await lecturer.evaluate(() => navigator.clipboard.readText())).toBe(key)

      const row = tokenRow(lecturer, tokenName)
      await expect(row).toBeVisible()
      await expect(row).toContainText(key.slice(0, 8))
      await expect(row).toContainText(/Last used\s*never/)
      // The full key is not in the list.
      await expect(row).not.toContainText(key)
      await expectNoHorizontalScroll(lecturer)

      await lecturer.getByRole('button', { name: "I've copied it", exact: true }).click()
      await expect(shown).toBeHidden()
    })

    await test.step('the token works on /api/mcp', async () => {
      expect(await whoami(request, key)).toBe(lecturerName)
    })

    await test.step('revoking it (with confirmation) makes the endpoint refuse it', async () => {
      await tokenRow(lecturer, tokenName).getByRole('button', { name: `Revoke the token ${tokenName}` }).click()
      const dialog = lecturer.getByRole('dialog')
      await expect(dialog).toContainText(`Revoke ${tokenName}?`)
      await dialog.getByRole('button', { name: 'Revoke token', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect(tokenRow(lecturer, tokenName)).toHaveCount(0)
      await expectRefused(request, key)
    })

    await test.step('unauthenticated: 401 naming the protected-resource metadata', async () => {
      const res = await mcpCall(request, null, 'initialize', INIT)
      expect(res.status()).toBe(401)
      expect(res.headers()['www-authenticate']).toContain('resource_metadata=')
      const meta = await request.get('/.well-known/oauth-protected-resource/api/mcp')
      expect(meta.status()).toBe(200)
      const body = (await meta.json()) as { resource: string }
      expect(body.resource).toMatch(/\/api\/mcp$/)
    })

    // ---- OAuth: an assistant registers, the lecturer allows it, its token works ---------------
    const as = (await (await request.get('/.well-known/oauth-authorization-server/api/auth')).json()) as {
      registration_endpoint: string
      authorization_endpoint: string
      token_endpoint: string
    }
    const redirectUri = `${origin}/e2e-oauth-callback`
    let clientId = ''
    await test.step('an assistant registers itself (dynamic client registration)', async () => {
      const res = await request.post(as.registration_endpoint, {
        headers: { origin },
        data: {
          client_name: clientName,
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        },
      })
      expect([200, 201]).toContain(res.status())
      clientId = ((await res.json()) as { client_id: string }).client_id
      expect(clientId).toBeTruthy()
    })

    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const resource = `${origin}/api/mcp`
    let code = ''
    await test.step('the lecturer allows it on the consent page and is sent back with a code', async () => {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'openid offline_access clasync:read clasync:write',
        state: `state-${run}`,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource,
      })
      await lecturer.goto(`${as.authorization_endpoint}?${params}`)
      await expect(lecturer).toHaveURL(/\/oauth\/consent\?/)
      await expect(lecturer.getByRole('heading', { name: 'Connect your assistant' })).toBeVisible()
      await expect(lecturer.getByText(clientName)).toBeVisible()
      await expectNoHorizontalScroll(lecturer)
      await lecturer.getByRole('button', { name: 'Allow', exact: true }).click()
      // The callback is on the app's origin and 404s: only its URL matters.
      await lecturer.waitForURL((url) => url.pathname === '/e2e-oauth-callback')
      const back = new URL(lecturer.url())
      expect(back.searchParams.get('state')).toBe(`state-${run}`)
      code = back.searchParams.get('code') ?? ''
      expect(code).toBeTruthy()
    })

    let accessToken = ''
    await test.step('the code is exchanged for a token that works on /api/mcp', async () => {
      const res = await request.post(as.token_endpoint, {
        headers: { origin },
        form: {
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: verifier,
          resource,
        },
      })
      expect(res.status()).toBe(200)
      accessToken = ((await res.json()) as { access_token: string }).access_token
      expect(accessToken).toBeTruthy()
      expect(await whoami(request, accessToken)).toBe(lecturerName)
    })

    await test.step('Connected apps lists the assistant; disconnecting it refuses its token', async () => {
      await lecturer.goto('/settings')
      const row = appRow(lecturer, clientName)
      await expect(row).toBeVisible()
      await expect(row).toContainText('Read')
      await expect(row).toContainText('Draft')
      await expect(row).toContainText('Connected')
      await expectNoHorizontalScroll(lecturer)
      await row.getByRole('button', { name: `Disconnect ${clientName}` }).click()
      const dialog = lecturer.getByRole('dialog')
      await expect(dialog).toContainText('loses access to Clasync immediately')
      await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect(appRow(lecturer, clientName)).toHaveCount(0)
      await expect(lecturer.getByText('No assistant connected yet')).toBeVisible()
      await expectRefused(request, accessToken)
    })
  } finally {
    await closeAll()
  }
})
