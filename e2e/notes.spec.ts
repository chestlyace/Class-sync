import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import {
  createCourse,
  createSchoolAndClass,
  EN,
  expectNoHorizontalScroll,
  joinClassAsStudent,
  signUp,
  typeInEditor,
  userPages,
} from './helpers'

/**
 * Notes, sharing and practice, end to end. A lecturer with two classes and a "Database Systems"
 * course in each makes the topics "Normalisation" and "SQL joins" (hiding the second), writes a note
 * (a heading, a bullet and a 300-character line of code), adds a link and uploads slides, shares the
 * note to the other course and renames it there. Practice for "Normalisation": one multiple choice
 * and one short answer with a guide. A student of the first class sees only "Normalisation", with
 * NEW pills; reads the note (no sideways scroll), which clears its NEW; searches; practises and
 * misses both questions. The lecturer then runs an MCQ-only test and brings it into the topic: it
 * is WAITING until the answers' 2-minute grace has passed, then the student practises 3 questions.
 * The student opening the hidden topic's practice URL directly is turned away.
 * One serial scenario per project (desktop, then 360 px mobile), with two fresh users each.
 */

const SLIDES = path.join(__dirname, 'fixtures', 'slides.pptx')

const COURSE = 'Database Systems'
const LINK_URL = 'https://www.geeksforgeeks.org/dbms/'
/** One code line, 300 characters, no spaces: it can't wrap, so a narrow screen must scroll inside the code box. */
const LONG_CODE = `SELECT_${'a'.repeat(293)}`

const MCQ = { prompt: 'Which normal form removes partial dependencies?', right: 'Second normal form', wrong: 'First normal form' }
const SHORT = {
  prompt: 'Why split a table that repeats customer data?',
  guide: 'To avoid update anomalies: a fact is changed once, in one place.',
  answer: 'Less repetition.',
}

/** The answers' grace after the end (ANSWER_GRACE_MS) plus a margin. */
const GRACE_WAIT_MS = 120_000 + 30_000

const topicCard = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true })

