import { describe, it, expect, beforeEach } from 'vitest'
import { buildControlFrameScript } from '../../services/browserAnnotator'

// The script is a self-invoking IIFE string meant to run inside the browsed page; execute it against
// jsdom to assert the DOM it produces, the same way the real webview would.
function run(src: string) {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(src)()
}

describe('buildControlFrameScript', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  it('paints a click-through frame with a pill, and is idempotent within a page', () => {
    run(buildControlFrameScript(true))
    const frame = document.getElementById('__docent-control-frame')
    expect(frame).toBeTruthy()
    // Must never intercept the agent's own clicks.
    expect(frame!.style.pointerEvents).toBe('none')
    expect(frame!.getAttribute('aria-hidden')).toBe('true')
    expect(frame!.querySelector('.__docent-pill')).toBeTruthy()

    // Re-asserting (as observe() does every turn) doesn't stack duplicates.
    run(buildControlFrameScript(true))
    expect(document.querySelectorAll('#__docent-control-frame').length).toBe(1)
  })

  it('keeps its label out of the page text the model reads', () => {
    run(buildControlFrameScript(true))
    // Label is CSS generated content (::after), so it contributes no readable page text...
    const bodyText = document.body.innerText || document.body.textContent || ''
    expect(bodyText).not.toMatch(/Docent is browsing/)
    // ...it lives only in the injected stylesheet.
    expect(document.getElementById('__docent-control-style')!.textContent).toMatch(/Docent is browsing for you/)
  })

  it('removes the frame and its stylesheet on teardown', () => {
    run(buildControlFrameScript(true))
    run(buildControlFrameScript(false))
    expect(document.getElementById('__docent-control-frame')).toBeNull()
    expect(document.getElementById('__docent-control-style')).toBeNull()
  })

  it('is a safe no-op when there is nothing to remove', () => {
    expect(() => run(buildControlFrameScript(false))).not.toThrow()
  })
})
