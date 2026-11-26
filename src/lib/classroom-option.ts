/**
 * What a lecturer's online-class form can offer for a course's classroom: nothing (switch off), the classroom ready to
 * use, or a "Create the classroom" button. `googleGranted` says whether Google already allows Clasync to make rooms.
 * Pure (no server imports) so client forms can share the type and `HIDDEN_CLASSROOM`.
 */
export type ClassroomOption =
  | { state: 'hidden' }
  | { state: 'ready'; courseId: string; knockingConfirmed: boolean }
  | { state: 'missing'; courseId: string; googleGranted: boolean }

/** A course with nothing to offer (switch off, or a course the page has no option for). */
export const HIDDEN_CLASSROOM: ClassroomOption = { state: 'hidden' }
