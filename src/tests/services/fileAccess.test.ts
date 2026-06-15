import { describe, it, expect } from 'vitest';
import {
  isWorkspacePath,
  effectOf,
  isValidOp,
  classifyOp,
  findGrant,
  makeGrant,
  isPreapproved,
} from '../../services/fileAccess/consent';
import { provenanceComment, parseProvenance, importTargetName, stripProvenance } from '../../services/fileAccess/provenance';
import type { FileOp, FileGrant } from '../../services/fileAccess/types';

const ROOT = '/Users/me/AgentForge/workspace';

describe('fileAccess consent — workspace jail', () => {
  it('treats relative paths as workspace', () => {
    expect(isWorkspacePath('notes/a.md', ROOT)).toBe(true);
    expect(isWorkspacePath('', ROOT)).toBe(true);
    expect(isWorkspacePath(undefined, ROOT)).toBe(true);
  });

  it('treats absolute paths inside the root as workspace', () => {
    expect(isWorkspacePath(`${ROOT}/sub/x.txt`, ROOT)).toBe(true);
    expect(isWorkspacePath(ROOT, ROOT)).toBe(true);
  });

  it('treats absolute paths outside the root as external', () => {
    expect(isWorkspacePath('/Users/me/Desktop/report.md', ROOT)).toBe(false);
    expect(isWorkspacePath('/Users/me/AgentForge/memory/x.md', ROOT)).toBe(false);
    // a sibling that merely shares a prefix string must NOT be considered inside
    expect(isWorkspacePath('/Users/me/AgentForge/workspace-evil/x', ROOT)).toBe(false);
  });
});

describe('fileAccess consent — op validation', () => {
  it('requires the fields an action needs', () => {
    expect(isValidOp({ action: 'write', path: 'a.md', content: 'hi' })).toBe(true);
    expect(isValidOp({ action: 'write', path: 'a.md' } as FileOp)).toBe(false);
    expect(isValidOp({ action: 'move', path: 'a', to: 'b' })).toBe(true);
    expect(isValidOp({ action: 'move', path: 'a' } as FileOp)).toBe(false);
    expect(isValidOp({ action: 'command', command: 'git status' })).toBe(true);
    expect(isValidOp({ action: 'command', command: '   ' })).toBe(false);
    expect(isValidOp({ action: 'list' })).toBe(true);
  });

  it('maps actions to read/write effect', () => {
    expect(effectOf('read')).toBe('read');
    expect(effectOf('list')).toBe('read');
    expect(effectOf('write')).toBe('write');
    expect(effectOf('delete')).toBe('write');
  });
});

describe('fileAccess consent — classification', () => {
  it('classifies workspace vs external', () => {
    expect(classifyOp({ action: 'write', path: 'notes/a.md', content: 'x' }, ROOT)).toBe('workspace');
    expect(classifyOp({ action: 'write', path: '/Users/me/Desktop/a.md', content: 'x' }, ROOT)).toBe('external');
    expect(classifyOp({ action: 'list' }, ROOT)).toBe('workspace');
  });

  it('classifies import as external (it reads an outside source)', () => {
    expect(classifyOp({ action: 'import', source: '/Users/me/Desktop/r.pdf', to: 'r.pdf' }, ROOT)).toBe('external');
  });

  it('classifies a move that touches an outside path as external', () => {
    expect(classifyOp({ action: 'move', path: 'a.md', to: '/Users/me/Desktop/b.md' }, ROOT)).toBe('external');
  });

  it('rejects relative paths that climb out with ".."', () => {
    expect(classifyOp({ action: 'write', path: '../../etc/passwd', content: 'x' }, ROOT)).toBe('invalid');
    expect(classifyOp({ action: 'write', path: 'a/../../b', content: 'x' }, ROOT)).toBe('invalid');
  });

  it('classifies commands as command, and malformed ops as invalid', () => {
    expect(classifyOp({ action: 'command', command: 'ls' }, ROOT)).toBe('command');
    expect(classifyOp({ action: 'write', path: 'a.md' } as FileOp, ROOT)).toBe('invalid');
  });
});

