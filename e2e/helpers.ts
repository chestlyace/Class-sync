import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

/** Shared by the e2e scenarios: one browser context per user, sign-up, and the school/class/course set-up. */

export const PASSWORD = 'correct-horse-battery-9'

export type Role = 'lecturer' | 'student'

/** Only the strings the scenarios type or assert, in the language each user works in. */
export const FR = {
  name: 'Nom complet',
  email: 'Adresse e-mail',
  password: 'Mot de passe',
  language: 'Langue',
  submit: 'Créer mon compte',
  role: { lecturer: 'Je suis enseignant', student: 'Je suis étudiant' },
} as const
export const EN = {
  name: 'Full name',
  email: 'Email address',
  password: 'Password',
  language: 'Language',
  submit: 'Create account',
  role: { lecturer: "I'm a lecturer", student: "I'm a student" },
} as const

/** A page must never scroll sideways, at 360 px least of all. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0)
}

export async function signUp(
  page: Page,
  user: { name: string; email: string; role: Role },
  text: typeof FR | typeof EN,
) {
  await page.goto('/sign-up')
  await page.getByLabel(text.name, { exact: true }).fill(user.name)
  await page.getByLabel(text.email, { exact: true }).fill(user.email)
  await page.getByLabel(text.password, { exact: true }).fill(PASSWORD)
  await page.getByLabel(text.role[user.role], { exact: true }).check()
  await expectNoHorizontalScroll(page)
  await page.getByRole('button', { name: text.submit, exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

/** The project's device settings (desktop or 360 px phone), applied to every user's context. */
export type Device = {
  baseURL: string | undefined
  viewport: { width: number; height: number } | null
  userAgent: string | undefined
  isMobile: boolean | undefined
  hasTouch: boolean | undefined
  deviceScaleFactor: number | undefined
}

/** Every user is a separate browser context (own cookies, own geolocation) with the project's device settings. */
export function userPages(browser: Browser, device: Device) {
  const contexts: BrowserContext[] = []
  return {
    async newUserPage(extra: Parameters<Browser['newContext']>[0]): Promise<Page> {
      const context = await browser.newContext({
        ...device,
        viewport: device.viewport ?? undefined,
        ...extra,
      })
      contexts.push(context)
      return context.newPage()
    },
    async closeAll() {
      await Promise.all(contexts.map((c) => c.close()))
    },
  }
}

/** English UI: the lecturer adds a school with the browser's (emulated) location, then a class. Returns the class URL and both codes. */
export async function createSchoolAndClass(
  page: Page,
  opts: { schoolName: string; town: string; className: string; lat: number; lng: number },
) {
  await page.getByRole('link', { name: 'New school', exact: true }).click()
  await expect(page).toHaveURL(/\/schools\/new$/)
  await page.getByLabel('School name', { exact: true }).fill(opts.schoolName)
  await page.getByLabel('Town', { exact: true }).fill(opts.town)
  await page.getByRole('button', { name: 'Use my current location' }).click()
  await expect(page.getByText(new RegExp(`Location set: ${opts.lat}`))).toBeVisible()
  await expectNoHorizontalScroll(page)
  await page.getByRole('button', { name: 'Add school', exact: true }).click()
  await expect(page).toHaveURL(/\/classes\/new\?schoolId=/)

  await page.getByLabel('Class name', { exact: true }).fill(opts.className)
  await page.getByRole('button', { name: 'Create class', exact: true }).click()
  await expect(page).toHaveURL(/\/classes\/[^/?]+$/)
  await expect(page.getByRole('heading', { name: opts.className })).toBeVisible()
  return {
    classUrl: page.url(),
    studentCode: (await page.getByTestId('student-code').innerText()).trim(),
    lecturerCode: (await page.getByTestId('lecturer-code').innerText()).trim(),
  }
}

/** English UI, on a class page: adds a course to the class. Returns the course URL. */
export async function createCourse(page: Page, title: string) {
  await page.getByRole('link', { name: 'Add a course', exact: true }).click()
  await expect(page).toHaveURL(/\/courses\/new\?classId=/)
  await page.getByLabel('Course title', { exact: true }).fill(title)
  await page.getByRole('button', { name: 'Create course', exact: true }).click()
  await expect(page).toHaveURL(/\/courses\/[^/?]+$/)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  return page.url()
}

/** English UI, signed-in student: joins a class with its student code and a matricule. */
export async function joinClassAsStudent(page: Page, classUrl: string, code: string, matricule: string) {
  await page.goto('/join')
  await page.getByLabel('Class code', { exact: true }).fill(code)
  await page.getByLabel('Matricule', { exact: true }).fill(matricule)
  await page.getByRole('button', { name: 'Join class', exact: true }).click()
  await expect(page).toHaveURL(classUrl)
}

/** The app's time zone (APP_TIME_ZONE is unset for e2e, so the default applies). */
export const APP_TIME_ZONE = 'Africa/Douala'

/**
 * Tomorrow at 08:00 in the app's time zone, as a `datetime-local` value (YYYY-MM-DDTHH:mm): the
 * form reads it in that zone, so "tomorrow" must be too, whatever the machine's own zone.
 */
export function tomorrowAt8(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE, dateStyle: 'short' }).format(new Date())
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 24 * 60 * 60 * 1000)
  return `${tomorrow.toISOString().slice(0, 10)}T08:00`
}

/** Clicks into a BlockNote editor (found by the aria-label on its contenteditable) and types. */
export async function typeInEditor(page: Page, label: string, text: string) {
  const editor = page.locator(`[contenteditable="true"][aria-label="${label}"]`)
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.type(text)
  return editor
}

export const CODE = /^[A-Z0-9]{6}$/

/** The code on the lecturer's screen: waits until it is a real code, not the placeholder dashes. */
export async function readLiveCode(lecturer: Page): Promise<string> {
  const code = lecturer.getByTestId('attendance-code')
  await expect(code).toHaveText(CODE)
  return (await code.innerText()).trim()
}

/**
 * The student's check-in confirmation: a status region that is always on the card (so its text
 * is announced) and keeps "Checked in" across the refresh that follows a check-in.
 */
export async function expectCheckedIn(student: Page) {
  const status = student.getByTestId('check-in-status')
  await expect(status).toHaveAttribute('role', 'status')
  await expect(status).toHaveText('Checked in')
}

/** Student side: enter a code on /check-in and submit. */
export async function submitCode(student: Page, code: string) {
  await student.goto('/check-in')
  await student.getByLabel('Code on the screen', { exact: true }).fill(code)
  await student.getByRole('button', { name: 'Check in', exact: true }).click()
}
