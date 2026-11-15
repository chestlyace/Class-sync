import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../../../messages/en.json'
import { schoolAuditText } from './school-text'

const t = createTranslator({ locale: 'en', messages: en, namespace: 'admin' })

describe('schoolAuditText', () => {
  it('keeps the old town when only the town changed', () => {
    const text = schoolAuditText(
      { kind: 'school_update', before: { name: 'IUT', town: 'Dla' }, after: { name: 'IUT', town: 'Douala' } },
      t,
    )
    expect(text).toBe('IUT, Dla → IUT, Douala')
  })

  it('names a deleted school and a merge from the kept names', () => {
    expect(
      schoolAuditText({ kind: 'school_delete', school: { id: 'x', name: 'ENSET', town: 'Douala' }, classes: 2, courses: 3, students: 9 }, t),
    ).toBe('ENSET, Douala · 2 classes')
    expect(
      schoolAuditText(
        {
          kind: 'school_merge',
          from: { id: 'a', name: 'I.U.T.', town: 'Douala' },
          into: { id: 'b', name: 'IUT', town: 'Douala' },
          classesMoved: 1,
        },
        t,
      ),
    ).toBe('I.U.T. → IUT')
  })
})
