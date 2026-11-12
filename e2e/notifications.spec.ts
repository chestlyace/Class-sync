import { expect, test, type Page } from '@playwright/test'
import { EN, expectNoHorizontalScroll, signUp, userPages } from './helpers'

/**
 * Notifications in the app: the Settings section and the dashboard's first-open card. Real
 * delivery can't be tested here (no push service, no VAPID keys); this checks what renders and
 * that "Not now" is remembered on the device. English UI, one fresh student per test and project.
 */

/** Headless browsers differ on the starting notification permission: pin the usual "not asked yet". */
async function permissionNotAskedYet(page: Page) {
  await page.addInitScript(() => {
    if ('Notification' in window) Object.defineProperty(Notification, 'permission', { get: () => 'default' })
  })
}

function runId(projectName: string) {
  return `${Date.now().toString(36)}-${projectName}`
}

test('settings shows the notifications section', async ({
  browser,
  baseURL,
  viewport,
  userAgent,
  isMobile,
  hasTouch,
  deviceScaleFactor,
}, testInfo) => {
  const run = runId(testInfo.project.name)
  const { newUserPage, closeAll } = userPages(browser, { baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor })
  try {
    const student = await newUserPage({ locale: 'en-US' })
    await permissionNotAskedYet(student)
    await signUp(student, { name: 'Ada Lovelace', email: `e2e-${run}-ns@example.test`, role: 'student' }, EN)

    await student.goto('/settings')
    const section = student.getByRole('region', { name: 'Notifications and app' })
    await expect(section).toBeVisible()
    const device = section.getByRole('region', { name: 'This device' })
    await expect(device.getByText('Notifications are off for this device.')).toBeVisible()
    await expect(device.getByRole('button', { name: 'Turn on' })).toBeVisible()
    // No device yet, so nothing to send a test to.
    await expect(section.getByRole('button', { name: 'Send a test notification' })).toHaveCount(0)
    const devices = section.getByRole('region', { name: 'Devices with notifications on' })
    await expect(devices.getByText('No device yet.')).toBeVisible()
    await expect(section.getByRole('region', { name: 'Install the app' })).toBeVisible()
    await expectNoHorizontalScroll(student)
  } finally {
    await closeAll()
  }
})

test("first-open card's Not now sticks after reload", async ({
  browser,
  baseURL,
  viewport,
  userAgent,
  isMobile,
  hasTouch,
  deviceScaleFactor,
}, testInfo) => {
  const run = runId(testInfo.project.name)
  const { newUserPage, closeAll } = userPages(browser, { baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor })
  try {
    const student = await newUserPage({ locale: 'en-US' })
    await permissionNotAskedYet(student)
    await signUp(student, { name: 'Katherine Johnson', email: `e2e-${run}-nc@example.test`, role: 'student' }, EN)

    const card = student.getByRole('region', { name: 'Turn on notifications' })
    await expect(card).toBeVisible()
    await expect(card.getByText('Get notified when your lecturer opens check-in, posts work or releases results.')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Turn on' })).toBeVisible()
    await expectNoHorizontalScroll(student)

    await card.getByRole('button', { name: 'Not now' }).click()
    await expect(student.getByTestId('first-open-card')).toHaveCount(0)
    expect(await student.evaluate(() => localStorage.getItem('clasync:first-open-dismissed'))).toBe('1')

    await student.reload()
    await expect(student.getByRole('heading', { name: 'Hello, Katherine' })).toBeVisible()
    // The card is decided after hydration: give it the chance to (wrongly) appear first.
    await student.waitForLoadState('networkidle')
    await expect(student.getByTestId('first-open-card')).toHaveCount(0)
    // Settings stays available.
    await student.goto('/settings')
    await expect(student.getByRole('region', { name: 'Notifications and app' })).toBeVisible()
  } finally {
    await closeAll()
  }
})
