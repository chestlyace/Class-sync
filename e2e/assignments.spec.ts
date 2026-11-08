import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
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
 * Assignments, end to end: a lecturer (English) publishes an assignment with a PDF attachment; one
 * student (French) answers in the editor, reloads to find the unsent text restored, adds a photo and
 * submits; another student (English) is refused that photo; the lecturer grades 17.5 and releases the
 * grades; the French student then sees "17,5 / 20" with the comment.
 * One serial scenario per project (desktop, then 360 px mobile), with three fresh users each.
 * Uploads go to local disk (`STORAGE_DRIVER=local` in playwright.config.ts).
 */

const FIXTURES = path.join(__dirname, 'fixtures')
const PDF = path.join(FIXTURES, 'answer.pdf')
const PHOTO = path.join(FIXTURES, 'photo.jpg')

const INSTRUCTIONS = 'Configure the router and describe the subnets you chose.'
const ANSWER = 'The subnet mask is 255.255.255.0 and the gateway is 192.168.1.1.'
const COMMENT = 'Clear answer. Check the broadcast address next time.'

/** The app's time zone (APP_TIME_ZONE is unset for e2e, so the default applies). */
const APP_TIME_ZONE = 'Africa/Douala'

/**
 * Tomorrow at 08:00 in the app's time zone, as a `datetime-local` value (YYYY-MM-DDTHH:mm): the
 * form reads it in that zone, so "tomorrow" must be too, whatever the machine's own zone.
 */
function tomorrowAt8(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE, dateStyle: 'short' }).format(new Date())
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 24 * 60 * 60 * 1000)
  return `${tomorrow.toISOString().slice(0, 10)}T08:00`
}

/** Clicks into a BlockNote editor (found by the aria-label on its contenteditable) and types. */
async function typeInEditor(page: Page, label: string, text: string) {
  const editor = page.locator(`[contenteditable="true"][aria-label="${label}"]`)
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.type(text)
  return editor
}

