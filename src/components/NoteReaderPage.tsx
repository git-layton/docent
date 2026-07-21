import { useMemo } from 'react';
import { ArrowLeft, MessageSquarePlus, FileText, RotateCw, Pencil } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { usePanelResource } from '../lib/panelCache';
import { FormattedText } from './ui/FormattedText';
import { frontmatterValue, noteBody, noteTitle, buildTopicChatPrompt } from '../services/knowledgeLibrary';

interface NoteReaderPageProps {
  path: string;
  /** Title already computed by the library card, so the header doesn't flash while loading. */
  fallbackTitle?: string;
  onBack: () => void;
  onSendPrompt?: (text: string) => void;
}

/** Frontmatter fields worth showing — the gatekeeper records these on every save, and they are
 * what makes a note understandable at a glance (what kind of thing it is, how sure we are). */
const META_CHIPS: { key: string; label: string }[] = [
  { key: 'memory_type', label: 'type' },
  { key: 'evidence_state', label: 'evidence' },
  { key: 'confidence', label: 'confidence' },
];

function formatWhen(iso: string | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Read a saved note in place. Before this, a note was a filename in a list — you could not see
 * what it said without leaving the Knowledge panel, and there was no way to start a conversation
 * about it.
 */
export function NoteReaderPage({ path, fallbackTitle, onBack, onSendPrompt }: NoteReaderPageProps) {
  const { data: content, loading } = usePanelResource<string>({
    key: `note:${path}`,
    fetch: async () => {
      try {
        const res = await invoke<{ ok: boolean; content: string }>('read_knowledge_file', { path });
        return res?.ok ? res.content : '';
      } catch {
        return '';
      }
    },
  });

  const raw = content ?? '';
  const title = useMemo(() => (raw ? noteTitle(raw, fallbackTitle ?? '') : (fallbackTitle ?? '')), [raw, fallbackTitle]);
  const body = useMemo(() => noteBody(raw), [raw]);
  const created = formatWhen(frontmatterValue(raw, 'created_at'));
  const chips = META_CHIPS
    .map(c => ({ ...c, value: frontmatterValue(raw, c.key) }))
    .filter(c => !!c.value);

  const handleChat = () => {
    if (!onSendPrompt) return;
    const prompt = buildTopicChatPrompt({ kind: 'note', label: title || (fallbackTitle ?? 'this note'), path });
    if (prompt) onSendPrompt(prompt);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-panel">
      <div className="h-12 flex items-center gap-3 px-4 border-b border-edge shrink-0">
        <button
          onClick={onBack}
          title="Back to Library"
          className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <FileText className="w-4 h-4 text-ink-3 shrink-0" />
        <span className="text-sm font-bold text-ink truncate">{title || 'Note'}</span>
        <div className="flex-1" />
        {onSendPrompt && (
          <button
            onClick={handleChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-on-accent hover:opacity-90 transition-opacity shrink-0"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" /> Chat about this
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-5">
          {(chips.length > 0 || created) && (
            <div className="flex items-center gap-2 flex-wrap mb-4">
              {chips.map(c => (
                <span key={c.key} className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-inset text-ink-3">
                  {c.label}: {c.value}
                </span>
              ))}
              {created && <span className="text-[10px] text-ink-3">Saved {created}</span>}
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-ink-3 text-xs">
              <RotateCw className="w-3.5 h-3.5 animate-spin" /> Loading note…
            </div>
          ) : body ? (
            <div className="text-sm leading-relaxed text-ink-2">
              <FormattedText text={body} />
            </div>
          ) : (
            <p className="text-xs text-ink-3 italic">This note is empty.</p>
          )}

          <div className="mt-6 pt-4 border-t border-edge flex items-center gap-2">
            <span className="text-[10px] text-ink-3 font-mono truncate flex-1">{path}</span>
            <button
              onClick={() => invoke('open_in_canvas', { path }).catch(() => {})}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold text-ink-3 hover:bg-wash hover:text-ink transition-colors shrink-0"
              title="Open in Canvas to edit"
            >
              <Pencil className="w-3 h-3" /> Edit in Canvas
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
