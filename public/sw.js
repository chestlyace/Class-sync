/* Clasync service worker: push notifications and an offline page. Plain JavaScript, served
 * uncached (next.config.ts). Nothing but /offline is ever cached: signed-in pages are never stored.
 * Payloads arrive as JSON { title, body, url, tag, kind } with `url` a path on this site. */

const OFFLINE_CACHE = 'clasync-offline-v1'
const OFFLINE_URL = '/offline'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      // A failed precache must not stop the worker installing: notifications matter more.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== OFFLINE_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

// Page loads only: straight to the network, and the offline page when the network fails.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE_URL).then((cached) => cached || Response.error()),
    ),
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
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
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
