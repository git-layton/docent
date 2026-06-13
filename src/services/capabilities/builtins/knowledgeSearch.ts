// Knowledge Search — semantic RAG over the local Knowledge Core. Extracted verbatim from the
// former App.tsx tool if-chain (route 'memory_search'); behavior-identical.
import { invoke } from '@tauri-apps/api/core';
import type { Capability, CapabilityContext, CapabilityResult } from '../types';

export const knowledgeSearchCapability: Capability = {
  id: 'knowledge-search',
  title: 'Knowledge Search',
  description: 'Semantic search over the local Knowledge Core (agent memory + library).',
  effect: 'read',
  surfaces: '*',
  routes: ['memory_search'],
  async execute(ctx: CapabilityContext): Promise<CapabilityResult> {
    const foundSources: any[] = [];
    let toolData = '';
    try {
      let ragData = "No relevant documents found in Knowledge Core.";
      if ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__) {
        const kcResult = await invoke<{ results: Array<{ path: string; title: string; snippet: string; score: number }> }>(
          'search_knowledge_semantic', { query: ctx.userMsg.content.replace(/^\[PLANNING MODE[^\]]*\]\n+/i, '').trim(), agentId: ctx.assistant?.id ?? null, maxResults: ctx.hwProfile?.rag_results ?? 5, snippetChars: ctx.hwProfile?.rag_snippet_chars ?? 400 }
        );
        const hits = kcResult.results ?? [];
        if (hits.length > 0) {
          ragData = hits.map((h: any, i: number) => `[${i + 1}] ${h.title}\n${h.snippet}`).join('\n\n---\n\n');
          hits.forEach((h: any) => foundSources.push({ title: h.title, path: h.path, snippet: h.snippet }));
        }
      }
      toolData += `\n\n[SYSTEM NOTE: KNOWLEDGE SEARCH RESULTS]\n${ragData}\n[END SEARCH]`;
    } catch (e: any) {
      console.error('Local RAG failed:', e);
      toolData += `\n\n[SYSTEM NOTE: LOCAL RAG FAILED]\nError: ${e.message}\n[END SEARCH]`;
    }
    return { toolData, sources: foundSources, status: { type: 'remove' } };
  },
};
