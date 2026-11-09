import { ArrowRight, Info } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { getSessionUser } from '@/server/auth/session'
import { previewJoinCode } from '@/server/classes/service'
import { isVerificationPending } from '@/server/core/guards'
import { loadPage } from '../load-page'
import { JoinForm } from './join-form'

export async function generateMetadata() {
  const t = await getTranslations('join')
  return { title: t('title') }
}

/**
 * Join a class. Opened from a join link (`/join?code=…`, copied on the class page), it names the
 * class and asks for one tap (students: their matricule too); a code of the other role's kind gets
 * a plain explanation instead. Without a code, or with one that matches nothing, it is the form.
 */
export default async function JoinPage({ searchParams }: PageProps<'/join'>) {
  const user = await getSessionUser()
  if (!user || isVerificationPending(user)) return null // the layout shows the verification banner
  const t = await getTranslations('join')
  const { code: rawCode } = await searchParams
  const code = typeof rawCode === 'string' ? rawCode.trim().slice(0, 12) : ''

  if (code) {
    const preview = await loadPage((ctx) => previewJoinCode(ctx, code))
    if (preview.ok) {
      const p = preview.data
      if (p.status === 'wrong_role') {
        const key = p.codeKind === 'lecturer' ? 'wrongRole.lecturerLink' : 'wrongRole.studentLink'
        return (
          <Panel role="alert" className="flex max-w-xl flex-col items-start gap-4">
            <Info aria-hidden="true" className="size-6 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-semibold tracking-tight">{t(`${key}.title`)}</h1>
              <p className="text-muted-foreground">{t(`${key}.body`)}</p>
            </div>
            <Link href="/dashboard" className={buttonVariants({ variant: 'outline' })}>
              {t('backToDashboard')}
            </Link>
          </Panel>
        )
      }
      const where = `${p.schoolName} · ${p.academicYear}`
      if (p.status === 'member') {
        return (
          <>
            <PageHeader eyebrow={where} title={t('memberTitle', { className: p.className })} />
            <Link href={`/classes/${encodeURIComponent(p.classId)}`} className={buttonVariants({ size: 'lg', className: 'self-start' })}>
              {t('openClass')}
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Link>
          </>
        )
      }
      return (
        <>
          <PageHeader
            eyebrow={where}
            title={t('confirmTitle', { className: p.className })}
            description={user.role === 'lecturer' ? t('confirmLecturer') : t('confirmStudent')}
          />
          <Panel className="flex max-w-xl flex-col gap-5">
            <JoinForm
              role={user.role}
              defaultCode={code}
              confirm={{ className: p.className, suggestedMatricule: p.suggestedMatricule }}
            />
          </Panel>
          <Link href="/join" className="self-start text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            {t('otherCode')}
          </Link>
        </>
      )
    }
    if (preview.code !== 'NOT_FOUND') return <ErrorState code={preview.code} />
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        description={user.role === 'lecturer' ? t('lecturerDescription') : t('studentDescription')}
      />
      <Panel className="flex max-w-xl flex-col gap-5">
        {code && (
          <p role="alert" className="text-sm text-destructive">
            {t('linkNotFound')}
          </p>
        )}
        <JoinForm role={user.role} defaultCode={code} />
      </Panel>
    </>
  )
}
