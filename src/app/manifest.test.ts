import { describe, expect, it } from 'vitest'
import manifest from './manifest'

describe('web app manifest', () => {
  it('has the install fields from the spec', () => {
    const m = manifest()
    expect(m).toMatchObject({
      name: 'Clasync',
      short_name: 'Clasync',
      id: '/',
      start_url: '/dashboard',
      scope: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#ffffff',
    })
    expect(m.description).toEqual(expect.any(String))
    expect(m.icons).toEqual([
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ])
  })
})
