'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import './globals.css'

/**
 * Last-resort boundary: it replaces the root layout, so neither the translations provider nor the
 * fonts are available. The text is therefore static and bilingual (EN / FR).
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error)
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground antialiased">
        <title>Clasync</title>
        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-16">
          <div role="alert" className="flex flex-col gap-4 rounded-3xl border bg-card p-5 sm:p-7">
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
              <p className="text-muted-foreground">Clasync couldn&apos;t load. Please try again.</p>
            </div>
            <div lang="fr" className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold tracking-tight">Une erreur est survenue</h2>
              <p className="text-muted-foreground">Clasync n&apos;a pas pu se charger. Veuillez réessayer.</p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => retry()}
                className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80"
              >
                Try again · Réessayer
              </button>
              <a
                href="/dashboard"
                className="inline-flex h-10 items-center justify-center rounded-full border px-4 text-sm font-medium hover:bg-muted"
              >
                Dashboard · Tableau de bord
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  )
}
