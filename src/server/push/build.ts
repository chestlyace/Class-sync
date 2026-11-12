import type { PushItem } from './send'

/**
 * Builds push items without ever throwing: the action that triggered them has already taken
 * effect, so a failure here (e.g. while formatting text) is logged and nothing is pushed.
 */
export function safePushItems(context: string, build: () => PushItem[]): PushItem[] {
  try {
    return build()
  } catch (error) {
    console.error(`[${context}] could not prepare push notifications`, error)
    return []
  }
}
