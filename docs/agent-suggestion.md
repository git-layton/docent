# Agent Suggestion — Design Note

**Status:** research complete, **not scheduled to build** (see Verdict). Captured so a future
revisit starts from the conclusion, not a blank page.

## The question

Non-technical users won't know that custom agents exist or how to make a good one. Should the
default assistant (**Alexis**) proactively suggest — or auto-create — purpose-built specialized
agents (a Philosophy companion, a study Tutor, a fitness Coach) as the user chats? And the gating
sub-question the owner sharpened:

> **Why is a separate specialized agent better than Alexis, who already notices how you like to do
> things and captures it?** If it isn't meaningfully better, don't build it.

## Verdict (TL;DR)

**Don't build the big version. We already own the engine.** A separate persistent agent only beats
Alexis-with-memory in a narrow, high-bar set of cases, and the personalization that makes a
generalist "know you" already ships. The *only* genuinely-new, worth-it-eventually piece is a
**high-bar, opt-in "suggest-and-pre-seed" moment** — and even that should wait until the existing
capture is made *legible* and the firing thresholds can be tuned on real usage.

- ❌ **Not a gallery** of user-managed agents — GPT-Store-style sprawl + dead discovery.
- ❌ **Not auto-spawn** per topic — the Clippy false-positive failure; erodes trust.
- ❌ **Not from-scratch creation** — blank "build your own" states create confusion; choice overload
  freezes novices.
- ✅ **One continuous-context host (Alexis)** that, rarely and only on a real durability signal,
  *offers* a curated-template specialist with one-tap accept and pre-seeded memory.

## Why (research)

| Lens | Finding | Source |
|---|---|---|
| When to take initiative | A proactive action is worth it only when inferred P(user wants it) clears an expected-value threshold **p\***; a *whole agent* is a heavy artifact, so its p\* sits far above autocomplete confidence. Fire at natural seams, never mid-task. | Horvitz, *Principles of Mixed-Initiative UIs*, CHI 1999; Mark et al., *Cost of Interrupted Work*, CHI 2008 |
| One host vs many agents | Add agents only when distinct categories *demonstrably* improve outcomes; multi-agent costs ~4–15× tokens and fits poorly for shared-context (a personal assistant *is* shared-context). A single continuous-context thread is the robust default; fragmenting memory makes it feel less like it knows you. | Anthropic, *Building Effective Agents* (2024); Cognition, *Don't Build Multi-Agents* (2025); Cemri et al., Berkeley MAST (2025) |
| Lowering the creation barrier | Blank-canvas creation "creates confusion and decreases confidence"; large equivalent option-sets cause regret/no-decision for novices. Use a short, named, distinct curated catalog; ≤2 levels of progressive disclosure. | NN/g empty-state & progressive-disclosure research; Iyengar & Lepper (2000); Scheibehenne et al. (2010) |
| Suggestion not automation | Keeping the human in control with a cheap one-tap accept increases satisfaction and preserves authorship. | GitHub Copilot impact study (2022); Google *Smart Compose* (2018) |

## The gate: when does a separate agent actually beat Alexis-with-memory?

A separate persistent agent earns its existence **only** when it owns something a generalist with
memory structurally cannot carry, *and* the need is **recurring + distinct**:

1. a durable **relationship / standing voice** (the persona effect — strongest for tutor/coach/companion),
2. a **private doc / memory corpus** it alone reasons over,
3. **distinct tools** or a different privacy/trust envelope,
4. an **isolated, long-running goal** that benefits from its own thread.

**"The generalist can also answer this" is explicitly NOT a reason** to spin up an agent. Pure factual
breadth → generalist + retrieval is enough.

## What we already have (so most of this is built)

- **Host + specialists + routing** — `useAgentStore` seeds a small roster (Alexis/Codey/Forge Guide)
  with a `role`, sticky `@`-routing, and per-Space `agentGoals`.
- **Context hygiene without separate agents** — `memoryContext.ts` does semantic, relevance-gated
  retrieval (score cutoff, top-K; explicitly designed against "Lost in the Middle"). A philosophy
  query doesn't drag in tax memories — relevance ranking provides the isolation a separate agent was
  supposed to give.
- **Per-agent memory namespacing** — everything writes under `memory/<agentId>/`.
- **"Notices how you like to do X" → capture** — the memory gatekeeper (facts), applied-memory
  **playbooks** (procedures), and per-relationship **voice** already exist.

This is the **fact → playbook → agent ladder**: a gatekeeper saves a *fact*; repeated
facts/procedures become a *playbook*; a recurring, distinct, persistence-worthy *cluster* would
become an *agent*. The top rung is the only part not built.

## The one new piece worth building (later): suggest-and-pre-seed

A thin layer over existing substrate — **not** a new subsystem.

