/* Clasync service worker: push notifications and an offline page. Plain JavaScript, served
 * uncached (next.config.ts). Nothing but /offline is ever cached: signed-in pages are never stored.
 * Payloads arrive as JSON { title, body, url, tag, kind } with `url` a path on this site. */

// Bump the version whenever /offline changes: older caches are deleted on activate.
const OFFLINE_CACHE = 'clasync-offline-v2'
const OFFLINE_URL = '/offline'

/** Fetches /offline into the current cache. Best effort: a failure never stops the worker. */
function cacheOfflinePage() {
  return caches
    .open(OFFLINE_CACHE)
    .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
    .catch(() => undefined)
}

self.addEventListener('install', (event) => {
  // A failed precache must not stop the worker installing: notifications matter more.
  event.waitUntil(cacheOfflinePage().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((key) => key !== OFFLINE_CACHE).map((key) => caches.delete(key)))),
      // Again on activate, so the offline page never outlives a deploy.
      cacheOfflinePage(),
      // Page loads start while the worker boots, instead of waiting for it.
      self.registration.navigationPreload
        ? self.registration.navigationPreload.enable().catch(() => undefined)
        : Promise.resolve(),
    ])
      .catch(() => undefined)
      .then(() => self.clients.claim()),
  )
})

// Page loads only: straight to the network (the preloaded response when there is one), and the
// offline page when the network fails.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse
        return preloaded || (await fetch(event.request))
      } catch {
        const cached = await caches.match(OFFLINE_URL)
        return cached || Response.error()
      }
    })(),
  )
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Clasync'
  const tag = typeof data.tag === 'string' && data.tag ? data.tag : undefined
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag,
      // A replacement with the same tag alerts again instead of arriving silently. Only with a
      // tag: Chrome throws when renotify is set without one.
      renotify: tag !== undefined,
      data: { url: typeof data.url === 'string' ? data.url : '/dashboard' },
    }),
  )
})

// Copy of pickClientToNavigate in src/lib/push-client.ts (tested there); keep the two the same.
function pickClientToNavigate(clients, origin) {
  for (let i = 0; i < clients.length; i++) {
    let url
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const origin = self.location.origin
  let target
  try {
    target = new URL((event.notification.data && event.notification.data.url) || '/dashboard', origin)
  } catch {
    return
  }
  // Only ever follow a path on this site.
  if (target.origin !== origin) return
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const index = pickClientToNavigate(windows, origin)
      if (index === -1) return self.clients.openWindow(target.href)
      const client = windows[index]
      return client
        .focus()
        .then((focused) => (focused || client).navigate(target.href))
        .catch(() => self.clients.openWindow(target.href))
    }),
  )
})

// The browser renewed the subscription: subscribe again with the same key and tell the server.
// Known limitation: the POST needs a signed-in session cookie. With an expired session it is
// refused, the old endpoint is reported gone on the next send and deleted, and this device stays
// off until the person signs in and turns notifications on again (Settings shows it as off).
self.addEventListener('pushsubscriptionchange', (event) => {
  const oldOptions = event.oldSubscription ? event.oldSubscription.options : null
  const applicationServerKey = oldOptions ? oldOptions.applicationServerKey : null
  event.waitUntil(
    (event.newSubscription
      ? Promise.resolve(event.newSubscription)
      : applicationServerKey
        ? self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
        : Promise.resolve(null)
    )
      .then((subscription) => {
        if (!subscription) return undefined
        return fetch('/api/push/subscription', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign(subscription.toJSON(), { userAgent: self.navigator.userAgent })),
        })
      })
      .catch(() => undefined),
  )
})
