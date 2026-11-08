'use client'

import {
  ArrowDown,
  ArrowUp,
  Ellipsis,
  Eye,
  EyeOff,
  File as FileIcon,
  FileText,
  FolderInput,
  Link as LinkIcon,
  Pencil,
  Plus,
  Share2,
  SquareCheck,
  Trash2,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useActionState, useState, useTransition } from 'react'
import { ConfirmAction } from '@/components/confirm-action'
import { Eyebrow } from '@/components/page-header'
import { Button, buttonVariants } from '@/components/ui/button'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import type { ActionResult } from '@/lib/action-result'
import { formatFileSize } from '@/lib/file-size'
import { formString } from '@/lib/form-data'
import { submitWith } from '@/lib/form-submit'
import { cn } from '@/lib/utils'
import type { NoteItem, NotesTopic } from '@/server/notes/read'
import {
  createTopicAction,
  deleteTopicAction,
  moveItemAction,
  moveTopicAction,
  removeItemAction,
  renameTopicAction,
  setTopicHiddenAction,
} from './notes-actions'
import { NotesError } from './notes-error'
import type { ItemKind } from './notes-form'
import { ShareDialog } from './share-dialog'

type OtherCourse = { id: string; label: string }

/** Runs a quick action (move, hide, delete…) and keeps its failure to show under the topic header. */
function useQuickAction() {
  const [error, setError] = useState<ActionResult<unknown> | null>(null)
  const [pending, startTransition] = useTransition()
  function run(fn: () => Promise<ActionResult<unknown>>) {
    startTransition(async () => {
      const result = await fn()
      setError(result.ok ? null : result)
    })
  }
  return { run, pending, error }
}

const PILL = 'inline-flex h-5 shrink-0 items-center rounded-full px-2 font-mono text-[11px] font-medium tracking-[0.08em] uppercase'

type PillTone = 'note' | 'neutral' | 'revision' | 'hidden'
const TONES: Record<PillTone, string> = {
  note: 'bg-primary/10 text-primary',
  neutral: 'bg-muted text-muted-foreground',
  revision: 'bg-emerald-50 text-emerald-700',
  hidden: 'bg-orange-50 text-orange-700',
}

function Pill({ tone, children, className }: { tone: PillTone; children: React.ReactNode; className?: string }) {
  return <span className={cn(PILL, TONES[tone], className)}>{children}</span>
}

const KIND_ICON = { note: FileText, file: FileIcon, link: LinkIcon } as const

const fileExtension = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot >= 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : null
}

