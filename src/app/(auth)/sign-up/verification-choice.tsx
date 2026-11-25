'use client'

import { Mail, MessageCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId } from 'react'
import { PhoneInput } from '@/components/phone-input'
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'

export type VerifyMethod = 'email' | 'whatsapp'

const methods = [
  { value: 'email', icon: Mail },
  { value: 'whatsapp', icon: MessageCircle },
] as const

/**
 * "How do you want to verify your account?": email (the default) or a WhatsApp code. Choosing WhatsApp
 * reveals the number field and the class-alerts box. The number is read from the form (`phone`), the
 * alerts box is controlled by the parent.
 */
export function VerificationChoice({
  method,
  onMethodChange,
  alerts,
  onAlertsChange,
  phoneError,
}: {
  method: VerifyMethod
  onMethodChange: (method: VerifyMethod) => void
  alerts: boolean
  onAlertsChange: (alerts: boolean) => void
  phoneError: boolean
}) {
  const t = useTranslations('auth.whatsapp')
  const id = useId()
  return (
    <FieldSet>
      <FieldLegend variant="label">{t('verifyHow')}</FieldLegend>
      <div className="grid grid-cols-2 gap-2.5">
        {methods.map(({ value, icon: Icon }) => (
          <label
            key={value}
            className="flex cursor-pointer flex-col gap-2 rounded-2xl border p-3.5 has-[:checked]:border-2 has-[:checked]:border-foreground has-[:checked]:p-[13px] has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
          >
            <span className="flex items-center justify-between">
              <Icon aria-hidden="true" className="size-[22px]" />
              <input
                type="radio"
                name="verifyMethod"
                value={value}
                checked={method === value}
                onChange={() => onMethodChange(value)}
                className="size-4 accent-foreground"
              />
            </span>
            <span className="text-sm font-semibold">{value === 'email' ? t('byEmail') : t('byWhatsApp')}</span>
            <span className="text-[13px] text-muted-foreground">{value === 'email' ? t('byEmailHint') : t('byWhatsAppHint')}</span>
          </label>
        ))}
      </div>
      {method === 'whatsapp' ? (
        <div className="mt-1 flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor={`${id}-phone`}>{t('phone')}</FieldLabel>
            <PhoneInput
              id={`${id}-phone`}
              name="phone"
              aria-describedby={`${id}-phone-hint`}
              aria-invalid={phoneError || undefined}
              maxLength={24}
            />
            <FieldDescription id={`${id}-phone-hint`}>{t('phoneHint')}</FieldDescription>
            {phoneError ? <FieldError>{t('phoneRequired')}</FieldError> : null}
          </Field>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="alerts"
              checked={alerts}
              onChange={(event) => onAlertsChange(event.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t('alerts')}</span>
              <span className="text-[13px] text-muted-foreground">{t('alertsHint')}</span>
            </span>
          </label>
        </div>
      ) : null}
    </FieldSet>
  )
}
