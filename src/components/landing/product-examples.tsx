import { ArrowDown, Check, CheckCheck, CloudCheck, FileSpreadsheet, Search, Timer } from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'
import { cn } from '@/lib/utils'

// More pictures of the product built from markup. Each is one labelled image to assistive tech.

const label = 'font-mono text-[11px] font-medium tracking-[0.08em] uppercase'
const phone = 'mx-auto flex w-full max-w-[330px] flex-col rounded-[36px] border bg-background p-5 shadow-[0_24px_48px_-28px_rgb(29_29_31/0.22)]'

/** The phone's earpiece: a short bar, purely to read as a phone. */
function Earpiece() {
  return <span className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-border" />
}

export async function StructureDiagram({ className }: { className?: string }) {
  const t = await getTranslations('landing.structure.diagram')
  const levels = [
    { key: 'lecturer', value: t('lecturerValue') },
    { key: 'school', value: t('schoolValue') },
    { key: 'class', value: t('classValue') },
  ] as const
  const courses = [t('course1'), t('course2'), t('course3')]
  const node = 'flex min-w-0 flex-col gap-2 rounded-2xl border bg-background p-4 md:flex-1'
  const arrow = (
    <span className="flex items-center justify-center text-muted-foreground">
      <ArrowDown className="size-4 md:-rotate-90" strokeWidth={2} />
    </span>
  )

  return (
    <div role="img" aria-label={t('label')} className={cn('flex flex-col gap-3', className)}>
      <div aria-hidden="true" className="flex flex-col gap-2 md:flex-row md:items-stretch">
        {levels.map(({ key, value }) => (
          <div key={key} className="contents">
            <div className={node}>
              <span className={cn(label, 'text-muted-foreground')}>{t(key)}</span>
              <span className="leading-snug font-semibold">{value}</span>
            </div>
            {arrow}
          </div>
        ))}
        <div className={cn(node, 'md:flex-[1.35]')}>
          <span className={cn(label, 'text-muted-foreground')}>{t('courses')}</span>
          <span className="flex flex-wrap gap-1.5">
            {courses.map((course) => (
              <span key={course} className="rounded-full bg-muted px-2.5 py-1 text-sm font-medium">
                {course}
              </span>
            ))}
          </span>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="flex flex-col gap-4 rounded-2xl bg-foreground p-5 text-background sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-8"
      >
        <span className={cn(label, 'text-background/70')}>{t('student')}</span>
        <span className="flex flex-wrap gap-x-8 gap-y-3">
          <span className="flex flex-col gap-1">
            <span className={cn(label, 'text-background/60')}>{t('code')}</span>
            <span className="font-mono text-lg font-semibold tracking-[0.18em]">QX7R4M</span>
          </span>
          <span className="flex flex-col gap-1">
            <span className={cn(label, 'text-background/60')}>{t('matricule')}</span>
            <span className="font-mono text-lg font-semibold tracking-[0.04em]">HND24-0153</span>
          </span>
        </span>
        <span className="flex items-center gap-2.5 sm:ml-auto">
          <CheckCheck className="size-5 shrink-0" strokeWidth={2} />
          <span className="font-medium">{t('result')}</span>
        </span>
      </div>
    </div>
  )
}

