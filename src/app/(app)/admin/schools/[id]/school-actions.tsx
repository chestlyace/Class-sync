'use client'

import { GitMerge, Pencil, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useId, useState } from 'react'
import { ActionError } from '@/components/action-error'
import { ConfirmAction } from '@/components/confirm-action'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action-result'
import { cn } from '@/lib/utils'
import { mergeSchoolsAdminAction, searchSchoolsForMergeAction, updateSchoolAdminAction } from '../../actions'

const REASON_MAX = 500
const SEARCH_DELAY_MS = 250
const SEARCH_MIN = 2

/** One side of a merge, as the page passes it (dates as ISO strings). */
export type MergeSide = { id: string; name: string; town: string; classes: number; hasLocation: boolean; createdAt: string }

/** The optional reason, saved with the action in the audit log. */
export function ReasonField() {
  const t = useTranslations('admin.actions')
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t('reason')}</FieldLabel>
      <Input id={id} name="reason" maxLength={REASON_MAX} autoComplete="off" aria-describedby={`${id}-hint`} />
      <FieldDescription id={`${id}-hint`}>{t('reasonHint')}</FieldDescription>
    </Field>
  )
}

/** Name and town in a dialog. A clash with another school offers a link to it (merge from there). */
export function EditSchool({ school }: { school: { id: string; name: string; town: string } }) {
  const t = useTranslations('admin.schools.edit')
  const nameId = useId()
  const townId = useId()
  return (
    <ConfirmAction
      action={(prev, data) => updateSchoolAdminAction(prev as ActionResult<null> | null, data)}
      fields={{ schoolId: school.id }}
      triggerLabel={t('trigger')}
      triggerIcon={<Pencil aria-hidden="true" data-icon="inline-start" />}
      title={t('title')}
      body={t('body')}
      confirmLabel={t('save')}
      renderError={(state) => {
        if (state && !state.ok && state.code === 'CONFLICT') {
          const other = (state.details as { existingSchoolId?: string } | undefined)?.existingSchoolId
          return (
            <FieldError>
              {t('conflict')}{' '}
              {other && (
                <Link href={`/admin/schools/${encodeURIComponent(other)}`} className="font-medium underline underline-offset-4">
                  {t('openIt')}
                </Link>
              )}
            </FieldError>
          )
        }
        return <ActionError state={state} />
      }}
    >
      <Field>
        <FieldLabel htmlFor={nameId}>{t('name')}</FieldLabel>
        <Input id={nameId} name="name" required minLength={2} maxLength={120} defaultValue={school.name} autoComplete="off" />
      </Field>
      <Field>
        <FieldLabel htmlFor={townId}>{t('town')}</FieldLabel>
        <Input id={townId} name="town" required minLength={2} maxLength={120} defaultValue={school.town} autoComplete="off" />
      </Field>
      <ReasonField />
    </ConfirmAction>
  )
}

/** The school to keep by default: the one with more classes; on a tie, the older one. */
function defaultKeep(a: MergeSide, b: MergeSide): string {
  if (a.classes !== b.classes) return a.classes > b.classes ? a.id : b.id
  return a.createdAt <= b.createdAt ? a.id : b.id
}

/**
 * Merging `current` and `other`: the admin picks the school to keep; the other one's classes move
 * to it and it is removed. Opens from its own button, or from outside when `open` is given.
 */
