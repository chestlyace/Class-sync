'use client'

import { KeyRound, LayoutGrid, Plus, type LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Role } from '@/server/core/context'

type Item = { href: string; label: string; icon: LucideIcon }

function useItems(role: Role): Item[] {
  const t = useTranslations('nav')
  const items: Item[] = [
    { href: '/dashboard', label: t('dashboard'), icon: LayoutGrid },
    { href: '/join', label: t('join'), icon: KeyRound },
  ]
  if (role === 'lecturer') items.push({ href: '/classes/new', label: t('newClass'), icon: Plus })
  return items
}

function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Links inside the floating pill nav (tablet and up). */
export function TopNavLinks({ role }: { role: Role }) {
  const pathname = usePathname()
  const items = useItems(role)
  return (
    <ul className="hidden items-center gap-1 font-mono text-xs font-medium tracking-[0.08em] uppercase md:flex">
      {items.map(({ href, label }) => {
        const current = isCurrent(pathname, href)
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'inline-flex h-10 items-center rounded-full px-4 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                current && 'bg-accent text-foreground',
              )}
            >
              {label}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** Floating bottom pill on phones, where the top pill has no room for links. */
export function BottomNav({ role, label }: { role: Role; label: string }) {
  const pathname = usePathname()
  const items = useItems(role)
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-sm rounded-full border bg-background/90 p-1.5 shadow-sm backdrop-blur md:hidden"
    >
      <ul className="flex items-stretch justify-around gap-1">
        {items.map(({ href, label: text, icon: Icon }) => {
          const current = isCurrent(pathname, href)
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-full px-2 text-[11px] font-medium text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  current && 'bg-accent text-foreground',
                )}
              >
                <Icon aria-hidden="true" className="size-5" />
                {text}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
