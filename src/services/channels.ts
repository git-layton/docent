export type ChannelKind = 'dm' | 'channel' | 'local';
export type ChannelNorm = 'social' | 'work' | 'creative' | 'default';

export interface ChannelChat {
  id: string;
  folderId?: string;
  name: string;
  kind?: ChannelKind;
  norm?: ChannelNorm;
  participantAgentIds?: string[];
  primaryAgentId?: string;
  goal?: string;
  /** Sticky scope: when set, ONLY these agents respond (across follow-ups) until the user @s
   *  someone else. Set by tagging an agent; null/undefined = default norm-based routing. */
  scopedAgentIds?: string[] | null;
  createdAt?: number;
  updatedAt?: number;
}

const unique = (values: Array<string | null | undefined>) =>
  Array.from(new Set(values.filter(Boolean) as string[]));

export const normalizeChatRecord = (chat: any, fallbackAgentId = 'f-default'): ChannelChat => {
  const now = Date.now();
  const kind: ChannelKind = chat?.kind ?? 'dm';
  const primaryAgentId = chat?.primaryAgentId ?? chat?.folderId ?? fallbackAgentId;
  const participantAgentIds = unique([
    primaryAgentId,
    chat?.folderId,
    ...(Array.isArray(chat?.participantAgentIds) ? chat.participantAgentIds : []),
  ]);

  return {
    ...chat,
    kind,
    folderId: chat?.folderId ?? primaryAgentId,
    primaryAgentId,
    participantAgentIds,
    norm: chat?.norm ?? 'default',
    goal: chat?.goal ?? '',
    createdAt: chat?.createdAt ?? chat?.updatedAt ?? now,
    updatedAt: chat?.updatedAt ?? chat?.createdAt ?? now,
  };
};

export const promoteChatToChannel = (
  chat: any,
  fallbackAgentId = 'f-default',
  options: { name?: string; goal?: string; participantAgentIds?: string[] } = {},
): ChannelChat => {
  const normalized = normalizeChatRecord(chat, fallbackAgentId);
  const primaryAgentId = normalized.primaryAgentId ?? normalized.folderId ?? fallbackAgentId;
  const participantAgentIds = unique([
    primaryAgentId,
    ...(normalized.participantAgentIds ?? []),
    ...(options.participantAgentIds ?? []),
  ]);

  return normalizeChatRecord({
    ...normalized,
    kind: 'channel',
    folderId: primaryAgentId,
    primaryAgentId,
    participantAgentIds,
    name: options.name ?? (normalized.name === 'New Chat' || normalized.name.endsWith(' Direct') ? 'New Channel' : normalized.name),
    goal: options.goal ?? normalized.goal ?? '',
    updatedAt: Date.now(),
  }, primaryAgentId);
};

export const chatIncludesAgent = (chat: any, agentId: string) => {
  const normalized = normalizeChatRecord(chat, agentId);
  if (normalized.kind === 'channel') {
    return normalized.participantAgentIds?.includes(agentId) || normalized.primaryAgentId === agentId;
  }
  return normalized.folderId === agentId || normalized.primaryAgentId === agentId;
};

export const getParticipantAgents = (chat: any, agents: any[]) => {
  const normalized = normalizeChatRecord(chat);
  const ids = normalized.kind === 'channel'
    ? normalized.participantAgentIds ?? []
    : [normalized.primaryAgentId ?? normalized.folderId ?? 'f-default'];
  return ids.map(id => agents.find(a => a.id === id)).filter(Boolean);
};

export const extractMentionedAgentIds = (input: string, participants: any[]): Set<string> => {
  const mentionedIds = new Set<string>();
  const queries = [...input.matchAll(/@(\w+)/gi)].map(m => m[1].toLowerCase());
  for (const query of queries) {
    const match = participants.find(p => {
      const name = (p.name ?? '').toLowerCase();
      return name.replace(/\s+/g, '').startsWith(query) || name.split(/\s+/)[0].startsWith(query);
    });
    if (match) mentionedIds.add(match.id);
  }
  return mentionedIds;
};

export const routeAgentsForChannel = (
  input: string,
  chat: any,
  agents: any[],
  activeAgentId: string,
) => {
  const normalized = normalizeChatRecord(chat, activeAgentId);
  const primary = agents.find(a => a.id === (normalized.primaryAgentId ?? activeAgentId))
    ?? agents.find(a => a.id === activeAgentId)
    ?? agents[0];

  if (normalized.kind !== 'channel') return primary ? [primary] : [];

  const participants = getParticipantAgents(normalized, agents);
  if (participants.length <= 1) return primary ? [primary] : participants;

  // @mentioned agents first (in order of mention), then all remaining participants
  const mentionedIds = extractMentionedAgentIds(input, participants);
  const mentioned = [...input.matchAll(/@(\w+)/gi)]
    .map(m => m[1].toLowerCase())
    .reduce<any[]>((acc, query) => {
      const match = participants.find(p => {
        const name = (p.name ?? '').toLowerCase();
        return name.replace(/\s+/g, '').startsWith(query) || name.split(/\s+/)[0].startsWith(query);
      });
      if (match && !acc.find(a => a.id === match.id)) acc.push(match);
      return acc;
    }, []);
  const remaining = participants.filter(p => !mentionedIds.has(p.id));
  return [...mentioned, ...remaining];
};

/** The agents @-mentioned in `input`, in order of first mention, de-duplicated. */
export const mentionedAgentsInOrder = (input: string, participants: any[]): any[] =>
  [...input.matchAll(/@(\w+)/gi)]
    .map(m => m[1].toLowerCase())
    .reduce<any[]>((acc, query) => {
      const match = participants.find(p => {
        const name = (p.name ?? '').toLowerCase();
        return name.replace(/\s+/g, '').startsWith(query) || name.split(/\s+/)[0].startsWith(query);
      });
      if (match && !acc.find(a => a.id === match.id)) acc.push(match);
      return acc;
    }, []);

