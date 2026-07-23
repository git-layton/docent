import { useState } from 'react';
import { Search, Globe, X } from 'lucide-react';
import { useBrowserStore } from '../store/useBrowserStore';

/**
 * The browser's own start page — where a new web tab lands instead of duckduckgo.com.
 *
 * Bookmarks belong here, not on Home. They were previously listed on the Start page from a
 * *different* source (web tabs flagged `isFavorite`, which evaporate when the tab closes) while
 * the real, persisted list lived here in `favorites` and was only reachable through the star in
 * the toolbar. This surfaces the durable one in the one place it's ever acted on.
 *
 * No webview exists while this is showing: BrowserTabContent defers creating the native child
 * webview until there's somewhere to go, so the start page is plain React and inherits the app's
 * glass rather than being a foreign HTML document served into a webview.
 */
export function BrowserStartPage({ onNavigate }: { onNavigate: (url: string) => void }) {
  const favorites = useBrowserStore(s => s.favorites);
  const removeFavorite = useBrowserStore(s => s.removeFavorite);
  const [query, setQuery] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    onNavigate(resolveQuery(q));
  };

  return (
    <div className="flex h-full w-full flex-col items-center overflow-y-auto px-8 py-16">
      <div className="w-full max-w-2xl">
        <form onSubmit={submit} className="flex items-center gap-3 rounded-full border border-edge-2 glass-sky backdrop-blur-xl px-5 py-3 shadow-sm transition-colors focus-within:border-accent">
          <Search className="h-4 w-4 shrink-0 text-ink-3" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search the web, or enter an address"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
          />
        </form>

        {favorites.length > 0 ? (
          <div className="mt-10">
            <h2 className="mb-3 px-1 text-[11px] font-bold uppercase tracking-widest text-ink-3">
              Bookmarks
            </h2>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {favorites.map(fav => (
                <div
                  key={fav.id}
                  className="group relative flex items-center gap-3 rounded-2xl border border-edge/50 glass-sky backdrop-blur-xl px-3.5 py-3 transition-all hover:-translate-y-0.5 hover:border-edge-2"
                >
                  <button
                    onClick={() => onNavigate(fav.url)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-sky-600 text-white shadow-sm ring-1 ring-inset ring-white/25">
                      <Globe className="h-[17px] w-[17px]" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-ink">{fav.title}</span>
                      <span className="block truncate text-[11px] text-ink-3">{hostOf(fav.url)}</span>
                    </span>
                  </button>
                  <button
                    onClick={() => removeFavorite(fav.url)}
                    title="Remove bookmark"
                    className="shrink-0 rounded-md p-1 text-ink-3 opacity-0 transition-all hover:bg-wash hover:text-ink group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-10 text-center text-[11px] text-ink-3">
            Star a page to keep it here.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Turn what was typed into somewhere to go.
 *
 * A bare domain is a destination; anything else is a search. The dot alone isn't enough to decide
 * — "what is a .gitignore" and "is 3.5 better" both contain one — so a destination must look like
 * a whole hostname and contain no spaces. Getting this backwards is unpleasant in both directions:
 * a mis-parsed search navigates to a domain that doesn't exist, and a mis-parsed URL silently
 * hands the address you wanted to a search engine.
 */
export function resolveQuery(raw: string): string {
  const q = raw.trim();
  const looksLikeUrl = /^https?:\/\//i.test(q) || (!/\s/.test(q) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q));
  return looksLikeUrl ? q : `https://start.duckduckgo.com/?q=${encodeURIComponent(q)}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
