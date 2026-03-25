import React from 'react';
import {
  Menu, X, FileEdit, ImageIcon, Code, ChevronLeft, ChevronRight, RefreshCw, List
} from 'lucide-react';
import { WysiwygEditor } from './ui/WysiwygEditor';
import { useUIStore } from '../store/useUIStore';

interface CanvasPanelProps {
  isGenerating: boolean;
  onHistoryNavigate: (direction: number) => void;
  onSaveToLibrary: (asNew?: boolean) => void;
  codeRef: React.RefObject<HTMLTextAreaElement | null>;
  lineNumbersRef: React.RefObject<HTMLDivElement | null>;
  onCodeScroll: (e: React.UIEvent<HTMLTextAreaElement>) => void;
  onSendMessage: () => void;
}

export function CanvasPanel({
  isGenerating,
  onHistoryNavigate,
  onSaveToLibrary,
  codeRef,
  lineNumbersRef,
  onCodeScroll,
}: CanvasPanelProps) {
  const canvasContent = useUIStore(s => s.canvasContent);
  const canvasTab = useUIStore(s => s.canvasTab);
  const savedApps = useUIStore(s => s.savedApps);
  const { setCanvasContent, setCanvasTab, setIsSidebarOpen, setSaveAppData, setShowSaveModal } = useUIStore.getState();
  return (
    <div className={`${canvasContent.isStandalone ? 'w-full' : 'w-1/2'} h-full flex flex-col bg-white dark:bg-neutral-950 z-50 min-w-0 transition-all duration-300 relative overflow-hidden shadow-2xl border-l border-neutral-200 dark:border-neutral-800`}>
      <div className="h-16 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between px-4 bg-neutral-50 dark:bg-neutral-900/50 shrink-0">
        <div className="flex items-center gap-3 w-2/3">
          <button onClick={() => setIsSidebarOpen(v => !v)} className="p-2 -ml-2 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500 hidden lg:block"><Menu className="w-5 h-5" /></button>
          <div className={`p-2 ${canvasContent.type === 'doc' ? 'bg-[#7A9E8D]' : canvasContent.type === 'image' ? 'bg-[#D4AA7D]' : 'bg-[#4A5D75]'} rounded-lg shadow-md shrink-0 ${isGenerating ? 'animate-pulse' : ''}`}>{canvasContent.type === 'doc' ? <FileEdit className="w-4 h-4 text-white" /> : canvasContent.type === 'image' ? <ImageIcon className="w-4 h-4 text-white" /> : <Code className="w-4 h-4 text-white" />}</div>

          <div className="flex flex-col w-full min-w-0 max-w-[200px]">
             <input value={canvasContent.title} onChange={e => setCanvasContent((prev: any) => ({ ...prev, title: e.target.value }))} className="bg-transparent border-none font-bold text-sm w-full outline-none focus:ring-0 truncate dark:text-neutral-100" />
          </div>

          {canvasContent.history?.length > 1 && (
            <div className="flex items-center gap-1.5 bg-neutral-200/50 dark:bg-neutral-800/50 rounded-lg p-1 shrink-0 ml-1 border border-neutral-200 dark:border-neutral-700">
              <button onClick={() => onHistoryNavigate(-1)} disabled={(canvasContent.historyIndex ?? 0) === 0} className="p-1 rounded-md text-neutral-500 hover:bg-white dark:hover:bg-neutral-700 disabled:opacity-30 disabled:hover:bg-transparent transition-all" title="Undo / Previous Version"><ChevronLeft className="w-4 h-4" /></button>
              <span className="text-[10px] font-black text-neutral-500 tracking-widest px-1 w-12 text-center" title="Version History">v{(canvasContent.historyIndex ?? 0) + 1}/{canvasContent.history.length}</span>
              <button onClick={() => onHistoryNavigate(1)} disabled={(canvasContent.historyIndex ?? 0) === (canvasContent.history?.length ?? 1) - 1} className="p-1 rounded-md text-neutral-500 hover:bg-white dark:hover:bg-neutral-700 disabled:opacity-30 disabled:hover:bg-transparent transition-all" title="Redo / Next Version"><ChevronRight className="w-4 h-4" /></button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canvasContent.id && savedApps.some(a => a.id === canvasContent.id) ? (
            <div className="flex gap-1">
              <button onClick={() => onSaveToLibrary(false)} className="px-3 py-2 bg-[#4A5D75] text-white rounded-xl text-[10px] font-black uppercase hover:bg-[#3D4D61] transition-all">Update</button>
              <button onClick={() => { setSaveAppData({ title: canvasContent.title + ' (Copy)' }); setShowSaveModal(true); }} className="px-3 py-2 bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 rounded-xl text-[10px] font-black uppercase hover:bg-neutral-200 hidden lg:block">Save Copy</button>
            </div>
          ) : (
            <button onClick={() => { setSaveAppData({ title: canvasContent.title }); setShowSaveModal(true); }} className="px-3 py-2 text-[#4A5D75] bg-[#F0F4F8] dark:bg-[#1E2B38]/30 rounded-xl hover:bg-[#D6E0EA] transition-all text-[10px] font-black uppercase">Save</button>
          )}
          <div className="w-px h-6 bg-neutral-200 dark:bg-neutral-800 mx-1" />
          <button onClick={() => setCanvasContent(null)} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg text-neutral-400"><X className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex flex-col flex-1 overflow-hidden">
        {canvasContent.type === 'code' && (
          <div className="flex border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 shrink-0">
            {['preview', 'code'].map(tab => <button key={tab} onClick={() => setCanvasTab(tab)} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest transition-all ${canvasTab === tab ? 'text-[#4A5D75] border-b-2 border-[#4A5D75] bg-white dark:bg-neutral-950' : 'text-neutral-400'}`}>{tab === 'preview' ? 'Live Preview' : 'Source Code'}</button>)}
          </div>
        )}
        <div className="flex-1 bg-white dark:bg-neutral-950 overflow-hidden relative flex flex-col text-sm leading-relaxed">
          {canvasContent.type === 'image' ? (
            <div className="flex-1 flex items-center justify-center bg-neutral-100 dark:bg-neutral-900 p-8">
               <img src={canvasContent.content} alt={canvasContent.title} className="max-w-full max-h-full object-contain rounded-lg shadow-xl" />
            </div>
          ) : canvasContent.type === 'doc' ? (
            <div className="flex flex-col h-full">
              <div className="flex gap-1 p-2 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 shrink-0 overflow-x-auto no-scrollbar">
                {[['bold','B'],['italic','I'],['underline','U']].map(([cmd, lbl]) => <button key={cmd} onMouseDown={e => { e.preventDefault(); document.execCommand(cmd); }} className={`p-1.5 px-3 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded text-neutral-700 dark:text-neutral-300 ${cmd === 'bold' ? 'font-black' : cmd === 'italic' ? 'italic font-serif' : 'underline'}`}>{lbl}</button>)}
                <div className="w-px h-4 bg-neutral-300 dark:bg-neutral-700 mx-1 self-center" />
                {[['H1','H1'],['H2','H2']].map(([cmd, lbl]) => <button key={cmd} onMouseDown={e => { e.preventDefault(); document.execCommand('formatBlock', false, cmd); }} className="p-1.5 px-2 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded font-black text-xs text-neutral-700 dark:text-neutral-300">{lbl}</button>)}
                <div className="w-px h-4 bg-neutral-300 dark:bg-neutral-700 mx-1 self-center" />
                <button onMouseDown={e => { e.preventDefault(); document.execCommand('insertUnorderedList'); }} className="p-1.5 px-2 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded font-bold text-xs flex items-center gap-1 text-neutral-700 dark:text-neutral-300"><List className="w-3 h-3" /> List</button>
              </div>
              {isGenerating && !canvasContent.content ? (
                <div className="flex-1 flex flex-col items-center justify-center space-y-4 opacity-40"><RefreshCw className="w-12 h-12 animate-spin text-[#9FBBAF]" /><span className="text-xs font-black uppercase tracking-widest">Drafting...</span></div>
              ) : (
                <WysiwygEditor html={canvasContent.content} disabled={isGenerating} onChange={(html: string) => setCanvasContent((prev: any) => ({ ...prev, content: html }))} />
              )}
            </div>
          ) : canvasTab === 'code' ? (
            <div className="flex-1 flex overflow-hidden bg-white dark:bg-neutral-950 relative font-mono text-xs leading-[1.6]">
              <div className="absolute left-0 top-0 bottom-0 w-12 bg-neutral-50 dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 z-0" />
              <div ref={lineNumbersRef} className="w-12 py-6 pr-3 text-right text-neutral-400 overflow-hidden select-none opacity-50 z-10 shrink-0 border-r border-transparent">
                {canvasContent.content.split('\n').map((_: any, i: number) => <div key={i}>{i + 1}</div>)}
              </div>
              <textarea
                 ref={codeRef}
                 onScroll={onCodeScroll}
                 className="flex-1 w-full bg-transparent py-6 px-4 outline-none resize-none overflow-auto dark:text-neutral-300 custom-scrollbar whitespace-pre z-10 font-mono text-xs leading-[1.6]"
                 value={canvasContent.content}
                 onChange={e => setCanvasContent((prev: any) => ({ ...prev, content: e.target.value }))}
                 spellCheck="false"
              />
            </div>
          ) : isGenerating && !canvasContent.content ? (
            <div className="flex-1 flex flex-col items-center justify-center space-y-4 opacity-40"><RefreshCw className="w-12 h-12 animate-spin text-[#6A829E]" /><span className="text-xs font-black uppercase tracking-widest">Building App...</span></div>
          ) : (
            <iframe title="Preview" className="flex-1 w-full border-none bg-white" srcDoc={canvasContent.content} sandbox="allow-scripts allow-same-origin allow-forms allow-modals" />
          )}
        </div>
      </div>
    </div>
  );
}
