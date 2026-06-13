import { useState } from 'react';
import { X, Save, CheckSquare } from 'lucide-react';

type Category = 'goals' | 'decisions' | 'research' | 'memos' | 'todo';

interface MemoSaveResult {
  commitHash: string | null;
  category: string;
}

interface Props {
  onSave: (result: MemoSaveResult) => void;
  onClose: () => void;
  agentForgePath: string;
  agentId: string;
}

const CATEGORIES: { value: Category; label: string; dir: string; hint: string }[] = [
  { value: 'goals',     label: 'Goal',        dir: 'goals',     hint: 'Long-term objectives & milestones'   },
  { value: 'decisions', label: 'Decision',    dir: 'decisions', hint: 'Key choices & their rationale'       },
  { value: 'research',  label: 'Research',    dir: 'research',  hint: 'Notes, references & findings'        },
  { value: 'memos',     label: 'General',     dir: 'memos',     hint: 'Freeform notes & ideas'              },
  { value: 'todo',      label: 'Action Item', dir: 'tasks',     hint: 'Appended as a task to tasks.md'      },
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50);
}

function buildFrontmatter(title: string, category: Category): string {
  return [
    '---',
    'type: memmo',
    `created: ${new Date().toISOString()}`,
    `tags: [memmo, ${category}]`,
    'entities: []',
    'pinned: false',
    'processed_by: scribe-v1',
    `title: "${title.replace(/"/g, '\\"')}"`,
    '---',
    '',
    `# ${title}`,
    '',
  ].join('\n');
}

export function MemoComposeModal({ onSave, onClose, agentForgePath, agentId }: Props) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<Category>('memos');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const isTodo = category === 'todo';
  const categoryLabel = CATEGORIES.find(c => c.value === category)?.label ?? 'Memo';

  async function handleSave() {
    if (!title.trim()) { setError('Title is required.'); return; }
    setError('');
    setIsSaving(true);

    try {
      const { invoke } = await import('@tauri-apps/api/core');

      if (isTodo) {
        const taskText = title.trim() + (body.trim() ? ` — ${body.trim()}` : '');
        const result = await invoke<{ commit: string | null }>('append_task', { text: taskText, agentId });
        onSave({ commitHash: result.commit, category: 'Action Item' });
      } else {
        const catMeta = CATEGORIES.find(c => c.value === category)!;
        const slug = slugify(title) || 'memo';
        const ts = Date.now();
        const path = `${agentForgePath}/memory/${agentId}/${catMeta.dir}/${slug}-${ts}.md`;
        const content = buildFrontmatter(title, category) + body;

        const result = await invoke<{ blocked: boolean; commit: string | null }>('write_memory', {
          path,
          content,
          commitMessage: `memo: ${title}`,
          agentId: null,
          contextTokens: null,
          ramState: null,
        });

        if (result.blocked) {
          setError('Nuke Shield blocked this write. The file change was too large.');
          setIsSaving(false);
          return;
        }

        // Extract hash from git output like "[main abc1234] memo: title"
        const hashMatch = result.commit?.match(/\[.*?\s([a-f0-9]+)\]/);
        onSave({ commitHash: hashMatch?.[1] ?? result.commit, category: categoryLabel });
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className="bg-panel-2 border border-edge rounded-[2rem] shadow-2xl w-full max-w-lg">
        <div className="p-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-black uppercase tracking-widest text-accent">
              New Note
            </h2>
            <button onClick={onClose} className="text-ink-3 hover:text-ink-2">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Category */}
          <div className="mb-4">
            <label className="block text-xs font-bold uppercase tracking-widest text-ink-3 mb-2">
              Category
            </label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(c => (
                <button
                  key={c.value}
                  onClick={() => setCategory(c.value)}
                  className={`flex flex-col items-start px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                    category === c.value
                      ? 'bg-accent text-on-accent'
                      : 'bg-inset text-ink-2 hover:bg-wash'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {c.value === 'todo' && <CheckSquare className="w-3 h-3" />}
                    {c.label}
                  </span>
                  <span className={`text-[9px] font-normal mt-0.5 ${category === c.value ? 'text-on-accent/70' : 'text-ink-3'}`}>
                    {c.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div className="mb-4">
            <label className="block text-xs font-bold uppercase tracking-widest text-ink-3 mb-2">
              {isTodo ? 'Task' : 'Title'}
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={isTodo ? 'What needs to be done?' : 'Memo title...'}
              className="w-full px-4 py-2.5 rounded-xl border border-edge-2 bg-transparent text-sm font-medium focus:outline-none focus:ring-2 focus:ring-accent/30"
              onKeyDown={e => { if (e.key === 'Enter' && isTodo) handleSave(); }}
              autoFocus
            />
          </div>

          {/* Body — hidden for todo when title is filled, but shown */}
          <div className="mb-5">
            <label className="block text-xs font-bold uppercase tracking-widest text-ink-3 mb-2">
              {isTodo ? 'Details (optional)' : 'Content'}
            </label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder={isTodo ? 'Add details...' : 'Write your memo in markdown...'}
              rows={isTodo ? 2 : 6}
              className="w-full px-4 py-2.5 rounded-xl border border-edge-2 bg-transparent text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
            {isTodo && (
              <p className="text-xs text-ink-3 mt-1.5">
                Will append <code className="bg-inset px-1 rounded">- [ ]</code> to <code className="bg-inset px-1 rounded">tasks.md</code>
              </p>
            )}
          </div>

          {error && (
            <p className="text-xs text-danger mb-4 font-medium">{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-edge-2 text-sm font-bold text-ink-2 hover:bg-wash transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !title.trim()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-on-accent text-sm font-bold hover:bg-accent-strong transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : isTodo ? 'Add Task' : 'Save Note'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
