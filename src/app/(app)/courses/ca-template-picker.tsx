'use client'

import { Check, CopyCheck, Info, Search, Star, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useMemo, useState, useTransition } from 'react'
import { ActionError } from '@/components/action-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action-result'
import { formatDecimal } from '@/lib/number-format'
import { cn } from '@/lib/utils'
import { BUILT_IN_TEMPLATES, builtInSettings, type BuiltInTemplateId, type CaSettings } from '@/server/performance/rules'
import type { CaTemplate, DefaultTemplate } from '@/server/performance/templates'
import { applyCaTemplateAction, deleteCaTemplateAction, setDefaultCaTemplateAction } from './performance-actions'

type Ref = { templateId: string } | { builtInId: BuiltInTemplateId }
type Course = { id: string; label: string }

/** One card: a built-in template or one of mine, with the settings it gives. */
export type TemplateCard = {
  key: string
  ref: Ref
  name: string
  description: string
  /** Built-in only: the longer "when to use it" text of the info pop-up. */
  details: string | null
  settings: CaSettings
  mine: boolean
}

const keyOf = (ref: Ref) => ('templateId' in ref ? `mine:${ref.templateId}` : `builtin:${ref.builtInId}`)
const defaultKey = (d: DefaultTemplate) => (d === null ? null : keyOf(d))

/**
 * The CA templates as one row of cards at the top of the CA settings: a search box, the
 * ready-made templates then mine, side by side (the row scrolls). Choosing a card hands its
 * settings to the form (`onSelect`), which is then based on it. Each card's ⓘ opens a pop-up
 * explaining the split part by part, with "Use for this course", "Apply to other courses",
 * "Make default for new courses" and, for mine, Delete.
 */
