import { getCtx } from '@/server/auth/session'
import { now } from '@/server/core/clock'
import { config } from '@/server/core/config'
import { requireCourseOwner } from '@/server/courses/service'
import { contentDisposition, errorResponse } from '@/server/files/http'
import { buildCaWorkbook, exportFileName, XLSX_MIME } from '@/server/performance/export'
import { getCourseCa } from '@/server/performance/service'

// The sheet is built per request from live attendance and grades; never prerender or cache it.
export const dynamic = 'force-dynamic'

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }

/**
 * The CA sheet as an Excel file, in the lecturer's language. Owner only: 401 signed out, 403 for a
 * student, a colleague, or a course that does not exist (the same answer, so ids can't be probed).
 */
export async function GET(_request: Request, { params }: RouteContext<'/courses/[courseId]/performance/export'>) {
  try {
    const { courseId } = await params
    const ctx = await getCtx()
    const course = await requireCourseOwner(ctx, courseId)
    const { settings, rows } = await getCourseCa(ctx, courseId)
    const label = course.code?.trim() || course.title
    const buffer = await buildCaWorkbook({
      settings,
      rows,
      locale: ctx.user.locale,
      courseLabel: label,
    })
    const name = exportFileName(label, now(), config.timeZone)
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': XLSX_MIME,
        'Content-Disposition': contentDisposition(name, false),
        'Content-Length': String(buffer.length),
        ...PRIVATE_HEADERS,
      },
    })
  } catch (err) {
    const res = errorResponse(err)
    for (const [key, value] of Object.entries(PRIVATE_HEADERS)) res.headers.set(key, value)
    return res
  }
}
