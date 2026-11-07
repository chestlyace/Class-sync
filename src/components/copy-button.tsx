'use client'

import { Check, Copy } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

/** Copies `value` to the clipboard; `label` is the translated accessible name. */
export function CopyButton({ value, label }: { value: string; label: string }) {
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
      <Button type="button" variant="outline" size="icon-lg" onClick={copy} aria-label={label} title={label}>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      <span role="status" className="sr-only">
        {copied ? t('copied') : ''}
      </span>
    </>
  )
}
