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
import { X, Search } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

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

const MOCK_GRAPH: GraphData = {
  nodes: [
    { id: 'n1', label: 'Agent Forge Docs', node_type: 'page', source_url: 'https://docs.agentforge.dev' },
    { id: 'n2', label: 'Anthropic', node_type: 'entity' },
    { id: 'n3', label: 'React', node_type: 'technology' },
    { id: 'n4', label: 'Knowledge Core Notes', node_type: 'note', source_path: '~/AgentForge/notes' },
  ],
  edges: [
    { source: 'n1', target: 'n2', relation: 'mentions' },
    { source: 'n1', target: 'n3', relation: 'uses' },
    { source: 'n4', target: 'n1', relation: 'references' },
  ],
};

const NODE_COLORS: Record<string, string> = {
  page: '#38bdf8',
  file: '#a78bfa',
  note: '#34d399',
  entity: '#f97316',
  person: '#f97316',
  concept: '#facc15',
  technology: '#facc15',
};

function nodeColor(type: string): string {
  return NODE_COLORS[type] ?? '#94a3b8';
}

const NODE_TYPES = ['All', 'Page', 'File', 'Note', 'Entity', 'Concept'] as const;

function KnowledgeGraphPanelInner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    // Normalize whatever the backend returns to guaranteed arrays. `get_graph_stats` can resolve
    // with a stats-shaped payload that has no `nodes`/`edges` arrays — storing that raw left
    // graphData.nodes undefined and crashed the filter memos during render. Only accept real graphs.
    const asGraph = (g: any): GraphData | null =>
      Array.isArray(g?.nodes) && Array.isArray(g?.edges) ? { nodes: g.nodes, edges: g.edges } : null;
    const load = async () => {
      try {
        const stats = asGraph(await invoke('get_graph_stats').catch(() => null));
        if (stats) { setGraphData(stats); return; }
        const subgraph = asGraph(await invoke('get_graph_neighbors', { nodeId: 'root' }).catch(() => null));
        setGraphData(subgraph ?? MOCK_GRAPH);
      } catch {
        setGraphData(MOCK_GRAPH);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

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
      const matchesType = typeFilter === 'All' || n.node_type.toLowerCase() === typeFilter.toLowerCase();
      return matchesSearch && matchesType;
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
  }, []);

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

  return (
    <div className="flex flex-col h-full bg-panel overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 px-4 py-2.5 border-b border-edge flex items-center gap-3 flex-wrap">
        <span className="text-xs font-black uppercase tracking-widest text-ink shrink-0">
          Knowledge Graph
        </span>

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
      </div>

      {/* Graph + Sidebar */}
      <div className="flex flex-1 overflow-hidden relative">
        <div ref={containerRef} className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full text-xs text-ink-3 font-bold uppercase tracking-widest">
              Loading...
            </div>
          ) : filteredNodes.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-ink-3 font-bold uppercase tracking-widest">
              No nodes match filter
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
                onClick={() => { setSidebarOpen(false); setSelectedNode(null); setHighlightIds(new Set()); }}
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
          </div>
        )}
      </div>
    </div>
  );
}

export function KnowledgeGraphPanel() {
  // Outer boundary so ANY throw in the panel (bad data shape, hooks, render) shows the fallback
  // card instead of crashing the whole app — the inner boundary only covered the graph canvas.
  return (
    <GraphErrorBoundary>
      <KnowledgeGraphPanelInner />
    </GraphErrorBoundary>
  );
}
