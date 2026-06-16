import { useMemo, useState } from 'react';
import { Images, X } from 'lucide-react';
import { useUIStore } from '../store/useUIStore';

interface GalleryPanelProps {
  /** Which Space's images to show. The global Home ('space-home') or no space ⇒ show everything. */
  spaceId?: string | null;
}

/**
 * The Image Library as a surface. Same component everywhere; the scope it's opened in decides what
 * it shows: inside a Space → that Space's images; on global Home → every image. Images are
 * auto-saved (generated + attached) with a vision description, so this is also searchable via the
 * omni-bar; this view is the browse-by-time companion to that search.
 */
export function GalleryPanel({ spaceId }: GalleryPanelProps) {
  const savedApps = useUIStore((s) => s.savedApps);
  const isGlobal = !spaceId || spaceId === 'space-home';

  const images = useMemo(
    () =>
      (savedApps ?? [])
        .filter((a: any) => a.type === 'image' && (isGlobal || a.spaceId === spaceId))
        .sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [savedApps, isGlobal, spaceId],
  );

  const [active, setActive] = useState<any | null>(null);

  return (
    <div className="flex-1 h-full overflow-y-auto bg-panel custom-scrollbar">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="flex items-center gap-2 mb-5">
          <Images className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-black tracking-tight text-ink">Gallery</h2>
          <span className="text-xs font-medium text-ink-3">{isGlobal ? 'All images' : 'This space'} · {images.length}</span>
        </div>

        {images.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-24 text-ink-3">
            <Images className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm font-medium text-ink-2">No images yet</p>
            <p className="text-xs mt-1 max-w-xs">Images you generate or attach to a chat are saved here automatically — and become searchable by what's in them.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {images.map((img: any) => (
              <button
                key={img.id}
                onClick={() => setActive(img)}
                title={img.title || 'Image'}
                className="group relative aspect-square overflow-hidden rounded-xl border border-edge bg-inset shadow-sm transition-all hover:ring-2 hover:ring-accent"
              >
                <img src={img.content} alt={img.title || 'Image'} loading="lazy" className="h-full w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-left text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100">
                  {img.title || 'Image'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {active && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm animate-in fade-in"
          onClick={() => setActive(null)}
        >
          <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-edge bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setActive(null)} className="absolute right-3 top-3 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/60" title="Close">
              <X className="h-4 w-4" />
            </button>
            <img src={active.content} alt={active.title || 'Image'} className="max-h-[60vh] w-full bg-black/5 object-contain" />
            <div className="p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="truncate text-sm font-bold text-ink">{active.title || 'Image'}</h3>
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-widest text-ink-3">{active.source === 'attached' ? 'Attached' : 'Generated'}</span>
              </div>
              {active.description ? (
                <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-ink-2 custom-scrollbar">{active.description}</p>
              ) : (
                <p className="mt-2 text-xs italic text-ink-3">No description yet — turn on Image Understanding in Settings to make images searchable by content.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GalleryPanel;
