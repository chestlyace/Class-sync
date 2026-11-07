/** How a page shows an uploaded file (served by `/api/files/<id>`). */
export type DisplayKind = 'pdf' | 'image' | 'download'

/** Image types every browser can draw. HEIC/HEIF can't be shown by most browsers, so they download. */
const INLINE_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** PDFs go in an <iframe>, JPEG/PNG/WebP in an <img>, everything else (Word, HEIC) is a download link. */
export function displayKind(mimeType: string): DisplayKind {
  const type = mimeType.trim().toLowerCase()
  if (type === 'application/pdf') return 'pdf'
  if (INLINE_IMAGES.has(type)) return 'image'
  return 'download'
}
