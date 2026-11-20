/**
 * Compares the two password fields as people see them: canonically equivalent Unicode
 * (for example a composed `é` and an `e` followed by a combining accent) counts as the same
 * password. The value sent to the server is still exactly what the user typed in the first field.
 */
export function passwordsMatch(a: string, b: string): boolean {
  return a.normalize('NFC') === b.normalize('NFC')
}
