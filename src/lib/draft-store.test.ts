import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearDraft,
  draftKey,
  loadDraft,
  sameDraft,
  saveDraft,
  settleDraftAfterSubmit,
  toSubmissionDraft,
} from './draft-store'

/** A minimal in-memory Storage. */
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

function throwingStorage(): Storage {
  const fail = () => {
    throw new DOMException('QuotaExceededError', 'QuotaExceededError')
  }
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const FILE = { id: 'f1', name: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 1234 }

describe('draftKey', () => {
  it('namespaces by user and assignment', () => {
    expect(draftKey('u1', 'a1')).toBe('clasync:draft:u1:a1')
  })
})

describe('loadDraft / saveDraft / clearDraft', () => {
  it('round-trips a value', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const value = { text: [{ type: 'paragraph', content: 'Hi' }], files: [FILE] }
    saveDraft('k', value)
    expect(loadDraft('k')).toEqual(value)
    clearDraft('k')
    expect(loadDraft('k')).toBeNull()
  })

  it('returns null for a missing key', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(loadDraft('nothing')).toBeNull()
  })

  it('returns null for corrupted JSON', () => {
    const storage = memoryStorage()
    storage.setItem('k', '{not json')
    vi.stubGlobal('localStorage', storage)
    expect(loadDraft('k')).toBeNull()
  })

  it('never throws when localStorage throws (quota, private mode)', () => {
    vi.stubGlobal('localStorage', throwingStorage())
    expect(() => saveDraft('k', { a: 1 })).not.toThrow()
    expect(loadDraft('k')).toBeNull()
    expect(() => clearDraft('k')).not.toThrow()
  })

  it('never throws when the localStorage accessor itself throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('SecurityError', 'SecurityError')
      },
    })
    try {
      expect(() => saveDraft('k', 1)).not.toThrow()
      expect(loadDraft('k')).toBeNull()
      expect(() => clearDraft('k')).not.toThrow()
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage
    }
  })

  it('never throws when there is no localStorage (server)', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(() => saveDraft('k', 1)).not.toThrow()
    expect(loadDraft('k')).toBeNull()
  })

  it('does not throw on values JSON cannot encode', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => saveDraft('k', cyclic)).not.toThrow()
    expect(() => saveDraft('k', BigInt(10))).not.toThrow()
  })
})

describe('toSubmissionDraft', () => {
  it('accepts text blocks and well-formed files', () => {
    expect(toSubmissionDraft({ text: [{ type: 'paragraph' }], files: [FILE] })).toEqual({
      text: [{ type: 'paragraph' }],
      files: [FILE],
    })
  })

  it('accepts null text and no files key', () => {
    expect(toSubmissionDraft({ text: null })).toEqual({ text: null, files: [] })
  })

  it('rejects anything that is not a draft object', () => {
    for (const bad of [null, 1, 'x', [], { text: 'hello' }, { text: {} }]) {
      expect(toSubmissionDraft(bad)).toBeNull()
    }
  })

  it('drops malformed and duplicate files, keeps at most MAX_FILES', () => {
    const files = [
      FILE,
      FILE,
      { id: '', name: 'a', mimeType: 'image/png', sizeBytes: 1 },
      { id: 'f2', name: 'a', mimeType: 'image/png', sizeBytes: Number.NaN },
      { id: 'f3', name: 7, mimeType: 'image/png', sizeBytes: 1 },
      { id: 'f4', name: 'b.pdf', mimeType: 'application/pdf', sizeBytes: -1 },
      { id: 'x'.repeat(101), name: 'b.pdf', mimeType: 'application/pdf', sizeBytes: 1 },
      'f5',
      null,
      ...Array.from({ length: 12 }, (_, i) => ({ id: `ok${i}`, name: 'c.pdf', mimeType: 'application/pdf', sizeBytes: 9 })),
    ]
    const draft = toSubmissionDraft({ text: null, files })
    expect(draft?.files.map((f) => f.id)).toEqual(['f1', ...Array.from({ length: 9 }, (_, i) => `ok${i}`)])
  })

  it('keeps only the FileInfo fields', () => {
    const draft = toSubmissionDraft({ text: null, files: [{ ...FILE, extra: '<script>' }] })
    expect(draft?.files[0]).toEqual(FILE)
  })

  it('treats a non-array files value as no files', () => {
    expect(toSubmissionDraft({ text: null, files: 'f1' })).toEqual({ text: null, files: [] })
  })
})

describe('sameDraft', () => {
  const text = [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi', styles: {} }] }]

  it('is true for equal text and the same file ids in order', () => {
    expect(sameDraft({ text, files: [FILE] }, { text: structuredClone(text), files: [{ ...FILE }] })).toBe(true)
  })

  it('is false when the text differs', () => {
    expect(sameDraft({ text, files: [] }, { text: null, files: [] })).toBe(false)
  })

  it('counts an empty document as no text', () => {
    const empty = [{ type: 'paragraph', content: [], children: [] }]
    expect(sameDraft({ text: empty, files: [] }, { text: null, files: [] })).toBe(true)
  })

  it('is false when the files differ', () => {
    expect(sameDraft({ text: null, files: [FILE] }, { text: null, files: [] })).toBe(false)
  })
})

describe('settleDraftAfterSubmit', () => {
  const sent = { text: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sent', styles: {} }] }], files: [FILE] }

  it('clears the draft when nothing changed while sending', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    saveDraft('k', sent)
    expect(settleDraftAfterSubmit('k', sent, structuredClone(sent))).toBe('cleared')
    expect(loadDraft('k')).toBeNull()
  })

  it('keeps what was typed while sending as the draft', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const typed = { ...sent, text: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sent and more', styles: {} }] }] }
    saveDraft('k', sent)
    expect(settleDraftAfterSubmit('k', sent, typed)).toBe('kept')
    expect(loadDraft('k')).toEqual(typed)
  })

  it('keeps a changed file list as the draft', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const current = { text: sent.text, files: [] }
    expect(settleDraftAfterSubmit('k', sent, current)).toBe('kept')
    expect(loadDraft('k')).toEqual(current)
  })
})
