import { Moon, X, Cpu, Coins, Download, Sparkles } from 'lucide-react';
import { useSettingsStore, isLocalProvider, type Model } from '../store/useSettingsStore';

interface Props {
  /** The model the first Dream Cycle will actually run on — decides whether we show the
   *  "free, on-device" or the "hosted, bills per run" cost story. */
  model: Model | null | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * First-run consent gate for the Dream Cycle. The Dreamer is opt-in and never runs silently
 * ([[dream-cycle-discoverability]]); this is the one-time "here's what it does and what it costs"
 * conversation the user asked to have before any tokens are spent. Shown in front of the *first*
 * run from any entry point (invite banner, settings, the daily scheduler), then never again.
 */
export function DreamConsentModal({ model, onConfirm, onCancel }: Props) {
  const isLocal = model?.isLocal ?? isLocalProvider(model?.provider ?? '', model?.endpoint ?? '');
  const modelName = model?.name || model?.modelId || 'your model';
  const provider = (model?.provider || '').trim();

  function setUpLocalModel() {
    // Send them to where local models are added, and step out of the way — dreaming stays un-run
    // (no consent given) until they come back and start it themselves.
    useSettingsStore.getState().setProfileSettingsTab('models');
    useSettingsStore.getState().setShowProfileSettings(true);
    onCancel();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md"
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="relative w-full max-w-lg mx-4 bg-panel-2 rounded-2xl shadow-2xl border border-edge flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-edge shrink-0">
          <span className="text-2xl mt-0.5">🌙</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-ink">Let your assistant dream?</h2>
            <p className="text-xs text-ink-3 mt-0.5">We'll only ask this once.</p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-wash transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <p className="text-sm text-ink-2 leading-relaxed">
            While Docent is open and you're away, a <span className="font-semibold text-ink">Dream Cycle</span> reviews
            your assistant's memory — merging duplicates, pruning stale notes, and surfacing insights or reminders
            you'd otherwise lose.
          </p>
          <p className="text-sm text-ink-2 leading-relaxed">
            It's how your assistant's memory stays tidy and gets sharper over time instead of just piling up. Every
            change is logged in a digest and stays undoable.
          </p>

          {/* Cost story — the whole reason we ask. */}
          {isLocal ? (
            <div className="flex items-start gap-3 p-4 rounded-xl border border-success/30 bg-success-soft">
              <Cpu className="w-4 h-4 text-success shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  Runs on {modelName} — locally, on your Mac.
                </p>
                <p className="text-xs text-ink-2 mt-1 leading-relaxed">
                  No network calls and no per-run cost. Dream as often as you like.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-4 rounded-xl border border-warning/30 bg-warning-soft">
                <Coins className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    This will run on {modelName}{provider ? <> via {provider}</> : null} — a hosted model that charges
                    per run.
                  </p>
                  <p className="text-xs text-ink-2 mt-1 leading-relaxed">
                    Left on the daily schedule it runs on its own, so those costs can add up. Set a spending limit
                    with your provider and keep an eye on usage.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/30">
                <Download className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
                    Want it to cost nothing?
                  </p>
                  <p className="text-xs text-indigo-800 dark:text-indigo-300 mt-1 leading-relaxed">
                    Download a small local model (via Ollama or LM Studio) and point your assistant at it — dreaming
                    then runs on-device, for free.
                  </p>
                  <button
                    onClick={setUpLocalModel}
                    className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-700 dark:text-indigo-300 hover:text-indigo-900 dark:hover:text-white transition-colors"
                  >
                    <Sparkles className="w-3 h-3" /> Set up a local model →
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-edge shrink-0 space-y-3">
          <p className="text-[10px] text-ink-3 leading-relaxed">
            You're responsible for any model usage costs. You can turn dreaming off anytime in Settings.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-ink-2 hover:text-ink hover:bg-wash transition-colors"
            >
              Not now
            </button>
            <button
              onClick={onConfirm}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-on-accent bg-accent hover:opacity-90 transition-all"
            >
              <Moon className="w-3.5 h-3.5" /> Run Dream Cycle
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
