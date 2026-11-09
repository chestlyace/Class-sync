import { expect, test, type Page } from '@playwright/test'
import { EN, expectNoHorizontalScroll, signUp, userPages } from './helpers'

/**
 * The dashboard's first-run checklist: every step links to where it is done and ticks off by
 * itself, the share step shows the student code, the card goes once everything is done, and a
 * user can hide it for good. English UI; three fresh users per project.
 */

function checklist(page: Page, title: string) {
  return page.getByRole('region', { name: title })
}

function step(page: Page, key: string) {
  return page.getByTestId(`setup-step-${key}`)
}

test('setup checklist for a new lecturer and a new student', async ({
  browser,
  baseURL,
  viewport,
  userAgent,
  isMobile,
  hasTouch,
  deviceScaleFactor,
}, testInfo) => {
  const run = `${Date.now().toString(36)}-${testInfo.project.name}`
  const emailOf = (who: string) => `e2e-${run}-${who}@example.test`
  const schoolName = `Onboarding School ${run}`
  const { newUserPage: newPage, closeAll } = userPages(browser, {
    baseURL,
    viewport,
    userAgent,
    isMobile,
    hasTouch,
    deviceScaleFactor,
  })

  try {
    const lecturer = await newPage({ locale: 'en-US', permissions: ['clipboard-read', 'clipboard-write'] })
    const card = checklist(lecturer, 'Set up your first class')
    let studentCode = ''

    await test.step('a new lecturer sees four steps, the first spelled out', async () => {
      await signUp(lecturer, { name: 'Grace Hopper', email: emailOf('l'), role: 'lecturer' }, EN)
      await expect(card).toBeVisible()
      await expect(card.getByText('Getting started · 0 of 4 done')).toBeVisible()
      await expect(card.getByRole('listitem')).toHaveCount(4)
      // The state is in the accessible text, not only in the icon.
      await expect(step(lecturer, 'school')).toContainText('Add your school (To do)')
      await expect(step(lecturer, 'school')).toHaveAttribute('aria-current', 'step')
      // The checklist replaces the empty-dashboard panel.
      await expect(lecturer.getByText('No classes yet')).toHaveCount(0)
      await expectNoHorizontalScroll(lecturer)
    })

    await test.step('school and class, from the checklist', async () => {
      await card.getByRole('link', { name: 'Add school' }).click()
      await expect(lecturer).toHaveURL(/\/schools\/new$/)
      await lecturer.getByLabel('School name', { exact: true }).fill(schoolName)
      await lecturer.getByLabel('Town', { exact: true }).fill('Buea')
      await lecturer.getByRole('button', { name: 'Add school', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/classes\/new\?schoolId=/)
      await lecturer.getByLabel('Class name', { exact: true }).fill('CS L3')
      await lecturer.getByRole('button', { name: 'Create class', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/classes\/[^/?]+$/)
      studentCode = (await lecturer.getByTestId('student-code').innerText()).trim()
    })

    await test.step('back on the dashboard: two done, the student code ready to share', async () => {
      await lecturer.goto('/dashboard')
      await expect(card.getByText('Getting started · 2 of 4 done')).toBeVisible()
      await expect(step(lecturer, 'school')).toContainText('(Done)')
      await expect(step(lecturer, 'class')).toContainText('(Done)')
      await expect(step(lecturer, 'course')).toHaveAttribute('aria-current', 'step')
      await expect(lecturer.getByTestId('setup-join-code')).toContainText(studentCode)
      await card.getByRole('button', { name: 'Copy the student code' }).click()
      expect(await lecturer.evaluate(() => navigator.clipboard.readText())).toBe(studentCode)
      // The link is the primary action: absolute, opening the join confirmation for this code.
      await card.getByRole('button', { name: 'Copy student link', exact: true }).click()
      expect(await lecturer.evaluate(() => navigator.clipboard.readText())).toMatch(
        new RegExp(`^https?://[^/]+/join\\?code=${studentCode}$`),
      )
      await expect(step(lecturer, 'share').getByRole('link', { name: 'Open class' })).toHaveAttribute(
        'href',
        /^\/classes\/[^/?]+$/,
      )
      await expectNoHorizontalScroll(lecturer)
    })

    await test.step('the course step opens the form on the class', async () => {
      await card.getByRole('link', { name: 'Create course' }).click()
      await expect(lecturer).toHaveURL(/\/courses\/new\?classId=/)
      await expect(lecturer.getByLabel('Class', { exact: true }).locator('option:checked')).toContainText('CS L3')
      await lecturer.getByLabel('Course title', { exact: true }).fill('Compilers')
      await lecturer.getByRole('button', { name: 'Create course', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/courses\/[^/?]+$/)
      await lecturer.goto('/dashboard')
      await expect(card.getByText('Getting started · 3 of 4 done')).toBeVisible()
      await expect(step(lecturer, 'share')).toHaveAttribute('aria-current', 'step')
    })

    const student = await newPage({ locale: 'en-US' })
    await test.step('a new student has one step, and it goes once they join', async () => {
      await signUp(student, { name: 'Sam Student', email: emailOf('s'), role: 'student' }, EN)
      const studentCard = checklist(student, 'Join your class')
      await expect(studentCard).toBeVisible()
      await expect(step(student, 'join')).toContainText('Join a class (To do)')
      await studentCard.getByRole('link', { name: 'Enter the code' }).click()
      await expect(student).toHaveURL(/\/join$/)
      await student.getByLabel('Class code', { exact: true }).fill(studentCode)
      await student.getByLabel('Matricule', { exact: true }).fill('UB24-001')
      await student.getByRole('button', { name: 'Join class', exact: true }).click()
      await expect(student).toHaveURL(/\/classes\/[^/?]+$/)
      await student.goto('/dashboard')
      await expect(student.getByRole('heading', { name: 'Hello, Sam' })).toBeVisible()
      await expect(student.getByTestId('setup-checklist')).toHaveCount(0)
    })

    await test.step('with a student in the class, the lecturer is all set', async () => {
      await lecturer.goto('/dashboard')
      await expect(lecturer.getByRole('heading', { name: 'Hello, Grace' })).toBeVisible()
      await expect(lecturer.getByTestId('setup-checklist')).toHaveCount(0)
    })

    const other = await newPage({ locale: 'en-US' })
    await test.step('the checklist can be hidden for good', async () => {
      await signUp(other, { name: 'Alan Turing', email: emailOf('o'), role: 'lecturer' }, EN)
      await expect(checklist(other, 'Set up your first class')).toBeVisible()
      await other.getByRole('button', { name: 'Hide the setup checklist' }).click()
      await expect(other.getByTestId('setup-checklist')).toHaveCount(0)
      // Without the checklist, the empty dashboard says what to do instead.
      await expect(other.getByText('No classes yet')).toBeVisible()
      await other.reload()
      await expect(other.getByRole('heading', { name: 'Hello, Alan' })).toBeVisible()
      await expect(other.getByTestId('setup-checklist')).toHaveCount(0)
    })
  } finally {
    await closeAll()
  }
})
