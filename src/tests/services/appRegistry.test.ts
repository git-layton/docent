import { describe, it, expect } from 'vitest';
import { APPS, appDocId, appSearchDocs, appCatalogPrompt } from '../../data/appRegistry';

describe('APPS catalog', () => {
  it('has unique, stable ids', () => {
    const ids = APPS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no longer includes the retired agentforge-code app', () => {
    expect(APPS.some((a) => a.id === 'agentforge-code')).toBe(false);
  });

  it('keeps the core surfaces the Start grid and search rely on', () => {
    for (const id of ['chat', 'gallery', 'inbox', 'calendar', 'todo', 'browser', 'settings']) {
      expect(APPS.some((a) => a.id === id)).toBe(true);
    }
  });

  it('every app has an open() handler', () => {
    for (const a of APPS) expect(typeof a.open).toBe('function');
  });
});

describe('appDocId', () => {
  it('namespaces app ids so results trace back to an AppEntry', () => {
    expect(appDocId('inbox')).toBe('app-inbox');
    // Round-trips: a search doc id resolves to exactly one app.
    for (const a of APPS) {
      expect(APPS.filter((x) => appDocId(x.id) === appDocId(a.id))).toHaveLength(1);
    }
  });
});

describe('appSearchDocs', () => {
  const docs = appSearchDocs();

  it('emits one App SearchDoc per app, id via appDocId', () => {
    expect(docs).toHaveLength(APPS.length);
    for (const d of docs) {
      expect(d.kind).toBe('App');
      expect(d.id).toBe(appDocId(d.id.replace(/^app-/, '')));
    }
  });

  it('carries keywords in body (matched) not in the title (displayed)', () => {
    const inbox = docs.find((d) => d.id === 'app-inbox')!;
    expect(inbox.title).toBe('Inbox');
    expect(inbox.body).toContain('email');
  });
});

describe('appCatalogPrompt', () => {
  it('lists apps with a use-when line', () => {
    const prompt = appCatalogPrompt();
    expect(prompt).toContain('Inbox:');
    expect(prompt).toContain('Calendar:');
  });
});
