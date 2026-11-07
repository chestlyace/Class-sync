let override: (() => Date) | null = null

/** The current time. Always go through this so tests can control it. */
export function now(): Date {
  return override ? override() : new Date()
}

/** Test-only: replace the clock; pass null to restore real time. */
export function setNowForTests(fn: (() => Date) | null): void {
  override = fn
}
