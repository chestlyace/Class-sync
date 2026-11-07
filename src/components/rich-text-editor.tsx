'use client'

import dynamic from 'next/dynamic'
import type { RichTextEditorProps } from './rich-text-blocknote'
import { RichTextBoundary } from './rich-text-boundary'

export type { RichTextEditorProps }

/** Placeholder while the editor's code loads (and during server rendering). */
function EditorSkeleton() {
  return <div aria-hidden="true" className="min-h-48 animate-pulse rounded-xl border border-input bg-muted/40" />
}

const Editor = dynamic(() => import('./rich-text-blocknote').then((m) => m.BlockNoteEditorField), {
  ssr: false,
  loading: EditorSkeleton,
})

/**
 * Rich-text field (BlockNote), client-only. `value` is the initial document (BlockNote JSON);
 * every edit calls `onChange` with the whole document. No images or file blocks: attachments go
 * through <FileUploader>.
 */
export function RichTextEditor(props: RichTextEditorProps) {
  return (
    <RichTextBoundary value={props.value}>
      <Editor {...props} />
    </RichTextBoundary>
  )
}
