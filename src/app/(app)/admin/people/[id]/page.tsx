import { ArrowLeft, KeyRound, Monitor, Plug } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { getPerson } from '@/server/admin/queries'
import { getSessionUser } from '@/server/auth/session'
import { FactList, Stat, StatGrid } from '../../admin-ui'
import { getFormatters } from '../../format'
import { loadAdminPage } from '../../load-admin'
import { PersonActions } from '../../person-actions'
import { adminMetadata } from '../../metadata'

export async function generateMetadata() {
  return adminMetadata('people')
}

export default async function AdminPersonPage({ params }: PageProps<'/admin/people/[id]'>) {
  const { id } = await params
  const [t, f, viewer] = await Promise.all([getTranslations('admin'), getFormatters(), getSessionUser()])
  const result = await loadAdminPage((ctx) => getPerson(ctx, id))
  if (!result.ok) return <ErrorState code={result.code} />
  const person = result.data

  const suspended = person.suspendedAt !== null
  const isSelf = viewer?.id === person.id
  const can = {
    canResend: !person.emailVerified && !suspended,
    canRevoke: person.sessions.length > 0,
    canUnsuspend: suspended,
    canSuspend: !suspended && !isSelf && !person.isAdmin,
  }
  const anyAction = Object.values(can).some(Boolean)

  const counts =
    'courses' in person.counts
      ? [
          { label: t('person.counts.schools'), value: person.counts.schools },
          { label: t('person.counts.classesTaught'), value: person.counts.classes },
          { label: t('person.counts.courses'), value: person.counts.courses },
        ]
      : [{ label: t('person.counts.classesJoined'), value: person.counts.classes }]

  return (
    <>
      <div className="flex flex-col gap-4">
        <Link
          href="/admin/people"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('person.back')}
        </Link>
        <PageHeader eyebrow={t(`roles.${person.role}`)} title={person.name} />
        <div className="-mt-1 flex flex-wrap gap-2">
          {person.isAdmin && <Badge variant="outline">{t('badges.admin')}</Badge>}
          {!person.emailVerified && <Badge variant="outline">{t('badges.unverified')}</Badge>}
          {suspended && <Badge variant="outline">{t('badges.suspended')}</Badge>}
        </div>
      </div>

      <section aria-labelledby="account" className="flex flex-col gap-4">
        <SectionHeading id="account">{t('person.facts.title')}</SectionHeading>
        <Panel>
          <FactList
            facts={[
              { label: t('person.facts.email'), value: <span className="break-all">{person.email}</span> },
              { label: t('person.facts.role'), value: t(`roles.${person.role}`) },
              {
                label: t('person.facts.verified'),
                value: person.emailVerified ? t('person.facts.yes') : t('person.facts.no'),
              },
              { label: t('person.facts.joined'), value: f.day(person.createdAt) },
              {
                label: t('person.facts.lastSignIn'),
                value: person.lastSignInAt ? f.dateTime(person.lastSignInAt) : t('person.facts.never'),
              },
              {
                label: t('person.facts.lastSeen'),
                value: person.lastSeenAt ? f.dateTime(person.lastSeenAt) : t('person.facts.never'),
              },
              {
                label: t('person.facts.status'),
                value: person.suspendedAt
                  ? t('person.facts.suspendedSince', { date: f.dateTime(person.suspendedAt) })
                  : t('person.facts.active'),
              },
              ...(suspended
                ? [{ label: t('person.facts.reason'), value: person.suspendedReason ?? t('person.facts.noReason') }]
                : []),
            ]}
          />
        </Panel>
      </section>

      <section aria-labelledby="counts" className="flex flex-col gap-4">
        <SectionHeading id="counts">{t('person.counts.title')}</SectionHeading>
        <StatGrid className="sm:grid-cols-3 lg:grid-cols-3">
          {counts.map((c) => (
            <Stat key={c.label} label={c.label} value={f.number(c.value)} />
          ))}
        </StatGrid>
        <p className="text-[13px] text-muted-foreground">{t('person.counts.hint')}</p>
      </section>

      <section aria-labelledby="sessions" className="flex flex-col gap-4">
        <SectionHeading id="sessions">{t('person.sessions.title')}</SectionHeading>
        <Panel>
          {person.sessions.length === 0 ? (
            <p className="text-muted-foreground">{t('person.sessions.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {person.sessions.map((s) => (
                <li key={s.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <Monitor aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm break-words">{s.userAgent || t('person.sessions.unknownDevice')}</span>
                    <span className="text-[13px] text-muted-foreground">
                      {t('person.sessions.lastActive', { date: f.dateTime(s.updatedAt) })}
                      {' · '}
                      {t('person.sessions.expires', { date: f.day(s.expiresAt) })}
                      {s.ipMasked && (
                        <>
                          {' · '}
                          {t('person.sessions.network', { ip: s.ipMasked })}
                        </>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section aria-labelledby="connections" className="flex flex-col gap-4">
        <SectionHeading id="connections">{t('person.connections.title')}</SectionHeading>
        <Panel>
          {person.connections.length === 0 ? (
            <p className="text-muted-foreground">{t('person.connections.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {person.connections.map((c, i) => {
                const Icon = c.kind === 'oauth' ? Plug : KeyRound
                return (
                  <li key={`${c.kind}-${i}`} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-medium break-words">{c.name || t('person.connections.unnamed')}</span>
                      <span className="text-[13px] text-muted-foreground">
                        {c.kind === 'oauth' ? t('person.connections.oauth') : t('person.connections.token')}
                        {' · '}
                        {c.lastUsedAt
                          ? t('person.connections.lastUsed', { date: f.day(c.lastUsedAt) })
                          : t('person.connections.neverUsed')}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </section>

      <section aria-labelledby="actions" className="flex flex-col gap-4">
        <SectionHeading id="actions">{t('person.actions.title')}</SectionHeading>
        {anyAction ? (
          <PersonActions targetId={person.id} name={person.name} email={person.email} {...can} />
        ) : (
          <p className="text-muted-foreground">{t('person.actions.none')}</p>
        )}
      </section>
    </>
  )
}
