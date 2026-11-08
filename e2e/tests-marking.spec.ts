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
 * Marking a test, end to end: a lecturer writes a test of one multiple-choice question (2 marks)
 * and one short answer (4 marks, with a marking guide), weight 2× in the CA, and starts it. Ama
 * answers both well; Ben picks the wrong option and leaves the short answer blank; both hand in and
 * are told their result comes at release. The lecturer ends the test: marking opens only once the
 * answers are final (the 2-minute grace, waited out here while the lecturer gives tests 10 points
 * of the CA). Names are hidden while marking; Ama's answer shows the AI suggestion (the e2e server
 * runs the deterministic fake: full marks for a guide word); there is no "accept all", and Release
 * waits for the one answer to confirm. The lecturer changes the mark to 3 with a comment and
 * releases: Ama sees 5 / 6 with "3 / 4" and the comment (never the options), Ben 0 / 6, and the
 * CA table's tests column gives Ama 8.33 / 10.
 * One serial scenario per project: desktop and 360 px mobile.
 */

const MCQ = {
  prompt: 'Which process moves water into a plant root?',
  correct: 'Osmosis',
  wrong: 'Combustion',
} as const
const SHORT = {
  prompt: 'Explain how water enters a root hair cell.',
  guide: 'osmosis across a membrane',
} as const

/** The answers' grace after the end (ANSWER_GRACE_MS) plus a margin for reloads. */
const GRACE_WAIT_MS = 120_000 + 30_000

/**
 * On the student's question screen (questions are shuffled): answers the one shown, then the
 * other. `pick` is the MCQ option to tick; `text` the short answer, or null to leave it blank.
 */
async function answerTest(page: Page, pick: string, text: string | null) {
  for (let i = 0; i < 2; i++) {
    if (i > 0) await page.getByRole('button', { name: 'Next', exact: true }).click()
    const prompt = (await page.locator('p[id^="prompt-"]').innerText()).trim()
    if (prompt === MCQ.prompt) {
      const option = page.getByRole('radio', { name: pick, exact: true })
      await option.check()
      await expect(option).toBeChecked()
    } else {
      expect(prompt).toBe(SHORT.prompt)
      if (text !== null) await page.getByLabel('Your answer', { exact: true }).fill(text)
    }
  }
}

