import { redirect } from 'next/navigation'
import { SiteNav } from '@/components/site-nav'
import { VerifyBanner } from '@/components/verify-banner'
import { getSessionUser } from '@/server/auth/session'
import { isVerificationPending } from '@/server/core/guards'

/** Signed-in area: pill nav, phone bottom nav, and the verification banner when needed. */
export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await getSessionUser()
  if (!user) redirect('/sign-in')
  return (
    <>
      <SiteNav user={user} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 pt-8 pb-32 sm:pt-12 md:pb-20">
        {isVerificationPending(user) && <VerifyBanner email={user.email} />}
        {children}
      </main>
    </>
  )
}
