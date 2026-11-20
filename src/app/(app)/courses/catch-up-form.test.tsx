import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import { CatchUpForm, type CatchUpStudent } from './catch-up-form'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('./test-actions', () => ({ giveCatchUpAction: vi.fn(), setCatchUpStudentsAction: vi.fn() }))

/** In roster order, as getCatchUpOptions returns them. */
const roster: CatchUpStudent[] = [
  { studentId: 's-alice', name: 'Alice', matricule: 'UB1', status: 'handed_in' },
  { studentId: 's-bob', name: 'Bob', matricule: 'UB2', status: 'not_handed_in' },
  { studentId: 's-carol', name: 'Carol', matricule: null, status: 'left_early' },
  { studentId: 's-dave', name: 'Dave', matricule: 'UB4', status: 'not_joined' },
  { studentId: 's-eve', name: 'Eve', matricule: 'UB5', status: 'handed_in' },
  { studentId: 's-fred', name: 'Fred', matricule: 'UB6', status: 'not_joined' },
]

function render(props: Partial<React.ComponentProps<typeof CatchUpForm>> = {}) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <CatchUpForm
        mode="give"
        testId="t-1"
        courseId="c-1"
        students={roster}
        missedCount={3}
        answersMayBeOut={false}
        started={false}
        {...props}
      />
    </NextIntlClientProvider>,
  )
}

/** The `<input>` tag whose value is `value` (a radio's mode or a checkbox's student id). */
function inputTag(html: string, value: string): string {
  const match = html.match(new RegExp(`<input[^>]*value="${value}"[^>]*>`))
  expect(match, `input ${value}`).not.toBeNull()
  return match![0]
}

describe('CatchUpForm', () => {
  it('missed option is disabled with "Everyone sat this test" when missedCount is 0', () => {
    const html = render({ missedCount: 0 })
    expect(inputTag(html, 'missed')).toContain('disabled')
    expect(html).toContain(en.tests.catchUp.everyoneSat)
    expect(html).toContain(en.tests.catchUp.missed.replace('{count}', '0'))
    // "Only these students" stays available, and is the one chosen.
    expect(inputTag(html, 'picked')).not.toContain('disabled')
    expect(inputTag(html, 'picked')).toContain('checked')

    const someMissed = render({ missedCount: 3 })
    expect(inputTag(someMissed, 'missed')).not.toContain('disabled')
    expect(someMissed).not.toContain(en.tests.catchUp.everyoneSat)
  })

  it("picked mode lists not joined, left early and didn't hand in before handed in", () => {
    const html = render({ initial: { for: 'picked', studentIds: [] } })
    const order = roster.map((s) => s.name).sort((a, b) => html.indexOf(`>${a}<`) - html.indexOf(`>${b}<`))
    // Grouped by status; roster order kept within a group (Dave before Fred, Alice before Eve).
    expect(order).toEqual(['Dave', 'Fred', 'Carol', 'Bob', 'Alice', 'Eve'])
    expect(html).toContain(en.tests.catchUp.status.not_joined)
    expect(html).toContain(en.tests.catchUp.status.left_early)
    expect(html).toContain(en.tests.catchUp.status.handed_in)
  })

  it('after Start, picked students with an attempt cannot be unticked', () => {
    const html = render({
      mode: 'edit',
      started: true,
      initial: { for: 'picked', studentIds: ['s-dave', 's-carol'] },
      withAttempt: ['s-dave'],
    })
    const dave = inputTag(html, 's-dave')
    expect(dave).toContain('checked')
    expect(dave).toContain('disabled')
    // Carol is picked but never opened it: she can still be taken off.
    const carol = inputTag(html, 's-carol')
    expect(carol).toContain('checked')
    expect(carol).not.toContain('disabled')
    // Others can still be added.
    const fred = inputTag(html, 's-fred')
    expect(fred).not.toContain('checked')
    expect(fred).not.toContain('disabled')
    // Nor can the mode change.
    expect(inputTag(html, 'missed')).toContain('disabled')

    // Before Start, a picked student can be unticked.
    const before = render({
      mode: 'edit',
      started: false,
      initial: { for: 'picked', studentIds: ['s-dave'] },
      withAttempt: ['s-dave'],
    })
    expect(inputTag(before, 's-dave')).toContain('checked')
    expect(inputTag(before, 's-dave')).not.toContain('disabled')
    expect(inputTag(before, 'missed')).not.toContain('disabled')
  })

  it('shows the answers note only when answersMayBeOut', () => {
    expect(render({ answersMayBeOut: true })).toContain(en.tests.catchUp.answersNote)
    expect(render({ answersMayBeOut: false })).not.toContain(en.tests.catchUp.answersNote)
  })
})
