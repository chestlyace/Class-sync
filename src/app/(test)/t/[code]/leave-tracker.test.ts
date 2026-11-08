import { describe, expect, it } from 'vitest'
import { createLeaveTracker, FOCUS_QUIET_MS, MAX_AWAY_MS, type LeaveEvent, type LeaveSignal } from './leave-tracker'

const phone = { countsFocus: false, countsFullscreen: false }
const laptop = { countsFocus: true, countsFullscreen: true }
type Device = typeof phone

function ids() {
  let n = 0
  return () => `exit-${++n}`
}

/** Feeds the signals at time 0 and returns every event the tracker emitted. */
function run(device: Device, signals: LeaveSignal[]): LeaveEvent[] {
  const tracker = createLeaveTracker({ ...device, now: () => 0, newId: ids(), openExit: null, armed: true })
  return signals.map((s) => tracker.handle(s)).filter((e): e is LeaveEvent => e !== null)
}

/** Feeds timed signals and returns the absence of the first `back`. */
function awayOf(device: Device, signals: [LeaveSignal, number][]): number | undefined {
  let t = 0
  const tracker = createLeaveTracker({ ...device, now: () => t, newId: ids(), openExit: null, armed: true })
  const events: LeaveEvent[] = []
  for (const [signal, at] of signals) {
    t = at
    const event = tracker.handle(signal)
    if (event) events.push(event)
  }
  const back = events.find((e) => e.type === 'back')
  return back?.type === 'back' ? back.awayMs : undefined
}

describe('leave tracker on a phone', () => {
  it('a blur without hidden (notification shade, call banner) is not an exit', () => {
    expect(run(phone, ['blur', 'focus'])).toEqual([])
    expect(run(phone, ['blur'])).toEqual([])
  })

  it('leaving full screen does not count on a phone', () => {
    expect(run(phone, ['fullscreen_exit', 'fullscreen_enter'])).toEqual([])
  })

  it('the page becoming hidden is one exit, visible again is the return', () => {
    expect(run(phone, ['hidden', 'visible']).map((e) => e.type)).toEqual(['left', 'back'])
  })

  it('a blur around a real switch still makes one exit', () => {
    expect(run(phone, ['blur', 'hidden', 'pagehide', 'visible', 'focus']).map((e) => e.type)).toEqual(['left', 'back'])
  })

  it('pagehide alone (no visibilitychange) is an exit', () => {
    expect(run(phone, ['pagehide']).map((e) => e.type)).toEqual(['left'])
  })
})

describe('leave tracker on a laptop', () => {
  it('one switch firing blur, hidden and pagehide is one exit', () => {
    expect(run(laptop, ['blur', 'hidden', 'pagehide', 'visible', 'focus']).map((e) => e.type)).toEqual([
      'left',
      'back',
    ])
  })

  it('Alt-Tab (blur then focus) is one exit', () => {
    expect(run(laptop, ['blur', 'focus']).map((e) => e.type)).toEqual(['left', 'back'])
  })

  it('stays away after leaving full screen until full screen is entered again', () => {
    expect(run(laptop, ['fullscreen_exit', 'focus', 'visible']).map((e) => e.type)).toEqual(['left'])
    expect(run(laptop, ['fullscreen_exit', 'blur', 'focus', 'fullscreen_enter']).map((e) => e.type)).toEqual([
      'left',
      'back',
    ])
  })

  it('without full screen counted, leaving it is not an exit', () => {
    expect(run({ countsFocus: true, countsFullscreen: false }, ['fullscreen_exit'])).toEqual([])
  })

  it('repeated signals while away or present emit nothing more', () => {
    expect(run(laptop, ['focus', 'visible', 'blur', 'blur', 'hidden', 'hidden', 'visible', 'focus', 'focus'])).toEqual([
      { type: 'left', exitId: 'exit-1', leftAtEpochMs: 0 },
      { type: 'back', exitId: 'exit-1', awayMs: 0 },
    ])
  })

  it('two separate switches are two exits with different ids', () => {
    const events = run(laptop, ['blur', 'focus', 'hidden', 'visible'])
    expect(events.map((e) => [e.type, e.exitId])).toEqual([
      ['left', 'exit-1'],
      ['back', 'exit-1'],
      ['left', 'exit-2'],
      ['back', 'exit-2'],
    ])
  })
})

describe('absence length', () => {
  it('runs from the first away signal to the last present one', () => {
    expect(awayOf(laptop, [['hidden', 0], ['visible', 4000], ['focus', 4000]])).toBe(4000)
    expect(awayOf(laptop, [['blur', 1000], ['hidden', 1200], ['visible', 6000], ['focus', 6500]])).toBe(5500)
  })

  it('never goes below 0 when the device clock moves back', () => {
    expect(awayOf(phone, [['hidden', 5000], ['visible', 1000]])).toBe(0)
  })

  it('is capped at a day so the report stays valid', () => {
    expect(awayOf(phone, [['hidden', 0], ['visible', 3 * MAX_AWAY_MS]])).toBe(MAX_AWAY_MS)
  })

  it('is a whole number of milliseconds', () => {
    expect(awayOf(phone, [['hidden', 0.4], ['visible', 1000.9]])).toBe(1001)
  })
})

