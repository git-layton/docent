import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { DreamDigestModal, type DreamLog } from '../../components/DreamDigestModal'
import { useSettingsStore } from '../../store/useSettingsStore'

const log: DreamLog = {
  timestamp: new Date('2026-07-20T09:00:00Z').toISOString(),
  dismissed: false,
  tokens_saved: 1200,
  items_count: 1,
  items: [
    {
      id: 'dream-1',
      type: 'merged',
      description: 'Combined 3 voice memos about Project Bakery',
      archive_paths: ['/archive/a.md'],
      original_paths: ['/memory/a.md'],
      git_commits: [],
    },
  ],
}

const persistSpy = vi.fn().mockResolvedValue(undefined)

function renderModal(dreamAutoEnabled: boolean | undefined) {
  useSettingsStore.setState({
    appSettings: { ...useSettingsStore.getState().appSettings, dreamAutoEnabled },
    persist: persistSpy,
  } as any)
  return render(<DreamDigestModal log={log} onClose={vi.fn()} onUndo={vi.fn()} />)
}

const CTA = 'Enable daily dreams'

describe('DreamDigestModal — daily dream conversion', () => {
  beforeEach(() => vi.clearAllMocks())

  it('offers the daily opt-in when auto-dreams are off', () => {
    renderModal(false)
    expect(screen.getByRole('button', { name: CTA })).toBeInTheDocument()
  })

  it('offers it when the setting has never been touched', () => {
    renderModal(undefined)
    expect(screen.getByRole('button', { name: CTA })).toBeInTheDocument()
  })

  it('stays out of the way once auto-dreams are already on', () => {
    renderModal(true)
    expect(screen.queryByRole('button', { name: CTA })).not.toBeInTheDocument()
  })

  it('enables and flushes the setting rather than waiting on the debounced autosave', () => {
    renderModal(false)
    fireEvent.click(screen.getByRole('button', { name: CTA }))

    expect(useSettingsStore.getState().appSettings.dreamAutoEnabled).toBe(true)
    expect(persistSpy).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: CTA })).not.toBeInTheDocument()
    expect(screen.getByText(/Daily dreams on/)).toBeInTheDocument()
  })
})
