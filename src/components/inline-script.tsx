'use client'

/**
 * A script the browser runs while it parses the server's HTML, before any Next.js or React code.
 * Pass only compile-time constants: the text goes into the page as is. On the client it renders
 * as `text/plain` (never executed, and no React warning about script tags); the attribute
 * mismatch at hydration is expected. This is the pattern from Next's "Preventing flash before
 * hydration" guide.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