/**
 * Resolve who responds to a message, honoring scoped/sticky sessions (spec §5):
 *  - the message @-mentions agents → ONLY those respond, and they become the sticky scope
 *  - else a sticky scope is active → ONLY those respond (across any number of follow-ups)
 *  - else → default routing (channel norm-based participation / DM primary)
 * Returns the agents to respond plus the scope to persist (`null` = no active scope).
 */
export const scopeAgentsForChat = (
  input: string,
  chat: any,
  agents: any[],
  activeAgentId: string,
  stickyScopeIds: string[] | null | undefined,
): { agents: any[]; scopeIds: string[] | null } => {
  const normalized = normalizeChatRecord(chat, activeAgentId);
  const participants = getParticipantAgents(normalized, agents);

  const mentioned = mentionedAgentsInOrder(input, participants);
  if (mentioned.length > 0) {
    return { agents: mentioned, scopeIds: mentioned.map(a => a.id) };
  }

  if (stickyScopeIds && stickyScopeIds.length > 0) {
    const scoped = stickyScopeIds
      .map(id => participants.find(p => p.id === id))
      .filter(Boolean);
    if (scoped.length > 0) return { agents: scoped, scopeIds: stickyScopeIds };
  }

  return { agents: routeAgentsForChannel(input, chat, agents, activeAgentId), scopeIds: null };
};

export const buildChannelPromptAddendum = (
  chat: any,
  allParticipants: any[],
  previousResponses: Array<{ agentName: string; content: string }>,
  currentAgent: any,
  isMentioned: boolean,
): string => {
  const others = allParticipants.filter((a: any) => a.id !== currentAgent.id);

  let addendum = `=== ACTIVE MODE: GROUP CHANNEL — "${chat.name || 'this channel'}" ===\n`;
  addendum += `You are ${currentAgent.name}. You are in a SHARED GROUP CHAT with multiple AI agents and the user.\n`;
  addendum += `OVERRIDE: Do NOT treat this as a private or one-on-one conversation. That framing does not apply here.\n`;
  addendum += `You can see what other agents say. Other agents can see what you say. Respond accordingly.\n`;

  if (chat.goal) addendum += `Channel goal: ${chat.goal}\n`;

  if (others.length > 0) {
    const otherList = others.map((a: any) => {
      const desc = a.description ?? '';
      return desc ? `${a.name} (${desc})` : a.name;
    }).join(', ');
    addendum += `Other agents in this channel: ${otherList}.\n`;
  }

  if (previousResponses.length > 0) {
    addendum += `\nWhat others have already said this turn:\n`;
    for (const r of previousResponses) {
      addendum += `• ${r.agentName}: ${r.content.slice(0, 1500)}${r.content.length > 1500 ? '...' : ''}\n`;
    }
    addendum += `\nOnly add something meaningfully different. Do not repeat or rephrase what was already covered above.\n`;
  }

  const norm: ChannelNorm = chat.norm ?? 'default';

  if (isMentioned) {
    addendum += `\n→ You were directly tagged — you MUST respond to this message. If the request is ambiguous or you're missing context, ask a brief clarifying question instead of guessing, and do NOT defer or punt to another agent: the user is talking to you specifically.`;
  } else {
    switch (norm) {
      case 'social':
        addendum += `\n[PARTICIPATION] This is a social/casual channel. ALWAYS respond — be warm, genuine, and present.`;
        if (previousResponses.length > 0) {
          addendum += ` Others already responded this turn (shown above). Do NOT ask the same question or repeat the same point — that's conversational dead weight. React to what they said, riff off their angle, or bring something genuinely new. If they asked "what brought you here?", don't ask the same thing rephrased — maybe react to their question, build on it with a more specific follow-up, or take the conversation in a different direction. Make it feel like a real group chat, not parallel monologues.`;
        } else {
          addendum += ` React, engage, ask a curious question or share your take. Keep the focus on the user and the conversation, not on describing yourself.`;
        }
        break;
      case 'work':
        addendum += `\n[PARTICIPATION] This is a focused work channel. Only respond if you have: (a) direct domain knowledge relevant to this specific topic, (b) a concrete recommendation, critique, or alternative approach, or (c) a clarifying question that unblocks progress. If you would merely summarize or rephrase what's already been said, respond with exactly: [PASS]`;
        break;
      case 'creative':
        addendum += `\n[PARTICIPATION] This is a creative channel. Respond if you have a genuinely new idea, an unexpected angle, or a fresh creative direction to add. Generic agreement or summarizing what others said should be a [PASS]. Respond with exactly: [PASS] to stay silent.`;
        break;
      default:
        addendum += `\n[PARTICIPATION] Respond if your message meaningfully advances the conversation — new information, a distinct perspective, a useful question, or a concrete pushback. If you would only restate or rephrase what's already been covered, respond with exactly: [PASS]`;
        break;
    }

    if (norm !== 'social') {
      addendum += `\nTo pass: respond with exactly [PASS] (nothing else). Your message will be silently removed.`;
    }
  }

  return addendum;
};

export const buildChannelContext = (chat: any, agents: any[]) => {
  if (!chat) return null;
  const normalized = normalizeChatRecord(chat);
  const participants = getParticipantAgents(normalized, agents);
  return {
    id: normalized.id,
    kind: normalized.kind,
    title: normalized.name,
    goal: normalized.goal ?? '',
    participants: participants.map(a => ({ id: a.id, name: a.name, description: a.description ?? '' })),
  };
};
