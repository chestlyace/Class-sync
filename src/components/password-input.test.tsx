import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import en from '../../messages/en.json'
import { PasswordInput } from './password-input'

function render(props: React.ComponentProps<typeof PasswordInput>) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <PasswordInput {...props} />
    </NextIntlClientProvider>,
  )
}

describe('PasswordInput', () => {
  // Shown as text (the eye button), a phone keyboard would capitalise, autocorrect and add a space
  // after a suggestion: invisible changes that make the two reset fields differ.
  it('keeps the phone keyboard from changing what is typed', () => {
    const html = render({ id: 'pw', name: 'pw' }).toLowerCase()
    expect(html).toContain('autocapitalize="none"')
    expect(html).toContain('autocorrect="off"')
    expect(html).toContain('spellcheck="false"')
  })

  it('still lets a caller set its own attributes', () => {
    const html = render({ id: 'pw', name: 'pw', autoComplete: 'current-password' }).toLowerCase()
    expect(html).toContain('autocomplete="current-password"')
  })
})
