'use client'

import { Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useState } from 'react'
import { FileUploader, type FileInfo } from '@/components/file-uploader'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import type { ActionResult } from '@/lib/action-result'
import { submitWith } from '@/lib/form-submit'
import { MAX_FILE_BYTES, MAX_FILES } from '@/server/assignments/rules'
import { bulkUploadAction } from './notes-actions'
import { NotesError } from './notes-error'

/**
 * Picks several resource files in one go. Each confirmed file is sent as a separate `fileId`; the
 * server creates one note per file in the topic and names it after the file when no title is given.
 */
export function BulkUploadDialog({ courseId, topicId }: { courseId: string; topicId: string }) {
  const t = useTranslations('notes.lecturer.bulk')
  const tCommon = useTranslations('common')
  const tForm = useTranslations('notes.lecturer.form')
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<FileInfo[]>([])
  const [uploading, setUploading] = useState(false)
  const [state, dispatch, pending] = useActionState(
    (prev: ActionResult<null> | null, data: FormData) => bulkUploadAction(courseId, topicId, prev, data),
    null,
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setFiles([])
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-11 border-dashed">
          <Upload aria-hidden="true" data-icon="inline-start" />
          {t('open')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tCommon('close')} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-4">
          {files.map((file) => (
            <input key={file.id} type="hidden" name="fileId" value={file.id} />
          ))}
          <input type="hidden" name="fallbackTitle" value={tForm('untitled')} />
          <Field data-invalid={state && !state.ok ? true : undefined}>
            <FieldLabel id="bulk-files-label">{t('files')}</FieldLabel>
            <FileUploader
              purpose="resource"
              max={MAX_FILES}
              value={files}
              onChange={setFiles}
              onBusyChange={setUploading}
              labelledBy="bulk-files-label"
            />
            <FieldDescription>{t('hint', { max: MAX_FILES, maxMb: MAX_FILE_BYTES / 1024 / 1024 })}</FieldDescription>
          </Field>
          <NotesError state={state} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="lg">
                {tCommon('cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" size="lg" pending={pending} disabled={uploading || files.length === 0}>
              {files.length === 0 ? t('submit') : t('submitMany', { count: files.length })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
