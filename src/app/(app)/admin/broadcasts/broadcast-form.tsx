'use client'

import { MailCheck, Send } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useId, useState, useTransition } from 'react'
import { ActionError, isInvalidField } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action-result'
import { cn } from '@/lib/utils'
import type { BroadcastAudience } from '@/server/broadcasts/service'
import { createBroadcastAction, sendTestBroadcastAction } from './actions'

type Fields = { subjectEn: string; bodyEn: string; subjectFr: string; bodyFr: string }

const EMPTY: Fields = { subjectEn: '', bodyEn: '', subjectFr: '', bodyFr: '' }

/** The words that confirm a send, in either language (the service checks again). */
const CONFIRMATION_WORDS = ['SEND', 'ENVOYER']

const TEXTAREA_CLASS =
  'w-full min-w-0 rounded-xl border border-input bg-transparent px-3.5 py-2.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30'

/** The length limits and audiences come from the page (the service owns them); this file is client code. */
export type BroadcastFormLimits = { subjectMax: number; messageMax: number }

/** "123 / 150", stronger as the limit gets close. */
function Counter({ value, max }: { value: string; max: number }) {
  const t = useTranslations('admin.broadcasts.form')
  const near = value.length >= max * 0.9
  return (
    <span
      className={cn('self-end font-mono text-[11px] tracking-[0.06em] text-muted-foreground', near && 'font-semibold text-destructive')}
    >
      {t('counter', { count: value.length, max })}
    </span>
  )
}

/** One language's subject and message. */
function Version({
  label,
  idPrefix,
  subject,
  message,
  onSubject,
  onMessage,
  invalidSubject,
  invalidMessage,
  limits,
}: {
  label: string
  idPrefix: string
  subject: string
  message: string
  onSubject: (value: string) => void
  onMessage: (value: string) => void
  invalidSubject: boolean
  invalidMessage: boolean
  limits: BroadcastFormLimits
}) {
  const t = useTranslations('admin.broadcasts.form')
  return (
    <section aria-labelledby={`${idPrefix}-title`} className="flex min-w-0 flex-col gap-4 rounded-3xl border bg-card p-5 sm:p-6">
      <h3 id={`${idPrefix}-title`} className="font-mono text-[13px] font-semibold tracking-[0.1em] uppercase">
        {label}
      </h3>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-subject`}>{t('subject')}</FieldLabel>
        <Input
          id={`${idPrefix}-subject`}
          value={subject}
          onChange={(e) => onSubject(e.target.value)}
          maxLength={limits.subjectMax}
          autoComplete="off"
          aria-invalid={invalidSubject || undefined}
        />
        <Counter value={subject} max={limits.subjectMax} />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-message`}>{t('message')}</FieldLabel>
        <textarea
          id={`${idPrefix}-message`}
          value={message}
          onChange={(e) => onMessage(e.target.value)}
          rows={12}
          maxLength={limits.messageMax}
          aria-invalid={invalidMessage || undefined}
          aria-describedby={`${idPrefix}-message-hint`}
          className={TEXTAREA_CLASS}
        />
        <FieldDescription id={`${idPrefix}-message-hint`}>{t('messageHint')}</FieldDescription>
        <Counter value={message} max={limits.messageMax} />
      </Field>
    </section>
  )
}

/**
 * The announcement form: who gets it, an English and a French version, a test send to the
 * admin's own address, and the real send behind a typed confirmation. The draft gets one id,
 * and a new one after each send, so a retried request can never send the same draft twice.
 */
