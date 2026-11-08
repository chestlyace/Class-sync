import { z } from 'zod'
import {
  getSubmissionForLecturer,
  listCourseAssignments,
  listSubmissions,
  type AssignmentDetail,
} from '@/server/assignments/lecturer'
import { defineTool } from '../tool'
import { id, iso, richTextToPlain } from './read-shared'

/** The assignment fields an assistant needs to place a submission or a list in context. */
function assignmentBrief(a: AssignmentDetail) {
  return {
    id: a.id,
    title: a.title,
    status: a.status,
    dueAt: iso(a.dueAt),
    maxMark: a.maxMark,
    gradesReleased: a.gradesReleasedAt !== null,
  }
}

export const listAssignments = defineTool({
  name: 'list_assignments',
  title: 'List assignments',
  description:
    "A course's assignments (drafts included), by due date: id, title, status (draft or published), due date, max mark, " +
    'weight in the CA, submission mode (files, text or both), late policy, whether grades are released, the instructions ' +
    'as plain text, attachment file names, and counts over the current roster (on time, late, missing, graded). ' +
    'Needs courseId from list_courses.',
  scope: 'clasync:read',
  input: z.object({ courseId: id('The course id, from list_courses.') }),
  run: async (ctx, { courseId }) => {
    const items = await listCourseAssignments(ctx, courseId)
    return {
      assignments: items.map((a) => ({
        ...assignmentBrief(a),
        publishedAt: iso(a.publishedAt),
        weight: a.weight,
        submissionMode: a.submissionMode,
        latePolicy: a.latePolicy,
        instructions: richTextToPlain(a.instructions),
        attachments: a.attachments.map((f) => f.name),
        counts: {
          roster: a.rosterSize,
          submitted: a.submittedCount,
          late: a.lateCount,
          missing: a.rosterSize - a.submittedCount - a.lateCount,
          graded: a.gradedCount,
        },
      })),
    }
  },
})

export const listSubmissionsTool = defineTool({
  name: 'list_submissions',
  title: 'List submissions',
  description:
    'Every student on the roster for one assignment: their state (submitted, late or missing), submissionId (null when ' +
    'missing; pass it to get_submission), when they handed in, their mark if graded, and whether the hand-in has typed text ' +
    'and how many files. Needs assignmentId from list_assignments.',
  scope: 'clasync:read',
  input: z.object({ assignmentId: id('The assignment id, from list_assignments.') }),
  run: async (ctx, { assignmentId }) => {
    const { assignment, rows } = await listSubmissions(ctx, assignmentId)
    return {
      assignment: assignmentBrief(assignment),
      students: rows.map((r) => ({
        studentId: r.studentId,
        name: r.name,
        matricule: r.matricule,
        state: r.state,
        submissionId: r.submissionId,
        submittedAt: iso(r.submittedAt),
        mark: r.mark,
        hasText: r.hasText,
        fileCount: r.fileCount,
      })),
    }
  },
})

export const getSubmission = defineTool({
  name: 'get_submission',
  title: 'Get a submission',
  description:
    "One student's hand-in: the typed text as plain text (null when none), the names and types of the files (file contents " +
    'are not available), when it was handed in and whether late, the mark and feedback if graded, and the grade your ' +
    'assistant suggested if any. Also the assignment with its instructions as plain text. Needs submissionId from list_submissions.',
  scope: 'clasync:read',
  input: z.object({ submissionId: id('The submission id, from list_submissions.') }),
  run: async (ctx, { submissionId }) => {
    const view = await getSubmissionForLecturer(ctx, submissionId)
    return {
      id: submissionId,
      assignment: { ...assignmentBrief(view.assignment), instructions: richTextToPlain(view.assignment.instructions) },
      student: view.student,
      submittedAt: iso(view.submittedAt),
      late: view.isLate,
      text: view.text ? richTextToPlain(view.text) : null,
      files: view.files.map((f) => ({ name: f.name, type: f.mimeType, sizeBytes: f.sizeBytes })),
      mark: view.mark,
      feedback: view.feedback,
      suggestion: view.suggestion
        ? { mark: view.suggestion.mark, feedback: view.suggestion.feedback, at: iso(view.suggestion.at) }
        : null,
    }
  },
})

export const assignmentReadTools = [listAssignments, listSubmissionsTool, getSubmission]
