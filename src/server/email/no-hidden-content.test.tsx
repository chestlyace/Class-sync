import type { ReactElement } from 'react'
import { render } from '@react-email/render'
import { describe, expect, it } from 'vitest'
import type { Locale } from '@/server/core/context'
import { AssignmentPublishedEmail } from './templates/assignment-published'
import { AssignmentReminderEmail } from './templates/assignment-reminder'
import { AssignmentSubmittedEmail } from './templates/assignment-submitted'
import { ClassJoinedEmail } from './templates/class-joined'
import { GradesReleasedEmail } from './templates/grades-released'
import { ColleagueJoinedClassEmail, LecturerJoinedClassEmail } from './templates/lecturer-joined-class'
import { ResetPasswordEmail } from './templates/reset-password'
import { TestHandedInEmail } from './templates/test-handed-in'
import { TestResultsReleasedEmail } from './templates/test-results-released'
import { VerifyEmail } from './templates/verify-email'

/**
 * iCloud rejects our mail as `554 5.7.1 [HM08]` (content rejected). Hidden text and runs of
 * invisible characters are classic spam signals, so no email may carry any: no hidden preheader,
 * no zero-width padding, no Outlook-only hidden spacers.
 */
const INVISIBLE = /[­͏᠎ -‏⁠-⁤﻿]/
const INVISIBLE_ENTITY = /&#(8202|8203|8204|8205|8206|8207|8288|65279|173|847);/i

const url = 'https://clasync.test/x'
const at = new Date('2026-11-12T07:00:00Z')
const tz = 'Africa/Douala'
const course = { courseTitle: 'Algorithms 101' }
const names = { className: 'CS L3', schoolName: 'University of Buea' }

const emails: Array<[string, (locale: Locale) => ReactElement]> = [
  ['verify', (l) => <VerifyEmail url={url} locale={l} />],
  ['resetPassword', (l) => <ResetPasswordEmail url={url} locale={l} />],
  ['assignmentPublished', (l) => <AssignmentPublishedEmail studentName="Ada" {...course} assignmentTitle="Lab" dueAt={at} timeZone={tz} url={url} locale={l} />],
  ['assignmentReminder', (l) => <AssignmentReminderEmail studentName="Ada" {...course} assignmentTitle="Lab" dueAt={at} timeZone={tz} url={url} locale={l} />],
  ['assignmentSubmitted', (l) => <AssignmentSubmittedEmail studentName="Ada" {...course} assignmentTitle="Lab" submittedAt={at} isLate timeZone={tz} url={url} locale={l} />],
  ['gradesReleased', (l) => <GradesReleasedEmail studentName="Ada" {...course} assignmentTitle="Lab" url={url} locale={l} />],
  ['testResultsReleased', (l) => <TestResultsReleasedEmail studentName="Ada" {...course} testTitle="Quiz" url={url} locale={l} />],
  ['testHandedIn', (l) => <TestHandedInEmail studentName="Ada" {...course} testTitle="Quiz" handedInAt={at} timeZone={tz} url={url} locale={l} />],
  ['classJoined', (l) => <ClassJoinedEmail studentName="Ada" {...names} url={url} locale={l} />],
  ['lecturerJoinedClass', (l) => <LecturerJoinedClassEmail lecturerName="Dr Ada" {...names} url={url} locale={l} />],
  ['colleagueJoinedClass', (l) => <ColleagueJoinedClassEmail recipientName="Dr Bea" colleagueName="Dr Ada" {...names} url={url} locale={l} />],
]

describe.each(emails)('%s email', (_kind, make) => {
  it.each(['en', 'fr'] as const)('carries no hidden text or invisible characters (%s)', async (locale) => {
    const html = await render(make(locale))
    const text = await render(make(locale), { plainText: true })
    expect(html).not.toMatch(INVISIBLE)
    expect(html).not.toMatch(INVISIBLE_ENTITY)
    expect(html).not.toMatch(/display:\s*none/i)
    expect(html).not.toMatch(/\shidden[\s>]/i)
    expect(html).not.toContain('data-skip-in-text')
    expect(text).not.toMatch(INVISIBLE)
    expect(html).toContain(url)
    expect(text).toContain(url)
  })
})
