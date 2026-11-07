import { SiteNav } from '@/components/site-nav'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav user={null} />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
        {children}
      </main>
    </>
  )
}
