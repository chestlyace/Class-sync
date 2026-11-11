import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { getSessionUser } from '@/server/auth/session'
import { isAdmin } from '@/server/core/admin'
import { AdminNav } from './admin-nav'

/**
 * The admin area: admins only (ADMIN_EMAILS, verified). Everyone else gets the app's normal
 * not-found page, so the area's existence isn't revealed. Each page's read model checks again.
 */
export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  const user = await getSessionUser()
  if (!user || !isAdmin(user)) notFound()
  // The root layout leaves the admin strings out of the browser; admins get them here.
  return (
    <NextIntlClientProvider messages={await getMessages()}>
      <AdminNav />
      {children}
    </NextIntlClientProvider>
  )
}
