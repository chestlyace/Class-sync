import { expect, test } from '@playwright/test'

/** The signed-out landing page, in both languages, without sideways scrolling on a phone. */

test('landing page reads in English and links to sign-up', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Attendance, assignments, marks. In one place.')
  await expect(page.getByRole('heading', { name: 'A code that changes every minute' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Start as a lecturer' })).toHaveAttribute('href', '/sign-up')

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0)
})

test('landing page reads in French', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'fr', url: baseURL! }])
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Présences, devoirs, notes. Au même endroit.')
  await expect(page.getByRole('heading', { name: 'Un code qui change chaque minute' })).toBeVisible()
})
