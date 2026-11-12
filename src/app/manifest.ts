import type { MetadataRoute } from 'next'

/**
 * Makes Clasync installable (Home Screen on phones, an app window on desktop). White like the app:
 * light mode by default. The icons are generated from the brand logo files and committed under
 * public/icons/; the maskable one keeps the mark inside the centre safe zone.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Clasync',
    short_name: 'Clasync',
    description: 'Attendance, assignments, tests and marks for lecturers and their students.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
