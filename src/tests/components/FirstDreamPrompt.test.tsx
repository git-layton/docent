import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { FirstDreamPrompt } from '../../components/FirstDreamPrompt'

const props = {
  fileCount: 12,
  isRunning: false,
  onRun: vi.fn(),
  onDismiss: vi.fn(),
}

function renderPrompt(over: Partial<typeof props> = {}) {
  return render(<FirstDreamPrompt {...props} {...over} />)
}

describe('FirstDreamPrompt', () => {
  beforeEach(() => vi.clearAllMocks())

  it('names the memory count so the invite is concrete', () => {
    renderPrompt()
    expect(screen.getByText(/12 memories/)).toBeInTheDocument()
  })

  it('runs the cycle when the user accepts', () => {
    renderPrompt()
    fireEvent.click(screen.getByRole('button', { name: 'Run once' }))
    expect(props.onRun).toHaveBeenCalledTimes(1)
    expect(props.onDismiss).not.toHaveBeenCalled()
  })

  it('dismisses without running', () => {
    renderPrompt()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(props.onDismiss).toHaveBeenCalledTimes(1)
    expect(props.onRun).not.toHaveBeenCalled()
  })

  it('locks the run button out while a dream is in flight', () => {
    renderPrompt({ isRunning: true })
    const run = screen.getByRole('button', { name: /Dreaming/ })
    expect(run).toBeDisabled()
    fireEvent.click(run)
    expect(props.onRun).not.toHaveBeenCalled()
  })
})
