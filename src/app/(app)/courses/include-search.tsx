'use client'

import { Search, UserPlus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { ErrorCodeMessage } from '@/components/action-error'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { IncludeCandidate } from '@/server/courses/service'
import { searchIncludeCandidatesAction } from './actions'
import { RosterButton } from './roster-button'

const DEBOUNCE_MS = 250
const MIN_QUERY = 2
const MAX_QUERY = 100

type SearchState =
  | { status: 'idle' }
  | { status: 'tooShort' }
  | { status: 'searching' }
  | { status: 'done'; query: string; students: IncludeCandidate[] }
  | { status: 'error'; message: React.ReactNode }

/** Debounced name/matricule search among the school's students, each result with an "Add" button. */
export function IncludeSearch({ courseId }: { courseId: string }) {
  const t = useTranslations('courses.page')
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
    if (!q) return setState({ status: 'idle' })
    if (q.length < MIN_QUERY) return setState({ status: 'tooShort' })
    setState({ status: 'searching' })
    timer.current = setTimeout(async () => {
      try {
        const result = await searchIncludeCandidatesAction(courseId, q)
        if (request !== latest.current) return // a newer keystroke owns the results
        setState(
          result.ok
            ? { status: 'done', query: q, students: result.data }
            : { status: 'error', message: <ErrorCodeMessage code={result.code} /> },
        )
      } catch {
        if (request === latest.current) setState({ status: 'error', message: tRoot('common.genericError') })
      }
    }, DEBOUNCE_MS)
  }

  /** Once added, the student moves to the roster (the page refreshes), so drop them from the results. */
  function onIncluded(studentId: string) {
    setState((current) =>
      current.status === 'done'
        ? { ...current, students: current.students.filter((s) => s.studentId !== studentId) }
        : current,
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="include-search">{t('includeSearchLabel')}</FieldLabel>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="include-search"
            type="search"
            autoComplete="off"
            spellCheck={false}
            maxLength={MAX_QUERY}
            placeholder={t('includeSearchPlaceholder')}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="pl-10"
          />
        </div>
      </Field>
      <div aria-live="polite" className="flex flex-col gap-3">
        {state.status === 'tooShort' && <p className="text-sm text-muted-foreground">{t('includeTooShort')}</p>}
        {state.status === 'searching' && <p className="text-sm text-muted-foreground">{t('includeSearching')}</p>}
        {state.status === 'error' && <FieldError>{state.message}</FieldError>}
        {state.status === 'done' && state.students.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('includeNoMatches', { query: state.query })}</p>
        )}
        {state.status === 'done' && state.students.length > 0 && (
          <ul aria-label={t('includeResults')} className="flex flex-col divide-y rounded-3xl border">
            {state.students.map((student) => (
              <li
                key={student.studentId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{student.name}</span>
                <span className="font-mono text-sm tracking-[0.04em]">{student.matricule ?? '—'}</span>
                <RosterButton
                  courseId={courseId}
                  studentId={student.studentId}
                  kind="include"
                  label={t('include')}
                  ariaLabel={t('includeLabel', { name: student.name })}
                  icon={<UserPlus aria-hidden="true" data-icon="inline-start" />}
                  onSuccess={() => onIncluded(student.studentId)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
