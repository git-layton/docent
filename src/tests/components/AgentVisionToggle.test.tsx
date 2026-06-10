import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { AgentVisionToggle } from '../../components/AgentVisionToggle'

describe('AgentVisionToggle', () => {
  it('renders a switch role', () => {
    render(<AgentVisionToggle on={true} onToggle={() => {}} />)
    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('reflects the "on" (Review) state', () => {
    render(<AgentVisionToggle on={true} onToggle={() => {}} />)
    const sw = screen.getByRole('switch')
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(sw).toHaveTextContent(/review/i)
  })

  it('reflects the "off" (Focus) state', () => {
    render(<AgentVisionToggle on={false} onToggle={() => {}} />)
    const sw = screen.getByRole('switch')
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(sw).toHaveTextContent(/focus/i)
  })

  it('calls onToggle with the negated value when on', () => {
    const onToggle = vi.fn()
    render(<AgentVisionToggle on={true} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('calls onToggle with the negated value when off', () => {
    const onToggle = vi.fn()
    render(<AgentVisionToggle on={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith(true)
  })
})
