import { ArrowLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { DeleteConfirmForm } from '@/components/delete-confirm-form'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { RemovalImpact } from '@/components/removal-impact'
import { getSchoolDeletion, getSchoolDetail, type SchoolSummary } from '@/server/admin/schools'
import { deleteSchoolAdminAction } from '../../actions'
import { FactList } from '../../admin-ui'
import { getFormatters } from '../../format'
import { loadAdminPage } from '../../load-admin'
import { adminMetadata } from '../../metadata'
import { EditSchool, MergeSchools, MergeSearch, ReasonField, type MergeSide } from './school-actions'

export async function generateMetadata() {
  return adminMetadata('schools')
}

function side(s: SchoolSummary): MergeSide {
  return { id: s.id, name: s.name, town: s.town, classes: s.classes, hasLocation: s.hasLocation, createdAt: s.createdAt.toISOString() }
}

export default async function AdminSchoolPage({ params }: PageProps<'/admin/schools/[id]'>) {
  const { id } = await params
  const [t, f] = await Promise.all([getTranslations(), getFormatters()])
  const result = await loadAdminPage(async (ctx) => {
    const [detail, deletion] = await Promise.all([getSchoolDetail(ctx, id), getSchoolDeletion(ctx, id)])
    return { detail, deletion }
  })
  if (!result.ok) return <ErrorState code={result.code} />
  const { detail, deletion } = result.data
  const current = side(detail)

  return (
    <>
      <div className="flex flex-col gap-4">
        <Link
          href="/admin/schools"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('admin.schools.school.back')}
        </Link>
        <PageHeader eyebrow={t('admin.schools.school.eyebrow')} title={detail.name} />
      </div>

      <section aria-labelledby="facts" className="flex flex-col gap-4">
        <SectionHeading id="facts">{t('admin.schools.school.factsTitle')}</SectionHeading>
        <Panel>
          <FactList
            facts={[
              { label: t('admin.schools.school.town'), value: detail.town },
              { label: t('admin.schools.school.created'), value: f.day(detail.createdAt) },
              {
                label: t('admin.schools.school.createdBy'),
                value: (
                  <Link
                    href={`/admin/people/${encodeURIComponent(detail.creator.id)}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {detail.creator.name}
                  </Link>
                ),
              },
              {
                label: t('admin.schools.school.location'),
                value: detail.hasLocation
                  ? t('admin.schools.school.locationSet', { radius: detail.radiusM })
                  : t('admin.schools.school.locationNone'),
              },
            ]}
          />
        </Panel>
      </section>

      <section aria-labelledby="classes" className="flex flex-col gap-4">
        <SectionHeading id="classes">{t('admin.schools.school.classesTitle')}</SectionHeading>
        <Panel>
          {detail.classList.length === 0 ? (
            <p className="text-muted-foreground">{t('admin.schools.school.classesEmpty')}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {detail.classList.map((c) => (
                <li key={c.id} className="flex flex-col gap-1 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-semibold break-words">{c.name}</span>
                    <span className="text-sm break-words text-muted-foreground">
                      {c.lecturers.length === 0
                        ? t('admin.schools.school.noLecturer')
                        : c.lecturers.map((l, i) => (
                            <span key={l.id}>
                              {i > 0 && ', '}
                              <Link
                                href={`/admin/people/${encodeURIComponent(l.id)}`}
                                className="text-foreground underline-offset-4 hover:underline"
                              >
                                {l.name}
                              </Link>
                            </span>
                          ))}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col gap-0.5 text-[13px] text-muted-foreground sm:items-end sm:text-right">
                    <span className="font-mono text-[11px] font-semibold tracking-[0.1em] uppercase">{c.academicYear}</span>
                    <span>{t('admin.schools.school.classLine', { students: c.students, courses: c.courses })}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section aria-labelledby="same-town" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <SectionHeading id="same-town">{t('admin.schools.school.sameTownTitle', { town: detail.town })}</SectionHeading>
          <p className="text-sm text-muted-foreground">{t('admin.schools.school.sameTownHint')}</p>
        </div>
        <Panel>
          {detail.sameTown.length === 0 ? (
            <p className="text-muted-foreground">{t('admin.schools.school.sameTownEmpty', { town: detail.town })}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {detail.sameTown.map((other) => (
                <li key={other.id} className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <Link
                      href={`/admin/schools/${encodeURIComponent(other.id)}`}
                      className="font-semibold break-words underline-offset-4 hover:underline"
                    >
                      {other.name}
                    </Link>
                    <span className="text-[13px] text-muted-foreground">
                      {t('admin.schools.school.classCount', { count: other.classes })}
                    </span>
                  </span>
                  <MergeSchools current={current} other={side(other)} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section aria-labelledby="change" className="flex flex-col gap-4">
        <SectionHeading id="change">{t('admin.schools.school.actionsTitle')}</SectionHeading>
        <div className="flex flex-wrap gap-2.5">
          <EditSchool school={{ id: detail.id, name: detail.name, town: detail.town }} />
          <MergeSearch current={current} />
        </div>
      </section>

      <Panel className="flex flex-col gap-5 border-destructive/30">
        <div className="flex flex-col gap-2">
          <SectionHeading>{t('admin.schools.school.deleteTitle')}</SectionHeading>
          <p className="text-sm text-muted-foreground">{t('admin.schools.school.deleteBody')}</p>
          <p className="text-sm font-medium">{t('admin.schools.school.deleteClasses', { count: deletion.classes })}</p>
        </div>
        <RemovalImpact impact={deletion.impact} students="studentsClass" showCourses />
        <DeleteConfirmForm
          action={deleteSchoolAdminAction}
          hidden={{ schoolId: detail.id }}
          confirmText={detail.name}
          label={t('removal.confirmLabel', { name: detail.name })}
          buttonLabel={t('admin.schools.school.delete')}
          pendingLabel={t('admin.schools.school.deleting')}
        >
          <ReasonField />
        </DeleteConfirmForm>
      </Panel>
    </>
  )
}
