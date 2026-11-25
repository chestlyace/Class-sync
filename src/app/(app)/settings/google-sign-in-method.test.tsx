import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import fr from '../../../../messages/fr.json'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/app/actions/locale', () => ({ setLocale: vi.fn() }))
vi.mock('@/lib/auth-client', () => ({ authClient: { linkSocial: vi.fn(), unlinkAccount: vi.fn() } }))
vi.mock('./actions', () => ({ addMatriculeAction: vi.fn(), setSchoolLocationAction: vi.fn() }))

import { GoogleSignInMethod } from './settings-forms'

function render(props: { googleAccountId: string | null; hasPassword: boolean; emailVerified: boolean }, locale: 'en' | 'fr' = 'en') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : fr}>
      <GoogleSignInMethod {...props} />
    </NextIntlClientProvider>,
  )
}

describe('GoogleSignInMethod', () => {
  it('offers Connect Google once the email is confirmed', () => {
    const html = render({ googleAccountId: null, hasPassword: true, emailVerified: true })
    expect(html).toContain(en.settings.signInMethods.connect)
    expect(html).not.toContain(en.settings.signInMethods.confirmEmailFirst)
  })

  it('hides Connect Google and says why while the email is not confirmed', () => {
    const html = render({ googleAccountId: null, hasPassword: true, emailVerified: false })
    expect(html).not.toContain(en.settings.signInMethods.connect)
    expect(html).toContain(en.settings.signInMethods.confirmEmailFirst)
    const htmlFr = render({ googleAccountId: null, hasPassword: true, emailVerified: false }, 'fr')
    expect(htmlFr).toContain('associer Google ici')
  })

  it('still lets an account with Google connected disconnect it', () => {
    const html = render({ googleAccountId: 'acc-1', hasPassword: true, emailVerified: false })
    expect(html).toContain(en.settings.signInMethods.disconnect)
    expect(html).not.toContain(en.settings.signInMethods.confirmEmailFirst)
  })
})
