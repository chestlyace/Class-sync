import { getTranslations } from 'next-intl/server'
import { PageHeader, Panel } from '@/components/page-header'
import { getSessionUser } from '@/server/auth/session'
import { isVerificationPending } from '@/server/core/guards'
import { JoinForm } from './join-form'

export async function generateMetadata() {
  const t = await getTranslations('join')
  return { title: t('title') }
}

export default async function JoinPage({ searchParams }: PageProps<'/join'>) {
  const user = await getSessionUser()
  if (!user || isVerificationPending(user)) return null // the layout shows the verification banner
  const t = await getTranslations('join')
  const { code } = await searchParams
  return (
    <>
      <PageHeader
        title={t('title')}
        description={user.role === 'lecturer' ? t('lecturerDescription') : t('studentDescription')}
      />
      <Panel className="max-w-xl">
        <JoinForm role={user.role} defaultCode={typeof code === 'string' ? code.slice(0, 12) : ''} />
      </Panel>
    </>
  )
}
