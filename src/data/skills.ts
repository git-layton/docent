// Surface-scoped skills. Docent is ONE assistant now — the separate personas (Codey, Forge Guide)
// were retired in the July 2026 one-assistant merge. Their expertise lives on here as *skills*: focused
// prompt blocks appended to the system prompt based on the surface the user is working in, so the single
// assistant sharpens into an engineer on the Code canvas, a builder in App-build, an editor in a Document —
// without spinning up a distinct agent identity.
//
// These are standalone (no store imports) so they compose cleanly wherever the prompt is assembled.
// `skillsForSurface` maps the open tab/tool/mode to the skill blocks that apply.

import type { OmniTabType, ToolTabId } from '../types/omniTab';

export interface Skill {
  id: string;
  /** The prompt fragment appended when this skill is active. */
  prompt: string;
}

// Codey's engineering judgment, kept as a surface skill.
export const ENGINEERING_SKILL: Skill = {
  id: 'engineering',
  prompt:
    'You are working on real code. Build it right the first time: clean architecture, working code, ' +
    'no shortcuts that become tomorrow\'s debt. Think about how each change scales, and surface ' +
    'architectural risk, security issues, and edge cases before they bite. Prefer reusing existing ' +
    'utilities over adding new ones, and match the surrounding code\'s style.',
};

// Building a small app/prototype on the canvas — bias toward something that runs.
export const APP_BUILD: Skill = {
  id: 'app-build',
  prompt:
    'You are building a working app or prototype. Favor a runnable, self-contained result over ' +
    'exhaustive scaffolding. Wire real behavior end to end, keep the UI honest about what works, and ' +
    'never leave placeholder data where real state belongs.',
};

// Writing or editing a document — voice and structure over code.
export const DOC: Skill = {
  id: 'doc',
  prompt:
    'You are helping write or edit a document. Match the author\'s voice, keep structure clear, and ' +
    'make edits that read as if they were always there. Prefer concrete revisions over commentary.',
};

export const SKILLS: Skill[] = [ENGINEERING_SKILL, APP_BUILD, DOC];

export interface SurfaceContext {
  tabType?: OmniTabType;
  toolId?: ToolTabId;
  /** Generation mode, when the caller distinguishes (e.g. 'code' | 'app' | 'chat'). */
  mode?: string;
}

// Which skills apply to the surface the user is on. Returns the prompt-ready blocks in priority order;
// an empty array (plain chat) means the base assistant prompt is enough.
export function skillsForSurface(ctx: SurfaceContext): Skill[] {
  const out: Skill[] = [];
  if (ctx.tabType === 'code-canvas' || ctx.mode === 'code') out.push(ENGINEERING_SKILL);
  if (ctx.mode === 'app') out.push(APP_BUILD);
  if (ctx.tabType === 'doc' || ctx.mode === 'doc') out.push(DOC);
  return out;
}

// Convenience: the concatenated prompt text for a surface, ready to append to the system prompt.
export function skillPromptForSurface(ctx: SurfaceContext): string {
  return skillsForSurface(ctx)
    .map((s) => s.prompt)
    .join('\n\n');
}
