import { ArrowUpRight, BookOpenText, FilePen, ListChecks, Plug } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { cn } from '@/lib/utils'
import { Reveal } from './reveal'
import { revealIndex } from './reveal-index'

const label = 'font-mono text-[11px] font-medium tracking-[0.08em] uppercase'

/**
 * A lecturer's exchange with their own assistant. Real text (not an image) so it reads as a conversation;
 * it plays out one step at a time the first time it scrolls into view.
 */
export async function ExchangeExample({ className }: { className?: string }) {
  const t = await getTranslations('landing.assistant.exchange')
  const tools = [
    { icon: BookOpenText, text: t('toolRead') },
    { icon: FilePen, text: t('toolDraft') },
  ]
  return (
    <figure
      className={cn(
        'overflow-hidden rounded-[28px] border bg-background shadow-[0_30px_60px_-36px_rgb(29_29_31/0.28)]',
        className,
      )}
    >
      <figcaption className="sr-only">{t('label')}</figcaption>
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <span className="font-semibold">{t('assistantName')}</span>
        <span className={cn(label, 'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] text-muted-foreground')}>
          <Plug aria-hidden="true" className="size-3.5" strokeWidth={2} />
          {t('connected')}
        </span>
      </div>
      <Reveal className="flex flex-col gap-4 p-5 sm:p-6" style={{ '--reveal-step': '320ms' } as React.CSSProperties}>
        <div data-reveal-item style={revealIndex(0)} className="flex flex-col items-end gap-1.5">
          <span className={cn(label, 'text-muted-foreground')}>{t('you')}</span>
          <p className="max-w-[88%] rounded-[20px] rounded-br-md bg-foreground px-4 py-3 text-[15px] leading-relaxed text-background">
            {t('prompt')}
          </p>
        </div>
        <ul className="flex flex-col gap-1.5">
          {tools.map(({ icon: Icon, text }, i) => (
            <li
              key={text}
              data-reveal-item
              style={revealIndex(i + 1)}
              className="flex items-center gap-2.5 rounded-xl bg-muted px-3 py-2 font-mono text-xs text-subtle"
            >
              <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
              <span className="font-semibold text-foreground">Clasync</span>
              <span className="min-w-0">{text}</span>
            </li>
          ))}
        </ul>
        <p data-reveal-item style={revealIndex(3)} className="text-[15px] leading-relaxed">
          {t('reply')}
        </p>
        <div
          data-reveal-item
          style={revealIndex(4)}
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-input p-4"
        >
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-2">
              <span className={cn(label, 'rounded-full bg-late-soft px-2 py-0.5 text-[10px] font-semibold text-late')}>{t('draft')}</span>
              <span className="font-semibold">{t('draftTitle')}</span>
            </span>
            <span className="font-mono text-xs text-muted-foreground">{t('draftMeta')}</span>
          </span>
          <span className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground">
            {t('draftAction')}
            <ArrowUpRight aria-hidden="true" className="size-4" strokeWidth={2} />
          </span>
        </div>
      </Reveal>
    </figure>
  )
}

export async function MarkingExample({ className }: { className?: string }) {
  const t = await getTranslations('landing.assistant.marking.example')
  return (
    <div role="img" aria-label={t('label')} className={cn('rounded-[28px] border bg-background p-5 sm:p-7', className)}>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={cn(label, 'font-semibold')}>{t('question')}</span>
          <span className={cn(label, 'text-muted-foreground')}>{t('confirmed')}</span>
        </div>
        <p className="text-lg leading-snug font-semibold">{t('prompt')}</p>
        <p className="flex gap-2.5 rounded-2xl bg-muted p-3.5 text-sm leading-snug text-subtle">
          <ListChecks className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
          {t('guide')}
        </p>
        <div className="flex flex-col gap-1.5 border-t pt-4">
          <span className={cn(label, 'text-muted-foreground')}>{t('student')}</span>
          <p className="text-[15px] leading-relaxed">{t('answer')}</p>
        </div>
        <div className="flex items-start gap-4 rounded-2xl bg-info-soft p-4">
          <span className="flex shrink-0 flex-col">
            <span className={cn(label, 'text-[10px] font-semibold text-info')}>{t('suggested')}</span>
            <span className="font-display text-5xl leading-[0.9] text-info">
              2<span className="text-3xl text-info/60"> / 3</span>
            </span>
          </span>
          <span className="pt-1 text-sm leading-snug text-subtle">{t('reason')}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
          <span className="flex h-10 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">
            {t('confirm')}
          </span>
          <span className="text-sm text-muted-foreground">{t('or')}</span>
          <span className="flex gap-1.5">
            {[0, 1, 2, 3].map((n) => (
              <span
                key={n}
                className={cn(
                  'flex size-9 items-center justify-center rounded-full border font-mono text-sm font-semibold',
                  n === 2 && 'border-primary text-primary',
                )}
              >
                {n}
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  )
}
