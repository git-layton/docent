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

export const buildChannelPromptAddendum = (
  chat: any,
  allParticipants: any[],
  previousResponses: Array<{ agentName: string; content: string }>,
  currentAgent: any,
  isMentioned: boolean,
): string => {
  const others = allParticipants.filter((a: any) => a.id !== currentAgent.id);

  let addendum = `=== GROUP CHANNEL: "${chat.name || 'this channel'}" ===\n`;
  addendum += `You are ${currentAgent.name}. This is a multi-agent group chat — you are NOT in a one-on-one conversation.\n`;

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
    addendum += `\n→ You were directly mentioned — you MUST respond to this message.`;
  } else {
    switch (norm) {
      case 'social':
        addendum += `\n[PARTICIPATION] This is a social/casual channel. ALWAYS respond to every message. Be warm and engaged — ask follow-up questions, react to what's been said, share your genuine perspective. Do not make it about yourself; keep the focus on the other people and the conversation.`;
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