1. **Detection (cheapest-first), riding `memoryPolicy.ts:assessConversationMemory`:**
   - *Track A — explicit role request:* a few more regexes alongside the existing self-concept pass
     ("be my X", "act as my X", "I want a X coach/tutor"). High-confidence, propose immediately.
   - *Track B — inferred durable theme:* feed the per-turn salience `score` + `tags` into a small
     per-topic accumulator (`hitCount`, `importanceSum`, `firstSeen`, `lastSeen`, `distinctSessions`)
     — the Generative-Agents "sum importance to a threshold" mechanism.
2. **Durability gate (the Clippy fix):** fire only when a topic clears **all** of —
   `distinctSessions ≥ 3` (recurrence across *separate* chats, not one binge) **and** recency-decayed
   `importanceSum ≥ threshold` **and** still-recent activity **and** a "generalist-can't-do-this"
   driver from the gate above.
3. **Routing (one gated LLM call, only after the gate):** input = accumulated theme + 3–5
   representative turns + the curated catalog; output = strict JSON `{recommend, template_id,
   confidence, value_rationale}`. Propose only if `confidence ≥ ~0.7` **and** the rationale names a
   generalist-can't-do driver.
4. **Suggestion (three gears, seam-timed):** below gate → silent; above gate → queue one candidate and
   release at a natural seam (good answer / topic switch / session end) via the existing
   `useGroundedSuggestions` chip. Names the evidence, offers one-tap **Create** / **Not now** /
   equal-weight **"just keep asking me"** / small **Customize**. Hard caps: ≤1/session, weekly global
   cap, dedup against existing agents (prefer extending one), global off/aggressiveness toggle.
5. **Create-and-pre-seed (explicit accept only):** slot-fill the chosen template's *benchmarked* base
   prompt from the conversation, create via `useAgentStore` (assign a `role` so routing works), and
   migrate the triggering turns into `memory/<agentId>/` so it starts **warm** — **preserving each
   turn's `trust.ts` provenance** so a specialist born from an untrusted email/web turn can't inherit
   it as authoritative.
6. **Learn from the loop:** a declined `template_id` → cooldown/never-again; created-but-never-used →
   negative signal + gentle "archive this agent?"; track accept-rate as the north star. Ship
   **default-conservative** — under-suggesting is recoverable, a Clippy reputation is not.

Only genuinely new code: the per-topic accumulator + gate, the one gated router call, and the
seam/deferral queue. Everything else is the playbook substrate, the trust ladder, the grounded-chip
surface, and `useAgentStore` — all shipping today.

## Risks & open questions (why it waits)

- **Thresholds are unvalidated guesses.** The literature gives the *shape* (accumulate-to-threshold),
  not the numbers for this salience scale. Too low → Clippy; too high → looks dead. Must instrument
  accept-rate before trusting it.
- **Topic clustering is the weak, unbuilt link.** Track B needs a topic key; the existing tags are
  coarse. Bad clustering merges "Stoicism" with "space" (under-fires) or shatters "fitness" (never
  fires).
- **Persona effect is mainly evidenced for *relational* agents** (tutor/coach/companion). For utility
  ones (research/writing assistant), generalist + memory is likely enough — keep those as Alexis
  *sub-skills*, not separate agents. Catalog composition is a partly-empirical bet.
- **Template authoring is real cost.** Each template needs a hand-authored, individually-evaluated
  base prompt; a mediocre first specialist poisons trust in all future suggestions.
- **Pre-seed provenance leak.** Migrating turns must preserve trust tiers (see step 5).
- **Seam detection is fuzzy.** Use conservative heuristics (short ack / explicit new-topic), not an
  LLM seam-classifier.

## Recommendation for v1 (and for a non-technical user like the owner's spouse)

The near-term win is **not** an agent engine — it's making the **personalization that already happens
*legible***: surface "I'll remember you like X," let the adapting voice be felt, and warm up the
existing playbook nudge. The agent-suggestion moment is a **later, relational-templates-only,
instrument-first** item — genuinely worth it eventually, gated behind real usage data and a tuned
durability threshold.

## Sources

Horvitz, *Principles of Mixed-Initiative User Interfaces* (CHI 1999) ·
Mark, Gudith & Klocke, *The Cost of Interrupted Work* (CHI 2008) ·
Amershi et al., *Guidelines for Human-AI Interaction* (CHI 2019) ·
Anthropic, *Building Effective Agents* (2024) & *How we built our multi-agent research system* (2025) ·
Cognition (Walden Yan), *Don't Build Multi-Agents* (2025) ·
Cemri et al., *Why Do Multi-Agent LLM Systems Fail?* — Berkeley MAST (2025) ·
Iyengar & Lepper (2000) and Scheibehenne et al. (2010) on choice overload ·
Nielsen Norman Group on progressive disclosure & empty states ·
GitHub/Ziegler et al., *Quantifying Copilot's Impact* (2022) ·
Google AI, *Smart Compose* (2018) ·
Park et al., *Generative Agents* (2023) for accumulate-importance retrieval.
