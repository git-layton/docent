import { Globe, FileText, Save, Download } from 'lucide-react';

// Detects: 1. Bold, 2. [Source: Name](url), 3. Markdown links, 4. Raw URLs, 5. [[LocalFile]]
export const INLINE_FORMAT_REGEX = /(\*\*.*?\*\*)|(\[Source:\s*.*?\]\(.*?\))|(\[.*?\]\(.*?\))|(https?:\/\/[a-zA-Z0-9-._~:/?#[\]@!$&'()*+,;=%]+)|(\[\[.*?\]\])/g;

export const FormattedText = ({ text, sources, onSaveImage, onViewImage, onOpenFile }: any) => {
  if (!text || typeof text !== 'string') return null;
  try {
    const renderInlines = (textStr: string) => {
      const tokens = [];
      let lastIdx = 0;
      const regex = new RegExp(INLINE_FORMAT_REGEX.source, 'g');

      let match;
      while ((match = regex.exec(textStr)) !== null) {
        if (match.index > lastIdx) tokens.push(textStr.slice(lastIdx, match.index));

        if (match[1]) {
          // Bold
          tokens.push(<strong key={match.index} className="font-black text-current">{match[1].slice(2, -2)}</strong>);
        } else if (match[2]) {
          // Web Source Citation [Source: Title](URL) — with hover snippet card
          const sub = match[2].match(/\[Source:\s*(.+?)\]\((.+?)\)/);
          if (sub) {
            const [, title, url] = sub;
            const matched = sources?.find((s: any) => s.url === url || s.title === title);
            tokens.push(
              <span key={match.index} className="relative inline-flex group/cite">
                <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent-soft text-accent-soft-ink rounded-md text-[10px] font-bold mx-1 hover:bg-accent/20 transition-colors"><Globe className="w-3 h-3" /> {title}</a>
                {matched?.snippet && (
                  <div className="absolute bottom-full left-0 mb-2 w-64 hidden group-hover/cite:flex flex-col z-50 pointer-events-none">
                    <div className="bg-panel-2 border border-edge rounded-xl shadow-xl p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 bg-accent-soft text-accent-soft-ink rounded-md">Web</span>
                        <span className="text-[10px] font-bold text-ink-2 truncate">{title}</span>
                      </div>
                      <p className="text-[11px] text-ink-3 leading-relaxed italic line-clamp-4">"{matched.snippet}"</p>
                    </div>
                  </div>
                )}
              </span>
            );
          }
        } else if (match[3]) {
          // Standard Markdown Link
          const sub = match[3].match(/\[(.*?)\]\((.*?)\)/);
          if (sub) tokens.push(<a key={match.index} href={sub[2]} target="_blank" rel="noreferrer" className="text-accent hover:underline font-bold transition-colors">{sub[1]}</a>);
        } else if (match[4]) {
          // Raw URL
          tokens.push(<a key={match.index} href={match[4]} target="_blank" rel="noreferrer" className="text-accent hover:underline font-bold break-all transition-colors">{match[4]}</a>);
        } else if (match[5]) {
          // Local Knowledge Core citation [[Title]] — amber pill with hover snippet card
          const fileName = match[5].slice(2, -2);
          const matchedLocal = sources?.find((s: any) =>
            s.title === fileName ||
            s.path?.split('/').pop()?.replace(/\.md$/i, '') === fileName
          );
          tokens.push(
            <span key={match.index} className="relative inline-flex group/cite">
              <span onClick={() => { if (matchedLocal?.path) onOpenFile?.(matchedLocal.path); }} className="inline-flex items-center gap-1 px-2 py-0.5 bg-warning-soft text-warning rounded-md text-[10px] font-bold mx-1 cursor-pointer hover:bg-warning/20 transition-colors"><FileText className="w-3 h-3" /> {fileName}</span>
              {matchedLocal?.snippet && (
                <div className="absolute bottom-full left-0 mb-2 w-64 hidden group-hover/cite:flex flex-col z-50 pointer-events-none">
                  <div className="bg-panel-2 border border-edge rounded-xl shadow-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 bg-warning-soft text-warning rounded-md">Local</span>
                      <span className="text-[10px] font-bold text-ink-2 truncate">{fileName}</span>
                    </div>
                    <p className="text-[11px] text-ink-3 leading-relaxed italic line-clamp-4">"{matchedLocal.snippet}"</p>
                  </div>
                </div>
              )}
            </span>
          );
        }
        lastIdx = regex.lastIndex;
      }
      if (lastIdx < textStr.length) tokens.push(textStr.slice(lastIdx));
      return tokens;
    };

    return (
      <div className="space-y-1.5 break-words text-sm">
        {text.split('\n').map((line: string, idx: number) => {
          if (line.startsWith('### ')) return <h3 key={idx} className="text-base font-black mt-4 mb-2 text-current uppercase tracking-tight">{line.slice(4)}</h3>;
          if (line.startsWith('## ')) return <h2 key={idx} className="text-lg font-black mt-5 mb-2 text-current border-b border-edge pb-1">{line.slice(3)}</h2>;
          if (line.startsWith('# ')) return <h1 key={idx} className="text-xl font-black mt-6 mb-3 text-current">{line.slice(2)}</h1>;
          if (/^\s*[-*] /.test(line)) return <div key={idx} className="flex gap-2 ml-2"><span className="text-accent font-bold">•</span><span>{renderInlines(line.replace(/^\s*[-*] /, ''))}</span></div>;

          if (line.match(/!\[.*?\]\((.*?)\)/)) {
             const matchResult = line.match(/!\[.*?\]\((.*?)\)/);
             if (matchResult) {
               const src = matchResult[1];
               return (
                 <div key={idx} className="relative group/img flex flex-col gap-2 mt-3 mb-4 max-w-md w-full">
                   <div className="overflow-hidden rounded-2xl shadow-lg border border-edge bg-inset">
                      <img
                        src={src}
                        alt="Generated Artwork"
                        className="w-full h-auto object-cover cursor-pointer hover:scale-[1.02] transition-transform duration-300"
                        onClick={() => onViewImage && onViewImage(src)}
                        title="Click to view full size"
                      />
                   </div>
                   <div className="flex items-center gap-1 opacity-0 group-hover/img:opacity-100 transition-opacity bg-panel/70 p-1.5 rounded-xl w-fit backdrop-blur-sm border border-edge">
                      {onSaveImage && (
                        <button onClick={() => onSaveImage(src)} className="p-1.5 px-2.5 text-ink-2 hover:text-accent hover:bg-wash rounded-lg transition-all flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest" title="Save to Archives">
                          <Save className="w-3.5 h-3.5" /> Save
                        </button>
                      )}
                      <button onClick={() => {
                          const a = document.createElement('a');
                          a.href = src;
                          a.download = `generated_image_${Date.now()}.png`;
                          a.click();
                      }} className="p-1.5 px-2.5 text-ink-2 hover:text-accent hover:bg-wash rounded-lg transition-all flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest" title="Download Image">
                          <Download className="w-3.5 h-3.5" /> Download
                      </button>
                   </div>
                 </div>
               );
             }
          }

          if (!line.trim()) return <div key={idx} className="h-2" /> ;
          return <div key={idx}>{renderInlines(line)}</div>;
        })}
      </div>
    );
  } catch {
    return <div className="whitespace-pre-wrap text-sm">{text}</div>;
  }
};
