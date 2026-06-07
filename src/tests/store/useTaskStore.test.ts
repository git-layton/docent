import { describe, it, expect, beforeEach } from 'vitest'
import { useTaskStore } from '../../store/useTaskStore'
import type { RecurringEvent } from '../../store/useTaskStore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useTaskStore.setState({
    tasks: [],
    recurringEvents: [],
    showPlanner: false,
    plannerView: 'list',
    newTaskInput: '',
    newTaskDate: '',
    newTaskDetails: '',
    newTaskLocation: '',
    showTaskDetailsForm: false,
    taskToDiscuss: null,
    draggedTaskId: null,
  })
}

// ---------------------------------------------------------------------------
// generateId — tested indirectly via addTask / addRecurringEvent
// ---------------------------------------------------------------------------

describe('generateId (via task / event creation)', () => {
  beforeEach(resetStore)

  it('task id starts with the "t" prefix', () => {
    useTaskStore.getState().addTask('Test task')
    const [task] = useTaskStore.getState().tasks
    expect(task.id).toMatch(/^t-/)
  })

  it('recurring-event id starts with the "ev" prefix', () => {
    useTaskStore.getState().addRecurringEvent({
      type: 'birthday',
      name: 'Alice',
      month: 6,
      day: 1,
    })
    const [event] = useTaskStore.getState().recurringEvents
    expect(event.id).toMatch(/^ev-/)
  })

  it('id format is prefix-timestamp-random (3 dash-separated parts)', () => {
    useTaskStore.getState().addTask('Format check')
    const [task] = useTaskStore.getState().tasks
    const parts = task.id.split('-')
    // "t", timestamp digits, random alphanumeric
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('t')
    expect(parts[1]).toMatch(/^\d+$/)
    expect(parts[2]).toMatch(/^[a-z0-9]+$/)
  })

  it('100 consecutive addTask calls produce 100 unique ids', () => {
    for (let i = 0; i < 100; i++) {
      useTaskStore.getState().addTask(`Task ${i}`)
    }
    const ids = useTaskStore.getState().tasks.map((t: any) => t.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// addTask
// ---------------------------------------------------------------------------

describe('addTask', () => {
  beforeEach(resetStore)

  it('appends a task to the tasks array', () => {
    useTaskStore.getState().addTask('Buy groceries')
    expect(useTaskStore.getState().tasks).toHaveLength(1)
  })

  it('task title is trimmed', () => {
    useTaskStore.getState().addTask('  Hello world  ')
    const [task] = useTaskStore.getState().tasks
    expect(task.title).toBe('Hello world')
  })

  it('task starts with completed = false', () => {
    useTaskStore.getState().addTask('New task')
    expect(useTaskStore.getState().tasks[0].completed).toBe(false)
  })

  it('task starts with completedAt = undefined', () => {
    useTaskStore.getState().addTask('New task')
    expect(useTaskStore.getState().tasks[0].completedAt).toBeUndefined()
  })

  it('task has a numeric createdAt timestamp', () => {
    const before = Date.now()
    useTaskStore.getState().addTask('Timestamp task')
    const after = Date.now()
    const { createdAt } = useTaskStore.getState().tasks[0]
    expect(createdAt).toBeGreaterThanOrEqual(before)
    expect(createdAt).toBeLessThanOrEqual(after)
  })

  it('stores optional details and location', () => {
    useTaskStore.getState().addTask('Detailed task', null, 'Some details', 'Home')
    const [task] = useTaskStore.getState().tasks
    expect(task.details).toBe('Some details')
    expect(task.location).toBe('Home')
  })

  it('uses supplied dueDate when provided', () => {
    useTaskStore.getState().addTask('Meeting', '2025-12-31')
    expect(useTaskStore.getState().tasks[0].dueDate).toBe('2025-12-31')
  })

  it('falls back to today as date-only string when dueDate is omitted', () => {
    useTaskStore.getState().addTask('No date task')
    const dueDate: string = useTaskStore.getState().tasks[0].dueDate
    // Should match YYYY-MM-DD and not contain a time component
    expect(dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('multiple tasks accumulate correctly', () => {
    useTaskStore.getState().addTask('First')
    useTaskStore.getState().addTask('Second')
    useTaskStore.getState().addTask('Third')
    expect(useTaskStore.getState().tasks).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// toggleTask
// ---------------------------------------------------------------------------

describe('toggleTask', () => {
  beforeEach(resetStore)

  it('sets completed=true on first toggle', () => {
    useTaskStore.getState().addTask('Toggle me')
    const id: string = useTaskStore.getState().tasks[0].id
    useTaskStore.getState().toggleTask(id)
    expect(useTaskStore.getState().tasks[0].completed).toBe(true)
  })

  it('sets completedAt to a timestamp on first toggle', () => {
    const before = Date.now()
    useTaskStore.getState().addTask('Toggle me')
    const id: string = useTaskStore.getState().tasks[0].id
    useTaskStore.getState().toggleTask(id)
    const after = Date.now()
    const { completedAt } = useTaskStore.getState().tasks[0]
    expect(completedAt).toBeGreaterThanOrEqual(before)
    expect(completedAt).toBeLessThanOrEqual(after)
  })

  it('clears completedAt on second toggle (un-complete)', () => {
    useTaskStore.getState().addTask('Toggle twice')
    const id: string = useTaskStore.getState().tasks[0].id
    useTaskStore.getState().toggleTask(id)
    useTaskStore.getState().toggleTask(id)
    expect(useTaskStore.getState().tasks[0].completed).toBe(false)
    expect(useTaskStore.getState().tasks[0].completedAt).toBeUndefined()
  })

  it('does not affect other tasks when toggling one', () => {
    useTaskStore.getState().addTask('Task A')
    useTaskStore.getState().addTask('Task B')
    const idA: string = useTaskStore.getState().tasks[0].id
    useTaskStore.getState().toggleTask(idA)
    expect(useTaskStore.getState().tasks[1].completed).toBe(false)
  })

  it('does nothing when id does not exist', () => {
    useTaskStore.getState().addTask('Existing task')
    expect(() => useTaskStore.getState().toggleTask('nonexistent-id')).not.toThrow()
    expect(useTaskStore.getState().tasks).toHaveLength(1)
    expect(useTaskStore.getState().tasks[0].completed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// deleteTask
// ---------------------------------------------------------------------------

describe('deleteTask', () => {
  beforeEach(resetStore)

  it('removes the task from the array', () => {
    useTaskStore.getState().addTask('To delete')
    const id: string = useTaskStore.getState().tasks[0].id
    useTaskStore.getState().deleteTask(id)
    expect(useTaskStore.getState().tasks).toHaveLength(0)
  })

  it('only removes the targeted task', () => {
    useTaskStore.getState().addTask('Keep me')
    useTaskStore.getState().addTask('Delete me')
    const deleteId: string = useTaskStore.getState().tasks[1].id
    useTaskStore.getState().deleteTask(deleteId)
    expect(useTaskStore.getState().tasks).toHaveLength(1)
    expect(useTaskStore.getState().tasks[0].title).toBe('Keep me')
  })

  it('does not throw when deleting a non-existent id', () => {
    useTaskStore.getState().addTask('Surviving task')
    expect(() => useTaskStore.getState().deleteTask('ghost-id')).not.toThrow()
    expect(useTaskStore.getState().tasks).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Date normalisation (toLocalISODate inside addTask)
// ---------------------------------------------------------------------------

describe('date normalisation', () => {
  beforeEach(resetStore)

  it('a full ISO timestamp supplied as dueDate is stored as-is (no stripping)', () => {
    // The store stores dueDate exactly as provided; normalisation only applies
    // to the auto-generated default date.
    useTaskStore.getState().addTask('ISO task', '2025-07-04T12:00:00.000Z')
    expect(useTaskStore.getState().tasks[0].dueDate).toBe('2025-07-04T12:00:00.000Z')
  })

  it('auto-generated dueDate is always a date-only string (no time component)', () => {
    useTaskStore.getState().addTask('Auto date')
    const dueDate: string = useTaskStore.getState().tasks[0].dueDate
    expect(dueDate).not.toContain('T')
    expect(dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// ---------------------------------------------------------------------------
// addRecurringEvent / deleteRecurringEvent
// ---------------------------------------------------------------------------

describe('addRecurringEvent', () => {
  beforeEach(resetStore)

  it('adds a recurring event to recurringEvents', () => {
    const event: Omit<RecurringEvent, 'id'> = {
      type: 'birthday',
      name: 'Bob',
      month: 3,
      day: 15,
    }
    useTaskStore.getState().addRecurringEvent(event)
    expect(useTaskStore.getState().recurringEvents).toHaveLength(1)
  })

  it('assigns a generated id starting with "ev"', () => {
    useTaskStore.getState().addRecurringEvent({ type: 'anniversary', name: 'Wedding', month: 9, day: 20 })
    expect(useTaskStore.getState().recurringEvents[0].id).toMatch(/^ev-/)
  })

  it('stores all provided fields', () => {
    const event: Omit<RecurringEvent, 'id'> = {
      type: 'custom',
      name: 'Launch day',
      month: 1,
      day: 1,
      year: 2020,
    }
    useTaskStore.getState().addRecurringEvent(event)
    const stored = useTaskStore.getState().recurringEvents[0]
    expect(stored.type).toBe('custom')
    expect(stored.name).toBe('Launch day')
    expect(stored.month).toBe(1)
    expect(stored.day).toBe(1)
    expect(stored.year).toBe(2020)
  })

  it('accumulates multiple events', () => {
    useTaskStore.getState().addRecurringEvent({ type: 'birthday', name: 'Alice', month: 6, day: 1 })
    useTaskStore.getState().addRecurringEvent({ type: 'birthday', name: 'Charlie', month: 11, day: 30 })
    expect(useTaskStore.getState().recurringEvents).toHaveLength(2)
  })
})

describe('deleteRecurringEvent', () => {
  beforeEach(resetStore)

  it('removes the specified recurring event', () => {
    useTaskStore.getState().addRecurringEvent({ type: 'birthday', name: 'Dave', month: 4, day: 10 })
    const id: string = useTaskStore.getState().recurringEvents[0].id
    useTaskStore.getState().deleteRecurringEvent(id)
    expect(useTaskStore.getState().recurringEvents).toHaveLength(0)
  })

  it('only removes the targeted event', () => {
    useTaskStore.getState().addRecurringEvent({ type: 'birthday', name: 'Eve', month: 5, day: 5 })
    useTaskStore.getState().addRecurringEvent({ type: 'anniversary', name: 'Wedding', month: 8, day: 14 })
    const deleteId: string = useTaskStore.getState().recurringEvents[0].id
    useTaskStore.getState().deleteRecurringEvent(deleteId)
    expect(useTaskStore.getState().recurringEvents).toHaveLength(1)
    expect(useTaskStore.getState().recurringEvents[0].name).toBe('Wedding')
  })

  it('does not throw when deleting a non-existent id', () => {
    expect(() => useTaskStore.getState().deleteRecurringEvent('ghost-ev-id')).not.toThrow()
    expect(useTaskStore.getState().recurringEvents).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// persist & hydrate (via localStorage fallback — no Tauri runtime in tests)
// ---------------------------------------------------------------------------

describe('persist', () => {
  beforeEach(() => {
    resetStore()
    localStorage.clear()
  })

  it('writes tasks to localStorage (no-Tauri fallback)', async () => {
    useTaskStore.getState().addTask('Persisted task')
    await useTaskStore.getState().persist()
    const stored = JSON.parse(localStorage.getItem('tasks') ?? '[]')
    expect(Array.isArray(stored)).toBe(true)
    expect(stored).toHaveLength(1)
    expect(stored[0].title).toBe('Persisted task')
  })

  it('overwrites previous localStorage value on re-persist', async () => {
    useTaskStore.getState().addTask('First')
    await useTaskStore.getState().persist()
    useTaskStore.getState().addTask('Second')
    await useTaskStore.getState().persist()
    const stored = JSON.parse(localStorage.getItem('tasks') ?? '[]')
    expect(stored).toHaveLength(2)
  })
})

describe('hydrate', () => {
  beforeEach(() => {
    resetStore()
    localStorage.clear()
  })

  it('populates tasks from localStorage', async () => {
    const savedTasks = [
      { id: 't-111-abc', title: 'Hydrated task', completed: false, dueDate: '2025-01-01', createdAt: 0, completedAt: undefined },
    ]
    localStorage.setItem('tasks', JSON.stringify(savedTasks))
    localStorage.setItem('recurringEvents', JSON.stringify([]))
    await useTaskStore.getState().hydrate()
    expect(useTaskStore.getState().tasks).toHaveLength(1)
    expect(useTaskStore.getState().tasks[0].title).toBe('Hydrated task')
  })

  it('populates recurringEvents from localStorage', async () => {
    const savedEvents: RecurringEvent[] = [
      { id: 'ev-222-xyz', type: 'birthday', name: 'Fred', month: 7, day: 4 },
    ]
    localStorage.setItem('tasks', JSON.stringify([]))
    localStorage.setItem('recurringEvents', JSON.stringify(savedEvents))
    await useTaskStore.getState().hydrate()
    expect(useTaskStore.getState().recurringEvents).toHaveLength(1)
    expect(useTaskStore.getState().recurringEvents[0].name).toBe('Fred')
  })

  it('leaves store empty when localStorage has no data', async () => {
    await useTaskStore.getState().hydrate()
    expect(useTaskStore.getState().tasks).toHaveLength(0)
    expect(useTaskStore.getState().recurringEvents).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// setTasks helper
// ---------------------------------------------------------------------------

describe('setTasks', () => {
  beforeEach(resetStore)

  it('replaces tasks with a plain array', () => {
    useTaskStore.getState().addTask('Old task')
    const replacement = [{ id: 't-new', title: 'Replaced', completed: false }]
    useTaskStore.getState().setTasks(replacement)
    expect(useTaskStore.getState().tasks).toEqual(replacement)
  })

  it('replaces tasks via an updater function', () => {
    useTaskStore.getState().addTask('Original')
    useTaskStore.getState().setTasks(prev => prev.map((t: any) => ({ ...t, title: 'Updated' })))
    expect(useTaskStore.getState().tasks[0].title).toBe('Updated')
  })
})
