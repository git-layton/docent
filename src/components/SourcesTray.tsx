import { useState } from 'react';
import { Globe, FileText, ChevronDown, ChevronUp } from 'lucide-react';

interface Source {
  title: string;
  url?: string;
  path?: string;
  snippet?: string;
}

interface Props {
  sources: Source[];
  onOpenFile?: (path: string) => void;
}

export function SourcesTray({ sources, onOpenFile }: Props) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const webSources = sources.filter(s => s.url);
  const fileSources = sources.filter(s => s.path && !s.url);

  if (sources.length === 0) return null;

  return (
    <div className="mt-5 pt-4 border-t border-neutral-200 dark:border-neutral-700/50 flex flex-col gap-3">
      {/* Web sources */}
      {webSources.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[9px] font-black uppercase tracking-widest text-neutral-400 flex items-center gap-1.5">
            <Globe className="w-3 h-3" /> Sources Referenced
          </span>
          <div className="flex flex-wrap gap-2">
            {webSources.map((src, idx) => (
              <a
                key={src.url || idx}
                href={src.url}
                target="_blank"
                rel="noreferrer"
                className="group/src flex items-center gap-2 p-1.5 px-2.5 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl hover:border-[#6A829E] hover:bg-white dark:hover:bg-neutral-800 transition-all max-w-[200px] shadow-sm hover:shadow-md"
              >
                <img
                  src={`https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(src.url!)}`}
                  className="w-4 h-4 rounded-sm object-cover bg-white"
                  alt=""
                />
                <span className="text-[10px] font-bold text-neutral-600 dark:text-neutral-300 truncate group-hover/src:text-[#4A5D75] dark:group-hover/src:text-[#9EADC8]">
                  {src.title.replace('Wiki: ', '')}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Local file sources */}
      {fileSources.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[9px] font-black uppercase tracking-widest text-neutral-400 flex items-center gap-1.5">
            <FileText className="w-3 h-3" /> From Your Knowledge Core
          </span>
          <div className="flex flex-col gap-1.5">
            {fileSources.map((src, idx) => {
              const isExpanded = expandedIdx === idx;
              const stem = src.path?.split('/').pop()?.replace('.md', '') ?? src.title;
              return (
                <div key={src.path || idx}>
                  <button
                    onClick={() => { setExpandedIdx(isExpanded ? null : idx); if (!isExpanded && onOpenFile && src.path) onOpenFile(src.path); }}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:border-[#D4AA7D] hover:bg-white dark:hover:bg-neutral-800 transition-all text-left max-w-xs cursor-pointer"
                  >
                    <FileText className="w-3 h-3 text-[#6A829E] shrink-0" />
                    <span className="text-[10px] font-bold text-neutral-600 dark:text-neutral-300 truncate flex-1">
                      {src.title || stem}
                    </span>
                    {isExpanded
                      ? <ChevronUp className="w-3 h-3 text-neutral-400 shrink-0" />
                      : <ChevronDown className="w-3 h-3 text-neutral-400 shrink-0" />
                    }
                  </button>
                  {isExpanded && src.snippet && (
                    <div className="mt-1 ml-2 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-[11px] text-neutral-600 dark:text-neutral-400 font-mono whitespace-pre-wrap leading-relaxed max-w-sm">
                      {src.snippet}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
