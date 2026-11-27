'use client'

import { useRef, type AnchorHTMLAttributes, type MouseEvent } from 'react'
import { claimClick } from '@/lib/idempotent-click'

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> & { href: string }

/**
 * A plain anchor (no router prefetch) that ignores repeat taps while one download is starting.
 * One quick double-click can no longer save the same file several times.
 */
export function IdempotentDownloadLink({ href, ...props }: Props) {
  const gate = useRef({ until: 0 })

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!claimClick(event, Date.now(), gate.current)) event.preventDefault()
  }

  return <a {...props} href={href} onClick={handleClick} />
}
