import { Plus } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locale'
import { mcpResourceUrl, resolveAppOrigin } from '@/server/auth/auth'
import { getSessionUser } from '@/server/auth/session'
import { listMyClasses, type ClassSummary } from '@/server/classes/service'
import { config } from '@/server/core/config'
import {
  listAccessTokens,
  listConnectedApps,
  MAX_ACCESS_TOKENS,
  TOKEN_NAME_MAX,
  type AccessTokenSummary,
  type ConnectedApp,
} from '@/server/mcp/connections'
import { getSchool, type School } from '@/server/schools/service'
import { loadPage } from '../load-page'
import { AiAssistantsSection, type AppRow, type TokenRow } from './ai-assistants'
import { ChangePasswordForm, LanguageSwitch, NameForm, SchoolLocationButton } from './settings-forms'

export async function generateMetadata() {
  const t = await getTranslations('settings')
  return { title: t('title') }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts
  return letters.map((p) => p[0]!.toUpperCase()).join('') || '?'
}

type SchoolGroup = { school: School; classes: ClassSummary[] }

/** "9 Nov 2026" / "9 nov. 2026", in the app's time zone. */
function dayFormatter(locale: Locale): (date: Date) => string {
  const format = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: config.timeZone,
  })
  return (date) => format.format(date)
}

function hostOf(uri: string | null): string | null {
  if (!uri) return null
  try {
    return new URL(uri).host
  } catch {
    return null
  }
}

function toTokenRows(tokens: AccessTokenSummary[], day: (d: Date) => string): TokenRow[] {
  const now = Date.now()
  return tokens.map((tk) => ({
    id: tk.id,
    name: tk.name,
    start: tk.start,
    created: day(tk.createdAt),
    lastUsed: tk.lastUsedAt ? day(tk.lastUsedAt) : null,
    expires: tk.expiresAt ? day(tk.expiresAt) : null,
    expired: tk.expiresAt !== null && tk.expiresAt.getTime() <= now,
  }))
}

function toAppRows(apps: ConnectedApp[], day: (d: Date) => string): AppRow[] {
  return apps.map((app) => ({
    clientId: app.clientId,
    name: app.name,
    icon: app.icon,
    host: hostOf(app.uri),
    canRead: app.scopes.includes('clasync:read'),
    canDraft: app.scopes.includes('clasync:write'),
    connected: day(app.connectedAt),
  }))
}

export default async function SettingsPage() {
  const user = await getSessionUser()
  if (!user) return null
  const t = await getTranslations('settings')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const isLecturer = user.role === 'lecturer'

  const data = await loadPage(async (ctx) => {
    const classes = await listMyClasses(ctx)
    if (!isLecturer) return { classes, schools: [] as SchoolGroup[], tokens: [], apps: [] }
    const schoolIds = [...new Set(classes.map((c) => c.schoolId))]
    const [schools, tokens, apps] = await Promise.all([
      Promise.all(schoolIds.map((id) => getSchool(ctx, id))),
      listAccessTokens(ctx),
      listConnectedApps(ctx),
    ])
    return {
      classes,
      schools: schools.map((school) => ({ school, classes: classes.filter((c) => c.schoolId === school.id) })),
      tokens,
      apps,
    }
  })
  if (!data.ok) return <ErrorState code={data.code} />
  const { classes, schools, tokens, apps } = data.data
  const day = dayFormatter(locale)

  return (
    <>
      <PageHeader eyebrow={isLecturer ? t('lecturer') : t('student')} title={t('title')} />

      <Panel className="flex flex-wrap items-center gap-5">
        <span
          aria-hidden="true"
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-foreground font-mono text-xl font-semibold text-background"
        >
          {initials(user.name)}
        </span>
        <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-0.5">
          <span className="text-xl font-semibold break-words">{user.name}</span>
          <span className="break-all text-[#48484a]">{user.email}</span>
          <span className="font-mono text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
            {isLecturer ? t('lecturer') : t('student')} · {user.emailVerified ? t('account.verified') : t('account.unverified')}
          </span>
        </div>
        <NameForm initialName={user.name} />
      </Panel>

      <section aria-labelledby="preferences" className="flex flex-col gap-4">
        <SectionHeading id="preferences">{t('preferences.title')}</SectionHeading>
        <Panel>
          <LanguageSwitch locale={locale} />
        </Panel>
      </section>

      {isLecturer ? (
        <section aria-labelledby="where-you-teach" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <SectionHeading id="where-you-teach">{t('schools.title')}</SectionHeading>
            </div>
            <Link href="/schools/new" className={buttonVariants({ variant: 'outline' })}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('schools.add')}
            </Link>
          </div>
          {schools.length === 0 ? (
            <Panel>
              <p className="text-muted-foreground">{t('schools.empty')}</p>
            </Panel>
          ) : (
            <ul className="flex flex-col gap-3">
              {schools.map(({ school, classes: schoolClasses }) => {
                const located = school.latitude !== null && school.longitude !== null
                return (
                  <li key={school.id}>
                    <Panel className="flex flex-col gap-3">
                      <h3 className="font-semibold">
                        {school.name} <span className="font-normal text-muted-foreground">· {school.town}</span>
                      </h3>
                      <ul className="flex flex-col gap-1">
                        {schoolClasses.map((cls) => (
                          <li key={cls.id}>
                            <Link
                              href={`/classes/${encodeURIComponent(cls.id)}`}
                              className="text-sm text-[#48484a] hover:text-primary hover:underline"
                            >
                              {cls.name} · {cls.academicYear}
                            </Link>
                          </li>
                        ))}
                      </ul>
                      {located ? (
                        <p className="text-[13px] text-muted-foreground">{t('schools.located', { radius: school.radiusM })}</p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <p className="text-[13px] text-[#9a3412]">{t('schools.notLocated')}</p>
                          <SchoolLocationButton schoolId={school.id} />
                        </div>
                      )}
                    </Panel>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ) : (
        <section aria-labelledby="my-classes" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <SectionHeading id="my-classes">{t('classes.title')}</SectionHeading>
            </div>
            <Link href="/join" className={buttonVariants({ variant: 'outline' })}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('classes.join')}
            </Link>
          </div>
          {classes.length === 0 ? (
            <Panel>
              <p className="text-muted-foreground">{t('classes.empty')}</p>
            </Panel>
          ) : (
            <ul className="flex flex-col gap-3">
              {classes.map((cls) => (
                <li key={cls.id}>
                  <Panel className="flex flex-col gap-0.5">
                    <span className="font-semibold">{cls.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {cls.schoolName} · {cls.academicYear}
                    </span>
                    {cls.myMatricule && (
                      <span className="font-mono text-xs tracking-[0.04em] text-[#48484a] uppercase">
                        {t('classes.matricule', { matricule: cls.myMatricule })}
                      </span>
                    )}
                  </Panel>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[13px] text-muted-foreground">{t('classes.matriculeHint')}</p>
        </section>
      )}

      {isLecturer && (
        <AiAssistantsSection
          connectorUrl={mcpResourceUrl(resolveAppOrigin())}
          tokens={toTokenRows(tokens, day)}
          apps={toAppRows(apps, day)}
          maxTokens={MAX_ACCESS_TOKENS}
          nameMax={TOKEN_NAME_MAX}
        />
      )}

      <section aria-labelledby="password" className="flex flex-col gap-4">
        <SectionHeading id="password">{t('password.title')}</SectionHeading>
        <Panel>
          <ChangePasswordForm />
        </Panel>
      </section>
    </>
  )
}
