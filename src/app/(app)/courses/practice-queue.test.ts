import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { drain, enqueue } from './practice-queue'

/** A minimal in-memory Storage (jsdom is not a dependency; other tests stub it the same way). */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  }
}

type Batch = { questionId: string; correct: boolean }[]

describe('practice outcome queue', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the latest outcome of a question, once', async () => {
    enqueue('c1', { questionId: 'q1', correct: false })
    enqueue('c1', { questionId: 'q2', correct: true })
    enqueue('c1', { questionId: 'q1', correct: true })
    const send = vi.fn<(batch: Batch) => Promise<boolean>>(async () => true)
    await drain('c1', send)
    expect(send).toHaveBeenCalledTimes(1)
    expect([...send.mock.calls[0][0]].sort((a, b) => a.questionId.localeCompare(b.questionId))).toEqual([
      { questionId: 'q1', correct: true },
      { questionId: 'q2', correct: true },
    ])
  })

  it('empties the queue after a successful send', async () => {
    enqueue('c1', { questionId: 'q1', correct: true })
    await drain('c1', async () => true)
    const send = vi.fn<(batch: Batch) => Promise<boolean>>(async () => true)
    await drain('c1', send)
    expect(send).not.toHaveBeenCalled()
  })

  it('keeps the outcomes when the send fails, for the next drain', async () => {
    enqueue('c1', { questionId: 'q1', correct: false })
    enqueue('c1', { questionId: 'q2', correct: true })
    await drain('c1', async () => false)
    const send = vi.fn<(batch: Batch) => Promise<boolean>>(async () => true)
    await drain('c1', send)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toHaveLength(2)
  })

  it('keeps the outcomes when the send throws (offline)', async () => {
    enqueue('c1', { questionId: 'q1', correct: false })
    await drain('c1', async () => {
      throw new Error('offline')
    })
    const send = vi.fn<(batch: Batch) => Promise<boolean>>(async () => true)
    await drain('c1', send)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('keeps an answer given while a send was in flight, and sends it in the same drain', async () => {
    enqueue('c1', { questionId: 'q1', correct: false })
    const batches: Batch[] = []
    await drain('c1', async (batch) => {
      batches.push(batch)
      if (batches.length === 1) {
        enqueue('c1', { questionId: 'q1', correct: true })
        enqueue('c1', { questionId: 'q2', correct: false })
      }
      return true
    })
    expect(batches[0]).toEqual([{ questionId: 'q1', correct: false }])
    expect(batches).toHaveLength(2)
    expect([...batches[1]].sort((a, b) => a.questionId.localeCompare(b.questionId))).toEqual([
      { questionId: 'q1', correct: true },
      { questionId: 'q2', correct: false },
    ])
    const send = vi.fn<(batch: Batch) => Promise<boolean>>(async () => true)
    await drain('c1', send)
    expect(send).not.toHaveBeenCalled()
  })

  it('keeps each course apart', async () => {
    enqueue('c1', { questionId: 'q1', correct: true })
    const send = vi.fn<(batch: Batch) => Promise<boolean>>(async () => true)
    await drain('c2', send)
    expect(send).not.toHaveBeenCalled()
  })

  it('splits a long queue into batches the service accepts', async () => {
    for (let i = 0; i < 450; i++) enqueue('c1', { questionId: `q${i}`, correct: true })
    const sizes: number[] = []
    await drain('c1', async (batch) => {
      sizes.push(batch.length)
      return true
    })
    expect(sizes).toEqual([200, 200, 50])
  })

  it('does not fail without storage', async () => {
    vi.stubGlobal('localStorage', undefined)
    const send = vi.fn<(batch: Batch) => Promise<boolean>>(async () => true)
    expect(() => enqueue('c1', { questionId: 'q1', correct: true })).not.toThrow()
    await drain('c1', send)
    expect(send).not.toHaveBeenCalled()
  })

  it('ignores a corrupted store', async () => {
    localStorage.setItem('clasync:practice:c1', '{not json')
    const send = vi.fn<(batch: Batch) => Promise<boolean>>(async () => true)
    await drain('c1', send)
    expect(send).not.toHaveBeenCalled()
    enqueue('c1', { questionId: 'q1', correct: true })
    await drain('c1', send)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
