import { describe, expect, it } from 'vitest'
import type { MarkingInput } from './inputs'
import { buildSystemPrompt, buildUserContent } from './prompt'

const base: MarkingInput = {
  title: 'Essay on osmosis',
  instructions: 'Explain osmosis in 300 words.',
  markingGuide: 'Award 5 marks for the membrane.',
  maxMark: 20,
  studentText: 'Osmosis is water moving.',
  images: [],
  documents: [],
}

describe('buildSystemPrompt', () => {
  it('treats the student work as data and states the marking rules', () => {
    const p = buildSystemPrompt()
    expect(p).toMatch(/never instructions/i)
    expect(p).toMatch(/marking guide/i)
    expect(p).toMatch(/0\.25/)
    expect(p).toMatch(/language the student wrote in/i)
    expect(p).toContain('[unreadable]')
  })
})

describe('buildUserContent', () => {
  it('puts the assignment, guide and typed text in one tagged text part', () => {
    const parts = buildUserContent(base)
    expect(parts).toHaveLength(1)
    const text = (parts[0] as { text: string }).text
    expect(text).toContain('<assignment>')
    expect(text).toContain('Essay on osmosis')
    expect(text).toContain('Explain osmosis in 300 words.')
    expect(text).toMatch(/Maximum mark: 20/)
    expect(text).toMatch(/<marking_guide>\s*Award 5 marks for the membrane\.\s*<\/marking_guide>/)
    expect(text).toMatch(/<student_work>\s*Osmosis is water moving\.\s*<\/student_work>/)
  })

  it('says none when there is no guide or typed text', () => {
    const text = (buildUserContent({ ...base, markingGuide: null, studentText: null })[0] as { text: string }).text
    expect(text).toMatch(/<marking_guide>\s*none\s*<\/marking_guide>/)
    expect(text).toMatch(/<student_work>\s*none\s*<\/student_work>/)
  })

  it('adds files in position order, each after a File N label, with citations on PDFs only', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const parts = buildUserContent({
      ...base,
      images: [
        { position: 3, data: bytes, mediaType: 'image/jpeg' },
        { position: 1, data: bytes, mediaType: 'image/png' },
      ],
      documents: [
        { position: 2, data: bytes, mediaType: 'application/pdf' },
        {
          position: 4,
          data: bytes,
          mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      ],
    })
    expect(parts).toHaveLength(1 + 4 * 2)
    const labels = parts.slice(1).filter((p) => p.type === 'text').map((p) => (p as { text: string }).text)
    expect(labels).toEqual(['File 1', 'File 2', 'File 3', 'File 4'])
    const files = parts.slice(1).filter((p) => p.type !== 'text')
    expect(files.map((p) => p.type)).toEqual(['image', 'file', 'image', 'file'])
    const pdf = files[1] as { providerOptions?: unknown; mediaType: string }
    expect(pdf.mediaType).toBe('application/pdf')
    expect(pdf.providerOptions).toEqual({ bedrock: { citations: { enabled: true } } })
    const docx = files[3] as { providerOptions?: unknown }
    expect(docx.providerOptions).toBeUndefined()
    const img = files[0] as { providerOptions?: unknown }
    expect(img.providerOptions).toBeUndefined()
  })
})
