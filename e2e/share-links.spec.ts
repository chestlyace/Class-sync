import { expect, test, type Page } from '@playwright/test'
import {
  createCourse,
  createSchoolAndClass,
  EN,
  expectCheckedIn,
  expectNoHorizontalScroll,
  PASSWORD,
  readLiveCode,
  signUp,
  userPages,
} from './helpers'

/**
 * Share links, end to end: the lecturer copies the student join link, a brand-new student opens it
 * signed out, signs up and lands on a one-tap "Join <class>"; a colleague joins with the lecturer
 * link; the wrong role gets a plain message. Then the lecturer copies a check-in link (no code in
 * it) and a student checks in by opening it; once the window closes the link says so.
 */

const CAMPUS = { latitude: 4.1527, longitude: 9.241 }

async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText())
}

test('join and check-in links, end to end', async ({
  browser,
  baseURL,
  viewport,
  userAgent,
  isMobile,
  hasTouch,
  deviceScaleFactor,
}, testInfo) => {
  const run = `${Date.now().toString(36)}-${testInfo.project.name}`
  const emailOf = (who: string) => `e2e-links-${run}-${who}@example.test`
  const className = 'HND 2 SWE'
  const courseTitle = 'Software Testing'
  const schoolName = `Links School ${run}`

  const { newUserPage, closeAll } = userPages(browser, {
    baseURL,
    viewport,
    userAgent,
    isMobile,
    hasTouch,
    deviceScaleFactor,
  })
  const withCampus = { locale: 'en-US', permissions: ['geolocation'], geolocation: CAMPUS }

  try {
    const lecturer = await newUserPage({
      ...withCampus,
      permissions: ['geolocation', 'clipboard-read', 'clipboard-write'],
    })
    let classUrl = ''
    let studentCode = ''
    let studentLink = ''
    let lecturerLink = ''
    let courseUrl = ''

    await test.step('lecturer copies the student and lecturer links from the class page', async () => {
      await signUp(lecturer, { name: 'Lina Lecturer', email: emailOf('lecturer'), role: 'lecturer' }, EN)
      const created = await createSchoolAndClass(lecturer, {
        schoolName,
        town: 'Buea',
        className,
        lat: CAMPUS.latitude,
        lng: CAMPUS.longitude,
      })
      classUrl = created.classUrl
      studentCode = created.studentCode
      courseUrl = await createCourse(lecturer, courseTitle)
      await lecturer.goto(classUrl)

      await lecturer.getByRole('button', { name: 'Copy student link', exact: true }).click()
      studentLink = await readClipboard(lecturer)
      expect(studentLink).toBe(`${baseURL}/join?code=${studentCode}`)
      await lecturer.getByRole('button', { name: 'Copy lecturer link', exact: true }).click()
      lecturerLink = await readClipboard(lecturer)
      expect(lecturerLink).toBe(`${baseURL}/join?code=${created.lecturerCode}`)
      // The code stays visible and copyable as the fallback.
      await expect(lecturer.getByTestId('student-code')).toHaveText(studentCode)
      await expect(lecturer.getByRole('button', { name: 'Copy the student code', exact: true })).toBeVisible()
      await expectNoHorizontalScroll(lecturer)
    })

    const alice = await newUserPage(withCampus)
    await test.step('a new student opens the link signed out, signs up and joins in one tap', async () => {
      await alice.goto(studentLink)
      await expect(alice).toHaveURL(/\/sign-in\?next=%2Fjoin%3Fcode%3D/)
      await alice.getByRole('link', { name: 'Create an account', exact: true }).click()
      await expect(alice).toHaveURL(/\/sign-up\?next=%2Fjoin%3Fcode%3D/)
      await alice.getByLabel(EN.name, { exact: true }).fill('Alice Ndip')
      await alice.getByLabel(EN.email, { exact: true }).fill(emailOf('alice'))
      await alice.getByLabel(EN.password, { exact: true }).fill(PASSWORD)
      await alice.getByLabel(EN.role.student, { exact: true }).check()
      await alice.getByRole('button', { name: EN.submit, exact: true }).click()

      await expect(alice).toHaveURL(new RegExp(`/join\\?code=${studentCode}$`))
      await expect(alice.getByRole('heading', { name: `Join ${className}` })).toBeVisible()
      await expect(alice.getByText(schoolName)).toBeVisible()
      await expect(alice.getByLabel('Class code')).toHaveCount(0) // nothing to type but the matricule
      await expectNoHorizontalScroll(alice)
      await alice.getByLabel('Matricule', { exact: true }).fill('swe 001')
      await alice.getByRole('button', { name: `Join ${className}`, exact: true }).click()
      await expect(alice).toHaveURL(classUrl)

      // Opening the link again says so instead of joining twice.
      await alice.goto(studentLink)
      await expect(alice.getByRole('heading', { name: `You're already in ${className}` })).toBeVisible()
    })

    await test.step('the wrong role gets a plain message', async () => {
      await alice.goto(lecturerLink)
      await expect(alice.getByRole('heading', { name: 'This link is for lecturers' })).toBeVisible()
      await lecturer.goto(studentLink)
      await expect(lecturer.getByRole('heading', { name: 'This link is for students' })).toBeVisible()
    })

    await test.step('a colleague joins with the lecturer link in one tap', async () => {
      const colleague = await newUserPage({ locale: 'en-US' })
      await signUp(colleague, { name: 'Carl Colleague', email: emailOf('colleague'), role: 'lecturer' }, EN)
      await colleague.goto(lecturerLink)
      await expect(colleague.getByRole('heading', { name: `Join ${className}` })).toBeVisible()
      await colleague.getByRole('button', { name: `Join ${className}`, exact: true }).click()
      await expect(colleague).toHaveURL(classUrl)
    })

    const bob = await newUserPage(withCampus)
    await test.step('a signed-in student opens the join link and joins', async () => {
      await signUp(bob, { name: 'Bob Tabi', email: emailOf('bob'), role: 'student' }, EN)
      await bob.goto(studentLink)
      await bob.getByLabel('Matricule', { exact: true }).fill('swe 002')
      await bob.getByRole('button', { name: `Join ${className}`, exact: true }).click()
      await expect(bob).toHaveURL(classUrl)
    })

    let checkInLink = ''
    await test.step('lecturer opens a campus-only check-in and copies its link (no code in it)', async () => {
      await lecturer.goto(courseUrl)
      await lecturer.getByRole('link', { name: 'Attendance', exact: true }).click()
      await lecturer.getByLabel('Require students on campus').check()
      await lecturer.getByRole('button', { name: 'Start session', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/courses\/[^/]+\/attendance\/[^/]+$/)
      await lecturer.getByRole('button', { name: 'Open start check-in', exact: true }).click()
      const code = await readLiveCode(lecturer)
      await expect(lecturer.getByText('Location rules still apply.', { exact: false })).toBeVisible()
      await lecturer.getByRole('button', { name: 'Copy check-in link', exact: true }).click()
      checkInLink = await readClipboard(lecturer)
      expect(checkInLink).toMatch(new RegExp(`^${baseURL}/check-in\\?w=[\\w-]+\\.[\\w-]{22}$`))
      expect(checkInLink).not.toContain(code)
      await expectNoHorizontalScroll(lecturer)
    })

    await test.step('a student checks in by opening the link, with no code to type', async () => {
      await alice.goto(checkInLink)
      await expect(alice.getByRole('heading', { name: courseTitle })).toBeVisible()
      await expect(alice.getByLabel('Code on the screen')).toHaveCount(0)
      await expectNoHorizontalScroll(alice)
      await alice.getByRole('button', { name: 'Check in', exact: true }).click()
      await expectCheckedIn(alice)
      await expect(lecturer.getByTestId('attendance-count')).toContainText('1 / 2', { timeout: 15_000 })
    })

    await test.step('a tampered link is refused; once the window closes the link says so', async () => {
      await bob.goto(`${checkInLink.slice(0, -2)}xx`)
      await expect(bob.getByRole('heading', { name: "This check-in link doesn't work" })).toBeVisible()

      await lecturer.getByRole('button', { name: 'Close check-in', exact: true }).click()
      await expect(lecturer.getByRole('button', { name: 'Copy check-in link' })).toHaveCount(0)
      await bob.goto(checkInLink)
      await expect(bob.getByRole('heading', { name: `Check-in for ${courseTitle} has closed` })).toBeVisible()
    })
  } finally {
    await closeAll()
  }
})
