'use client'

import { X } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** How long a step waits for its target to appear (pages stream in) before giving up on it. */
const SEARCH_MS = 1500
const MARGIN = 12
const GAP = 12
const PAD = 6

type Box = { top: number; left: number; width: number; height: number }

/** The first element matching the selector that is actually on screen (the top nav hides on phones, the bottom one on desktop). */
export function findVisible(selector: string | undefined): HTMLElement | null {
  if (!selector) return null
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el
  }
  return null
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), Math.max(min, max))
}

/** Below the target if it fits, else above, else pinned to the side of the screen away from it. */
function placeCard(target: Box | null, card: { width: number; height: number }, vw: number, vh: number) {
  if (!target) return { left: (vw - card.width) / 2, top: Math.max(MARGIN, (vh - card.height) / 2) }
  const left = clamp(target.left + target.width / 2 - card.width / 2, MARGIN, vw - card.width - MARGIN)
  const below = target.top + target.height + PAD + GAP
  if (below + card.height <= vh - MARGIN) return { left, top: below }
  const above = target.top - PAD - GAP - card.height
  if (above >= MARGIN) return { left, top: above }
  return { left, top: target.top + target.height / 2 > vh / 2 ? MARGIN : vh - card.height - MARGIN }
}

export type CardButton = { label: string; onClick: () => void }

/**
 * One step on screen: the page dimmed around the element it is about (which stays clickable),
 * and a card next to it. With no element, or when it never shows up, the card sits in the middle.
 * `onMissing` is called once when the element did not appear in time.
 */
export function GuideOverlay({
  stepKey,
  target,
  eyebrow,
  progress,
  title,
  body,
  primary,
  back,
  end,
  endLabel,
  onMissing,
}: {
  /** Changes with each step: the search for the element and the focus start over. Render with `key={stepKey}` too, so its state resets. */
  stepKey: string
  target?: string
  /** The guide's name. */
  eyebrow: string
  /** e.g. "2 of 5", kept on one line next to the name. */
  progress?: string
  title: string
  body: string
  primary: CardButton
  back?: CardButton
  end: () => void
  endLabel: string
  onMissing?: () => void
}) {
  const titleId = useId()
  const bodyId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null)
  const [searching, setSearching] = useState(Boolean(target))
  const onMissingRef = useRef(onMissing)
  useLayoutEffect(() => {
    onMissingRef.current = onMissing
  })

  // Follow the element every frame: it can scroll, move as the page streams in, or appear late.
  useEffect(() => {
    const startedAt = performance.now()
    let frame = 0
    let last: Box | null = null
    let lastPos: { top: number; left: number } | null = null
    let scrolled = false
    let gaveUp = false

    const tick = () => {
      const el = findVisible(target)
      let next: Box | null = null
      if (el) {
        if (!scrolled) {
          scrolled = true
          const r = el.getBoundingClientRect()
          if (r.top < 80 || r.bottom > window.innerHeight - 80) {
            const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
            // A tall section shows from its top, just under the sticky nav; anything else, centred.
            if (r.height > window.innerHeight * 0.6) window.scrollBy({ top: r.top - 96, behavior })
            else el.scrollIntoView({ block: 'center', behavior })
          }
        }
        const r = el.getBoundingClientRect()
        next = { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) }
        setSearching(false)
      } else if (target && !gaveUp && performance.now() - startedAt > SEARCH_MS) {
        gaveUp = true
        setSearching(false)
        onMissingRef.current?.()
      }
      if (!sameBox(next, last)) {
        last = next
        setBox(next)
      }
      const card = cardRef.current
      if (card) {
        const pos = placeCard(next, { width: card.offsetWidth, height: card.offsetHeight }, window.innerWidth, window.innerHeight)
        const rounded = { top: Math.round(pos.top), left: Math.round(pos.left) }
        if (!lastPos || lastPos.top !== rounded.top || lastPos.left !== rounded.left) {
          lastPos = rounded
          setCardPos(rounded)
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [stepKey, target])

  // Each step takes the focus, so keyboard and screen reader users land on it.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true })
  }, [stepKey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // A dialog the user opened from the page closes first.
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return
      end()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [end])

  // While still looking for the element, show nothing rather than a card that jumps.
  const hidden = searching || !cardPos

  return createPortal(
    <div data-guide-overlay="" className="pointer-events-none fixed inset-0 z-[45]">
      {box ? (
        <div
          aria-hidden="true"
          className="absolute rounded-2xl ring-2 ring-primary transition-[top,left,width,height] duration-200 ease-out motion-reduce:transition-none"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
            boxShadow: '0 0 0 200vmax rgb(0 0 0 / 0.5)',
          }}
        />
      ) : (
        !searching && <div aria-hidden="true" className="absolute inset-0 bg-black/50" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        data-testid="guide-card"
        className={cn(
          'pointer-events-auto absolute flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-3 rounded-3xl border bg-popover p-5 text-popover-foreground shadow-lg outline-none transition-[opacity,top,left] duration-200 ease-out motion-reduce:transition-none',
          hidden && 'opacity-0',
        )}
        style={cardPos ?? { top: 0, left: 0 }}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="flex min-w-0 flex-wrap gap-x-2 pt-1 font-mono text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase">
            <span>{eyebrow}</span>
            {progress && <span className="whitespace-nowrap">· {progress}</span>}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={end}
            aria-label={endLabel}
            title={endLabel}
            className="-mt-2 -mr-2 text-muted-foreground"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <h2 id={titleId} className="text-lg leading-snug font-semibold text-pretty">
          {title}
        </h2>
        <p id={bodyId} className="text-sm text-muted-foreground text-pretty">
          {body}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {back && (
            <Button type="button" variant="outline" onClick={back.onClick}>
              {back.label}
            </Button>
          )}
          <Button type="button" onClick={primary.onClick}>
            {primary.label}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
