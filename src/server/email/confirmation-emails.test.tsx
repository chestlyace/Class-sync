import { render } from '@react-email/render'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import fr from '../../../messages/fr.json'
import { AssignmentSubmittedEmail } from './templates/assignment-submitted'
import { ClassJoinedEmail } from './templates/class-joined'
import { ColleagueJoinedClassEmail, LecturerJoinedClassEmail } from './templates/lecturer-joined-class'
import { TestHandedInEmail } from './templates/test-handed-in'
import { emailSubject } from './templates/verify-email'

const names = { className: 'CS L3', schoolName: 'University of Buea' }

describe('ClassJoinedEmail', () => {
  const props = { studentName: 'Ada', ...names, url: 'https://clasync.test/dashboard' }

  it('renders in fr with the class, the school and the dashboard link', async () => {
    const html = await render(<ClassJoinedEmail {...props} locale="fr" />)
    expect(html).toContain('Bonjour Ada')
    expect(html).toContain('CS L3')
    expect(html).toContain('University of Buea')
    expect(html).toContain(fr.email.classJoined.cta)
    expect(html).toContain('https://clasync.test/dashboard')
    expect(html).not.toContain(en.email.classJoined.cta)
    expect(emailSubject('classJoined', 'fr', names)).toBe('Vous avez rejoint CS L3 (University of Buea)')
  })

  it('renders in en', async () => {
    const html = await render(<ClassJoinedEmail {...props} locale="en" />)
    expect(html).toContain('Hello Ada')
    expect(html).toContain(en.email.classJoined.cta)
    expect(emailSubject('classJoined', 'en', names)).toBe("You've joined CS L3 at University of Buea")
  })
})

describe('LecturerJoinedClassEmail and ColleagueJoinedClassEmail', () => {
  const url = 'https://clasync.test/classes/c1'

  it('confirms to the joiner in their language', async () => {
    const html = await render(<LecturerJoinedClassEmail lecturerName="Dr Ada" {...names} url={url} locale="fr" />)
    expect(html).toContain('Bonjour Dr Ada')
    expect(html).toContain(fr.email.lecturerJoinedClass.cta)
    expect(html).toContain(url)
    expect(emailSubject('lecturerJoinedClass', 'en', names)).toBe("You're now a lecturer of CS L3 at University of Buea")
  })

  it('tells a colleague who joined, greeting the recipient by name', async () => {
    const html = await render(
      <ColleagueJoinedClassEmail recipientName="Dr Owner" colleagueName="Dr Ada" {...names} url={url} locale="en" />,
    )
    expect(html).toContain('Hello Dr Owner')
    expect(html).toContain('Dr Ada joined CS L3 at University of Buea')
    expect(html).toContain(url)
    expect(emailSubject('colleagueJoinedClass', 'en', { colleagueName: 'Dr Ada', className: 'CS L3' })).toBe('Dr Ada joined CS L3')
    expect(emailSubject('colleagueJoinedClass', 'fr', { colleagueName: 'Dr Ada', className: 'CS L3' })).toBe('Dr Ada a rejoint CS L3')
  })
})

describe('AssignmentSubmittedEmail', () => {
  const props = {
    studentName: 'Ada',
    courseTitle: 'Algorithms 101',
    assignmentTitle: 'Sorting lab',
    submittedAt: new Date('2026-11-12T07:05:00Z'),
    url: 'https://clasync.test/assignments/a1',
    timeZone: 'Africa/Douala',
  }

  it('renders the receipt in fr with the time in the time zone, and no late line when on time', async () => {
    const html = await render(<AssignmentSubmittedEmail {...props} isLate={false} locale="fr" />)
    expect(html).toContain('Bonjour Ada')
    expect(html).toContain('Algorithms 101')
    expect(html).toContain('Sorting lab')
    expect(html).toContain('08:05')
    expect(html).toMatch(/jeudi/i)
    expect(html).toContain(fr.email.assignmentSubmitted.cta)
    expect(html).toContain('https://clasync.test/assignments/a1')
    expect(html).not.toContain('retard')
    const subject = emailSubject('assignmentSubmitted', 'fr', { courseTitle: 'Algorithms 101', assignmentTitle: 'Sorting lab' })
    expect(subject).toBe('Rendu reçu : Sorting lab (Algorithms 101)')
  })

  it('says when the submission is late', async () => {
    const html = await render(<AssignmentSubmittedEmail {...props} isLate locale="en" />)
    expect(html).toContain('Hello Ada')
    expect(html).toContain('marked late')
    expect(html).toMatch(/Thursday/)
  })

  it('escapes titles and keeps the subject on one line', async () => {
    const html = await render(<AssignmentSubmittedEmail {...props} assignmentTitle="<b>x</b>" isLate={false} locale="en" />)
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    const subject = emailSubject('assignmentSubmitted', 'en', { courseTitle: 'Bio\r\nBcc: evil@example.com', assignmentTitle: 'Lab\n1' })
    expect(subject).not.toMatch(/[\r\n]/)
    expect(subject).toContain('Lab 1')
  })
})

describe('TestHandedInEmail', () => {
  const props = {
    studentName: 'Ada',
    courseTitle: 'Cell biology',
    testTitle: 'CA 1',
    handedInAt: new Date('2026-11-09T08:20:00Z'),
    url: 'https://clasync.test/t/8F3KQ2',
    timeZone: 'Africa/Douala',
  }

  it('renders the receipt in fr with the test, the course, the time and the test link', async () => {
    const html = await render(<TestHandedInEmail {...props} locale="fr" />)
    expect(html).toContain('Bonjour Ada')
    expect(html).toContain('CA 1')
    expect(html).toContain('Cell biology')
    expect(html).toContain('09:20')
    expect(html).toContain(fr.email.testHandedIn.cta)
    expect(html).toContain('https://clasync.test/t/8F3KQ2')
    expect(emailSubject('testHandedIn', 'fr', { courseTitle: 'Cell biology', testTitle: 'CA 1' })).toBe('Test remis : CA 1 (Cell biology)')
  })

  it('renders in en', async () => {
    const html = await render(<TestHandedInEmail {...props} locale="en" />)
    expect(html).toContain('Hello Ada')
    expect(html).toContain(en.email.testHandedIn.cta)
    expect(emailSubject('testHandedIn', 'en', { courseTitle: 'Cell biology', testTitle: 'CA 1' })).toBe('Test handed in: CA 1 in Cell biology')
  })
})
