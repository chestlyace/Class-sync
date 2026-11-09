import { z } from 'zod'
import { MARK_STEP } from '@/server/assignments/rules'
import { createTest, getTestForEdit, updateTest, type TestSummary } from '@/server/tests/authoring'
import { ASSISTANT_SUGGEST_MAX, storeAssistantSuggestions } from '@/server/tests/marking'
import {
  COMMENT_MAX,
  DEFAULT_DURATION_MINUTES,
  DEFAULT_MAX_ABSENCE_SECONDS,
  DEFAULT_MAX_EXITS,
  DEFAULT_QUESTION_MARK,
  DEFAULT_TEST_WEIGHT,
  DURATION_MAX,
  DURATION_MIN,
  GUIDE_MAX,
  MAX_ABSENCE_MAX,
  MAX_ABSENCE_MIN,
  MAX_EXITS_MAX,
  MAX_EXITS_MIN,
  MAX_QUESTIONS,
  MCQ_OPTIONS_MAX,
  MCQ_OPTIONS_MIN,
  OPTION_MAX,
  PROMPT_MAX,
  QUESTION_MARK_MAX,
  TEST_WEIGHT_MAX,
  TITLE_MAX,
  type QuestionInput,
} from '@/server/tests/rules'
import { defineTool } from '../tool'

const isQuarterStep = (n: number) => Number.isInteger(n / MARK_STEP)

const questionMark = z
  .number()
  .min(MARK_STEP)
  .max(QUESTION_MARK_MAX)
  .refine(isQuarterStep, 'Marks go in steps of 0.25')

const mcq = z.object({
  kind: z.literal('mcq'),
  prompt: z.string().trim().min(1).max(PROMPT_MAX),
  mark: questionMark.optional().describe("This question's mark; left out = the test's default mark."),
  options: z
    .array(z.object({ text: z.string().trim().min(1).max(OPTION_MAX), correct: z.boolean() }))
    .min(MCQ_OPTIONS_MIN)
    .max(MCQ_OPTIONS_MAX)
    .refine((options) => options.filter((o) => o.correct).length === 1, 'Exactly one option must be correct')
    .describe(`${MCQ_OPTIONS_MIN} to ${MCQ_OPTIONS_MAX} options, exactly one with correct: true.`),
})

const short = z.object({
  kind: z.literal('short'),
  prompt: z.string().trim().min(1).max(PROMPT_MAX),
  mark: questionMark.optional().describe("This question's mark; left out = the test's default mark."),
  guide: z
    .string()
    .trim()
    .min(1)
    .max(GUIDE_MAX)
    .describe('The marking guide: what a full-mark answer contains. The lecturer marks short answers by hand.'),
})

const questions = z
  .array(z.discriminatedUnion('kind', [mcq, short]))
  .min(1)
  .max(MAX_QUESTIONS)
  .describe(
    `1 to ${MAX_QUESTIONS} questions: multiple choice (kind "mcq", options with one correct) or short answer (kind "short", with a marking guide).`,
  )

const settings = {
  title: z.string().trim().min(1).max(TITLE_MAX),
  durationMinutes: z.number().int().min(DURATION_MIN).max(DURATION_MAX).describe('How long students have, in minutes.'),
  defaultMark: questionMark.describe('The mark of a question that does not set its own.'),
  shuffle: z.boolean().describe('Shuffle question and option order per student.'),
  maxExits: z
    .number()
    .int()
    .min(MAX_EXITS_MIN)
    .max(MAX_EXITS_MAX)
    .describe('How many times a student may leave the test page before the attempt ends.'),
  maxAbsenceSeconds: z
    .number()
    .int()
    .min(MAX_ABSENCE_MIN)
    .max(MAX_ABSENCE_MAX)
    .describe('How long one absence from the test page may last, in seconds.'),
  weight: z
    .number()
    .min(MARK_STEP)
    .max(TEST_WEIGHT_MAX)
    .refine(isQuarterStep, 'Weights go in steps of 0.25')
    .describe("How much the test counts among the course's tests in the CA."),
}

type QuestionArg = z.infer<typeof questions>[number]

const toQuestionInput = (q: QuestionArg): QuestionInput =>
  q.kind === 'mcq'
    ? { kind: 'mcq', prompt: q.prompt, mark: q.mark ?? null, options: q.options }
    : { kind: 'short', prompt: q.prompt, mark: q.mark ?? null, guide: q.guide }

