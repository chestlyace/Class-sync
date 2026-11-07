import { render } from '@react-email/render'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import fr from '../../../messages/fr.json'
import { emailSubject, VerifyEmail } from './templates/verify-email'

describe('VerifyEmail', () => {
  it('renders French copy and the url', async () => {
    const html = await render(<VerifyEmail name="Ada" url="https://x/v" locale="fr" />)
    expect(html).toContain(fr.email.verify.cta)
    expect(html).toContain('https://x/v')
    expect(html).toContain('Ada')
  })

  it('renders English copy', async () => {
    const html = await render(<VerifyEmail name="Ada" url="https://x/v" locale="en" />)
    expect(html).toContain(en.email.verify.cta)
    expect(html).not.toContain(fr.email.verify.cta)
  })

  it('has a localized subject', () => {
    expect(emailSubject('verify', 'fr')).toBe(fr.email.verify.subject)
    expect(emailSubject('verify', 'en')).toBe(en.email.verify.subject)
  })
})
