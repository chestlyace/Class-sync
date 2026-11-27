import { describe, expect, it } from 'vitest'
import { visitPage } from './navigation-history'

describe('visitPage', () => {
  it('has no previous page on the first visit', () => {
    expect(visitPage({ current: null, previous: null }, '/dashboard')).toEqual({
      current: '/dashboard',
      previous: null,
    })
  })

  it('moves the old page into previous on a real navigation', () => {
    expect(visitPage({ current: '/dashboard', previous: null }, '/courses/1')).toEqual({
      current: '/courses/1',
      previous: '/dashboard',
    })
  })

  it('keeps previous on a refresh or same-page URL change', () => {
    expect(visitPage({ current: '/courses/1', previous: '/dashboard' }, '/courses/1?tab=notes')).toEqual({
      current: '/courses/1?tab=notes',
      previous: '/dashboard',
    })
  })

  it('a back navigation makes the page just left the new previous', () => {
    expect(visitPage({ current: '/courses/1', previous: '/dashboard' }, '/dashboard')).toEqual({
      current: '/dashboard',
      previous: '/courses/1',
    })
  })
})
