import { Link, Text } from '@react-email/components'
import { Fragment } from 'react'
import { bodyToParagraphs } from '@/server/broadcasts/text'
import type { Locale } from '@/server/core/context'
import { EmailFrame } from './notification-layout'
import { emailTranslator } from './verify-email'

export type BroadcastEmailProps = {
  locale: Locale
  /** The announcement text the admin wrote: plain text, shown as paragraphs, with web addresses as links. */
  body: string
  /** The page where the reader can stop these announcements. */
  unsubscribePageUrl: string
}

/** An announcement from Clasync: the admin's text, then why the reader got it and how to stop it. */
export function BroadcastEmail({ locale, body, unsubscribePageUrl }: BroadcastEmailProps) {
  const e = emailTranslator(locale)
  return (
    <EmailFrame locale={locale}>
      {bodyToParagraphs(body).map((lines, p) => (
        <Text key={p} style={{ fontSize: '16px', lineHeight: '24px' }}>
          {lines.map((pieces, l) => (
            <Fragment key={l}>
              {l > 0 ? <br /> : null}
              {pieces.map((piece, i) =>
                piece.kind === 'link' ? (
                  <Link key={i} href={piece.href} style={{ wordBreak: 'break-all' }}>
                    {piece.href}
                  </Link>
                ) : (
                  <Fragment key={i}>{piece.value}</Fragment>
                ),
              )}
            </Fragment>
          ))}
        </Text>
      ))}
      <Text style={{ fontSize: '14px', lineHeight: '20px', color: '#52525b', margin: '24px 0 4px' }}>
        {e('broadcast.why')}
      </Text>
      <Link href={unsubscribePageUrl} style={{ fontSize: '14px' }}>
        {e('broadcast.stop')}
      </Link>
    </EmailFrame>
  )
}
