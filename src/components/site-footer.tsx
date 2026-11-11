import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { Logo } from '@/components/logo'
import { HELLO_EMAIL, supportEmail } from '@/lib/contact'
import { cn } from '@/lib/utils'

const link = 'rounded-full text-subtle outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50'

/**
 * The footer of the public pages (landing, about, privacy, terms): the logo and a line on what
 * Clasync is, then Product, Company and Legal columns. Product links point at the landing sections.
 */
export async function SiteFooter() {
  const t = await getTranslations('footer')
  const columns = [
    {
      key: 'product',
      links: [
        { href: '/#features', label: t('features') },
        { href: '/#assistant', label: t('assistant') },
        { href: '/#how', label: t('how') },
        { href: '/#faq', label: t('faq') },
      ],
    },
    {
      key: 'company',
      links: [
        { href: '/about', label: t('about') },
        { href: `mailto:${HELLO_EMAIL}`, label: t('contact') },
        { href: `mailto:${supportEmail()}`, label: t('support') },
      ],
    },
    {
      key: 'legal',
      links: [
        { href: '/privacy', label: t('privacy') },
        { href: '/terms', label: t('terms') },
      ],
    },
  ] as const

  return (
    <footer className="border-t">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-x-6 gap-y-10 px-4 py-14 sm:grid-cols-[1.6fr_1fr_1fr_1fr] sm:py-16">
        <div className="col-span-2 flex flex-col items-start gap-4 sm:col-span-1">
          <Logo className="h-6 text-foreground" />
          <p className="max-w-[34ch] text-sm leading-relaxed text-muted-foreground">{t('tagline')}</p>
          <a href={`mailto:${HELLO_EMAIL}`} className={cn(link, 'text-sm')}>
            {HELLO_EMAIL}
          </a>
        </div>
        {columns.map((column) => (
          <nav key={column.key} aria-labelledby={`footer-${column.key}`} className="flex flex-col gap-4">
            <h2
              id={`footer-${column.key}`}
              className="font-mono text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase"
            >
              {t(column.key)}
            </h2>
            <ul className="flex flex-col gap-2.5 text-sm">
              {column.links.map(({ href, label }) => (
                <li key={href}>
                  {href.startsWith('/') && !href.includes('#') ? (
                    <Link href={href} className={link}>
                      {label}
                    </Link>
                  ) : (
                    <a href={href} className={link}>
                      {label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 text-[13px] text-muted-foreground">
          <span>{t('copyright', { year: new Date().getFullYear() })}</span>
          <span className="font-mono text-xs tracking-[0.08em] uppercase">{t('languages')}</span>
        </div>
      </div>
    </footer>
  )
}
