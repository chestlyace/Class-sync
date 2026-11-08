import { expect, test, type Page } from '@playwright/test'
import {
  createCourse,
  createSchoolAndClass,
  EN,
  expectNoHorizontalScroll,
  joinClassAsStudent,
  signUp,
  simulateLeave,
  userPages,
} from './helpers'

/**
 * Tests, end to end: a lecturer writes an MCQ-only test (3 questions × 2 marks, end after 2 exits
 * or 10 s away) and shares its link; a student of another class is turned away without seeing it;
 * two students wait, the lecturer starts. Alice answers one question, goes offline, answers a
 * second (kept on the device), comes back online and the lecturer sees both; she leaves the page
 * twice and her test ends; the lecturer lets her back in, her answers are still there, she answers
 * the last one and hands in: 6 / 6 at once. Bob answers one question; the lecturer ends the test
 * for everyone; the results list 6 and 2; Alice's course page (French) shows her total; Bob's total
 * (2 / 6) appears once the answers are final, after the 2-minute grace.
 * One serial scenario per project: desktop (laptop rules: Begin, full screen) and 360 px mobile.
 */

/** Option texts are unique across the test: a student picks by text (positions are shuffled). */
const QUESTIONS = [
  { prompt: 'Which layer routes packets between networks?', correct: 'Network layer', wrong: 'Transport layer' },
  { prompt: 'Which protocol gives a new device its IP address?', correct: 'DHCP', wrong: 'ARP' },
  { prompt: 'How many bits are in an IPv4 address?', correct: '32 bits', wrong: '128 bits' },
] as const

/** The answers' grace after the end (ANSWER_GRACE_MS) plus a margin for the 5 s sync. */
const GRACE_WAIT_MS = 120_000 + 30_000

/** On the student's question screen: the prompt shown, then a tick on the right option by its text. */
async function answerShownQuestion(page: Page) {
  const prompt = (await page.locator('p[id^="prompt-"]').innerText()).trim()
  const q = QUESTIONS.find((x) => x.prompt === prompt)
  expect(q, `unknown question "${prompt}"`).toBeDefined()
  const option = page.getByRole('radio', { name: q!.correct, exact: true })
  await option.check()
  await expect(option).toBeChecked()
}

/** The question screen's eyebrow: "Question 2 of 3 · 1 answered". */
function progress(page: Page, answered: number) {
  return page.getByText(new RegExp(`^Question \\d of 3 · ${answered} answered$`)).first()
}