export function MergeSchools({
  current,
  other,
  open,
  onOpenChange,
}: {
  current: MergeSide
  other: MergeSide
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const t = useTranslations('admin.schools.merge')
  const tSchool = useTranslations('admin.schools.school')
  const [keep, setKeep] = useState(() => defaultKeep(current, other))
  const legendId = useId()
  const kept = keep === current.id ? current : other
  const removed = keep === current.id ? other : current
  const location = kept.hasLocation
    ? t('locationKept', { kept: kept.name })
    : removed.hasLocation
      ? t('locationAdopted', { kept: kept.name, removed: removed.name })
      : t('locationNone')

  return (
    <ConfirmAction
      action={(prev, data) => {
        data.set('intoId', kept.id)
        data.set('fromId', removed.id)
        return mergeSchoolsAdminAction(prev as ActionResult<never> | null, data)
      }}
      fields={{}}
      triggerLabel={open === undefined ? t('trigger') : undefined}
      triggerAriaLabel={open === undefined ? t('triggerLabel', { name: other.name }) : undefined}
      triggerIcon={<GitMerge aria-hidden="true" data-icon="inline-start" />}
      title={t('title')}
      body={t('body')}
      confirmLabel={t('confirm')}
      primary
      open={open}
      onOpenChange={onOpenChange}
    >
      <fieldset className="flex flex-col gap-2" aria-labelledby={legendId}>
        <legend id={legendId} className="mb-1 font-mono text-xs tracking-wide text-muted-foreground uppercase">
          {t('keepLegend')}
        </legend>
        {[current, other].map((side) => (
          <label
            key={side.id}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors',
              keep === side.id ? 'border-primary bg-accent' : 'hover:bg-muted/50',
            )}
          >
            <input
              type="radio"
              name="keep"
              value={side.id}
              checked={keep === side.id}
              onChange={() => setKeep(side.id)}
              className="mt-1 accent-primary"
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-semibold break-words">{side.name}</span>
              <span className="text-[13px] text-muted-foreground">
                {side.town} · {tSchool('classCount', { count: side.classes })}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1 text-sm">
        <p>{t('summary', { count: removed.classes, kept: kept.name, removed: removed.name })}</p>
        <p className="text-muted-foreground">{location}</p>
      </div>
      <ReasonField />
    </ConfirmAction>
  )
}

/** Finds a school to merge with by name or town (for duplicates whose towns are spelled differently). */
export function MergeSearch({ current }: { current: MergeSide }) {
  const t = useTranslations('admin.schools.merge')
  const tSchool = useTranslations('admin.schools.school')
  const tCommon = useTranslations('common')
  const inputId = useId()
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MergeSide[] | null>(null)
  const [failed, setFailed] = useState<ActionResult<unknown> | null>(null)
  const [chosen, setChosen] = useState<MergeSide | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)

  const ready = query.trim().length >= SEARCH_MIN
  useEffect(() => {
    if (!ready) return
    let stale = false
    const timer = setTimeout(async () => {
      const result = await searchSchoolsForMergeAction(query, current.id)
      if (stale) return
      if (result.ok) {
        setFailed(null)
        setResults(result.data.map((s) => ({ ...s, createdAt: new Date(s.createdAt).toISOString() })))
      } else {
        setFailed(result)
      }
    }, SEARCH_DELAY_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query, ready, current.id])

  const shown = ready ? results : null

  return (
    <>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogTrigger asChild>
          <Button type="button" size="lg" variant="outline">
            <Search aria-hidden="true" data-icon="inline-start" />
            {t('searchTrigger')}
          </Button>
        </DialogTrigger>
        <DialogContent closeLabel={tCommon('close')}>
          <DialogHeader>
            <DialogTitle>{t('searchTitle')}</DialogTitle>
            <DialogDescription>{t('searchBody')}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={inputId}>{t('searchLabel')}</FieldLabel>
            <Input
              id={inputId}
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setResults(null)
              }}
              maxLength={200}
              autoComplete="off"
            />
          </Field>
          <ActionError state={failed} />
          <div aria-live="polite" className="flex flex-col gap-2">
            {ready && shown === null && !failed && <p className="text-sm text-muted-foreground">{t('searching')}</p>}
            {shown?.length === 0 && <p className="text-sm text-muted-foreground">{t('noResults')}</p>}
            {shown && shown.length > 0 && (
              <ul className="flex flex-col gap-2">
                {shown.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setChosen(s)
                        setSearchOpen(false)
                        setMergeOpen(true)
                      }}
                      className="flex w-full flex-col gap-0.5 rounded-2xl border px-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="font-semibold break-words">{s.name}</span>
                      <span className="text-[13px] text-muted-foreground">
                        {s.town} · {tSchool('classCount', { count: s.classes })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {chosen && <MergeSchools key={chosen.id} current={current} other={chosen} open={mergeOpen} onOpenChange={setMergeOpen} />}
    </>
  )
}
