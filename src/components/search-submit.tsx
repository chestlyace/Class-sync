'use client'

import type * as React from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'

/** The submit button of a `next/form` search form: shows a spinner while the navigation is pending. */
export function SearchSubmit({ children, ...buttonProps }: Omit<React.ComponentProps<typeof Button>, 'type' | 'pending' | 'asChild'>) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" pending={pending} {...buttonProps}>
      {children}
    </Button>
  )
}
