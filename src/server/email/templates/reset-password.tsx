import { Body, Container, Head, Heading, Html, Link, Section, Text } from '@react-email/components'
import type { Locale } from '@/server/core/context'
import { emailTranslator } from './verify-email'
import { CtaLink } from './notification-layout'

/** The link sent when someone asks to reset a password. It only opens a form; it changes nothing. */
export function ResetPasswordEmail({ url, locale }: { url: string; locale: Locale }) {
  const e = emailTranslator(locale)
  const t = (key: 'greeting' | 'body' | 'cta' | 'fallback' | 'ignore') => e(`resetPassword.${key}`)
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
          <Text style={{ fontSize: '16px', lineHeight: '24px' }}>{t('greeting')}</Text>
          <Text style={{ fontSize: '16px', lineHeight: '24px' }}>{t('body')}</Text>
          <Section style={{ margin: '24px 0' }}>
            <CtaLink href={url}>{t('cta')}</CtaLink>
          </Section>
          <Text style={{ fontSize: '14px', lineHeight: '20px', color: '#52525b' }}>
            {t('fallback')}
          </Text>
          <Link href={url} style={{ fontSize: '14px', wordBreak: 'break-all' }}>
            {url}
          </Link>
          <Text style={{ fontSize: '13px', color: '#71717a', marginTop: '24px' }}>
            {t('ignore')}
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
