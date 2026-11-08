import { expect, test, type Locator } from '@playwright/test'
import ExcelJS from 'exceljs'
import {
  createCourse,
  createSchoolAndClass,
  EN,
  expectNoHorizontalScroll,
  joinClassAsStudent,
  readLiveCode,
  signUp,
  submitCode,
  tomorrowAt8,
  typeInEditor,
  userPages,
} from './helpers'

/**
 * Performance (continuous assessment), end to end. A lecturer (English) has a course with two
 * students. One attendance session: Alice checks in, Bob doesn't. One assignment, created after both
 * joined: Alice hands in and is graded 16/20, Bob never hands in; the grades are released.
 * The lecturer first tries 10 / 10 / 5 for a total of 30 (refused), saves 10 / 15 / 5, taps +1 three
 * times for Alice and once for Bob, then undoes the last tap. The CA page then ranks Alice first with
 * 25 / 30, and flags Bob as slipping with one piece of work missing. The Excel export lists Alice's
 * matricule first. Alice (French) sees her total and "Présence" 10 / 10; Bob is refused the export.
 *
 * The expected numbers: attendance 10 x 1 = 10, assignments 15 x 16/20 = 12, participation
 * 5 x min(1, 3/5) = 3, so Alice's final is 25 / 30; Bob has 0 everywhere.
 * One serial scenario per project (desktop, then 360 px mobile), with three fresh users each.
 */

const ALICE = { name: 'Alice Mbarga', matricule: 'PERF 001' }
const BOB = { name: 'Bob Nkoulou', matricule: 'PERF 002' }
const ANSWER = 'The subnet mask is 255.255.255.0 and the gateway is 192.168.1.1.'

