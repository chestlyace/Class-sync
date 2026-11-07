/** P = present, H = partial (one of two check-ins), A = absent. */
export type Mark = 'P' | 'H' | 'A'

const weight: Record<Mark, number> = { P: 1, H: 0.5, A: 0 }

/** Share of sessions attended, 0 to 1, with a partial counting as half. */
export function attendanceRate(marks: readonly Mark[]): number {
  if (marks.length === 0) return 0
  return marks.reduce((sum, mark) => sum + weight[mark], 0) / marks.length
}
