/**
 * Browser helpers for the installable app and push notifications. No React and no server code:
 * the Settings section and the first-open card pass their Server Actions in as `save`/`remove`.
 * Everything that touches `window`/`navigator` is safe to import during server rendering.
 */

export type PushSupport = 'supported' | 'needs-install' | 'unsupported'

/**
 * Whether this browser can take push notifications. Safari on iPhone/iPad only offers push to an
 * app added to the Home Screen, so there the answer is "install first".
 */
export function pushSupport(env: {
  hasServiceWorker: boolean
  hasPushManager: boolean
  isIos: boolean
  isStandalone: boolean
}): PushSupport {
  if (!env.hasServiceWorker) return 'unsupported'
  if (env.isIos && !env.isStandalone) return 'needs-install'
  return env.hasPushManager ? 'supported' : 'unsupported'
}

/** Running as the installed app (Home Screen or desktop app window), not in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS Safari's own flag for a Home Screen app.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** iPhone or iPad, including iPadOS, which reports itself as a Mac but has a touch screen. */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return true
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
}

/** This browser's current push subscription for Clasync, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    const registration = await navigator.serviceWorker.getRegistration('/')
    if (!registration?.pushManager) return null
    return await registration.pushManager.getSubscription()
  } catch {
    return null
  }
}

export type DeviceState = {
  support: PushSupport
  permission: NotificationPermission | 'unsupported'
  /** This browser holds a push subscription for Clasync. */
  subscribed: boolean
  /** Running as the installed app. */
  installed: boolean
  ios: boolean
}

/** Everything the Settings section and the first-open card need to know about this browser. Browser only. */
export async function readDeviceState(): Promise<DeviceState> {
  const ios = isIos()
  const installed = isStandalone()
  const support = pushSupport({
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    isIos: ios,
    isStandalone: installed,
  })
  const permission = 'Notification' in window ? Notification.permission : 'unsupported'
  const subscribed = support === 'supported' && (await currentSubscription()) !== null
  return { support, permission, subscribed, installed, ios }
}

/** A Server Action result that says it failed (`{ ok: false }`); anything else counts as saved. */
function isFailedResult(result: unknown): boolean {
  return typeof result === 'object' && result !== null && (result as { ok?: unknown }).ok === false
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false
  const x = new Uint8Array(a)
  return x.length === b.length && x.every((byte, i) => byte === b[i])
}

/**
 * Asks for permission, subscribes this browser and stores the subscription through `save`.
 * Call it straight from a click: browsers only show the permission prompt for a user gesture,
 * so nothing is awaited before the prompt. "denied" means the person (or the browser) said no;
 * a dismissed prompt, a missing key or any error is "failed".
 */
export async function turnOnPush(save: (input: unknown) => Promise<unknown>): Promise<'on' | 'denied' | 'failed'> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return 'failed'
  }
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!publicKey) return 'failed'

  let permission: NotificationPermission
  try {
    permission = await Notification.requestPermission()
  } catch {
    return 'failed'
  }
  if (permission === 'denied') return 'denied'
  if (permission !== 'granted') return 'failed'

  let subscription: PushSubscription | null = null
  try {
    const applicationServerKey = urlBase64ToUint8Array(publicKey)
    const registration = await navigator.serviceWorker.ready
    subscription = await registration.pushManager.getSubscription()
    // A subscription made with an older key can't receive anything from this server: replace it.
    if (subscription && !sameKey(subscription.options.applicationServerKey, applicationServerKey)) {
      await subscription.unsubscribe()
      subscription = null
    }
    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey as BufferSource,
    })
    const result = await save({ ...subscription.toJSON(), userAgent: navigator.userAgent })
    if (isFailedResult(result)) throw new Error('Subscription not saved')
    return 'on'
  } catch {
    // Not stored on the server: don't leave the browser subscribed to nothing.
    await subscription?.unsubscribe().catch(() => undefined)
    return 'failed'
  }
}

/**
 * Unsubscribes this browser, then tells the server through `remove`. Never throws: if the server
 * can't be told (offline), the push service answers the next send with "gone" and the server
 * deletes the subscription then.
 */
export async function turnOffPush(remove: (endpoint: string) => Promise<unknown>): Promise<void> {
  const subscription = await currentSubscription()
  if (!subscription) return
  const { endpoint } = subscription
  await subscription.unsubscribe().catch(() => undefined)
  try {
    await remove(endpoint)
  } catch {
    // See above: the next send cleans it up.
  }
}

/**
 * Which open window a notification tap should navigate: the first one on this origin that isn't
 * running a test (`/t/...`), since navigating it would wipe the test page. -1: open a new window.
 * public/sw.js carries a copy of this function; keep the two the same.
 */
export function pickClientToNavigate(clients: { url: string }[], origin: string): number {
  for (let i = 0; i < clients.length; i++) {
    let url: URL
    try {
      url = new URL(clients[i].url)
    } catch {
      continue
    }
    if (url.origin !== origin) continue
    if (url.pathname.startsWith('/t/')) continue
    return i
  }
  return -1
}

/** A base64url VAPID public key as the bytes `pushManager.subscribe` wants. */
export function urlBase64ToUint8Array(s: string): Uint8Array {
  const padding = '='.repeat((4 - (s.length % 4)) % 4)
  const base64 = (s + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Chrome's `beforeinstallprompt` event, kept so an "Install" button can show the prompt later. */
export type InstallPromptEvent = Event & {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Where the install prompt is kept: on `window`, so the early script below can store it too. */
const INSTALL_PROMPT_KEY = '__clasyncInstallPrompt'
type WindowWithPrompt = { [INSTALL_PROMPT_KEY]?: InstallPromptEvent | null }

/**
 * Inlined in the root layout's <head> (<InlineScript />), so the browser runs it while parsing the
 * HTML, before any Next.js or React code loads. Chrome can fire `beforeinstallprompt` before
 * <ServiceWorker />'s effect listens, and only once per page load. Plain ES5, no imports; it
 * stores the event where `storedInstallPrompt()` reads it.
 */
export const CAPTURE_INSTALL_PROMPT_SCRIPT = `(function(){var k=${JSON.stringify(INSTALL_PROMPT_KEY)};window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window[k]=e});window.addEventListener('appinstalled',function(){window[k]=null})})()`

const installPromptListeners = new Set<() => void>()

/** The install prompt the browser offered on this page load, if it hasn't been used or installed. */
export function storedInstallPrompt(): InstallPromptEvent | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as WindowWithPrompt)[INSTALL_PROMPT_KEY] ?? null
}

/** Kept by <ServiceWorker />; null once the app is installed or the prompt was used. */
export function rememberInstallPrompt(event: InstallPromptEvent | null): void {
  if (typeof window !== 'undefined') (window as unknown as WindowWithPrompt)[INSTALL_PROMPT_KEY] = event
  for (const listener of installPromptListeners) listener()
}

/** Called whenever the stored install prompt changes (it can arrive after a card has rendered). */
export function onInstallPromptChange(listener: () => void): () => void {
  installPromptListeners.add(listener)
  return () => {
    installPromptListeners.delete(listener)
  }
}
