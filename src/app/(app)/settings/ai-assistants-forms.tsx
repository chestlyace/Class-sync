'use client'

import { KeyRound, TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useEffect, useRef, useState } from 'react'
import { ActionError, isInvalidField } from '@/components/action-error'
import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ActionResult } from '@/lib/action-result'
import { submitWith } from '@/lib/form-submit'
import { createAccessTokenAction } from './actions'

/** The connector URL to paste into an assistant, with a copy button. */
export function ConnectorUrl({ url }: { url: string }) {
  const t = useTranslations('settings.ai.connector')
  return (
    <div className="flex flex-col gap-2">
      <span id="connector-url-label" className="text-sm font-medium">
        {t('label')}
      </span>
      <div className="flex items-center gap-2">
        <code
          aria-labelledby="connector-url-label"
          data-testid="connector-url"
          className="flex min-h-11 min-w-0 flex-1 items-center rounded-xl bg-muted px-3.5 py-2 font-mono text-sm break-all"
        >
          {url}
        </code>
        <CopyButton value={url} label={t('copy')} />
      </div>
    </div>
  )
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-[#48484a] marker:font-mono marker:text-xs marker:text-muted-foreground">
      {items.map((item) => (
        <li key={item} className="pl-1">
          {item}
        </li>
      ))}
    </ol>
  )
}

const TRIGGER =
  'h-11 rounded-full px-2 text-[13px] text-[#48484a] data-active:bg-background data-active:font-semibold data-active:text-foreground data-active:shadow-none sm:h-9 sm:px-4 sm:text-sm'

/** How to add the connector in Claude, ChatGPT, or a tool configured by file. */
export function ConnectorHowTo({ url }: { url: string }) {
  const t = useTranslations('settings.ai.howTo')
  const snippet = JSON.stringify(
    { mcpServers: { clasync: { url, headers: { Authorization: `Bearer <${t('tokenPlaceholder')}>` } } } },
    null,
    2,
  )
  return (
    <Tabs defaultValue="claude" className="gap-4">
      <TabsList
        aria-label={t('label')}
        className="grid w-full grid-cols-3 rounded-full bg-[#ebebef] p-1 group-data-horizontal/tabs:h-auto sm:w-fit"
      >
        <TabsTrigger value="claude" className={TRIGGER}>
          {t('claude.tab')}
        </TabsTrigger>
        <TabsTrigger value="chatgpt" className={TRIGGER}>
          {t('chatgpt.tab')}
        </TabsTrigger>
        <TabsTrigger value="other" className={TRIGGER}>
          {t('other.tab')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="claude" className="flex flex-col gap-2">
        <Steps items={[t('claude.step1'), t('claude.step2'), t('claude.step3')]} />
      </TabsContent>
      <TabsContent value="chatgpt" className="flex flex-col gap-3">
        <Steps items={[t('chatgpt.step1'), t('chatgpt.step2'), t('chatgpt.step3')]} />
        <p className="text-[13px] text-muted-foreground">{t('chatgpt.note')}</p>
      </TabsContent>
      <TabsContent value="other" className="flex min-w-0 flex-col gap-3">
        <p className="text-sm text-[#48484a]">{t('other.intro')}</p>
        <div className="flex items-start gap-2">
          <pre className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-muted px-3.5 py-3 font-mono text-xs leading-relaxed">
            <code>{snippet}</code>
          </pre>
          <CopyButton value={snippet} label={t('other.copy')} />
        </div>
        <p className="text-[13px] text-muted-foreground">{t('other.oauth')}</p>
      </TabsContent>
    </Tabs>
  )
}

type Created = ActionResult<{ key: string; name: string }>

/** The new key, shown once: copy it now or never. */
function NewToken({ name, value, onDone }: { name: string; value: string; onDone: () => void }) {
  const t = useTranslations('settings.ai.tokens')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [value])
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="region"
      aria-labelledby="new-token-title"
      className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 outline-none transition-[opacity,transform] duration-200 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none sm:p-5"
    >
      <p id="new-token-title" className="flex items-center gap-2 font-semibold">
        <KeyRound aria-hidden="true" className="size-4 text-primary" />
        {t('newTitle', { name })}
      </p>
      <div className="flex items-center gap-2">
        <code
          data-testid="new-token"
          className="flex min-h-11 min-w-0 flex-1 items-center rounded-xl border bg-background px-3.5 py-2 font-mono text-sm break-all"
        >
          {value}
        </code>
        <CopyButton value={value} label={t('copy')} />
      </div>
      <p className="flex items-start gap-2 text-sm font-medium">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#9a3412]" />
        {t('copyNow')}
      </p>
      <Button type="button" variant="outline" size="lg" className="self-start" onClick={onDone}>
        {t('done')}
      </Button>
    </div>
  )
}

/**
 * Create a personal access token: a name and an expiry. The key is shown once, above the form;
 * at the limit the form gives way to a message (the key just created stays on screen).
 */
export function CreateTokenForm({ atLimit, max, nameMax }: { atLimit: boolean; max: number; nameMax: number }) {
  const t = useTranslations('settings.ai.tokens')
  const [state, dispatch, pending] = useActionState(
    (prev: Created | null, data: FormData) => createAccessTokenAction(prev, data),
    null,
  )
  const [dismissed, setDismissed] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const created = state?.ok ? state.data : null

  useEffect(() => {
    if (created) formRef.current?.reset()
  }, [created])

  const nameInvalid = isInvalidField(state, 'name')

  return (
    <div className="flex flex-col gap-4">
      {created && created.key !== dismissed && (
        <NewToken name={created.name} value={created.key} onDone={() => setDismissed(created.key)} />
      )}
      {atLimit ? (
        <p role="status" className="flex items-start gap-2 rounded-2xl bg-muted px-4 py-3 text-sm">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[#9a3412]" />
          {t('limit', { max })}
        </p>
      ) : (
        <form ref={formRef} onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor="token-name">{t('name')}</FieldLabel>
              <Input
                id="token-name"
                name="name"
                required
                maxLength={nameMax}
                autoComplete="off"
                placeholder={t('namePlaceholder')}
                aria-invalid={nameInvalid || undefined}
                aria-describedby="token-name-hint"
              />
              <FieldDescription id="token-name-hint">{t('nameHint', { max: nameMax })}</FieldDescription>
            </Field>
            <Field className="sm:w-44">
              <FieldLabel htmlFor="token-expiry">{t('expiry')}</FieldLabel>
              <NativeSelect id="token-expiry" name="expiresInDays" defaultValue="90">
                <option value="30">{t('expiry30')}</option>
                <option value="90">{t('expiry90')}</option>
                <option value="never">{t('expiryNever')}</option>
              </NativeSelect>
            </Field>
          </div>
          {nameInvalid ? (
            <FieldError>{t('nameRequired', { max: nameMax })}</FieldError>
          ) : (
            <ActionError state={state} overrides={{ CONFLICT: t('limit', { max }) }} />
          )}
          <Button type="submit" size="lg" disabled={pending} className="self-start">
            {pending ? t('creating') : t('create')}
          </Button>
        </form>
      )}
    </div>
  )
}
