export const MODEL_SPECS: Record<string, number> = {
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'o1': 200000,
  'o3-mini': 200000,
  'claude-3-7-sonnet': 200000,
  'claude-3-5-sonnet': 200000,
  'claude-3-5-haiku': 200000,
  'claude-3-opus': 200000,
  'gemini-2.5-pro': 2000000,
  'gemini-2.5-flash': 1000000,
  'gemini-2.0-flash': 1000000,
  'dall-e-3': 4000,
};

export const getContextLimit = (id: string) => {
  const cleanId = String(id || '').toLowerCase();
  if (MODEL_SPECS[cleanId]) return MODEL_SPECS[cleanId];
  for (const [key, limit] of Object.entries(MODEL_SPECS)) {
    if (cleanId.includes(key)) return limit;
  }
  return 32000;
};

export const supportsVision = (modelId: string) => {
  if (!modelId) return false;
  const id = modelId.toLowerCase();
  return [
    'gpt-4o',
    'gpt-4.1',
    'gpt-5',
    'o3',
    'o4',
    'claude-3',
    'claude-4',
    'sonnet',
    'opus',
    'haiku',
    'gemini',
    'llava',
    'bakllava',
    'moondream',
    'minicpm',
    'qwen-vl',
    'qwen2-vl',
    'qwen2.5-vl',
    'pixtral',
    'vision',
    'vlm',
    'image',
    'multimodal',
  ].some(token => id.includes(token));
};

export const trimHistoryChars = (msgs: any[], charLimit: number) => {
  if (!charLimit || charLimit <= 0) return msgs;
  const pinned = msgs.filter(m => m.isPinned);
  const unpinned = msgs.filter(m => !m.isPinned && !m.isToolCall);
  const pinnedLen = pinned.reduce((acc, m) => acc + String(m.content ?? '').length, 0);
  let budget = charLimit - pinnedLen;
  const kept = [];
  for (let i = unpinned.length - 1; i >= 0; i--) {
    const len = String(unpinned[i].content ?? '').length;
    if (budget - len < 0 && kept.length > 0) break;
    budget -= len;
    kept.unshift(unpinned[i]);
  }
  while (kept.length > 0 && kept[0].role === 'bot') kept.shift();
  return [...pinned, ...kept].sort((a, b) => {
    const aTs = parseInt(a.id.split('-')[1] || '0');
    const bTs = parseInt(b.id.split('-')[1] || '0');
    return aTs - bTs;
  });
};

export const fetchWithRetry = async (url: string, options: any, retries = 3, signal?: AbortSignal, returnRaw = false): Promise<any> => {
  let delay = 1000;
  let fetcher = window.fetch;

  if ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__) {
    try {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
      fetcher = tauriFetch;
    } catch (e) {
      console.error("[Agent Forge] CRITICAL: Missing Tauri HTTP plugin.");
    }
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetcher(url, { ...options, signal });
      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          errMsg = body?.error?.message ?? body?.message ?? errMsg;
        } catch { }

        if (res.status === 400 && /context|size|too large/i.test(errMsg)) throw new Error('CONTEXT_LIMIT_EXCEEDED');
        throw new Error(errMsg);
      }
      return returnRaw ? res : await res.json();
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      if (msg.includes('Failed to fetch') || msg.includes('Load failed')) {
        throw new Error(`CORS/Network Error: Detail: ${msg}`);
      }
      if (err?.name === 'AbortError' || msg === 'CONTEXT_LIMIT_EXCEEDED') throw err;
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 2, 8000);
    }
  }
};

