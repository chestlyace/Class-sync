// Renders the share card (the picture WhatsApp, LinkedIn or X show for a Clasync link) to
// src/app/opengraph-image.png and its alt text, which Next.js serves as every page's og:image.
// Run it again after changing the card: npx tsx scripts/og-image.tsx
// A static file rather than an opengraph-image.tsx route, so the build never renders images.
import { writeFile } from 'node:fs/promises'
import { ImageResponse } from 'next/og'
import { LOGO_VIEWBOX, MARK_PATHS, WORDMARK_PATHS } from '../src/components/logo-paths'

const ALT = 'Clasync: attendance, assignments and marks in one place.'
const HEADLINE = 'Attendance, assignments, marks.'
const TAIL = 'In one place.'

const FOOTNOTE = 'For lecturers and their students'
const LANGUAGES = 'English & français'
const SITE = 'clasync.online'

/** A Google font subset to the card's text (TrueType: Satori can't read woff2). */
async function loadFont(family: string, text: string): Promise<ArrayBuffer> {
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`).then((res) =>
    res.text(),
  )
  const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1]
  if (!url) throw new Error(`Google Fonts returned no TrueType ${family}`)
  return fetch(url).then((res) => res.arrayBuffer())
}

async function main() {
  const [display, body] = await Promise.all([
    loadFont('Bebas+Neue', `${HEADLINE} ${TAIL}`.toUpperCase()),
    loadFont('Inter', `${FOOTNOTE}${LANGUAGES}${SITE}`),
  ])
  const [, , logoWidth, logoHeight] = LOGO_VIEWBOX.split(' ').map(Number)
  const image = new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          background: '#ffffff',
          fontFamily: 'Inter',
          color: '#1d1d1f',
        }}
      >
        <svg width={(52 * logoWidth!) / logoHeight!} height={52} viewBox={LOGO_VIEWBOX}>
          <g fill="#1d1d1f" stroke="#1d1d1f" strokeWidth={1.5} strokeLinejoin="round">
            {[...MARK_PATHS, ...WORDMARK_PATHS].map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
        </svg>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'Bebas Neue',
            fontSize: 132,
            lineHeight: 0.88,
            textTransform: 'uppercase',
          }}
        >
          <span>{HEADLINE}</span>
          <span style={{ color: '#6e6e73' }}>{TAIL}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '2px solid #e3e3e8',
            paddingTop: 28,
            fontSize: 26,
            color: '#48484a',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span>{FOOTNOTE}</span>
            <div style={{ width: 6, height: 6, borderRadius: 3, background: '#6e6e73' }} />
            <span>{LANGUAGES}</span>
          </div>
          <span style={{ color: '#2563eb' }}>{SITE}</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'Bebas Neue', data: display, style: 'normal', weight: 400 },
        { name: 'Inter', data: body, style: 'normal', weight: 400 },
      ],
    },
  )
  await writeFile('src/app/opengraph-image.png', Buffer.from(await image.arrayBuffer()))
  await writeFile('src/app/opengraph-image.alt.txt', ALT)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
