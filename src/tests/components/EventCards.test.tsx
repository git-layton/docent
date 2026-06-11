import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EventCard, EventUpdateCard, EventDeleteCard, GcalUpdateCard, GcalDeleteCard } from '../../components/EventCards';
import { CalendarPanel } from '../../components/CalendarPanel';
import { useTaskStore } from '../../store/useTaskStore';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

beforeEach(() => {
  useTaskStore.setState({ tasks: [], recurringEvents: [] });
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0)); // 2026-06-15
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('EventCard (one-time / multi-day)', () => {
  it('pre-fills fields from the agent payload', () => {
    render(
      <EventCard
        data={{ type: 'date', title: 'Team Offsite', dueDate: '2026-06-20', details: 'Bring laptop' }}
        onToast={() => {}}
      />,
    );
    expect((screen.getByLabelText('Event title') as HTMLInputElement).value).toBe('Team Offsite');
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe('2026-06-20');
    expect((screen.getByLabelText('Details') as HTMLTextAreaElement).value).toBe('Bring laptop');
  });

  it('books a multi-day event with an edited end date and details', () => {
    const addTask = vi.fn();
    const setShowPlanner = vi.fn();
    const onToast = vi.fn();
    useTaskStore.setState({ addTask, setShowPlanner });

    render(
      <EventCard data={{ type: 'date', title: 'Conf', dueDate: '2026-06-20' }} onToast={onToast} />,
    );

    // User edits the fields before saving.
    fireEvent.change(screen.getByLabelText('Event title'), { target: { value: 'DevConf 2026' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-06-23' } });
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Hotel booked' } });

    fireEvent.click(screen.getByRole('button', { name: /add event/i }));

    expect(addTask).toHaveBeenCalledTimes(1);
    expect(addTask).toHaveBeenCalledWith('DevConf 2026', '2026-06-20', 'Hotel booked', '', '2026-06-23');
    expect(setShowPlanner).toHaveBeenCalledWith(true);
    expect(onToast).toHaveBeenCalledWith('Added "DevConf 2026" (2026-06-20 → 2026-06-23)');
  });

  it('drops an end date that is not after the start (single-day)', () => {
    const addTask = vi.fn();
    useTaskStore.setState({ addTask, setShowPlanner: vi.fn() });

    render(<EventCard data={{ type: 'date', title: 'Lunch', dueDate: '2026-06-20' }} onToast={() => {}} />);

    // End equal to start -> not a real span.
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-06-20' } });
    fireEvent.click(screen.getByRole('button', { name: /add event/i }));

    expect(addTask).toHaveBeenCalledWith('Lunch', '2026-06-20', '', '', null);
  });
});

describe('EventCard (recurring)', () => {
  it('books a recurring event with an edited name and date', () => {
    const addRecurringEvent = vi.fn();
    const onToast = vi.fn();
    useTaskStore.setState({ addRecurringEvent, setShowPlanner: vi.fn() });

    render(<EventCard data={{ type: 'birthday', name: 'Mom', month: 6, day: 10 }} onToast={onToast} />);

    fireEvent.change(screen.getByLabelText('Event name'), { target: { value: 'Mother' } });
    fireEvent.change(screen.getByLabelText('Event date'), { target: { value: '2026-07-04' } });
    fireEvent.click(screen.getByRole('button', { name: /add event/i }));

    expect(addRecurringEvent).toHaveBeenCalledTimes(1);
    const arg = addRecurringEvent.mock.calls[0][0];
    expect(arg).toMatchObject({ type: 'birthday', name: 'Mother', month: 7, day: 4 });
  });
});

describe('CalendarPanel multi-day rendering', () => {
  it('shows a multi-day task on every day it spans', () => {
    useTaskStore.setState({
      tasks: [
        { id: 't-span', title: 'Vacation', completed: false, dueDate: '2026-06-10', endDate: '2026-06-13' },
      ],
    });

    render(<CalendarPanel onToast={() => {}} />);

    // The chip carries the full span in its title attribute and should appear
    // once per covered day (Jun 10, 11, 12, 13 = 4 cells).
    const chips = screen.getAllByTitle('Vacation (2026-06-10 → 2026-06-13)');
    expect(chips).toHaveLength(4);
  });

  it('does not bleed a multi-day task onto days outside its span', () => {
    useTaskStore.setState({
      tasks: [
        { id: 't-span', title: 'Trip', completed: false, dueDate: '2026-06-10', endDate: '2026-06-11' },
      ],
    });

    render(<CalendarPanel onToast={() => {}} />);

    // Jun 9 cell exists but must not contain the chip.
    const jun9 = screen.getByLabelText(`${MONTHS[5]} 9, 2026`);
    expect(jun9.querySelector('[title^="Trip"]')).toBeNull();
    expect(screen.getAllByTitle('Trip (2026-06-10 → 2026-06-11)')).toHaveLength(2);
  });
});

describe('EventUpdateCard (move / edit)', () => {
  it('reschedules a task referenced by id', () => {
    const updateTask = vi.fn();
    useTaskStore.setState({
      tasks: [{ id: 't-1', title: 'Dentist', completed: false, dueDate: '2026-06-20' }],
      updateTask,
      setShowPlanner: vi.fn(),
    });

    render(<EventUpdateCard data={{ id: 't-1', dueDate: '2026-06-25' }} onToast={() => {}} />);

    // The current value is shown and the new start is pre-filled from the payload.
    expect(screen.getByText('Dentist')).toBeInTheDocument();
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe('2026-06-25');

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(updateTask).toHaveBeenCalledWith('t-1', expect.objectContaining({ dueDate: '2026-06-25' }));
  });

  it('falls back to a case-insensitive title match when no id is given', () => {
    const updateTask = vi.fn();
    useTaskStore.setState({
      tasks: [{ id: 't-9', title: 'Quarterly Review', completed: false, dueDate: '2026-06-20' }],
      updateTask,
      setShowPlanner: vi.fn(),
    });

    render(<EventUpdateCard data={{ title: 'quarterly review', dueDate: '2026-07-01' }} onToast={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(updateTask).toHaveBeenCalledWith('t-9', expect.objectContaining({ dueDate: '2026-07-01' }));
  });

  it('shows a not-found notice when the item cannot be resolved', () => {
    useTaskStore.setState({ tasks: [], recurringEvents: [] });
    render(<EventUpdateCard data={{ id: 'missing' }} onToast={() => {}} />);
    expect(screen.getByText(/couldn't find/i)).toBeInTheDocument();
  });
});

describe('EventDeleteCard', () => {
  it('deletes a task by id after confirmation', () => {
    const deleteTask = vi.fn();
    useTaskStore.setState({
      tasks: [{ id: 't-1', title: 'Old meeting', completed: false, dueDate: '2026-06-20' }],
      deleteTask,
    });

    const onToast = vi.fn();
    render(<EventDeleteCard data={{ id: 't-1' }} onToast={onToast} />);

    expect(screen.getByText('Old meeting')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(deleteTask).toHaveBeenCalledWith('t-1');
    expect(onToast).toHaveBeenCalledWith('Deleted "Old meeting"');
  });

  it('deletes a recurring event by id', () => {
    const deleteRecurringEvent = vi.fn();
    useTaskStore.setState({
      tasks: [],
      recurringEvents: [{ id: 'ev-1', type: 'birthday', name: 'Grandma', month: 5, day: 2 }],
      deleteRecurringEvent,
    });

    render(<EventDeleteCard data={{ id: 'ev-1' }} onToast={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(deleteRecurringEvent).toHaveBeenCalledWith('ev-1');
  });
});

describe('Google Calendar move/delete cards', () => {
  it('guards against a missing event id', () => {
    render(<GcalUpdateCard data={{ title: 'No id event' }} onToast={() => {}} />);
    expect(screen.getByText(/couldn't find/i)).toBeInTheDocument();
  });

  it('renders a delete confirmation for an event with an id', () => {
    render(<GcalDeleteCard data={{ eventId: 'abc123', title: 'Sync call' }} onToast={() => {}} />);
    expect(screen.getByText('Sync call')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete event/i })).toBeInTheDocument();
  });
});
