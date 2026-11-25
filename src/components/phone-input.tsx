'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

/** True when the text already carries its own country code (`+…` or `00…`), so the Cameroon prefix would be wrong. */
function hasCountryCode(text: string): boolean {
  const compact = text.trim()
  return compact.startsWith('+') || compact.startsWith('00')
}

/**
 * A phone number field. `+237` is shown in front while the number is typed the local way (Cameroon is
 * the default: `toE164` adds it); typing `+` or `00` first means another country, and the prefix goes
 * away. Same border and focus ring as the other inputs.
 */
export function PhoneInput({ className, onChange, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  const [international, setInternational] = useState(() => hasCountryCode(String(props.value ?? props.defaultValue ?? '')))
  return (
    <div
      className={cn(
        'flex h-11 w-full items-center rounded-xl border border-input pl-3.5 transition-colors has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50 has-[input[aria-invalid=true]]:border-destructive',
        className,
      )}
    >
      {international ? null : (
        <span aria-hidden="true" className="pr-2 font-mono text-sm text-muted-foreground">
          +237
        </span>
      )}
      <input
        {...props}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        onChange={(event) => {
          setInternational(hasCountryCode(event.currentTarget.value))
          onChange?.(event)
        }}
        className="h-full min-w-0 flex-1 bg-transparent pr-3.5 text-base outline-none placeholder:text-muted-foreground md:text-sm"
      />
    </div>
  )
}
