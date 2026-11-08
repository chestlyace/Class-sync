/**
 * A student's practice answers waiting to be sent, kept in localStorage so an offline round, or a
 * closed page, is not lost. Per course; the latest answer per question wins. Every call is safe:
 * no storage, a throwing accessor or corrupted JSON read as an empty queue and never throw.
 */
export type Outcome = { questionId: string; correct: boolean }

/** The most outcomes `recordPracticeOutcomes` takes in one call. */
const BATCH_SIZE = 200

export const queueKey = (courseId: string) => `clasync:practice:${courseId}`

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function read(courseId: string): Outcome[] {
  try {
    const raw = storage()?.getItem(queueKey(courseId))
    if (raw == null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (o): o is Outcome =>
        typeof o === 'object' && o !== null && typeof o.questionId === 'string' && typeof o.correct === 'boolean',
    )
  } catch {
    return []
  }
}

function write(courseId: string, outcomes: Outcome[]): void {
  try {
    const store = storage()
    if (!store) return
    if (outcomes.length === 0) store.removeItem(queueKey(courseId))
    else store.setItem(queueKey(courseId), JSON.stringify(outcomes))
  } catch {
    // Full or blocked storage: the answer is lost on this device only.
  }
}

/** The queue with one entry per question, the latest. */
function latest(outcomes: Outcome[]): Outcome[] {
  const byQuestion = new Map<string, boolean>()
  for (const o of outcomes) {
    byQuestion.delete(o.questionId)
    byQuestion.set(o.questionId, o.correct)
  }
  return [...byQuestion].map(([questionId, correct]) => ({ questionId, correct }))
}

export function enqueue(courseId: string, outcome: Outcome): void {
  write(courseId, latest([...read(courseId), { questionId: outcome.questionId, correct: outcome.correct }]))
}

const draining = new Set<string>()

/**
 * Sends what is queued, in batches. A batch that `send` accepts leaves the queue (unless the
 * student answered the same question differently meanwhile); a refusal or an error stops the drain
 * and keeps everything not yet sent for the next call.
 */
export async function drain(courseId: string, send: (batch: Outcome[]) => Promise<boolean>): Promise<void> {
  if (draining.has(courseId)) return
  draining.add(courseId)
  try {
    for (;;) {
      const batch = latest(read(courseId)).slice(0, BATCH_SIZE)
      if (batch.length === 0) return
      let ok = false
      try {
        ok = await send(batch)
      } catch {
        ok = false
      }
      if (!ok) return
      const sent = new Map(batch.map((o) => [o.questionId, o.correct]))
      write(
        courseId,
        latest(read(courseId)).filter((o) => sent.get(o.questionId) !== o.correct),
      )
    }
  } finally {
    draining.delete(courseId)
  }
}
