// @blocknote/shadcn 0.57.0 is published without its `types/` folder (its package.json points at
// ./types/src/index.d.ts, which is missing). This declares the one export Clasync uses, typed like
// the @blocknote/react view it wraps.
declare module '@blocknote/shadcn' {
  import type { BlockNoteViewRaw } from '@blocknote/react'

  export const BlockNoteView: typeof BlockNoteViewRaw
}
