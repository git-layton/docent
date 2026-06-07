export type ChannelKind = 'dm' | 'channel' | 'local';

export interface ChannelChat {
  id: string;
  folderId?: string;
  name: string;
  kind?: ChannelKind;
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

const textForAgent = (agent: any) =>
  `${agent?.name ?? ''} ${agent?.description ?? ''} ${agent?.prompt ?? ''}`.toLowerCase();

const hasAny = (haystack: string, needles: string[]) => needles.some(n => haystack.includes(n));

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

  const lower = input.toLowerCase();
  const selected = new Map<string, any>();
  if (primary) selected.set(primary.id, primary);

  for (const agent of participants) {
    const name = String(agent.name ?? '').toLowerCase();
    const firstWord = name.split(/\s+/)[0];
    if ((name && lower.includes(name)) || (firstWord && lower.includes(`@${firstWord}`))) {
      selected.set(agent.id, agent);
    }
  }

  for (const agent of participants) {
    const agentText = textForAgent(agent);
    if (
      hasAny(lower, ['logic', 'check', 'contradiction', 'validate', 'risk', 'flaw', 'holes'])
      && hasAny(agentText, ['logic', 'critic', 'checker', 'validate', 'risk'])
    ) selected.set(agent.id, agent);

    if (
      hasAny(lower, ['strategy', 'strategic', 'plan', 'approach', 'tradeoff', 'win condition'])
      && hasAny(agentText, ['strategy', 'strategist', 'planner', 'tradeoff'])
    ) selected.set(agent.id, agent);

    if (
      hasAny(lower, ['research', 'source', 'verify', 'evidence', 'current', 'latest'])
      && agent?.tools?.web_search
    ) selected.set(agent.id, agent);
  }

  return Array.from(selected.values());
};

export const buildChannelPromptAddendum = (
  chat: any,
  allParticipants: any[],
  previousResponses: Array<{ agentName: string; content: string }>,
  currentAgent: any,
): string => {
  const others = allParticipants.filter((a: any) => a.id !== currentAgent.id);
  let addendum = `\n\n[CHANNEL] You are ${currentAgent.name} in a multi-agent channel: "${chat.name || 'this channel'}".`;
  if (chat.goal) addendum += ` Channel goal: ${chat.goal}`;
  if (others.length > 0) addendum += ` Other participants: ${others.map((a: any) => a.name).join(', ')}.`;
  if (previousResponses.length > 0) {
    addendum += `\n\nOther agents already responded this turn:\n${previousResponses.map(r => `• ${r.agentName}: ${r.content.slice(0, 300)}${r.content.length > 300 ? '...' : ''}`).join('\n')}`;
    addendum += `\n\nOnly add something meaningfully different. Do not repeat or rephrase what was already covered above.`;
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
