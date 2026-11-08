import { z } from 'zod'
import { AppError } from '@/server/core/errors'
import { requireCourseOwner } from '@/server/courses/service'
import { getCourseNotes, getItemForEdit, listCourseTopics } from '@/server/notes/read'
import { getPracticeForLecturer } from '@/server/revision/authoring'
import { defineTool } from '../tool'
import { id, iso, richTextToPlain } from './read-shared'

const courseId = id('The course id, from list_courses.')

export const getCourseNotesTool = defineTool({
  name: 'get_course_notes',
  title: 'Get course notes',
  description:
    "A course's notes, topic by topic in the lecturer's order: each topic's id, title, whether it is hidden from students, " +
    'how many practice questions it has, and its items — notes with their text as plain text, links with their URL, and ' +
    'files with their name and type (file contents are not available). Needs courseId from list_courses; the topic ids ' +
    'are what get_practice takes.',
  scope: 'clasync:read',
  input: z.object({ courseId }),
  run: async (ctx, { courseId }) => {
    // Owner only: getCourseNotes also serves rostered students.
    const course = await requireCourseOwner(ctx, courseId)
    const { topics } = await getCourseNotes(ctx, courseId)
    return {
      course: { id: course.id, title: course.title },
      topics: await Promise.all(
        topics.map(async (t) => ({
          id: t.id,
          title: t.title,
          hidden: t.hidden,
          practiceQuestions: t.practice?.count ?? 0,
          items: await Promise.all(
            t.items.map(async (item) => {
              const base = {
                id: item.id,
                kind: item.kind,
                title: item.title,
                updatedAt: iso(item.updatedAt),
                ...(item.sharedInCount > 0 ? { alsoInOtherCourses: item.sharedInCount } : {}),
              }
              if (item.kind === 'file') {
                return { ...base, fileName: item.file?.name ?? null, fileType: item.file?.mimeType ?? null }
              }
              const full = await getItemForEdit(ctx, courseId, item.id)
              return item.kind === 'note' ? { ...base, text: richTextToPlain(full.body) } : { ...base, url: full.url }
            }),
          ),
        })),
      ),
    }
  },
})

export const getPractice = defineTool({
  name: 'get_practice',
  title: 'Get practice questions',
  description:
    "A course's revision (practice) questions by topic: each question's id, kind (mcq or short), prompt, the options with " +
    'the correct one flagged (mcq) or the marking guide (short), the explanation shown after answering, and where it came ' +
    'from (null when written here, else the title of the test it was imported from; `heldBack` while that test is not yet ' +
    'released everywhere, so students do not see it yet). Without topicId, only topics that have questions. ' +
    'Needs courseId from list_courses; topicId (optional) from get_course_notes.',
  scope: 'clasync:read',
  input: z.object({
    courseId,
    topicId: id('Only this topic, from get_course_notes.').optional(),
  }),
  run: async (ctx, { courseId, topicId }) => {
    const topics = await listCourseTopics(ctx, courseId)
    const wanted = topicId === undefined ? topics : topics.filter((t) => t.id === topicId)
    if (topicId !== undefined && wanted.length === 0) {
      throw new AppError('FORBIDDEN', 'Only the lecturer of this course can do this')
    }
    const views = await Promise.all(wanted.map((t) => getPracticeForLecturer(ctx, t.id)))
    return {
      topics: views
        .map((v) => ({
          id: v.topic.id,
          title: v.topic.title,
          hidden: v.topic.hidden,
          questions: v.groups.flatMap((g) =>
            g.questions.map((q) => ({
              id: q.id,
              kind: q.kind,
              prompt: q.prompt,
              ...(q.kind === 'mcq'
                ? { options: q.options.map((o) => ({ text: o.text, correct: o.isCorrect })) }
                : { guide: q.guide }),
              explanation: q.explanation,
              source: g.source?.title ?? null,
              ...(g.held ? { heldBack: true } : {}),
            })),
          ),
        }))
        .filter((t) => topicId !== undefined || t.questions.length > 0),
    }
  },
})

export const noteReadTools = [getCourseNotesTool, getPractice]