test('continuous assessment: settings, participation, ranked table, export and student view', async ({
  browser,
  baseURL,
  viewport,
  userAgent,
  isMobile,
  hasTouch,
  deviceScaleFactor,
}, testInfo) => {
  const run = `${Date.now().toString(36)}-${testInfo.project.name}`
  const emailOf = (who: string) => `e2e-perf-${run}-${who}@example.test`
  const courseTitle = 'Network Security'
  const assignmentTitle = `Lab ${run}`
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
    const alice = await newUserPage({ locale: 'en-US', permissions: ['geolocation'], geolocation: campus })
    const bob = await newUserPage({ locale: 'en-US', permissions: ['geolocation'], geolocation: campus })

    let courseUrl = ''
    let assignmentUrl = ''
    let performanceUrl = ''

    // ---- 1. Set-up: school, class, course, two students ---------------------------------------
    await test.step('lecturer creates a school, a class and a course; two students join', async () => {
      await signUp(lecturer, { name: 'Lea Lecturer', email: emailOf('lecturer'), role: 'lecturer' }, EN)
      const { classUrl, studentCode } = await createSchoolAndClass(lecturer, {
        schoolName: `CA School ${run}`,
        town: 'Douala',
        className: 'HND 2 SEC',
        lat: campus.latitude,
        lng: campus.longitude,
      })
      courseUrl = await createCourse(lecturer, courseTitle)
      performanceUrl = `${courseUrl}/performance`

      await signUp(alice, { name: ALICE.name, email: emailOf('alice'), role: 'student' }, EN)
      await joinClassAsStudent(alice, classUrl, studentCode, ALICE.matricule)
      await signUp(bob, { name: BOB.name, email: emailOf('bob'), role: 'student' }, EN)
      await joinClassAsStudent(bob, classUrl, studentCode, BOB.matricule)
    })

    // ---- 2. Attendance: Alice present, Bob absent ---------------------------------------------
    await test.step('one attendance session: Alice checks in to the start window, Bob does not', async () => {
      await lecturer.goto(courseUrl)
      await lecturer.getByRole('link', { name: 'Attendance', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/courses\/[^/]+\/attendance$/)
      await lecturer.getByRole('button', { name: 'Start session', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/courses\/[^/]+\/attendance\/[^/]+$/)
      await lecturer.getByRole('button', { name: 'Open start check-in', exact: true }).click()

      await submitCode(alice, await readLiveCode(lecturer))
      await expect(alice.getByTestId('check-in-status')).toHaveText('Checked in')
      await expect(lecturer.getByTestId('attendance-count')).toContainText('1 / 2', { timeout: 15_000 })
      await lecturer.getByRole('button', { name: 'Close check-in', exact: true }).click()
      await expect(lecturer.getByTestId('attendance-code')).toHaveCount(0)
    })

    // ---- 3. Assignment (after both joined, due tomorrow): Alice 16/20, Bob nothing, released -----
    await test.step('lecturer publishes an assignment, due tomorrow', async () => {
      await lecturer.goto(courseUrl)
      await lecturer.getByRole('link', { name: 'Assignments', exact: true }).click()
      await lecturer.getByRole('link', { name: 'New assignment', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/assignments\/new$/)
      await lecturer.getByLabel('Title', { exact: true }).fill(assignmentTitle)
      await typeInEditor(lecturer, 'Instructions', 'Describe the firewall rules you chose.')
      await lecturer.getByLabel('Due date and time', { exact: true }).fill(tomorrowAt8())
      await expect(lecturer.getByLabel('Max mark', { exact: true })).toHaveValue('20')
      await lecturer.getByLabel('Students submit', { exact: true }).selectOption({ label: 'Typed answer only' })
      await lecturer.getByRole('button', { name: 'Save draft', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/assignments\/[^/]+\/edit\?created=1$/)
      await lecturer.getByRole('button', { name: 'Save changes', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/courses\/[^/]+\/assignments\/[^/]+$/)
      assignmentUrl = lecturer.url()

      await lecturer.getByRole('button', { name: 'Publish', exact: true }).click()
      const dialog = lecturer.getByRole('dialog')
      await dialog.getByRole('button', { name: 'Publish and email students', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(lecturer.getByText('Published', { exact: true })).toBeVisible()
    })

    await test.step('Alice hands in; the lecturer grades 16 / 20 and releases the grades', async () => {
      await alice.goto(courseUrl)
      await alice.getByRole('region', { name: 'My assignments' }).getByRole('link', { name: new RegExp(assignmentTitle) }).click()
      await typeInEditor(alice, 'Your answer', ANSWER)
      await alice.getByRole('button', { name: 'Submit', exact: true }).click()
      await expect(alice.getByRole('status').filter({ hasText: 'Submitted at' })).toBeVisible()

      await lecturer.goto(assignmentUrl)
      await lecturer.getByRole('link', { name: `Open the submission of ${ALICE.name}` }).click()
      await expect(lecturer).toHaveURL(/\/submissions\/[^/]+$/)
      await lecturer.getByLabel('Mark', { exact: true }).fill('16')
      await lecturer.getByRole('button', { name: 'Save grade', exact: true }).click()
      await expect(lecturer.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()

      await lecturer.goto(assignmentUrl)
      await expect(lecturer.getByRole('row').filter({ hasText: ALICE.name })).toContainText('16 / 20')
      await expect(lecturer.getByRole('row').filter({ hasText: BOB.name })).toContainText('Missing')
      await lecturer.getByRole('button', { name: 'Release grades', exact: true }).click()
      const dialog = lecturer.getByRole('dialog')
      await dialog.getByRole('button', { name: 'Release grades', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(lecturer.getByText(/Grades released /)).toBeVisible()
    })

    // ---- 4. Lecturer: the CA page and its settings -------------------------------------------
    await test.step('the course page links to the CA; the settings refuse 10 / 10 / 5 for 30', async () => {
      await lecturer.goto(courseUrl)
      await lecturer.getByRole('link', { name: 'CA', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/courses\/[^/]+\/performance$/)
      await expect(lecturer.getByRole('heading', { name: 'CA', exact: true, level: 1 })).toBeVisible()
      await expectNoHorizontalScroll(lecturer)

      await lecturer.getByLabel('CA total', { exact: true }).fill('30')
      await lecturer.getByLabel('Attendance', { exact: true }).fill('10')
      await lecturer.getByLabel('Assignments', { exact: true }).fill('10')
      await lecturer.getByLabel('Participation', { exact: true }).fill('5')
      await lecturer.getByLabel('Participation target', { exact: true }).fill('5')
      await expect(lecturer.getByText('Parts add up to 25 of 30')).toBeVisible()
      await lecturer.getByRole('button', { name: 'Save settings', exact: true }).click()
      await expect(lecturer.getByText('The parts must add up exactly to the CA total.')).toBeVisible()
      await expect(lecturer.getByText('Settings saved.')).toHaveCount(0)
      await expectNoHorizontalScroll(lecturer)
    })

    await test.step('the settings save with 10 / 15 / 5', async () => {
      await lecturer.getByLabel('Assignments', { exact: true }).fill('15')
      await expect(lecturer.getByText('Parts add up to 30 of 30')).toBeVisible()
      await lecturer.getByRole('button', { name: 'Save settings', exact: true }).click()
      await expect(lecturer.getByText('Settings saved.')).toBeVisible()
      await lecturer.reload()
      await expect(lecturer.getByLabel('Assignments', { exact: true })).toHaveValue('15')
      await expect(lecturer.getByLabel('Attendance', { exact: true })).toHaveValue('10')
      await expect(lecturer.getByLabel('Participation', { exact: true })).toHaveValue('5')
    })

    // ---- 5. Participation: three taps for Alice, one for Bob, undo the last --------------------
    await test.step('three +1 for Alice, one for Bob, then "Undo last tap" takes Bob back to 0', async () => {
      await lecturer.getByRole('link', { name: 'Participation', exact: true }).click()
      await expect(lecturer).toHaveURL(/\/performance\/participation$/)
      await expectNoHorizontalScroll(lecturer)

      const aliceRow = lecturer.getByRole('listitem').filter({ hasText: ALICE.name })
      const bobRow = lecturer.getByRole('listitem').filter({ hasText: BOB.name })
      // "Net 3" (the −1 and +1 buttons beside it add their own digits to the row's text).
      const net = (row: Locator) => row.getByText(/^Net\s*\d+$/)
      const plusAlice = lecturer.getByRole('button', { name: `+1 for ${ALICE.name}`, exact: true })
      for (let i = 1; i <= 3; i++) {
        await plusAlice.click()
        await expect(net(aliceRow)).toHaveText(`Net ${i}`)
      }
      await lecturer.getByRole('button', { name: `+1 for ${BOB.name}`, exact: true }).click()
      await expect(net(bobRow)).toHaveText('Net 1')

      await lecturer.getByRole('button', { name: 'Undo last tap', exact: true }).click()
      await expect(lecturer.getByRole('status')).toHaveText(`Undone for ${BOB.name} (net 0)`)
      await expect(net(bobRow)).toHaveText('Net 0')
      await expect(net(aliceRow)).toHaveText('Net 3')
      await expectNoHorizontalScroll(lecturer)
    })

    // ---- 6. The ranked table -------------------------------------------------------------------
    await test.step('the CA table ranks Alice first (25 / 30); Bob is slipping with 1 missing piece of work', async () => {
      await lecturer.goto(performanceUrl)
      const rows = lecturer.getByRole('row')
      // Header row, then Alice (rank 1), then Bob (rank 2).
      const aliceRow = rows.nth(1)
      const bobRow = rows.nth(2)
      await expect(aliceRow).toContainText(ALICE.name)
      await expect(aliceRow).toContainText(ALICE.matricule)
      await expect(bobRow).toContainText(BOB.name)

      // Cells: rank, attendance, assignments, participation, so far, final, missing work, flag.
      const a = aliceRow.getByRole('cell')
      await expect(a.nth(0)).toHaveText('1')
      await expect(a.nth(1)).toHaveText('10')
      await expect(a.nth(2)).toHaveText('12')
      await expect(a.nth(3)).toHaveText('3')
      await expect(a.nth(4)).toContainText('25')
      await expect(a.nth(5)).toHaveText('25')
      await expect(a.nth(6)).toHaveText('0')
      await expect(aliceRow.getByText('Slipping')).toHaveCount(0)

      const b = bobRow.getByRole('cell')
      await expect(b.nth(0)).toHaveText('2')
      await expect(b.nth(1)).toHaveText('0')
      await expect(b.nth(2)).toHaveText('0')
      await expect(b.nth(3)).toHaveText('0')
      await expect(b.nth(5)).toHaveText('0')
      await expect(b.nth(6)).toHaveText('1')
      await expect(bobRow.getByText('Slipping')).toBeVisible()
      await expect(
        bobRow.getByRole('link', { name: `1 missing piece of work for ${BOB.name}: open assignments` }),
      ).toBeVisible()
      await expect(lecturer.getByText('1 student slipping · 1 with missing work')).toBeVisible()
      await expectNoHorizontalScroll(lecturer)
    })

    // ---- 7. Export -----------------------------------------------------------------------------
    await test.step('Export to Excel downloads an .xlsx whose first data row is Alice', async () => {
      const [download] = await Promise.all([
        lecturer.waitForEvent('download'),
        lecturer.getByRole('link', { name: 'Export to Excel', exact: true }).click(),
      ])
      expect(download.suggestedFilename()).toMatch(/\.xlsx$/)
      const file = await download.path()
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.readFile(file)
      const sheet = workbook.worksheets[0]

      expect(sheet.getRow(1).values).toEqual([
        undefined,
        'Matricule',
        'Name',
        'Attendance (/10)',
        'Assignments (/15)',
        'Participation (/5)',
        'CA (/30)',
      ])
      expect(sheet.getRow(2).values).toEqual([undefined, ALICE.matricule, ALICE.name, 10, 12, 3, 25])
      expect(sheet.getRow(3).values).toEqual([undefined, BOB.matricule, BOB.name, 0, 0, 0, 0])
    })

    // ---- 8. Student view, in French; Bob is refused the export ---------------------------------
    await test.step('Alice (French) sees her total 25 and "Présence" 10 / 10', async () => {
      await alice.goto('/dashboard')
      await alice.getByRole('button', { name: 'FR', exact: true }).click()
      await expect(alice.locator('html')).toHaveAttribute('lang', 'fr')

      await alice.goto(courseUrl)
      const mine = alice.getByRole('region', { name: 'Mon CA', exact: true })
      await expect(mine).toBeVisible()
      await expect(mine.getByText('25', { exact: true })).toBeVisible()
      await expect(mine).toContainText('sur 30')
      const presence = mine.getByRole('list', { name: 'CA par partie' }).getByRole('listitem').filter({ hasText: 'Présence' })
      await expect(presence).toContainText('10 / 10')
      await expectNoHorizontalScroll(alice)

      // A student has no CA link on the course page, and no lecturer screen.
      await expect(alice.getByRole('link', { name: 'CC', exact: true })).toHaveCount(0)
    })

    await test.step('Bob requesting the export URL gets 403', async () => {
      const res = await bob.request.get(`${performanceUrl}/export`)
      expect(res.status()).toBe(403)
    })
  } finally {
    await closeAll()
  }
})
