import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import fr from '../../../../messages/fr.json'

vi.mock('@/app/actions/whatsapp', () => ({
  connectWhatsAppAction: vi.fn(),
  disconnectWhatsAppAction: vi.fn(),
  getWhatsAppSettingsAction: vi.fn(),
  setWhatsAppPreferenceAction: vi.fn(),
}))

import { WhatsAppSettings } from './whatsapp'

const prefs = { checkin: true, tests: true, results: false, assignments: true, classSoon: true }

function render(
  props: { maskedPhone: string | null; roles: { student: boolean; lecturer: boolean } },
  locale: 'en' | 'fr' = 'en',
) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : fr}>
      <WhatsAppSettings prefs={prefs} {...props} />
    </NextIntlClientProvider>,
  )
}

describe('WhatsAppSettings', () => {
  it('offers Connect WhatsApp, with no switches, before a number is linked', () => {
    const html = render({ maskedPhone: null, roles: { student: true, lecturer: false } })
    expect(html).toContain('>Connect WhatsApp<')
    expect(html).not.toContain('role="switch"')
    expect(html).not.toContain('Disconnect')
  })

  it('uses the French button label the bad-code reply points to', () => {
    expect(render({ maskedPhone: null, roles: { student: true, lecturer: false } }, 'fr')).toContain('>Connecter WhatsApp<')
  })

  it('shows the number, Disconnect and only the student switches for a student', () => {
    const html = render({ maskedPhone: '+237 6•• ••• 412', roles: { student: true, lecturer: false } })
    expect(html).toContain('Connected: +237 6•• ••• 412')
    expect(html).toContain('Disconnect')
    expect(html).toContain('Send STOP on WhatsApp to turn everything off.')
    for (const label of ['Check-in opened', 'Test started', 'Results released', 'New assignment']) expect(html).toContain(label)
    expect(html).not.toContain('Class starts soon')
    expect(html.match(/role="switch"/g)).toHaveLength(4)
    // Reflects the stored preferences.
    expect(html.match(/aria-checked="true"/g)).toHaveLength(3)
  })

  it('shows only "Class starts soon" for a lecturer, and all five for both roles', () => {
    const lecturer = render({ maskedPhone: '+237 6•• ••• 412', roles: { student: false, lecturer: true } })
    expect(lecturer.match(/role="switch"/g)).toHaveLength(1)
    expect(lecturer).toContain('Class starts soon')
    expect(lecturer).not.toContain('Test started')
    const both = render({ maskedPhone: '+237 6•• ••• 412', roles: { student: true, lecturer: true } })
    expect(both.match(/role="switch"/g)).toHaveLength(5)
  })
})
