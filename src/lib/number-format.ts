/** A mark, max mark or weight in the reader's language: "15.5" in English, "15,5" in French. */
export function formatDecimal(value: number, locale: string): string {
  return new Intl.NumberFormat(locale.startsWith('fr') ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 2 }).format(value)
}