export async function TestPhoneExample({ className }: { className?: string }) {
  const t = await getTranslations('landing.tests.example')
  const options = [
    { letter: 'A', text: t('optionA') },
    { letter: 'B', text: t('optionB'), chosen: true },
    { letter: 'C', text: t('optionC') },
    { letter: 'D', text: t('optionD') },
  ]
  return (
    <div role="img" aria-label={t('label')} className={cn(phone, className)}>
      <div aria-hidden="true" className="flex flex-col">
        <Earpiece />
        <div className="flex items-center justify-between gap-3">
          <span className={cn(label, 'truncate text-muted-foreground')}>{t('course')}</span>
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-sm font-semibold">
            <Timer className="size-4" strokeWidth={2} />
            {t('time')}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full w-[40%] rounded-full bg-primary" />
          </span>
          <span className={cn(label, 'text-muted-foreground')}>{t('progress')}</span>
        </div>
        <p className="mt-5 text-lg leading-snug font-semibold">{t('question')}</p>
        <div className="mt-4 flex flex-col gap-2">
          {options.map(({ letter, text, chosen }) => (
            <span
              key={letter}
              className={cn(
                'flex min-h-12 items-center gap-3 rounded-2xl border px-3 py-2 text-[15px]',
                chosen && 'border-primary bg-info-soft font-medium',
              )}
            >
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-semibold',
                  chosen ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {letter}
              </span>
              {text}
            </span>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between gap-3 text-[13px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <CloudCheck className="size-4 text-ok" strokeWidth={2} />
            {t('saved')}
          </span>
          <span className="font-mono">{t('exits')}</span>
        </div>
        <span className="mt-4 flex h-12 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">
          {t('next')}
        </span>
      </div>
    </div>
  )
}

const caRows: { name: string; parts: [number, number, number, number]; slipping?: boolean }[] = [
  { name: 'Abanda Grace', parts: [4.5, 9, 11, 3] },
  { name: 'Bih Clarisse', parts: [5, 8.5, 9.5, 2] },
  { name: 'Che Emmanuel', parts: [4, 7, 8, 2] },
  { name: 'Ebai Ronald', parts: [3.5, 6.5, 7.5, 1] },
  { name: 'Kamga Brice', parts: [2, 3, 4.5, 0], slipping: true },
]

// On phones the participation column is left out so names keep their room.
const caGrid =
  'grid grid-cols-[minmax(0,1.9fr)_repeat(3,minmax(0,1fr))_minmax(0,1.1fr)] items-center gap-x-2 px-4 sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_minmax(0,1.1fr)] sm:px-5'

export async function CaExample({ className }: { className?: string }) {
  const t = await getTranslations('landing.ca.example')
  const format = await getFormatter()
  const mark = (value: number) => format.number(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const columns = [
    { key: 'attendance', max: 5 },
    { key: 'assignments', max: 10 },
    { key: 'tests', max: 12 },
    { key: 'participation', max: 3, phoneHidden: true },
  ] as const

  return (
    <div role="img" aria-label={t('label')} className={cn('overflow-hidden rounded-3xl border bg-background text-sm', className)}>
      <div aria-hidden="true">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-5">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-base font-semibold">{t('title')}</span>
            <span className={cn(label, 'text-muted-foreground')}>{t('meta')}</span>
          </span>
          <span className="flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium">
            <FileSpreadsheet className="size-4 text-ok" strokeWidth={2} />
            {t('export')}
          </span>
        </div>
        <div className={cn(caGrid, label, 'border-b bg-muted/50 py-2.5 text-[10px] text-muted-foreground')}>
          <span>{t('student')}</span>
          {columns.map(({ key, max, ...rest }) => (
            <span key={key} className={cn('flex flex-col text-right', 'phoneHidden' in rest && 'max-sm:hidden')}>
              <span className="truncate">{t(key)}</span>
              <span>/{max}</span>
            </span>
          ))}
          <span className="flex flex-col text-right text-foreground">
            <span>{t('total')}</span>
            <span>/30</span>
          </span>
        </div>
        {caRows.map(({ name, parts, slipping }) => {
          const total = parts.reduce((sum, part) => sum + part, 0)
          return (
            <div key={name} className={cn(caGrid, 'border-b py-3 last:border-b-0')}>
              <span className="flex min-w-0 flex-col items-start gap-1">
                <span className="max-w-full truncate font-medium">{name}</span>
                {slipping && (
                  <span className={cn(label, 'rounded-full bg-alert-soft px-2 py-0.5 text-[10px] font-semibold text-alert')}>
                    {t('slipping')}
                  </span>
                )}
              </span>
              {parts.map((part, i) => (
                <span key={columns[i]!.key} className={cn('text-right font-mono text-[13px]', i === 3 && 'max-sm:hidden')}>
                  {mark(part)}
                </span>
              ))}
              <span className={cn('text-right font-display text-[28px] leading-none', slipping && 'text-alert')}>{mark(total)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export async function NotesExample({ className }: { className?: string }) {
  const t = await getTranslations('landing.notes.example')
  const kind = cn(label, 'w-[74px] shrink-0 rounded-md bg-muted px-1.5 py-1 text-center text-[10px] font-semibold text-muted-foreground')
  return (
    <div role="img" aria-label={t('label')} className={cn('relative mx-auto w-full max-w-[330px]', className)}>
      <div aria-hidden="true" className={cn(phone, 'pb-16')}>
        <Earpiece />
        <span className="text-xl font-semibold">{t('course')}</span>
        <span className="mt-3 flex h-11 items-center gap-2 rounded-full border bg-muted/50 px-4 text-[15px] text-muted-foreground">
          <Search className="size-4" strokeWidth={2} />
          {t('search')}
        </span>
        <span className={cn(label, 'mt-5 text-muted-foreground')}>{t('topic')}</span>
        <span className="mt-2 flex flex-col divide-y">
          <span className="flex items-center gap-3 py-3">
            <span className={kind}>{t('note')}</span>
            <span className="min-w-0 flex-1 text-[15px] leading-snug font-medium">{t('noteTitle')}</span>
            <span className={cn(label, 'rounded-full bg-info-soft px-2 py-0.5 text-[10px] font-semibold text-info')}>{t('new')}</span>
          </span>
          <span className="flex items-center gap-3 py-3">
            <span className={kind}>{t('file')}</span>
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{t('fileTitle')}</span>
          </span>
          <span className="flex items-center gap-3 py-3">
            <span className={kind}>{t('link')}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[15px] font-medium">{t('linkTitle')}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">{t('linkHost')}</span>
            </span>
          </span>
          <span className="flex items-center gap-3 py-3">
            <span className={kind}>{t('practice')}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[15px] leading-snug font-medium">{t('practiceTitle')}</span>
              <span className="text-xs text-muted-foreground">{t('practiceMeta')}</span>
            </span>
          </span>
        </span>
      </div>
      <div
        aria-hidden="true"
        className="relative -mt-12 ml-8 flex flex-col gap-1.5 rounded-2xl border bg-background p-4 shadow-[0_18px_40px_-20px_rgb(29_29_31/0.3)] sm:-mr-7 sm:ml-14"
      >
        <span className={cn(label, 'flex items-center gap-1.5 font-semibold text-ok')}>
          <Check className="size-4" strokeWidth={2.5} />
          {t('feedbackLabel')}
        </span>
        <span className="text-sm leading-snug text-subtle">{t('feedback')}</span>
      </div>
    </div>
  )
}
