import { Plus } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { Eyebrow, PageHeader, Panel } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { getSessionUser } from '@/server/auth/session'
import { isVerificationPending } from '@/server/core/guards'
import { getSchool } from '@/server/schools/service'
import { loadPage } from '../../load-page'
import { SchoolSearch } from '../../schools/school-search'
import { NewClassForm } from '../new-class-form'

export async function generateMetadata() {
  const t = await getTranslations('classes.new')
  return { title: t('title') }
}

/** "2026/27" from August onwards, else the year that started last August. */
function currentAcademicYear(now = new Date()): string {
  const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`
}

export default async function NewClassPage({ searchParams }: PageProps<'/classes/new'>) {
  const user = await getSessionUser()
  if (!user || isVerificationPending(user)) return null // the layout shows the verification banner
  if (user.role !== 'lecturer') return <ErrorState code="FORBIDDEN" />
  const t = await getTranslations()
  const { schoolId } = await searchParams
  const header = <PageHeader title={t('classes.new.title')} description={t('classes.new.description')} />

  if (typeof schoolId !== 'string' || schoolId === '') {
    return (
      <>
        {header}
        <Panel className="flex flex-col gap-5">
          <p className="font-medium">{t('classes.new.pickSchool')}</p>
          <SchoolSearch />
          <Link href="/schools/new" className={buttonVariants({ variant: 'outline', className: 'self-start' })}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('schools.new.addSchool')}
          </Link>
        </Panel>
      </>
    )
  }

  const school = await loadPage((ctx) => getSchool(ctx, schoolId))
  if (!school.ok) return <ErrorState code={school.code} />

  return (
    <>
      {header}
      <Panel className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <Eyebrow>{t('classes.new.school')}</Eyebrow>
            <p className="font-semibold">
              {school.data.name} <span className="font-normal text-muted-foreground">· {school.data.town}</span>
            </p>
          </div>
          <Link href="/classes/new" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {t('classes.new.changeSchool')}
          </Link>
        </div>
        <NewClassForm schoolId={school.data.id} defaultYear={currentAcademicYear()} />
      </Panel>
    </>
  )
}
