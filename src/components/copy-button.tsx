'use client'

import { Check, Copy } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Copies `value` to the clipboard; `label` is the translated accessible name. With `text`, the
 * button shows that text next to the icon (a blue pill, or an outline one with `variant`)
 * instead of being icon-only.
 */
export function CopyButton({
  value,
  label,
  text,
  variant = 'default',
}: {
  value: string
  label: string
  text?: string
  variant?: 'default' | 'outline'
}) {
  const t = useTranslations('common')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      // Clipboard can be blocked (permissions, insecure context): the code stays visible to copy by hand.
    }
  }

  return (
    <>
      {text ? (
        <Button type="button" size="lg" variant={variant} onClick={copy} title={label}>
          {copied ? <Check aria-hidden="true" data-icon="inline-start" /> : <Copy aria-hidden="true" data-icon="inline-start" />}
          {text}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          onClick={copy}
          aria-label={label}
          title={label}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      )}
      <span role="status" className="sr-only">
        {copied ? t('copied') : ''}
      </span>
    </>
  )
}
