import { Plus } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { getSessionUser } from '@/server/auth/session'
import { listMyClasses } from '@/server/classes/service'
import { isVerificationPending } from '@/server/core/guards'
import { loadPage } from '../../load-page'
import { NewCourseForm } from '../new-course-form'

export async function generateMetadata() {
  const t = await getTranslations('courses.new')
  return { title: t('title') }
}

export default async function NewCoursePage({ searchParams }: PageProps<'/courses/new'>) {
  const user = await getSessionUser()
  if (!user || isVerificationPending(user)) return null // the layout shows the verification banner
  if (user.role !== 'lecturer') return <ErrorState code="FORBIDDEN" />
  const t = await getTranslations()
  const { classId } = await searchParams
  const classes = await loadPage((ctx) => listMyClasses(ctx))
  if (!classes.ok) return <ErrorState code={classes.code} />

  const options = classes.data.map((c) => ({ id: c.id, label: `${c.name} · ${c.academicYear} · ${c.schoolName}` }))
  const defaultClassId = typeof classId === 'string' && options.some((o) => o.id === classId) ? classId : ''

  return (
    <>
      <PageHeader title={t('courses.new.title')} description={t('courses.new.description')} />
      <Panel className="max-w-2xl">
        {options.length === 0 ? (
          <div className="flex flex-col items-start gap-4">
            <p className="text-muted-foreground">{t('courses.new.noClasses')}</p>
            <Link href="/classes/new" className={buttonVariants()}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('dashboard.newClass')}
            </Link>
          </div>
        ) : (
          <NewCourseForm classes={options} defaultClassId={defaultClassId} />
        )}
      </Panel>
    </>
  )
}
