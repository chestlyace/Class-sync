import type { AttemptView, SyncView } from '@/server/tests/attempt'

/**
 * `AttemptView` as it crosses to the browser: dates as ISO strings, plus the revs the server
 * acknowledged. A sync that did not ask for them leaves out `paper` and `saved` (the device keeps
 * the paper it holds).
 */
export type AttemptViewDto = Omit<AttemptView, 'endsAt' | 'serverNow' | 'paper' | 'saved'> &
  Partial<Pick<AttemptView, 'paper' | 'saved'>> & {
    endsAt: string | null
    serverNow: string
    /** Per question, the rev the server now holds (empty for open and hand-in). */
    acceptedRevs: Record<string, number>
  }

export function toAttemptViewDto(view: AttemptView | (Omit<SyncView, 'acceptedRevs'> & { acceptedRevs?: Record<string, number> })): AttemptViewDto {
  return {
    attemptId: view.attemptId,
    stage: view.stage,
    info: view.info,
    endsAt: view.endsAt?.toISOString() ?? null,
    serverNow: view.serverNow.toISOString(),
    exitsSoFar: view.exitsSoFar,
    ...(view.paper !== undefined ? { paper: view.paper } : {}),
    ...(view.saved !== undefined ? { saved: view.saved } : {}),
    result: view.result,
    awaitingRelease: view.awaitingRelease,
    acceptedRevs: ('acceptedRevs' in view ? view.acceptedRevs : undefined) ?? {},
  }
}
