# Agent model — research-backed rationale

Status: **decision brief** · Date: 2026-07-15
Resolves the July 14–15 tension: "specialized agents" (original premise) vs "one ambient
assistant" (sidecar doctrine). Companion to [main-window-redesign-prompt.md](main-window-redesign-prompt.md)
and [alexis-sidecar-spec.md](alexis-sidecar-spec.md).

---

## 1. Thesis

**Alexis is the single interlocutor. Expertise is *equipment* she wears (tools + knowledge +
persona-prompt), not a separate chat partner. "Agents" survive only as *workers you dispatch* —
the orchestrator-worker pattern — reserved for autonomous, parallelizable work. User-facing
peer routing (the original "pick / get handed to a different agent" design) is retired in favor
of internal orchestration behind one front door.**

This is not "kill the multi-agent work." It is "re-point it." Every mechanism already in the
data model survives; what changes is which of them the user *sees* and *navigates*.

## 2. The two tiers

| | **Equipment (a skill)** | **Worker (a dispatched agent)** |
|---|---|---|
| What it is | tools + knowledge + expert prompt attached to Alexis | an entity with its own goal, context window, and voice in the thread |
| You interact by | just talking to Alexis; she answers like an expert | dispatching it; it works and posts results back |
| Model field today | `prompt`, `tools`, `trainingDocs` | `drive` + `driveEnabled`, own `defaultModelId` |
| Example | "answer me like a securities lawyer" | Codey builds the pricing page while you're in Mail |
| Earns separate identity when | never — it's Alexis equipped | it runs **without you watching**, **in parallel**, needs its **own context**, and its output is **verifiable** |

The test for "should this be a worker or a skill": **autonomy + parallelism + separate context +
verifiable output.** All four → worker. Otherwise → skill on Alexis. Anthropic's own thresholds
are concrete: 1 agent for simple fact-finding, 2–4 for direct comparisons, 10+ only for genuinely
complex divisible research, and multi-agent is *"less effective for tightly interdependent tasks
such as coding"* — which is why Codey is **one** worker for the Code surface, not a swarm.

## 3. Evidence

**(a) This is the architecture Anthropic's own production multi-agent system uses.**
Claude's Research is an **orchestrator-worker** system: one lead agent plans, spins up 3–5
specialized subagents in parallel, and synthesizes their findings. Using a strong orchestrator
with cheaper subagents beat a single top model by **90.2%** *on the tasks that suit it* — but it
burns **~15× the tokens** of a normal chat, so it's reserved for high-value, parallelizable work.
That is exactly the two-tier split: one interlocutor that dispatches workers, not a mesh of peers
you navigate. [Anthropic; Claude blog]

**(b) The simplicity principle says invest in equipment before adding agents.**
Anthropic's *Building Effective Agents* is explicit: *"find the simplest solution possible, and
only increas[e] complexity when needed,"* adding complexity *"only when it demonstrably improves
outcomes,"* and spend effort on the **tools / agent-computer interface** rather than multiplying
agents. "I want an expert" is, by this principle, a tooling/knowledge problem first — a skill on
Alexis — not a new agent. [Anthropic Engineering]

**(c) User-facing peer routing has failure modes that internal orchestration avoids.**
Peer multi-agent routing (agents self-assign / hand off) brings *"significantly higher operational
complexity,"* **non-deterministic debugging** (*"the same input can produce wildly different agent
chains, making debugging nearly impossible"*), and **latency stacking** (1–3s per hop; a 3-agent
chain adds 3–9s minimum). Its upsides — no single point of failure, horizontal scaling,
high-throughput event buses — are **server-scale concerns that do not exist for one person on one
Mac.** So a local single-user assistant pays all of peer routing's costs and reaps none of its
benefits. Orchestrator-worker instead gives one clear control point and cuts cost 40–60%. [beam.ai;
requesty; digitalapplied — 2026]

