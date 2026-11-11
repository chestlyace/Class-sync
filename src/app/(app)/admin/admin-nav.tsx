'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const ITEMS = [
  { href: '/admin', key: 'overview' },
  { href: '/admin/people', key: 'people' },
  { href: '/admin/usage', key: 'usage' },
  { href: '/admin/ai', key: 'ai' },
  { href: '/admin/health', key: 'health' },
  { href: '/admin/audit', key: 'audit' },
] as const

function isCurrent(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** The admin sections. On a phone the row scrolls sideways inside itself, never the page. */
export function AdminNav() {
  const t = useTranslations('admin.nav')
  const pathname = usePathname()
  return (
    <nav aria-label={t('label')} className="-m-1 min-w-0 overflow-x-auto p-1">
      <ul className="flex w-max gap-1 font-mono text-xs font-medium tracking-[0.08em] uppercase">
        {ITEMS.map(({ href, key }) => {
          const current = isCurrent(pathname, href)
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'inline-flex h-10 items-center rounded-full px-4 whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                  current && 'bg-accent text-foreground',
                )}
              >
                {t(key)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
