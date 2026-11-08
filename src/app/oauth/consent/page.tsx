import { Ban, Bot, Eye, PencilLine } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/server/auth/session'
import { getConsentClient } from '@/server/mcp/connections'
import { ConsentButtons } from './consent-buttons'

export async function generateMetadata() {
  const t = await getTranslations('oauthConsent')
  return { title: t('title') }
}

function toQuery(search: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined) continue
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v)
  }
  return params.toString()
}

function Section({ icon: Icon, title, items }: { icon: typeof Eye; title: string; items: string[] }) {
  return (
    <section className="flex gap-3">
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        <ul className="flex flex-col gap-0.5 text-sm text-[#48484a]">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/**
 * Where Better Auth's OAuth provider sends the lecturer to allow an assistant (Claude, ChatGPT…).
 * The query is signed by the provider; Allow/Deny send it back with the answer.
 */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams
  const user = await getSessionUser()
  // Not signed in (e.g. the session ended): sign in with the same signed query, which resumes here.
  if (!user) redirect(`/sign-in?${toQuery(search)}`)

  const t = await getTranslations('oauthConsent')
  const clientId = typeof search.client_id === 'string' ? search.client_id : ''
  const client = await getConsentClient(clientId)

  if (!client) {
    return (
      <>
        <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('unknownTitle')}</h1>
        <p className="text-sm text-[#48484a]">{t('unknownBody')}</p>
      </>
    )
  }

  const name = client.name?.trim() || t('unnamed')
  const scopes = new Set(typeof search.scope === 'string' ? search.scope.split(' ') : [])
  const isLecturer = user.role === 'lecturer'

  return (
    <>
      <div className="flex items-center gap-3">
        {client.icon ? (
          // An external, https-only image chosen by the assistant's developer; no referrer sent.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={client.icon} alt="" width={48} height={48} referrerPolicy="no-referrer" className="size-12 rounded-xl border object-contain" />
        ) : (
          <span className="flex size-12 items-center justify-center rounded-xl border bg-muted">
            <Bot aria-hidden="true" className="size-6" />
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          <span className="font-mono text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">{t('eyebrow')}</span>
          <span className="truncate text-lg font-semibold">{name}</span>
          {client.uri && <span className="truncate text-sm text-muted-foreground">{new URL(client.uri).host}</span>}
        </div>
      </div>

      {isLecturer ? (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('title')}</h1>
            <p className="text-sm text-[#48484a]">{t('intro', { name, email: user.email })}</p>
          </div>
          <div className="flex flex-col gap-4">
            {scopes.has('clasync:read') && <Section icon={Eye} title={t('readTitle')} items={[t('readBody')]} />}
            {scopes.has('clasync:write') && (
              <Section icon={PencilLine} title={t('draftTitle')} items={[t('draftBody'), t('approval')]} />
            )}
            <Section icon={Ban} title={t('neverTitle')} items={[t('neverBody')]} />
          </div>
          <p className="text-sm text-muted-foreground">{t('revoke')}</p>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('lecturersOnlyTitle')}</h1>
          <p className="text-sm text-[#48484a]">{t('lecturersOnlyBody')}</p>
        </div>
      )}
      <ConsentButtons canAllow={isLecturer} />
    </>
  )
}