export const validateModel = async (model: any) => {
  try {
    const { provider, endpoint, apiKey } = model;
    if (provider === 'web-llm') return true;

    let url, headers: any = {};

    if (provider === 'anthropic') {
      url = endpoint ? `${endpoint.replace(/\/messages$/, '')}/models` : 'https://api.anthropic.com/v1/models';
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else if (provider === 'google') {
      url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    } else if (provider === 'huggingface') {
      url = `https://api-inference.huggingface.co/v1/models`;
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    } else {
      const base = (endpoint || 'https://api.openai.com/v1').replace(/\/chat\/completions$/, '');
      url = `${base}/models`;
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    }

    await fetchWithRetry(url, { method: 'GET', headers }, 1);
    return true;
  } catch (err: any) {
    console.error(`Validation failed for ${model.id}:`, err.message);
    return false;
  }
};

export const buildSystemPrompt = ({ agent, profile, tasks, canvasContent, mode, isDeepThinking, agentPinnedMessages, appSettings, channelContext }: any) => {
  let prompt = (agent.prompt ?? '') + `\n\n[SYSTEM CONTEXT]\nCurrent Date/Time: ${new Date().toLocaleString()}\n`;

  const activeTools = Object.keys(agent.tools ?? {}).filter(k => agent.tools[k]);
  if (activeTools.length > 0) prompt += `[ACTIVE TOOLS]\n${activeTools.join(', ')}\n\n`;

  prompt += `[GROUNDING RULES]
- Treat the Knowledge Core as non-parametric memory: use retrieved notes, library files, channel memory, and pinned context to update your working model for this answer.
- Keep provenance attached. Distinguish user-provided facts, source-backed facts, raw captures, and agent-inferred work product.
- Use semantic facts/relations when provided to track entities, preferences, decisions, failures, and prior attempts across time.
- If retrieved memories conflict, prefer newer source-backed or user-provided evidence and state the conflict instead of smoothing it away.
- Do not upgrade low-confidence or agent-inferred memory into certain truth. Say what is known, what is inferred, and what still needs verification.
- For planning or building, use retrieved memories as constraints and history so the user does not have to repeat what was already tried.

`;

  if (channelContext?.kind === 'channel') {
    prompt += `[CHANNEL]\nName: ${channelContext.title}\nGoal: ${channelContext.goal || 'Not set'}\nInvited agents: ${(channelContext.participants ?? []).map((p: any) => `${p.name}${p.description ? ` (${p.description})` : ''}`).join(', ')}\nUse invited agent contributions when provided, but return one clear final answer.\n\n`;
  }

  if (canvasContent?.content) {
    prompt += `[OPEN ARTIFACT: ${canvasContent.title}]\n\`\`\`\n${canvasContent.content}\n\`\`\`\nIf asked to modify it, output the ENTIRE updated artifact in a SINGLE codeblock.\n\n`;
  }

  const pending = tasks.filter((t: any) => !t.completed);
  if (pending.length > 0) {
    prompt += `[PENDING TASKS]\n${pending.map((t: any) => `- ${t.title} (Due: ${t.dueDate ?? 'No Date'})`).join('\n')}\n\n`;
  }

  if (agentPinnedMessages && agentPinnedMessages.length > 0) {
    prompt += `[PINNED AGENT CONTEXT]\nThese are high-priority memories or saved snippets for this agent. Use them, but still respect provenance and uncertainty:\n${agentPinnedMessages.map((m: any) => `- ${m}`).join('\n')}\n\n`;
  }

  if (isDeepThinking) {
    prompt += `\n[DEEP THINKING MODE]\nBefore answering, work through the problem carefully. If useful, begin with a concise reasoning summary inside <think> and </think> tags, then provide the final answer. Do not expose private chain-of-thought or hidden deliberation.`;
  }

  prompt += `\n[TASK GENERATION]\nONLY if the user explicitly asks to set a reminder or create a task, output a \`\`\`task codeblock with JSON: {"title": "...", "dueDate": "YYYY-MM-DD", "location": "...", "details": "..."}.\n`;

  if (mode === 'code') {
    prompt += `\n[MODE: CODE CANVAS]\nOutput the application inside a SINGLE \`\`\`html codeblock. The codeblock MUST contain a complete, valid HTML document with embedded CSS (<style>) and JavaScript (<script>). Do NOT output separate CSS/JS blocks. It must be fully functional and ready to render in an iframe. You are an expert web developer. Ensure the UI is modern, visually appealing (using Tailwind CSS classes natively), responsive, and interactive. Make sure to implement all requested features cleanly and effectively. If deep thinking is enabled, output your <think> block first, then immediately follow it with the \`\`\`html code block. NEVER output markdown or conversational text outside of the code block.`;
  } else if (mode === 'doc') {
    prompt += `\n[MODE: DOC DRAFT]\nOutput the document as clean semantic HTML in a SINGLE \`\`\`html codeblock. DO NOT use markdown.`;
  }

  if (agent.awareOfProfile && profile && appSettings?.allowProfileUpdates !== false) {
    prompt += `\n\n[USER PROFILE]\n${profile}\n\n[PROFILE UPDATE COMMAND]\nIf the user reveals a new permanent preference or fact about themselves during the chat, propose a profile update using this EXACT format on a new line:\n\`\`\`profile\n{"fact": "The specific fact to remember"}\n\`\`\``;
  }

  if (agent.trainingDocs?.length > 0) prompt += `\n\n${agent.trainingDocs.map((d: any) => `[KNOWLEDGE BASE: ${d.name}]\n${d.content}`).join('\n\n')}`;
  prompt += `\n[LIBRARY SAVE]\nTo save content to the user's Library, output a \`\`\`save codeblock with JSON: {"title": "...", "content": "..."}. Use this when the user asks you to "save this", "take a note", "add to my library", or when you generate a highly valuable artifact (code, plan, document) that the user says is important or will need later. If the user says something like "this is exactly what I needed" about a long response, naturally suggest they bookmark it using the 🔖 icon.\n`;
  prompt += `\n[CALENDAR EVENTS]\nWhen the user mentions a birthday, anniversary, or any recurring annual event, output a \`\`\`event codeblock with JSON: {"type": "birthday"|"anniversary"|"custom", "name": "Full Name", "month": <1-12>, "day": <1-31>, "year": <optional birth year>}. When the user mentions a one-time appointment, deadline, or dated event, output a \`\`\`event codeblock with JSON: {"type": "date", "title": "...", "dueDate": "YYYY-MM-DD", "details": "<optional>"}. Always output the block immediately without asking for confirmation first.\n`;
  prompt += `\n[CITATIONS]\nYou MUST cite sources inline when answering from provided context.\n- For web search/research results: [Source: Title](URL)\n- For local Knowledge Core files: [[Title]] using the exact title shown in the search results\n- For grounded memories, preserve the evidence state in your wording when it matters: source-backed, user-provided, capture-backed, or agent-inferred.\nNever fabricate a citation. If a current/factual web answer cannot be verified from provided sources, say it could not be verified instead of guessing.`;

  return prompt;
};

export const generateTextResponse = async ({ messages, modelConfig, profile, attachedDocs, agent, tasks, mode, canvasContent, isDeepThinking, agentPinnedMessages, onChunk, signal, appSettings, channelContext }: any) => {
  if (!modelConfig) throw new Error('No model configured.');
  const { provider, endpoint, modelId, contextLimit, apiKey } = modelConfig;

  const systemPrompt = buildSystemPrompt({ agent, profile, tasks, canvasContent, mode, isDeepThinking, agentPinnedMessages, appSettings, channelContext });
  const textDocs = (attachedDocs ?? []).filter((d: any) => !d.isImage);
  const imageDocs = (attachedDocs ?? []).filter((d: any) => d.isImage);

  if (imageDocs.length > 0 && !supportsVision(modelId)) {
    throw new Error(`The selected model (${modelId}) cannot read image attachments. Switch to a vision-capable chat model such as GPT-4o/4.1, Claude Sonnet, Gemini, LLaVA, Pixtral, Qwen-VL, or remove the image.`);
  }

  let contextUsed = systemPrompt.length + textDocs.reduce((n: number, d: any) => n + (d.content?.length ?? 0), 0);
  const limit = contextLimit ? parseInt(contextLimit, 10) : 32000;
  if (contextUsed > limit) throw new Error('Attached documents exceed the context limit of this model.');

  const historyBudget = Math.max(1000, limit - contextUsed);
  const safeMessages = trimHistoryChars(messages, historyBudget);

  const attachedContext = textDocs.length > 0 ? '\n\n' + textDocs.map((d: any) => `[ATTACHED DOC: ${d.name}]\n${d.content}`).join('\n\n') : '';
  const imageContext = imageDocs.length > 0
    ? `\n\n[MULTIMODAL INPUT]\nThe user attached ${imageDocs.length} image${imageDocs.length === 1 ? '' : 's'}. Inspect the image content directly, answer the user's actual question, and say clearly if something in the image is ambiguous or unreadable.`
    : '';
  const fullSystem = systemPrompt + attachedContext + imageContext;

  const formatMessage = (m: any, targetProvider: string) => {
    const textContent = String(m.content ?? '');
    const imageFiles = (m.attachedFiles || []).filter((f: any) => f.isImage);

    if (imageFiles.length === 0) {
      if (targetProvider === 'google') return { role: m.role === 'bot' ? 'model' : 'user', parts: [{ text: textContent }] };
      return { role: m.role === 'bot' ? 'assistant' : 'user', content: textContent };
    }

    if (targetProvider === 'google') {
      return {
        role: m.role === 'bot' ? 'model' : 'user',
        parts: [ { text: textContent }, ...imageFiles.map((f: any) => ({ inlineData: { mimeType: f.type, data: f.content.split(',')[1] } })) ]
      };
    } else if (targetProvider === 'anthropic') {
      return {
        role: m.role === 'bot' ? 'assistant' : 'user',
        content: [
          ...imageFiles.map((f: any) => ({ type: 'image', source: { type: 'base64', media_type: f.type, data: f.content.split(',')[1] } })),
          { type: 'text', text: textContent }
        ]
      };
    } else {
      return {
        role: m.role === 'bot' ? 'assistant' : 'user',
        content: [ { type: 'text', text: textContent }, ...imageFiles.map((f: any) => ({ type: 'image_url', image_url: { url: f.content } })) ]
      };
    }
  };

  const headers: any = { 'Content-Type': 'application/json' };
  let url, body;

  const isGoogle = provider === 'google' || endpoint?.includes('google');

  if (isGoogle) {
    url = endpoint && endpoint !== '' ? endpoint : `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
    body = { contents: safeMessages.map(m => formatMessage(m, 'google')), systemInstruction: { parts: [{ text: fullSystem }] } };

    // Google Preview block does not support stream. We fallback to simulating it after fetch completes.
    const data = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body) }, 3, signal);
    const fullText = String(data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response received.');

    if (onChunk) {
        for (let i = 0; i < fullText.length; i += 40) {
            if (signal?.aborted) break;
            onChunk(fullText.slice(i, i + 40));
            await new Promise(r => setTimeout(r, 8));
        }
    }
    return fullText;
  }

  if (provider === 'anthropic') {
    url = endpoint || 'https://api.anthropic.com/v1/messages';
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    body = { model: modelId, max_tokens: 8192, system: fullSystem, messages: safeMessages.map(m => formatMessage(m, 'anthropic')), stream: true };
  } else {
    // Hugging Face uses the exact same Chat Completions format as OpenAI when hitting /v1/chat/completions
    const baseEndpoint = endpoint || 'https://api.openai.com/v1';
    url = baseEndpoint.endsWith('/chat/completions') ? baseEndpoint : `${baseEndpoint.replace(/\/$/, '')}/chat/completions`;
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    body = { model: modelId, messages: [{ role: 'system', content: fullSystem }, ...safeMessages.map(m => formatMessage(m, 'openai'))], stream: true };
  }

  // Pure SSE Streaming logic
  const res = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body) }, 3, signal, true);

  if (!res.body) {
      const data = await res.json();
      const text = provider === 'anthropic' ? (data.content?.[0]?.text || '') : (data.choices?.[0]?.message?.content || '');
      if (onChunk) {
            for (let i = 0; i < text.length; i += 40) {
                if (signal?.aborted) break;
                onChunk(text.slice(i, i + 40));
                await new Promise(r => setTimeout(r, 8));
            }
      }
      return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  try {
      while (true) {
          if (signal?.aborted) {
              reader.cancel();
              break;
          }
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
              if (line.trim() === '') continue;
              if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                  try {
                      const data = JSON.parse(line.slice(6));
                      let chunk = '';
                      if (provider === 'anthropic' && data.type === 'content_block_delta') {
                          chunk = data.delta?.text || '';
                      } else if (provider !== 'anthropic') {
                          chunk = data.choices?.[0]?.delta?.content || '';
                      }

                      if (chunk) {
                          fullText += chunk;
                          if (onChunk) onChunk(chunk);
                      }
                  } catch (e) { }
              }
          }
      }
  } finally {
      reader.releaseLock();
  }

  return fullText;
};
