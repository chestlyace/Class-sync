import { describe, expect, it } from 'vitest'
import { firstOpenCard } from './first-open'

type State = Parameters<typeof firstOpenCard>[0]

const studentOnAndroid: State = {
  role: 'student',
  support: 'supported',
  permission: 'default',
  subscribed: false,
  dismissed: false,
  installed: false,
  canPromptInstall: false,
  ios: false,
}

const lecturerOnDesktopChrome: State = {
  role: 'lecturer',
  support: 'supported',
  permission: 'default',
  subscribed: false,
  dismissed: false,
  installed: false,
  canPromptInstall: true,
  ios: false,
}

describe('firstOpenCard', () => {
  it('student on Android sees enable', () => {
    expect(firstOpenCard(studentOnAndroid)).toBe('enable')
  })

  it('student on iPhone Safari sees install-ios', () => {
    expect(firstOpenCard({ ...studentOnAndroid, support: 'needs-install', ios: true })).toBe('install-ios')
  })

  it('student who said not now sees nothing', () => {
    expect(firstOpenCard({ ...studentOnAndroid, dismissed: true })).toBeNull()
    expect(firstOpenCard({ ...studentOnAndroid, support: 'needs-install', ios: true, dismissed: true })).toBeNull()
  })

  it('student with denied permission sees nothing', () => {
    expect(firstOpenCard({ ...studentOnAndroid, permission: 'denied' })).toBeNull()
  })

  it('student already subscribed, or on a browser without push, sees nothing', () => {
    expect(firstOpenCard({ ...studentOnAndroid, subscribed: true })).toBeNull()
    expect(firstOpenCard({ ...studentOnAndroid, support: 'unsupported', permission: 'unsupported' })).toBeNull()
  })

  it('student sees nothing while the server has no push key, on Android or iPhone', () => {
    expect(firstOpenCard({ ...studentOnAndroid, support: 'unavailable' })).toBeNull()
    expect(firstOpenCard({ ...studentOnAndroid, support: 'unavailable', ios: true })).toBeNull()
  })

  it('lecturer still sees install while the server has no push key', () => {
    expect(firstOpenCard({ ...lecturerOnDesktopChrome, support: 'unavailable' })).toBe('install')
  })

  it('lecturer on desktop Chrome sees install', () => {
    expect(firstOpenCard(lecturerOnDesktopChrome)).toBe('install')
  })

  it('lecturer in the installed app sees nothing', () => {
    expect(firstOpenCard({ ...lecturerOnDesktopChrome, installed: true, canPromptInstall: false })).toBeNull()
    expect(firstOpenCard({ ...lecturerOnDesktopChrome, installed: true, ios: true })).toBeNull()
  })

  it('lecturer on iPhone sees the Home Screen steps; without an install prompt, nothing', () => {
    expect(firstOpenCard({ ...lecturerOnDesktopChrome, ios: true, canPromptInstall: false })).toBe('install-ios')
    expect(firstOpenCard({ ...lecturerOnDesktopChrome, canPromptInstall: false })).toBeNull()
    expect(firstOpenCard({ ...lecturerOnDesktopChrome, dismissed: true })).toBeNull()
  })
})
