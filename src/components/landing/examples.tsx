import { Check } from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'
import { cn } from '@/lib/utils'
import { attendanceRate, type Mark } from './attendance-rate'

// Pictures of the product built from markup. Each is one labelled image to assistive tech.

const frame = 'rounded-[28px] border bg-background'
const label = 'font-mono text-xs font-medium tracking-[0.1em] uppercase'

export async function ProjectorExample({ className }: { className?: string }) {
  const t = await getTranslations('landing.projector')
  return (
    <div role="img" aria-label={t('label')} className={cn(frame, 'flex flex-col justify-between gap-7 bg-muted p-7 sm:p-9', className)}>
      <div aria-hidden="true" className={cn(label, 'flex flex-wrap justify-between gap-3')}>
        <span>{t('course')}</span>
        <span className="text-muted-foreground">{t('checkIn')}</span>
      </div>
      <div aria-hidden="true" className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-3.5">
          <span className={cn(label, 'text-muted-foreground')}>{t('enterCode')}</span>
          <span className="font-display text-7xl leading-[0.82] tracking-[0.08em] sm:text-[140px]">K7XM4P</span>
          <div className="flex items-center gap-3.5">
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-border">
              <span className="block h-full w-[70%] rounded-full bg-primary" />
            </span>
            <span className="font-mono text-base font-semibold">0:42</span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className={cn(label, 'text-muted-foreground')}>{t('checkedIn')}</span>
          <span className="font-display text-7xl leading-[0.82] sm:text-[120px]">
            23 <span className="text-4xl text-muted-foreground sm:text-[56px]">/ 41</span>
          </span>
        </div>
      </div>
    </div>
  )
}

export async function PhoneExample({ className }: { className?: string }) {
  const t = await getTranslations('landing.phone')
  return (
    <div role="img" aria-label={t('label')} className={cn(frame, 'flex flex-col gap-3.5 px-5 py-6', className)}>
      <span aria-hidden="true" className="font-mono text-[11px] font-semibold tracking-[0.1em] text-[#1d4ed8] uppercase">
        {t('open')}
      </span>
      <span aria-hidden="true" className="text-xl leading-tight font-semibold">
        {t('course')}
      </span>
      <span
        aria-hidden="true"
        className="flex h-16 items-center rounded-2xl border-2 border-primary px-3.5 font-display text-[42px] tracking-[0.28em]"
      >
        K7XM
      </span>
      <span aria-hidden="true" className="flex h-12 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">
        {t('checkIn')}
      </span>
      <span aria-hidden="true" className="text-[13px] text-muted-foreground">
        {t('caption')}
      </span>
    </div>
  )
}

const sessions = ['12/10', '19/10', '26/10', '02/11']

const history: { name: string; marks: Mark[] }[] = [
  { name: 'Abanda Grace', marks: ['P', 'P', 'P', 'P'] },
  { name: 'Bih Clarisse', marks: ['P', 'H', 'P', 'P'] },
  { name: 'Che Emmanuel', marks: ['P', 'P', 'A', 'P'] },
  { name: 'Kamga Brice', marks: ['A', 'H', 'A', 'P'] },
  { name: 'Mbah Nadège', marks: ['P', 'P', 'P', 'P'] },
]

const LOW_RATE = 0.75

function MarkCell({ mark }: { mark: Mark }) {
  if (mark === 'P') return <Check className="size-[18px]" strokeWidth={2.5} />
  if (mark === 'H') return <span className="font-bold text-[#c2410c]">½</span>
  return (
    <span className="flex size-6 items-center justify-center rounded-md bg-[#fdecec] font-mono text-[11px] font-semibold text-[#b91c1c]">
      A
    </span>
  )
}

const grid = 'grid grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_minmax(0,1fr)] items-center px-5'

export async function AttendanceExample({ className }: { className?: string }) {
  const t = await getTranslations('landing.attendance.example')
  const format = await getFormatter()
  return (
    <div role="img" aria-label={t('label')} className={cn('overflow-hidden rounded-3xl border bg-background text-sm', className)}>
      <div aria-hidden="true">
        <div className={cn(grid, label, 'border-b bg-[#fafafa] py-3 text-[11px] tracking-[0.08em] text-muted-foreground')}>
          <span>{t('student')}</span>
          {sessions.map((date) => (
            <span key={date} className="text-center">
              {date}
            </span>
          ))}
          <span className="text-right">{t('rate')}</span>
        </div>
        {history.map(({ name, marks }) => {
          const rate = attendanceRate(marks)
          return (
            <div key={name} className={cn(grid, 'border-b py-3 last:border-b-0')}>
              <span className="truncate font-medium">{name}</span>
              {marks.map((mark, i) => (
                <span key={sessions[i]} className="flex justify-center">
                  <MarkCell mark={mark} />
                </span>
              ))}
              <span className={cn('text-right font-mono font-semibold', rate < LOW_RATE && 'text-[#b91c1c]')}>
                {format.number(rate, { style: 'percent' })}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type Status = 'graded' | 'late' | 'submitted' | 'missing'

const statusStyle: Record<Status, string> = {
  graded: 'bg-[#ecfdf5] text-[#047857]',
  late: 'bg-[#fff4e5] text-[#9a3412]',
  submitted: 'bg-[#e8f0fe] text-[#1d4ed8]',
  missing: 'bg-[#fdecec] text-[#b91c1c]',
}

const submissions: { name: string; status: Status; mark?: string }[] = [
  { name: 'Abanda Grace', status: 'graded', mark: '17/20' },
  { name: 'Bih Clarisse', status: 'graded', mark: '15/20' },
  { name: 'Ebai Ronald', status: 'late' },
  { name: 'Fonkou Mireille', status: 'submitted' },
  { name: 'Kamga Brice', status: 'missing' },
]

export async function SubmissionsExample({ className }: { className?: string }) {
  const t = await getTranslations('landing.assignments.example')
  return (
    <div role="img" aria-label={t('label')} className={cn('overflow-hidden rounded-3xl border bg-background text-sm', className)}>
      <div aria-hidden="true">
        <div className="flex flex-col gap-0.5 border-b px-5 py-4">
          <span className="text-base font-semibold">{t('title')}</span>
          <span className={cn(label, 'text-[11px] tracking-[0.08em] text-muted-foreground')}>{t('meta')}</span>
        </div>
        {submissions.map(({ name, status, mark }) => (
          <div key={name} className="flex items-center justify-between gap-3 border-b px-5 py-3 last:border-b-0">
            <span className="truncate font-medium">{name}</span>
            <span className="flex shrink-0 items-center gap-3.5">
              <span className="font-mono font-semibold">{mark ?? '—'}</span>
              <span className={cn(label, 'rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em]', statusStyle[status])}>
                {t(status)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
