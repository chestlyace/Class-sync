import { expect, test, type Page } from '@playwright/test'
import {
  createCourse,
  createSchoolAndClass,
  EN,
  expectNoHorizontalScroll,
  joinClassAsStudent,
  signUp,
  userPages,
} from './helpers'

/**
 * Attendance, end to end: a lecturer runs a session with "Require students on campus" and a rotating
 * code; one student checks in from campus, another is refused from 2 km away; the lecturer overrides.
 * One serial scenario per project (desktop, then 360 px mobile), with three fresh users each.
 *
 * Everyone works in English except the final look at the student's course page, in French.
 * Geolocation is emulated per browser context: the lecturer creates the school at the campus point.
 */

const CAMPUS = { latitude: 4.1527, longitude: 9.241 }
/** About 2 km north of the campus, far beyond the default 500 m radius. */
const TWO_KM_NORTH = { latitude: 4.1707, longitude: 9.241 }

const CODE = /^[A-Z0-9]{6}$/

/** The code on the lecturer's screen: waits until it is a real code, not the placeholder dashes. */
async function readLiveCode(lecturer: Page): Promise<string> {
  const code = lecturer.getByTestId('attendance-code')
  await expect(code).toHaveText(CODE)
  return (await code.innerText()).trim()
}

/** Student side: enter a code on /check-in and submit. */
async function submitCode(student: Page, code: string) {
  await student.goto('/check-in')
  await student.getByLabel('Code on the screen', { exact: true }).fill(code)
  await student.getByRole('button', { name: 'Check in', exact: true }).click()
}

