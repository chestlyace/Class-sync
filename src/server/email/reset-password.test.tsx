import { render } from '@react-email/render'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import fr from '../../../messages/fr.json'
import { PasswordChangedWhatsAppEmail } from './templates/password-changed-whatsapp'
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

describe('PasswordChangedWhatsAppEmail', () => {
  const link = 'https://clasync.test/forgot-password'

  it('names the last two digits, the way back and support, in both languages, with a plain-text part', async () => {
    for (const [locale, copy] of [
      ['en', en],
      ['fr', fr],
    ] as const) {
      const email = <PasswordChangedWhatsAppEmail lastDigits="47" url={link} support="support@clasync.online" locale={locale} />
      const html = await render(email)
      const text = await render(email, { plainText: true })
      for (const out of [html, text]) {
        expect(out).toContain(link)
        expect(out).toContain('support@clasync.online')
        expect(out).toContain('47')
      }
      expect(html).toContain(copy.email.passwordChangedWhatsApp.cta)
      expect(text).toContain(copy.email.passwordChangedWhatsApp.fallback)
    }
  })

  it('has a localized subject', () => {
    expect(emailSubject('passwordChangedWhatsApp', 'en')).toBe(en.email.passwordChangedWhatsApp.subject)
    expect(emailSubject('passwordChangedWhatsApp', 'fr')).toBe(fr.email.passwordChangedWhatsApp.subject)
  })
})
