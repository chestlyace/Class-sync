'use client'

import { Check, Send, Undo2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ErrorCodeMessage } from '@/components/action-error'
import { FileUploader, type FileInfo } from '@/components/file-uploader'
import { RichTextEditor } from '@/components/rich-text-editor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import type { Locale } from '@/i18n/locale'
import type { ActionResult } from '@/lib/action-result'
import {
  clearDraft,
  draftKey,
  loadDraft,
  sameDraft,
  saveDraft,
  settleDraftAfterSubmit,
  toSubmissionDraft,
  type SubmissionDraft,
} from '@/lib/draft-store'
import { MAX_FILE_BYTES, MAX_FILES } from '@/server/assignments/rules'
import { formatSessionDate } from '../courses/attendance-format'
import { submitAssignmentAction } from './actions'

/** How often a changed answer is written to the local draft. */
const AUTOSAVE_MS = 3000

type Failure = Extract<ActionResult<unknown>, { ok: false }>

/** Service reasons with their own sentence, under `assignments.student.errors`. */
const STUDENT_REASONS = new Set([
  'files_required',
  'text_required',
  'files_not_allowed',
  'empty',
  'files',
  'count',
  'closed',
  'released',
  'too_many_pending',
])
/** File reasons the uploader already explains (`assignments.files.errors`). */
const FILE_REASONS = new Set(['type', 'size', 'mismatch'])
/** VALIDATION fields with their own sentence. */
const STUDENT_FIELDS = ['text', 'fileIds'] as const

function sameDay(a: Date, b: Date, timeZone: string): boolean {
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(d)
  return day(a) === day(b)
}

/**
 * The student's hand-in: a typed answer (BlockNote) and/or files, depending on the mode. The
 * answer and the uploaded file list are kept in a local draft (every 3 s while typing, on blur, and
 * whenever the files change), restored on the next visit, and cleared only after a successful submit.
 */
