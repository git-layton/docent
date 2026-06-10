import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MarginaliaLayer } from '../../components/MarginaliaLayer'
import type { Annotation } from '../../store/useMarginaliaStore'

const TAB = 'tab-1'

function ann(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'ann-1',
    tabId: TAB,
    agentId: 'dev',
    color: '#6AA9FF',
    anchor: { kind: 'text', start: 0, end: 4 },
    body: 'Tighten this sentence.',
    status: 'open',
    createdAt: 0,
    ...overrides,
  }
}

describe('MarginaliaLayer — visibility', () => {
  it('returns null when not visible', () => {
    const { container } = render(
      <MarginaliaLayer
        tabId={TAB}
        annotations={[ann()]}
        visible={false}
        onAccept={() => {}}
        onDismiss={() => {}}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('returns null when there are no annotations', () => {
    const { container } = render(
      <MarginaliaLayer
        tabId={TAB}
        annotations={[]}
        visible={true}
        onAccept={() => {}}
        onDismiss={() => {}}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('returns null when all annotations belong to other tabs', () => {
    const { container } = render(
      <MarginaliaLayer
        tabId={TAB}
        annotations={[ann({ tabId: 'other-tab' })]}
        visible={true}
        onAccept={() => {}}
        onDismiss={() => {}}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('returns null when all annotations are resolved', () => {
    const { container } = render(
      <MarginaliaLayer
        tabId={TAB}
        annotations={[ann({ status: 'dismissed' }), ann({ id: 'ann-2', status: 'accepted' })]}
        visible={true}
        onAccept={() => {}}
        onDismiss={() => {}}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('MarginaliaLayer — rendering', () => {
  it('renders one card per open annotation for the tab', () => {
    render(
      <MarginaliaLayer
        tabId={TAB}
        annotations={[
          ann({ id: 'a', body: 'first' }),
          ann({ id: 'b', body: 'second' }),
        ]}
        visible={true}
        onAccept={() => {}}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getAllByTestId('marginalia-card')).toHaveLength(2)
  })

  it('shows the annotation body', () => {
    render(
      <MarginaliaLayer
        tabId={TAB}
        annotations={[ann({ body: 'Make this clearer.' })]}
        visible={true}
        onAccept={() => {}}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByText('Make this clearer.')).toBeInTheDocument()
  })

  it('shows the suggested rewrite in a monospace block when present', () => {
    render(
      <MarginaliaLayer
        tabId={TAB}
        annotations={[ann({ suggestedText: 'The improved text.' })]}
        visible={true}
        onAccept={() => {}}
        onDismiss={() => {}}
      />,
    )
    const block = screen.getByTestId('marginalia-suggestion')
    expect(block).toHaveTextContent('The improved text.')
  })
})

describe('MarginaliaLayer — actions', () => {
  it('does not render Apply Fix without a suggestion', () => {
    render(
      <MarginaliaLayer
        tabId={TAB}
        annotations={[ann({ suggestedText: undefined })]}
        visible={true}
        onAccept={() => {}}
        onDismiss={() => {}}
      />,
    )
    expect(screen.queryByText(/apply fix/i)).not.toBeInTheDocument()
  })

  it('renders Apply Fix when a suggestion exists and calls onAccept(id)', () => {
    const onAccept = vi.fn()
    render(
      <MarginaliaLayer
        tabId={TAB}
        annotations={[ann({ id: 'ann-42', suggestedText: 'fix me' })]}
        visible={true}
        onAccept={onAccept}
        onDismiss={() => {}}
      />,
    )
    fireEvent.click(screen.getByText(/apply fix/i))
    expect(onAccept).toHaveBeenCalledWith('ann-42')
  })

  it('calls onDismiss(id) when Dismiss is clicked', () => {
    const onDismiss = vi.fn()
    render(
      <MarginaliaLayer
        tabId={TAB}
        annotations={[ann({ id: 'ann-7' })]}
        visible={true}
        onAccept={() => {}}
        onDismiss={onDismiss}
      />,
    )
    fireEvent.click(screen.getByText(/dismiss/i))
    expect(onDismiss).toHaveBeenCalledWith('ann-7')
  })
})
