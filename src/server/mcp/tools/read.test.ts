import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAssignment } from '@/server/assignments/lecturer'
import { submitAssignment } from '@/server/assignments/student'
import { createSession, setAttendanceOverride } from '@/server/attendance/sessions'
import { setNowForTests } from '@/server/core/clock'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import { assignment, file, submission, submissionFile, testAnswer } from '@/server/db/schema'
import { createFileItem, createLink, createNote } from '@/server/notes/items'
import { insertResourceFile, setupNotes } from '@/server/notes/test-support'
import { createTopic, setTopicHidden } from '@/server/notes/topics'
import { addPracticeQuestion } from '@/server/revision/authoring'
import { createTestDb } from '@/test/db'
import { at, insertStartedTest, joinTest, putAnswer, setClock } from '@/test/marking-fixture'
import type { McpTool } from '../tool'
import { mcpTools } from './index'
import { richTextToPlain } from './read-shared'

vi.mock('@/server/push/send', () => ({
  sendPush: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0, removed: 0 })),
  queuePush: vi.fn(async () => {}),
}))

const DAY = 24 * 60 * 60_000

const text = (t: string) => ({ type: 'text', text: t, styles: {} })
const block = (type: string, t: string, props: Record<string, unknown> = {}) => ({
  type,
  props,
  content: [text(t)],
  children: [],
})

function tool(name: string): McpTool {
  const found = mcpTools.find((t) => t.name === name)
  if (!found) throw new Error(`no tool ${name}`)
  return found
}

// Results are plain JSON; the tests read into them freely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

async function call(ctx: Ctx, name: string, args: Record<string, unknown> = {}): Promise<Json> {
  const t = tool(name)
  return t.run(ctx, t.input.parse(args))
}

/** Every object key anywhere in the value. */
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k)
      keysOf(v, out)
    }
  }
  return out
}

