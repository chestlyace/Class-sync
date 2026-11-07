'use client'

import { ArrowRight, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { School } from '@/server/schools/service'
import { searchSchoolsAction } from './actions'

const DEBOUNCE_MS = 250

type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'done'; query: string; schools: School[] }
  | { status: 'error'; message: string }

/** Search-first school picker: each match links to "new class" at that school. */
export function SchoolSearch() {
  const t = useTranslations('schools.new')
  const tRoot = useTranslations()
  const [query, setQuery] = useState('')
  const [state, setState] = useState<SearchState>({ status: 'idle' })
  const latest = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  function onQueryChange(value: string) {
    setQuery(value)
    clearTimeout(timer.current)
    const q = value.trim()
    const request = ++latest.current
    if (!q) {
      setState({ status: 'idle' })
      return
    }
    setState({ status: 'searching' })
    timer.current = setTimeout(async () => {
      try {
        const result = await searchSchoolsAction(q)
        if (request !== latest.current) return // a newer keystroke owns the results
        setState(
          result.ok
            ? { status: 'done', query: q, schools: result.data }
            : { status: 'error', message: tRoot(`errors.${result.code}`) },
        )
      } catch {
        if (request === latest.current) setState({ status: 'error', message: tRoot('common.genericError') })
      }
    }, DEBOUNCE_MS)
  }

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="school-search">{t('searchLabel')}</FieldLabel>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="school-search"
            type="search"
            autoComplete="off"
            placeholder={t('searchPlaceholder')}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="pl-10"
          />
        </div>
      </Field>
      <div aria-live="polite" className="flex flex-col gap-3">
        {state.status === 'searching' && <p className="text-sm text-muted-foreground">{t('searching')}</p>}
        {state.status === 'error' && <FieldError>{state.message}</FieldError>}
        {state.status === 'done' && state.schools.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('noMatches', { query: state.query })}</p>
        )}
        {state.status === 'done' && state.schools.length > 0 && (
          <ul aria-label={t('results')} className="flex flex-col divide-y rounded-2xl border">
            {state.schools.map((school) => (
              <li key={school.id}>
                <Link
                  href={`/classes/new?schoolId=${encodeURIComponent(school.id)}`}
                  aria-label={t('chooseLabel', { name: school.name })}
                  className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{school.name}</span>
                    <span className="truncate text-sm text-muted-foreground">{school.town}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
                    {t('choose')}
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
