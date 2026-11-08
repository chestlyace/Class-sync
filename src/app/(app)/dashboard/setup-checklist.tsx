import { ArrowRight, Check } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { CopyButton } from '@/components/copy-button'
import { Eyebrow } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { OnboardingStatus } from '@/server/onboarding/service'
import { SetupCard } from './setup-card'

type StepKey = 'school' | 'class' | 'course' | 'share' | 'join'
type Step = { key: StepKey; done: boolean; href: string }

const TITLE_ID = 'setup-title'

function stepsFor(status: OnboardingStatus): Step[] {
  if (status.role === 'student') return [{ key: 'join', done: status.steps.join, href: '/join' }]
  const { steps, latestSchoolId, latestClass } = status
  const classId = latestClass && encodeURIComponent(latestClass.id)
  return [
    { key: 'school', done: steps.school, href: '/schools/new' },
    {
      key: 'class',
      done: steps.class,
      href: latestSchoolId ? `/classes/new?schoolId=${encodeURIComponent(latestSchoolId)}` : '/classes/new',
    },
    {
      key: 'course',
      done: steps.course,
      href: classId ? `/courses/new?classId=${classId}` : '/courses/new',
    },
    {
      key: 'share',
      done: steps.share,
      href: classId ? `/classes/${classId}` : '/classes/new',
    },
  ]
}

/**
 * First-run checklist at the top of the dashboard. Steps tick off from what the user has done;
 * the first open step is spelled out, the others are one line with a link. Render it only while
 * `status.complete` is false.
 */
export async function SetupChecklist({ status }: { status: OnboardingStatus }) {
  const t = await getTranslations('dashboard.setup')
  const steps = stepsFor(status)
  const done = steps.filter((s) => s.done).length
  const current = steps.find((s) => !s.done)?.key
  const shareClass = status.role === 'lecturer' && !status.steps.share ? status.latestClass : null

  return (
    <SetupCard titleId={TITLE_ID} dismissLabel={t('dismiss')}>
      <div className="flex flex-col gap-1 pr-12">
        <Eyebrow>
          {t('eyebrow')}
          {steps.length > 1 && ` · ${t('progress', { done, total: steps.length })}`}
        </Eyebrow>
        <h2 id={TITLE_ID} className="text-xl leading-snug font-semibold tracking-[-0.01em]">
          {status.role === 'lecturer' ? t('lecturerTitle') : t('studentTitle')}
        </h2>
      </div>
      <ol className="mt-2 flex flex-col">
        {steps.map((step, i) => {
          const isCurrent = step.key === current
          const showCode = step.key === 'share' && shareClass !== null
          // Later steps stay reachable but quiet: the current step's button is the one blue action.
          const actionLink = (
            <Link
              href={step.href}
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50',
                isCurrent ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`steps.${step.key}.action`)}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          )
          return (
            <li
              key={step.key}
              aria-current={isCurrent ? 'step' : undefined}
              data-testid={`setup-step-${step.key}`}
              data-done={step.done}
              className="flex gap-3.5 border-t border-accent py-3.5 first:border-t-0"
            >
              <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center">
                {step.done ? (
                  <Check className="size-5 text-primary" strokeWidth={2.5} />
                ) : (
                  <span className="font-mono text-xs font-medium tracking-[0.06em] text-muted-foreground">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className={cn('font-medium', step.done && 'text-muted-foreground')}>
                    {t(`steps.${step.key}.title`)}
                    <span className="sr-only"> ({step.done ? t('done') : t('todo')})</span>
                  </p>
                  {step.done ? (
                    <span
                      aria-hidden="true"
                      className="font-mono text-[11px] font-medium tracking-[0.1em] text-muted-foreground uppercase"
                    >
                      {t('done')}
                    </span>
                  ) : (
                    (!isCurrent || showCode) && actionLink
                  )}
                </div>
                {isCurrent && (
                  <p className="max-w-prose text-sm text-muted-foreground">{t(`steps.${step.key}.body`)}</p>
                )}
                {showCode && shareClass && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      data-testid="setup-join-code"
                      className="inline-flex h-11 items-center rounded-full border bg-muted px-5 font-mono text-lg font-medium tracking-[0.2em]"
                    >
                      <span className="sr-only">
                        {t('steps.share.codeLabel', {
                          className: shareClass.name,
                        })}
                        :{' '}
                      </span>
                      {shareClass.studentCode}
                    </span>
                    <CopyButton value={shareClass.studentCode} label={t('steps.share.copy')} />
                  </div>
                )}
                {isCurrent && !showCode && (
                  <Link
                    href={step.href}
                    className={buttonVariants({
                      className: 'mt-0.5 self-start',
                    })}
                  >
                    {t(`steps.${step.key}.action`)}
                    <ArrowRight aria-hidden="true" data-icon="inline-end" />
                  </Link>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </SetupCard>
  )
}