function expectNoSecrets(result: unknown) {
  const json = JSON.stringify(result)
  for (const k of keysOf(JSON.parse(json))) expect(k).not.toMatch(/storage|blob|password|token/i)
  expect(json).not.toMatch(/storageKey|storage_key|resources\//)
}

describe('MCP read tools', () => {
  let db: Db
  let fx: Awaited<ReturnType<typeof setupNotes>>
  let ids: {
    course: string
    topic: string
    emptyTopic: string
    assignment: string
    submission: string
    test: string
    q2: string
    q3: string
    aliceAttempt: string
    note: string
  }

  beforeAll(async () => {
    db = await createTestDb()
    fx = await setupNotes(db)
    const { lecturer, alice, bob } = fx
    const course = fx.courseA

    // Attendance: one session, Alice present and Bob absent by hand.
    const session = await createSession(lecturer, course, { requireOnCampus: false })
    await setAttendanceOverride(lecturer, session.id, alice.user.id, 'present')
    await setAttendanceOverride(lecturer, session.id, bob.user.id, 'absent')

    // An assignment, published directly (no emails), with Alice's hand-in: text, a file and a suggestion.
    const created = await createAssignment(lecturer, course, {
      title: 'Osmosis lab',
      instructions: [block('heading', 'Lab', { level: 2 }), block('bulletListItem', 'Measure the potato')],
      dueAt: new Date(Date.now() + 7 * DAY),
      maxMark: 20,
      weight: 1,
      submissionMode: 'both',
      latePolicy: 'accept',
      attachmentIds: [],
    })
    await db.update(assignment).set({ status: 'published', publishedAt: new Date() }).where(eq(assignment.id, created.id))
    await submitAssignment(alice, created.id, { text: [block('paragraph', 'The potato lost water.')], fileIds: [] })
    const [sub] = await db.select().from(submission).where(eq(submission.assignmentId, created.id))
    const fileId = crypto.randomUUID()
    await db.insert(file).values({
      id: fileId,
      ownerId: alice.user.id,
      purpose: 'submission',
      storageKey: `submissions/${alice.user.id}/${fileId}-report.pdf`,
      name: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      confirmedAt: new Date(),
    })
    await db.insert(submissionFile).values({ submissionId: sub.id, fileId, position: 0 })
    await db
      .update(submission)
      .set({ suggestedMark: 15, suggestedFeedback: 'Clear method.', suggestedAt: new Date() })
      .where(eq(submission.id, sub.id))

    // A test (T0, 30 min): Alice answers both short questions, Bob's q2 answer is already marked.
    const t = await insertStartedTest(db, lecturer, course)
    const aliceAttempt = await joinTest(db, t.test.id, alice)
    const bobAttempt = await joinTest(db, t.test.id, bob)
    await putAnswer(db, aliceAttempt.id, t.q1.id, { optionId: t.o1.id })
    await putAnswer(db, aliceAttempt.id, t.q2!.id, { text: 'Water crosses a membrane.' })
    await putAnswer(db, aliceAttempt.id, t.q3!.id, { text: 'It stores genes.' })
    await putAnswer(db, bobAttempt.id, t.q2!.id, { text: 'No idea', mark: 0 })
    await db
      .update(testAnswer)
      .set({ suggestedMark: 2, suggestedReason: 'Names genes.', suggestedAt: new Date() })
      .where(eq(testAnswer.questionId, t.q3!.id))

    // Notes: a note, a link and a file in topic A; practice questions there; topic B of the other course empty.
    const note = await createNote(lecturer, {
      courseId: course,
      topicId: fx.topicA,
      title: 'Cell membrane',
      body: [block('heading', 'Membranes', { level: 1 }), block('paragraph', 'A lipid bilayer.'), block('numberedListItem', 'Lipids'), block('numberedListItem', 'Proteins')],
    })
    await createLink(lecturer, { courseId: course, topicId: fx.topicA, title: 'Cells video', url: 'https://example.org/cells' })
    const resFile = await insertResourceFile(db, lecturer, 'slides.pdf')
    await createFileItem(lecturer, { courseId: course, topicId: fx.topicA, title: 'Slides', fileId: resFile })
    await addPracticeQuestion(lecturer, fx.topicA, {
      kind: 'mcq',
      prompt: 'Where is ATP made?',
      options: [
        { text: 'Mitochondrion', isCorrect: true },
        { text: 'Nucleus', isCorrect: false },
      ],
      explanation: 'The powerhouse.',
    })
    await addPracticeQuestion(lecturer, fx.topicA, { kind: 'short', prompt: 'Define osmosis.', guide: 'Water, membrane.' })
    await setTopicHidden(lecturer, fx.topicA, true)
    const emptyTopic = await createTopic(lecturer, course, { title: 'Later' })

    ids = {
      course,
      topic: fx.topicA,
      emptyTopic: emptyTopic.id,
      assignment: created.id,
      submission: sub.id,
      test: t.test.id,
      q2: t.q2!.id,
      q3: t.q3!.id,
      aliceAttempt: aliceAttempt.id,
      note: note.id,
    }
  })

  afterEach(() => setNowForTests(null))

  /** Each tool with arguments that reach the lecturer's own data. */
  const cases = (): [string, Record<string, unknown>][] => [
    ['get_course', { courseId: ids.course }],
    ['get_attendance', { courseId: ids.course }],
    ['get_course_ca', { courseId: ids.course }],
    ['list_assignments', { courseId: ids.course }],
    ['list_submissions', { assignmentId: ids.assignment }],
    ['get_submission', { submissionId: ids.submission }],
    ['list_tests', { courseId: ids.course }],
    ['get_test', { testId: ids.test }],
    ['get_test_results', { testId: ids.test }],
    ['get_course_notes', { courseId: ids.course }],
    ['get_practice', { courseId: ids.course }],
    ['get_practice', { courseId: ids.course, topicId: ids.topic }],
  ]

  it('registers every read tool with the read scope, after whoami', () => {
    const names = mcpTools.map((t) => t.name)
    expect(names.slice(0, 13)).toEqual([
      'whoami',
      'list_courses',
      'get_course',
      'get_attendance',
      'get_course_ca',
      'list_assignments',
      'list_submissions',
      'get_submission',
      'list_tests',
      'get_test',
      'get_test_results',
      'get_course_notes',
      'get_practice',
    ])
    for (const name of names.slice(0, 13)) {
      const t = tool(name)
      expect(t.scope).toBe('clasync:read')
      expect(t.description.length).toBeGreaterThan(40)
    }
  })

  it('refuses another lecturer (FORBIDDEN) on every course-bound tool', async () => {
    setClock(at(40))
    for (const [name, args] of cases()) {
      await expect(call(fx.colleague, name, args), name).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
  })

  it('refuses a student (FORBIDDEN) even on their own course', async () => {
    setClock(at(40))
    await expect(call(fx.alice, 'list_courses')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    for (const [name, args] of cases()) {
      await expect(call(fx.alice, name, args), name).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
  })

  it('leaks no storage keys, blob URLs, passwords or tokens', async () => {
    setClock(at(40))
    expectNoSecrets(await call(fx.lecturer, 'list_courses'))
    for (const [name, args] of cases()) expectNoSecrets(await call(fx.lecturer, name, args))
  })

  it('list_courses and get_course: courses with counts, roster without emails, CA settings', async () => {
    const { courses } = await call(fx.lecturer, 'list_courses')
    expect(courses).toHaveLength(2)
    const bio = courses.find((c: { id: string }) => c.id === ids.course)
    expect(bio).toMatchObject({ title: 'Cell biology', semester: 1, class: { name: 'Biology L1' }, school: { name: 'University of Buea' }, students: 4 })
    expect((await call(fx.colleague, 'list_courses')).courses).toEqual([])

    const course = await call(fx.lecturer, 'get_course', { courseId: ids.course })
    expect(course.roster.map((r: { name: string }) => r.name)).toEqual(['Alice', 'Bob', 'Carol', 'Dave'])
    expect(course.roster[0]).toEqual({ studentId: fx.alice.user.id, name: 'Alice', matricule: 'UB1', source: 'class' })
    expect(course.caSettings).toMatchObject({ total: 30, attendancePoints: 5, assignmentPoints: 20 })
    expect(JSON.stringify(course)).not.toContain('@example.com')
  })

  it('get_attendance: statuses per session in order, totals and rate', async () => {
    const res = await call(fx.lecturer, 'get_attendance', { courseId: ids.course })
    expect(res.sessions).toHaveLength(1)
    expect(res.sessions[0].date).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const alice = res.students.find((s: { name: string }) => s.name === 'Alice')
    const bob = res.students.find((s: { name: string }) => s.name === 'Bob')
    const carol = res.students.find((s: { name: string }) => s.name === 'Carol')
    expect(alice).toMatchObject({ statuses: ['present'], present: 1, absent: 0, rate: 1, overridden: [res.sessions[0].id] })
    expect(bob).toMatchObject({ statuses: ['absent'], absent: 1, rate: 0 })
    expect(carol).toMatchObject({ statuses: [null], rate: null })
    expect(carol.overridden).toBeUndefined()
  })

  it('get_course_ca: ranked rows with parts, attendance rate and slipping flag', async () => {
    const res = await call(fx.lecturer, 'get_course_ca', { courseId: ids.course })
    expect(res.settings.total).toBe(30)
    expect(res.students).toHaveLength(4)
    const alice = res.students.find((s: { name: string }) => s.name === 'Alice')
    expect(alice).toMatchObject({ matricule: 'UB1', rank: 1, total: 30, attendanceRate: 1, slipping: false })
    // The default settings give tests 0 points, so that part is left out.
    expect(Object.keys(alice.parts).sort()).toEqual(['assignments', 'attendance', 'participation'])
    expect(alice.parts.attendance).toMatchObject({ points: 5, status: 'scored', score: 5 })
    expect(typeof alice.missingWork).toBe('number')
  })

  it('list_assignments, list_submissions, get_submission: plain-text instructions and hand-ins, file names only', async () => {
    const { assignments } = await call(fx.lecturer, 'list_assignments', { courseId: ids.course })
    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({
      id: ids.assignment,
      title: 'Osmosis lab',
      status: 'published',
      maxMark: 20,
      gradesReleased: false,
      instructions: '## Lab\n- Measure the potato',
      attachments: [],
      counts: { roster: 4, submitted: 1, late: 0, missing: 3, graded: 0 },
    })
    expect(assignments[0].dueAt).toMatch(/Z$/)

    const subs = await call(fx.lecturer, 'list_submissions', { assignmentId: ids.assignment })
    expect(subs.assignment).toMatchObject({ id: ids.assignment, title: 'Osmosis lab' })
    expect(subs.students[0]).toMatchObject({ name: 'Alice', state: 'submitted', submissionId: ids.submission, hasText: true, fileCount: 1, mark: null })
    expect(subs.students[1]).toMatchObject({ name: 'Bob', state: 'missing', submissionId: null, hasText: false, fileCount: 0 })

    const one = await call(fx.lecturer, 'get_submission', { submissionId: ids.submission })
    expect(one).toMatchObject({
      id: ids.submission,
      student: { id: fx.alice.user.id, name: 'Alice', matricule: 'UB1' },
      late: false,
      text: 'The potato lost water.',
      files: [{ name: 'report.pdf', type: 'application/pdf', sizeBytes: 2048 }],
      mark: null,
      suggestion: { mark: 15, feedback: 'Clear method.' },
    })
    expect(one.assignment.instructions).toBe('## Lab\n- Measure the potato')
    expect(one.files[0].id).toBeUndefined()
  })

  it('list_tests and get_test: state, questions with correct option and guide', async () => {
    setClock(at(10))
    const { tests } = await call(fx.lecturer, 'list_tests', { courseId: ids.course })
    expect(tests).toHaveLength(1)
    expect(tests[0]).toMatchObject({ id: ids.test, title: 'CA 1', state: 'running', resultsReleased: false, questionCount: 3, totalMarks: 8, hasShortAnswers: true, joined: 2 })

    const test = await call(fx.lecturer, 'get_test', { testId: ids.test })
    expect(test.settings).toMatchObject({ durationMinutes: 30, defaultMark: 2 })
    expect(test.questions[0]).toMatchObject({ number: 1, kind: 'mcq', mark: 2, options: [{ text: 'Mitochondrion', correct: true }, { text: 'Ribosome', correct: false }] })
    expect(test.questions[1]).toMatchObject({ id: ids.q2, kind: 'short', mark: 4, guide: expect.stringContaining('membrane') })
    expect(test.questions[2]).toMatchObject({ id: ids.q3, mark: 2 })
  })

  it('get_test_results: scores, and the short answers still to mark with guide and suggestion', async () => {
    setClock(at(10))
    await expect(call(fx.lecturer, 'get_test_results', { testId: ids.test })).rejects.toMatchObject({ code: 'CONFLICT' })

    setClock(at(40))
    const res = await call(fx.lecturer, 'get_test_results', { testId: ids.test })
    expect(res.test).toMatchObject({ id: ids.test, state: 'ended' })
    expect(res.pendingShortAnswers).toBe(2)
    expect(res.students.find((s: { name: string }) => s.name === 'Alice')).toMatchObject({ score: 2, outOf: 8, pendingShort: 2 })
    expect(res.students.find((s: { name: string }) => s.name === 'Dave')).toMatchObject({ status: 'not_joined', score: 0 })
    expect(res.toMark).toEqual([
      {
        questionId: ids.q2,
        number: 2,
        prompt: 'What is osmosis?',
        guide: 'Water moves across a membrane: 2 for water, 2 for membrane.',
        maxMark: 4,
        // Bob's answer has a confirmed mark: left out.
        answers: [
          { attemptId: ids.aliceAttempt, studentId: fx.alice.user.id, name: 'Alice', matricule: 'UB1', answer: 'Water crosses a membrane.', suggestion: null },
        ],
      },
      {
        questionId: ids.q3,
        number: 3,
        prompt: 'Name a function of DNA.',
        guide: 'Stores genetic information.',
        maxMark: 2,
        answers: [
          {
            attemptId: ids.aliceAttempt,
            studentId: fx.alice.user.id,
            name: 'Alice',
            matricule: 'UB1',
            answer: 'It stores genes.',
            suggestion: { mark: 2, reason: 'Names genes.' },
          },
        ],
      },
    ])
    expect(res.toMarkFrom).toBeUndefined()
  })

  it('get_test_results: inside the 2-minute grace, nothing to mark yet and when it opens', async () => {
    setClock(at(31))
    const res = await call(fx.lecturer, 'get_test_results', { testId: ids.test })
    expect(res.toMark).toEqual([])
    expect(res.toMarkFrom).toBe(at(32).toISOString())
  })

  it('get_course_notes: topics with notes as plain text, link URLs and file names', async () => {
    const res = await call(fx.lecturer, 'get_course_notes', { courseId: ids.course })
    expect(res.course).toEqual({ id: ids.course, title: 'Cell biology' })
    const [cells, later] = res.topics
    expect(cells).toMatchObject({ id: ids.topic, title: 'Cells', hidden: true, practiceQuestions: 2 })
    expect(later).toMatchObject({ id: ids.emptyTopic, title: 'Later', hidden: false, items: [] })
    expect(cells.items).toEqual([
      expect.objectContaining({ id: ids.note, kind: 'note', title: 'Cell membrane', text: '# Membranes\nA lipid bilayer.\n1. Lipids\n2. Proteins' }),
      expect.objectContaining({ kind: 'link', title: 'Cells video', url: 'https://example.org/cells' }),
      expect.objectContaining({ kind: 'file', title: 'Slides', fileName: 'slides.pdf', fileType: 'application/pdf' }),
    ])
    expect(cells.items[0].body).toBeUndefined()
  })

  it('get_practice: questions by topic, only topics with questions unless one is asked for', async () => {
    const all = await call(fx.lecturer, 'get_practice', { courseId: ids.course })
    expect(all.topics).toHaveLength(1)
    expect(all.topics[0]).toMatchObject({ id: ids.topic, title: 'Cells', hidden: true })
    expect(all.topics[0].questions).toEqual([
      {
        id: expect.any(String),
        kind: 'mcq',
        prompt: 'Where is ATP made?',
        options: [
          { text: 'Mitochondrion', correct: true },
          { text: 'Nucleus', correct: false },
        ],
        explanation: 'The powerhouse.',
        source: null,
      },
      { id: expect.any(String), kind: 'short', prompt: 'Define osmosis.', guide: 'Water, membrane.', explanation: null, source: null },
    ])

    const empty = await call(fx.lecturer, 'get_practice', { courseId: ids.course, topicId: ids.emptyTopic })
    expect(empty.topics).toEqual([{ id: ids.emptyTopic, title: 'Later', hidden: false, questions: [] }])

    // A topic of another course of mine is not this course's.
    await expect(call(fx.lecturer, 'get_practice', { courseId: ids.course, topicId: fx.topicB })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('rejects missing ids at the input schema', () => {
    expect(() => tool('get_course').input.parse({})).toThrow()
    expect(() => tool('get_course').input.parse({ courseId: '' })).toThrow()
  })
})

describe('richTextToPlain', () => {
  it('flattens blocks, lists, check items, children, links, tables and media', () => {
    const doc = [
      block('heading', 'Title', { level: 3 }),
      { type: 'paragraph', content: [text('See '), { type: 'link', href: 'https://x.org', content: [text('this')] }, text('.')] },
      { ...block('bulletListItem', 'Parent'), children: [block('bulletListItem', 'Child')] },
      block('checkListItem', 'Done', { checked: true }),
      block('checkListItem', 'Todo', { checked: false }),
      block('quote', 'Said'),
      { type: 'image', props: { url: 'https://blob.example/abc', name: 'cell.png' } },
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [{ cells: [[text('a')], [text('b')]] }, { cells: [{ type: 'tableCell', content: [text('c')] }, [text('d')]] }],
        },
      },
      block('paragraph', ''),
      block('codeBlock', 'x = 1\ny = 2'),
    ]
    expect(richTextToPlain(doc)).toBe(
      ['### Title', 'See this.', '- Parent', '  - Child', '[x] Done', '[ ] Todo', '> Said', '[image: cell.png]', 'a | b', 'c | d', '', 'x = 1', 'y = 2'].join(
        '\n',
      ),
    )
    expect(richTextToPlain(doc)).not.toContain('blob')
  })

  it('returns an empty string for anything that is not a block list', () => {
    expect(richTextToPlain(null)).toBe('')
    expect(richTextToPlain({ type: 'paragraph' })).toBe('')
  })
})
