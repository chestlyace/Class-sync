import { createTranslator } from 'next-intl'
import { config } from '@/server/core/config'
import type { Locale } from '@/server/core/context'
import en from '../../../messages/en.json'
import fr from '../../../messages/fr.json'

const allMessages = { en, fr } as const

export type PushKind =
  | 'checkInOpened'
  | 'checkOutOpened'
  | 'testStarted'
  | 'notesAdded'
  | 'topicReleased'
  | 'assignmentPublished'
  | 'assignmentReminder'
  | 'gradesReleased'
  | 'testResultsReleased'
  | 'colleagueJoinedClass'
  | 'test'

export type PushPayload = { title: string; body: string; url: string; tag: string; kind: PushKind }

export type PushVars = {
  url: string
  /**
   * A newer notification with the same tag replaces the older one on the device, so it is one
   * per event (e.g. `assignment-<id>`): distinct notifications must never share a tag.
   */
  tag: string
  courseTitle?: string
  assignmentTitle?: string
  testTitle?: string
  itemTitle?: string
  topicTitle?: string
  className?: string
  colleagueName?: string
  closesAt?: Date
  dueAt?: Date
}

const VAR_MAX = 150

/** Titles are user input: keep them on one line and bounded. */
function singleLine(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, VAR_MAX)
}

function formatTime(date: Date | undefined, locale: Locale): string {
  if (!date) return ''
  return new Intl.DateTimeFormat(locale, {
    timeZone: config.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

function formatDate(date: Date | undefined, locale: Locale): string {
  if (!date) return ''
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
    timeZone: config.timeZone,
    day: 'numeric',
    month: 'short',
  }).format(date)
}

/** Localized, mark-free text for one push notification. `url` must be an in-app path. */
export function pushPayload(kind: PushKind, locale: Locale, vars: PushVars): PushPayload {
  if (!vars.url.startsWith('/') || vars.url.startsWith('//')) {
    throw new Error(`pushPayload: url must be an in-app path, got "${vars.url}"`)
  }
  const t = createTranslator({ locale, messages: allMessages[locale], namespace: 'push' })
  const body = t(kind, {
    time: formatTime(vars.closesAt, locale),
    date: formatDate(vars.dueAt, locale),
    test: singleLine(vars.testTitle),
    assignment: singleLine(vars.assignmentTitle),
    item: singleLine(vars.itemTitle),
    topic: singleLine(vars.topicTitle),
    class: singleLine(vars.className),
    colleague: singleLine(vars.colleagueName),
  })
  const title =
    kind === 'test'
      ? 'Clasync'
      : kind === 'colleagueJoinedClass'
        ? singleLine(vars.className)
        : singleLine(vars.courseTitle)
  return { title, body, url: vars.url, tag: vars.tag, kind }
}
