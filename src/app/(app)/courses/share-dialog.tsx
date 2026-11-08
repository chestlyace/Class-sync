'use client'

import { Share2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { NativeSelect } from '@/components/ui/native-select'
import type { ActionResult } from '@/lib/action-result'
import { formString } from '@/lib/form-data'
import { submitWith } from '@/lib/form-submit'
import { listTopicsAction, shareItemAction } from './notes-actions'
import { NotesError } from './notes-error'

type Topics = { courseId: string; result: ActionResult<{ id: string; title: string }[]> }

/**
 * "Share to another course": pick one of my other courses and one of its topics. The item stays one
 * item: editing it changes it everywhere; each course keeps its own topic, order and visibility.
 */
export function ShareDialog({
  resourceId,
  itemTitle,
  otherCourses,
  open,
  onOpenChange,
}: {
  resourceId: string
  itemTitle: string
  otherCourses: { id: string; label: string }[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations('notes.lecturer.share')
  const tCommon = useTranslations('common')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tCommon('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body', { title: itemTitle })}</DialogDescription>
        </DialogHeader>
        {otherCourses.length === 0 ? (
          <>
            <p className="text-sm text-muted-foreground">{t('noCourses')}</p>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {tCommon('close')}
                </Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <ShareForm
            resourceId={resourceId}
            otherCourses={otherCourses}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ShareForm({
  resourceId,
  otherCourses,
  onDone,
}: {
  resourceId: string
  otherCourses: { id: string; label: string }[]
  onDone: () => void
}) {
  const t = useTranslations('notes.lecturer.share')
  const tCommon = useTranslations('common')
  const [courseId, setCourseId] = useState(otherCourses[0].id)
  const [topics, setTopics] = useState<Topics | null>(null)
  const [state, dispatch, pending] = useActionState(async (_prev: ActionResult<null> | null, data: FormData) => {
    const result = await shareItemAction(resourceId, formString(data, 'courseId'), formString(data, 'topicId'))
    if (result.ok) onDone()
    return result
  }, null)

  useEffect(() => {
    let current = true
    void listTopicsAction(courseId).then((result) => {
      if (current) setTopics({ courseId, result })
    })
    return () => {
      current = false
    }
  }, [courseId])

  const loaded = topics !== null && topics.courseId === courseId
  const list = loaded && topics.result.ok ? topics.result.data : []

  return (
    <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="share-course">{t('course')}</FieldLabel>
        <NativeSelect id="share-course" name="courseId" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          {otherCourses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="share-topic">{t('topic')}</FieldLabel>
        <NativeSelect
          id="share-topic"
          key={courseId}
          name="topicId"
          disabled={!loaded || list.length === 0}
          aria-describedby="share-topic-hint"
        >
          {list.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.title}
            </option>
          ))}
        </NativeSelect>
        <FieldDescription id="share-topic-hint">
          {!loaded ? t('loading') : !topics.result.ok ? t('loadFailed') : list.length === 0 ? t('noTopics') : t('hint')}
        </FieldDescription>
      </Field>
      <NotesError state={state} />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {tCommon('cancel')}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending || !loaded || list.length === 0}>
          <Share2 aria-hidden="true" data-icon="inline-start" />
          {t('submit')}
        </Button>
      </DialogFooter>
    </form>
  )
}
