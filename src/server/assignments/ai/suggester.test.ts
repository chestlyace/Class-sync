import { APICallError } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FEEDBACK_MAX } from '../rules'
import { fakeAssignmentSuggester } from './fake'
import type { MarkingInput } from './inputs'
import {
  AssignmentSuggesterError,
  cleanSuggestion,
  createModelSuggester,
  getAssignmentSuggester,
  setAssignmentSuggesterForTests,
} from './suggester'

const input: MarkingInput = {
  title: 'Essay',
  instructions: 'Write.',
  markingGuide: null,
  maxMark: 10,
  studentText: 'My secret student text.',
  images: [],
  documents: [],
}

type GenerateResult = Awaited<ReturnType<NonNullable<MockLanguageModelV4['doGenerate']>>>

function textResult(text: string, inTok = 120, outTok = 45) {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: inTok, noCache: inTok, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: outTok, text: outTok, reasoning: undefined },
    },
    warnings: [],
  } as unknown as GenerateResult
}

async function failure(model: MockLanguageModelV4): Promise<AssignmentSuggesterError> {
  return (await createModelSuggester(model, 'm')(input).then(
    () => null,
    (e: unknown) => e,
  )) as AssignmentSuggesterError
}

describe('cleanSuggestion', () => {
  const ok = { transcript: 't', mark: 7.13, feedback: 'ok' }

  it('rounds the mark to the nearest 0.25', () => {
    expect(cleanSuggestion(ok, 10)).toEqual({ mark: 7.25, feedback: 'ok', transcript: 't' })
  })

  it('rejects marks that are out of range or not numbers', () => {
    expect(cleanSuggestion({ ...ok, mark: 11 }, 10)).toBeNull()
    expect(cleanSuggestion({ ...ok, mark: -1 }, 10)).toBeNull()
    expect(cleanSuggestion({ ...ok, mark: Number.NaN }, 10)).toBeNull()
    expect(cleanSuggestion({ ...ok, mark: Infinity }, 10)).toBeNull()
    expect(cleanSuggestion({ ...ok, mark: '7' }, 10)).toBeNull()
    expect(cleanSuggestion(null, 10)).toBeNull()
  })

  it('keeps the maximum and zero', () => {
    expect(cleanSuggestion({ ...ok, mark: 10 }, 10)?.mark).toBe(10)
    expect(cleanSuggestion({ ...ok, mark: 0 }, 10)?.mark).toBe(0)
  })

  it('trims feedback, turns blank into null and cuts long feedback', () => {
    expect(cleanSuggestion({ ...ok, feedback: '  hi  ' }, 10)?.feedback).toBe('hi')
    expect(cleanSuggestion({ ...ok, feedback: '   ' }, 10)?.feedback).toBeNull()
    expect(cleanSuggestion({ ...ok, feedback: 'a'.repeat(6000) }, 10)?.feedback).toHaveLength(FEEDBACK_MAX)
  })

  it('cuts the transcript to 20,000 characters', () => {
    expect(cleanSuggestion({ ...ok, transcript: 'x'.repeat(25_000) }, 10)?.transcript).toHaveLength(20_000)
  })
})