test('attendance with a rotating code and a campus check, end to end', async ({
  browser,
  baseURL,
  viewport,
  userAgent,
  isMobile,
  hasTouch,
  deviceScaleFactor,
}, testInfo) => {
  const run = `${Date.now().toString(36)}-${testInfo.project.name}`
  const emailOf = (who: string) => `e2e-att-${run}-${who}@example.test`
  const courseTitle = 'Operating Systems'

  const { newUserPage, closeAll } = userPages(browser, {
    baseURL,
    viewport,
    userAgent,
    isMobile,
    hasTouch,
    deviceScaleFactor,
  })

  try {
    const lecturer = await newUserPage({
      locale: 'en-US',
      permissions: ['geolocation'],
      geolocation: CAMPUS,
    })
    const alice = await newUserPage({ locale: 'en-US', permissions: ['geolocation'], geolocation: CAMPUS })
    const bob = await newUserPage({ locale: 'en-US', permissions: ['geolocation'], geolocation: TWO_KM_NORTH })

    let courseUrl = ''
    let sessionUrl = ''

    // ---- 1. Set-up: school at the campus point, class, course, two students --------------------
    await test.step('lecturer creates a school at the campus, a class and a course', async () => {
      await signUp(lecturer, { name: 'Lea Lecturer', email: emailOf('lecturer'), role: 'lecturer' }, EN)
      const { classUrl, studentCode } = await createSchoolAndClass(lecturer, {
        schoolName: `Campus Test ${run}`,
        town: 'Douala',
        className: 'HND 1 NET',
        lat: CAMPUS.latitude,
        lng: CAMPUS.longitude,
      })
      courseUrl = await createCourse(lecturer, courseTitle)

      await signUp(alice, { name: 'Alice Mbarga', email: emailOf('alice'), role: 'student' }, EN)
      await joinClassAsStudent(alice, classUrl, studentCode, 'att 001')
      await signUp(bob, { name: 'Bob Nkoulou', email: emailOf('bob'), role: 'student' }, EN)
      await joinClassAsStudent(bob, classUrl, studentCode, 'att 002')
    })

    // ---- 2. Lecturer starts a session that requires being on campus ---------------------------
    await test.step('lecturer starts a campus-only session and opens the start check-in', async () => {
      await lecturer.goto(courseUrl)
      await lecturer.getByRole('link', { name: 'Attendance', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/courses\/[^/]+\/attendance$/)
      await expect(lecturer.getByText('No sessions yet.')).toBeVisible()

      await lecturer.getByLabel('Require students on campus').check()
      await expectNoHorizontalScroll(lecturer)
      await lecturer.getByRole('button', { name: 'Start session', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/courses\/[^/]+\/attendance\/[^/]+$/)
      sessionUrl = lecturer.url()
      await expect(lecturer.getByText('On campus required')).toBeVisible()

      await lecturer.getByRole('button', { name: 'Open start check-in', exact: true }).click()
      await expect(lecturer.getByTestId('attendance-code')).toHaveText(CODE)
      await expect(lecturer.getByTestId('attendance-count')).toContainText('0 / 2')
      await expectNoHorizontalScroll(lecturer)
    })

    // ---- 3. Student on campus checks in --------------------------------------------------------
    await test.step('student on campus sees the banner, checks in, and the banner goes', async () => {
      await alice.goto('/dashboard')
      await expect(alice.getByText(`Check-in open: ${courseTitle}`)).toBeVisible()
      await expectNoHorizontalScroll(alice)

      await submitCode(alice, await readLiveCode(lecturer))
      await expect(alice.getByRole('status').filter({ hasText: 'Checked in' })).toBeVisible()
      await expectNoHorizontalScroll(alice)

      await alice.goto('/dashboard')
      await expect(alice.getByRole('heading', { name: 'Hello, Alice' })).toBeVisible()
      await expect(alice.getByText(/Check-in open:/)).toHaveCount(0)
    })

    // ---- 4. Student 2 km away is refused; a wrong code is refused too --------------------------
    await test.step('student off campus is refused, and so is a wrong code', async () => {
      await submitCode(bob, await readLiveCode(lecturer))
      await expect(bob.getByRole('alert').filter({ hasText: "You don't seem to be on campus." })).toBeVisible()
      await expectNoHorizontalScroll(bob)

      const live = await readLiveCode(lecturer)
      const wrong = live === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ'
      await bob.getByLabel('Code on the screen', { exact: true }).fill(wrong)
      await bob.getByRole('button', { name: 'Check in', exact: true }).click()
      await expect(bob.getByRole('alert').filter({ hasText: "That code isn't right." })).toBeVisible()
    })

    // ---- 5. Live count, then the end check-in -------------------------------------------------
    await test.step("lecturer's count shows 1 / 2, then closes the start and opens the end check-in", async () => {
      // The live panel polls; no reload.
      await expect(lecturer.getByTestId('attendance-count')).toContainText('1 / 2', { timeout: 15_000 })

      await lecturer.getByRole('button', { name: 'Close check-in', exact: true }).click()
      await expect(lecturer.getByRole('button', { name: 'Open end check-in', exact: true })).toBeEnabled()
      await expect(lecturer.getByTestId('attendance-code')).toHaveCount(0)

      await lecturer.getByRole('button', { name: 'Open end check-in', exact: true }).click()
      // The end window has its own code: read it now, after it opened.
      const endCode = await readLiveCode(lecturer)
      await expect(lecturer.getByTestId('attendance-count')).toContainText('0 / 2')

      await submitCode(alice, endCode)
      await expect(alice.getByRole('status').filter({ hasText: 'Checked in' })).toBeVisible()
      await expect(lecturer.getByTestId('attendance-count')).toContainText('1 / 2', { timeout: 15_000 })
      await lecturer.getByRole('button', { name: 'Close check-in', exact: true }).click()
      await expect(lecturer.getByRole('button', { name: 'Open end check-in', exact: true })).toBeDisabled()
    })

    // ---- 6. Lecturer overrides student 2 by hand ----------------------------------------------
    await test.step('lecturer marks the off-campus student Present by hand', async () => {
      await lecturer.goto(sessionUrl)
      const select = lecturer.getByLabel('Attendance of Bob Nkoulou', { exact: true })
      await select.selectOption('present')
      await expect(select).toHaveValue('present')
      // Saved on the server: still there after a reload, and shown with the override mark.
      await lecturer.reload()
      await expect(lecturer.getByLabel('Attendance of Bob Nkoulou', { exact: true })).toHaveValue('present')
      const row = lecturer.getByRole('listitem').filter({ hasText: 'Bob Nkoulou' })
      await expect(row).toContainText('(set by you)')
      await expectNoHorizontalScroll(lecturer)
    })

    // ---- 7. Grid and the student's own view (in French) ---------------------------------------
    await test.step('the grid shows both present, Bob by override', async () => {
      await lecturer.goto(sessionUrl.replace(/\/[^/]+$/, ''))
      const aliceRow = lecturer.getByRole('row').filter({ hasText: 'Alice Mbarga' })
      const bobRow = lecturer.getByRole('row').filter({ hasText: 'Bob Nkoulou' })
      await expect(aliceRow).toContainText('Present')
      await expect(aliceRow).not.toContainText('set by you')
      await expect(bobRow).toContainText('Present (set by you)')
      await expectNoHorizontalScroll(lecturer)
    })

    await test.step("the student's course page shows Présent in French", async () => {
      await alice.goto(courseUrl)
      await expect(alice.getByRole('heading', { name: 'My attendance' })).toBeVisible()
      await expect(alice.getByRole('list', { name: 'Sessions' })).toContainText('Present')

      await alice.getByRole('button', { name: 'FR', exact: true }).click()
      await expect(alice.locator('html')).toHaveAttribute('lang', 'fr')
      await expect(alice.getByRole('heading', { name: 'Mes présences' })).toBeVisible()
      await expect(alice.getByRole('list', { name: 'Séances' })).toContainText('Présent')
      await expectNoHorizontalScroll(alice)
    })
  } finally {
    await closeAll()
  }
})
