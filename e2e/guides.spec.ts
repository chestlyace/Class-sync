import { expect, test } from '@playwright/test'
import { EN, expectNoHorizontalScroll, PASSWORD, signUp, userPages } from './helpers'

/**
 * The in-app guides: the welcome tour starts by itself on a new account and never again once
 * closed, on any device (it is remembered on the account); Settings → Guides starts any guide,
 * which follows the user from page to page. English UI; one fresh lecturer per project, with the
 * guides on (the other scenarios turn them off).
 */
test('welcome tour, then the class-and-course guide from Settings', async ({
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

    await test.step('once closed, it does not come back, even in another browser', async () => {
      await page.reload()
      await page.waitForTimeout(1500)
      await expect(card).toHaveCount(0)
      // A second browser signed in to the same account: still no welcome tour.
      const other = await newUserPage({ locale: 'en-US' }, { guides: true })
      await other.goto('/sign-in')
      await other.getByLabel(EN.email, { exact: true }).fill(`e2e-${run}-guide@example.test`)
      await other.getByLabel(EN.password, { exact: true }).fill(PASSWORD)
      await other.getByRole('button', { name: 'Sign in', exact: true }).click()
      await expect(other).toHaveURL(/\/dashboard$/)
      await other.waitForTimeout(1500)
      await expect(other.getByTestId('guide-card')).toHaveCount(0)
    })

    await test.step('Settings lists the guides and starts one, which follows the user to the next page', async () => {
      // No Help button in the nav any more.
      await expect(page.getByRole('button', { name: 'Help and guides' })).toHaveCount(0)
      await page.goto('/settings')
      const guides = page.getByRole('region', { name: 'Guides' })
      await expect(guides.getByRole('button', { name: /Take attendance/ })).toBeVisible()
      await expect(guides.getByRole('button', { name: /Welcome tour.*Replay/ })).toBeVisible()
      await guides.getByRole('button', { name: /Create a class and a course/ }).click()
      await expect(page).toHaveURL(/\/dashboard$/)
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
