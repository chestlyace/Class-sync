import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import { ResetPasswordForm } from './reset-password-form'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))
vi.mock('./actions', () => ({ resetPasswordAction: vi.fn() }))

function render(props: { token: string | null; email: string | null; next?: string | null }) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <ResetPasswordForm {...props} />
    </NextIntlClientProvider>,
  )
}

/** The opening tag of the input with this id. */
function inputTag(html: string, id: string): string {
  const tag = new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0]
  expect(tag).toBeDefined()
  return tag!
}

describe('ResetPasswordForm', () => {
  const live = { token: 'live-token', email: 'ama@example.com' }

  it('lets password managers suggest and save the new password', () => {
    const tag = inputTag(render(live), 'newPassword').toLowerCase()
    expect(tag).toContain('autocomplete="new-password"')
    expect(tag).not.toContain('data-1p-ignore')
    expect(tag).not.toContain('data-lpignore')
  })

  it('asks for the new password once: no confirm field to mismatch', () => {
    const html = render(live)
    expect(html).not.toContain('id="confirmPassword"')
    expect(html.match(/type="password"/g)).toHaveLength(1)
  })

  it('names the account, for the reader and for password managers', () => {
    const html = render(live)
    expect(html).toContain('ama@example.com')
    const username = /<input[^>]*autocomplete="username"[^>]*>/i.exec(html)?.[0]
    expect(username).toBeDefined()
    expect(username).toContain('value="ama@example.com"')
  })

  it('says a dead link is dead before any password is typed, and offers a new one', () => {
    const html = render({ token: 'old-token', email: null })
    expect(html).not.toContain('id="newPassword"')
    expect(html).toContain(en.auth.resetPassword.invalidLink)
    expect(html).toContain('href="/forgot-password"')
  })
})
