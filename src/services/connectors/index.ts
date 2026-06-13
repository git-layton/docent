// Connector facade. The UI and agents call getCalendar()/getTasks()/getNotes() and get whichever
// backend the user has selected in settings (defaults to 'local'). Native (eventkit/applescript)
// and cloud (google) backends are registered as their phases land; until then we fall back to local
// so behavior is unchanged.

import { useSettingsStore } from '../../store/useSettingsStore';
import { localCalendar, localTasks, localNotes } from './backends/local';
import { eventkitCalendar, eventkitTasks } from './backends/eventkit';
import { applescriptNotes } from './backends/applescript';
import type { BackendId, CalendarConnector, NotesConnector, TasksConnector } from './types';

export * from './types';

function backendOf(domain: 'calendar' | 'tasks' | 'notes'): BackendId {
  const integrations = useSettingsStore.getState().integrations as any;
  return (integrations?.[domain]?.backend as BackendId) ?? 'local';
}

export function getCalendar(): CalendarConnector {
  switch (backendOf('calendar')) {
    case 'eventkit': return eventkitCalendar;
    // case 'google':   return googleCalendar;     // Phase B (reuse existing gcal code)
    default:
      return localCalendar;
  }
}

export function getTasks(): TasksConnector {
  switch (backendOf('tasks')) {
    case 'eventkit': return eventkitTasks;
    default:
      return localTasks;
  }
}

export function getNotes(): NotesConnector {
  switch (backendOf('notes')) {
    case 'applescript': return applescriptNotes;
    default:
      return localNotes;
  }
}
