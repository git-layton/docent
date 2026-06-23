import { invoke } from '@tauri-apps/api/core';
import { writeMemory } from '../lib/ipc';
import { logError } from '../lib/log';
import { generateTextResponse } from './llm';
import type { PinProfile } from './pinPersonalization';
import { formatPinProfileForPrompt, isDuplicateOfRecentPins } from './pinPersonalization';

// ─── MEMS system prompt ───────────────────────────────────────────────────────
// Uses the Memory Encoding Multi-Salience framework — 6 cognitive psychology
// principles that predict what information humans retain long-term.
const buildSystem = (agentName: string, existingFiles: string[], pinProfileText = '') =>
  `You are a knowledge curator for an AI agent named ${agentName}. Messages have just fallen out of the agent's active context window. Use the MEMS framework to decide what to preserve.

MEMS — Memory Encoding Multi-Salience Framework:
Each message should be evaluated against these six psychological encoding signals:

1. SELF-REFERENCE EFFECT (Rogers 1977): First-person statements about who the user IS or what they value ("I prefer X", "my wife Y", "I'm a Z", "I always/never"). These encode most deeply. → Always SAVE.

2. PROSPECTIVE MEMORY (Brandimonte 1996): Future intentions the user stated ("I need to", "I'll do", "don't forget to"). Without saving these, the agent loses track of commitments. → Always SAVE.

3. EMOTIONAL ENHANCEMENT (McGaugh 2003): Affective language signals something mattered ("I'm worried about", "so excited", "this is frustrating"). Emotional charge predicts long-term retention. → SAVE (not LOG).

4. SEMANTIC DEPTH (Craik & Lockhart 1972): Meaningful content (facts, decisions, recipes, code, events, plans) encodes deeper than social rituals. Greetings, "ok", "thanks", short acknowledgements are shallow. → SAVE vs SKIP.

5. ZEIGARNIK EFFECT (Zeigarnik 1927): Unfinished tasks and open threads create cognitive tension ("still haven't", "need to follow up", "pending"). The brain flags these as unresolved. → LOG at minimum, SAVE if linked to a goal.

6. RECURRENCE SIGNAL (Ebbinghaus spacing): If the same topic appears 3+ times across the message batch being evaluated, it clearly matters to the user. → SAVE even if individually weak.

Tier mapping:
SAVE — any MEMS signal 1-4 active, or recurrence (signal 6). Includes: user facts, preferences, relationships, events with dates, recipes, code, decisions, project context, plans, anything the agent should still know in a month.
LOG  — Zeigarnik signal only (incomplete threads with no other MEMS signal), or brief session context worth preserving for continuity. One sentence max.
SKIP — zero MEMS signals: greetings, "ok", "thanks", "sounds good", single-word reactions, trivial back-and-forth with no informational value.

Existing memory files: ${existingFiles.length > 0 ? existingFiles.join(', ') : 'none yet'}
${pinProfileText}

Rules:
- First-person personal statements → SAVE, never LOG or SKIP.
- Same topic recurring 3+ times in this batch → SAVE regardless of individual strength.
- Emotional content → SAVE (not LOG) — emotional signal means it mattered.
- Reuse an existing filename if the topic is already covered (update, not duplicate).
- For LOG: one sentence only.
- Dates, birthdays, anniversaries → events file, always SAVE.
- If content closely matches a recent pin (per fingerprint) → lean SKIP to avoid duplicate.

Respond ONLY with a JSON array, no markdown fences:
[{"msgId":"...","action":"SAVE|LOG|SKIP","content":"concise note","category":"preference|fact|event|recipe|code|decision|relationship|log","filename":"short-kebab-slug","salience_reason":"which MEMS principle(s) triggered this"}]`;

const parseResponse = (text: string): any[] => {
  try {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]);
  } catch {
    return [];
  }
};

export const evaluateDroppedMessages = async (
  messages: any[],
  agent: any,
  agentForgePath: string,
  modelConfig: any,
  appSettings: any,
  integrations: any,
  models: any[],
  pinProfile?: PinProfile,
  agentPins?: Array<{ content: string; savedAt: number }>
) => {
  if (!messages.length || !agentForgePath || !modelConfig) return;

  let existingFiles: string[] = [];
  try {
    const result = await invoke<{ files: Array<{ name: string }> }>('list_agent_memory_files', { agentId: agent.id });
    existingFiles = result.files.map((f: any) => f.name);
  } catch {}

  const pinProfileText = pinProfile ? formatPinProfileForPrompt(pinProfile) : '';

  const userMsg = messages
    .map(m => `[${m.id}] ${m.role === 'user' ? 'User' : (m.agentName || agent.name)}: ${String(m.content ?? '').slice(0, 600)}`)
    .join('\n\n');

  let raw = '';
  try {
    raw = await generateTextResponse({
      messages: [{ id: `ctx-eval-${Date.now()}`, role: 'user', content: `Evaluate these conversation messages:\n\n${userMsg}` }],
      modelConfig,
      agent: { prompt: buildSystem(agent.name, existingFiles, pinProfileText), tools: {}, trainingDocs: [] },
      profile: '',
      tasks: [],
      attachedDocs: [],
      agentPinnedMessages: [],
      mode: 'text',
      canvasContent: null,
      isDeepThinking: false,
      onChunk: null,
      signal: null,
      appSettings,
      integrations,
      models,
    });
  } catch {
    return;
  }

  const results = parseResponse(raw);
  const today = new Date().toISOString().split('T')[0];

  for (const item of results) {
    if (!item.action || item.action === 'SKIP' || !item.filename || !item.content) continue;

    // Duplicate guard: if this content is already in a recent pin, skip saving it again
    if (agentPins && isDuplicateOfRecentPins(item.content, agentPins as any)) continue;

    const safeName = String(item.filename).replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 60);
    const path = `${agentForgePath}/memory/${agent.id}/${safeName}.md`;
    const salientNote = item.salience_reason ? `\n*Salience: ${item.salience_reason}*` : '';
    const content = item.action === 'SAVE'
      ? `# ${item.category ?? 'note'}: ${safeName}\n*Auto-saved from context · ${today}*${salientNote}\n\n${item.content}`
      : `<!-- context-log -->\n*${today}*: ${item.content}\n`;
    await writeMemory({
      path,
      content,
      commitMessage: `context: auto-${item.action.toLowerCase()} ${item.category ?? 'note'}`,
      agentId: agent.id,
    }).catch((e) => logError('contextEvaluator.autoSave', e));
  }
};
