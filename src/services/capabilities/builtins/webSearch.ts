// Web Search — Tavily + Brave + Wikipedia via the Tauri HTTP backend. Extracted verbatim from the
// former App.tsx tool if-chain (route 'web_search'); behavior-identical.
import { fetchWithRetry } from '../../llm';
import { useUIStore } from '../../../store/useUIStore';
import type { Capability, CapabilityContext, CapabilityResult } from '../types';

export const webSearchCapability: Capability = {
  id: 'web-search',
  title: 'Web Search',
  description: 'Search the web via Tavily, Brave, and Wikipedia (HTTP — no browser tab needed).',
  effect: 'read',
  surfaces: '*',
  routes: ['web_search'],
  async execute(ctx: CapabilityContext): Promise<CapabilityResult> {
    const _integrations = ctx.integrations;
    const foundSources: any[] = [];
    let toolData = '';
    const searchProviders: string[] = [];
    let searchResultCount = 0;
    try {
        const query = ctx.userMsg.content.replace(/search( for)?|who is|what is|find/gi, '').trim() || ctx.userMsg.content;

        // Tavily Fetch — via Tauri HTTP backend to bypass WebView CORS
        if (_integrations.tavily?.enabled) {
            if (!_integrations.tavily?.apiKey) {
                useUIStore.getState().showToast("Tavily API key missing. Please add it in Settings → Integrations.");
            } else {
                try {
                    const tvData = await fetchWithRetry(
                        'https://api.tavily.com/search',
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                api_key: _integrations.tavily.apiKey,
                                query,
                                max_results: 3,
                                search_depth: "advanced",
                                include_answer: true
                            })
                        },
                        1
                    );
                    if (tvData.results) {
                        tvData.results.forEach((r: any) => foundSources.push({ title: r.title, url: r.url, snippet: r.content }));
                        if (tvData.results.length > 0) { searchProviders.push('Tavily'); searchResultCount += tvData.results.length; }
                    }
                    if (tvData.answer) {
                        toolData += `\n[TAVILY AI SUMMARY]\n${tvData.answer}\n`;
                    }
                } catch (tvErr: any) {
                    const msg = tvErr?.message ?? String(tvErr);
                    const isAuth = msg.includes('401') || msg.toLowerCase().includes('unauthorized');
                    useUIStore.getState().showToast(
                        isAuth
                            ? 'Tavily: Invalid API key — check Settings → Integrations.'
                            : `Tavily search failed: ${msg}`
                    );
                    console.warn("Tavily search failed:", tvErr);
                }
            }
        }

        // Brave Search Fetch
        if (_integrations.brave?.enabled && _integrations.brave?.apiKey) {
            try {
                const braveData = await fetchWithRetry(
                    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
                    {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json',
                            'Accept-Encoding': 'gzip',
                            'X-Subscription-Token': _integrations.brave.apiKey,
                        },
                    },
                    1
                );
                if (braveData?.web?.results) {
                    const braveNew = braveData.web.results.slice(0, 5).filter((r: any) => !foundSources.some((x: any) => x.url === r.url));
                    braveNew.forEach((r: any) => foundSources.push({ title: r.title, url: r.url, snippet: r.description ?? '' }));
                    if (braveNew.length > 0) { searchProviders.push('Brave'); searchResultCount += braveNew.length; }
                }
            } catch (braveErr: any) {
                const msg = braveErr?.message ?? String(braveErr);
                const isAuth = msg.includes('401') || msg.toLowerCase().includes('unauthorized');
                useUIStore.getState().showToast(
                    isAuth
                        ? 'Brave Search: Invalid API key — check Settings → Integrations.'
                        : `Brave search failed: ${msg}`
                );
                console.warn("Brave search failed:", braveErr);
            }
        }

        // Wikipedia Fetch — via Tauri HTTP backend
        const wikiQuery = query.split(' ').slice(0, 4).join(' ').trim();
        if (wikiQuery) {
            try {
                const wikiData = await fetchWithRetry(
                    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(wikiQuery)}&utf8=&format=json&origin=*`,
                    { method: 'GET' },
                    1
                );
                if (wikiData?.query?.search) {
                    const wikiNew = wikiData.query.search.slice(0, 2).filter((s: any) => !foundSources.some((x: any) => x.url === `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}`));
                    wikiNew.forEach((s: any) => {
                        const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}`;
                        foundSources.push({ title: `Wikipedia: ${s.title}`, url, snippet: s.snippet.replace(/<[^>]*>?/gm, '') });
                    });
                    if (wikiNew.length > 0) { searchProviders.push('Wikipedia'); searchResultCount += wikiNew.length; }
                }
            } catch (wikiErr: any) {
                console.warn("Wikipedia search failed:", wikiErr);
            }
        }

        if (foundSources.length > 0) {
            const searchResults = foundSources.map(s => `- ${s.title}: ${s.snippet} (URL: ${s.url})`).join('\n');
            toolData += `\n\n[SYSTEM NOTE: WEB SEARCH RESULTS]\n${searchResults}\n[END SEARCH]`;
        } else {
            toolData += `\n\n[SYSTEM NOTE: WEB SEARCH RESULTS]\nNo relevant results found online.\n[END SEARCH]`;
        }
    } catch (e: any) {
        console.error('Web search failed:', e);
        useUIStore.getState().showToast("Web search failed. Check console logs.");
        toolData += `\n\n[SYSTEM NOTE: WEB SEARCH FAILED]\nThe web search encountered an error: ${e.message}\n[END SEARCH]`;
    }

    const summary = searchResultCount > 0
      ? `🔍 ${searchProviders.length > 0 ? searchProviders.join(' + ') : 'Web'} · ${searchResultCount} result${searchResultCount !== 1 ? 's' : ''}`
      : `🔍 Web Search · no results found`;
    return { toolData, sources: foundSources, status: { type: 'replace', content: summary } };
  },
};
