import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import fr from '../../../../messages/fr.json'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/app/actions/phone-verification', () => ({ verifyWhatsAppCode: vi.fn() }))
vi.mock('./actions', () => ({ removePhoneNumberAction: vi.fn() }))
vi.mock('@/lib/phone-code', () => ({ CODE_RESEND_SECONDS: 60, requestPhoneCode: vi.fn() }))

import { WhatsAppNumberCard } from './whatsapp-number-card'

function render(
  props: { phone: string | null; verified: boolean; emailVerified: boolean; canChange: boolean },
  locale: 'en' | 'fr' = 'en',
) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : fr}>
      <WhatsAppNumberCard {...props} />
    </NextIntlClientProvider>,
  )
}

describe('WhatsAppNumberCard', () => {
  it('offers Add for an account with no number, and nothing to remove', () => {
    const html = render({ phone: null, verified: false, emailVerified: true, canChange: true })
    expect(html).toContain('>Add a number<')
    expect(html).not.toContain('>Remove<')
    expect(html).not.toContain('Email not verified')
  })

  it('shows the masked number with a Verified badge, and Change and Remove', () => {
    const html = render({ phone: '+237677000301', verified: true, emailVerified: true, canChange: true })
    expect(html).toContain('+••••••••••01')
    expect(html).not.toContain('677000301')
    expect(html).toContain('>Verified<')
    expect(html).toContain('>Change number<')
    expect(html).toContain('>Remove<')
  })

  it('says the email is not verified for a WhatsApp-only account', () => {
    const html = render({ phone: '+237677000301', verified: true, emailVerified: false, canChange: true })
    expect(html).toContain('Email not verified')
    expect(html).toContain('>Verified<')
  })

  it('hides Add and Change while codes are off, but keeps Remove', () => {
    const html = render({ phone: '+237677000301', verified: true, emailVerified: true, canChange: false })
    expect(html).not.toContain('Change number')
    expect(html).not.toContain('Add a number')
    expect(html).toContain('>Remove<')
  })

  it('has French labels', () => {
    const html = render({ phone: '+237677000301', verified: true, emailVerified: false, canChange: true }, 'fr')
    expect(html).toContain('>Vérifié<')
    expect(html).toContain('>Changer de numéro<')
    expect(html).toContain('E-mail non vérifié')
  })
})
