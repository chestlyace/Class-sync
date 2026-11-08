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
type BoundaryState = { failed: boolean; value: unknown }

export class RichTextBoundary extends Component<{ value: unknown; children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false, value: this.props.value }

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true }
  }

  /**
   * A new document gets a fresh try: without this, one malformed document would keep the fallback
   * for the life of the instance (e.g. on the next submission, which reuses this component), even
   * after the value becomes valid. A reference compare is enough: pages pass a new object only
   * when the stored document changes.
   */
  static getDerivedStateFromProps(props: { value: unknown }, state: BoundaryState): Partial<BoundaryState> | null {
    return props.value !== state.value ? { failed: false, value: props.value } : null
  }

  componentDidCatch(error: unknown) {
    console.error('[rich-text] could not render the document', error)
  }

  render() {
    return this.state.failed ? <RichTextFallback value={this.props.value} /> : this.props.children
  }
}
