import { Body, Button, Container, Head, Heading, Html, Link, Preview, Section, Text } from '@react-email/components'
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

export function NotificationLayout({
  locale,
  preview,
  greeting,
  paragraphs,
  cta,
  url,
  fallback,
}: {
  locale: Locale
  preview: string
  greeting: string
  paragraphs: ReactNode[]
  cta: string
  url: string
  fallback: string
}) {
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{preview}</Preview>
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
            <Button
              href={url}
              style={{
                backgroundColor: '#18181b',
                color: '#ffffff',
                padding: '12px 20px',
                borderRadius: '6px',
                fontSize: '16px',
                textDecoration: 'none',
              }}
            >
              {cta}
            </Button>
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
