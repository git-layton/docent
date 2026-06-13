// Local → native migration. Copies the local recurring events (birthdays/anniversaries/custom) into
// the user's real macOS calendar as yearly all-day events. Non-destructive: the local store is left
// intact (it remains the 'local' backend). Guarded/one-time at the call site via the migrated flag.

import { useTaskStore } from '../../store/useTaskStore';
import { eventkitCalendar, eventkitTasks } from './backends/eventkit';
import { recurringEventToNativeEvent, taskToNativeReminder } from './mappers';

/** Copy local recurring events into the native macOS calendar. Returns how many were created. */
export async function migrateLocalCalendarToEventkit(): Promise<number> {
  const events = useTaskStore.getState().recurringEvents;
  const year = new Date().getFullYear();
  let created = 0;
  for (const ev of events) {
    await eventkitCalendar.createEvent(recurringEventToNativeEvent(ev, year));
    created++;
  }
  return created;
}

/** How many local recurring events are available to migrate (for the confirm/preview). */
export function localCalendarMigrationCount(): number {
  return useTaskStore.getState().recurringEvents.length;
}

/** Copy open local tasks into the native Reminders app. Returns how many were created. */
export async function migrateLocalTasksToEventkit(): Promise<number> {
  const tasks = useTaskStore.getState().tasks.filter((t: any) => !t.completed);
  let created = 0;
  for (const t of tasks) {
    await eventkitTasks.createTask(taskToNativeReminder(t));
    created++;
  }
  return created;
}

/** How many open local tasks are available to migrate (for the confirm/preview). */
export function localTasksMigrationCount(): number {
  return useTaskStore.getState().tasks.filter((t: any) => !t.completed).length;
}