describe('fileAccess consent — grants', () => {
  const fileGrant: FileGrant = makeGrant('/Users/me/Desktop/report.md', 'file', 'write', 1);
  const folderGrant: FileGrant = makeGrant('/Users/me/Projects', 'folder', 'write', 1);
  const grants: Record<string, FileGrant> = {
    a: fileGrant,
    b: folderGrant,
  };

  it('matches an exact file grant', () => {
    expect(findGrant(grants, '/Users/me/Desktop/report.md', 'write')).toBe(fileGrant);
    expect(findGrant(grants, '/Users/me/Desktop/other.md', 'write')).toBeNull();
  });

  it('matches a folder grant for paths underneath it', () => {
    expect(findGrant(grants, '/Users/me/Projects/app/main.ts', 'write')).toBe(folderGrant);
    expect(findGrant(grants, '/Users/me/Projects', 'write')).toBe(folderGrant);
    expect(findGrant(grants, '/Users/me/ProjectsEvil/x', 'write')).toBeNull();
  });

  it('lets a write grant satisfy a read', () => {
    expect(findGrant(grants, '/Users/me/Desktop/report.md', 'read')).toBe(fileGrant);
  });

  it('does NOT let a read grant satisfy a write', () => {
    const readOnly = { r: makeGrant('/Users/me/Docs', 'folder', 'read', 1) };
    expect(findGrant(readOnly, '/Users/me/Docs/a.md', 'write')).toBeNull();
    expect(findGrant(readOnly, '/Users/me/Docs/a.md', 'read')).not.toBeNull();
  });

  it('isPreapproved: workspace always, external only with a covering grant, command never', () => {
    expect(isPreapproved({ action: 'write', path: 'a.md', content: 'x' }, ROOT, {})).toBe(true);
    expect(isPreapproved({ action: 'write', path: '/Users/me/Desktop/report.md', content: 'x' }, ROOT, grants)).toBe(true);
    expect(isPreapproved({ action: 'write', path: '/Users/me/Desktop/nope.md', content: 'x' }, ROOT, grants)).toBe(false);
    expect(isPreapproved({ action: 'command', command: 'ls' }, ROOT, grants)).toBe(false);
  });
});

describe('fileAccess provenance', () => {
  it('round-trips a provenance comment', () => {
    const now = new Date('2026-06-13T12:00:00.000Z');
    const comment = provenanceComment('/Users/me/Desktop/report.md', now);
    const body = `# Report\n\nsome text${comment}`;
    const parsed = parseProvenance(body);
    expect(parsed).toEqual({ source: '/Users/me/Desktop/report.md', imported: '2026-06-13T12:00:00.000Z' });
  });

  it('returns null when there is no provenance', () => {
    expect(parseProvenance('just a normal file')).toBeNull();
  });

  it('builds a safe, unique workspace target name', () => {
    expect(importTargetName('/Users/me/Desktop/My Report (final).pdf', 123)).toBe('imports/My-Report-final-123.pdf');
    expect(importTargetName('/tmp/notes', 7)).toBe('imports/notes-7');
  });

  it('strips the provenance comment back to the original body (Detach / Push back)', () => {
    const now = new Date('2026-06-13T12:00:00.000Z');
    const original = '# Report\n\nsome text';
    const imported = `${original}${provenanceComment('/Users/me/Desktop/report.md', now)}`;
    expect(parseProvenance(imported)).not.toBeNull();
    const stripped = stripProvenance(imported);
    expect(stripped).toBe(original);
    expect(parseProvenance(stripped)).toBeNull();
  });

  it('leaves a file with no provenance untouched', () => {
    expect(stripProvenance('plain content, no fence')).toBe('plain content, no fence');
  });
});
