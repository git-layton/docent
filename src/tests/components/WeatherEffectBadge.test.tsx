import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { OmniTabBar } from '../../components/OmniTabBar'
import { useSpaceStore } from '../../store/useSpaceStore'
import { useWeatherStore } from '../../store/useWeatherStore'

// A hazy day must never read as a rendering bug: when live weather visibly tints the
// background, the tab bar shows a small badge whose hover text says exactly why.

describe('OmniTabBar — weather effect badge', () => {
  beforeEach(() => {
    useSpaceStore.setState({ omniTabs: [], activeOmniTabId: null, spaces: [], activeSpaceId: null })
    useWeatherStore.setState({ weatherCode: null, locationLabel: '' })
  })

  it('shows a fog badge with an explanation when the WMO code is fog (45)', () => {
    useWeatherStore.setState({ weatherCode: 45, locationLabel: 'Columbus, OH' })
    render(<OmniTabBar />)
    const badge = screen.getByTitle(/Hazy right now — live weather is adding this fog/)
    expect(badge).toBeInTheDocument()
    expect(badge.title).toContain('Columbus, OH')
    expect(badge.title).toContain('Clear the weather location in Settings')
  })

  it('shows a storm badge for thunderstorm codes', () => {
    useWeatherStore.setState({ weatherCode: 95 })
    render(<OmniTabBar />)
    expect(screen.getByTitle(/Storm — live weather/)).toBeInTheDocument()
  })

  it('renders no badge in clear or cloudy conditions', () => {
    useWeatherStore.setState({ weatherCode: 0 })
    const { container } = render(<OmniTabBar />)
    expect(container.querySelector('[title*="live weather"]')).toBeNull()
    useWeatherStore.setState({ weatherCode: 2 }) // cloudy — background tint is mild, no badge
    expect(container.querySelector('[title*="live weather"]')).toBeNull()
  })
})
