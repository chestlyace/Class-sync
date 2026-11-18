import { Body, Container, Head, Heading, Html, Link, Section, Text } from '@react-email/components'
import type { ReactNode } from 'react'
import type { Locale } from '@/server/core/context'

/** Formats a due date as 24-hour time in the given time zone, with locale-aware weekday and month. */
export function formatDue(dueAt: Date, locale: Locale, timeZone: string): { date: string; time: string } {
  const date = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(dueAt)
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(dueAt)
  return { date, time }
}

/**
 * The call-to-action, as a plain styled link. React Email's `Button` adds Outlook-only hidden
 * spacers (hair spaces, zero-width spaces), and iCloud rejects mail with hidden content as
 * `554 5.7.1 [HM08]`. For the same reason no email has a hidden preview text (`Preview`).
 */
export function CtaLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        display: 'inline-block',
        backgroundColor: '#18181b',
        color: '#ffffff',
        padding: '12px 20px',
        borderRadius: '6px',
        fontSize: '16px',
        lineHeight: '20px',
        textDecoration: 'none',
      }}
    >
      {children}
    </Link>
  )
}

export function NotificationLayout({
  locale,
  greeting,
  paragraphs,
  cta,
  url,
  fallback,
}: {
  locale: Locale
  greeting: string
  paragraphs: ReactNode[]
  cta: string
  url: string
  fallback: string
}) {
  return (
    <Html lang={locale}>
      <Head />
      <Body style={{ backgroundColor: '#f4f4f5', fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <Container
          style={{
            backgroundColor: '#ffffff',
            margin: '32px auto',
            padding: '32px',
            maxWidth: '480px',
            borderRadius: '8px',
          }}
        >
          <Heading as="h1" style={{ fontSize: '22px', margin: '0 0 16px' }}>
            Clasync
          </Heading>
          <Text style={{ fontSize: '16px', lineHeight: '24px' }}>{greeting}</Text>
          {paragraphs.map((p, i) => (
            <Text key={i} style={{ fontSize: '16px', lineHeight: '24px' }}>
              {p}
            </Text>
          ))}
          <Section style={{ margin: '24px 0' }}>
            <CtaLink href={url}>{cta}</CtaLink>
          </Section>
          <Text style={{ fontSize: '14px', lineHeight: '20px', color: '#52525b' }}>{fallback}</Text>
          <Link href={url} style={{ fontSize: '14px', wordBreak: 'break-all' }}>
            {url}
          </Link>
        </Container>
      </Body>
    </Html>
  )
}
