/** Stagger position for a `data-reveal-item` child of `<Reveal>`. */
export function revealIndex(index: number): React.CSSProperties {
  return { '--reveal-index': index } as React.CSSProperties
}
