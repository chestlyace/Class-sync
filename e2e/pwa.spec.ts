import { expect, test } from '@playwright/test'

/** The installable app: manifest and icons, the service worker, and the offline page. */

test('serves the manifest', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest')
  expect(res.status()).toBe(200)
  const manifest = await res.json()
  expect(manifest).toMatchObject({
    name: 'Clasync',
    short_name: 'Clasync',
    id: '/',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
  })
  expect(manifest.icons.map((icon: { purpose: string }) => icon.purpose)).toEqual(['any', 'any', 'maskable'])
  for (const src of [...manifest.icons.map((icon: { src: string }) => icon.src), '/icons/badge-96.png']) {
    const icon = await request.get(src)
    expect(icon.status(), src).toBe(200)
    expect(icon.headers()['content-type'], src).toBe('image/png')
  }
})

test('registers the service worker on the landing page', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')
  const scriptURL = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    return registration.active?.scriptURL ?? null
  })
  expect(scriptURL).toMatch(/\/sw\.js$/)
})

test('sw.js is served uncached', async ({ request }) => {
  const res = await request.get('/sw.js')
  expect(res.status()).toBe(200)
  expect(res.headers()['cache-control']).toContain('no-store')
  expect(res.headers()['content-type']).toContain('application/javascript')
})

test('offline page renders', async ({ page }) => {
  const res = await page.goto('/offline')
  expect(res?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("You're offline")
  await expect(page.getByRole('link', { name: 'Try again' })).toBeVisible()
})
