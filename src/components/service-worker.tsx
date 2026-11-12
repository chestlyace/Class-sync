'use client'

import { useEffect } from 'react'
import { rememberInstallPrompt, type InstallPromptEvent } from '@/lib/push-client'

/**
 * Registers public/sw.js on every page (install works from the landing page too) and keeps
 * Chrome's install prompt for an "Install" button instead of the browser's own banner.
 */
export function ServiceWorker() {
  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault()
      rememberInstallPrompt(event as InstallPromptEvent)
    }
    function onInstalled() {
      rememberInstallPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
        // Not fatal: the app works without it, only notifications and the offline page don't.
        console.warn('[service-worker] registration failed')
      })
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  return null
}
