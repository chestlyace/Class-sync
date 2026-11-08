import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { createTranslator } from 'next-intl'
import type { Locale } from '@/server/core/context'
import en from '../../../../messages/en.json'
import fr from '../../../../messages/fr.json'

const allMessages = { en, fr } as const

export function emailTranslator(locale: Locale) {
  return createTranslator({ locale, messages: allMessages[locale], namespace: 'email' })
}

const SUBJECT_VAR_MAX = 150

/** Titles are user input: keep them on one line (no header injection) and bounded in the subject. */
function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, SUBJECT_VAR_MAX)
}

export type NotificationKind = 'assignmentPublished' | 'assignmentReminder' | 'gradesReleased'

export function emailSubject(kind: 'verify', locale: Locale): string
export function emailSubject(
  kind: NotificationKind,
  locale: Locale,
  vars: { courseTitle: string; assignmentTitle: string },
): string
export function emailSubject(
  kind: 'testResultsReleased',
  locale: Locale,
  vars: { courseTitle: string; testTitle: string },
): string
export function emailSubject(
  kind: 'verify' | NotificationKind | 'testResultsReleased',
  locale: Locale,
  vars?: { courseTitle: string; assignmentTitle: string } | { courseTitle: string; testTitle: string },
): string {
  const t = emailTranslator(locale)
  if (kind === 'verify') return t('verify.subject')
  if (kind === 'testResultsReleased') {
    return t('testResultsReleased.subject', {
      course: singleLine(vars?.courseTitle ?? ''),
      test: singleLine(vars && 'testTitle' in vars ? vars.testTitle : ''),
    })
  }
  return t(`${kind}.subject`, {
    course: singleLine(vars?.courseTitle ?? ''),
    assignment: singleLine(vars && 'assignmentTitle' in vars ? vars.assignmentTitle : ''),
  })
}

export function VerifyEmail({ name, url, locale }: { name: string; url: string; locale: Locale }) {
  const e = emailTranslator(locale)
  const t = (key: 'preview' | 'greeting' | 'body' | 'cta' | 'fallback' | 'ignore', values?: Record<string, string>) =>
    e(`verify.${key}`, values)
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{t('preview')}</Preview>
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
          <Text style={{ fontSize: '16px', lineHeight: '24px' }}>{t('greeting', { name })}</Text>
          <Text style={{ fontSize: '16px', lineHeight: '24px' }}>{t('body')}</Text>
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
              {t('cta')}
            </Button>
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
