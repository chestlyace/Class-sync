import type { OpenCheckIn } from '@/server/attendance/check-in'

/** An open check-in as sent to the browser (dates as ISO strings). */
export type OpenCheckInView = Omit<OpenCheckIn, 'closesAt'> & { closesAt: string }

export function toOpenCheckInView(c: OpenCheckIn): OpenCheckInView {
  return { ...c, closesAt: c.closesAt.toISOString() }
}
