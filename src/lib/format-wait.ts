/** "1:05" for 65 seconds: how a countdown to "Send again" reads. */
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
