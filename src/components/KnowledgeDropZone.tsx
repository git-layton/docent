import { useState, useRef } from 'react';
import { Upload, Loader2, FileText } from 'lucide-react';
import { extractTextFromPDF } from '../services/pdfParser';
import { extractAndWriteGraph, generateNodeId, upsertGraphNode } from '../services/graphEntityExtractor';
import { useSettingsStore } from '../store/useSettingsStore';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const TEXT_EXTS = ['txt', 'md', 'csv', 'json', 'html', 'htm', 'xml', 'rtf'];
const DOCX_EXTS = ['docx', 'doc'];
const ALL_EXTS = ['pdf', ...TEXT_EXTS, ...DOCX_EXTS];

interface Props {
  agentForgePath: string;
  onFileIngested: (name: string) => void;
  onError: (msg: string) => void;
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/\.[^/.]+$/, '') // strip extension
    .replace(/[^a-zA-Z0-9\s-_]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function buildLibraryFrontmatter(title: string): string {
  return [
    '---',
    'type: memmo',
    `created: ${new Date().toISOString()}`,
    'tags: [memmo, library]',
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

export function KnowledgeDropZone({ agentForgePath, onFileIngested, onError }: Props) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function processFile(file: File) {
    if (file.size > MAX_FILE_SIZE) {
      onError(`"${file.name}" exceeds 10MB limit.`);
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALL_EXTS.includes(ext)) {
      onError(`"${file.name}" is not a supported type. Accepted: PDF, TXT, MD, DOCX, CSV, JSON, HTML, XML, RTF`);
      return;
    }

    const baseName = sanitizeFileName(file.name);
    setStatus(null);

    try {
      let text = '';

      if (ext === 'pdf') {
        const pageCount = getPDFPageCount(file);
        setStatus(`Processing ${pageCount} page${pageCount !== 1 ? 's' : ''}...`);
        text = await extractTextFromPDF(file);
        if (!text || text.trim().length < 3) {
          onError('This PDF appears to be scanned images (no selectable text). Please run it through an OCR tool first, or use a text-based PDF.');
          setStatus(null);
          return;
        }
      } else if (DOCX_EXTS.includes(ext)) {
        setStatus('Extracting document text...');
        const mammoth = await import('mammoth');
        const arrayBuffer = await file.arrayBuffer();
        const result = await (mammoth as any).extractRawText({ arrayBuffer });
        text = result.value ?? '';
        if (!text.trim()) {
          onError(`"${file.name}" appears to be empty or has no extractable text.`);
          setStatus(null);
          return;
        }
      } else {
        setStatus('Reading file...');
        text = await readTextFile(file);
      }

      setStatus('Memorizing...');

      const { invoke } = await import('@tauri-apps/api/core');
      const path = `${agentForgePath}/library/${baseName}-${Date.now()}.md`;
      const content = buildLibraryFrontmatter(file.name) + text;

      const result = await invoke<{ blocked: boolean; commit: string | null }>('write_memory', {
        path,
        content,
        commitMessage: `ingest: ${file.name} → library`,
        agentId: null,
        contextTokens: null,
        ramState: null,
      });

      if (result.blocked) {
        onError('Nuke Shield blocked this write.');
      } else {
        onFileIngested(baseName);
        // Mirror the ingested file into the knowledge graph. With a configured model this also
        // extracts entities (which upserts the file node itself); without one, just record the
        // file node so the graph still shows what was ingested. Fire and forget — graph failures
        // never surface as ingest errors.
        const { models, selectedModelId } = useSettingsStore.getState();
        const modelConfig = models.find((m: any) => m.id === selectedModelId) ?? models[0];
        const graphWrite = modelConfig
          ? extractAndWriteGraph({
              text,
              sourceTitle: file.name,
              sourceNodeId: generateNodeId('file', path),
              sourceNodeType: 'file',
              sourcePath: path,
              modelConfig: modelConfig as Record<string, unknown>,
            })
          : upsertGraphNode({
              id: generateNodeId('file', path),
              nodeType: 'file',
              label: file.name,
              sourcePath: path,
            });
        void Promise.resolve(graphWrite).catch(err =>
          console.warn('[KnowledgeDropZone] graph write failed:', err));
      }
    } catch (e: any) {
      onError(e?.message ?? String(e));
    } finally {
      setStatus(null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => !status && fileInputRef.current?.click()}
      className={`relative flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-6 cursor-pointer transition-all ${
        isDragOver
          ? 'border-accent bg-accent-soft/40'
          : 'border-edge-2 hover:border-accent/50'
      } ${status ? 'cursor-default' : ''}`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt,.md,.csv,.json,.html,.htm,.xml,.rtf,.docx,.doc"
        className="hidden"
        onChange={handleFileInput}
      />

      {status ? (
        <>
          <Loader2 className="w-6 h-6 text-accent animate-spin" />
          <p className="text-xs font-bold text-accent">{status}</p>
        </>
      ) : (
        <>
          <Upload className="w-6 h-6 text-ink-3" />
          <p className="text-xs font-bold text-ink-2 text-center">
            Drop a document to add to your library
          </p>
          <p className="text-[10px] text-ink-3 text-center">Saved to ~/AgentForge/library/ · retrieved by agent on demand</p>
          <p className="text-[10px] text-ink-3 text-center">click to browse · 10MB max · text content only (no images)</p>
          <div className="flex flex-wrap gap-1.5 mt-1 justify-center">
            {['PDF', 'TXT', 'MD', 'DOCX', 'CSV', 'JSON', 'HTML', 'XML'].map(t => (
              <span key={t} className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-inset text-ink-2 rounded-full">
                <FileText className="w-2.5 h-2.5" />{t}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Rough page count estimate (1 page ≈ 50KB in a typical PDF)
function getPDFPageCount(file: File): number {
  return Math.max(1, Math.ceil(file.size / 51200));
}

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target?.result as string ?? '');
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
