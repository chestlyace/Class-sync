import { formString } from '@/lib/form-data'
import { MAX_RICH_TEXT_BYTES } from '@/server/assignments/rules'
import { parseLinkUrl, parseTitle } from '@/server/notes/rules'

export type ItemKind = 'note' | 'file' | 'link'
export const ITEM_KINDS: readonly ItemKind[] = ['note', 'file', 'link']
export const isItemKind = (value: unknown): value is ItemKind => ITEM_KINDS.includes(value as ItemKind)

export type ItemFormValue =
  | { kind: 'note'; title: string; body: unknown }
  | { kind: 'file'; title: string; fileId: string }
  | { kind: 'link'; title: string; url: string }

export type ParsedItemForm = { ok: true; value: ItemFormValue } | { ok: false; fields: string[] }

/** The rich-text document posted as JSON in a hidden field; the size is checked before parsing. */
function parseBody(raw: string): unknown[] | null {
  if (new TextEncoder().encode(raw).length > MAX_RICH_TEXT_BYTES) return null
  try {
    const body: unknown = JSON.parse(raw)
    return Array.isArray(body) ? body : null
  } catch {
    return null
  }
}

/**
 * Reads the note, file or link form. Every bad field is reported together; the service checks the
 * values again (sanitising the note, claiming the file).
 */
export function parseItemForm(kind: ItemKind, data: FormData): ParsedItemForm {
  const fields: string[] = []
  const title = parseTitle(formString(data, 'title'))
  if (title === null) fields.push('title')

  if (kind === 'note') {
    const body = parseBody(formString(data, 'body'))
    if (body === null) fields.push('body')
    return fields.length > 0 || title === null ? { ok: false, fields } : { ok: true, value: { kind, title, body } }
  }
  if (kind === 'link') {
    const url = parseLinkUrl(formString(data, 'url'))
    if (url === null) fields.push('url')
    return fields.length > 0 || title === null || url === null
      ? { ok: false, fields }
      : { ok: true, value: { kind, title, url } }
  }
  const fileId = formString(data, 'fileId')
  if (fileId === '' || fileId.length > 100) fields.push('file')
  return fields.length > 0 || title === null ? { ok: false, fields } : { ok: true, value: { kind, title, fileId } }
}
