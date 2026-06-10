import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Bot } from 'lucide-react';
import { SpaceHomeLanding } from '../../components/SpaceHomeLanding';
import type { SuggestionChip } from '../../components/SpaceHomeLanding';

afterEach(() => {
  cleanup();
});

describe('SpaceHomeLanding', () => {
  it('renders the headline text', () => {
    render(<SpaceHomeLanding onSendPrompt={() => {}} />);
    expect(
      screen.getByRole('heading', { name: /what are we diving into today\?/i }),
    ).toBeTruthy();
  });

  it('renders the default chips when no suggestions prop is given', () => {
    render(<SpaceHomeLanding onSendPrompt={() => {}} />);
    // Default set spans drafting, research, web, planning, building.
    expect(screen.getByRole('button', { name: /draft something/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /research a topic/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /search the web/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /plan my week/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /build a quick tool/i })).toBeTruthy();

    // 4–6 chips per the contract.
    const chips = screen.getAllByRole('button');
    expect(chips.length).toBeGreaterThanOrEqual(4);
    expect(chips.length).toBeLessThanOrEqual(6);
  });

  it('calls onSendPrompt with the chip prompt when a chip is clicked', async () => {
    const user = userEvent.setup();
    const onSendPrompt = vi.fn();
    render(<SpaceHomeLanding onSendPrompt={onSendPrompt} />);

    await user.click(screen.getByRole('button', { name: /draft something/i }));

    expect(onSendPrompt).toHaveBeenCalledTimes(1);
    // It sends the chip's prompt, not its label.
    const sent = onSendPrompt.mock.calls[0][0];
    expect(typeof sent).toBe('string');
    expect(sent).toMatch(/draft/i);
    expect(sent).not.toBe('Draft something');
  });

  it('overrides the defaults when a custom suggestions prop is provided', async () => {
    const user = userEvent.setup();
    const onSendPrompt = vi.fn();
    const custom: SuggestionChip[] = [
      { id: 'a', label: 'Only Chip', prompt: 'custom prompt text', icon: Bot },
    ];
    render(<SpaceHomeLanding onSendPrompt={onSendPrompt} suggestions={custom} />);

    // Defaults are gone.
    expect(screen.queryByRole('button', { name: /draft something/i })).toBeNull();

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /only chip/i }));
    expect(onSendPrompt).toHaveBeenCalledWith('custom prompt text');
  });

  it('mentions agentName in the subtitle when provided', () => {
    render(<SpaceHomeLanding agentName="Atlas" onSendPrompt={() => {}} />);
    expect(screen.getByText(/chat with atlas/i)).toBeTruthy();
  });

  it('does not mention an agent in the subtitle when agentName is absent', () => {
    render(<SpaceHomeLanding onSendPrompt={() => {}} />);
    expect(screen.queryByText(/chat with/i)).toBeNull();
  });
});
