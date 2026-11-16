import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from './button'

describe('Button pending', () => {
  it('shows a spinner, disables and marks busy while pending', () => {
    const html = renderToStaticMarkup(<Button pending>Save</Button>)
    expect(html).toContain('data-spinner')
    expect(html).toContain('disabled=""')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Save')
  })

  it('renders as before when not pending', () => {
    const html = renderToStaticMarkup(<Button>Save</Button>)
    expect(html).not.toContain('data-spinner')
    expect(html).not.toContain('aria-busy')
    // The class list always mentions `disabled:`, so check for the attribute itself.
    expect(html).not.toContain('disabled=""')
  })

  it('stays disabled for its own reason', () => {
    const html = renderToStaticMarkup(
      <Button disabled pending={false}>
        Save
      </Button>,
    )
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('data-spinner')
  })

  it('hides other icons while pending', () => {
    const html = renderToStaticMarkup(
      <Button pending size="icon" aria-label="Roster">
        <svg data-testid="icon" />
      </Button>,
    )
    expect(html).toContain('data-spinner')
    expect(html).toContain('[&amp;&gt;svg:not([data-spinner])]:hidden')
    expect(html).toContain('aria-label="Roster"')
  })

  it('ignores pending with asChild', () => {
    const html = renderToStaticMarkup(
      <Button asChild pending>
        <a href="/x">Go</a>
      </Button>,
    )
    expect(html).toContain('<a')
    expect(html).not.toContain('data-spinner')
  })
})
