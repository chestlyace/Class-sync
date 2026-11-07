'use client'

import { Eye, EyeOff } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { cn } from '@/lib/utils'

/** Password field with a show/hide button inside the input's border. */
export function PasswordInput({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  const t = useTranslations('auth.password')
  const [visible, setVisible] = useState(false)
  return (
    <div
      className={cn(
        'flex h-11 w-full items-center rounded-xl border border-input pr-1 pl-3.5 transition-colors has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50 has-[input[aria-invalid=true]]:border-destructive',
        className,
      )}
    >
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className="h-full min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t('hide') : t('show')}
        aria-pressed={visible}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {visible ? <EyeOff aria-hidden="true" className="size-[18px]" /> : <Eye aria-hidden="true" className="size-[18px]" />}
      </button>
    </div>
  )
}
