import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { GuideRunner } from '@/components/guides/guide-runner'
import { SiteNav } from '@/components/site-nav'
import { VerifyBanner } from '@/components/verify-banner'
import { isAdminPath, REQUEST_PATH_HEADER, safeNextPath } from '@/lib/next-path'
import { whatsAppCodesOpen } from '@/server/auth/phone-verification'
import { getCtx, getSessionUser } from '@/server/auth/session'
import { isAdmin } from '@/server/core/admin'
import { isVerificationPending } from '@/server/core/guards'
import { listSeenGuides } from '@/server/guides/service'

/** Signed-in area: pill nav, phone bottom nav, the verification banner when needed, and the in-app guides. */
export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await getSessionUser()
  const requested = (await headers()).get(REQUEST_PATH_HEADER)
  // The admin area doesn't reveal itself, signed in or not. Decided here, above the loading
  // boundary, so a non-admin gets a real 404 and not a streamed 200.
  if (isAdminPath(requested) && (!user || !isAdmin(user))) notFound()
  if (!user) {
    // Back to the page asked for after signing in (e.g. a join or check-in link someone shared).
    const next = safeNextPath(requested)
    redirect(next && next !== '/dashboard' ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in')
  }
  const pending = isVerificationPending(user)
  // Which guides this account has finished or closed: those never start by themselves again.
  const seenGuides = await listSeenGuides(await getCtx())
  return (
    <>
      <SiteNav user={user} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 pt-8 pb-32 sm:pt-12 md:pb-20">
        {pending && <VerifyBanner email={user.email} whatsapp={await whatsAppCodesOpen()} />}
        {children}
      </main>
      {/* Next to the page, not around it. Guides start by themselves only once the email is verified. */}
      <GuideRunner role={user.role} userId={user.id} autoStart={!pending} seen={seenGuides} />
    </>
  )
}
