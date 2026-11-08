'use client'

import { Save } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useActionState, useState } from 'react'
import { isInvalidField } from '@/components/action-error'
import { FileUploader, type FileInfo } from '@/components/file-uploader'
import { RichTextEditor } from '@/components/rich-text-editor'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { Locale } from '@/i18n/locale'
import type { ActionResult } from '@/lib/action-result'
import { submitWith } from '@/lib/form-submit'
import { createItemAction, updateItemAction } from './notes-actions'
import { NotesError } from './notes-error'
import type { ItemKind } from './notes-form'

export type ItemFormInitial = { title: string; body: unknown; url: string; file: FileInfo | null }

const EMPTY: ItemFormInitial = { title: '', body: [], url: '', file: null }

/**
 * New and edit share this form. A note is a title and a rich-text body, a file is a title and one
 * uploaded file, a link is a title and an http(s) address. Saving goes back to the notes page.
 */
export function NoteItemForm({
  kind,
  target,
  initial = EMPTY,
  locale,
  cancelHref,
}: {
  kind: ItemKind
  target: { kind: 'create'; courseId: string; topicId: string } | { kind: 'edit'; courseId: string; resourceId: string }
  initial?: ItemFormInitial
  locale: Locale
  cancelHref: string
}) {
  const t = useTranslations('notes.lecturer.form')
  const tCommon = useTranslations('common')
  const [body, setBody] = useState<unknown>(initial.body)
  const [files, setFiles] = useState<FileInfo[]>(initial.file ? [initial.file] : [])
  const [uploading, setUploading] = useState(false)
  const [state, dispatch, pending] = useActionState(
    (prev: ActionResult<never> | null, data: FormData) =>
      target.kind === 'create'
        ? createItemAction(target.courseId, target.topicId, kind, prev, data)
        : updateItemAction(target.courseId, target.resourceId, kind, prev, data),
    null,
  )
  const invalid = (field: string) => isInvalidField(state, field) || undefined

  return (
    <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-6">
      {kind === 'note' && <input type="hidden" name="body" value={JSON.stringify(body ?? [])} />}
      {kind === 'file' && files[0] && <input type="hidden" name="fileId" value={files[0].id} />}
      <FieldGroup>
        <Field data-invalid={invalid('title')}>
          <FieldLabel htmlFor="item-title">{t('title')}</FieldLabel>
          <Input
            id="item-title"
            name="title"
            required
            maxLength={200}
            defaultValue={initial.title}
            placeholder={t(`titlePlaceholder.${kind}`)}
            aria-invalid={invalid('title')}
          />
        </Field>

        {kind === 'note' && (
          <Field data-invalid={invalid('body')}>
            <FieldLabel id="item-body-label">{t('body')}</FieldLabel>
            <RichTextEditor
              value={initial.body}
              onChange={setBody}
              locale={locale}
              ariaLabel={t('body')}
              describedBy="item-body-hint"
              invalid={invalid('body')}
            />
            <FieldDescription id="item-body-hint">{t('bodyHint')}</FieldDescription>
          </Field>
        )}

        {kind === 'file' && (
          <Field data-invalid={invalid('file')}>
            <FieldLabel id="item-file-label">{t('file')}</FieldLabel>
            <FileUploader
              purpose="resource"
              value={files}
              onChange={setFiles}
              onBusyChange={setUploading}
              labelledBy="item-file-label"
            />
            {target.kind === 'edit' && <FieldDescription>{t('fileReplaceHint')}</FieldDescription>}
          </Field>
        )}

        {kind === 'link' && (
          <Field data-invalid={invalid('url')}>
            <FieldLabel htmlFor="item-url">{t('url')}</FieldLabel>
            <Input
              id="item-url"
              name="url"
              type="url"
              inputMode="url"
              required
              maxLength={2000}
              defaultValue={initial.url}
              placeholder="https://"
              aria-invalid={invalid('url')}
              aria-describedby="item-url-hint"
            />
            <FieldDescription id="item-url-hint">{t('urlHint')}</FieldDescription>
          </Field>
        )}

        <NotesError state={state} />
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={pending || uploading}>
          <Save aria-hidden="true" data-icon="inline-start" />
          {pending ? t('saving') : tCommon('save')}
        </Button>
        <Link href={cancelHref} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          {tCommon('cancel')}
        </Link>
        {uploading && <span className="text-sm text-muted-foreground">{t('waitForUploads')}</span>}
      </div>
    </form>
  )
}
