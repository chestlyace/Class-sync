import { getTranslations } from 'next-intl/server'
import { DeleteConfirmForm } from '@/components/delete-confirm-form'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { RemovalImpact } from '@/components/removal-impact'
import { getClassRemoval } from '@/server/classes/remove'
import { getClassSettings } from '@/server/classes/service'
import { loadPage } from '../../../load-page'
import { removeClassAction } from '../../actions'
import { EditClassForm } from './edit-class-form'
import { EditSchoolForm } from './edit-school-form'

export async function generateMetadata() {
  const t = await getTranslations('classes.settings')
  return { title: t('eyebrow') }
}

export default async function ClassSettingsPage({ params }: PageProps<'/classes/[classId]/settings'>) {
  const { classId } = await params
  const t = await getTranslations()
  // Lecturers of the class only: students and outsiders get FORBIDDEN.
  const view = await loadPage(async (ctx) => {
    const [settings, removal] = await Promise.all([getClassSettings(ctx, classId), getClassRemoval(ctx, classId)])
    return { settings, removal }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { settings, removal } = view.data
  const leaving = removal.mode === 'leave'

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <PageHeader
        eyebrow={`${t('classes.settings.eyebrow')} · ${settings.school.name}`}
        title={settings.name}
        description={t('classes.settings.description')}
      />
      <Panel className="flex flex-col gap-5">
        <SectionHeading>{t('classes.settings.classTitle')}</SectionHeading>
        <EditClassForm cls={settings} />
      </Panel>
      <Panel className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <SectionHeading>{t('classes.settings.schoolTitle')}</SectionHeading>
          {settings.schoolClassCount > 1 ? (
            <p className="text-sm text-muted-foreground">
              {t('classes.settings.schoolShared', { count: settings.schoolClassCount })}
            </p>
          ) : null}
        </div>
        <EditSchoolForm classId={settings.id} school={settings.school} />
      </Panel>
      <Panel className="flex flex-col gap-5 border-destructive/30">
        <div className="flex flex-col gap-2">
          <SectionHeading>{t(leaving ? 'classes.settings.leaveTitle' : 'classes.settings.deleteTitle')}</SectionHeading>
          <p className="text-sm text-muted-foreground">
            {t(leaving ? 'classes.settings.leaveBody' : 'classes.settings.deleteBody')}
          </p>
        </div>
        <RemovalImpact impact={removal.impact} students="studentsClass" showCourses />
        <DeleteConfirmForm
          action={removeClassAction}
          hidden={{ classId: settings.id, expectedMode: removal.mode }}
          confirmText={settings.name}
          label={t('removal.confirmLabel', { name: settings.name })}
          buttonLabel={t(leaving ? 'classes.settings.leave' : 'classes.settings.delete')}
          pendingLabel={t(leaving ? 'classes.settings.leaving' : 'classes.settings.deleting')}
          conflictMessage={t('classes.settings.changed')}
        />
      </Panel>
    </div>
  )
}
