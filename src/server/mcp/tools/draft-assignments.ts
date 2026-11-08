import { z } from 'zod'
import {
  createAssignment,
  getAssignmentForEdit,
  suggestSubmissionMark,
  updateAssignment,
  type AssignmentDetail,
} from '@/server/assignments/lecturer'
import { FEEDBACK_MAX, MARK_STEP } from '@/server/assignments/rules'
import { markdownToBlocks } from '../markdown'
import { defineTool } from '../tool'

const INSTRUCTIONS_MAX = 50_000

const isQuarterStep = (n: number) => Number.isInteger(n / MARK_STEP)
const isCents = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6

const fields = {
  title: z.string().trim().min(2).max(200).describe('The assignment title, 2 to 200 characters.'),
  instructions: z
    .string()
    .min(1)
    .max(INSTRUCTIONS_MAX)
    .describe('What students must do, as plain text or simple markdown (headings, lists, bold, italic, links).'),
  dueAt: z.iso
    .datetime({ offset: true })
    .describe('The due date and time, ISO 8601 with a time zone, e.g. 2026-11-20T23:59:00+01:00. Must be in the future.'),
  maxMark: z
    .number()
    .min(1)
    .max(1000)
    .refine(isCents, 'At most two decimals')
    .describe('The mark the assignment is out of, 1 to 1000.'),
  weight: z
    .number()
    .min(0.25)
    .max(100)
    .refine(isCents, 'At most two decimals')
    .describe("How much it counts among the course's assignments in the CA, 0.25 to 100."),
  submissionType: z
    .enum(['files', 'text', 'both'])
    .describe('How students hand in: uploaded files, typed text, or both.'),
  latePolicy: z
    .enum(['accept', 'close'])
    .describe('After the due date: accept late work (marked late) or close submissions.'),
}

function view(a: AssignmentDetail) {
  return {
    id: a.id,
    courseId: a.courseId,
    title: a.title,
    status: a.status,
    dueAt: a.dueAt.toISOString(),
    maxMark: a.maxMark,
    weight: a.weight,
    submissionType: a.submissionMode,
    latePolicy: a.latePolicy,
    attachments: a.attachments.map((f) => f.name),
    note: 'Draft: students cannot see it. The lecturer reviews and publishes it in Clasync.',
  }
}

const createAssignmentDraft = defineTool({
  name: 'create_assignment_draft',
  title: 'Create an assignment draft',
  description:
    "Creates an assignment as a DRAFT in one of the lecturer's courses (courseId from list_courses). Students never see a draft; the lecturer reviews it and publishes it in Clasync (publishing emails the class — this tool never does). Instructions take plain text or simple markdown. No file attachments.",
  scope: 'clasync:write',
  input: z.object({
    courseId: z.string().min(1).describe('The course, from list_courses.'),
    title: fields.title,
    instructions: fields.instructions,
    dueAt: fields.dueAt,
    maxMark: fields.maxMark.default(20),
    weight: fields.weight.default(1),
    submissionType: fields.submissionType.default('both'),
    latePolicy: fields.latePolicy.default('accept'),
  }),
  run: async (ctx, input) => {
    const created = await createAssignment(ctx, input.courseId, {
      title: input.title,
      instructions: markdownToBlocks(input.instructions),
      dueAt: new Date(input.dueAt),
      maxMark: input.maxMark,
      weight: input.weight,
      submissionMode: input.submissionType,
      latePolicy: input.latePolicy,
      attachmentIds: [],
    })
    return view(created)
  },
})

const updateAssignmentDraft = defineTool({
  name: 'update_assignment_draft',
  title: 'Update an assignment draft',
  description:
    'Changes a DRAFT assignment (assignmentId from list_assignments or create_assignment_draft). Only the fields given change; instructions given replace the old ones. A published assignment is refused (CONFLICT): the lecturer edits it in Clasync. It stays a draft until the lecturer publishes it in Clasync. Existing attachments are kept.',
  scope: 'clasync:write',
  input: z.object({
    assignmentId: z.string().min(1).describe('The draft assignment, from list_assignments or create_assignment_draft.'),
    title: fields.title.optional(),
    instructions: fields.instructions.optional(),
    dueAt: fields.dueAt.optional(),
    maxMark: fields.maxMark.optional(),
    weight: fields.weight.optional(),
    submissionType: fields.submissionType.optional(),
    latePolicy: fields.latePolicy.optional(),
  }),
  run: async (ctx, input) => {
    const current = await getAssignmentForEdit(ctx, input.assignmentId)
    const updated = await updateAssignment(
      ctx,
      input.assignmentId,
      {
        title: input.title ?? current.title,
        instructions: input.instructions !== undefined ? markdownToBlocks(input.instructions) : current.instructions,
        dueAt: input.dueAt !== undefined ? new Date(input.dueAt) : current.dueAt,
        maxMark: input.maxMark ?? current.maxMark,
        weight: input.weight ?? current.weight,
        submissionMode: input.submissionType ?? current.submissionMode,
        latePolicy: input.latePolicy ?? current.latePolicy,
        attachmentIds: current.attachments.map((f) => f.id),
      },
      { draftOnly: true },
    )
    return view(updated)
  },
})

const suggestAssignmentGrade = defineTool({
  name: 'suggest_assignment_grade',
  title: 'Suggest an assignment grade',
  description:
    "Suggests a mark and feedback for one submission (submissionId from list_submissions). It is only a SUGGESTION: the lecturer sees it on the grading page in Clasync and decides; the grade is not saved and nothing reaches the student. A submission that already has a grade is refused (CONFLICT). The mark is 0 to the assignment's max mark, in steps of 0.25. A new suggestion replaces the previous one.",
  scope: 'clasync:write',
  input: z.object({
    submissionId: z.string().min(1).describe('The submission, from list_submissions.'),
    mark: z
      .number()
      .min(0)
      .refine(isQuarterStep, 'Marks go in steps of 0.25')
      .describe("The suggested mark, 0 to the assignment's max mark, in steps of 0.25."),
    feedback: z
      .string()
      .max(FEEDBACK_MAX)
      .optional()
      .describe(`Suggested feedback for the student, up to ${FEEDBACK_MAX} characters.`),
  }),
  run: async (ctx, input) => {
    const saved = await suggestSubmissionMark(ctx, input.submissionId, {
      mark: input.mark,
      feedback: input.feedback ?? null,
    })
    return {
      submissionId: input.submissionId,
      suggestedMark: saved.mark,
      suggestedFeedback: saved.feedback,
      suggestedAt: saved.at.toISOString(),
      note: 'Suggestion only: not a grade. The lecturer reviews it and saves the grade in Clasync.',
    }
  },
})

export const assignmentDraftTools = [createAssignmentDraft, updateAssignmentDraft, suggestAssignmentGrade]