/** English UI, on a course's notes page: the "New topic" dialog. */
async function createTopic(page: Page, title: string) {
  await page.getByRole('button', { name: 'New topic', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Topic title', { exact: true }).fill(title)
  await dialog.getByRole('button', { name: 'Create topic', exact: true }).click()
  await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible()
}

/** On a topic card, follows "Write a note" / "Upload a file" / "Add a link" and fills the title. */
async function openAddForm(page: Page, topic: string, add: string, title: string) {
  await topicCard(page, topic).getByRole('link', { name: add, exact: true }).click()
  await expect(page).toHaveURL(/\/notes\/new\?topic=/)
  await page.getByLabel('Title', { exact: true }).fill(title)
}

/** Saves an item form and waits for the notes page to come back. */
async function saveItem(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page).toHaveURL(/\/courses\/[^/]+\/notes$/)
}

/** On the student's practice page: answers whichever question is shown, wrongly. */
async function missShownQuestion(page: Page, isLast: boolean) {
  const prompt = (await page.getByRole('heading', { level: 2 }).first().innerText()).trim()
  if (prompt === MCQ.prompt) {
    await page.getByRole('button', { name: MCQ.wrong, exact: true }).click()
    await expect(page.getByText('Not quite.', { exact: true })).toBeVisible()
    await expect(page.getByText('Right answer', { exact: true })).toBeVisible()
    await expectNoHorizontalScroll(page)
    await page.getByRole('button', { name: isLast ? 'See my score' : 'Next question', exact: true }).click()
  } else {
    expect(prompt).toBe(SHORT.prompt)
    await page.getByLabel('Your answer', { exact: true }).fill(SHORT.answer)
    await page.getByRole('button', { name: 'Check my answer', exact: true }).click()
    await expect(page.getByText(SHORT.guide, { exact: true })).toBeVisible()
    await expectNoHorizontalScroll(page)
    await page.getByRole('button', { name: 'Not yet', exact: true }).click()
  }
}

test('notes, sharing and practice', async ({
  browser,
  baseURL,
  viewport,
  userAgent,
  isMobile,
  hasTouch,
  deviceScaleFactor,
}, testInfo) => {
  // The scenario waits out the 2-minute answer grace once (the practice set held for the test).
  test.setTimeout(420_000)

  const run = `${Date.now().toString(36)}-${testInfo.project.name}`
  const emailOf = (who: string) => `e2e-nts-${run}-${who}@example.test`
  const testTitle = `CA 1 databases ${run}`
  const campus = { latitude: 4.1527, longitude: 9.241 }
  const otherCampus = { latitude: 3.848, longitude: 11.5021 }

  const { newUserPage, closeAll } = userPages(browser, { baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor })

  try {
    const lecturer = await newUserPage({ locale: 'en-US', permissions: ['geolocation'], geolocation: campus })
    const student = await newUserPage({ locale: 'en-US' })

    let course1 = ''
    let course2 = ''
    let hiddenPracticeHref = ''
    let practiceHref = ''
    let noteTitle = 'Why normalise'

    // ---- Set-up: two classes, a course in each; the student joins the first class ---------------
    await test.step('lecturer creates two classes with a "Database Systems" course each; the student joins class 1', async () => {
      await signUp(lecturer, { name: 'Lea Lecturer', email: emailOf('lecturer'), role: 'lecturer' }, EN)
      const first = await createSchoolAndClass(lecturer, {
        schoolName: `Notes School A ${run}`,
        town: 'Douala',
        className: 'HND 2 SWE',
        lat: campus.latitude,
        lng: campus.longitude,
      })
      course1 = await createCourse(lecturer, COURSE)

      await lecturer.context().setGeolocation(otherCampus)
      await lecturer.goto('/dashboard')
      await createSchoolAndClass(lecturer, {
        schoolName: `Notes School B ${run}`,
        town: 'Yaoundé',
        className: 'HND 1 NET',
        lat: otherCampus.latitude,
        lng: otherCampus.longitude,
      })
      course2 = await createCourse(lecturer, COURSE)

      await signUp(student, { name: 'Sam Student', email: emailOf('student'), role: 'student' }, EN)
      await joinClassAsStudent(student, first.classUrl, first.studentCode, 'nts 001')
    })

    // ---- 1. Topics: a place to share into, then Normalisation and the hidden SQL joins ----------
    await test.step('topics: "Week 1" in course 2; "Normalisation" and a hidden "SQL joins" in course 1', async () => {
      await lecturer.goto(`${course2}/notes`)
      await expect(lecturer.getByRole('heading', { level: 1, name: 'Notes and resources' })).toBeVisible()
      await expect(lecturer.getByText('No topics yet.', { exact: false })).toBeVisible()
      await createTopic(lecturer, 'Week 1')

      await lecturer.goto(course1)
      await lecturer.getByRole('link', { name: 'Notes', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/courses\/[^/]+\/notes$/)
      await createTopic(lecturer, 'Normalisation')
      await createTopic(lecturer, 'SQL joins')

      await lecturer.getByRole('button', { name: 'Options for the topic SQL joins', exact: true }).click()
      await lecturer.getByRole('menuitem', { name: 'Hide from students', exact: true }).click()
      await expect(topicCard(lecturer, 'SQL joins').getByText('Hidden from students', { exact: true })).toBeVisible()
      await expect(topicCard(lecturer, 'Normalisation').getByText('Hidden from students')).toHaveCount(0)
      await expectNoHorizontalScroll(lecturer)
    })

    // ---- 2. A note, a link and a file in Normalisation ------------------------------------------
    await test.step('lecturer writes a note: a heading, a bullet and a 300-character line of code', async () => {
      await openAddForm(lecturer, 'Normalisation', 'Write a note', noteTitle)
      await typeInEditor(lecturer, 'Note', '# Anomalies and keys\nSplit the table once a fact repeats.\n')
      // "- " starts a bullet; Enter on the empty bullet leaves the list; "``` " starts a code block.
      await lecturer.keyboard.type('- Update anomaly\n\n``` ')
      await lecturer.keyboard.type(LONG_CODE)
      await expectNoHorizontalScroll(lecturer)
      await saveItem(lecturer)
      const row = topicCard(lecturer, 'Normalisation').getByRole('listitem').filter({ hasText: noteTitle })
      await expect(row.getByText('Note', { exact: true })).toBeVisible()
      await expect(row).toContainText('Written here')
    })

    await test.step('lecturer adds a link and uploads slides.pptx', async () => {
      await openAddForm(lecturer, 'Normalisation', 'Add a link', 'GeeksforGeeks, databases')
      await lecturer.getByLabel('Web address', { exact: true }).fill(LINK_URL)
      await saveItem(lecturer)
      const linkRow = topicCard(lecturer, 'Normalisation').getByRole('listitem').filter({ hasText: 'GeeksforGeeks, databases' })
      await expect(linkRow.getByText('Link', { exact: true })).toBeVisible()
      await expect(linkRow).toContainText('geeksforgeeks.org')

      await openAddForm(lecturer, 'Normalisation', 'Upload a file', 'Lecture 1 slides')
      await lecturer.locator('input[type="file"]').setInputFiles(SLIDES)
      await expect(lecturer.getByRole('link', { name: 'slides.pptx', exact: true })).toBeVisible()
      await expectNoHorizontalScroll(lecturer)
      await saveItem(lecturer)
      const fileRow = topicCard(lecturer, 'Normalisation').getByRole('listitem').filter({ hasText: 'Lecture 1 slides' })
      await expect(fileRow.getByText('File', { exact: true })).toBeVisible()
      await expect(fileRow).toContainText('PPTX')
      await expectNoHorizontalScroll(lecturer)
    })

    // ---- 3. Share to course 2; an edit shows up there -------------------------------------------
    await test.step('the note is shared to the second course; renaming it in course 1 renames it in course 2', async () => {
      await lecturer.getByRole('button', { name: `Options for ${noteTitle}`, exact: true }).click()
      await lecturer.getByRole('menuitem', { name: 'Share to another course', exact: true }).click()
      const dialog = lecturer.getByRole('dialog')
      await expect(dialog.getByLabel('Course', { exact: true })).toHaveValue(/.+/)
      await expect(dialog.getByLabel('Topic', { exact: true })).toBeEnabled()
      await expect(dialog.getByRole('option', { name: 'Week 1', exact: true })).toHaveCount(1)
      await dialog.getByRole('button', { name: 'Share', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      const row = topicCard(lecturer, 'Normalisation').getByRole('listitem').filter({ hasText: noteTitle })
      await expect(row).toContainText('Also in 1 other course')

      await lecturer.getByRole('button', { name: `Options for ${noteTitle}`, exact: true }).click()
      await lecturer.getByRole('menuitem', { name: 'Edit', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/notes\/[^/]+\/edit$/)
      noteTitle = 'Why we normalise'
      await lecturer.getByLabel('Title', { exact: true }).fill(noteTitle)
      await saveItem(lecturer)
      await expect(topicCard(lecturer, 'Normalisation').getByText(noteTitle, { exact: true })).toBeVisible()

      await lecturer.goto(`${course2}/notes`)
      const shared = topicCard(lecturer, 'Week 1')
      await expect(shared.getByText(noteTitle, { exact: true })).toBeVisible()
      await expect(shared).toContainText('Also in 1 other course')
      await expectNoHorizontalScroll(lecturer)
    })

    // ---- 4. Practice questions in Normalisation -------------------------------------------------
    await test.step('lecturer adds a multiple choice and a short answer with a guide to Normalisation', async () => {
      await lecturer.goto(`${course1}/notes`)
      hiddenPracticeHref = (await topicCard(lecturer, 'SQL joins').getByRole('link', { name: 'Add practice questions' }).getAttribute('href')) ?? ''
      expect(hiddenPracticeHref).toMatch(/\/notes\/topics\/[^/]+\/practice$/)

      await topicCard(lecturer, 'Normalisation').getByRole('link', { name: 'Add practice questions', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/notes\/topics\/[^/]+\/practice$/)
      practiceHref = new URL(lecturer.url()).pathname
      await expect(lecturer.getByText('No practice questions yet.', { exact: false })).toBeVisible()

      await lecturer.getByRole('button', { name: 'Add multiple choice', exact: true }).click()
      await lecturer.getByLabel('Question', { exact: true }).fill(MCQ.prompt)
      await lecturer.getByLabel('Option 1', { exact: true }).fill(MCQ.wrong)
      await lecturer.getByLabel('Option 2', { exact: true }).fill(MCQ.right)
      await lecturer.getByLabel('Option 2 is the right answer', { exact: true }).check()
      await expectNoHorizontalScroll(lecturer)
      await lecturer.getByRole('button', { name: 'Add question', exact: true }).click()
      await expect(lecturer.getByText(MCQ.prompt, { exact: true })).toBeVisible()
      await expect(lecturer.getByText('Right answer', { exact: true })).toBeVisible()

      await lecturer.getByRole('button', { name: 'Add short answer', exact: true }).click()
      await lecturer.getByLabel('Question', { exact: true }).fill(SHORT.prompt)
      await lecturer.getByLabel('Model answer · shown to students after they answer', { exact: true }).fill(SHORT.guide)
      await lecturer.getByRole('button', { name: 'Add question', exact: true }).click()
      await expect(lecturer.getByText(SHORT.prompt, { exact: true })).toBeVisible()
      await expect(lecturer.getByText('2 questions', { exact: true }).first()).toBeVisible()
      await expectNoHorizontalScroll(lecturer)
    })

    // ---- 5. The student's notes -----------------------------------------------------------------
    await test.step('the student sees only "Normalisation", every item NEW; reading the note clears its NEW', async () => {
      await student.goto(course1)
      await student.getByRole('link', { name: 'Open notes', exact: true }).click()
      await expect(student).toHaveURL(/\/courses\/[^/]+\/notes$/)
      await expect(student.getByRole('heading', { level: 2, name: '1 · Normalisation', exact: true })).toBeVisible()
      await expect(student.getByText('SQL joins')).toHaveCount(0)
      expect(await student.content()).not.toContain('SQL joins')
      await expect(student.getByText('New', { exact: true })).toHaveCount(3)
      await expect(student.getByText('Practise this topic', { exact: true })).toBeVisible()
      await expectNoHorizontalScroll(student)

      await student.getByRole('link', { name: new RegExp(`^${noteTitle}`) }).click()
      await expect(student).toHaveURL(/\/notes\/[^/]+$/)
      await expect(student.getByRole('heading', { level: 1, name: noteTitle })).toBeVisible()
      await expect(student.getByText('Anomalies and keys', { exact: true })).toBeVisible()
      await expect(student.getByText(LONG_CODE, { exact: true })).toBeVisible()
      await expectNoHorizontalScroll(student)
      // The code box scrolls on its own (a phone is narrower than the line), the page doesn't.
      const code = student.locator('pre').filter({ hasText: LONG_CODE })
      await expect(code).toHaveCount(1)
      const box = await code.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, overflowX: getComputedStyle(el).overflowX }))
      expect(box.scroll).toBeGreaterThan(box.client)
      expect(['auto', 'scroll']).toContain(box.overflowX)

      await student.getByRole('link', { name: 'All notes', exact: true }).first().click()
      await expect(student).toHaveURL(/\/courses\/[^/]+\/notes$/)
      await expect(student.getByText('New', { exact: true })).toHaveCount(2)
      await expect(
        student.getByRole('listitem').filter({ hasText: noteTitle }).getByText('New', { exact: true }),
      ).toHaveCount(0)
    })

    await test.step('searching "normal" finds the note', async () => {
      await student.getByRole('searchbox', { name: "Search this course's notes" }).fill('normal')
      await student.getByRole('button', { name: 'Search', exact: true }).click()
      await expect(student).toHaveURL(/[?&]q=normal/)
      await expect(student.getByText(noteTitle, { exact: true })).toBeVisible()
      await expect(student.getByText('Lecture 1 slides')).toHaveCount(0)
      await expect(student.getByText('GeeksforGeeks, databases')).toHaveCount(0)
      await expectNoHorizontalScroll(student)
      await student.getByRole('link', { name: 'Clear search', exact: true }).click()
      await expect(student).toHaveURL(/\/courses\/[^/]+\/notes$/)
    })

    // ---- 6. The student practises and misses both -----------------------------------------------
    await test.step('practice: the wrong option, then a short answer marked "Not yet": 0 / 2', async () => {
      await student.getByRole('link', { name: /^Practise this topic/ }).click()
      await expect(student).toHaveURL(/\/notes\/topics\/[^/]+\/practice$/)
      await expect(student.getByText('2 questions. Your results are private', { exact: false })).toBeVisible()
      await expectNoHorizontalScroll(student)
      await student.getByRole('button', { name: 'Start, all 2', exact: true }).click()
      await expect(student.getByText(/^Question 1 of 2$/)).toBeVisible()
      await missShownQuestion(student, false)
      await expect(student.getByText(/^Question 2 of 2$/)).toBeVisible()
      await missShownQuestion(student, true)

      await expect(student.getByText('0 / 2', { exact: true })).toBeVisible()
      await expect(student.getByRole('button', { name: 'Practise the 2 I missed', exact: true })).toBeVisible()
      await expectNoHorizontalScroll(student)
    })

    // ---- 7. Bringing a finished test into the topic ---------------------------------------------
    await test.step('lecturer runs an MCQ-only test in course 1 and ends it', async () => {
      await lecturer.goto(course1)
      await lecturer.getByRole('link', { name: 'Tests', exact: true }).click()
      await lecturer.getByRole('link', { name: 'New test', exact: true }).first().click()
      await expect(lecturer).toHaveURL(/\/tests\/new$/)
      await lecturer.getByLabel('Title', { exact: true }).fill(testTitle)
      const card = lecturer.getByRole('region', { name: /^Question 1 · Multiple choice/ })
      await card.getByLabel('Question', { exact: true }).fill('What does SQL stand for?')
      await card.getByLabel('Option 1', { exact: true }).fill('Structured Query Language')
      await card.getByLabel('Option 2', { exact: true }).fill('Simple Query Logic')
      await card.getByLabel('Option 1 is the correct answer', { exact: true }).check()
      await lecturer.getByRole('button', { name: 'Save and get the link', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/courses\/[^/]+\/tests\/(?!new$)[^/]+$/)
      await expect(lecturer.getByRole('heading', { name: testTitle })).toBeVisible()

      await lecturer.getByRole('button', { name: 'Start test', exact: true }).click()
      await lecturer.getByRole('dialog').getByRole('button', { name: 'Start now', exact: true }).click()
      await expect(lecturer.getByText('Running', { exact: true }).first()).toBeVisible()
      await lecturer.getByRole('button', { name: 'End test for everyone', exact: true }).click()
      await lecturer.getByRole('dialog').getByRole('button', { name: 'End test', exact: true }).click()
      await expect(lecturer.getByText('The test has ended.', { exact: false })).toBeVisible()
    })

    await test.step('the ended test is brought into Normalisation and waits', async () => {
      await lecturer.goto(practiceHref)
      await lecturer.getByLabel('Finished test', { exact: true }).selectOption({ label: testTitle })
      await lecturer.getByRole('button', { name: 'Copy questions into this topic', exact: true }).click()
      await expect(lecturer.getByRole('status').filter({ hasText: '1 question copied.' })).toBeVisible()
      await expect(lecturer.getByText('Waiting', { exact: true })).toBeVisible()
      await expect(lecturer.getByText('Hidden from students until the results of', { exact: false })).toBeVisible()
      await expectNoHorizontalScroll(lecturer)

      await lecturer.goto(`${course1}/notes`)
      await expect(topicCard(lecturer, 'Normalisation').getByText('Waiting', { exact: true })).toBeVisible()
      await expect(topicCard(lecturer, 'Normalisation')).toContainText('Held until the test results are released.')

      // Held questions are not sent to the student: still the 2 written here.
      await student.goto(practiceHref)
      await expect(student.getByText('2 questions. Your results are private', { exact: false })).toBeVisible()
    })

    await test.step('after the 2-minute grace the pill is gone and the student practises 3 questions', async () => {
      await expect(async () => {
        await lecturer.reload()
        await expect(topicCard(lecturer, 'Normalisation').getByText('Practice questions · 3 questions', { exact: true })).toBeVisible()
        await expect(topicCard(lecturer, 'Normalisation').getByText('Waiting', { exact: true })).toHaveCount(0)
      }).toPass({ timeout: GRACE_WAIT_MS, intervals: [5_000] })
      await expectNoHorizontalScroll(lecturer)

      await student.goto(practiceHref)
      await expect(student.getByText('3 questions. Your results are private', { exact: false })).toBeVisible()
      await expect(student.getByRole('button', { name: 'Start, all 3', exact: true })).toBeVisible()
      await expect(student.getByRole('button', { name: 'Practise the ones I missed last time (2)', exact: true })).toBeVisible()
      await expectNoHorizontalScroll(student)
    })

    // ---- 8. The hidden topic stays hidden -------------------------------------------------------
    await test.step("the student opening the hidden topic's practice URL directly gets the error state", async () => {
      await student.goto(hiddenPracticeHref)
      // (Next's route announcer is a second role=alert on every page.)
      const alert = student.getByRole('alert').filter({ hasText: "Can't open this page" })
      await expect(alert).toContainText("You don't have permission to do that.")
      await expect(student.getByText('SQL joins')).toHaveCount(0)
      expect(await student.content()).not.toContain('SQL joins')
      await expectNoHorizontalScroll(student)
    })
  } finally {
    await closeAll()
  }
})
