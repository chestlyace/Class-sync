import { render } from '@react-email/render'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import fr from '../../../messages/fr.json'
import { ResetPasswordEmail } from './templates/reset-password'
import { emailSubject } from './templates/verify-email'

const url = 'https://clasync.test/reset-password?token=abc123'

describe('ResetPasswordEmail', () => {
  it('renders the link and localized copy', async () => {
    const html = await render(<ResetPasswordEmail url={url} locale="en" />)
    expect(html).toContain(en.email.resetPassword.cta)
    expect(html).toContain(url)
    const french = await render(<ResetPasswordEmail url={url} locale="fr" />)
    expect(french).toContain(fr.email.resetPassword.cta)
    expect(french).not.toContain(en.email.resetPassword.cta)
  })

  it('has a localized subject', () => {
    expect(emailSubject('resetPassword', 'en')).toBe(en.email.resetPassword.subject)
    expect(emailSubject('resetPassword', 'fr')).toBe(fr.email.resetPassword.subject)
  })
})