**(d) Multiple *visible* agents raise cognitive load and break mental models.**
HCI work on early adopters of multi-agent tools finds that *"the involvement of multiple agents …
may make forming mental models cognitively demanding,"* a textbook extraneous-cognitive-load
problem under Cognitive Load Theory. The recommended mitigation is **group cards** — organize
dispatched agents by function/goal, don't make them conversational peers the user must track.
That is precisely "workers shown as a roster of jobs, one voice you talk to." [arXiv 2510.06224;
2506.06843; Weisz et al., CHI 2024]

**(e) The industry already ran the roster experiment and stepped back.**
OpenAI deprecated the Plugin ecosystem into Custom GPTs; the GPT Store now holds *millions*, and
*"finding good ones is harder than ever."* Reporting converges on: Custom GPTs work when they
**encapsulate a repeated workflow with stable inputs** (a skill/worker), and fail as a **"which one
am I talking to"** navigation surface — users increasingly prefer **one** capable assistant over
curating a roster. Model/persona switching is itself cited as a top confusion driver. [OpenAI; 2026
trade coverage]

## 4. What to keep from the original multi-agent routing

The routing work isn't wrong — it's **mis-placed on the surface**. Move it from *user-facing* to
*internal*:

- **Keep:** the router/orchestration logic, `agentIds` per space, the group thread, `agentGoals`
  (this is literally "a worker has a job"), per-agent context/model.
- **Change:** the user never picks an agent or gets handed between personas. They talk to Alexis;
  she routes to skills and dispatches workers under the hood. Specialization lives internally
  (slash verbs, routing, subagents) — the sidecar doctrine's §2 position, now evidence-backed.
- **Relabel:** a space's "roster" = *which workers are active here*, rendered as group cards, not
  a cast of chatbots. Codey is the canonical **app-bound worker** (built-in, `defaultMode: 'code'`).

## 5. Codebase implications

- `agentGoals: Record<agentId, string>` → reframed as **worker jobs** scoped to a space (keep the
  shape; rename in UI copy).
- The AGENTS sidebar section dies (per redesign prompt); dispatched workers appear **inside the
  space** as group cards, not as a global roster.
- `drive` / `driveEnabled` become the switch that makes an agent a **worker** (autonomous) vs inert.
- User-created agents are still forgeable — but the forge produces **skill packs** (equipment) and
  **workers** (dispatched), not conversational personas. "Agent Forge" the name still holds.

## 6. Honest counterweights

- **If the emotional draw of named personas is the actual product**, this is the wrong call — a
  persona roster is a *different product* (a companion/character marketplace) than a local
  screen-aware assistant. Pick one; the pain you feel is straddling both.
- **Orchestrator = single point of failure**: if Alexis mis-routes, the wrong worker runs. Mitigate
  with cheap verification passes and visible receipts (already the doctrine).
- **Context accumulation**: an orchestrator that absorbs every worker's full output can overflow
  context. Summarize-on-handoff, accept it's lossy, keep worker outputs as linkable receipts
  rather than inlined.

## 7. Sources

- Anthropic — *How we built our multi-agent research system* (orchestrator-worker; 90.2%; 15×
  tokens; per-task agent counts) — https://www.anthropic.com/engineering/multi-agent-research-system
- Anthropic — *When to use multi-agent systems (and when not to)* — https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them
- Anthropic — *Building Effective Agents* (simplicity; tools over agents; orchestrator-workers) — https://www.anthropic.com/engineering/building-effective-agents
- *Exploring Human-AI Collaboration Using Mental Models of Early Adopters of Multi-Agent GenAI Tools* — https://arxiv.org/html/2510.06224v1
- *United Minds or Isolated Agents? LLMs under Cognitive Load Theory* — https://arxiv.org/abs/2506.06843
- Weisz et al., *Design Principles for Generative AI Applications*, CHI 2024 — https://dl.acm.org/doi/full/10.1145/3613904.3642466
- *Multi-Agent Orchestration Patterns for Production (2026)* — https://beam.ai/agentic-insights/multi-agent-orchestration-patterns-production
- *Multi-Agent Orchestration Patterns That Actually Work in Production* — https://www.requesty.ai/blog/multi-agent-orchestration-patterns-that-work-in-production
