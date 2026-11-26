import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'

let search = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/courses/c-1/timetable',
  useSearchParams: () => search,
}))
vi.mock('@/lib/auth-client', () => ({ authClient: { linkSocial: vi.fn() } }))
vi.mock('../courses/[courseId]/classroom-actions', () => ({ createClassroomAction: vi.fn() }))

import { OnlineFields, type OnlineClassroom } from './online-fields'

const t = en.schedule.online

function render(classroom: OnlineClassroom, props: { autoMeet?: boolean | null; online?: boolean } = {}) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <OnlineFields
        idPrefix="f"
        state={null}
        online={props.online ?? true}
        setOnline={() => {}}
        autoMeet={props.autoMeet === undefined ? null : props.autoMeet}
        setAutoMeet={() => {}}
        meetingUrl=""
        setMeetingUrl={() => {}}
        classroom={classroom}
      />
    </NextIntlClientProvider>,
  )
}

/** The `<input>` tag with this id, or null. */
function inputTag(html: string, id: string): string | null {
  return html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] ?? null
}

const postsAutoMeet = (html: string) => /<input[^>]*name="autoMeet"[^>]*value="on"/.test(html)
const hasLinkField = (html: string) => inputTag(html, 'f-meetingUrl') !== null
// Apostrophes come out of React as `&#x27;`.
const has = (html: string, text: string) => html.includes(text.replaceAll("'", '&#x27;'))

describe('OnlineFields', () => {
  afterEach(() => {
    search = new URLSearchParams()
  })

  it('hidden: only the pasted link, and no autoMeet posted', () => {
    const html = render({ state: 'hidden' })
    expect(hasLinkField(html)).toBe(true)
    expect(inputTag(html, 'f-use-classroom')).toBeNull()
    expect(inputTag(html, 'f-paste-link')).toBeNull()
    expect(postsAutoMeet(html)).toBe(false)
    expect(html).not.toContain('name="autoMeet"')
  })

  it('ready: the classroom is chosen by default and posts autoMeet=on', () => {
    const html = render({ state: 'ready', courseId: 'c-1', knockingConfirmed: true })
    expect(inputTag(html, 'f-use-classroom')).toContain('checked')
    expect(inputTag(html, 'f-paste-link')).not.toContain('checked')
    expect(postsAutoMeet(html)).toBe(true)
    expect(hasLinkField(html)).toBe(false)
    expect(has(html, t.useClassroom)).toBe(true)
    expect(has(html, t.pasteLink)).toBe(true)
    expect(has(html, t.quickAccessTip)).toBe(false)
  })

  it('ready: choosing the pasted link posts no autoMeet', () => {
    const html = render({ state: 'ready', courseId: 'c-1', knockingConfirmed: true }, { autoMeet: false })
    expect(inputTag(html, 'f-paste-link')).toContain('checked')
    expect(postsAutoMeet(html)).toBe(false)
    expect(hasLinkField(html)).toBe(true)
  })

  it('ready but knocking not confirmed: the Quick access tip shows', () => {
    const html = render({ state: 'ready', courseId: 'c-1', knockingConfirmed: false })
    expect(has(html, t.quickAccessTip)).toBe(true)
  })

  it('missing: the pasted link is the default and nothing is created on render', () => {
    const html = render({ state: 'missing', courseId: 'c-1', googleGranted: true })
    expect(inputTag(html, 'f-use-classroom')).not.toContain('checked')
    expect(inputTag(html, 'f-paste-link')).toContain('checked')
    expect(postsAutoMeet(html)).toBe(false)
    expect(has(html, t.createClassroom)).toBe(false)
  })

  it('missing: choosing the classroom shows "Create the classroom", with the Google note when not granted', () => {
    const granted = render({ state: 'missing', courseId: 'c-1', googleGranted: true }, { autoMeet: true })
    expect(has(granted, t.createClassroom)).toBe(true)
    expect(has(granted, t.googleNeeded)).toBe(false)
    expect(hasLinkField(granted)).toBe(false)

    const notGranted = render({ state: 'missing', courseId: 'c-1', googleGranted: false }, { autoMeet: true })
    expect(has(notGranted, t.createClassroom)).toBe(true)
    expect(has(notGranted, t.googleNeeded)).toBe(true)
  })

  it('missing, back from Google: the classroom is chosen and the button reads "Finish creating the classroom"', () => {
    search = new URLSearchParams('classroom=google')
    const html = render({ state: 'missing', courseId: 'c-1', googleGranted: true })
    expect(inputTag(html, 'f-use-classroom')).toContain('checked')
    expect(has(html, t.finishClassroom)).toBe(true)
    expect(has(html, t.createClassroom)).toBe(false)
  })

  it("only an error marked classroom=google is shown as Google's", () => {
    const missing = { state: 'missing', courseId: 'c-1', googleGranted: false } as const
    search = new URLSearchParams('error=access_denied')
    expect(has(render(missing, { autoMeet: true }), en.auth.google.cancelled)).toBe(false)

    search = new URLSearchParams('classroom=google&error=access_denied')
    const html = render(missing, { autoMeet: true })
    expect(has(html, en.auth.google.cancelled)).toBe(true)
    // The round trip failed: the button offers to start again.
    expect(has(html, t.createClassroom)).toBe(true)
  })

  it('course creation: the classroom made on save is chosen by default, with no button', () => {
    const html = render({ state: 'onSave' })
    expect(inputTag(html, 'f-use-classroom')).toContain('checked')
    expect(postsAutoMeet(html)).toBe(true)
    expect(has(html, t.createClassroom)).toBe(false)
  })

  it('shows no link choice until the class is online', () => {
    const html = render({ state: 'ready', courseId: 'c-1', knockingConfirmed: true }, { online: false })
    expect(inputTag(html, 'f-use-classroom')).toBeNull()
    expect(hasLinkField(html)).toBe(false)
    expect(postsAutoMeet(html)).toBe(false)
  })
})
