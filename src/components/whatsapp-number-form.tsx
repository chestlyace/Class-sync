'use client'

import { MessageCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import { PhoneInput } from '@/components/phone-input'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { toE164 } from '@/lib/phone'
import { requestPhoneCode, verifyWhatsAppHref } from '@/lib/phone-code'

/**
 * Asks for a WhatsApp number, sends it a code and opens the code page. For an account that is already
 * signed in (the code route needs the session). `alerts` carries the sign-up choice along.
 */
export function WhatsAppNumberForm({
  next = null,
  alerts = false,
  initialError = null,
}: {
  next?: string | null
  alerts?: boolean
  /** The message to show on arrival: why a code request made earlier (at sign-up) was refused. */
  initialError?: string | null
}) {
  const t = useTranslations('auth.whatsapp')
  const tRoot = useTranslations()
  const router = useRouter()
  const id = useId()
  const [error, setError] = useState<string | null>(initialError)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const raw = String(new FormData(event.currentTarget).get('phone') ?? '')
    if (!toE164(raw)) {
      setError(t('errors.invalidNumber'))
      return
    }
    setPending(true)
    setError(null)
    const result = await requestPhoneCode(raw)
    if (result.ok && result.phone) {
      router.push(verifyWhatsAppHref(result.phone, { alerts, next }))
      return
    }
    setError(result.ok ? tRoot('common.genericError') : tRoot(result.messageKey))
    setPending(false)
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field>
        <FieldLabel htmlFor={`${id}-phone`}>{t('phone')}</FieldLabel>
        <PhoneInput
          id={`${id}-phone`}
          name="phone"
          aria-describedby={`${id}-hint`}
          aria-invalid={error ? true : undefined}
          maxLength={24}
          required
        />
        <FieldDescription id={`${id}-hint`}>{t('phoneHint')}</FieldDescription>
        <FieldError>{error}</FieldError>
      </Field>
      <Button type="submit" size="lg" pending={pending}>
        {pending ? t('sending') : t('sendCode')}
      </Button>
    </form>
  )
}

/**
 * "Verify with WhatsApp instead": a button that opens the number form in place. Shown to a signed-in,
 * unverified account on the verify banner and the check-your-inbox page.
 */
export function WhatsAppInstead({ next = null }: { next?: string | null }) {
  const t = useTranslations('auth.whatsapp')
  const id = useId()
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        type="button"
        variant="outline"
        size="lg"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((o) => !o)}
      >
        <MessageCircle aria-hidden="true" />
        {t('instead')}
      </Button>
      {open ? (
        <div id={`${id}-panel`} className="w-full max-w-sm">
          <WhatsAppNumberForm next={next} />
        </div>
      ) : null}
    </div>
  )
}