test('a test run with offline answers, leaving and letting back in, end to end', async ({
  browser,
  baseURL,
  viewport,
  userAgent,
  isMobile,
  hasTouch,
  deviceScaleFactor,
}, testInfo) => {
  // The scenario waits out the 2-minute answer grace once (Bob's total after "End for everyone").
  test.setTimeout(360_000)

  const run = `${Date.now().toString(36)}-${testInfo.project.name}`
  const emailOf = (who: string) => `e2e-tst-${run}-${who}@example.test`
  const courseTitle = 'Computer Networks'
  const testTitle = `CA 1 networks ${run}`
  const campus = { latitude: 4.1527, longitude: 9.241 }
  const otherCampus = { latitude: 3.848, longitude: 11.5021 }

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
      permissions: ['geolocation', 'clipboard-read', 'clipboard-write'],
      geolocation: campus,
    })
    const alice = await newUserPage({ locale: 'en-US' })
    const bob = await newUserPage({ locale: 'en-US' })
    const carol = await newUserPage({ locale: 'en-US' })

    let courseUrl = ''
    let livePath = ''
    let testPath = ''

    // ---- Set-up: the course's class with Alice and Bob; Carol in another class --------------
    await test.step('lecturer creates two classes and a course; Alice and Bob join one, Carol the other', async () => {
      await signUp(lecturer, { name: 'Lea Lecturer', email: emailOf('lecturer'), role: 'lecturer' }, EN)
      const { classUrl, studentCode } = await createSchoolAndClass(lecturer, {
        schoolName: `Tests School ${run}`,
        town: 'Douala',
        className: 'HND 2 NET',
        lat: campus.latitude,
        lng: campus.longitude,
      })
      courseUrl = await createCourse(lecturer, courseTitle)

      await lecturer.context().setGeolocation(otherCampus)
      await lecturer.goto('/dashboard')
      const other = await createSchoolAndClass(lecturer, {
        schoolName: `Other School ${run}`,
        town: 'Yaoundé',
        className: 'HND 1 SWE',
        lat: otherCampus.latitude,
        lng: otherCampus.longitude,
      })

      await signUp(alice, { name: 'Alice Mbarga', email: emailOf('alice'), role: 'student' }, EN)
      await joinClassAsStudent(alice, classUrl, studentCode, 'tst 001')
      await signUp(bob, { name: 'Bob Nkoulou', email: emailOf('bob'), role: 'student' }, EN)
      await joinClassAsStudent(bob, classUrl, studentCode, 'tst 002')
      await signUp(carol, { name: 'Carol Fotso', email: emailOf('carol'), role: 'student' }, EN)
      await joinClassAsStudent(carol, other.classUrl, other.studentCode, 'swe 001')
    })

    // ---- 1. Lecturer writes the test and copies its link --------------------------------------
    await test.step('lecturer writes an MCQ-only test of 3 questions, 2 exits / 10 s, and copies the link', async () => {
      await lecturer.goto(courseUrl)
      await lecturer.getByRole('link', { name: 'Tests', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/courses\/[^/]+\/tests$/)
      await lecturer.getByRole('link', { name: 'New test', exact: true }).first().click()
      await expect(lecturer).toHaveURL(/\/tests\/new$/)

      await lecturer.getByLabel('Title', { exact: true }).fill(testTitle)
      for (const [i, q] of QUESTIONS.entries()) {
        if (i > 0) await lecturer.getByRole('button', { name: 'Add multiple choice', exact: true }).click()
        const card = lecturer.getByRole('region', { name: new RegExp(`^Question ${i + 1} · Multiple choice`) })
        await card.getByLabel('Question', { exact: true }).fill(q.prompt)
        await card.getByLabel('Option 1', { exact: true }).fill(q.wrong)
        await card.getByLabel('Option 2', { exact: true }).fill(q.correct)
        await card.getByLabel('Option 2 is the correct answer', { exact: true }).check()
      }
      await expect(lecturer.getByLabel('Mark per question', { exact: true })).toHaveValue('2')
      await expect(lecturer.getByText('Total: 6 marks', { exact: true })).toBeVisible()
      await expect(lecturer.getByRole('switch', { name: /Shuffle questions and options/ })).toHaveAttribute('aria-checked', 'true')
      await lecturer.getByLabel('Number of exits', { exact: true }).fill('2')
      await expect(lecturer.getByLabel('Longest absence, in seconds', { exact: true })).toHaveValue('10')
      await expectNoHorizontalScroll(lecturer)
      await lecturer.getByRole('button', { name: 'Save and get the link', exact: true }).click()

      // The live page (not /tests/new, which matches the same shape).
      await expect(lecturer).toHaveURL(/\/courses\/[^/]+\/tests\/(?!new$)[^/]+$/)
      livePath = new URL(lecturer.url()).pathname
      await expect(lecturer.getByRole('heading', { name: testTitle })).toBeVisible()
      await expect(lecturer.getByText('Not started', { exact: true }).first()).toBeVisible()
      const link = (await lecturer.locator('code').filter({ hasText: '/t/' }).innerText()).trim()
      expect(link).toMatch(/\/t\/[A-Z0-9]{6}$/)
      testPath = new URL(link).pathname

      await lecturer.getByRole('button', { name: 'Copy the test link', exact: true }).click()
      await expect(lecturer.getByRole('status').filter({ hasText: 'Copied' })).toHaveCount(1)
      expect(await lecturer.evaluate(() => navigator.clipboard.readText())).toBe(link)
      await expect(lecturer.getByText('No students waiting yet', { exact: true })).toBeVisible()
      await expectNoHorizontalScroll(lecturer)
    })

    // ---- 2. An outsider learns nothing ---------------------------------------------------------
    await test.step('Carol (another class) is told the test is not for her, without its title', async () => {
      await carol.goto(testPath)
      await expect(carol.getByRole('heading', { name: 'This test is not for one of your courses' })).toBeVisible()
      await expect(carol.getByText(testTitle)).toHaveCount(0)
      expect(await carol.content()).not.toContain(testTitle)
      await expectNoHorizontalScroll(carol)
    })

    // ---- 3. Waiting room -----------------------------------------------------------------------
    await test.step('Alice and Bob wait with the total and the leaving rule; the lecturer sees 2 waiting', async () => {
      for (const student of [alice, bob]) {
        await student.goto(testPath)
        await expect(student.getByRole('heading', { name: testTitle })).toBeVisible()
        const marks = student.locator('dl > div').filter({ hasText: 'Total marks' })
        await expect(marks.locator('dd')).toHaveText('6')
        await expect(
          student.getByText(
            'The test ends for you after 2 exits from this page, or one absence longer than 10 seconds.',
            { exact: true },
          ),
        ).toBeVisible()
        await expect(student.getByText('Your lecturer starts the test for everyone.', { exact: false })).toBeVisible()
        await expectNoHorizontalScroll(student)
      }
      // The live page polls every 3 s.
      await expect(lecturer.getByText('2 students waiting', { exact: true })).toBeVisible({ timeout: 15_000 })
    })

    // ---- 4. Start; Alice answers through a lost connection -------------------------------------
    await test.step('lecturer starts; Alice answers one question, a second offline, and the lecturer sees both', async () => {
      await lecturer.getByRole('button', { name: 'Start test', exact: true }).click()
      const confirm = lecturer.getByRole('dialog')
      await expect(confirm).toContainText('Start for everyone now?')
      await confirm.getByRole('button', { name: 'Start now', exact: true }).click()
      await expect(lecturer.getByText('Running', { exact: true }).first()).toBeVisible()
      await expect(lecturer.getByRole('timer')).toBeVisible()

      // The waiting screen polls every 5 s. Laptops tap Begin (full screen); phones go straight in.
      if (!isMobile) {
        await alice.getByRole('button', { name: 'Begin', exact: true }).click({ timeout: 15_000 })
      }
      await expect(progress(alice, 0)).toBeVisible({ timeout: 15_000 })
      await answerShownQuestion(alice)
      await expect(progress(alice, 1)).toBeVisible()
      await expect(alice.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()

      await alice.context().setOffline(true)
      await alice.getByRole('button', { name: 'Next', exact: true }).click()
      await answerShownQuestion(alice)
      await expect(progress(alice, 2)).toBeVisible()
      await expect(alice.getByText('Saved on this phone · waiting for connection', { exact: true })).toBeVisible()
      await expectNoHorizontalScroll(alice)

      await alice.context().setOffline(false)
      await expect(alice.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible({ timeout: 15_000 })
      const aliceRow = lecturer.getByRole('row', { name: /Alice Mbarga/ })
      await expect(aliceRow).toContainText('2 / 3', { timeout: 15_000 })
      await expect(aliceRow).toContainText('Working')
    })

    // ---- 5. Leaving twice ends Alice's test; the lecturer lets her back in ---------------------
    await test.step('Alice leaves twice and her test ends; let back in, she finishes and sees 6 / 6', async () => {
      await simulateLeave(alice, 1000)
      await expect(alice.getByRole('heading', { name: 'You left the test (1 of 2)' })).toBeVisible()
      await expect(alice.getByText('If you leave again, your test ends and your answers are handed in.')).toBeVisible()
      await expectNoHorizontalScroll(alice)
      await alice.getByRole('button', { name: /^Back to (the questions|full screen)$/ }).click()
      await expect(progress(alice, 2)).toBeVisible()

      await simulateLeave(alice, 1000)
      await expect(alice.getByRole('heading', { name: 'Your test has ended' })).toBeVisible()
      await expect(alice.getByText('You left the test 2 times, the limit your lecturer set.')).toBeVisible()
      await expect(alice.getByText('2 answers were handed in.')).toBeVisible()
      await expectNoHorizontalScroll(alice)

      const aliceRow = lecturer.getByRole('row', { name: /Alice Mbarga/ })
      await expect(aliceRow).toContainText('Ended', { timeout: 15_000 })
      await expectNoHorizontalScroll(lecturer)
      await aliceRow.getByRole('button', { name: 'Let Alice Mbarga back in', exact: true }).click()
      await expect(aliceRow).toContainText('Working', { timeout: 15_000 })

      // The ended screen keeps polling (every 5 s) and reopens, answers intact. Laptops tap Begin
      // again to re-enter full screen; being out of it while let back in is not an exit.
      if (!isMobile) {
        await alice.getByRole('button', { name: 'Begin', exact: true }).click({ timeout: 15_000 })
      }
      await expect(progress(alice, 2)).toBeVisible({ timeout: 15_000 })
      await expect(alice.getByRole('heading', { name: /You left the test/ })).toHaveCount(0)
      // Go to the one question still unanswered.
      for (let i = 0; i < QUESTIONS.length; i++) {
        if ((await alice.getByRole('radio', { checked: true }).count()) === 0) break
        await alice.getByRole('button', { name: 'Next', exact: true }).click()
      }
      await expect(alice.getByRole('radio', { checked: true })).toHaveCount(0)
      await answerShownQuestion(alice)
      await expect(progress(alice, 3)).toBeVisible()

      await alice.getByRole('button', { name: 'Hand in', exact: true }).click()
      const dialog = alice.getByRole('dialog')
      await expect(dialog).toContainText('You have answered every question.')
      await dialog.getByRole('button', { name: 'Hand in', exact: true }).click()
      await expect(alice.getByText('6 / 6', { exact: true })).toBeVisible()
      await expect(alice.getByText('3 of 3 right', { exact: true })).toBeVisible()
      await expectNoHorizontalScroll(alice)
      await expect(aliceRow).toContainText('Handed in', { timeout: 15_000 })
    })

    // ---- 6. Bob answers one; the lecturer ends the test for everyone ---------------------------
    await test.step('Bob answers one question; the lecturer ends the test; the results list 6 and 2', async () => {
      if (!isMobile) await bob.getByRole('button', { name: 'Begin', exact: true }).click()
      await expect(progress(bob, 0)).toBeVisible()
      await answerShownQuestion(bob)
      await expect(progress(bob, 1)).toBeVisible()
      await expect(bob.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
      const bobRow = lecturer.getByRole('row', { name: /Bob Nkoulou/ })
      await expect(bobRow).toContainText('1 / 3', { timeout: 15_000 })

      await lecturer.getByRole('button', { name: 'End test for everyone', exact: true }).click()
      const confirm = lecturer.getByRole('dialog')
      await expect(confirm).toContainText('End the test for everyone?')
      await confirm.getByRole('button', { name: 'End test', exact: true }).click()
      await expect(lecturer.getByText('The test has ended.', { exact: false })).toBeVisible()

      // Bob's answers are handed in as they stand; his total waits until they are final.
      await expect(bob.getByText('Handed in. Your score appears in a moment.', { exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await expectNoHorizontalScroll(bob)

      await lecturer.getByRole('link', { name: 'See results', exact: true }).click()
      await expect(lecturer).toHaveURL(new RegExp(`${livePath}/results$`))
      await expect(lecturer.getByText('Students already see their totals.')).toBeVisible()
      await expect(lecturer.getByRole('row', { name: /Alice Mbarga/ })).toContainText('6 / 6')
      await expect(lecturer.getByRole('row', { name: /Bob Nkoulou/ })).toContainText('2 / 6')
      await expectNoHorizontalScroll(lecturer)
    })

    // ---- 7. Alice's course page, in French -----------------------------------------------------
    await test.step("Alice's course page in French lists the test with her total", async () => {
      await alice.goto('/dashboard')
      await alice.getByRole('button', { name: 'FR', exact: true }).click()
      await expect(alice.locator('html')).toHaveAttribute('lang', 'fr')
      await alice.goto(courseUrl)
      const mine = alice.getByRole('region', { name: 'Mes tests' })
      await expect(mine).toContainText(testTitle)
      await expect(mine).toContainText('Remis')
      await expect(mine).toContainText('6 / 6')
      await expectNoHorizontalScroll(alice)
    })

    // ---- Bob's total, once the answers are final -----------------------------------------------
    await test.step("Bob's total appears by itself after the 2-minute grace: 2 / 6", async () => {
      await expect(bob.getByText('2 / 6', { exact: true })).toBeVisible({ timeout: GRACE_WAIT_MS })
      await expect(bob.getByText('1 of 3 right', { exact: true })).toBeVisible()
      await expectNoHorizontalScroll(bob)
    })
  } finally {
    await closeAll()
  }
})
