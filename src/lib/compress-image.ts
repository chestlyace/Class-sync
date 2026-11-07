/** Images bigger than this are re-encoded before upload (phone photos are often 3–8 MB). */
export const COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024
/** The longest side of a compressed image, in pixels. */
export const MAX_DIMENSION = 2000
export const JPEG_QUALITY = 0.82

/** Types a browser can draw on a canvas. HEIC/HEIF can't be decoded by most browsers, so they go as is. */
const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** True for a JPEG, PNG or WebP over the threshold. Pure, so it is unit-tested. */
export function shouldCompress(file: { type: string; size: number }): boolean {
  if (!Number.isFinite(file.size)) return false
  return COMPRESSIBLE.has(file.type.trim().toLowerCase()) && file.size > COMPRESS_THRESHOLD_BYTES
}

/** "photo.png" → "photo.jpg" (the compressed file is always a JPEG). */
function jpegName(name: string): string {
  const dot = name.lastIndexOf('.')
  return `${dot > 0 ? name.slice(0, dot) : name}.jpg`
}

/**
 * Browser only. Re-encodes a large image as a JPEG at most MAX_DIMENSION px on its longest side.
 * Returns the original file when compression doesn't apply, fails (e.g. a corrupt image) or
 * doesn't make the file smaller.
 */
export async function compressImage(file: File): Promise<File> {
  if (!shouldCompress(file)) return file
  try {
    // Applies the EXIF orientation, so phone photos keep their rotation.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return file
    }
    // JPEG has no transparency: transparent PNG areas become white, not black.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file
  }
}