test('assignments with uploads, grading and release, end to end', async ({
  browser,
  baseURL,
  viewport,
  userAgent,
  isMobile,
  hasTouch,
  deviceScaleFactor,
}, testInfo) => {
  const run = `${Date.now().toString(36)}-${testInfo.project.name}`
  const emailOf = (who: string) => `e2e-asg-${run}-${who}@example.test`
  const courseTitle = 'Computer Networks'
  const assignmentTitle = `Lab report ${run}`
  const campus = { latitude: 4.1527, longitude: 9.241 }

  const { newUserPage, closeAll } = userPages(browser, {
    baseURL,
    viewport,
    userAgent,
    isMobile,
    hasTouch,
    deviceScaleFactor,
  })

  try {
    const lecturer = await newUserPage({ locale: 'en-US', permissions: ['geolocation'], geolocation: campus })
    const alice = await newUserPage({ locale: 'en-US' })
    const bob = await newUserPage({ locale: 'en-US' })

    let courseUrl = ''
    let assignmentUrl = ''
    let studentAssignmentUrl = ''
    let photoHref = ''

    // ---- 1. Set-up: school, class, course, two students (Alice then switches to French) --------
    await test.step('lecturer creates a school, a class and a course; two students join', async () => {
      await signUp(lecturer, { name: 'Lea Lecturer', email: emailOf('lecturer'), role: 'lecturer' }, EN)
      const { classUrl, studentCode } = await createSchoolAndClass(lecturer, {
        schoolName: `Assignments School ${run}`,
        town: 'Douala',
        className: 'HND 2 NET',
        lat: campus.latitude,
        lng: campus.longitude,
      })
      courseUrl = await createCourse(lecturer, courseTitle)

      await signUp(alice, { name: 'Alice Mbarga', email: emailOf('alice'), role: 'student' }, EN)
      await joinClassAsStudent(alice, classUrl, studentCode, 'asg 001')
      await signUp(bob, { name: 'Bob Nkoulou', email: emailOf('bob'), role: 'student' }, EN)
      await joinClassAsStudent(bob, classUrl, studentCode, 'asg 002')

      // Alice works in French from here on.
      await alice.goto('/dashboard')
      await alice.getByRole('button', { name: 'FR', exact: true }).click()
      await expect(alice.locator('html')).toHaveAttribute('lang', 'fr')
    })

    // ---- 2. Lecturer: draft, attachment, publish ----------------------------------------------
    await test.step('lecturer saves a draft, attaches a PDF and publishes it', async () => {
      await lecturer.goto(courseUrl)
      await lecturer.getByRole('link', { name: 'Assignments', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/courses\/[^/]+\/assignments$/)
      await expect(lecturer.getByText(/No assignments yet/)).toBeVisible()
      await lecturer.getByRole('link', { name: 'New assignment', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/assignments\/new$/)

      await lecturer.getByLabel('Title', { exact: true }).fill(assignmentTitle)
      await typeInEditor(lecturer, 'Instructions', INSTRUCTIONS)
      await lecturer.getByLabel('Due date and time', { exact: true }).fill(tomorrowAt8())
      await expect(lecturer.getByLabel('Max mark', { exact: true })).toHaveValue('20')
      await lecturer.getByLabel('Students submit', { exact: true }).selectOption({ label: 'Files and a typed answer' })
      await expectNoHorizontalScroll(lecturer)
      await lecturer.getByRole('button', { name: 'Save draft', exact: true }).click()

      // A new assignment is saved as a draft, then opens on its edit page, where files can be added.
      await expect(lecturer).toHaveURL(/\/assignments\/[^/]+\/edit\?created=1$/)
      await expect(lecturer.getByText(/Draft saved\./)).toBeVisible()
      await lecturer.locator('input[type="file"]').setInputFiles(PDF)
      await expect(lecturer.getByRole('link', { name: /answer\.pdf/ })).toBeVisible()
      await expectNoHorizontalScroll(lecturer)
      await lecturer.getByRole('button', { name: 'Save changes', exact: true }).click()

      await expect(lecturer).toHaveURL(/\/courses\/[^/]+\/assignments\/[^/]+$/)
      assignmentUrl = lecturer.url()
      await expect(lecturer.getByRole('heading', { name: assignmentTitle })).toBeVisible()
      await expect(lecturer.getByText('Draft', { exact: true })).toBeVisible()
      await expect(lecturer.getByText(INSTRUCTIONS)).toBeVisible()
      await expect(lecturer.getByRole('link', { name: 'Open answer.pdf' })).toBeVisible()
      await expectNoHorizontalScroll(lecturer)

      await lecturer.getByRole('button', { name: 'Publish', exact: true }).click()
      const dialog = lecturer.getByRole('dialog')
      await expect(dialog).toContainText('The 2 students on this course get an email')
      await dialog.getByRole('button', { name: 'Publish and email students', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(lecturer.getByText('Published', { exact: true })).toBeVisible()
      await expect(lecturer.getByRole('button', { name: 'Release grades', exact: true })).toBeVisible()
    })

    // ---- 3. Alice (French) finds it, opens the attachment --------------------------------------
    await test.step('Alice sees it on her dashboard and course page, and opens the attachment', async () => {
      await alice.goto('/dashboard')
      const due = alice.getByRole('region', { name: 'À rendre cette semaine' })
      await expect(due).toContainText(assignmentTitle)
      await expectNoHorizontalScroll(alice)

      await alice.goto(courseUrl)
      const mine = alice.getByRole('region', { name: 'Mes devoirs' })
      await expect(mine).toContainText(assignmentTitle)
      await expect(mine).toContainText('À faire')
      await expectNoHorizontalScroll(alice)

      await mine.getByRole('link', { name: new RegExp(assignmentTitle) }).click()
      await expect(alice).toHaveURL(/\/assignments\/[^/]+$/)
      studentAssignmentUrl = alice.url()
      await expect(alice.getByRole('heading', { name: assignmentTitle })).toBeVisible()
      await expect(alice.getByText(INSTRUCTIONS)).toBeVisible()

      const attachment = alice.getByRole('link', { name: 'Ouvrir answer.pdf' })
      await expect(attachment).toBeVisible()
      const href = await attachment.getAttribute('href')
      expect(href).toMatch(/^\/api\/files\/[^/]+$/)
      const res = await alice.request.get(href!)
      expect(res.status()).toBe(200)
      expect(res.headers()['content-type']).toBe('application/pdf')
      // Opens in the browser's PDF viewer: inline, and no CSP sandbox (Chrome refuses sandboxed PDFs).
      expect(res.headers()['content-disposition']).toMatch(/^inline/)
      expect(res.headers()).not.toHaveProperty('content-security-policy')
      await expectNoHorizontalScroll(alice)
    })

    // ---- 4. Alice types, reloads (draft restored), adds the photo, submits ---------------------
    await test.step('Alice types an answer; a reload before submitting restores it', async () => {
      await typeInEditor(alice, 'Votre réponse', ANSWER)
      // Straight away, with no wait: leaving the page must keep what was typed (Review Focus 1).
      await alice.reload()
      await expect(alice.getByText('Votre réponse non envoyée a été restaurée.')).toBeVisible()
      await expect(alice.locator('[contenteditable="true"][aria-label="Votre réponse"]')).toContainText(ANSWER)
      await expectNoHorizontalScroll(alice)
    })

    await test.step('Alice adds a photo and submits', async () => {
      await alice.locator('input[type="file"]').setInputFiles(PHOTO)
      const photo = alice.getByRole('link', { name: /photo\.jpg/ })
      await expect(photo).toBeVisible()
      photoHref = (await photo.getAttribute('href'))!
      expect(photoHref).toMatch(/^\/api\/files\/[^/]+$/)

      await alice.getByRole('button', { name: 'Rendre', exact: true }).click()
      const status = alice.getByRole('status').filter({ hasText: 'Rendu à' })
      await expect(status).toBeVisible()
      await expect(alice.getByRole('button', { name: 'Remplacer le rendu', exact: true })).toBeVisible()
      await expectNoHorizontalScroll(alice)

      // Replacing it straight away (same minute) is still confirmed, in its own words.
      await alice.getByRole('button', { name: 'Remplacer le rendu', exact: true }).click()
      await expect(alice.getByRole('status').filter({ hasText: 'Rendu remplacé à' })).toBeVisible()

      // The draft is gone once submitted: a fresh load shows the submitted work, no restore note.
      await alice.goto(studentAssignmentUrl)
      await expect(alice.getByText('Votre réponse non envoyée a été restaurée.')).toHaveCount(0)
      await expect(alice.locator('[contenteditable="true"][aria-label="Votre réponse"]')).toContainText(ANSWER)
      await expect(alice.getByRole('link', { name: /photo\.jpg/ })).toBeVisible()
    })

    // ---- 5. Bob must not read Alice's file ----------------------------------------------------
    await test.step("Bob is refused Alice's file, while Alice can open it", async () => {
      const mine = await alice.request.get(photoHref)
      expect(mine.status()).toBe(200)
      expect(mine.headers()['content-type']).toBe('image/jpeg')

      const theirs = await bob.request.get(photoHref)
      expect(theirs.status()).toBe(403)
      expect(theirs.headers()['content-type']).toContain('application/json')
      expect(await theirs.json()).toEqual({ error: 'FORBIDDEN' })
    })

    // ---- 6. Lecturer: table, the submission, grade, release -----------------------------------
    await test.step('lecturer sees Alice submitted and Bob missing', async () => {
      await lecturer.goto(assignmentUrl)
      const aliceRow = lecturer.getByRole('row').filter({ hasText: 'Alice Mbarga' })
      const bobRow = lecturer.getByRole('row').filter({ hasText: 'Bob Nkoulou' })
      await expect(aliceRow).toContainText('Submitted')
      await expect(bobRow).toContainText('Missing')
      await expectNoHorizontalScroll(lecturer)
    })

    await test.step("lecturer opens Alice's submission: text and photo inline", async () => {
      await lecturer.getByRole('link', { name: 'Open the submission of Alice Mbarga' }).click()
      await expect(lecturer).toHaveURL(/\/submissions\/[^/]+$/)
      await expect(lecturer.getByText(ANSWER)).toBeVisible()
      const img = lecturer.getByRole('img', { name: 'photo.jpg' })
      await expect(img).toBeVisible()
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
      expect(await img.getAttribute('src')).toBe(photoHref)
      await expectNoHorizontalScroll(lecturer)
    })

    await test.step('lecturer grades 17.5 with a comment', async () => {
      await lecturer.getByLabel('Mark', { exact: true }).fill('17.5')
      await lecturer.getByLabel('Feedback', { exact: true }).fill(COMMENT)
      await lecturer.getByRole('button', { name: 'Save grade', exact: true }).click()
      await expect(lecturer.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
      // Not released yet: Alice sees no grade.
      await alice.goto(studentAssignmentUrl)
      await expect(alice.getByRole('region', { name: 'Note' })).toHaveCount(0)
    })

    await test.step('lecturer releases the grades', async () => {
      await lecturer.goto(assignmentUrl)
      await expect(lecturer.getByRole('row').filter({ hasText: 'Alice Mbarga' })).toContainText('17.5 / 20')
      await lecturer.getByRole('button', { name: 'Release grades', exact: true }).click()
      const dialog = lecturer.getByRole('dialog')
      await expect(dialog).toContainText('1 graded submission becomes visible to its student')
      await expect(dialog).toContainText(
        'Releasing also closes this assignment: students can no longer hand in or replace work.',
      )
      // Due tomorrow: Bob hasn't handed in, so the dialog warns that he won't be able to.
      await expect(dialog).toContainText("The deadline hasn't passed — students who haven't handed in won't be able to.")
      await dialog.getByRole('button', { name: 'Release grades', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(lecturer.getByText(/Grades released /)).toBeVisible()
      await expectNoHorizontalScroll(lecturer)
    })

    // ---- 7. Alice sees her grade, in French ---------------------------------------------------
    await test.step('Alice sees 17,5 / 20 with the comment, in French', async () => {
      await alice.goto(studentAssignmentUrl)
      const grade = alice.getByRole('region', { name: 'Note' })
      await expect(grade).toContainText('17,5 / 20')
      await expect(grade).toContainText(COMMENT)
      // Released grades close the hand-in (ruling B9): her work is read-only, with no way to replace it.
      await expect(alice.getByText('Les notes ont été publiées, ce devoir', { exact: false })).toBeVisible()
      const work = alice.getByRole('region', { name: 'Votre travail' })
      await expect(work).toContainText(ANSWER)
      await expect(work.getByRole('link', { name: /photo\.jpg/ })).toBeVisible()
      await expect(alice.getByRole('button', { name: 'Remplacer le rendu', exact: true })).toHaveCount(0)
      await expect(alice.getByRole('button', { name: 'Rendre', exact: true })).toHaveCount(0)
      await expect(alice.locator('[contenteditable="true"]')).toHaveCount(0)
      await expect(alice.locator('input[type="file"]')).toHaveCount(0)
      await expectNoHorizontalScroll(alice)

      await alice.goto(courseUrl)
      await expect(alice.getByRole('region', { name: 'Mes devoirs' })).toContainText('Noté · 17,5 / 20')
      await expectNoHorizontalScroll(alice)
    })

    // Bob handed nothing in, so he has no grade to see; the release closed the assignment for him too.
    await test.step('Bob has no grade, and the assignment is closed to him', async () => {
      await bob.goto(courseUrl)
      await expect(bob.getByRole('region', { name: 'My assignments' })).toContainText('Closed')
      await expect(bob.getByText(/Graded ·/)).toHaveCount(0)

      await bob.goto(studentAssignmentUrl)
      await expect(bob.getByText(/Grades have been released, so this assignment no longer accepts work\./)).toBeVisible()
      await expect(bob.getByText("You didn't hand anything in.")).toBeVisible()
      await expect(bob.getByRole('button', { name: 'Submit', exact: true })).toHaveCount(0)
      await expect(bob.locator('input[type="file"]')).toHaveCount(0)
    })
  } finally {
    await closeAll()
  }
})
