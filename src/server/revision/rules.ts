import { GUIDE_MAX, MCQ_OPTIONS_MAX, MCQ_OPTIONS_MIN, OPTION_MAX, PROMPT_MAX } from '@/server/tests/rules'

export const EXPLANATION_MAX = 2000
export const MAX_PRACTICE_PER_TOPIC = 200

export type PracticeInput =
  | {
      kind: 'mcq'
      prompt: string
      options: { text: string; isCorrect: boolean }[]
      explanation: string | null
    }
  | { kind: 'short'; prompt: string; guide: string; explanation: string | null }

type Parsed = { ok: true; value: PracticeInput } | { ok: false; fields: string[] }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function text(raw: unknown): string | null {
  return typeof raw === 'string' ? raw.trim() : null
}

/** Validates a practice question as a lecturer types it, trimming text; `fields` names what is wrong. */
export function parsePracticeInput(raw: unknown): Parsed {
  if (!isRecord(raw) || (raw.kind !== 'mcq' && raw.kind !== 'short')) return { ok: false, fields: ['kind'] }
  const fields: string[] = []

  const prompt = text(raw.prompt)
  if (prompt === null || prompt.length < 1 || prompt.length > PROMPT_MAX) fields.push('prompt')

  let explanation: string | null = null
  if (raw.explanation !== undefined && raw.explanation !== null) {
    const e = text(raw.explanation)
    if (e === null || e.length > EXPLANATION_MAX) fields.push('explanation')
    else explanation = e.length > 0 ? e : null
  }

  if (raw.kind === 'short') {
    const guide = text(raw.guide)
    if (guide === null || guide.length < 1 || guide.length > GUIDE_MAX) fields.push('guide')
    if (fields.length > 0) return { ok: false, fields }
    return { ok: true, value: { kind: 'short', prompt: prompt!, guide: guide!, explanation } }
  }

  const options: { text: string; isCorrect: boolean }[] = []
  let optionsOk = Array.isArray(raw.options) && raw.options.length >= MCQ_OPTIONS_MIN && raw.options.length <= MCQ_OPTIONS_MAX
  if (optionsOk) {
    for (const o of raw.options as unknown[]) {
      const t = isRecord(o) ? text(o.text) : null
      if (!isRecord(o) || t === null || t.length < 1 || t.length > OPTION_MAX || typeof o.isCorrect !== 'boolean') {
        optionsOk = false
        break
      }
      options.push({ text: t, isCorrect: o.isCorrect })
    }
  }
  if (!optionsOk || options.filter((o) => o.isCorrect).length !== 1) fields.push('options')
  if (fields.length > 0) return { ok: false, fields }
  return { ok: true, value: { kind: 'mcq', prompt: prompt!, options, explanation } }
}
