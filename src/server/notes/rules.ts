import { extensionsFor, MAX_FILE_BYTES } from '@/server/assignments/rules'

export const TITLE_MAX = 200
export const URL_MAX = 2000
export const SEARCH_MAX = 100

/** Resources accept the assignment file types plus PowerPoint. */
export const RESOURCE_MIME_EXTRA: Record<string, readonly string[]> = {
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
}

/** The title trimmed, or null when it is not a string of 1 to TITLE_MAX characters. */
export function parseTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const title = raw.trim()
  return title.length >= 1 && title.length <= TITLE_MAX ? title : null
}

/** An http or https URL of at most URL_MAX characters, as its normalised href; otherwise null. */
export function parseLinkUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text.length === 0 || text.length > URL_MAX) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '') return null
  return url.href.length <= URL_MAX ? url.href : null
}

/** The host to show next to a link: the hostname without `www.`. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Checks the declared type, then that the extension matches it, then the size. */
export function isAllowedResourceFile(name: string, mimeType: string, size: number): 'ok' | 'type' | 'size' {
  const key = mimeType.trim().toLowerCase()
  const allowed = [...extensionsFor(key), ...(Object.hasOwn(RESOURCE_MIME_EXTRA, key) ? RESOURCE_MIME_EXTRA[key] : [])]
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (allowed.length === 0 || !allowed.includes(ext)) return 'type'
  if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) return 'size'
  return 'ok'
}

/** The list with `id` moved one place up or down, or null when it is missing or already at the end. */
export function swapPositions<T extends { id: string }>(list: T[], id: string, dir: 'up' | 'down'): T[] | null {
  const from = list.findIndex((item) => item.id === id)
  if (from < 0) return null
  const to = dir === 'up' ? from - 1 : from + 1
  if (to < 0 || to >= list.length) return null
  const next = [...list]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}
