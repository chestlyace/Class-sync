import { render } from '@react-email/render'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import fr from '../../../messages/fr.json'
import { TestResultsReleasedEmail } from './templates/test-results-released'
import { emailSubject } from './templates/verify-email'

const base = {
  studentName: 'Ada',
  courseTitle: 'Cell biology',
  testTitle: 'CA 1',
  url: 'https://clasync.test/t/8F3KQ2',
}

describe('TestResultsReleasedEmail', () => {
  it('renders in fr with the French subject and the /t/<code> link', async () => {
    const html = await render(<TestResultsReleasedEmail {...base} locale="fr" />)
    expect(html).toContain('Bonjour Ada')
    expect(html).toContain(fr.email.testResultsReleased.cta)
    expect(html).toContain('Cell biology')
    expect(html).toContain('CA 1')
    expect(html).toContain('https://clasync.test/t/8F3KQ2')
    expect(html).not.toContain(en.email.testResultsReleased.cta)

    const subject = emailSubject('testResultsReleased', 'fr', { courseTitle: 'Cell biology', testTitle: 'CA 1' })
    expect(subject).toBe(fr.email.testResultsReleased.subject.replace('{test}', 'CA 1').replace('{course}', 'Cell biology'))
    expect(subject).not.toBe(emailSubject('testResultsReleased', 'en', { courseTitle: 'Cell biology', testTitle: 'CA 1' }))
  })

  it('renders in en', async () => {
    const html = await render(<TestResultsReleasedEmail {...base} locale="en" />)
    expect(html).toContain('Hello Ada')
    expect(html).toContain(en.email.testResultsReleased.cta)
    expect(html).toContain('https://clasync.test/t/8F3KQ2')
  })

  it('escapes titles and keeps the subject on one line', async () => {
    const nasty = `<b>x</b> & "Ada's test"`
    const html = await render(<TestResultsReleasedEmail {...base} testTitle={nasty} locale="en" />)
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    const subject = emailSubject('testResultsReleased', 'en', { courseTitle: 'Bio\r\nBcc: evil@example.com', testTitle: 'CA\n1' })
    expect(subject).not.toMatch(/[\r\n]/)
    expect(subject).toContain('CA 1')
  })
})