/** Hand in through the confirmation dialog; `dialogText` is what the dialog says about unanswered questions. */
async function handIn(page: Page, dialogText: string) {
  await page.getByRole('button', { name: 'Hand in', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(dialogText)
  await dialog.getByRole('button', { name: 'Hand in', exact: true }).click()
  await expect(page.getByText('Handed in. Your result comes when your lecturer releases it.', { exact: true })).toBeVisible()
}

test('marking a test with AI suggestions, release and the CA, end to end', async ({
  browser,
  baseURL,
  viewport,
  userAgent,
  isMobile,
  hasTouch,
  deviceScaleFactor,
}, testInfo) => {
  // The scenario waits out the 2-minute answer grace once, before marking opens.
  test.setTimeout(360_000)

  const run = `${Date.now().toString(36)}-${testInfo.project.name}`
  const emailOf = (who: string) => `e2e-mrk-${run}-${who}@example.test`
  const testTitle = `CA 1 biology ${run}`
  const campus = { latitude: 4.1527, longitude: 9.241 }
  const AMA = { name: 'Ama Tchoupo', matricule: 'MRK 001' }
  const BEN = { name: 'Ben Ekane', matricule: 'MRK 002' }

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
    const ama = await newUserPage({ locale: 'en-US' })
    const ben = await newUserPage({ locale: 'en-US' })

    let courseUrl = ''
    let livePath = ''
    let testPath = ''

    await test.step('lecturer creates a class and a course; Ama and Ben join', async () => {
      await signUp(lecturer, { name: 'Lina Lecturer', email: emailOf('lecturer'), role: 'lecturer' }, EN)
      const { classUrl, studentCode } = await createSchoolAndClass(lecturer, {
        schoolName: `Marking School ${run}`,
        town: 'Douala',
        className: 'HND 1 BIO',
        lat: campus.latitude,
        lng: campus.longitude,
      })
      courseUrl = await createCourse(lecturer, 'Plant Biology')

      await signUp(ama, { name: AMA.name, email: emailOf('ama'), role: 'student' }, EN)
      await joinClassAsStudent(ama, classUrl, studentCode, AMA.matricule)
      await signUp(ben, { name: BEN.name, email: emailOf('ben'), role: 'student' }, EN)
      await joinClassAsStudent(ben, classUrl, studentCode, BEN.matricule)
    })

    // ---- 1. A test with a short answer, weight 2× ----------------------------------------------
    await test.step('lecturer writes 1 MCQ (2 marks) + 1 short answer (4 marks, with a guide), weight 2×, and starts it', async () => {
      await lecturer.goto(`${courseUrl}/tests/new`)
      await lecturer.getByLabel('Title', { exact: true }).fill(testTitle)

      const mcq = lecturer.getByRole('region', { name: /^Question 1 · Multiple choice/ })
      await mcq.getByLabel('Question', { exact: true }).fill(MCQ.prompt)
      await mcq.getByLabel('Option 1', { exact: true }).fill(MCQ.wrong)
      await mcq.getByLabel('Option 2', { exact: true }).fill(MCQ.correct)
      await mcq.getByLabel('Option 2 is the correct answer', { exact: true }).check()

      await lecturer.getByRole('button', { name: 'Add short answer', exact: true }).click()
      const short = lecturer.getByRole('region', { name: /^Question 2 · Short answer/ })
      await short.getByLabel('Question', { exact: true }).fill(SHORT.prompt)
      await short.getByLabel('Marking guide (never shown to students)', { exact: true }).fill(SHORT.guide)
      await short.getByLabel('Mark', { exact: true }).fill('4')

      await expect(lecturer.getByLabel('Mark per question', { exact: true })).toHaveValue('2')
      await lecturer.getByLabel('Weight in CA', { exact: true }).fill('2')
      await expect(lecturer.getByText('Total: 6 marks', { exact: true })).toBeVisible()
      await expect(lecturer.getByText('Results wait until you mark short answers and release them.')).toBeVisible()
      await expectNoHorizontalScroll(lecturer)
      await lecturer.getByRole('button', { name: 'Save and get the link', exact: true }).click()

      await expect(lecturer).toHaveURL(/\/courses\/[^/]+\/tests\/(?!new$)[^/]+$/)
      livePath = new URL(lecturer.url()).pathname
      await expect(lecturer.getByRole('heading', { name: testTitle })).toBeVisible()
      const link = (await lecturer.locator('code').filter({ hasText: '/t/' }).innerText()).trim()
      testPath = new URL(link).pathname

      for (const student of [ama, ben]) {
        await student.goto(testPath)
        await expect(student.getByRole('heading', { name: testTitle })).toBeVisible()
      }
      // The live page polls every 3 s.
      await expect(lecturer.getByText('2 students waiting', { exact: true })).toBeVisible({ timeout: 15_000 })
      await lecturer.getByRole('button', { name: 'Start test', exact: true }).click()
      await lecturer.getByRole('dialog').getByRole('button', { name: 'Start now', exact: true }).click()
      await expect(lecturer.getByText('Running', { exact: true }).first()).toBeVisible()
    })

    // ---- 2. Both hand in; results wait for release ---------------------------------------------
    await test.step('Ama answers both well, Ben picks wrong and leaves the short answer blank; both hand in', async () => {
      for (const student of [ama, ben]) {
        // The waiting screen polls every 5 s. Laptops tap Begin (full screen); phones go straight in.
        if (!isMobile) await student.getByRole('button', { name: 'Begin', exact: true }).click({ timeout: 15_000 })
        await expect(student.locator('p[id^="prompt-"]')).toBeVisible({ timeout: 15_000 })
      }

      await answerTest(ama, MCQ.correct, 'Osmosis moves water')
      await handIn(ama, 'You have answered every question.')
      await expectNoHorizontalScroll(ama)

      await answerTest(ben, MCQ.wrong, null)
      await handIn(ben, '1 question is still unanswered.')
    })

    // ---- 3. End; marking waits for the answers to be final -------------------------------------
    await test.step('lecturer ends the test; marking and release wait for the 2-minute grace', async () => {
      await lecturer.getByRole('button', { name: 'End test for everyone', exact: true }).click()
      await lecturer.getByRole('dialog').getByRole('button', { name: 'End test', exact: true }).click()
      await expect(lecturer.getByText('The test has ended.', { exact: false })).toBeVisible()

      await lecturer.goto(`${livePath}/mark`)
      await expect(
        lecturer.getByText(/^Marking opens at .+, when late answers can no longer arrive\.$/),
      ).toBeVisible()
      await expectNoHorizontalScroll(lecturer)

      await lecturer.goto(`${livePath}/results`)
      await expect(lecturer.getByRole('button', { name: 'Release results', exact: true })).toBeDisabled()
      await expect(lecturer.getByText(/^You can release from .+, when late answers can no longer arrive\.$/)).toBeVisible()
    })

    // ---- 4. Meanwhile, the CA gives tests 10 points --------------------------------------------
    await test.step('during the grace, the lecturer gives tests 10 of the 30 CA points; tests have not started', async () => {
      await lecturer.goto(courseUrl)
      await lecturer.getByRole('link', { name: 'CA', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/courses\/[^/]+\/performance$/)
      await expect(lecturer.getByLabel('CA total', { exact: true })).toHaveValue('30')
      await lecturer.getByLabel('Attendance', { exact: true }).fill('5')
      await lecturer.getByLabel('Assignments', { exact: true }).fill('10')
      await lecturer.getByLabel('Tests', { exact: true }).fill('10')
      await lecturer.getByLabel('Participation', { exact: true }).fill('5')
      await expect(lecturer.getByText('Parts add up to 30 of 30')).toBeVisible()
      await lecturer.getByRole('button', { name: 'Save settings', exact: true }).click()
      await expect(lecturer.getByText('Settings saved.')).toBeVisible()
      await lecturer.reload()
      await expect(lecturer.getByLabel('Tests', { exact: true })).toHaveValue('10')

      // No result is released yet: the tests column has not started.
      await expect(lecturer.getByText(/^Tests haven't started/)).toBeVisible()
      const amaRow = lecturer.getByRole('row').filter({ hasText: AMA.name })
      // A dash on screen, "Not started yet" for screen readers.
      await expect(amaRow.locator('[data-testid^="ca-part-tests-"]')).toHaveText('—Not started yet')
      await expectNoHorizontalScroll(lecturer)
    })

    // ---- 5. Marking opens: names hidden, a suggestion, nothing counts until confirmed -----------
    await test.step('once final, Release waits for 1 answer; the marking page hides names and shows the AI suggestion', async () => {
      await lecturer.goto(`${livePath}/results`)
      await expect(async () => {
        await lecturer.reload()
        await expect(lecturer.getByText('1 answer still to confirm', { exact: true })).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: GRACE_WAIT_MS, intervals: [5_000] })
      await expect(lecturer.getByRole('button', { name: 'Release results', exact: true })).toBeDisabled()
      await expectNoHorizontalScroll(lecturer)

      await lecturer.getByRole('link', { name: 'Mark short answers', exact: true }).click()
      await expect(lecturer).toHaveURL(new RegExp(`${livePath}/mark$`))
      await expect(lecturer.getByRole('heading', { name: SHORT.prompt })).toBeVisible()
      await expect(lecturer.getByText(SHORT.guide, { exact: true })).toBeVisible()
      await expect(lecturer.getByText('0 of 1 confirmed', { exact: true })).toBeVisible()
      await expect(lecturer.getByText('1 blank answer scores 0 by itself.', { exact: true })).toBeVisible()
      await expect(lecturer.getByRole('switch', { name: 'Hide names while marking' })).toHaveAttribute('aria-checked', 'true')

      // Only Ama wrote an answer: one card, anonymous.
      const cards = lecturer.getByRole('article')
      await expect(cards).toHaveCount(1)
      const card = cards.first()
      await expect(card.getByRole('heading', { level: 3 })).toHaveText(/^Student [12]$/)
      await expect(lecturer.getByText(AMA.name)).toHaveCount(0)
      await expect(lecturer.getByText(AMA.matricule)).toHaveCount(0)
      await expect(card.getByText('Osmosis moves water', { exact: true })).toBeVisible()
      await expect(card.getByText('To confirm', { exact: true })).toBeVisible()

      // The suggestion arrives after the page asks for it (the fake: a guide word gives full marks).
      await expect(card.getByText('AI suggestion', { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(card.getByText('Suggested 4 / 4', { exact: true })).toBeVisible()
      await expect(card.getByRole('button', { name: /^Confirm 4 for Student [12]$/ })).toBeVisible()
      // Each answer is confirmed on its own: there is no "accept all".
      await expect(lecturer.getByRole('button', { name: /accept all|confirm all|all suggestions/i })).toHaveCount(0)
      await expectNoHorizontalScroll(lecturer)
    })

    // ---- 6. The lecturer changes the mark and releases -----------------------------------------
    await test.step('lecturer changes the mark to 3 with a comment, confirms it and releases', async () => {
      const card = lecturer.getByRole('article').first()
      await card.getByLabel('Mark', { exact: true }).selectOption({ label: '3 / 4' })
      await card.getByLabel('Comment (optional)', { exact: true }).fill('Mention the membrane')
      await card.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(card.getByText('Confirmed 3 / 4', { exact: true })).toBeVisible()
      await expect(card.getByText('Mention the membrane', { exact: true })).toBeVisible()
      await expect(lecturer.getByText('1 of 1 confirmed', { exact: true })).toBeVisible()

      await lecturer.getByRole('link', { name: 'Results', exact: true }).click()
      await expect(lecturer).toHaveURL(new RegExp(`${livePath}/results$`))
      await expect(lecturer.getByRole('row', { name: new RegExp(AMA.name) })).toContainText('5 / 6')
      await expect(lecturer.getByRole('row', { name: new RegExp(BEN.name) })).toContainText('0 / 6')
      await lecturer.getByRole('button', { name: 'Release results', exact: true }).click()
      const dialog = lecturer.getByRole('dialog')
      await expect(dialog).toContainText('Students will see their marks and get an email.')
      await dialog.getByRole('button', { name: 'Release', exact: true }).click()
      await expect(lecturer.getByText(/^Results released · /)).toBeVisible()
      await expectNoHorizontalScroll(lecturer)
    })

    // ---- 7. The students' released results ----------------------------------------------------
    await test.step('Ama sees 5 / 6, "3 / 4" with the comment and no options; Ben sees 0 / 6', async () => {
      await ama.goto(testPath)
      await expect(ama.getByText('5 / 6', { exact: true })).toBeVisible()
      const questions = ama.getByRole('listitem')
      await expect(questions).toHaveCount(2)
      const short = questions.filter({ hasText: SHORT.prompt })
      await expect(short).toContainText('3 / 4')
      await expect(short.getByText('Mention the membrane', { exact: true })).toBeVisible()
      await expect(questions.filter({ hasText: MCQ.prompt })).toContainText('2 / 2')
      // Never the options, nor which one was right; never the guide.
      await expect(ama.getByText(MCQ.correct, { exact: true })).toHaveCount(0)
      await expect(ama.getByText(MCQ.wrong, { exact: true })).toHaveCount(0)
      await expect(ama.getByRole('radio')).toHaveCount(0)
      await expect(ama.getByText(SHORT.guide)).toHaveCount(0)
      await expectNoHorizontalScroll(ama)

      await ben.goto(testPath)
      await expect(ben.getByText('0 / 6', { exact: true })).toBeVisible()
      await expect(ben.getByRole('listitem').filter({ hasText: SHORT.prompt })).toContainText('0 / 4')
      await expectNoHorizontalScroll(ben)
    })

    // ---- 8. The CA's tests column --------------------------------------------------------------
    await test.step("the CA table's tests column gives Ama 8.33 / 10 and Ben 0", async () => {
      await lecturer.goto(`${courseUrl}/performance`)
      await expect(lecturer.getByRole('columnheader', { name: /^Tests/ })).toContainText('/ 10')
      await expect(lecturer.getByText(/^Tests haven't started/)).toHaveCount(0)
      const amaRow = lecturer.getByRole('row').filter({ hasText: AMA.name })
      const benRow = lecturer.getByRole('row').filter({ hasText: BEN.name })
      // 10 × 5/6, rounded to 2 decimals (one test, so its weight changes nothing).
      await expect(amaRow.locator('[data-testid^="ca-part-tests-"]')).toHaveText('8.33')
      await expect(benRow.locator('[data-testid^="ca-part-tests-"]')).toHaveText('0')
      await expectNoHorizontalScroll(lecturer)
    })
  } finally {
    await closeAll()
  }
})
