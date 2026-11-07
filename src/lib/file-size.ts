/** "840 KB", "2.4 MB"; in French "840 Ko", "2,4 Mo". */
export function formatFileSize(bytes: number, locale: string): string {
  const units = locale.startsWith('fr') ? (['o', 'Ko', 'Mo'] as const) : (['B', 'KB', 'MB'] as const)
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`
}
