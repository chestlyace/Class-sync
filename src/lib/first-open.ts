import type { Role } from '@/server/core/context'
import type { PushSupport } from './push-client'

/**
 * Which first-open card the dashboard shows on this device. Students get notifications (or, on
 * iPhone/iPad Safari, the Home Screen steps that push needs first); lecturers get an install card,
 * since their only notification is a colleague joining a class (their switch is in Settings).
 */
export type CardKind = 'enable' | 'install-ios' | 'install' | null

/** localStorage key: "Not now" was pressed on this device, so the card never comes back. */
export const FIRST_OPEN_DISMISS_KEY = 'clasync:first-open-dismissed'

export function firstOpenCard(s: {
  role: Role
  support: PushSupport
  permission: NotificationPermission | 'unsupported'
  subscribed: boolean
  dismissed: boolean
  installed: boolean
  canPromptInstall: boolean
  ios: boolean
}): CardKind {
  if (s.dismissed) return null
  if (s.role === 'student') {
    if (s.support === 'needs-install') return 'install-ios'
    if (s.support === 'supported' && s.permission === 'default' && !s.subscribed) return 'enable'
    return null
  }
  if (s.installed) return null
  if (s.ios) return 'install-ios'
  if (s.canPromptInstall) return 'install'
  return null
}

/** Whether "Not now" was pressed on this device. Storage unavailable (private mode): not dismissed. */
export function readFirstOpenDismissed(): boolean {
  try {
    return window.localStorage.getItem(FIRST_OPEN_DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

/** Remembers "Not now" on this device. If storage is unavailable the card is only hidden for this visit. */
export function rememberFirstOpenDismissed(): void {
  try {
    window.localStorage.setItem(FIRST_OPEN_DISMISS_KEY, '1')
  } catch {
    // The caller hides the card anyway.
  }
}
