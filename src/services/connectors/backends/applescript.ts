// Apple Notes backend — talks to the Rust `notes_*` commands (AppleScript under the hood).
// Bodies are HTML and fetched lazily per note (listing stays cheap), so listNotes returns empty
// bodies and the panel calls readNote when a note is opened.

import { invoke } from '@tauri-apps/api/core';
import type { NoteItem, NotesConnector } from '../types';

const DEFAULT_FOLDER = 'Notes';

interface RustNoteMeta { id: string; name: string; modified: string }

/** AppleScript hands back a locale date string; best-effort parse, else "now". */
function parseModified(s: string): number {
  const t = Date.parse(s);
  return Number.isNaN(t) ? Date.now() : t;
}

export const applescriptNotes: NotesConnector = {
  backend: 'applescript',

  async listFolders() {
    const folders = await invoke<string[]>('notes_list_folders');
    return folders.length ? folders : [DEFAULT_FOLDER];
  },

  async listNotes(folder) {
    const metas = await invoke<RustNoteMeta[]>('notes_list', { folder: folder ?? DEFAULT_FOLDER });
    return metas.map(m => ({
      id: m.id,
      folder: folder ?? DEFAULT_FOLDER,
      title: m.name,
      body: '',
      updatedAt: parseModified(m.modified),
      source: 'applescript' as const,
    }));
  },

  async readNote(id): Promise<NoteItem> {
    const body = await invoke<string>('notes_read', { id });
    return { id, title: '', body, updatedAt: Date.now(), source: 'applescript' };
  },

  async createNote(folder, title, body) {
    return invoke<string>('notes_create', { folder: folder ?? DEFAULT_FOLDER, title, body });
  },

  async updateNote(id, body) {
    await invoke('notes_update', { id, body });
  },

  async deleteNote(id) {
    await invoke('notes_delete', { id });
  },
};
