import { Bot, Eye, PencilLine, Unplug } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { ConfirmAction } from '@/components/confirm-action'
import { Panel, SectionHeading } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { disconnectAppAction, revokeAccessTokenAction } from './actions'
import { ConnectorHowTo, ConnectorUrl, CreateTokenForm } from './ai-assistants-forms'

/** A personal access token as listed: dates already formatted in the reader's language. */
export type TokenRow = {
  id: string
  name: string
  start: string | null
  created: string
  lastUsed: string | null
  expires: string | null
  expired: boolean
}

/** An assistant the lecturer allowed (OAuth), dates formatted. */
export type AppRow = {
  clientId: string
  name: string | null
  host: string | null
  canRead: boolean
  canDraft: boolean
  connected: string
}

function SubHeading({ id, title, description }: { id: string; title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 id={id} className="text-lg font-semibold">
        {title}
      </h3>
      {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt>{label}</dt>
      <dd className="text-[#48484a]">{value}</dd>
    </div>
  )
}

/**
 * Settings → AI assistants (lecturers only): the connector URL and how to add it, personal access
 * tokens for tools configured by file, and the assistants connected through OAuth.
 */
export async function AiAssistantsSection({
  connectorUrl,
  tokens,
  apps,
  maxTokens,
  nameMax,
}: {
  connectorUrl: string
  tokens: TokenRow[]
  apps: AppRow[]
  maxTokens: number
  nameMax: number
}) {
  const t = await getTranslations('settings.ai')
  const active = tokens.filter((tk) => !tk.expired).length

  return (
    <section aria-labelledby="ai-assistants" className="flex flex-col gap-4">
      <SectionHeading id="ai-assistants">{t('title')}</SectionHeading>
      <p className="max-w-prose text-[#48484a]">{t('intro')}</p>

      <Panel className="flex flex-col gap-5">
        <SubHeading id="ai-connect" title={t('connector.title')} description={t('connector.description')} />
        <ConnectorUrl url={connectorUrl} />
        <ConnectorHowTo url={connectorUrl} />
      </Panel>

      <Panel className="flex flex-col gap-5" aria-labelledby="ai-tokens" role="region">
        <SubHeading id="ai-tokens" title={t('tokens.title')} description={t('tokens.description')} />
        <CreateTokenForm atLimit={active >= maxTokens} max={maxTokens} nameMax={nameMax} />
        {tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('tokens.empty')}</p>
        ) : (
          <ul aria-label={t('tokens.listLabel')} className="flex flex-col divide-y border-t">
            {tokens.map((token) => (
              <li key={token.id} data-testid="token-row" className="flex flex-col gap-3 py-4 last:pb-0 sm:flex-row sm:items-center sm:gap-5">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold break-words">{token.name}</span>
                    {token.start && (
                      <span className="font-mono text-xs text-muted-foreground">{`${token.start}…`}</span>
                    )}
                    {token.expired && <Badge variant="outline">{t('tokens.expired')}</Badge>}
                  </div>
                  <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
                    <Meta label={t('tokens.created')} value={token.created} />
                    <Meta label={t('tokens.lastUsed')} value={token.lastUsed ?? t('tokens.neverUsed')} />
                    <Meta
                      label={token.expired ? t('tokens.expiredOn') : t('tokens.expires')}
                      value={token.expires ?? t('tokens.noExpiry')}
                    />
                  </dl>
                </div>
                {/* A wrapper, so the pill keeps its width on phones (the row is a column there). */}
                <div className="shrink-0">
                  <ConfirmAction
                    action={revokeAccessTokenAction}
                    fields={{ id: token.id }}
                    triggerLabel={t('tokens.revoke')}
                    triggerAriaLabel={t('tokens.revokeAria', { name: token.name })}
                    title={t('tokens.revokeTitle', { name: token.name })}
                    body={t('tokens.revokeBody')}
                    confirmLabel={t('tokens.revokeConfirm')}
                    destructive
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="flex flex-col gap-5" aria-labelledby="ai-apps" role="region">
        <SubHeading id="ai-apps" title={t('apps.title')} description={t('apps.description')} />
        {apps.length === 0 ? (
          <div className="flex items-start gap-3 rounded-2xl bg-muted px-4 py-4">
            <Unplug aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{t('apps.emptyTitle')}</p>
              <p className="max-w-prose text-sm text-[#48484a]">{t('apps.emptyBody')}</p>
            </div>
          </div>
        ) : (
          <ul aria-label={t('apps.listLabel')} className="flex flex-col divide-y border-t">
            {apps.map((app) => {
              const name = app.name?.trim() || t('apps.unnamed')
              return (
                <li key={app.clientId} data-testid="app-row" className="flex flex-col gap-3 py-4 last:pb-0 sm:flex-row sm:items-center sm:gap-5">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    {/* Never the client's own logo: loading it would send the lecturer's IP to the client's host. */}
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-muted">
                      <Bot aria-hidden="true" className="size-5" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold break-words">{name}</span>
                        {app.host && <span className="text-sm break-all text-muted-foreground">{app.host}</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                        {app.canRead && (
                          <Badge variant="secondary">
                            <Eye aria-hidden="true" data-icon="inline-start" />
                            {t('apps.read')}
                          </Badge>
                        )}
                        {app.canDraft && (
                          <Badge variant="secondary">
                            <PencilLine aria-hidden="true" data-icon="inline-start" />
                            {t('apps.draft')}
                          </Badge>
                        )}
                        <span>{t('apps.connected', { date: app.connected })}</span>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <ConfirmAction
                      action={disconnectAppAction}
                      fields={{ clientId: app.clientId }}
                      triggerLabel={t('apps.disconnect')}
                      triggerAriaLabel={t('apps.disconnectAria', { name })}
                      title={t('apps.disconnectTitle', { name })}
                      body={t('apps.disconnectBody', { name })}
                      confirmLabel={t('apps.disconnectConfirm')}
                      destructive
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </section>
  )
}
