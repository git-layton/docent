// Browse — drives the visible in-app browser tab via the agentic browse loop. Extracted verbatim
// from the former App.tsx tool if-chain (route 'browser'); behavior-identical. Live progress is
// reported through ctx.setStatus (was the onProgress → tool-message update).
import { runBrowserAgent, isBrowserPanelReady } from '../../browserAgent';
import { useSpaceStore } from '../../../store/useSpaceStore';
import { useUIStore } from '../../../store/useUIStore';
import type { Capability, CapabilityContext, CapabilityResult } from '../types';

export const browseCapability: Capability = {
  id: 'browse',
  title: 'Browse',
  description: 'Drive the in-app browser tab to read and act on live web pages.',
  effect: 'read',
  surfaces: '*',
  routes: ['browser'],
  async execute(ctx: CapabilityContext): Promise<CapabilityResult> {
    const foundSources: any[] = [];
    let toolData = '';
    let browseSummary = '';
    try {
        // Start from an explicit URL in the message if present, otherwise a DuckDuckGo HTML
        // results page the agent can click through. (DDG's html endpoint renders plain
        // result links and doesn't gate the embedded webview the way Google sign-in does.)
        const urlMatch = ctx.userMsg.content.match(/https?:\/\/[^\s)]+/i);
        const query = ctx.userMsg.content.replace(/^\s*(browse|open|go to|navigate to|visit|look on|check)\s+/i, '').trim() || ctx.userMsg.content;
        const startUrl = urlMatch ? urlMatch[0] : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

        // If no browser is live in the current Space/DM, open a real, visible 'web' tab there
        // (which mounts BrowserTabContent → the browser-panel webview) and wait for it to
        // register. The agent always drives this visible tab — never a hidden browser.
        let panelReady = await isBrowserPanelReady();
        if (!panelReady) {
            // Attribute the tab to the acting agent so it's grouped under that agent in the tab
            // overflow menu and shown as "opened by <agent>" in ambient context — the user can see
            // exactly which page the agent went and looked at.
            useSpaceStore.getState().openTab({ type: 'web', label: 'Browsing…', url: startUrl, openedByAgentId: ctx.agentId ?? undefined });
            for (let i = 0; i < 40 && !panelReady; i++) {
                await new Promise(r => setTimeout(r, 150));
                panelReady = await isBrowserPanelReady();
            }
        }

        if (!panelReady) {
            browseSummary = '🌐 Browse · could not open a browser tab';
            useUIStore.getState().showToast('Could not open a browser tab to browse with.');
            toolData += `\n\n[SYSTEM NOTE: BROWSE UNAVAILABLE]\nA browser tab could not be opened in time, so agentic browsing did not run.\n[END BROWSE]`;
        } else {
            const result = await runBrowserAgent({
                task: ctx.userMsg.content,
                startUrl,
                modelConfig: ctx.model,
                signal: ctx.signal,
                confirmSubmit: (desc: string) => window.confirm(`Agent Forge wants to submit a form while browsing.\n\n${desc}\n\nAllow?`),
                onProgress: (p) => {
                    const label = `🌐 Browsing · step ${p.step}/${p.maxSteps}${p.action ? ` · ${p.action}` : ''}`;
                    ctx.setStatus(label);
                },
            });

            result.sources.forEach((s) => {
                if (!foundSources.some((x: any) => x.url === s.url)) foundSources.push({ title: s.title, url: s.url, snippet: '' });
            });

            const sourceList = result.sources.length > 0
                ? '\n\nPages visited:\n' + result.sources.map((s) => `- ${s.title} (${s.url})`).join('\n')
                : '';
            const budgetNote = result.reachedBudget ? '\n(Note: the browsing step budget was reached before a definitive answer.)' : '';
            toolData += `\n\n[SYSTEM NOTE: BROWSE FINDINGS]\n${result.answer}${budgetNote}${sourceList}\n[END BROWSE]`;
            browseSummary = result.error
                ? '🌐 Browse · error'
                : `🌐 Browse · ${result.steps} step${result.steps !== 1 ? 's' : ''} · ${result.sources.length} page${result.sources.length !== 1 ? 's' : ''}`;
        }
    } catch (e: any) {
        console.error('Browse agent failed:', e);
        useUIStore.getState().showToast('Browsing failed. Check console logs.');
        browseSummary = '🌐 Browse · error';
        toolData += `\n\n[SYSTEM NOTE: BROWSE FAILED]\nThe browse agent encountered an error: ${e?.message ?? e}\n[END BROWSE]`;
    }
    return { toolData, sources: foundSources, status: { type: 'replace', content: browseSummary || '🌐 Browse' } };
  },
};
