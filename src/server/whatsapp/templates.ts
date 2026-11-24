import { config } from '@/server/core/config'
import type { Locale } from '@/server/core/context'
import type { WhatsAppKind } from '@/server/db/schema'
import type { TemplateMessage } from './provider'

/** What each kind of template needs. Button paths match the student-facing links the push notifications use. */
export type TemplateData = {
  checkinOpen: { courseTitle: string; closesAt: Date }
  testStarted: { testTitle: string; courseTitle: string; code: string }
  resultsReleased:
    | { source: 'assignment'; itemTitle: string; courseTitle: string; assignmentId: string }
    | { source: 'test'; itemTitle: string; courseTitle: string; code: string }
  assignmentPublished: { courseTitle: string; assignmentTitle: string; dueAt: Date; assignmentId: string }
  classSoonLecturer: { courseTitle: string; startsAt: Date; sittingKey: string }
}

const PARAM_MAX = 150

/** Template parameters may not hold line breaks or tabs; titles are user input, so keep them on one line and bounded. */
function param(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, PARAM_MAX)
}

function formatTime(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: config.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

/** Weekday, day, month and time, e.g. "Mon 16 Nov, 14:30" / "lun. 16 nov., 14:30". */
function formatDue(date: Date, locale: Locale): string {
  const day = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
    timeZone: config.timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date)
  return `${day}, ${formatTime(date, locale)}`
}

const path = (...parts: string[]) => parts.map((p, i) => (i === 0 ? p : encodeURIComponent(p))).join('/')

/** The approved template (name, language, body parameters and button path) for one alert. */
export function buildTemplate<K extends WhatsAppKind>(kind: K, data: TemplateData[K], locale: Locale): TemplateMessage
export function buildTemplate(kind: WhatsAppKind, data: TemplateData[WhatsAppKind], locale: Locale): TemplateMessage {
  switch (kind) {
    case 'checkinOpen': {
      const d = data as TemplateData['checkinOpen']
      return {
        name: 'checkin_open',
        language: locale,
        bodyParams: [param(d.courseTitle), formatTime(d.closesAt, locale)],
        buttonPath: 'check-in',
      }
    }
    case 'testStarted': {
      const d = data as TemplateData['testStarted']
      return {
        name: 'test_started',
        language: locale,
        bodyParams: [param(d.testTitle), param(d.courseTitle)],
        buttonPath: path('t', d.code),
      }
    }
    case 'resultsReleased': {
      const d = data as TemplateData['resultsReleased']
      return {
        name: 'results_released',
        language: locale,
        bodyParams: [param(d.itemTitle), param(d.courseTitle)],
        buttonPath: d.source === 'assignment' ? path('assignments', d.assignmentId) : path('t', d.code),
      }
    }
    case 'assignmentPublished': {
      const d = data as TemplateData['assignmentPublished']
      return {
        name: 'assignment_published',
        language: locale,
        bodyParams: [param(d.courseTitle), param(d.assignmentTitle), formatDue(d.dueAt, locale)],
        buttonPath: path('assignments', d.assignmentId),
      }
    }
    case 'classSoonLecturer': {
      const d = data as TemplateData['classSoonLecturer']
      return {
        name: 'class_soon_lecturer',
        language: locale,
        bodyParams: [param(d.courseTitle), formatTime(d.startsAt, locale)],
        buttonPath: path('schedule', 'class', d.sittingKey),
      }
    }
  }
}