export function CaTemplatePicker({
  templates,
  defaultTemplate,
  courses,
  currentCourseId,
  locale,
  selectedKey,
  onSelect,
}: {
  templates: CaTemplate[]
  defaultTemplate: DefaultTemplate
  courses: Course[]
  currentCourseId: string
  locale: string
  selectedKey: string | null
  onSelect: (card: TemplateCard) => void
}) {
  const t = useTranslations('performance.lecturer.templates')
  const [query, setQuery] = useState('')
  const [info, setInfo] = useState<TemplateCard | null>(null)
  const [def, setDef] = useState<string | null>(defaultKey(defaultTemplate))

  const cards = useMemo<TemplateCard[]>(
    () => [
      ...BUILT_IN_TEMPLATES.map((b) => ({
        key: `builtin:${b.id}`,
        ref: { builtInId: b.id } as Ref,
        name: t(`builtIn.${b.id}.name`),
        description: t(`builtIn.${b.id}.description`),
        details: t(`builtIn.${b.id}.details`),
        settings: builtInSettings(b.id, (n) => t('groupName', { n })),
        mine: false,
      })),
      ...templates.map((m) => ({
        key: `mine:${m.id}`,
        ref: { templateId: m.id } as Ref,
        name: m.name,
        description: t('mineDescription'),
        details: null,
        settings: m.settings,
        mine: true,
      })),
    ],
    [templates, t],
  )
  const needle = query.trim().toLowerCase()
  const shown = needle === '' ? cards : cards.filter((c) => `${c.name} ${c.description}`.toLowerCase().includes(needle))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 id="ca-templates-heading" className="font-medium">
            {t('pickLabel')}
          </h3>
          <p className="text-sm text-muted-foreground">{t('pickHint')}</p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            className="pl-10"
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {t('noMatch', { query: query.trim() })}
        </p>
      ) : (
        <ul
          aria-labelledby="ca-templates-heading"
          className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pt-1 pb-3"
        >
          {shown.map((card) => {
            const selected = card.key === selectedKey
            return (
              <li key={card.key} data-testid="ca-template" className="relative w-60 shrink-0 snap-start">
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(card)}
                  className={cn(
                    'flex h-full w-full flex-col gap-2 rounded-2xl border bg-card p-4 pr-12 text-left transition-colors outline-none hover:border-input focus-visible:ring-3 focus-visible:ring-ring/50',
                    selected && 'border-primary ring-2 ring-primary',
                  )}
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{card.name}</span>
                    {card.mine && <Badge variant="outline">{t('mineBadge')}</Badge>}
                    {def === card.key && (
                      <Badge variant="secondary">
                        <Star aria-hidden="true" data-icon="inline-start" />
                        {t('defaultBadge')}
                      </Badge>
                    )}
                  </span>
                  <span className="text-sm text-muted-foreground">{card.description}</span>
                  <Split settings={card.settings} locale={locale} />
                  {selected && (
                    <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-medium text-primary">
                      <Check aria-hidden="true" className="size-4" />
                      {t('selected')}
                    </span>
                  )}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('moreInfo', { name: card.name })}
                  title={t('moreInfo', { name: card.name })}
                  onClick={() => setInfo(card)}
                  className="absolute top-2 right-2 text-muted-foreground"
                >
                  <Info aria-hidden="true" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {info && (
        <InfoDialog
          key={info.key}
          card={info}
          isDefault={def === info.key}
          courses={courses}
          currentCourseId={currentCourseId}
          locale={locale}
          onUse={() => {
            onSelect(info)
            setInfo(null)
          }}
          onDefaultChange={setDef}
          onClose={() => setInfo(null)}
        />
      )}
    </div>
  )
}

/** "/30 · Attendance 5 · Assignments 10 · CA 1 10 …" as small chips. */
function Split({ settings, locale }: { settings: CaSettings; locale: string }) {
  const parts = useParts(settings, locale)
  return (
    <span className="flex flex-wrap gap-1">
      {parts.map((p) => (
        <span key={p.label} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {p.label} {p.points}
        </span>
      ))}
    </span>
  )
}

/** The parts a template gives points to, in the form's order; the named CAs replace "Tests". */
function useParts(s: CaSettings, locale: string): { label: string; points: string; how: string }[] {
  const t = useTranslations('performance.lecturer.templates')
  const tPart = useTranslations('performance.lecturer.component')
  const fmt = (n: number) => formatDecimal(n, locale)
  const parts: { label: string; points: string; how: string }[] = []
  if (s.attendancePoints > 0) parts.push({ label: tPart('attendance'), points: fmt(s.attendancePoints), how: t('how.attendance') })
  if (s.assignmentPoints > 0) parts.push({ label: tPart('assignments'), points: fmt(s.assignmentPoints), how: t('how.assignments') })
  if (s.participationPoints > 0) {
    parts.push({
      label: tPart('participation'),
      points: fmt(s.participationPoints),
      how: t('how.participation', { target: s.participationTarget }),
    })
  }
  if (s.groups.length > 0) {
    for (const g of s.groups) {
      parts.push({
        label: g.name,
        points: fmt(g.points),
        how: g.bestOf ? t('how.groupBest', { count: g.bestOf }) : t('how.group'),
      })
    }
  } else if (s.testPoints > 0) {
    parts.push({
      label: tPart('tests'),
      points: fmt(s.testPoints),
      how: s.testsBestOf ? t('how.testsBest', { count: s.testsBestOf }) : t('how.tests'),
    })
  }
  return parts
}

/** A template explained part by part, with what can be done with it. */
function InfoDialog({
  card,
  isDefault,
  courses,
  currentCourseId,
  locale,
  onUse,
  onDefaultChange,
  onClose,
}: {
  card: TemplateCard
  isDefault: boolean
  courses: Course[]
  currentCourseId: string
  locale: string
  onUse: () => void
  onDefaultChange: (key: string | null) => void
  onClose: () => void
}) {
  const t = useTranslations('performance.lecturer.templates')
  const parts = useParts(card.settings, locale)
  const [view, setView] = useState<'info' | 'apply'>('info')
  const [state, setState] = useState<ActionResult<unknown> | null>(null)
  const [pending, start] = useTransition()

  if (view === 'apply') {
    return (
      <ApplyDialog templateRef={card.ref} name={card.name} courses={courses} currentCourseId={currentCourseId} onClose={onClose} />
    )
  }

  const run = (action: () => Promise<ActionResult<unknown>>, after: () => void) =>
    start(async () => {
      const result = await action()
      setState(result)
      if (result.ok) after()
    })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('close')} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{card.name}</DialogTitle>
          <DialogDescription>{card.details ?? card.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs tracking-[0.08em] text-muted-foreground uppercase">
            {t('outOf', { total: formatDecimal(card.settings.total, locale) })}
          </p>
          <ul className="flex flex-col divide-y rounded-2xl border">
            {parts.map((p) => (
              <li key={p.label} className="flex flex-col gap-0.5 px-4 py-2.5">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{p.label}</span>
                  <span className="font-mono text-sm">{t('points', { points: p.points })}</span>
                </span>
                <span className="text-sm text-muted-foreground">{p.how}</span>
              </li>
            ))}
          </ul>
          {parts.length < 4 && <p className="text-sm text-muted-foreground">{t('leftOut')}</p>}
        </div>
        {state && !state.ok && <ActionError state={state} />}
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => setDefaultCaTemplateAction(isDefault ? null : card.ref),
                  () => onDefaultChange(isDefault ? null : card.key),
                )
              }
            >
              <Star aria-hidden="true" data-icon="inline-start" />
              {isDefault ? t('unsetDefault') : t('makeDefault')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setView('apply')}>
              <CopyCheck aria-hidden="true" data-icon="inline-start" />
              {t('applyToCourses')}
            </Button>
            {card.mine && 'templateId' in card.ref && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  const id = (card.ref as { templateId: string }).templateId
                  run(() => deleteCaTemplateAction(id), onClose)
                }}
              >
                <Trash2 aria-hidden="true" data-icon="inline-start" />
                {t('deleteShort')}
              </Button>
            )}
          </div>
          <Button type="button" onClick={onUse}>
            {t('useHere')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Pick my courses (this one ticked) and apply the template to all of them at once. */
function ApplyDialog({
  templateRef,
  name,
  courses,
  currentCourseId,
  onClose,
}: {
  templateRef: Ref
  name: string
  courses: Course[]
  currentCourseId: string
  onClose: () => void
}) {
  const t = useTranslations('performance.lecturer.templates')
  const [chosen, setChosen] = useState<Set<string>>(() => new Set([currentCourseId]))
  const [state, setState] = useState<ActionResult<number> | null>(null)
  const [pending, start] = useTransition()

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('close')} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('applyTitle', { name })}</DialogTitle>
          <DialogDescription>{t('applyBody')}</DialogDescription>
        </DialogHeader>
        <fieldset className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
          <legend className="sr-only">{t('applyCourses')}</legend>
          {courses.map((c) => (
            <label key={c.id} className="flex items-start gap-3 rounded-xl px-2 py-2 hover:bg-accent">
              <input
                type="checkbox"
                checked={chosen.has(c.id)}
                onChange={() => toggle(c.id)}
                className="mt-1 size-4 accent-primary"
              />
              <span className="text-sm">{c.label}</span>
            </label>
          ))}
        </fieldset>
        {state?.ok ? (
          <p role="status" className="text-sm font-medium">
            {t('applied', { count: state.data })}
          </p>
        ) : state && !state.ok && state.code === 'VALIDATION' ? (
          <FieldError>{t('applyPick')}</FieldError>
        ) : (
          state && <ActionError state={state} />
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              // This course's settings changed under the form: show them.
              if (state?.ok && chosen.has(currentCourseId)) window.location.reload()
              else onClose()
            }}
          >
            {state?.ok ? t('close') : t('cancel')}
          </Button>
          {!state?.ok && (
            <Button
              type="button"
              pending={pending}
              disabled={chosen.size === 0}
              onClick={() => start(async () => setState(await applyCaTemplateAction(templateRef, [...chosen])))}
            >
              {t('applyConfirm', { count: chosen.size })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