describe('reopened after the tab was closed', () => {
  const openExit = { exitId: 'x', leftAtEpochMs: 0 }

  it('the stored exit is still open and comes back with the whole absence', () => {
    const tracker = createLeaveTracker({ ...phone, openExit, armed: true, now: () => 300_000, newId: ids() })
    expect(tracker.openExit()).toEqual(openExit)
    expect(tracker.handle('visible')).toEqual({ type: 'back', exitId: 'x', awayMs: 300_000 })
    expect(tracker.openExit()).toBeNull()
  })

  it('a laptop also returns on visible, and a focus first changes nothing', () => {
    const tracker = createLeaveTracker({ ...laptop, openExit, armed: true, now: () => 300_000, newId: ids() })
    expect(tracker.handle('focus')).toBeNull()
    expect(tracker.handle('visible')).toEqual({ type: 'back', exitId: 'x', awayMs: 300_000 })
  })

  it('a hidden signal before the page shows does not start a second exit', () => {
    const tracker = createLeaveTracker({ ...phone, openExit, armed: true, now: () => 300_000, newId: ids() })
    expect(tracker.handle('hidden')).toBeNull()
    expect(tracker.openExit()).toEqual(openExit)
  })
})

describe('openExit()', () => {
  it('is the current exit while away, null while present', () => {
    let t = 100
    const tracker = createLeaveTracker({ ...laptop, now: () => t, newId: ids(), openExit: null, armed: true })
    expect(tracker.openExit()).toBeNull()
    tracker.handle('blur')
    expect(tracker.openExit()).toEqual({ exitId: 'exit-1', leftAtEpochMs: 100 })
    t = 900
    tracker.handle('focus')
    expect(tracker.openExit()).toBeNull()
  })
})

describe('not counting until the student is present on the questions (C1)', () => {
  function unarmed(device: Device, now: () => number = () => 0) {
    return createLeaveTracker({ ...device, now, newId: ids(), openExit: null, armed: false })
  }

  it('hidden when answering begins (another tab at Start) is no exit, and coming back is none either', () => {
    const tracker = unarmed(phone)
    expect(tracker.handle('hidden')).toBeNull()
    expect(tracker.handle('pagehide')).toBeNull()
    expect(tracker.handle('visible')).toBeNull()
    expect(tracker.openExit()).toBeNull()
  })

  it('a laptop switching windows on the Begin screen is no exit', () => {
    const tracker = unarmed(laptop)
    expect(tracker.handle('blur')).toBeNull()
    expect(tracker.handle('focus')).toBeNull()
  })

  it('arm() while present counts from then on', () => {
    const tracker = unarmed(phone)
    tracker.handle('visible')
    tracker.arm()
    expect(tracker.handle('hidden')).toMatchObject({ type: 'left' })
  })

  it('arm() while still hidden counts only from the first moment the page shows', () => {
    const tracker = unarmed(phone)
    tracker.handle('hidden')
    tracker.arm()
    expect(tracker.handle('pagehide')).toBeNull()
    expect(tracker.handle('visible')).toBeNull()
    expect(tracker.handle('hidden')).toMatchObject({ type: 'left' })
  })

  it('arm() on a laptop whose window lost focus before counts once it has focus again', () => {
    const tracker = unarmed(laptop)
    tracker.handle('blur')
    tracker.arm()
    expect(tracker.handle('hidden')).toBeNull()
    expect(tracker.handle('visible')).toBeNull()
    expect(tracker.handle('focus')).toBeNull()
    expect(tracker.handle('blur')).toMatchObject({ type: 'left' })
  })

  it('arming twice changes nothing', () => {
    const tracker = unarmed(phone)
    tracker.arm()
    tracker.arm()
    expect(tracker.handle('hidden')).toMatchObject({ type: 'left' })
    expect(tracker.handle('visible')).toMatchObject({ type: 'back' })
  })

  it('a reopened exit (tab closed mid-test) is judged at once, armed or not', () => {
    const tracker = createLeaveTracker({ ...phone, openExit: { exitId: 'x', leftAtEpochMs: 0 }, armed: false, now: () => 5000, newId: ids() })
    expect(tracker.handle('visible')).toEqual({ type: 'back', exitId: 'x', awayMs: 5000 })
    expect(tracker.handle('hidden')).toMatchObject({ type: 'left' })
  })
})

describe('focus quiet window after a full screen change (macOS)', () => {
  function timed(signals: [LeaveSignal, number][]): LeaveEvent[] {
    let t = 0
    const tracker = createLeaveTracker({ ...laptop, now: () => t, newId: ids(), openExit: null, armed: true })
    const events: LeaveEvent[] = []
    for (const [signal, at] of signals) {
      t = at
      const event = tracker.handle(signal)
      if (event) events.push(event)
    }
    return events
  }

  it('a blur and focus fired while entering full screen are ignored', () => {
    expect(timed([['fullscreen_enter', 1000], ['blur', 1200], ['focus', 1400]])).toEqual([])
    expect(timed([['fullscreen_enter', 1000], ['blur', 1000 + FOCUS_QUIET_MS - 1]])).toEqual([])
  })

  it('a blur after the window counts again', () => {
    expect(timed([['fullscreen_enter', 1000], ['blur', 1000 + FOCUS_QUIET_MS]]).map((e) => e.type)).toEqual(['left'])
  })

  it('visibility still counts inside the window', () => {
    expect(timed([['fullscreen_enter', 1000], ['hidden', 1100]]).map((e) => e.type)).toEqual(['left'])
  })

  it('the window is the quiet time after each change, not after the first', () => {
    expect(
      timed([
        ['fullscreen_enter', 0],
        ['fullscreen_exit', 5000],
        ['fullscreen_enter', 6000],
        ['blur', 6300],
      ]).map((e) => e.type),
    ).toEqual(['left', 'back'])
  })
})
