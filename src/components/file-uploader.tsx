'use client'

import { FileText, Image as ImageIcon, Paperclip, Upload, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { confirmUploadAction, requestUploadAction } from '@/app/files-actions'
import { Button } from '@/components/ui/button'
import type { ActionResult } from '@/lib/action-result'
import { compressImage } from '@/lib/compress-image'
import { formatFileSize } from '@/lib/file-size'
import { ALLOWED_MIME_TYPES, extensionsFor, isAllowedFile, MAX_FILE_BYTES, MAX_FILES } from '@/server/assignments/rules'
import { isAllowedResourceFile, RESOURCE_MIME_EXTRA } from '@/server/notes/rules'
import type { FileInfo } from '@/server/files/service'
import type { UploadTarget } from '@/server/files/storage'

export type { FileInfo }

type UploadState = {
  key: string
  name: string
  /** 0–100 when known; null while the percentage is unknown (local uploads, confirming). */
  progress: number | null
  error?: ErrorKey
}

type ErrorKey =
  | 'type'
  | 'size'
  | 'mismatch'
  | 'count'
  | 'files'
  | 'name'
  | 'closed'
  | 'released'
  | 'too_many_pending'
  | 'forbidden'
  | 'session'
  | 'upload'

const RESOURCE_MIME_TYPES = [...ALLOWED_MIME_TYPES, ...Object.keys(RESOURCE_MIME_EXTRA)]
const extensionsOf = (m: string) => [...extensionsFor(m), ...(RESOURCE_MIME_EXTRA[m] ?? [])]
const acceptFor = (types: readonly string[]) =>
  [...types, ...types.flatMap((m) => extensionsOf(m).map((e) => `.${e}`))].join(',')
const ACCEPT = acceptFor(ALLOWED_MIME_TYPES)
const ACCEPT_RESOURCE = acceptFor(RESOURCE_MIME_TYPES)

/** The declared type: the browser's, or (often empty for HEIC) the one its extension stands for. */
function mimeTypeOf(file: File, types: readonly string[] = ALLOWED_MIME_TYPES): string {
  const declared = file.type.trim().toLowerCase()
  if (declared) return declared
  const dot = file.name.lastIndexOf('.')
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : ''
  return types.find((m) => extensionsOf(m).includes(ext)) ?? ''
}

/** Maps a failed files action to the message key (service reasons first). */
function errorKeyOf(result: Extract<ActionResult<unknown>, { ok: false }>): ErrorKey {
  const reason = result.details?.reason
  const fields = result.details?.fields
  if (result.code === 'VALIDATION') {
    if (reason === 'type' || reason === 'size' || reason === 'mismatch' || reason === 'count' || reason === 'files') {
      return reason
    }
    if (Array.isArray(fields) && fields.includes('name')) return 'name'
    return 'upload'
  }
  if (result.code === 'CONFLICT' && (reason === 'closed' || reason === 'released' || reason === 'too_many_pending')) {
    return reason
  }
  if (result.code === 'FORBIDDEN') return 'forbidden'
  if (result.code === 'UNAUTHENTICATED' || result.code === 'EMAIL_UNVERIFIED') return 'session'
  return 'upload'
}

let keyCounter = 0
/** A list key per picked file (crypto.randomUUID needs HTTPS, and phones on a dev LAN don't have it). */
const newKey = () => `upload-${++keyCounter}`

class UploadFailed extends Error {
  constructor(readonly key: ErrorKey) {
    super(key)
  }
}

function FileTypeIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  const Icon = mimeType.startsWith('image/') ? ImageIcon : FileText
  return <Icon aria-hidden="true" className={className} />
}

type FileUploaderProps = (
  | { purpose: 'resource' }
  | { purpose: 'assignment' | 'submission'; assignmentId: string }
) & {
  value: FileInfo[]
  onChange: (files: FileInfo[]) => void
  /** How many files at most; 1 for a resource, MAX_FILES otherwise. */
  max?: number
  disabled?: boolean
  /** Id of the visible label of this field (for the file picker button group). */
  labelledBy?: string
  /** Told when uploads start and finish, so a form can wait before saving. */
  onBusyChange?: (busy: boolean) => void
}

