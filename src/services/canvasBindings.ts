// ─── Canvas Bindings ──────────────────────────────────────────────────────────
// One editing surface, many bridges.
//
// The product line this encodes: Docent should not RECREATE a notes app, a mail app, a
// calendar app. It should let you pull the real thing up, edit it inline, and have it save
// back where it lives. The canvas already did that for Apple Notes — but the writeback was
// hardcoded (`source === 'notes'` → `getNotes().updateNote`), so every additional editable
// thing meant another branch inside CanvasPanel, which is how you end up with an app per
// source after all.
//
// A binding is that branch, externalised: what kind of thing it is, how to find its durable
// id, and how to save it. Adding "edit a calendar event in the canvas" becomes registering a
// binding — CanvasPanel never learns what a calendar is.
//
// Everything here is pure except the registered `save` implementations, so the resolution
// rules are testable without a canvas or a connector.

export interface CanvasBinding {
  /** Matches `canvasContent.source`. */
  source: string;
  /** Shown on the save chip: "Saved to Notes". */
  label: string;
  /**
   * Semantic icon name for the save chip — 'note' | 'calendar' | 'file' | 'mail'.
   *
   * A NAME rather than a component: this module must stay free of React so the resolution
   * rules remain testable without a renderer, and so a binding can be registered from
   * anywhere. CanvasPanel owns the mapping and falls back to a neutral glyph for anything
   * it doesn't recognise — an unknown binding shows something sensible rather than nothing.
   */
  icon?: 'note' | 'calendar' | 'file' | 'mail';
  /**
   * The durable id of the underlying item, or null when this content isn't bound to one.
   * Generated content (a draft app, an unsaved doc) legitimately has no id and must not be
   * written anywhere — returning null is how a binding declines.
   */
  idOf: (canvasContent: any) => string | null;
  /** Persist the edited content back to where it came from. */
  save: (id: string, content: string) => Promise<void>;
  /** Run after a successful save — cache invalidation, mostly. Never throws the save. */
  afterSave?: (id: string, content: string) => void;
}

const REGISTRY = new Map<string, CanvasBinding>();

/** The single extension point. Register once at module load, like the capability registry. */
export function registerCanvasBinding(binding: CanvasBinding): void {
  REGISTRY.set(binding.source, binding);
}

export function allCanvasBindings(): CanvasBinding[] {
  return [...REGISTRY.values()];
}

/** The binding for this canvas content, or null when nothing owns it. */
export function bindingFor(canvasContent: any): CanvasBinding | null {
  const source = canvasContent?.source;
  if (!source || typeof source !== 'string') return null;
  return REGISTRY.get(source) ?? null;
}

/**
 * The id this content should save to, or null.
 *
 * Null is the common and correct case: a generated app, an unsaved draft, an image. The canvas
 * must write NOTHING for those — an autosave loop that fires on unbound content would create
 * or overwrite items the user never opened.
 */
export function boundIdFor(canvasContent: any): string | null {
  const binding = bindingFor(canvasContent);
  if (!binding) return null;
  const id = binding.idOf(canvasContent);
  return typeof id === 'string' && id.trim() ? id : null;
}

/**
 * Save, if this content is bound. Returns what happened rather than throwing, because the
 * caller is a debounced effect in a render tree — an unhandled rejection there is invisible.
 */
export async function saveBound(
  canvasContent: any,
  content: string,
): Promise<{ saved: boolean; label?: string; error?: string }> {
  const binding = bindingFor(canvasContent);
  const id = boundIdFor(canvasContent);
  if (!binding || !id) return { saved: false };
  if (typeof content !== 'string') return { saved: false };

  try {
    await binding.save(id, content);
    // A failing cache invalidation must not report the save as failed — the write landed.
    try { binding.afterSave?.(id, content); } catch { /* non-fatal */ }
    return { saved: true, label: binding.label };
  } catch (e: any) {
    return { saved: false, error: e?.message ?? String(e) };
  }
}
