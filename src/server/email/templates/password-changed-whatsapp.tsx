import { Body, Container, Head, Heading, Html, Link, Section, Text } from '@react-email/components'
import type { Locale } from '@/server/core/context'
import { CtaLink } from './notification-layout'
import { emailTranslator } from './verify-email'

/**
 * Sent to the account's verified email after its password was changed with a WhatsApp code, so an owner
 * who did not do it can recover the account by email and reach support. Names only the number's last two digits.
 */
export function PasswordChangedWhatsAppEmail({
  lastDigits,
  url,
  support,
  locale,
}: {
  lastDigits: string
  url: string
  support: string
  locale: Locale
}) {
  const t = emailTranslator(locale)
  const p = (key: 'greeting' | 'body' | 'warning' | 'cta' | 'fallback', values?: Record<string, string>) =>
    t(`passwordChangedWhatsApp.${key}`, values)
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
          <Text style={{ fontSize: '16px', lineHeight: '24px' }}>{p('greeting')}</Text>
          <Text style={{ fontSize: '16px', lineHeight: '24px' }}>{p('body', { digits: lastDigits })}</Text>
          <Text style={{ fontSize: '16px', lineHeight: '24px' }}>{p('warning', { support })}</Text>
          <Section style={{ margin: '24px 0' }}>
            <CtaLink href={url}>{p('cta')}</CtaLink>
          </Section>
          <Text style={{ fontSize: '14px', lineHeight: '20px', color: '#52525b' }}>{p('fallback')}</Text>
          <Link href={url} style={{ fontSize: '14px', wordBreak: 'break-all' }}>
            {url}
          </Link>
        </Container>
      </Body>
    </Html>
  )
}