describe('createModelSuggester (mock model, no network)', () => {
  it('returns the cleaned suggestion with token counts and the model id', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => textResult(JSON.stringify({ transcript: 'It reads', mark: 6.9, feedback: ' Well done. ' })),
    })
    const out = await createModelSuggester(model, 'eu.test-model')(input)
    expect(out).toEqual({
      mark: 7,
      feedback: 'Well done.',
      transcript: 'It reads',
      inputTokens: 120,
      outputTokens: 45,
      model: 'eu.test-model',
    })
    const call = model.doGenerateCalls[0]
    expect(call.temperature).toBe(0)
    expect(call.abortSignal).toBeInstanceOf(AbortSignal)
    expect(JSON.stringify(call.prompt)).toContain('My secret student text.')
  })

  it('forces the JSON-tool structured output and keeps the PDF citations option', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => textResult(JSON.stringify({ transcript: 't', mark: 5, feedback: 'f' })),
    })
    const bytes = new Uint8Array([37, 80, 68, 70])
    await createModelSuggester(model, 'm')({
      ...input,
      documents: [{ position: 1, data: bytes, mediaType: 'application/pdf' }],
    })
    const call = model.doGenerateCalls[0]
    expect(call.providerOptions).toEqual({ amazonBedrock: { structuredOutputMode: 'jsonTool' } })
    const parts = call.prompt.flatMap((m) => (Array.isArray(m.content) ? (m.content as unknown[]) : []))
    const filePart = (parts as { type: string; providerOptions?: unknown }[]).find((p) => p.type === 'file')
    expect(filePart?.providerOptions).toEqual({ bedrock: { citations: { enabled: true } } })
  })

  it("stops at the caller's signal and reports a timeout", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise<GenerateResult>((_, reject) => {
          abortSignal?.addEventListener('abort', () => reject(abortSignal.reason), { once: true })
        }),
    })
    const e = await createModelSuggester(model, 'm')(input, { signal: AbortSignal.timeout(20) }).then(
      () => null,
      (err: unknown) => err as AssignmentSuggesterError,
    )
    expect(e).toBeInstanceOf(AssignmentSuggesterError)
    expect(e?.category).toBe('timeout')
  })

  it('rejects with invalid_output when the text is not the expected object', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => textResult('I cannot do that') })
    const e = await failure(model)
    expect(e).toBeInstanceOf(AssignmentSuggesterError)
    expect(e.category).toBe('invalid_output')
  })

  it('rejects with invalid_output when the mark is out of range', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => textResult(JSON.stringify({ transcript: 't', mark: 99, feedback: 'f' })),
    })
    expect((await failure(model)).category).toBe('invalid_output')
  })

  it('names the failure and never carries the provider message', async () => {
    const apiError = (statusCode: number) =>
      new APICallError({
        message: 'secret student text',
        url: 'u',
        requestBodyValues: { prompt: 'secret student text' },
        statusCode,
        isRetryable: false,
      })
    const failWith = async (thrown: unknown) =>
      failure(
        new MockLanguageModelV4({
          doGenerate: async () => {
            throw thrown
          },
        }),
      )
    const rate = await failWith(apiError(429))
    expect(rate.category).toBe('rate_limit')
    expect(rate.message).not.toContain('secret student text')
    expect(JSON.stringify({ ...rate, message: rate.message, stack: rate.stack })).not.toContain('secret')
    expect(rate.cause).toBeUndefined()
    expect((await failWith(apiError(403))).category).toBe('auth')
    expect((await failWith(apiError(504))).category).toBe('timeout')
    expect((await failWith(apiError(500))).category).toBe('other')
    const timeout = new Error('signal timed out')
    timeout.name = 'TimeoutError'
    expect((await failWith(timeout)).category).toBe('timeout')
  })
})

describe('fakeAssignmentSuggester', () => {
  it('is deterministic: half marks, fixed feedback, text excerpt', async () => {
    expect(await fakeAssignmentSuggester({ ...input, maxMark: 7 })).toEqual({
      mark: 3.5,
      feedback: 'Fake feedback',
      transcript: 'My secret student text.',
      inputTokens: 0,
      outputTokens: 0,
      model: 'fake',
    })
    const long = await fakeAssignmentSuggester({ ...input, maxMark: 9, studentText: 'a'.repeat(500) })
    expect(long.mark).toBe(4.5)
    expect(long.transcript).toHaveLength(200)
    expect((await fakeAssignmentSuggester({ ...input, studentText: null })).transcript).toBe('[fake transcript]')
  })
})

describe('getAssignmentSuggester', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    setAssignmentSuggesterForTests(undefined)
  })

  it('returns the fake for the fake model outside production', () => {
    vi.stubEnv('AI_ASSIGNMENT_MODEL', 'fake')
    vi.stubEnv('VERCEL_ENV', '')
    expect(getAssignmentSuggester()).toBe(fakeAssignmentSuggester)
  })

  it('is null when the feature is off', () => {
    vi.stubEnv('AI_ASSIGNMENT_MODEL', '')
    vi.stubEnv('AI_AWS_ROLE_ARN', '')
    vi.stubEnv('VERCEL_ENV', '')
    expect(getAssignmentSuggester()).toBeNull()
    vi.stubEnv('AI_ASSIGNMENT_MODEL', 'fake')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(getAssignmentSuggester()).toBeNull()
  })

  it('builds a model suggester when a role is configured', () => {
    vi.stubEnv('AI_ASSIGNMENT_MODEL', '')
    vi.stubEnv('AI_AWS_ROLE_ARN', 'arn:aws:iam::123456789012:role/clasync-ai')
    const s = getAssignmentSuggester()
    expect(typeof s).toBe('function')
    expect(s).not.toBe(fakeAssignmentSuggester)
  })

  it('uses the test override', () => {
    const stub = vi.fn()
    setAssignmentSuggesterForTests(stub)
    expect(getAssignmentSuggester()).toBe(stub)
    setAssignmentSuggesterForTests(null)
    expect(getAssignmentSuggester()).toBeNull()
  })
})
