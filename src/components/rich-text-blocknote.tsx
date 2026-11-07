'use client'

// The BlockNote editor itself. Loaded only in the browser, through next/dynamic in
// rich-text-editor.tsx and rich-text-view.tsx (BlockNote touches `window` on import).
import '@blocknote/shadcn/style.css'
import { BlockNoteSchema, defaultBlockSpecs, type PartialBlock } from '@blocknote/core'
import { en, fr } from '@blocknote/core/locales'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/shadcn'
import { useMemo } from 'react'
import type { Locale } from '@/i18n/locale'

// Ruling B3: no in-editor uploads. The media blocks (which upload or embed files by URL) are left
// out of the schema, so the slash menu, toolbar and paste handling never offer them; files go
// through the attachments uploader instead.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { image, file, video, audio, ...blockSpecs } = defaultBlockSpecs

export const richTextSchema = BlockNoteSchema.create({ blockSpecs })

type RichTextBlock = PartialBlock<
  typeof richTextSchema.blockSchema,
  typeof richTextSchema.inlineContentSchema,
  typeof richTextSchema.styleSchema
>

const knownTypes = new Set<string>(Object.keys(richTextSchema.blockSchema))

/**
 * The stored document as BlockNote initial content: blocks of a type this schema doesn't know are
 * dropped (BlockNote throws on them). Undefined for an empty or invalid value (a blank editor).
 */
function toInitialContent(value: unknown): RichTextBlock[] | undefined {
  function keep(blocks: unknown[]): RichTextBlock[] {
    const out: RichTextBlock[] = []
    for (const raw of blocks) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
      const block = raw as { type?: unknown; children?: unknown }
      if (typeof block.type !== 'string' || !knownTypes.has(block.type)) continue
      const children = Array.isArray(block.children) ? keep(block.children) : undefined
      out.push({ ...(block as RichTextBlock), ...(children ? { children } : {}) })
    }
    return out
  }
  if (!Array.isArray(value)) return undefined
  const content = keep(value)
  return content.length > 0 ? content : undefined
}

function dictionaryFor(locale: Locale) {
  return locale === 'fr' ? fr : en
}

export type RichTextEditorProps = {
  /** The initial document (BlockNote JSON). The editor is uncontrolled after it mounts. */
  value: unknown
  onChange: (value: unknown[]) => void
  locale: Locale
  ariaLabel: string
  /** Id of an element describing the field (hint or error), for aria-describedby. */
  describedBy?: string
  invalid?: boolean
}

export function BlockNoteEditorField({ value, onChange, locale, ariaLabel, describedBy, invalid }: RichTextEditorProps) {
  const editor = useCreateBlockNote({
    schema: richTextSchema,
    dictionary: dictionaryFor(locale),
    initialContent: toInitialContent(value),
    domAttributes: {
      editor: {
        'aria-label': ariaLabel,
        'aria-multiline': 'true',
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(invalid ? { 'aria-invalid': 'true' } : {}),
      },
    },
  })

  return (
    <div
      data-invalid={invalid || undefined}
      className="clasync-rich-text min-h-48 rounded-xl border border-input py-3 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 data-[invalid]:border-destructive data-[invalid]:ring-destructive/20"
    >
      <BlockNoteView
        editor={editor}
        theme="light"
        filePanel={false}
        emojiPicker={false}
        comments={false}
        onChange={() => onChange(editor.document)}
      />
    </div>
  )
}

export function BlockNoteReadOnly({ value, locale }: { value: unknown; locale: Locale }) {
  // Re-create the editor when the stored document changes (e.g. after the page revalidates).
  const serialized = useMemo(() => JSON.stringify(value ?? null), [value])
  const editor = useCreateBlockNote(
    {
      schema: richTextSchema,
      dictionary: dictionaryFor(locale),
      initialContent: toInitialContent(JSON.parse(serialized)),
    },
    [serialized, locale],
  )
  return (
    <div className="clasync-rich-text clasync-rich-text-view">
      <BlockNoteView
        editor={editor}
        theme="light"
        editable={false}
        formattingToolbar={false}
        linkToolbar={false}
        slashMenu={false}
        sideMenu={false}
        filePanel={false}
        tableHandles={false}
        emojiPicker={false}
        comments={false}
      />
    </div>
  )
}
