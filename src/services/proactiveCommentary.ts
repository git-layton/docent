import { useEffect, useRef, useState } from 'react';
import { fetchWithRetry } from './llm';
import { useSettingsStore } from '../store/useSettingsStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProactiveCommentResult {
  /** The AI's one-sentence observation, or null if nothing notable / timed out. */
  comment: string | null;
}

// ---------------------------------------------------------------------------
// Core service function
// ---------------------------------------------------------------------------

/**
 * Call after a 3-second dwell on a new page.
 * Returns a one-sentence observation or { comment: null } when the AI passes.
 */
export async function generateProactiveComment(opts: {
  pageTitle: string;
  pageContent: string;
  url: string;
  modelId: string;
}): Promise<ProactiveCommentResult> {
  const { pageTitle, pageContent, url, modelId } = opts;

  const models = useSettingsStore.getState().models;
  const modelConfig = models.find(m => m.id === modelId) ?? models[0] ?? null;

  if (!modelConfig) {
    return { comment: null };
  }

  const { provider, endpoint, apiKey } = modelConfig;

  const prompt = `You are an AI assistant browsing alongside a user. They just landed on this page.

Page: "${pageTitle}" (${url})
Content snippet: ${pageContent.slice(0, 2000)}

If there is something genuinely notable, surprising, or relevant that would be worth a 1-sentence observation, say it. If the page is routine, unremarkable, or you have nothing useful to add, respond with exactly: PASS

One sentence or PASS. Nothing else.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    let responseText = '';

    if (provider === 'google' || endpoint?.includes('google')) {
      const googleUrl = endpoint && endpoint !== ''
        ? endpoint
        : `https://generativelanguage.googleapis.com/v1beta/models/${modelConfig.modelId}:generateContent?key=${apiKey}`;
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      };
      const data = await fetchWithRetry(
        googleUrl,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        1,
        controller.signal,
      );
      responseText = String(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
    } else if (provider === 'anthropic') {
      const anthropicUrl = endpoint || 'https://api.anthropic.com/v1/messages';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
      const body = {
        model: modelConfig.modelId,
        max_tokens: 128,
        messages: [{ role: 'user', content: prompt }],
      };
      const data = await fetchWithRetry(
        anthropicUrl,
        { method: 'POST', headers, body: JSON.stringify(body) },
        1,
        controller.signal,
      );
      responseText = String(data.content?.[0]?.text ?? '');
    } else {
      // OpenAI-compatible (OpenAI, LM Studio, Ollama, HuggingFace, etc.)
      const base = (endpoint || 'https://api.openai.com/v1').replace(/\/$/, '');
      const chatUrl = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const body = {
        model: modelConfig.modelId,
        max_tokens: 128,
        messages: [{ role: 'user', content: prompt }],
      };
      const data = await fetchWithRetry(
        chatUrl,
        { method: 'POST', headers, body: JSON.stringify(body) },
        1,
        controller.signal,
      );
      responseText = String(data.choices?.[0]?.message?.content ?? '');
    }

    const trimmed = responseText.trim();
    if (!trimmed || trimmed.toUpperCase() === 'PASS') {
      return { comment: null };
    }
    return { comment: trimmed };
  } catch {
    return { comment: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

const DWELL_MS = 3000;

/**
 * Watches for URL changes (passed as a prop/argument) and fires
 * generateProactiveComment after a 3-second dwell. Surfaces the result
 * as `comment` and provides a `dismiss` callback.
 *
 * @param currentUrl  The current page URL — pass from the hosting component.
 * @param pageTitle   Page title string.
 * @param pageContent First ~3000 chars of clean page text.
 * @param enabled     Whether proactive commentary is active. Defaults to true.
 */
export function useProactiveCommentary(
  currentUrl: string,
  pageTitle: string,
  pageContent: string,
  enabled = true,
): {
  comment: string | null;
  dismiss: () => void;
} {
  const [comment, setComment] = useState<string | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedModelId = useSettingsStore(s => s.selectedModelId);

  useEffect(() => {
    // Clear any previous timer and dismiss stale comment on URL change
    if (dwellTimerRef.current !== null) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
    setComment(null);

    if (!enabled || !currentUrl || !selectedModelId) return;

    dwellTimerRef.current = setTimeout(async () => {
      const result = await generateProactiveComment({
        pageTitle,
        pageContent: pageContent.slice(0, 3000),
        url: currentUrl,
        modelId: selectedModelId,
      });
      if (result.comment) {
        setComment(result.comment);
      }
    }, DWELL_MS);

    return () => {
      if (dwellTimerRef.current !== null) {
        clearTimeout(dwellTimerRef.current);
        dwellTimerRef.current = null;
      }
    };
  // We intentionally only re-fire when the URL changes, not on every
  // content/title change (they may update mid-dwell as the page loads).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUrl, enabled, selectedModelId]);

  const dismiss = () => setComment(null);

  return { comment, dismiss };
}