/** "New topic": a dialog with one title field. */
export function NewTopicDialog({ courseId }: { courseId: string }) {
  const t = useTranslations('notes.lecturer.newTopic')
  const tCommon = useTranslations('common')
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="lg">
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t('open')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tCommon('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <TopicTitleForm
          action={(prev, data) => createTopicAction(courseId, prev, data)}
          initial=""
          submitLabel={t('submit')}
          inputId="new-topic-title"
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

/** The title form shared by "New topic" and "Rename". */
function TopicTitleForm({
  action,
  initial,
  submitLabel,
  inputId,
  onDone,
}: {
  action: (prev: ActionResult<null> | null, data: FormData) => Promise<ActionResult<null>>
  initial: string
  submitLabel: string
  inputId: string
  onDone: () => void
}) {
  const t = useTranslations('notes.lecturer.newTopic')
  const tCommon = useTranslations('common')
  const [state, dispatch, pending] = useActionState(async (prev: ActionResult<null> | null, data: FormData) => {
    const result = await action(prev, data)
    if (result.ok) onDone()
    return result
  }, null)
  return (
    <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-4">
      <Field data-invalid={state && !state.ok ? true : undefined}>
        <FieldLabel htmlFor={inputId}>{t('field')}</FieldLabel>
        <Input
          id={inputId}
          name="title"
          required
          maxLength={200}
          defaultValue={initial}
          placeholder={t('placeholder')}
          aria-invalid={state && !state.ok ? true : undefined}
        />
      </Field>
      <NotesError state={state} />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" size="lg">
            {tCommon('cancel')}
          </Button>
        </DialogClose>
        <Button type="submit" size="lg" disabled={pending}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function NotesLecturer({
  courseId,
  topics,
  otherCourses,
  timeZone,
}: {
  courseId: string
  topics: NotesTopic[]
  otherCourses: OtherCourse[]
  timeZone: string
}) {
  const t = useTranslations('notes.lecturer')
  if (topics.length === 0) return <p className="max-w-prose text-muted-foreground">{t('empty')}</p>
  return (
    <div className="flex flex-col gap-5">
      {topics.map((topic, index) => (
        <TopicCard
          key={topic.id}
          courseId={courseId}
          topic={topic}
          index={index}
          topics={topics}
          otherCourses={otherCourses}
          timeZone={timeZone}
        />
      ))}
    </div>
  )
}

function TopicCard({
  courseId,
  topic,
  index,
  topics,
  otherCourses,
  timeZone,
}: {
  courseId: string
  topic: NotesTopic
  index: number
  topics: NotesTopic[]
  otherCourses: OtherCourse[]
  timeZone: string
}) {
  const t = useTranslations('notes.lecturer')
  const { run, pending, error } = useQuickAction()
  const rows = topic.items.length + (topic.practice ? 1 : 0)
  const itemCount = topic.items.length
  const base = `/courses/${encodeURIComponent(courseId)}/notes`
  const addHref = (kind: ItemKind) => `${base}/new?topic=${encodeURIComponent(topic.id)}&kind=${kind}`
  const practiceHref = `${base}/topics/${encodeURIComponent(topic.id)}/practice`

  return (
    <section
      aria-labelledby={`topic-${topic.id}`}
      className={cn('overflow-hidden rounded-[22px] border bg-card', topic.hidden && 'border-dashed')}
    >
      <header className="flex items-start gap-2 px-4 pt-4 pb-3 sm:px-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow>{t('topicLabel', { n: index + 1 })}</Eyebrow>
            {topic.hidden && (
              <Pill tone="hidden" className="gap-1">
                <EyeOff aria-hidden="true" className="size-3" />
                {t('hiddenPill')}
              </Pill>
            )}
          </div>
          <h2 id={`topic-${topic.id}`} className="text-xl font-semibold tracking-tight break-words">
            {topic.title}
          </h2>
        </div>
        <span className="shrink-0 pt-5 text-sm text-muted-foreground">{t('itemCount', { count: itemCount })}</span>
        <TopicMenu topic={topic} index={index} count={topics.length} run={run} pending={pending} />
      </header>
      {error && (
        <div className="px-4 pb-3 sm:px-5">
          <NotesError state={error} />
        </div>
      )}

      {rows > 0 && (
        <ul className="flex flex-col divide-y border-t">
          {topic.items.map((item, i) => (
            <ItemRow
              key={item.id}
              courseId={courseId}
              item={item}
              index={i}
              count={topic.items.length}
              topics={topics}
              topicId={topic.id}
              otherCourses={otherCourses}
              timeZone={timeZone}
              run={run}
            />
          ))}
          {topic.practice && (
            <li>
              <Link
                href={practiceHref}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 sm:px-5"
              >
                <SquareCheck aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 font-medium">
                      {t('practiceRow', { count: topic.practice.count })}
                    </span>
                    {topic.practice.held && <Pill tone="hidden">{t('waitingPill')}</Pill>}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {topic.practice.held ? t('practiceHeld') : t('practiceMeta')}
                  </span>
                </span>
                <Pill tone="revision">{t('kind.revision')}</Pill>
              </Link>
            </li>
          )}
        </ul>
      )}

      <div className={cn('flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5', rows > 0 && 'border-t')}>
        {!topic.practice && (
          <Link href={practiceHref} className="mr-auto inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline">
            <SquareCheck aria-hidden="true" className="size-4" />
            {t('addPractice')}
          </Link>
        )}
        {(['note', 'file', 'link'] as const).map((kind) => (
          <Link
            key={kind}
            href={addHref(kind)}
            className={cn(buttonVariants({ variant: 'outline' }), 'h-11 border-dashed')}
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t(`add.${kind}`)}
          </Link>
        ))}
      </div>

      {topic.hidden && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-dashed bg-muted/40 px-4 py-3 sm:px-5">
          <p className="text-sm text-muted-foreground">{t('hiddenNote')}</p>
          <Button
            type="button"
            size="lg"
            disabled={pending}
            onClick={() => run(() => setTopicHiddenAction(topic.id, false))}
          >
            <Eye aria-hidden="true" data-icon="inline-start" />
            {t('show')}
          </Button>
        </footer>
      )}
    </section>
  )
}

function TopicMenu({
  topic,
  index,
  count,
  run,
  pending,
}: {
  topic: NotesTopic
  index: number
  count: number
  run: (fn: () => Promise<ActionResult<unknown>>) => void
  pending: boolean
}) {
  const t = useTranslations('notes.lecturer.topicMenu')
  const tDelete = useTranslations('notes.lecturer.deleteTopic')
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null)
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            disabled={pending}
            aria-label={t('label', { title: topic.title })}
            title={t('label', { title: topic.title })}
          >
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem className="min-h-11" onSelect={() => setDialog('rename')}>
            <Pencil aria-hidden="true" />
            {t('rename')}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11"
            disabled={index === 0}
            onSelect={() => run(() => moveTopicAction(topic.id, 'up'))}
          >
            <ArrowUp aria-hidden="true" />
            {t('moveUp')}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11"
            disabled={index === count - 1}
            onSelect={() => run(() => moveTopicAction(topic.id, 'down'))}
          >
            <ArrowDown aria-hidden="true" />
            {t('moveDown')}
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-11" onSelect={() => run(() => setTopicHiddenAction(topic.id, !topic.hidden))}>
            {topic.hidden ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
            {topic.hidden ? t('show') : t('hide')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={() => setDialog('delete')}>
            <Trash2 aria-hidden="true" />
            {t('delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameTopicDialog topic={topic} open={dialog === 'rename'} onOpenChange={(o) => setDialog(o ? 'rename' : null)} />
      <ConfirmAction
        open={dialog === 'delete'}
        onOpenChange={(o) => setDialog(o ? 'delete' : null)}
        action={async () => deleteTopicAction(topic.id)}
        fields={{}}
        title={tDelete('title')}
        body={tDelete('body', { title: topic.title })}
        note={tDelete('note')}
        confirmLabel={tDelete('confirm')}
        destructive
        renderError={(state) => <NotesError state={state} />}
      />
    </>
  )
}

function RenameTopicDialog({
  topic,
  open,
  onOpenChange,
}: {
  topic: NotesTopic
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations('notes.lecturer.rename')
  const tCommon = useTranslations('common')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tCommon('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <TopicTitleForm
          action={(prev, data) => renameTopicAction(topic.id, prev, data)}
          initial={topic.title}
          submitLabel={t('submit')}
          inputId={`rename-topic-${topic.id}`}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function ItemRow({
  courseId,
  item,
  index,
  count,
  topics,
  topicId,
  otherCourses,
  timeZone,
  run,
}: {
  courseId: string
  item: NoteItem
  index: number
  count: number
  topics: NotesTopic[]
  topicId: string
  otherCourses: OtherCourse[]
  timeZone: string
  run: (fn: () => Promise<ActionResult<unknown>>) => void
}) {
  const t = useTranslations('notes.lecturer')
  const locale = useLocale()
  const Icon = KIND_ICON[item.kind]
  const base = `/courses/${encodeURIComponent(courseId)}/notes/${encodeURIComponent(item.id)}`
  const updated = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(item.updatedAt)

  let meta: string
  if (item.kind === 'note') meta = t('meta.note', { date: updated })
  else if (item.kind === 'file' && item.file) {
    const ext = fileExtension(item.file.name)
    const size = formatFileSize(item.file.sizeBytes, locale)
    meta = ext ? `${ext} · ${size}` : size
  } else meta = item.host ?? ''
  if (item.sharedInCount > 0) meta = `${meta} · ${t('alsoIn', { count: item.sharedInCount })}`

  const text = (
    <>
      <span className="min-w-0 font-medium break-words underline-offset-4 group-hover/link:underline">{item.title}</span>
      <span className="text-sm break-words text-muted-foreground">{meta}</span>
    </>
  )
  const linkClass = 'group/link flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5'
  return (
    <li className="flex items-center gap-3 px-4 py-1 sm:px-5">
      <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
      {item.kind === 'note' ? (
        <Link href={base} className={linkClass}>
          {text}
        </Link>
      ) : (
        <a href={`${base}/open`} target="_blank" rel="noopener" className={linkClass}>
          {text}
        </a>
      )}
      <Pill tone={item.kind === 'note' ? 'note' : 'neutral'}>{t(`kind.${item.kind}`)}</Pill>
      <ItemMenu
        courseId={courseId}
        item={item}
        index={index}
        count={count}
        topics={topics}
        topicId={topicId}
        otherCourses={otherCourses}
        run={run}
      />
    </li>
  )
}

function ItemMenu({
  courseId,
  item,
  index,
  count,
  topics,
  topicId,
  otherCourses,
  run,
}: {
  courseId: string
  item: NoteItem
  index: number
  count: number
  topics: NotesTopic[]
  topicId: string
  otherCourses: OtherCourse[]
  run: (fn: () => Promise<ActionResult<unknown>>) => void
}) {
  const t = useTranslations('notes.lecturer.itemMenu')
  const tRemove = useTranslations('notes.lecturer.remove')
  const [dialog, setDialog] = useState<'move' | 'share' | 'remove' | null>(null)
  const shared = item.sharedInCount > 0
  const close = (open: boolean, which: 'move' | 'share' | 'remove') => setDialog(open ? which : null)
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label={t('label', { title: item.title })}
            title={t('label', { title: item.title })}
          >
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem asChild className="min-h-11">
            <Link href={`/courses/${encodeURIComponent(courseId)}/notes/${encodeURIComponent(item.id)}/edit`}>
              <Pencil aria-hidden="true" />
              {t('edit')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11"
            disabled={index === 0}
            onSelect={() => run(() => moveItemAction(courseId, item.id, { dir: 'up' }))}
          >
            <ArrowUp aria-hidden="true" />
            {t('moveUp')}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11"
            disabled={index === count - 1}
            onSelect={() => run(() => moveItemAction(courseId, item.id, { dir: 'down' }))}
          >
            <ArrowDown aria-hidden="true" />
            {t('moveDown')}
          </DropdownMenuItem>
          {topics.length > 1 && (
            <DropdownMenuItem className="min-h-11" onSelect={() => setDialog('move')}>
              <FolderInput aria-hidden="true" />
              {t('moveToTopic')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="min-h-11" onSelect={() => setDialog('share')}>
            <Share2 aria-hidden="true" />
            {t('share')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={() => setDialog('remove')}>
            <Trash2 aria-hidden="true" />
            {t('remove')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <MoveItemDialog
        courseId={courseId}
        item={item}
        topics={topics.filter((topic) => topic.id !== topicId)}
        open={dialog === 'move'}
        onOpenChange={(o) => close(o, 'move')}
      />
      <ShareDialog
        resourceId={item.id}
        itemTitle={item.title}
        otherCourses={otherCourses}
        open={dialog === 'share'}
        onOpenChange={(o) => close(o, 'share')}
      />
      <ConfirmAction
        open={dialog === 'remove'}
        onOpenChange={(o) => close(o, 'remove')}
        action={async () => removeItemAction(courseId, item.id)}
        fields={{}}
        title={tRemove('title')}
        body={tRemove('body', { title: item.title })}
        note={shared ? tRemove('shared', { count: item.sharedInCount }) : undefined}
        warning={shared ? undefined : tRemove('alone')}
        confirmLabel={tRemove('confirm')}
        destructive
        renderError={(state) => <NotesError state={state} />}
      />
    </>
  )
}

function MoveItemDialog({
  courseId,
  item,
  topics,
  open,
  onOpenChange,
}: {
  courseId: string
  item: NoteItem
  topics: NotesTopic[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations('notes.lecturer.move')
  const tCommon = useTranslations('common')
  const [state, dispatch, pending] = useActionState(async (_prev: ActionResult<null> | null, data: FormData) => {
    const result = await moveItemAction(courseId, item.id, { topicId: formString(data, 'topicId') })
    if (result.ok) onOpenChange(false)
    return result
  }, null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tCommon('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body', { title: item.title })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor={`move-topic-${item.id}`}>{t('topic')}</FieldLabel>
            <NativeSelect id={`move-topic-${item.id}`} name="topicId" defaultValue={topics[0]?.id}>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.title}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <NotesError state={state} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="lg">
                {tCommon('cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" size="lg" disabled={pending || topics.length === 0}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
