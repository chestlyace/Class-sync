import { expect, test } from '@playwright/test'
import { EN, expectNoHorizontalScroll, FR, signUp, userPages } from './helpers'

/**
 * Smoke test for the foundations: sign-up, school, shared class with join codes, courses,
 * joining as a colleague and as a student, rosters, and course access rules.
 * One serial scenario per project (desktop, then 360 px mobile), with three fresh users each.
 *
 * Lecturer A works in French, lecturer B and the student in English.
 */

test('classes, joining and courses, end to end', async ({
  browser,
  baseURL,
  viewport,
  userAgent,
  isMobile,
  hasTouch,
  deviceScaleFactor,
}, testInfo) => {
  // Sign-ups are rate-limited to 30 per minute per IP; the whole e2e run signs up 12 users, so no waiting.
  // Unique per run and project: emails, the school name (a duplicate school is a CONFLICT).
  const run = `${Date.now().toString(36)}-${testInfo.project.name}`
  const emailOf = (who: string) => `e2e-${run}-${who}@example.test`
  const schoolName = `Université Test ${run}`
  const courseA = 'Bases de données'
  const courseB = 'Networks'

  // Every user is a separate browser context (own cookies) with the project's device settings.
  const { newUserPage: newPage, closeAll } = userPages(browser, {
    baseURL,
    viewport,
    userAgent,
    isMobile,
    hasTouch,
    deviceScaleFactor,
  })

  try {
    // ---- 1. Lecturer A signs up in French, creates school, class and course -----------------
    const a = await newPage({
      locale: 'fr-FR',
      permissions: ['geolocation', 'clipboard-read', 'clipboard-write'],
      geolocation: { latitude: 4.0511, longitude: 9.7679 },
    })

    let studentCode = ''
    let lecturerCode = ''
    let classUrl = ''
    let courseAUrl = ''

    await test.step('lecturer A signs up (French) and lands on a French dashboard', async () => {
      await a.goto('/sign-up')
      await expect(a.getByRole('heading', { name: 'Créez votre compte' })).toBeVisible()
      await expect(a.getByRole('combobox', { name: FR.language })).toContainText('Français')
      await signUp(a, { name: 'Ada Lovelace', email: emailOf('a'), role: 'lecturer' }, FR)
      await expect(a.getByRole('heading', { name: 'Bonjour, Ada' })).toBeVisible()
      await expect(a.locator('html')).toHaveAttribute('lang', 'fr')
      await expect(a.getByText("Aucune classe pour l'instant")).toBeVisible()
      await expectNoHorizontalScroll(a)
    })

    await test.step('lecturer A creates the school, with the browser location', async () => {
      await a.getByRole('link', { name: 'Nouvel établissement', exact: true }).click()
      await expect(a).toHaveURL(/\/schools\/new$/)

      // Search comes first: the new name matches nothing.
      await a.getByLabel("Rechercher par nom d'établissement").fill(schoolName)
      await expect(a.getByText(`Aucun établissement ne correspond à « ${schoolName} ».`)).toBeVisible()

      await a.getByLabel("Nom de l'établissement", { exact: true }).fill(schoolName)
      await a.getByLabel('Ville', { exact: true }).fill('Douala')
      await a.getByRole('button', { name: 'Utiliser ma position actuelle' }).click()
      await expect(a.getByText(/Position enregistrée : 4\.0511/)).toBeVisible()
      await expectNoHorizontalScroll(a)
      await a.getByRole('button', { name: "Ajouter l'établissement", exact: true }).click()
      await expect(a).toHaveURL(/\/classes\/new\?schoolId=/)
      await expect(a.getByText(schoolName)).toBeVisible()
    })

    await test.step('lecturer A creates the class and reads both codes', async () => {
      await a.getByLabel('Nom de la classe', { exact: true }).fill('HND 2 SWE')
      await expectNoHorizontalScroll(a)
      await a.getByRole('button', { name: 'Créer la classe', exact: true }).click()
      await expect(a).toHaveURL(/\/classes\/[^/?]+$/)
      classUrl = a.url()
      await expect(a.getByRole('heading', { name: 'HND 2 SWE' })).toBeVisible()

      studentCode = (await a.getByTestId('student-code').innerText()).trim()
      lecturerCode = (await a.getByTestId('lecturer-code').innerText()).trim()
      expect(studentCode).toMatch(/^[A-Z2-9]{6}$/)
      expect(lecturerCode).toMatch(/^[A-Z2-9]{6}$/)
      expect(lecturerCode).not.toBe(studentCode)
      await expect(a.getByText('Code étudiant', { exact: true })).toBeVisible()
      await expect(a.getByText('Code enseignant', { exact: true })).toBeVisible()
      await expectNoHorizontalScroll(a)

      // The copy button really puts the code on the clipboard.
      await a.getByRole('button', { name: 'Copier le code étudiant' }).click()
      await expect(a.getByRole('status').filter({ hasText: 'Copié' })).toHaveCount(1)
      expect(await a.evaluate(() => navigator.clipboard.readText())).toBe(studentCode)
    })

    await test.step('lecturer A creates the course in French', async () => {
      await a.getByRole('link', { name: 'Ajouter un cours', exact: true }).click()
      await expect(a).toHaveURL(/\/courses\/new\?classId=/)
      // The class is preselected from the link.
      await expect(a.getByLabel('Classe', { exact: true }).locator('option:checked')).toContainText('HND 2 SWE')
      await a.getByLabel('Intitulé du cours', { exact: true }).fill(courseA)
      await expectNoHorizontalScroll(a)
      await a.getByRole('button', { name: 'Créer le cours', exact: true }).click()
      await expect(a).toHaveURL(/\/courses\/[^/?]+$/)
      courseAUrl = a.url()
      await expect(a.getByRole('heading', { name: courseA })).toBeVisible()
      await expect(a.getByText(/Aucun étudiant inscrit à ce cours/)).toBeVisible()
      await expectNoHorizontalScroll(a)
    })

    // ---- 2. Lecturer B joins with the lecturer code and adds a course ----------------------
    const b = await newPage({ locale: 'en-US' })
    await test.step('lecturer B signs up and joins with the lecturer code', async () => {
      await signUp(b, { name: 'Bernard Tabi', email: emailOf('b'), role: 'lecturer' }, EN)
      await expect(b.getByRole('heading', { name: 'Hello, Bernard' })).toBeVisible()
      await b.getByRole('link', { name: 'Join a class as lecturer', exact: true }).click()
      await expect(b).toHaveURL(/\/join$/)
      await expect(b.getByLabel('Matricule')).toHaveCount(0) // lecturers enter the code only
      await b.getByLabel('Class code', { exact: true }).fill(lecturerCode)
      await expectNoHorizontalScroll(b)
      await b.getByRole('button', { name: 'Join class', exact: true }).click()
      await expect(b).toHaveURL(classUrl)
      await expect(b.getByRole('heading', { name: 'HND 2 SWE' })).toBeVisible()
    })

    await test.step('lecturer B creates the course "Networks" in the same class', async () => {
      await b.getByRole('link', { name: 'Add a course', exact: true }).click()
      await expect(b).toHaveURL(/\/courses\/new\?classId=/)
      await b.getByLabel('Course title', { exact: true }).fill(courseB)
      await b.getByRole('button', { name: 'Create course', exact: true }).click()
      await expect(b).toHaveURL(/\/courses\/[^/?]+$/)
      await expect(b.getByRole('heading', { name: courseB })).toBeVisible()
    })

    // ---- 3. Student joins: lowercase code with a space, matricule "ict 001" ---------------
    const s = await newPage({ locale: 'en-US' })
    await test.step('student signs up and joins with a sloppy code and matricule', async () => {
      await signUp(s, { name: 'Sam Student', email: emailOf('s'), role: 'student' }, EN)
      await expect(s.getByRole('heading', { name: 'Hello, Sam' })).toBeVisible()
      await s.getByRole('link', { name: 'Join a class', exact: true }).click()
      await expect(s).toHaveURL(/\/join$/)
      const sloppy = `${studentCode.slice(0, 3)} ${studentCode.slice(3)}`.toLowerCase()
      await s.getByLabel('Class code', { exact: true }).fill(sloppy)
      await s.getByLabel('Matricule', { exact: true }).fill('ict 001')
      await expectNoHorizontalScroll(s)
      await s.getByRole('button', { name: 'Join class', exact: true }).click()
      await expect(s).toHaveURL(classUrl)
      await expect(s.getByRole('heading', { name: 'HND 2 SWE' })).toBeVisible()
      // A student sees the class's courses but never its codes.
      await expect(s.getByRole('heading', { name: 'Courses in this class' })).toBeVisible()
      await expect(s.getByText('Student code')).toHaveCount(0)
    })

    // ---- 4. Student dashboard lists both courses -------------------------------------------
    await test.step('student dashboard lists both lecturers\' courses', async () => {
      await s.goto('/dashboard')
      await expect(s.getByRole('heading', { name: schoolName })).toBeVisible()
      await expect(s.getByRole('link', { name: new RegExp(courseA) })).toContainText('With Ada Lovelace')
      await expect(s.getByRole('link', { name: new RegExp(courseB) })).toContainText('With Bernard Tabi')
      await expectNoHorizontalScroll(s)
    })

    await test.step('a signed-in student is sent from sign-in to the dashboard; unknown pages 404', async () => {
      await s.goto('/sign-in')
      await expect(s).toHaveURL(/\/dashboard$/)
      await s.goto('/sign-up')
      await expect(s).toHaveURL(/\/dashboard$/)
      const res = await s.goto('/no-such-page')
      expect(res?.status()).toBe(404)
      await expect(s.getByRole('heading', { name: 'Page not found' })).toBeVisible()
      await expectNoHorizontalScroll(s)
    })

    // ---- 5. Rosters and access --------------------------------------------------------------
    await test.step("lecturer A's course roster shows the student with the normalised matricule", async () => {
      await a.goto(courseAUrl)
      await expect(a.getByRole('heading', { name: 'Liste des étudiants · 1 étudiant' })).toBeVisible()
      await expect(a.getByText('Sam Student', { exact: true })).toBeVisible()
      await expect(a.getByText('ICT 001', { exact: true })).toBeVisible()
      await expectNoHorizontalScroll(a)
    })

    await test.step("lecturer B opening A's course sees the translated FORBIDDEN message", async () => {
      await b.goto(courseAUrl)
      await expect(b.getByText("You don't have permission to do that.")).toBeVisible()
      await expect(b.getByText('Sam Student')).toHaveCount(0)
      await expect(b.getByRole('heading', { name: courseA })).toHaveCount(0)
    })
  } finally {
    await closeAll()
  }
})
