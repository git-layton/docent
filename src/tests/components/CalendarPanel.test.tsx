import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CalendarPanel } from '../../components/CalendarPanel';
import { useTaskStore } from '../../store/useTaskStore';
import type { RecurringEvent } from '../../store/useTaskStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Reset store to a clean slate. Individual tests inject what they need. */
function resetStore() {
  useTaskStore.setState({ tasks: [], recurringEvents: [] });
}

/** A noop onToast that satisfies the required prop. */
const noopToast = () => {};

beforeEach(() => {
  resetStore();
  // Stabilise "now" so the rendered header is deterministic.
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0)); // 2026-06-15 (June)
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CalendarPanel', () => {
  it('renders the current month name and year in the header', () => {
    render(<CalendarPanel onToast={noopToast} />);
    expect(screen.getByText('June 2026')).toBeInTheDocument();
  });

  it('renders a recurring event on its day cell', () => {
    const event: RecurringEvent = {
      id: 'ev-test-1',
      type: 'birthday',
      name: 'Alice Wonderland',
      month: 6,
      day: 10,
    };
    useTaskStore.setState({ recurringEvents: [event] });

    render(<CalendarPanel onToast={noopToast} />);

    // Event chip shows the first name; the full name is on the title attr.
    const chip = screen.getByTitle('Alice Wonderland');
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toContain('Alice');
  });

  it('renders a task on its dueDate cell', () => {
    useTaskStore.setState({
      tasks: [
        { id: 't-1', title: 'Submit report', completed: false, dueDate: '2026-06-20' },
      ],
    });

    render(<CalendarPanel onToast={noopToast} />);

    expect(screen.getByTitle('Submit report')).toBeInTheDocument();
  });

  it('does not render a task whose dueDate is in a different month', () => {
    useTaskStore.setState({
      tasks: [
        { id: 't-1', title: 'Next month task', completed: false, dueDate: '2026-07-05' },
      ],
    });

    render(<CalendarPanel onToast={noopToast} />);

    expect(screen.queryByTitle('Next month task')).not.toBeInTheDocument();
  });

  it('prev/next buttons change the displayed month', () => {
    render(<CalendarPanel onToast={noopToast} />);

    expect(screen.getByText('June 2026')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Next month'));
    expect(screen.getByText('July 2026')).toBeInTheDocument();

    // Two clicks back from July -> May
    fireEvent.click(screen.getByLabelText('Previous month'));
    fireEvent.click(screen.getByLabelText('Previous month'));
    expect(screen.getByText('May 2026')).toBeInTheDocument();
  });

  it('next button rolls the year over from December to January', () => {
    useTaskStore.setState({ tasks: [], recurringEvents: [] });
    vi.setSystemTime(new Date(2026, 11, 1)); // December 2026
    render(<CalendarPanel onToast={noopToast} />);

    expect(screen.getByText('December 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Next month'));
    expect(screen.getByText('January 2027')).toBeInTheDocument();
  });

  it('adding a task via the inline form calls addTask and fires onToast', () => {
    const addTaskSpy = vi.fn();
    const onToast = vi.fn();
    useTaskStore.setState({ addTask: addTaskSpy });

    render(<CalendarPanel onToast={onToast} />);

    // Click a day cell to open the inline form (June 12, 2026).
    fireEvent.click(screen.getByLabelText(`${MONTHS[5]} 12, 2026`));

    // Task mode is the default — type a title and submit.
    const input = screen.getByLabelText('Task title');
    fireEvent.change(input, { target: { value: 'Pay rent' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));

    expect(addTaskSpy).toHaveBeenCalledTimes(1);
    expect(addTaskSpy).toHaveBeenCalledWith('Pay rent', '2026-06-12');
    expect(onToast).toHaveBeenCalledWith('Added task "Pay rent"');
  });

  it('adding an event via the inline form calls addRecurringEvent and fires onToast', () => {
    const addEventSpy = vi.fn();
    const onToast = vi.fn();
    useTaskStore.setState({ addRecurringEvent: addEventSpy });

    render(<CalendarPanel onToast={onToast} />);

    // Open the form for June 12, 2026.
    fireEvent.click(screen.getByLabelText(`${MONTHS[5]} 12, 2026`));

    // Switch to event mode.
    fireEvent.click(screen.getByRole('button', { name: /^event$/i }));

    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Mom' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));

    expect(addEventSpy).toHaveBeenCalledTimes(1);
    expect(addEventSpy).toHaveBeenCalledWith({
      type: 'birthday',
      name: 'Mom',
      month: 6,
      day: 12,
    });
    expect(onToast).toHaveBeenCalledWith('Added birthday for Mom');
  });

  it('clicking the same day again closes the inline form', () => {
    render(<CalendarPanel onToast={noopToast} />);

    const dayCell = screen.getByLabelText(`${MONTHS[5]} 12, 2026`);
    fireEvent.click(dayCell);
    expect(screen.getByLabelText('Task title')).toBeInTheDocument();

    fireEvent.click(dayCell);
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument();
  });

  it('highlights today with aria-current="date"', () => {
    render(<CalendarPanel onToast={noopToast} />);
    const todayCell = screen.getByLabelText(`${MONTHS[5]} 15, 2026`);
    expect(todayCell).toHaveAttribute('aria-current', 'date');
  });
});
