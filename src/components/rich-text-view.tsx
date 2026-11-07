'use client'

import dynamic from 'next/dynamic'
import type { Locale } from '@/i18n/locale'

function ViewSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
    </div>
  )
}

const View = dynamic(() => import('./rich-text-blocknote').then((m) => m.BlockNoteReadOnly), {
  ssr: false,
  loading: ViewSkeleton,
})

/** A stored rich-text document (BlockNote JSON), read-only. Client-only, like the editor. */
export function RichTextView({ value, locale }: { value: unknown; locale: Locale }) {
  return <View value={value} locale={locale} />
}
