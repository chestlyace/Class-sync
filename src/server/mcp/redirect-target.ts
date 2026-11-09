/**
 * Where an authorization code will be sent, described for the consent page. Anyone can register
 * an OAuth client under any name and logo, so the page shows the destination itself and warns
 * when it isn't a known assistant or an app on this computer.
 */
export type RedirectTarget = {
  /** What the lecturer reads: `claude.ai`, `localhost:33418`, `cursor://anysphere.cursor-mcp`. */
  display: string
  kind: 'assistant' | 'loopback' | 'other'
}

/** Hosted assistants whose callbacks need no warning (the domain or any subdomain, https only). */
export const KNOWN_ASSISTANT_DOMAINS = ['claude.ai', 'claude.com', 'chatgpt.com', 'openai.com']

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function isKnownAssistantHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return KNOWN_ASSISTANT_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))
}

/** Null when the URI can't be parsed (the consent page then refuses the request). */
export function describeRedirect(uri: string): RedirectTarget | null {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  if (url.protocol === 'https:' || url.protocol === 'http:') {
    if (LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return { display: url.host, kind: 'loopback' }
    const kind = url.protocol === 'https:' && isKnownAssistantHost(url.hostname) ? 'assistant' : 'other'
    return { display: url.host, kind }
  }
  // Custom scheme (a native app): show the scheme and whatever names the app.
  return { display: url.host ? `${url.protocol}//${url.host}` : url.protocol, kind: 'other' }
}

function stripLoopbackPort(uri: string): string | null {
  try {
    const url = new URL(uri)
    if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return null
    url.port = ''
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Whether `requested` is one of the client's registered redirect URIs, the way the OAuth
 * provider matches them: exactly, or for http loopback URIs with any port (RFC 8252).
 */
export function isRegisteredRedirect(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true
  const bare = stripLoopbackPort(requested)
  return bare !== null && registered.some((r) => stripLoopbackPort(r) === bare)
}
