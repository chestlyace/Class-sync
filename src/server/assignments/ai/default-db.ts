import { db } from '@/server/db'
import { runMarkingJob, type MarkingJobResult } from './job'
import type { MarkingMessage } from './queue'

// Route handlers under src/app may not import the database layer, so they reach this on the app's own database.

/** `runMarkingJob` on the app's own database, with the configured suggester. */
export function runMarkingJobDefault(message: MarkingMessage): Promise<MarkingJobResult> {
  return runMarkingJob(db, message)
}
