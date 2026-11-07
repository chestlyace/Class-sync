import { getTranslations } from 'next-intl/server'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { getSessionUser } from '@/server/auth/session'
import { isVerificationPending } from '@/server/core/guards'
import { ErrorState } from '@/components/error-state'
import { NewSchoolForm } from '../new-school-form'
import { SchoolSearch } from '../school-search'

export async function generateMetadata() {
  const t = await getTranslations('schools.new')
  return { title: t('title') }
}

export default async function NewSchoolPage() {
  const user = await getSessionUser()
  if (!user || isVerificationPending(user)) return null // the layout shows the verification banner
  if (user.role !== 'lecturer') return <ErrorState code="FORBIDDEN" />
  const t = await getTranslations('schools.new')
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <PageHeader eyebrow={t('step')} title={t('title')} description={t('description')} />
      <Panel>
        <SchoolSearch />
      </Panel>
      <section aria-labelledby="new-school" className="flex flex-col gap-5">
        <SectionHeading id="new-school">{t('createTitle')}</SectionHeading>
        <p className="text-muted-foreground">{t('createDescription')}</p>
        <Panel>
          <NewSchoolForm />
        </Panel>
      </section>
    </div>
  )
}
