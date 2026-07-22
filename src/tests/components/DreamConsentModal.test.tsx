import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { DreamConsentModal } from '../../components/DreamConsentModal'
import { useSettingsStore, type Model } from '../../store/useSettingsStore'

const hostedModel: Model = {
  id: 'm1', name: 'Test Model', provider: 'openai', modelId: 'gpt-x',
  endpoint: 'https://api.openai.com/v1', apiKey: 'sk', contextLimit: 128000,
  canImage: false, isLocal: false,
}
const localModel: Model = {
  ...hostedModel, id: 'm2', name: 'Local Llama', provider: 'ollama',
  endpoint: 'http://localhost:11434', isLocal: true,
}

function renderModal(model: Model | null, over: { onConfirm?: any; onCancel?: any } = {}) {
  const onConfirm = over.onConfirm ?? vi.fn()
  const onCancel = over.onCancel ?? vi.fn()
  render(<DreamConsentModal model={model} onConfirm={onConfirm} onCancel={onCancel} />)
  return { onConfirm, onCancel }
}

describe('DreamConsentModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('explains what a dream does and promises to ask only once', () => {
    renderModal(localModel)
    expect(screen.getByText(/only ask this once/i)).toBeInTheDocument()
    expect(screen.getByText(/reviews your assistant's memory/i)).toBeInTheDocument()
  })

  it('reassures that a local model costs nothing', () => {
    renderModal(localModel)
    expect(screen.getByText(/locally, on your Mac/i)).toBeInTheDocument()
    expect(screen.getByText(/no per-run cost/i)).toBeInTheDocument()
    // No hosted-cost warning and no local-model nudge when the model is already local.
    expect(screen.queryByText(/charges per run/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Set up a local model/i })).not.toBeInTheDocument()
  })

  it('warns about cost and nudges a local model for a hosted model', () => {
    renderModal(hostedModel)
    expect(screen.getByText(/Test Model/)).toBeInTheDocument()
    expect(screen.getByText(/charges per run/i)).toBeInTheDocument()
    expect(screen.getByText(/spending limit/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Set up a local model/i })).toBeInTheDocument()
  })

  it('treats a missing model as hosted (cannot assume free)', () => {
    renderModal(null)
    expect(screen.getByText(/charges per run/i)).toBeInTheDocument()
  })

  it('runs the cycle only when the user confirms', () => {
    const { onConfirm, onCancel } = renderModal(hostedModel)
    fireEvent.click(screen.getByRole('button', { name: /Run Dream Cycle/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('backs out without consenting on "Not now"', () => {
    const { onConfirm, onCancel } = renderModal(hostedModel)
    fireEvent.click(screen.getByRole('button', { name: /Not now/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('routes the local-model nudge to AI Models settings and steps aside', () => {
    const setTab = vi.fn()
    const setShow = vi.fn()
    useSettingsStore.setState({ setProfileSettingsTab: setTab, setShowProfileSettings: setShow } as any)
    const { onConfirm, onCancel } = renderModal(hostedModel)
    fireEvent.click(screen.getByRole('button', { name: /Set up a local model/i }))
    expect(setTab).toHaveBeenCalledWith('models')
    expect(setShow).toHaveBeenCalledWith(true)
    expect(onCancel).toHaveBeenCalledTimes(1) // stands down; no consent recorded
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
