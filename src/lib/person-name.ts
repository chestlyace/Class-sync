/** Titles people put before their name in English and French, compared without dots or case. */
const TITLES = new Set(['dr', 'prof', 'pr', 'mr', 'mrs', 'ms', 'miss', 'mme', 'mlle', 'sir', 'rev', 'engr'])

function isTitle(word: string): boolean {
  return TITLES.has(word.replace(/\./g, '').toLowerCase())
}

/** The words of a name without any leading titles ("Dr. Achille Ebai" → Achille, Ebai). Keeps them all if every word is a title. */
function nameWords(name: string): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const firstReal = words.findIndex((w) => !isTitle(w))
  return firstReal === -1 ? words : words.slice(firstReal)
}

/** The name to greet someone by: their first name, skipping a title like "Dr." */
export function firstName(name: string): string {
  return nameWords(name)[0] ?? name
}

/** Two-letter avatar initials from the first and last words, skipping a title. */
export function initials(name: string): string {
  const words = nameWords(name)
  const letters = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words
  return letters.map((w) => w[0]!.toUpperCase()).join('') || '?'
}
