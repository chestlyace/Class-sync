import { Download, FileText, Image as ImageIcon } from 'lucide-react'
import { formatFileSize } from '@/lib/file-size'
import type { FileInfo } from '@/server/files/service'

/**
 * Uploaded files as links to `/api/files/<id>` (PDFs and images open, Word files download).
 * `openLabel` also gets the file, e.g. to say "Download" for the ones `displayKind` can't show.
 */
export function FileList({
  files,
  locale,
  openLabel,
}: {
  files: FileInfo[]
  locale: string
  openLabel: (name: string, file: FileInfo) => string
}) {
  return (
    <ul className="flex flex-col divide-y rounded-2xl border">
      {files.map((f) => {
        const Icon = f.mimeType.startsWith('image/') ? ImageIcon : FileText
        return (
          <li key={f.id}>
            <a
              href={`/api/files/${encodeURIComponent(f.id)}`}
              target="_blank"
              rel="noopener"
              aria-label={openLabel(f.name, f)}
              className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-muted/60"
            >
              <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.name}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatFileSize(f.sizeBytes, locale)}</span>
              <Download aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            </a>
          </li>
        )
      })}
    </ul>
  )
}
