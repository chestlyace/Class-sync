import { Ban, Bot, Eye, PencilLine, Send, TriangleAlert } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/server/auth/session'
import { describeConsentRequest } from '@/server/mcp/connections'
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
  // The signed query says which client and where the code goes; describeConsentRequest checks the
  // signature and that the destination is one the client registered.
  const request = await describeConsentRequest(toQuery(search))

  if (request.status !== 'ok') {
    const invalid = request.status === 'invalid'
    return (
      <>
        <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{invalid ? t('expiredTitle') : t('unknownTitle')}</h1>
        <p className="text-sm text-[#48484a]">{invalid ? t('expired') : t('unknownBody')}</p>
      </>
    )
  }

  const { client, redirect: destination } = request
  const name = client.name?.trim() || t('unnamed')
  const scopes = new Set(request.scopes)
  const isLecturer = user.role === 'lecturer'

  return (
    <>
      <div className="flex items-center gap-3">
        {/* Never the client's own logo: loading it would send the lecturer's IP to the client's host. */}
        <span className="flex size-12 items-center justify-center rounded-xl border bg-muted">
          <Bot aria-hidden="true" className="size-6" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-lg font-semibold">{name}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {/* Anyone can register an app under any name and logo: none is verified by Clasync. */}
            <span className="rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium tracking-[0.08em] uppercase">{t('unverified')}</span>
            {client.metadataHost && <span className="truncate">{t('identifiedBy', { host: client.metadataHost })}</span>}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-2xl border bg-muted px-4 py-3">
        <span className="font-mono text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">{t('destinationLabel')}</span>
        <span className="flex items-center gap-2">
          <Send aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-mono text-base font-semibold break-all">{destination.display}</span>
        </span>
        {destination.kind === 'loopback' && <span className="text-sm text-[#48484a]">{t('destinationLoopback')}</span>}
      </div>

      {isLecturer && destination.kind === 'other' && (
        <div role="note" className="flex gap-3 rounded-2xl border border-[#b45309]/40 bg-[#fffbeb] px-4 py-3">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[#b45309]" />
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold">{t('warningTitle')}</span>
            <span className="text-sm text-[#48484a]">{t('warningBody', { destination: destination.display })}</span>
          </div>
        </div>
      )}

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
