import { after } from 'next/server'

type Runner = (task: () => Promise<void>) => void

let testRunner: Runner | null = null

/** Lets tests capture the scheduled work and await it. Pass null to restore the real behaviour. */
export function setAfterResponseForTests(runner: Runner | null): void {
  testRunner = runner
}

function fireAndForget(task: () => Promise<void>): void {
  void Promise.resolve()
    .then(task)
    .catch((error: unknown) => console.error('[after-response] background task failed', error))
}

/**
 * Runs slow, best-effort work (such as notification emails) once the response has been sent.
 * Inside a request it uses Next's `after()`; `after()` throws outside a request scope (scripts,
 * tests), where the task simply runs in the background with its failures logged.
 */
export function runAfterResponse(task: () => Promise<void>): void {
  if (testRunner) {
    testRunner(task)
    return
  }
  const guarded = async () => {
    try {
      await task()
    } catch (error) {
      console.error('[after-response] background task failed', error)
    }
  }
  try {
    after(guarded)
  } catch {
    fireAndForget(task)
  }
}
