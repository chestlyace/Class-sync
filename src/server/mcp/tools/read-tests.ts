import { z } from 'zod'
import { AppError } from '@/server/core/errors'
import { getTestForEdit, listCourseTests, type TestSummary } from '@/server/tests/authoring'
import { getMarkingQuestion, type MarkingQuestion } from '@/server/tests/marking'
import { questionMark } from '@/server/tests/rules'
import { getTestResults } from '@/server/tests/run'
import { defineTool } from '../tool'
import { id, iso } from './read-shared'

const testId = id('The test id, from list_tests.')

function testBrief(t: TestSummary) {
  return {
    id: t.id,
    title: t.title,
    code: t.code,
    state: t.state,
    resultsReleased: t.state === 'released',
    questionCount: t.questionCount,
    totalMarks: t.totalMarks,
    hasShortAnswers: t.hasShort,
    durationMinutes: t.durationMinutes,
    startedAt: iso(t.startedAt),
    endsAt: iso(t.endsAt),
    joined: t.joined,
  }
}

export const listTests = defineTool({
  name: 'list_tests',
  title: 'List tests',
  description:
    "A course's tests, newest first: id, title, join code, state (not_started, running, ended, or released once results " +
    'are out), question count, total marks, whether it has short answers (marked by hand), duration, start and end times, ' +
    'and how many students joined. Needs courseId from list_courses.',
  scope: 'clasync:read',
  input: z.object({ courseId: id('The course id, from list_courses.') }),
  run: async (ctx, { courseId }) => {
    const tests = await listCourseTests(ctx, courseId)
    return { tests: tests.map(testBrief) }
  },
})

export const getTest = defineTool({
  name: 'get_test',
  title: 'Get a test',
  description:
    "A test as its lecturer sees it in the editor: settings (duration, default mark, shuffle, allowed exits, weight in the CA) " +
    'and every question in order with its id, kind (mcq or short), prompt, mark, the options with the correct one flagged ' +
    '(mcq) or the marking guide (short). Needs testId from list_tests.',
  scope: 'clasync:read',
  input: z.object({ testId }),
  run: async (ctx, { testId }) => {
    const { summary, input } = await getTestForEdit(ctx, testId)
    return {
      ...testBrief(summary),
      settings: {
        durationMinutes: input.durationMinutes,
        defaultMark: input.defaultMark,
        shuffle: input.shuffle,
        maxExits: input.maxExits,
        maxAbsenceSeconds: input.maxAbsenceSeconds,
        weight: input.weight,
      },
      questions: input.questions.map((q, i) => ({
        id: q.id,
        number: i + 1,
        kind: q.kind,
        prompt: q.prompt,
        mark: questionMark(q, input.defaultMark),
        ...(q.kind === 'mcq'
          ? { options: q.options.map((o) => ({ text: o.text, correct: o.correct })) }
          : { guide: q.guide }),
      })),
    }
  },
})

function isConflict(e: unknown, reason: string): e is AppError {
  return e instanceof AppError && e.code === 'CONFLICT' && e.details?.reason === reason
}

/** The short answers of the question still waiting for a confirmed mark, as the marking page shows them. */
function unconfirmed(q: MarkingQuestion) {
  const answers = q.answers
    .filter((a) => a.mark === null)
    .map((a) => ({
      attemptId: a.attemptId,
      studentId: a.studentId,
      name: a.name,
      matricule: a.matricule,
      answer: a.text,
      suggestion: a.suggestion,
    }))
  return {
    questionId: q.questionId,
    number: q.number,
    prompt: q.prompt,
    guide: q.guide,
    maxMark: q.maxMark,
    answers,
  }
}

export const getTestResultsTool = defineTool({
  name: 'get_test_results',
  title: 'Get test results',
  description:
    'Results of an ended test: per student on the roster their status, score out of the total, and how many short answers ' +
    'still wait for a mark. `toMark` lists, per short-answer question, the answers without a confirmed mark: the question, ' +
    'the marking guide, the max mark, each answer text (with its attemptId) and any existing suggestion. Answers become ' +
    'markable 2 minutes after the end; before that `toMark` is empty and `toMarkFrom` says when. A test that has not ended ' +
    'gives a CONFLICT error. Needs testId from list_tests.',
  scope: 'clasync:read',
  input: z.object({ testId }),
  run: async (ctx, { testId }) => {
    const { test, rows, pending } = await getTestResults(ctx, testId)

    let toMark: ReturnType<typeof unconfirmed>[] = []
    let toMarkFrom: string | null = null
    if (test.hasShort && pending > 0) {
      const { input } = await getTestForEdit(ctx, testId)
      const shortIds = input.questions.filter((q) => q.kind === 'short').map((q) => q.id)
      try {
        const questions = await Promise.all(shortIds.map((qid) => getMarkingQuestion(ctx, testId, qid)))
        toMark = questions.map(unconfirmed).filter((q) => q.answers.length > 0)
      } catch (e) {
        if (!isConflict(e, 'not_final')) throw e
        toMarkFrom = typeof e.details?.finalAt === 'string' ? e.details.finalAt : null
      }
    }

    return {
      test: testBrief(test),
      pendingShortAnswers: pending,
      students: rows.map((r) => ({
        studentId: r.studentId,
        name: r.name,
        matricule: r.matricule,
        status: r.status,
        score: r.score,
        outOf: r.outOf,
        pendingShort: r.pendingShort,
      })),
      toMark,
      ...(toMarkFrom ? { toMarkFrom } : {}),
    }
  },
})

export const testReadTools = [listTests, getTest, getTestResultsTool]
