import { expect, test } from '@playwright/test'
import { EN, expectNoHorizontalScroll, signUp, userPages } from './helpers'

/**
 * The in-app guides: the welcome tour starts by itself on a new account and never again once
 * closed; Help starts any guide, which follows the user from page to page. English UI; one fresh
 * lecturer per project, with the guides on (the other scenarios turn them off).
 */
test('welcome tour, then the class-and-course guide from Help', async ({
  browser,
  baseURL,
  viewport,
  userAgent,
  isMobile,
  hasTouch,
  deviceScaleFactor,
}, testInfo) => {
  const run = `${Date.now().toString(36)}-${testInfo.project.name}`
  const { newUserPage, closeAll } = userPages(browser, { baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor })

  try {
    const page = await newUserPage({ locale: 'en-US' }, { guides: true })
    const card = page.getByTestId('guide-card')

    await test.step('the welcome tour starts by itself and walks through the dashboard', async () => {
      await signUp(page, { name: 'Ada Lovelace', email: `e2e-${run}-guide@example.test`, role: 'lecturer' }, EN)
      await expect(card.getByRole('heading', { name: 'Welcome to Clasync' })).toBeVisible()
      await expect(card).toContainText('1 of 5')
      await card.getByRole('button', { name: 'Next' }).click()
      await expect(card.getByRole('heading', { name: 'Your menu' })).toBeVisible()
      await expectNoHorizontalScroll(page)
      await card.getByRole('button', { name: 'Back' }).click()
      await expect(card.getByRole('heading', { name: 'Welcome to Clasync' })).toBeVisible()
      await card.getByRole('button', { name: 'End the guide' }).click()
      await expect(card).toHaveCount(0)
    })

    await test.step('once closed, it does not come back', async () => {
      await page.reload()
      await page.waitForTimeout(1500)
      await expect(card).toHaveCount(0)
    })

    await test.step('Help lists the guides and starts one, which follows the user to the next page', async () => {
      await page.getByRole('button', { name: 'Help and guides' }).click()
      const dialog = page.getByRole('dialog', { name: 'Guides' })
      await expect(dialog.getByRole('button', { name: /Take attendance/ })).toBeVisible()
      await dialog.getByRole('button', { name: /Create a class and a course/ }).click()
      await expect(card.getByRole('heading', { name: 'Open New class' })).toBeVisible()
      await card.getByRole('button', { name: 'Open it' }).click()
      await expect(page).toHaveURL(/\/classes\/new$/)
      await expect(card.getByRole('heading', { name: 'Pick the school, then name the class' })).toBeVisible()
      await expectNoHorizontalScroll(page)
    })

    await test.step('Escape ends the guide', async () => {
      await page.keyboard.press('Escape')
      await expect(card).toHaveCount(0)
    })
  } finally {
    await closeAll()
  }
})