export function BroadcastForm({
  audiences,
  counts,
  ready,
  limits,
}: {
  audiences: readonly BroadcastAudience[]
  counts: Record<BroadcastAudience, number>
  ready: boolean
  limits: BroadcastFormLimits
}) {
  const t = useTranslations('admin.broadcasts.form')
  const tCommon = useTranslations('common')
  const uid = useId()
  const [audience, setAudience] = useState<BroadcastAudience>('everyone')
  const [fields, setFields] = useState<Fields>(EMPTY)
  const [draftId, setDraftId] = useState(() => crypto.randomUUID())
  const [open, setOpen] = useState(false)
  const [word, setWord] = useState('')
  const [sentTo, setSentTo] = useState<number | null>(null)
  const [testState, setTestState] = useState<ActionResult<null> | null>(null)
  const [testPending, startTest] = useTransition()

  const [sendState, sendDispatch, sendPending] = useActionState(
    async (_prev: ActionResult<unknown> | null, data: FormData) => {
      const result = await createBroadcastAction({ id: draftId, audience, ...fields }, String(data.get('confirmation') ?? ''))
      if (result.ok) {
        setOpen(false)
        setWord('')
        setFields(EMPTY)
        setDraftId(crypto.randomUUID())
        setTestState(null)
        setSentTo(result.data.recipients)
      }
      return result
    },
    null,
  )

  const recipients = counts[audience]
  const complete = Object.values(fields).every((value) => value.trim() !== '')
  const canSend = ready && complete && recipients > 0
  const canConfirm = CONFIRMATION_WORDS.includes(word.trim().toUpperCase())
  const invalid = (name: string) => isInvalidField(testState, name) || isInvalidField(sendState, name)

  function update(field: keyof Fields) {
    return (value: string) => {
      setFields((prev) => ({ ...prev, [field]: value }))
      setSentTo(null)
    }
  }

  function sendTest() {
    setTestState(null)
    startTest(async () => {
      setTestState(await sendTestBroadcastAction(fields))
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <FieldSet>
        <FieldLegend variant="label">{t('audienceLegend')}</FieldLegend>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          {audiences.map((value) => (
            <label
              key={value}
              htmlFor={`${uid}-${value}`}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-2xl border bg-card px-4 py-3 transition-colors has-checked:border-primary/40 has-checked:bg-primary/5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                id={`${uid}-${value}`}
                type="radio"
                name="audience"
                value={value}
                checked={audience === value}
                onChange={() => setAudience(value)}
                className="size-4 shrink-0 accent-primary"
              />
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{t(`audiences.${value}`)}</span>
                <span className="text-[13px] text-muted-foreground">{t('audienceCount', { count: counts[value] })}</span>
              </span>
            </label>
          ))}
        </div>
        <FieldDescription>{t('audienceHint')}</FieldDescription>
      </FieldSet>

      <div className="grid gap-4 md:grid-cols-2">
        <Version
          label={t('versionEn')}
          idPrefix={`${uid}-en`}
          subject={fields.subjectEn}
          message={fields.bodyEn}
          onSubject={update('subjectEn')}
          onMessage={update('bodyEn')}
          invalidSubject={invalid('subjectEn')}
          invalidMessage={invalid('bodyEn')}
          limits={limits}
        />
        <Version
          label={t('versionFr')}
          idPrefix={`${uid}-fr`}
          subject={fields.subjectFr}
          message={fields.bodyFr}
          onSubject={update('subjectFr')}
          onMessage={update('bodyFr')}
          invalidSubject={invalid('subjectFr')}
          invalidMessage={invalid('bodyFr')}
          limits={limits}
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2.5">
          <Button type="button" size="lg" variant="outline" disabled={!ready || !complete} pending={testPending} onClick={sendTest}>
            <MailCheck aria-hidden="true" data-icon="inline-start" />
            {t('testButton')}
          </Button>
          <Button type="button" size="lg" disabled={!canSend} onClick={() => setOpen(true)}>
            <Send aria-hidden="true" data-icon="inline-start" />
            {t('sendButton', { count: recipients })}
          </Button>
        </div>
        {ready && !complete && <p className="text-sm text-muted-foreground">{t('incomplete')}</p>}
        {testState?.ok && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('testSent')}
          </p>
        )}
        <ActionError state={testState} overrides={{ CONFLICT: t('testFailed') }} />
        {sentTo !== null && (
          <p role="status" className="text-sm font-medium">
            {t('sentNotice', { count: sentTo })}
          </p>
        )}
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setWord('')
        }}
      >
        <DialogContent closeLabel={tCommon('close')}>
          <DialogHeader>
            <DialogTitle>{t('confirm.title')}</DialogTitle>
            <DialogDescription>
              {t('confirm.description', { audience: t(`audiences.${audience}`), count: recipients })}
            </DialogDescription>
          </DialogHeader>
          <form action={sendDispatch} className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor={`${uid}-confirmation`}>{t('confirm.wordLabel')}</FieldLabel>
              <Input
                id={`${uid}-confirmation`}
                name="confirmation"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </Field>
            <ActionError state={sendState} overrides={{ CONFLICT: t('sendFailed') }} />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" size="lg" variant="outline">
                  {tCommon('cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" size="lg" pending={sendPending} disabled={!canConfirm}>
                {t('confirm.submit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