/**
 * Uploads files for an assignment (lecturer attachments, `purpose="assignment"`) or a submission
 * (`purpose="submission"`) or a course note resource (`purpose="resource"`, no assignment, one
 * file by default, PowerPoint allowed): request → send the bytes (local PUT, or Vercel Blob client upload) →
 * confirm. Large photos are compressed first. `value` is the list of confirmed files; `onChange`
 * receives the new list after an upload or a removal (removing only detaches the file).
 */
export function FileUploader(props: FileUploaderProps) {
  const { value, onChange, disabled = false, labelledBy, onBusyChange } = props
  const purpose = props.purpose
  const assignmentId = props.purpose === 'resource' ? undefined : props.assignmentId
  const isResource = purpose === 'resource'
  const max = props.max ?? (isResource ? 1 : MAX_FILES)
  const t = useTranslations('assignments.files')
  const maxMb = Math.round(MAX_FILE_BYTES / (1024 * 1024))
  const locale = useLocale()
  /** The message for a failed upload; a resource file may also be PowerPoint, so its type error says so. */
  const errorText = (key: ErrorKey) =>
    key === 'type' && isResource ? t('errors.typeResource') : t(`errors.${key}`, { max, maxMb })
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploads, setUploads] = useState<UploadState[]>([])
  /** One polite status line for screen readers: started, added, failed, removed. */
  const [announcement, setAnnouncement] = useState('')
  // Leaving the page cancels uploads still sending bytes, and nothing updates state afterwards.
  const mountedRef = useRef(true)
  const controllersRef = useRef(new Set<AbortController>())
  useEffect(() => {
    mountedRef.current = true
    const controllers = controllersRef.current
    return () => {
      mountedRef.current = false
      for (const controller of controllers) controller.abort()
      controllers.clear()
    }
  }, [])
  // Several uploads finish independently: each adds to the latest list, not the one it started with.
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  /** Reports a new list; the ref is updated at once so an upload finishing in the same tick builds on it. */
  function commit(next: FileInfo[]) {
    valueRef.current = next
    onChangeRef.current(next)
  }

  const inFlight = uploads.filter((u) => !u.error).length
  const busy = inFlight > 0
  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])
  const remaining = Math.max(0, max - value.length - inFlight)

  function update(key: string, patch: Partial<UploadState>) {
    if (!mountedRef.current) return
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u)))
  }

  async function sendBytes(file: File, mimeType: string, target: UploadTarget, key: string, signal: AbortSignal) {
    if (target.kind === 'local') {
      let response: Response
      try {
        response = await fetch(target.url, { method: 'PUT', body: file, headers: { 'Content-Type': mimeType }, signal })
      } catch {
        throw new UploadFailed('upload')
      }
      if (response.status === 413) throw new UploadFailed('size')
      if (response.status === 401) throw new UploadFailed('session')
      if (response.status === 403) throw new UploadFailed('forbidden')
      if (!response.ok) throw new UploadFailed('upload')
      return
    }
    try {
      const { upload } = await import('@vercel/blob/client')
      await upload(target.pathname, file, {
        access: 'private',
        handleUploadUrl: target.handleUploadUrl,
        contentType: mimeType,
        abortSignal: signal,
        onUploadProgress: ({ percentage }) => update(key, { progress: Math.round(percentage) }),
      })
    } catch {
      throw new UploadFailed('upload')
    }
  }

  async function uploadOne(original: File, key: string) {
    const controller = new AbortController()
    controllersRef.current.add(controller)
    try {
      const file = await compressImage(original)
      const mimeType = mimeTypeOf(file, isResource ? RESOURCE_MIME_TYPES : ALLOWED_MIME_TYPES)
      const allowed = isResource
        ? isAllowedResourceFile(file.name, mimeType, file.size)
        : isAllowedFile(file.name, mimeType, file.size)
      if (allowed !== 'ok') throw new UploadFailed(allowed)

      const requested = await requestUploadAction(
        assignmentId === undefined
          ? { purpose: 'resource', name: file.name, mimeType, size: file.size }
          : { purpose: purpose as 'assignment' | 'submission', assignmentId, name: file.name, mimeType, size: file.size },
      )
      if (!requested.ok) throw new UploadFailed(errorKeyOf(requested))
      const { fileId, target } = requested.data
      update(key, { progress: target.kind === 'blob' ? 0 : null })
      await sendBytes(file, mimeType, target, key, controller.signal)

      update(key, { progress: null })
      const confirmed = await confirmUploadAction(fileId)
      if (!mountedRef.current) return
      if (!confirmed.ok) throw new UploadFailed(errorKeyOf(confirmed))
      setUploads((list) => list.filter((u) => u.key !== key))
      commit([...valueRef.current.filter((f) => f.id !== confirmed.data.id), confirmed.data])
      setAnnouncement(t('announce.added', { name: original.name }))
    } catch (err) {
      if (!mountedRef.current) return
      const reason = err instanceof UploadFailed ? err.key : 'upload'
      update(key, { error: reason, progress: null })
      setAnnouncement(t('announce.failed', { name: original.name, reason: errorText(reason) }))
    } finally {
      controllersRef.current.delete(controller)
    }
  }

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = '' // the same file can be picked again after an error
    if (files.length === 0) return
    const accepted = files.slice(0, remaining)
    const rejected = files.slice(remaining)
    const started: UploadState[] = accepted.map((f) => ({ key: newKey(), name: f.name, progress: null }))
    const refused: UploadState[] = rejected.map((f) => ({
      key: newKey(),
      name: f.name,
      progress: null,
      error: 'count',
    }))
    setUploads((list) => [...list, ...started, ...refused])
    if (accepted.length === 1) setAnnouncement(t('announce.uploading', { name: accepted[0].name }))
    else if (accepted.length > 1) setAnnouncement(t('announce.uploadingMany', { count: accepted.length }))
    else setAnnouncement(t('errors.count', { max, maxMb }))
    accepted.forEach((file, i) => void uploadOne(file, started[i].key))
  }

  function remove(id: string) {
    const removed = valueRef.current.find((f) => f.id === id)
    commit(valueRef.current.filter((f) => f.id !== id))
    if (removed) setAnnouncement(t('announce.removed', { name: removed.name }))
  }

  function dismiss(key: string) {
    setUploads((list) => list.filter((u) => u.key !== key))
  }

  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {value.length > 0 && (
        <ul className="flex flex-col divide-y rounded-2xl border">
          {value.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <FileTypeIcon mimeType={f.mimeType} className="size-4 shrink-0 text-muted-foreground" />
              <a
                href={`/api/files/${encodeURIComponent(f.id)}`}
                target="_blank"
                rel="noopener"
                className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-4 hover:underline"
              >
                {f.name}
              </a>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {formatFileSize(f.sizeBytes, locale)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                aria-label={t('remove', { name: f.name })}
                title={t('remove', { name: f.name })}
                onClick={() => remove(f.id)}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {uploads.length > 0 && (
        <ul className="flex flex-col gap-2">
          {uploads.map((u) => (
            <li
              key={u.key}
              className="flex flex-col gap-1.5 rounded-2xl border px-3.5 py-2.5"
              data-error={u.error ? true : undefined}
            >
              <div className="flex items-center gap-3">
                <Paperclip aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{u.name}</span>
                {u.error ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('dismiss', { name: u.name })}
                    title={t('dismiss', { name: u.name })}
                    onClick={() => dismiss(u.key)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                ) : (
                  <span aria-hidden="true" className="shrink-0 font-mono text-xs text-muted-foreground">
                    {u.progress === null ? t('uploading') : `${u.progress} %`}
                  </span>
                )}
              </div>
              {u.error ? (
                <p className="text-sm text-destructive">
                  {errorText(u.error)}
                </p>
              ) : (
                <div
                  role="progressbar"
                  aria-label={t('progressLabel', { name: u.name })}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={u.progress ?? undefined}
                  className="h-1 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className={u.progress === null ? 'h-full w-1/3 animate-pulse rounded-full bg-primary' : 'h-full rounded-full bg-primary transition-[width]'}
                    style={u.progress === null ? undefined : { width: `${u.progress}%` }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3" role="group" aria-labelledby={labelledBy}>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={isResource ? ACCEPT_RESOURCE : ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled || remaining === 0}
          onChange={onPick}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || remaining === 0}
          onClick={() => inputRef.current?.click()}
        >
          <Upload aria-hidden="true" data-icon="inline-start" />
          {t('add')}
        </Button>
        <span className="text-sm text-muted-foreground">{t(isResource ? 'hintResource' : 'hint', { max, maxMb })}</span>
      </div>
    </div>
  )
}
