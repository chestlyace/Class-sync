import { render } from '@react-email/render'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import fr from '../../../messages/fr.json'
import { AssignmentPublishedEmail } from './templates/assignment-published'
import { AssignmentReminderEmail } from './templates/assignment-reminder'
import { GradesReleasedEmail } from './templates/grades-released'
import { emailSubject } from './templates/verify-email'

const base = {
  studentName: 'Ada',
  courseTitle: 'Algorithms 101',
  assignmentTitle: 'Sorting lab',
  url: 'https://clasync.test/a/1',
}
const due = { dueAt: new Date('2026-11-12T07:00:00Z'), timeZone: 'Africa/Douala' }

describe.each([
  ['AssignmentPublishedEmail', AssignmentPublishedEmail, 'assignmentPublished'],
  ['AssignmentReminderEmail', AssignmentReminderEmail, 'assignmentReminder'],
] as const)('%s', (_name, Template, key) => {
  it('renders French with course, assignment, 24-hour due time in the time zone, and link', async () => {
    const html = await render(<Template {...base} {...due} locale="fr" />)
    expect(html).toContain('Bonjour Ada')
    expect(html).toContain(fr.email[key].cta)
    expect(html).toContain('Algorithms 101')
    expect(html).toContain('Sorting lab')
    expect(html).toContain('08:00')
    expect(html).toMatch(/jeudi/i)
    expect(html).toContain('novembre')
    expect(html).toContain('https://clasync.test/a/1')
  })

  it('renders English', async () => {
    const html = await render(<Template {...base} {...due} locale="en" />)
    expect(html).toContain('Hello Ada')
    expect(html).toContain(en.email[key].cta)
    expect(html).not.toContain(fr.email[key].cta)
    expect(html).toContain('08:00')
    expect(html).toMatch(/Thursday/)
    expect(html).toContain('November')
    expect(html).toContain('https://clasync.test/a/1')
  })

  it('has a subject with the course and assignment titles', () => {
    for (const locale of ['en', 'fr'] as const) {
      const subject = emailSubject(key, locale, { courseTitle: 'Algorithms 101', assignmentTitle: 'Sorting lab' })
      expect(subject).toContain('Algorithms 101')
      expect(subject).toContain('Sorting lab')
    }
  })
})

const nasty = `<b>x</b> & "Ada's lab"`

describe.each([
  ['AssignmentPublishedEmail', AssignmentPublishedEmail],
  ['AssignmentReminderEmail', AssignmentReminderEmail],
] as const)('%s escaping', (_name, Template) => {
  it('escapes titles in the body and the preview text', async () => {
    const html = await render(<Template {...base} {...due} assignmentTitle={nasty} courseTitle={nasty} locale="en" />)
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;Ada&#x27;s lab&quot;')
    // the preview text is the hidden preheader div
    const preheader = html.slice(html.indexOf('data-skip-in-text'), html.indexOf('</div>', html.indexOf('data-skip-in-text')))
    expect(preheader).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(preheader).not.toContain('<b>')
  })
})

it('escapes titles in the grades email', async () => {
  const html = await render(<GradesReleasedEmail {...base} assignmentTitle={nasty} locale="fr" />)
  expect(html).not.toContain('<b>x</b>')
  expect(html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;Ada&#x27;s lab&quot;')
})

describe('subject lines', () => {
  it('stay on one line and bounded whatever the titles contain', () => {
    for (const kind of ['assignmentPublished', 'assignmentReminder', 'gradesReleased'] as const) {
      const subject = emailSubject(kind, 'en', {
        courseTitle: 'Algo\r\nBcc: evil@example.com',
        assignmentTitle: `Lab\n\n\t1 ${'x'.repeat(400)}`,
      })
      expect(subject).not.toMatch(/[\r\n]/)
      expect(subject).toContain('Algo Bcc: evil@example.com')
      expect(subject).toContain('Lab 1 ')
      expect(subject.length).toBeLessThan(150 * 2 + 100)
    }
  })
})

describe('GradesReleasedEmail', () => {
  it('renders both languages with the link', async () => {
    const frHtml = await render(<GradesReleasedEmail {...base} locale="fr" />)
    expect(frHtml).toContain('Bonjour Ada')
    expect(frHtml).toContain(fr.email.gradesReleased.cta)
    expect(frHtml).toContain('Sorting lab')
    expect(frHtml).toContain('https://clasync.test/a/1')
    const enHtml = await render(<GradesReleasedEmail {...base} locale="en" />)
    expect(enHtml).toContain(en.email.gradesReleased.cta)
    expect(enHtml).not.toContain(fr.email.gradesReleased.cta)
  })

  it('has a subject with the course and assignment titles', () => {
    const subject = emailSubject('gradesReleased', 'fr', { courseTitle: 'Algorithms 101', assignmentTitle: 'Sorting lab' })
    expect(subject).toContain('Algorithms 101')
    expect(subject).toContain('Sorting lab')
  })
})

describe('verify subject stays strict-typed and unchanged', () => {
  it('still works with two arguments', () => {
    expect(emailSubject('verify', 'en')).toBe(en.email.verify.subject)
  })
})
