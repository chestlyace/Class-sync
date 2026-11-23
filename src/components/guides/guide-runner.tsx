'use client'

import { useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Role } from '@/server/core/context'
import { findVisible, GuideOverlay } from './guide-overlay'
import {
  adjacentStep,
  autoGuideFor,
  courseIdFrom,
  findGuide,
  hrefFor,
  onRoute,
  startOf,
  stepOnPage,
} from './guides'
import { addSeen, guidesOff, onGuideRequest, readSeen } from './guide-storage'

/** sessionStorage: the guide in progress, so a reload keeps the user's place. */
const ACTIVE_KEY = 'clasync:guide'
/** Pause before a first-visit guide starts, so the page has settled. */
const AUTO_START_MS = 700
/** Longest wait for a page the guide sent the user to, before showing the card again. */
const NAVIGATION_MS = 4000

type Active = { guideId: string; index: number; courseId: string | null; dir: 1 | -1 }

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode or full storage: the guide still works until the next reload.
  }
}


/**
 * Runs the in-app guides for the signed-in area: one guide at a time, kept across pages and
 * reloads; the welcome and course guides start by themselves the first time (unless `autoStart`
 * is off, e.g. while the email is unverified). Help (HelpButton) starts any guide again.
 *
 * Rendered next to the page, never around it: its state changes must not reach the page's
 * Suspense boundaries while they stream in and hydrate.
 */
export function GuideRunner({ role, userId, autoStart }: { role: Role; userId: string; autoStart: boolean }) {
  const t = useTranslations('guides')
  const pathname = usePathname()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [active, setActive] = useState<Active | null>(null)
  const [navigating, setNavigating] = useState(false)
  const lastCourse = useRef<string | null>(null)
  // Read by the first-visit timer: a guide started from Help meanwhile wins.
  const activeRef = useRef<Active | null>(null)
  useEffect(() => {
    activeRef.current = active
  }, [active])

  // Browser storage is only there after hydration.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reading browser storage once, after hydration */
    const saved = read<Active | null>(ACTIVE_KEY, null)
    const guide = saved && findGuide(saved.guideId)
    if (saved && guide && guide.role === role && saved.index >= 0 && saved.index < guide.steps.length) setActive(saved)
    setReady(true)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [userId, role])

  useEffect(() => {
    if (ready) write(ACTIVE_KEY, active)
  }, [ready, active])

  const guide = active ? findGuide(active.guideId) : undefined

  // The user moved: follow them to the step that lives on this page, if any.
  useEffect(() => {
    const courseId = courseIdFrom(pathname)
    if (courseId) lastCourse.current = courseId
    /* eslint-disable react-hooks/set-state-in-effect -- the route is outside React state: sync the guide to it */
    setNavigating(false)
    setActive((a) => {
      if (!a) return a
      const g = findGuide(a.guideId)
      if (!g) return null
      const index = stepOnPage(g, a.index, pathname)
      const next = { ...a, courseId: courseId ?? a.courseId }
      return index === null || index === a.index ? next : { ...next, index, dir: index > a.index ? 1 : -1 }
    })
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [pathname])

  // A navigation that never lands (an error, a slow network) must not leave the guide hidden.
  useEffect(() => {
    if (!navigating) return
    const timer = setTimeout(() => setNavigating(false), NAVIGATION_MS)
    return () => clearTimeout(timer)
  }, [navigating])

  const go = useCallback((to: string) => {
    setNavigating(true)
    router.push(to)
  }, [router])

  const start = useCallback(
    (guideId: string) => {
      const g = findGuide(guideId)
      if (!g || g.role !== role) return
      const { index, href } = startOf(g, pathname)
      setActive({ guideId, index, courseId: courseIdFrom(pathname) ?? lastCourse.current, dir: 1 })
      if (href) go(href)
    },
    [role, pathname, go],
  )

  // Help asks for a guide through a window event.
  const startRef = useRef(start)
  useEffect(() => {
    startRef.current = start
  }, [start])
  useEffect(() => onGuideRequest((id) => startRef.current(id)), [])

  // First visit to a page with its own guide: start it, once.
  useEffect(() => {
    if (!ready || !autoStart || active || guidesOff()) return
    const g = autoGuideFor(role, pathname, readSeen(userId))
    if (!g) return
    const timer = setTimeout(() => {
      if (!activeRef.current) start(g.id)
    }, AUTO_START_MS)
    return () => clearTimeout(timer)
    // Only on arriving at a page: not again when a guide just ended here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, autoStart, pathname])

  const end = useCallback(() => {
    if (active) addSeen(userId, active.guideId)
    setActive(null)
  }, [active, userId])

  const moveTo = useCallback(
    (index: number, dir: 1 | -1) => {
      if (!active || !guide) return
      if (index >= guide.steps.length) return end()
      if (index < 0) return
      const step = guide.steps[index]
      const courseId = active.courseId ?? lastCourse.current
      setActive({ ...active, index, dir, courseId })
      if (!onRoute(step.route, pathname)) {
        const href = hrefFor(step.route, courseId)
        if (href) go(href)
      }
    },
    [active, guide, pathname, end, go],
  )

  let overlay: React.ReactNode = null
  if (ready && active && guide && !navigating) {
    const step = guide.steps[active.index]
    const total = guide.steps.length
    const name = t(`items.${guide.id}.title`)
    const last = active.index === total - 1
    const here = onRoute(step.route, pathname)
    if (here) {
      const opens = step.action === 'open' && step.target
      overlay = (
        <GuideOverlay
          key={`${guide.id}:${step.id}:${pathname}`}
          stepKey={`${guide.id}:${step.id}:${pathname}`}
          target={step.target}
          eyebrow={name}
          progress={t('common.progress', { n: active.index + 1, total })}
          title={t(`items.${guide.id}.steps.${step.id}.title`)}
          body={t(`items.${guide.id}.steps.${step.id}.body`)}
          primary={{
            label: step.button
              ? t(`items.${guide.id}.steps.${step.id}.button`)
              : opens
                ? t('common.open')
                : last
                  ? t('common.done')
                  : t('common.next'),
            onClick: () => {
              const el = opens ? findVisible(step.target) : null
              if (el) {
                setNavigating(true)
                el.click()
              } else moveTo(adjacentStep(guide, active.index, 1), 1)
            },
          }}
          back={adjacentStep(guide, active.index, -1) >= 0 ? { label: t('common.back'), onClick: () => moveTo(adjacentStep(guide, active.index, -1), -1) } : undefined}
          end={end}
          endLabel={t('common.end')}
          onMissing={step.optional ? () => moveTo(adjacentStep(guide, active.index, active.dir), active.dir) : undefined}
        />
      )
    } else {
      // No step lives on this page: offer the way back, or ending the guide.
      const href = hrefFor(step.route, active.courseId)
      overlay = (
        <GuideOverlay
          key={`${guide.id}:away:${pathname}`}
          stepKey={`${guide.id}:away:${pathname}`}
          eyebrow={name}
          title={t('common.awayTitle')}
          body={href ? t('common.awayBody') : t('common.awayNoLink')}
          primary={href ? { label: t('common.goBack'), onClick: () => go(href) } : { label: t('common.endGuide'), onClick: end }}
          end={end}
          endLabel={t('common.end')}
        />
      )
    }
  }

  return overlay
}
