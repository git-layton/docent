// Registered canvas bindings. Adding an editable source = adding one entry here.
//
// Kept apart from canvasBindings.ts so the resolution rules stay free of connector imports
// and remain testable without Tauri — the same split the capability registry uses.

import { registerCanvasBinding } from './canvasBindings';
import { getNotes } from './connectors';
import { invalidateNotesCache } from '../components/NotesPanel';

// Apple Notes — the first binding, and the one that proved the pattern. Opening a note hands
// it to the canvas; editing it writes straight back to Notes. There is no Docent notes app.
registerCanvasBinding({
  source: 'notes',
  label: 'Saved to Notes',
  idOf: (c) => (typeof c?.sourceNoteId === 'string' ? c.sourceNoteId : null),
  save: (id, content) => getNotes().updateNote(id, content),
  // The panel serves note bodies from a cache; without this it hands back the pre-edit body
  // on the next open and the edit appears to have been lost.
  afterSave: (id, content) => invalidateNotesCache(id, content),
});

export {};
