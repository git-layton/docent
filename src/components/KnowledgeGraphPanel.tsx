import { useEffect, useRef, useState, useCallback, useMemo, Component, lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import type { NodeObject, LinkObject } from 'react-force-graph-2d';

// Lazy-load the force-graph renderer. Importing it eagerly evaluates a heavy canvas/d3 module at
// module-load time; if that throws it takes down the whole app before any error boundary can catch
// it (which is why this tab had to be pulled). Behind React.lazy the import only runs when the tab
// is opened, and any import/mount failure is contained by the <Suspense> + <GraphErrorBoundary>.
const ForceGraph2D: any = lazy(() => import('react-force-graph-2d') as any);

// ---------------------------------------------------------------------------
// Error boundary — keeps a ForceGraph2D crash from taking down the whole app
// ---------------------------------------------------------------------------
class GraphErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-ink-3">
          <span className="text-2xl">📊</span>
          <p className="text-xs font-bold uppercase tracking-widest">Graph renderer unavailable</p>
          <p className="text-[10px] text-ink-3 max-w-xs text-center">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="text-[10px] px-3 py-1.5 rounded-lg bg-wash hover:bg-inset transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import { X, Search, RefreshCw, Trash2, Telescope, LayoutList, Share2 as GraphIcon, ArrowRight } from 'lucide-react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';
import { EntityDossierPage } from './EntityDossierPage';

type NodeType = 'page' | 'file' | 'note' | 'entity' | 'person' | 'concept' | 'technology' | string;

interface GraphNode {
  id: string;
  label: string;
  node_type: NodeType;
  source_url?: string;
  source_path?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  relation: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const NODE_COLORS: Record<string, string> = {
  page: '#38bdf8',
  file: '#a78bfa',
  note: '#34d399',
  entity: '#f97316',
  person: '#f97316',
  org: '#fb923c',
  place: '#f472b6',
  product: '#fbbf24',
  concept: '#facc15',
  technology: '#facc15',
};

function nodeColor(type: string): string {
  return NODE_COLORS[type] ?? '#94a3b8';
}

const NODE_TYPES = ['All', 'Page', 'File', 'Note', 'Entity', 'Concept'] as const;

// The extractor emits person/org/place/product/concept/technology — group them under the two
// abstract filter chips so "Entity" and "Concept" match what actually lands in the DB.
const ENTITY_GROUP = new Set(['entity', 'person', 'org', 'place', 'product']);
const CONCEPT_GROUP = new Set(['concept', 'technology']);

function matchesTypeFilter(nodeType: string, filter: string): boolean {
  if (filter === 'All') return true;
  const t = nodeType.toLowerCase();
  if (filter === 'Entity') return ENTITY_GROUP.has(t);
  if (filter === 'Concept') return CONCEPT_GROUP.has(t);
  return t === filter.toLowerCase();
}

function KnowledgeGraphPanelInner({ onSendPrompt }: KnowledgeGraphPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [activeEntityNode, setActiveEntityNode] = useState<GraphNode | null>(null);
  const [mode, setMode] = useState<'directory' | 'graph'>('directory');
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Pull the REAL knowledge graph (all nodes + edges). The backend serializes edge endpoints as
  // source_id/target_id, but the renderer + filters expect source/target — so map them here.
  // Never fall back to fake data: an empty or unreachable graph just shows the empty state.
  const loadGraph = useCallback(async () => {
    const asGraph = (g: any): GraphData | null => {
      if (!Array.isArray(g?.nodes) || !Array.isArray(g?.edges)) return null;
      const edges: GraphEdge[] = g.edges.map((e: any) => ({
        source: String(e.source ?? e.source_id),
        target: String(e.target ?? e.target_id),
        relation: e.relation ?? '',
      }));
      return { nodes: g.nodes as GraphNode[], edges };
    };
    // Clear any open selection first — after a refetch the selected node may no longer exist, and
    // the detail sidebar would otherwise show a stale node (and a dangling delete target).
    setSelectedNode(null);
    setHighlightIds(new Set());
    setSidebarOpen(false);
    setConfirmingDelete(false);
    setLoading(true);
    try {
      const full = asGraph(await invoke('get_graph_full').catch(() => null));
      setGraphData(full ?? { nodes: [], edges: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const filteredNodes = useMemo(() =>
    (graphData.nodes ?? []).filter(n => {
      const matchesSearch = !search || n.label.toLowerCase().includes(search.toLowerCase());
      return matchesSearch && matchesTypeFilter(n.node_type, typeFilter);
    }),
    [graphData.nodes, search, typeFilter]
  );

  const filteredEdges = useMemo(() => {
    const ids = new Set(filteredNodes.map(n => n.id));
    return (graphData.edges ?? []).filter(
      e => ids.has(String(e.source)) && ids.has(String(e.target))
    );
  }, [filteredNodes, graphData.edges]);

  const degreeMap = useMemo(() => {
    const map = new Map<string, number>();
    filteredEdges.forEach(e => {
      const src = String(e.source);
      const tgt = String(e.target);
      map.set(src, (map.get(src) ?? 0) + 1);
      map.set(tgt, (map.get(tgt) ?? 0) + 1);
    });
    return map;
  }, [filteredEdges]);

  const handleNodeClick = useCallback((node: NodeObject<GraphNode>) => {
    const gn = node as NodeObject<GraphNode> & GraphNode;
    setSelectedNode(gn);
    setSidebarOpen(true);
    setConfirmingDelete(false);

    const neighborIds = new Set<string>([String(gn.id)]);
    filteredEdges.forEach(e => {
      const src = String((e as any).source?.id ?? e.source);
      const tgt = String((e as any).target?.id ?? e.target);
      if (src === String(gn.id)) neighborIds.add(tgt);
      if (tgt === String(gn.id)) neighborIds.add(src);
    });
    setHighlightIds(neighborIds);
  }, [filteredEdges]);

  const handleNodeDoubleClick = useCallback((node: NodeObject<GraphNode>) => {
    const gn = node as NodeObject<GraphNode> & GraphNode;
    if (gn.node_type === 'page' && gn.source_url) {
      invoke('open_url', { url: gn.source_url }).catch(() => {
        window.open(gn.source_url, '_blank');
      });
    } else if (gn.node_type === 'file' && gn.source_path) {
      invoke('open_in_canvas', { path: gn.source_path }).catch(() => {});
    }
  }, []);

  const handleBackgroundClick = useCallback(() => {
    setSelectedNode(null);
    setHighlightIds(new Set());
    setConfirmingDelete(false);
  }, []);

  // Two-click delete: first click arms the button, second click removes the node. The backend
  // cascades edge deletes (FK); mirror that locally instead of refetching the whole graph.
  const handleDeleteNode = useCallback(async () => {
    if (!selectedNode) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    const id = selectedNode.id;
    try {
      await invoke('delete_graph_node', { id });
      setGraphData(prev => ({
        nodes: prev.nodes.filter(n => n.id !== id),
        edges: prev.edges.filter(e => {
          const src = String((e as any).source?.id ?? e.source);
          const tgt = String((e as any).target?.id ?? e.target);
          return src !== id && tgt !== id;
        }),
      }));
      setSelectedNode(null);
      setSidebarOpen(false);
      setHighlightIds(new Set());
    } catch (err) {
      console.warn('[KnowledgeGraph] delete node failed:', err);
    } finally {
      setConfirmingDelete(false);
    }
  }, [selectedNode, confirmingDelete]);

  const handleResearchNode = useCallback(() => {
    if (!selectedNode || !onSendPrompt) return;
    // Node labels/urls come from LLM extraction over untrusted pages, so treat them as data, not
    // trusted prompt text: collapse to a single line, cap length, and only pass through a URL that
    // is actually a well-formed http(s) link. This keeps a page from smuggling instructions into
    // the message the user sends to their own agent.
    const cleanLabel = selectedNode.label.replace(/[\r\n`]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!cleanLabel) return;
    const url = selectedNode.source_url ?? '';
    const cleanUrl = /^https?:\/\/[^\s]+$/i.test(url) ? url.slice(0, 300) : '';
    const origin = cleanUrl ? ` I first saw it at ${cleanUrl}.` : '';
    onSendPrompt(
      `Research "${cleanLabel}" for me.${origin} Dig deeper, then relate what you find to what's already in my knowledge base.`
    );
  }, [selectedNode, onSendPrompt]);

  const selectedNodeEdges = selectedNode
    ? graphData.edges.filter(e => {
        const src = String((e as any).source?.id ?? e.source);
        const tgt = String((e as any).target?.id ?? e.target);
        return src === selectedNode.id || tgt === selectedNode.id;
      })
    : [];

  const edgeColorFn = useCallback(
    (link: LinkObject<GraphNode, GraphEdge>) => {
      const src = String((link as any).source?.id ?? link.source);
      const tgt = String((link as any).target?.id ?? link.target);
      if (highlightIds.size > 0 && highlightIds.has(src) && highlightIds.has(tgt)) {
        return 'rgba(148,163,184,0.9)';
      }
      return 'rgba(71,85,105,0.6)';
    },
    [highlightIds]
  );

  const nodeValFn = useCallback(
    (node: NodeObject<GraphNode>) => {
      const base = 6;
      const degree = degreeMap.get(String(node.id)) ?? 0;
      return base + degree * 1.5;
    },
    [degreeMap]
  );

  const nodeColorFn = useCallback(
    (node: NodeObject<GraphNode>) => {
      const gn = node as NodeObject<GraphNode> & GraphNode;
      if (highlightIds.size > 0 && !highlightIds.has(String(gn.id))) {
        return 'rgba(148,163,184,0.25)';
      }
      return nodeColor(gn.node_type);
    },
    [highlightIds]
  );

  // If an entity dossier is open, render EntityDossierPage
  if (activeEntityNode) {
    return (
      <EntityDossierPage
        node={activeEntityNode}
        allNodes={graphData.nodes}
        allEdges={graphData.edges}
        onBack={() => setActiveEntityNode(null)}
        onSelectNode={node => setActiveEntityNode(node)}
        onSendPrompt={onSendPrompt}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-panel overflow-hidden">
      {/* Top control bar */}
      <div className="shrink-0 px-4 py-2.5 border-b border-edge flex items-center gap-3 flex-wrap">
        <span className="text-xs font-black uppercase tracking-widest text-ink shrink-0">
          Knowledge Base
        </span>

        {/* Directory / Graph View mode switcher */}
        <div className="flex p-0.5 rounded-lg bg-inset border border-edge shrink-0">
          <button
            onClick={() => setMode('directory')}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold transition-all',
              mode === 'directory' ? 'bg-panel text-accent shadow-sm' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            <LayoutList className="w-3 h-3" /> Directory
          </button>
          <button
            onClick={() => setMode('graph')}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold transition-all',
              mode === 'graph' ? 'bg-panel text-accent shadow-sm' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            <GraphIcon className="w-3 h-3" /> Graph
          </button>
        </div>

        <div className="relative flex-1 min-w-32 max-w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-3" />
          <input
            className="w-full bg-inset rounded-lg pl-7 pr-3 py-1.5 text-[10px] font-bold outline-none focus:ring-1 ring-accent/30"
            placeholder="Search nodes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-1 flex-wrap">
          {NODE_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                typeFilter === t
                  ? 'bg-accent text-on-accent'
                  : 'bg-inset text-ink-3 hover:text-ink-2'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <span className="ml-auto shrink-0 text-[9px] font-black uppercase tracking-widest text-ink-3 bg-inset px-2 py-1 rounded-lg">
          {filteredNodes.length} nodes · {filteredEdges.length} edges
        </span>

        <button
          onClick={() => loadGraph()}
          disabled={loading}
          title="Refresh graph"
          className="shrink-0 p-1.5 rounded-lg text-ink-3 hover:text-ink-2 hover:bg-inset transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Main content: Directory vs Graph */}
      {mode === 'directory' ? (
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-full text-xs text-ink-3 font-bold uppercase tracking-widest">
              Loading Directory…
            </div>
          ) : filteredNodes.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-ink-3 font-bold uppercase tracking-widest text-center px-6">
              No entities found matching search/filter.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredNodes.map(node => {
                const degrees = degreeMap.get(node.id) ?? 0;
                return (
                  <button
                    key={node.id}
                    onClick={() => setActiveEntityNode(node)}
                    className="flex items-start gap-3 p-3.5 rounded-xl border border-edge bg-panel-2 hover:bg-wash hover:border-accent/40 transition-all text-left group"
                  >
                    <div
                      className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-xs font-black text-white shadow-sm"
                      style={{ background: nodeColor(node.node_type) }}
                    >
                      {node.label.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-ink truncate group-hover:text-accent transition-colors">
                          {node.label}
                        </span>
                        <ArrowRight className="w-3 h-3 text-ink-3 opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0" />
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-inset text-ink-3">
                          {node.node_type}
                        </span>
                        <span className="text-[10px] text-ink-3">
                          {degrees} connection{degrees === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Graph + Sidebar */
        <div className="flex flex-1 overflow-hidden relative">
        <div ref={containerRef} className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full text-xs text-ink-3 font-bold uppercase tracking-widest">
              Loading...
            </div>
          ) : filteredNodes.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-ink-3 font-bold uppercase tracking-widest text-center px-6">
              {graphData.nodes.length === 0
                ? 'Nothing in your knowledge base yet to graph'
                : 'No nodes match filter'}
            </div>
          ) : (
            <GraphErrorBoundary>
            <Suspense fallback={<div className="flex items-center justify-center h-full text-xs text-ink-3 font-bold uppercase tracking-widest">Loading graph…</div>}>
            <ForceGraph2D
              width={dimensions.width}
              height={dimensions.height}
              graphData={{ nodes: filteredNodes as any[], links: filteredEdges as any[] }}
              nodeId="id"
              linkSource="source"
              linkTarget="target"
              nodeVal={nodeValFn as any}
              nodeColor={nodeColorFn as any}
              nodeLabel={(node: any) => `${node.label} (${node.node_type})`}
              linkColor={edgeColorFn as any}
              linkWidth={1}
              backgroundColor="transparent"
              onNodeClick={handleNodeClick as any}
              onNodeRightClick={handleNodeDoubleClick as any}
              onBackgroundClick={handleBackgroundClick}
              enableNodeDrag
              enableZoomInteraction
              enablePanInteraction
              cooldownTicks={80}
            />
            </Suspense>
            </GraphErrorBoundary>
          )}
        </div>

        {/* Detail sidebar */}
        {sidebarOpen && selectedNode && (
          <div className="w-[280px] shrink-0 border-l border-edge flex flex-col overflow-hidden bg-panel">
            <div className="px-4 py-3 border-b border-edge flex items-center justify-between shrink-0">
              <span className="text-[10px] font-black uppercase tracking-widest text-ink-3">Node Detail</span>
              <button
                onClick={() => { setSidebarOpen(false); setSelectedNode(null); setHighlightIds(new Set()); setConfirmingDelete(false); }}
                className="p-1 rounded-lg text-ink-3 hover:text-ink-2 hover:bg-wash transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 no-scrollbar">
              <div className="space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-ink-3">Label</p>
                <p className="text-sm font-bold text-ink">{selectedNode.label}</p>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: nodeColor(selectedNode.node_type) }}
                />
                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: nodeColor(selectedNode.node_type) }}>
                  {selectedNode.node_type}
                </span>
              </div>

              {selectedNode.source_url && (
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-ink-3">URL</p>
                  <p className="text-[10px] text-[#38bdf8] break-all">{selectedNode.source_url}</p>
                </div>
              )}
              {selectedNode.source_path && (
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-ink-3">Path</p>
                  <p className="text-[10px] text-ink-2 break-all">{selectedNode.source_path}</p>
                </div>
              )}

              {selectedNodeEdges.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-ink-3">
                    Edges ({selectedNodeEdges.length})
                  </p>
                  <div className="space-y-1.5">
                    {selectedNodeEdges.map((e, i) => {
                      const src = String((e as any).source?.id ?? e.source);
                      const tgt = String((e as any).target?.id ?? e.target);
                      const isOut = src === selectedNode.id;
                      const otherId = isOut ? tgt : src;
                      const otherNode = graphData.nodes.find(n => n.id === otherId);
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-inset cursor-pointer hover:bg-wash transition-colors"
                          onClick={() => {
                            if (otherNode) handleNodeClick(otherNode as any);
                          }}
                        >
                          <span className="text-[9px] text-ink-3 font-bold shrink-0">{isOut ? '→' : '←'}</span>
                          <span className="text-[9px] text-ink-2 font-bold italic shrink-0">{e.relation}</span>
                          <span className="text-[10px] font-bold text-ink-2 truncate">
                            {otherNode?.label ?? otherId}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="shrink-0 border-t border-edge px-4 py-3 space-y-2">
              {onSendPrompt && (
                <button
                  onClick={handleResearchNode}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-accent text-on-accent text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-opacity"
                >
                  <Telescope className="w-3.5 h-3.5" />
                  Research this
                </button>
              )}
              <button
                onClick={handleDeleteNode}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${
                  confirmingDelete
                    ? 'bg-red-500/90 text-white'
                    : 'bg-inset text-ink-3 hover:text-red-400'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {confirmingDelete ? 'Click again to remove' : 'Remove from graph'}
              </button>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

interface KnowledgeGraphPanelProps {
  /** Wired from App's handleSendPrompt — powers the "Research this" node action. */
  onSendPrompt?: (text: string) => void;
}

export function KnowledgeGraphPanel({ onSendPrompt }: KnowledgeGraphPanelProps) {
  // Outer boundary so ANY throw in the panel (bad data shape, hooks, render) shows the fallback
  // card instead of crashing the whole app — the inner boundary only covered the graph canvas.
  return (
    <GraphErrorBoundary>
      <KnowledgeGraphPanelInner onSendPrompt={onSendPrompt} />
    </GraphErrorBoundary>
  );
}
