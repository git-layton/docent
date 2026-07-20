import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { ArrowLeft, Share2, Sparkles, Pencil, Check, X, RotateCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { usePanelResource } from '../lib/panelCache';
import { useUIStore } from '../store/useUIStore';

const ForceGraph2D: any = lazy(() => import('react-force-graph-2d') as any);

export interface GraphNode {
  id: string;
  label: string;
  node_type: string;
  source_url?: string;
  source_path?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
}

interface EntityDossierPageProps {
  node: GraphNode;
  allNodes: GraphNode[];
  allEdges: GraphEdge[];
  onBack: () => void;
  onSelectNode: (node: GraphNode) => void;
  onSendPrompt?: (prompt: string) => void;
}

const TYPE_COLORS: Record<string, string> = {
  person: '#f97316',
  org: '#fb923c',
  place: '#f472b6',
  product: '#fbbf24',
  concept: '#facc15',
  technology: '#facc15',
  page: '#38bdf8',
  file: '#a78bfa',
  note: '#34d399',
};

function typeColor(type: string): string {
  return TYPE_COLORS[type.toLowerCase()] ?? '#94a3b8';
}

export function EntityDossierPage({
  node,
  allNodes,
  allEdges,
  onBack,
  onSelectNode,
  onSendPrompt,
}: EntityDossierPageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [dossierText, setDossierText] = useState('');
  const [saving, setSaving] = useState(false);

  // Compute dossier path e.g. "people/taylor.md" or "entities/project-x.md"
  const slug = node.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'entity';
  const folder = node.node_type.toLowerCase() === 'person' ? 'people' : 'entities';
  const dossierPath = `${folder}/${slug}.md`;

  // Read existing dossier file
  const { data: loadedContent, refresh: reloadDossier, loading: dossierLoading } = usePanelResource<string>({
    key: `dossier:${dossierPath}`,
    fetch: async () => {
      try {
        const res = await invoke<any>('read_knowledge_file', { path: dossierPath });
        if (res && typeof res.content === 'string') return res.content;
        return '';
      } catch {
        return '';
      }
    },
  });

  useEffect(() => {
    if (loadedContent !== undefined) {
      setDossierText(loadedContent || `# ${node.label}\n\nType: ${node.node_type}\n\n- Fact: Knowledge record for ${node.label}\n`);
    }
  }, [loadedContent, node]);

  // Compute 2-hop neighborhood
  const { neighborhoodNodes, neighborhoodEdges } = useMemo(() => {
    const hop1 = new Set<string>([node.id]);
    allEdges.forEach(e => {
      const src = String((e as any).source?.id ?? e.source);
      const tgt = String((e as any).target?.id ?? e.target);
      if (src === node.id) hop1.add(tgt);
      if (tgt === node.id) hop1.add(src);
    });

    const hop2 = new Set<string>(hop1);
    allEdges.forEach(e => {
      const src = String((e as any).source?.id ?? e.source);
      const tgt = String((e as any).target?.id ?? e.target);
      if (hop1.has(src)) hop2.add(tgt);
      if (hop1.has(tgt)) hop2.add(src);
    });

    const nNodes = allNodes.filter(n => hop2.has(n.id));
    const nEdges = allEdges.filter(e => {
      const src = String((e as any).source?.id ?? e.source);
      const tgt = String((e as any).target?.id ?? e.target);
      return hop2.has(src) && hop2.has(tgt);
    });

    return { neighborhoodNodes: nNodes, neighborhoodEdges: nEdges };
  }, [node, allNodes, allEdges]);

  // Connected direct neighbors for list display
  const directConnections = useMemo(() => {
    const connectedIds = new Set<string>();
    const relMap = new Map<string, string>();

    allEdges.forEach(e => {
      const src = String((e as any).source?.id ?? e.source);
      const tgt = String((e as any).target?.id ?? e.target);
      if (src === node.id) {
        connectedIds.add(tgt);
        relMap.set(tgt, e.relation || 'connected to');
      } else if (tgt === node.id) {
        connectedIds.add(src);
        relMap.set(src, e.relation || 'connected from');
      }
    });

    return allNodes
      .filter(n => connectedIds.has(n.id))
      .map(n => ({ node: n, relation: relMap.get(n.id) || 'connected' }));
  }, [node, allNodes, allEdges]);

  const saveDossier = async () => {
    setSaving(true);
    try {
      await invoke('write_memory', {
        path: dossierPath,
        content: dossierText,
        commitMessage: `dossier: update ${node.label}`,
        agentId: 'alexis',
      });
      useUIStore.getState().showToast(`Saved dossier for ${node.label} ✓`);
      setIsEditing(false);
      reloadDossier();
    } catch (e: any) {
      useUIStore.getState().showToast(`Could not save dossier: ${e?.message ?? String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleAskAgent = () => {
    if (!onSendPrompt) return;
    onSendPrompt(`What do we know about ${node.label}?`);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-panel">
      {/* Top Header */}
      <div className="h-12 flex items-center gap-3 px-4 border-b border-edge shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-lg text-ink-3 hover:bg-wash hover:text-ink transition-colors" title="Back to Directory">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div
          className="w-3 h-3 rounded-full shrink-0"
          style={{ background: typeColor(node.node_type) }}
        />
        <span className="text-sm font-bold text-ink truncate">{node.label}</span>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-wash text-ink-2 uppercase tracking-wider">
          {node.node_type}
        </span>
        <div className="flex-1" />
        {onSendPrompt && (
          <button
            onClick={handleAskAgent}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent-soft text-accent hover:bg-accent hover:text-on-accent transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" /> Ask Agent
          </button>
        )}
      </div>

      {/* Main 2-column layout */}
      <div className="flex-1 overflow-hidden flex divide-x divide-edge">
        {/* Left: Markdown Dossier Editor / View */}
        <div className="w-1/2 flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 border-b border-edge flex items-center justify-between shrink-0 bg-wash/30">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">Dossier / Facts</span>
            {isEditing ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={saveDossier}
                  disabled={saving}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-accent text-on-accent hover:bg-accent-strong transition-opacity"
                >
                  {saving ? <RotateCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="p-1 rounded-md text-ink-3 hover:text-ink hover:bg-wash transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-ink-2 hover:bg-wash hover:text-ink transition-colors"
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {dossierLoading ? (
              <div className="flex items-center gap-2 text-ink-3 text-xs"><RotateCw className="w-3.5 h-3.5 animate-spin" /> Loading dossier…</div>
            ) : isEditing ? (
              <textarea
                value={dossierText}
                onChange={e => setDossierText(e.target.value)}
                rows={18}
                className="w-full h-full font-mono text-xs p-3 bg-inset border border-edge rounded-xl text-ink outline-none resize-none leading-relaxed"
                placeholder={`Write facts about ${node.label}…`}
              />
            ) : (
              <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed whitespace-pre-wrap text-ink-2">
                {dossierText || '_No dossier created yet. Click Edit to add facts._'}
              </div>
            )}
          </div>
        </div>

        {/* Right: Connections & 2-hop graph widget */}
        <div className="w-1/2 flex flex-col overflow-hidden">
          {/* Connections Header */}
          <div className="px-4 py-2.5 border-b border-edge shrink-0 bg-wash/30 flex items-center gap-2">
            <Share2 className="w-3.5 h-3.5 text-ink-3" />
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">
              Connections ({directConnections.length})
            </span>
          </div>

          {/* Direct Connections List */}
          <div className="max-h-48 overflow-y-auto divide-y divide-edge border-b border-edge">
            {directConnections.length === 0 ? (
              <div className="p-4 text-xs text-ink-3">No direct graph connections found.</div>
            ) : (
              directConnections.map(({ node: conn, relation }) => (
                <button
                  key={conn.id}
                  onClick={() => onSelectNode(conn)}
                  className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-wash transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: typeColor(conn.node_type) }} />
                    <span className="text-xs font-medium text-ink truncate">{conn.label}</span>
                  </div>
                  <span className="text-[10px] text-ink-3 px-2 py-0.5 rounded bg-inset shrink-0 ml-2">
                    {relation}
                  </span>
                </button>
              ))
            )}
          </div>

          {/* 2-hop Neighborhood Widget */}
          <div className="flex-1 flex flex-col overflow-hidden relative">
            <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-3 bg-inset border-b border-edge shrink-0">
              2-Hop Neighborhood ({neighborhoodNodes.length} nodes)
            </div>
            <div className="flex-1 bg-inset/40 overflow-hidden relative">
              <Suspense fallback={<div className="p-4 text-xs text-ink-3">Loading graph widget…</div>}>
                <ForceGraph2D
                  graphData={{
                    nodes: neighborhoodNodes,
                    links: neighborhoodEdges.map(e => ({ source: e.source, target: e.target })),
                  }}
                  nodeLabel="label"
                  nodeColor={(n: any) => typeColor(n.node_type)}
                  nodeRelSize={5}
                  linkColor={() => 'rgba(150, 150, 150, 0.3)'}
                  onNodeClick={(n: any) => onSelectNode(n)}
                />
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
