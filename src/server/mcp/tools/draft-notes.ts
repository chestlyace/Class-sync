import { z } from 'zod'
import { sanitizeRichText } from '@/server/assignments/rich-text'
import type { Ctx } from '@/server/core/context'
import { AppError } from '@/server/core/errors'
import type { Db } from '@/server/db'
import { createNote } from '@/server/notes/items'
import { TITLE_MAX } from '@/server/notes/rules'
import { createTopic } from '@/server/notes/topics'
import { addPracticeQuestions, PRACTICE_BATCH_MAX } from '@/server/revision/authoring'
import { EXPLANATION_MAX } from '@/server/revision/rules'
import { GUIDE_MAX, MCQ_OPTIONS_MAX, MCQ_OPTIONS_MIN, OPTION_MAX, PROMPT_MAX } from '@/server/tests/rules'
import { markdownToBlocks } from '../markdown'
import { defineTool } from '../tool'

const BODY_MAX = 100_000
export const VISIBLE_TOPIC_MESSAGE =
  "Assistants can only add to hidden topics; show the topic in Clasync when it's ready."

/** The services' visible-topic CONFLICT, in words for the assistant. */
async function hiddenOnly<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (err) {
    if (err instanceof AppError && err.code === 'CONFLICT' && err.details?.reason === 'visible_topic') {
      throw new AppError('CONFLICT', VISIBLE_TOPIC_MESSAGE, err.details)
    }
    throw err
  }
}

const createNoteDraft = defineTool({
  name: 'create_note_draft',
  title: 'Create a note draft',
  description:
    "Writes a note into a HIDDEN topic of one of the lecturer's courses, so students cannot see it. Give either topicId (a hidden topic, from get_course_notes) or newTopicTitle (a new topic is created hidden). A visible topic is refused (CONFLICT). The lecturer reviews the note and shows the topic to students in Clasync. The body takes plain text or simple markdown.",
  scope: 'clasync:write',
  input: z
    .object({
      courseId: z.string().min(1).describe('The course, from list_courses.'),
      topicId: z.string().min(1).optional().describe('A hidden topic of this course, from get_course_notes.'),
      newTopicTitle: z
        .string()
        .trim()
        .min(1)
        .max(TITLE_MAX)
        .optional()
        .describe('Instead of topicId: the title of a new hidden topic to create.'),
      title: z.string().trim().min(1).max(TITLE_MAX).describe('The note title.'),
      body: z
        .string()
        .min(1)
        .max(BODY_MAX)
        .describe('The note, as plain text or simple markdown (headings, lists, bold, italic, code, links).'),
    })
    .refine((v) => (v.topicId === undefined) !== (v.newTopicTitle === undefined), {
      message: 'Give either topicId or newTopicTitle, not both',
      path: ['topicId'],
    }),
  run: async (ctx, input) => {
    const body = markdownToBlocks(input.body)
    if (!sanitizeRichText(body)) {
      throw new AppError('VALIDATION', 'The note body is too large', { fields: ['body'] })
    }
    if (input.topicId !== undefined) {
      const topicId = input.topicId
      const note = await hiddenOnly(() =>
        createNote(ctx, { courseId: input.courseId, topicId, title: input.title, body, hiddenTopicOnly: true }),
      )
      return view(note.id, topicId, false)
    }
    // The topic is born hidden and gets its note in the same transaction: all or nothing.
    const newTopicTitle = input.newTopicTitle!
    return ctx.db.transaction(async (tx) => {
      const txCtx: Ctx = { ...ctx, db: tx as unknown as Db }
      const topic = await createTopic(txCtx, input.courseId, { title: newTopicTitle, hidden: true })
      const note = await createNote(txCtx, {
        courseId: input.courseId,
        topicId: topic.id,
        title: input.title,
        body,
        hiddenTopicOnly: true,
      })
      return view(note.id, topic.id, true)
    })
  },
})

function view(noteId: string, topicId: string, topicCreated: boolean) {
  return {
    noteId,
    topicId,
    topicCreated,
    topicHidden: true,
    note: 'In a hidden topic: students cannot see it. The lecturer reviews it and shows the topic in Clasync.',
  }
}

const practiceQuestion = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('mcq'),
    prompt: z.string().trim().min(1).max(PROMPT_MAX),
    options: z
      .array(z.object({ text: z.string().trim().min(1).max(OPTION_MAX), correct: z.boolean() }))
      .min(MCQ_OPTIONS_MIN)
      .max(MCQ_OPTIONS_MAX)
      .refine((options) => options.filter((o) => o.correct).length === 1, 'Exactly one option must be correct')
      .describe(`${MCQ_OPTIONS_MIN} to ${MCQ_OPTIONS_MAX} options, exactly one with correct: true.`),
    explanation: z.string().trim().max(EXPLANATION_MAX).optional().describe('Shown to students after they answer.'),
  }),
  z.object({
    kind: z.literal('short'),
    prompt: z.string().trim().min(1).max(PROMPT_MAX),
    guide: z.string().trim().min(1).max(GUIDE_MAX).describe('A model answer students compare theirs with.'),
    explanation: z.string().trim().max(EXPLANATION_MAX).optional().describe('Shown to students after they answer.'),
  }),
])

const addPracticeQuestionsTool = defineTool({
  name: 'add_practice_questions',
  title: 'Add practice questions',
  description: `Adds 1 to ${PRACTICE_BATCH_MAX} revision (practice) questions to a HIDDEN topic (topicId from get_course_notes or get_practice), all or none. Students cannot see them while the topic is hidden; a visible topic is refused (CONFLICT). The lecturer reviews them and shows the topic in Clasync. Questions are multiple choice (exactly one correct option) or short answer (with a model answer).`,
  scope: 'clasync:write',
  input: z.object({
    topicId: z.string().min(1).describe('A hidden topic, from get_course_notes or get_practice.'),
    questions: z.array(practiceQuestion).min(1).max(PRACTICE_BATCH_MAX),
  }),
  run: async (ctx, input) => {
    const inputs = input.questions.map((q) =>
      q.kind === 'mcq'
        ? {
            kind: 'mcq' as const,
            prompt: q.prompt,
            options: q.options.map((o) => ({ text: o.text, isCorrect: o.correct })),
            explanation: q.explanation ?? null,
          }
        : { kind: 'short' as const, prompt: q.prompt, guide: q.guide, explanation: q.explanation ?? null },
    )
    const { ids } = await hiddenOnly(() => addPracticeQuestions(ctx, input.topicId, inputs, { hiddenTopicOnly: true }))
    return {
      topicId: input.topicId,
      added: ids.length,
      questionIds: ids,
      note: 'In a hidden topic: students cannot see them. The lecturer reviews them and shows the topic in Clasync.',
    }
  },
})

export const notesDraftTools = [createNoteDraft, addPracticeQuestionsTool]
