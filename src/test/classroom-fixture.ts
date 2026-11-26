import type { Db } from '@/server/db'
import { courseClassroom } from '@/server/db/schema'

export const CLASSROOM_URL = 'https://meet.google.com/room-room-room'

/** Gives a course its Meet classroom row directly, without touching Google. */
export async function seedClassroom(
  db: Db,
  courseId: string,
  createdBy: string,
  over: Partial<typeof courseClassroom.$inferInsert> = {},
) {
  const [row] = await db
    .insert(courseClassroom)
    .values({
      courseId,
      spaceName: 'spaces/room',
      meetingUrl: CLASSROOM_URL,
      meetingCode: 'room-room-room',
      googleAccountId: 'acc-1',
      knockingConfirmed: true,
      createdBy,
      ...over,
    })
    .returning()
  return row
}
