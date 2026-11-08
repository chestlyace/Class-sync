'use client'

import { useEffect, useRef } from 'react'

/**
 * Fades its `data-reveal-item` children up, one after another, the first time it scrolls into view.
 * Server-rendered content stays visible: only blocks still below the fold are hidden, and only once
 * this has run. Reduced motion keeps a short fade without movement (globals.css).
 */
export function Reveal({ className, children, ...props }: React.ComponentProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    if (node.getBoundingClientRect().top < window.innerHeight * 0.92) return

    node.dataset.reveal = 'hidden'
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        node.dataset.reveal = 'shown'
        observer.disconnect()
      },
      { rootMargin: '0px 0px -12% 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className={className} {...props}>
      {children}
    </div>
  )
}