function view(t: TestSummary) {
  return {
    id: t.id,
    courseId: t.courseId,
    title: t.title,
    state: t.state,
    questionCount: t.questionCount,
    totalMarks: t.totalMarks,
    durationMinutes: t.durationMinutes,
    note: 'Not started: students cannot see the questions. The lecturer reviews the test and starts it in class in Clasync.',
  }
}

const createTestTool = defineTool({
  name: 'create_test',
  title: 'Create a test',
  description:
    "Creates a test that has NOT started in one of the lecturer's courses (courseId from list_courses). Students see no questions until the lecturer reviews it and starts it in class in Clasync; this tool never starts it. Questions are multiple choice (exactly one correct option) or short answer (with a marking guide).",
  scope: 'clasync:write',
  input: z.object({
    courseId: z.string().min(1).describe('The course, from list_courses.'),
    title: settings.title,
    durationMinutes: settings.durationMinutes.default(DEFAULT_DURATION_MINUTES),
    defaultMark: settings.defaultMark.default(DEFAULT_QUESTION_MARK),
    shuffle: settings.shuffle.default(true),
    maxExits: settings.maxExits.default(DEFAULT_MAX_EXITS),
    maxAbsenceSeconds: settings.maxAbsenceSeconds.default(DEFAULT_MAX_ABSENCE_SECONDS),
    weight: settings.weight.default(DEFAULT_TEST_WEIGHT),
    questions,
  }),
  run: async (ctx, { courseId, questions: qs, ...rest }) => {
    const created = await createTest(ctx, courseId, { ...rest, questions: qs.map(toQuestionInput) })
    return view(created)
  },
})

const updateTestTool = defineTool({
  name: 'update_test',
  title: 'Update a test',
  description:
    'Changes a test that has NOT started yet (testId from list_tests or create_test). Only the settings given change; questions, when given, replace ALL the questions. A started test is refused (CONFLICT). The lecturer still starts it in class in Clasync.',
  scope: 'clasync:write',
  input: z.object({
    testId: z.string().min(1).describe('The test, from list_tests or create_test.'),
    title: settings.title.optional(),
    durationMinutes: settings.durationMinutes.optional(),
    defaultMark: settings.defaultMark.optional(),
    shuffle: settings.shuffle.optional(),
    maxExits: settings.maxExits.optional(),
    maxAbsenceSeconds: settings.maxAbsenceSeconds.optional(),
    weight: settings.weight.optional(),
    questions: questions.optional(),
  }),
  run: async (ctx, { testId, questions: qs, ...changes }) => {
    const { input: current } = await getTestForEdit(ctx, testId)
    const defined = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined))
    const updated = await updateTest(ctx, testId, {
      ...current,
      ...defined,
      questions: qs ? qs.map(toQuestionInput) : current.questions,
    })
    return view(updated)
  },
})

const suggestTestMarks = defineTool({
  name: 'suggest_test_marks',
  title: 'Suggest marks for short answers',
  description:
    "Suggests marks for short answers of an ENDED test (testId from list_tests; attemptId and questionId from get_test_results' answers to mark). These are only SUGGESTIONS: the lecturer sees them in Clasync's marking page and confirms or changes each one; no mark is saved and nothing reaches students. Answers the lecturer already marked, blank answers and unknown ones are skipped and listed. Each mark is 0 to the question's mark, in steps of 0.25, with a short reason.",
  scope: 'clasync:write',
  input: z.object({
    testId: z.string().min(1).describe('The ended test, from list_tests.'),
    suggestions: z
      .array(
        z.object({
          attemptId: z.string().min(1),
          questionId: z.string().min(1),
          mark: z.number().min(0).refine(isQuarterStep, 'Marks go in steps of 0.25'),
          reason: z.string().trim().min(1).max(COMMENT_MAX).describe('Why this mark, for the lecturer.'),
        }),
      )
      .min(1)
      .max(ASSISTANT_SUGGEST_MAX),
  }),
  run: async (ctx, input) => {
    const result = await storeAssistantSuggestions(ctx, input.testId, input.suggestions)
    return {
      testId: input.testId,
      suggested: result.suggested.length,
      skipped: result.skipped,
      note: 'Suggestions only: the lecturer confirms each mark in Clasync before anything counts or is released.',
    }
  },
})

export const testDraftTools = [createTestTool, updateTestTool, suggestTestMarks]