export function SubmitForm({
  userId,
  assignmentId,
  mode,
  locale,
  timeZone,
  submitted,
  submittedText,
  submittedFiles,
}: {
  userId: string
  assignmentId: string
  mode: 'files' | 'text' | 'both'
  locale: Locale
  timeZone: string
  /** The current submission, if any. */
  submitted: { at: Date; isLate: boolean } | null
  submittedText: unknown[] | null
  submittedFiles: FileInfo[]
}) {
  const t = useTranslations('assignments.student')
  const tFiles = useTranslations('assignments.files.errors')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const key = draftKey(userId, assignmentId)
  const hasText = mode !== 'files'
  const hasFiles = mode !== 'text'

  const server = useMemo<SubmissionDraft>(
    () => ({ text: submittedText, files: submittedFiles }),
    [submittedText, submittedFiles],
  )
  // `initialText` seeds the (uncontrolled) editor; `editorVersion` remounts it with new content.
  const [initialText, setInitialText] = useState<unknown[] | null>(submittedText)
  const [editorVersion, setEditorVersion] = useState(0)
  const [files, setFiles] = useState<FileInfo[]>(submittedFiles)
  const [restored, setRestored] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<Failure | 'unexpected' | null>(null)
  // `replaced`: this submit replaced earlier work (worded differently, so a same-minute replacement
  // is still announced).
  const [done, setDone] = useState<{ at: Date; isLate: boolean; replaced: boolean } | null>(null)
  const status = done ?? submitted

  // The latest values, for the autosave timer and blur handler.
  const textRef = useRef<unknown[] | null>(submittedText)
  const filesRef = useRef<FileInfo[]>(submittedFiles)
  const dirty = useRef(false)

  const flush = useCallback(() => {
    if (!dirty.current) return
    dirty.current = false
    saveDraft(key, { text: textRef.current, files: filesRef.current } satisfies SubmissionDraft)
  }, [key])

  // Restore an unsent answer that differs from what the server has.
  useEffect(() => {
    const draft = toSubmissionDraft(loadDraft(key))
    if (!draft || sameDraft(draft, server)) return
    textRef.current = draft.text
    filesRef.current = draft.files
    // Runs once after mount: the draft only exists in this browser, so it can't be server-rendered.
    /* eslint-disable react-hooks/set-state-in-effect */
    setInitialText(draft.text)
    setFiles(draft.files)
    setEditorVersion((v) => v + 1)
    setRestored(true)
    /* eslint-enable react-hooks/set-state-in-effect */
    // Only on mount: later server copies (after a submit) must not overwrite what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Autosave while typing; also when the tab is hidden (closing, switching apps on a phone).
  useEffect(() => {
    const timer = setInterval(flush, AUTOSAVE_MS)
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onHide)
      flush()
    }
  }, [flush])

  function onTextChange(doc: unknown[]) {
    textRef.current = doc
    dirty.current = true
  }

  function onFilesChange(next: FileInfo[]) {
    setFiles(next)
    filesRef.current = next
    dirty.current = true
    flush() // uploads are rare and costly to redo: keep them at once
  }

  function discard() {
    clearDraft(key)
    dirty.current = false
    textRef.current = server.text
    filesRef.current = server.files
    setInitialText(server.text)
    setFiles(server.files)
    setEditorVersion((v) => v + 1)
    setRestored(false)
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || uploading) return
    setPending(true)
    setFailure(null)
    // What is sent; the editor stays editable meanwhile, so the answer may move on before the reply.
    const sent: SubmissionDraft = { text: textRef.current, files: filesRef.current }
    const replacing = status !== null
    try {
      const fileIds = hasFiles ? sent.files.map((f) => f.id) : []
      const result = await submitAssignmentAction(assignmentId, hasText ? sent.text : null, fileIds)
      if (result.ok) {
        // Only what was sent is handed in: anything changed since stays a draft (and unsaved-dirty).
        const current: SubmissionDraft = { text: textRef.current, files: filesRef.current }
        dirty.current = settleDraftAfterSubmit(key, sent, current) === 'kept'
        setRestored(false)
        setDone({ at: new Date(result.data.submittedAt), isLate: result.data.isLate, replaced: replacing })
        router.refresh()
      } else {
        setFailure(result)
      }
    } catch {
      setFailure('unexpected')
    } finally {
      setPending(false)
    }
  }

  function failureMessage(f: Failure | 'unexpected'): React.ReactNode {
    if (f === 'unexpected') return tCommon('genericError')
    const reason = f.details?.reason
    if (typeof reason === 'string' && (f.code === 'VALIDATION' || f.code === 'CONFLICT')) {
      if (STUDENT_REASONS.has(reason)) return t(`errors.${reason}`, { max: MAX_FILES })
      if (FILE_REASONS.has(reason)) {
        return tFiles(reason, { max: MAX_FILES, maxMb: Math.round(MAX_FILE_BYTES / (1024 * 1024)) })
      }
    }
    if (f.code === 'VALIDATION') {
      const fields = Array.isArray(f.details?.fields) ? f.details.fields : []
      const field = STUDENT_FIELDS.find((name) => fields.includes(name))
      if (field) return t(`errors.${field}`)
    }
    if (f.code === 'FORBIDDEN') return t('errors.forbidden')
    return <ErrorCodeMessage code={f.code} />
  }

  const textInvalid =
    (failure !== null &&
      failure !== 'unexpected' &&
      (failure.details?.reason === 'text_required' ||
        failure.details?.reason === 'empty' ||
        (Array.isArray(failure.details?.fields) && failure.details.fields.includes('text')))) ||
    undefined

  const replaced = done?.replaced ?? false
  const statusText = status
    ? sameDay(status.at, new Date(), timeZone)
      ? t(replaced ? 'replacedAt' : 'submittedAt', { time: formatSessionDate(status.at, locale, timeZone, 'time') })
      : t(replaced ? 'replacedOn' : 'submittedOn', { date: formatSessionDate(status.at, locale, timeZone) })
    : null

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      {restored && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3">
          <p role="status" className="text-sm font-medium">
            {t('restored')}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={discard}>
            <Undo2 aria-hidden="true" data-icon="inline-start" />
            {t('discard')}
          </Button>
        </div>
      )}
      <FieldGroup>
        {hasText && (
          <Field data-invalid={textInvalid}>
            <FieldLabel id="submission-answer-label">
              {t('answer')}
              {mode === 'both' && <span className="font-normal text-muted-foreground"> ({tCommon('optional')})</span>}
            </FieldLabel>
            <div onBlur={flush}>
              <RichTextEditor
                key={editorVersion}
                value={initialText ?? []}
                onChange={onTextChange}
                locale={locale}
                ariaLabel={t('answer')}
                describedBy="submission-answer-hint"
                invalid={textInvalid}
              />
            </div>
            <FieldDescription id="submission-answer-hint">{t('answerHint')}</FieldDescription>
          </Field>
        )}
        {hasFiles && (
          <Field>
            <FieldLabel id="submission-files-label">
              {t('files')}
              {mode === 'both' && <span className="font-normal text-muted-foreground"> ({tCommon('optional')})</span>}
            </FieldLabel>
            <FileUploader
              purpose="submission"
              assignmentId={assignmentId}
              value={files}
              onChange={onFilesChange}
              onBusyChange={setUploading}
              disabled={pending}
              labelledBy="submission-files-label"
            />
          </Field>
        )}
        {failure && <FieldError>{failureMessage(failure)}</FieldError>}
      </FieldGroup>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={pending || uploading}>
          <Send aria-hidden="true" data-icon="inline-start" />
          {pending ? t('submitting') : status ? t('replace') : t('submit')}
        </Button>
        {uploading && <span className="text-sm text-muted-foreground">{t('waitForUploads')}</span>}
        {/* Always rendered, so the confirmation is announced when it appears. Its content is keyed
            by the submission time, so a second submit in the same minute is announced again. */}
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm">
          {statusText && status && (
            <span key={status.at.toISOString()} className="contents">
              <Check aria-hidden="true" className="size-4 text-primary" />
              <span className="font-medium">{statusText}</span>
              {status.isLate && <Badge variant="destructive">{t('late')}</Badge>}
            </span>
          )}
        </p>
      </div>
    </form>
  )
}
