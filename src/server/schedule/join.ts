import { now } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import { onlineClassJoin } from '@/server/db/schema'
import { isOnCourseRoster } from '@/server/courses/service'
import { JOIN_LEAD_MS } from './join-window'
import { resolveMeetingUrl } from './meetings'
import { loadOnlineOccurrence } from './queries'

export type JoinClassResult = { kind: 'redirect'; url: string } | { kind: 'notice'; reason: 'notOpen' | 'ended' }

function notFound(): never {
  // One answer for a missing class, a cancelled class and somebody else's class: keys cannot be probed.
  throw new AppError('NOT_FOUND', 'Online class not found')
}

/**
 * The only way a student gets a meeting URL: check everything on the server, generate it on first need, record the
 * tap, then hand the URL back. The course owner may always open their own link, but no join is recorded for them.
 */
export async function joinOnlineClass(ctx: Ctx, key: string): Promise<JoinClassResult> {
  const found = await loadOnlineOccurrence(ctx.db, key)
  if (!found) notFound()
  const { occurrence, courseId, lecturerId, meetingUrl } = found

  const open = async (): Promise<JoinClassResult> => {
    const url = await resolveMeetingUrl(ctx, occurrence, meetingUrl)
    if (!url) notFound()
    return { kind: 'redirect', url }
  }

  if (ctx.user.id === lecturerId) return open()
  if (ctx.user.role !== 'student' || occurrence.status === 'cancelled') notFound()
  if (!(await isOnCourseRoster(ctx.db, courseId, ctx.user.id))) notFound()

  const at = now()
  if (at.getTime() < occurrence.startsAt.getTime() - JOIN_LEAD_MS) return { kind: 'notice', reason: 'notOpen' }
  if (at.getTime() > occurrence.endsAt.getTime()) return { kind: 'notice', reason: 'ended' }

  const result = await open()
  if (result.kind !== 'redirect') return result
  await ctx.db
    .insert(onlineClassJoin)
    .values({ occurrenceKey: key, studentId: ctx.user.id, firstJoinedAt: at, lastJoinedAt: at })
    .onConflictDoUpdate({
      target: [onlineClassJoin.occurrenceKey, onlineClassJoin.studentId],
      set: { lastJoinedAt: at },
    })
  return result
}
