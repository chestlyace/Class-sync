'use client'

import { TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Component, type ReactNode } from 'react'
import { richTextPlainText } from '@/lib/rich-text-content'

/** Shown when BlockNote can't load a stored document: a note, then the document's plain text. */
function RichTextFallback({ value }: { value: unknown }) {
  const t = useTranslations('common')
  const text = richTextPlainText(value)
  return (
    <div role="note" className="flex flex-col gap-3">
      <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
        {t('richTextUnavailable')}
      </p>
      {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
    </div>
  )
}

/**
 * Catches a rendering error of the rich-text editor or view (e.g. a malformed stored document), so
 * the rest of the page (a grade form, a submit button) keeps working.
 */
export class RichTextBoundary extends Component<{ value: unknown; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('[rich-text] could not render the document', error)
  }

  render() {
    return this.state.failed ? <RichTextFallback value={this.props.value} /> : this.props.children
  }
}
