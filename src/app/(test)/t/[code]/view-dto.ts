import type { AttemptView } from '@/server/tests/attempt'

/** `AttemptView` as it crosses to the browser: dates as ISO strings, plus the revs the server acknowledged. */
export type AttemptViewDto = Omit<AttemptView, 'endsAt' | 'serverNow'> & {
  endsAt: string | null
  serverNow: string
  /** Per question, the rev the server now holds (empty for open and hand-in). */
  acceptedRevs: Record<string, number>
}

export function toAttemptViewDto(view: AttemptView & { acceptedRevs?: Record<string, number> }): AttemptViewDto {
  return {
    attemptId: view.attemptId,
    stage: view.stage,
    info: view.info,
    endsAt: view.endsAt?.toISOString() ?? null,
    serverNow: view.serverNow.toISOString(),
    exitsSoFar: view.exitsSoFar,
    paper: view.paper,
    saved: view.saved,
    result: view.result,
    awaitingRelease: view.awaitingRelease,
    acceptedRevs: view.acceptedRevs ?? {},
  }
}
