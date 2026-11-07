import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import en from '../../messages/en.json'
import fr from '../../messages/fr.json'
import type { ActionResult } from '@/lib/action-result'
import { ActionError } from './action-error'

function render(state: ActionResult<unknown> | null, locale: 'en' | 'fr' = 'en') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : fr}>
      <ActionError state={state} />
    </NextIntlClientProvider>,
  )
}

describe('ActionError', () => {
  it('renders nothing for no result or a success', () => {
    expect(render(null)).toBe('')
    expect(render({ ok: true, data: null })).toBe('')
  })

  it('shows the translated message for a failed action', () => {
    expect(render({ ok: false, code: 'FORBIDDEN' })).toContain(en.errors.FORBIDDEN.replace("'", '&#x27;'))
    expect(render({ ok: false, code: 'FORBIDDEN' })).not.toContain('href="/sign-in"')
  })

  it('offers a sign-in link when the session expired (UNAUTHENTICATED)', () => {
    const html = render({ ok: false, code: 'UNAUTHENTICATED' })
    expect(html).toContain(en.errors.UNAUTHENTICATED)
    expect(html).toMatch(new RegExp(`<a [^>]*href="/sign-in"[^>]*>${en.nav.signIn}</a>`))
    const htmlFr = render({ ok: false, code: 'UNAUTHENTICATED' }, 'fr')
    expect(htmlFr).toMatch(new RegExp(`<a [^>]*href="/sign-in"[^>]*>${fr.nav.signIn}</a>`))
  })
})
