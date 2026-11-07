import { cookies, headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { getSessionUser } from '@/server/auth/session'
import { LOCALE_COOKIE, resolveLocale } from './locale'

export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()])
  // Best effort: a session lookup failure (e.g. DB down) must not take down rendering.
  const user = await getSessionUser().catch(() => null)
  const locale = resolveLocale({
    userLocale: user?.locale,
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  })
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default }
})
