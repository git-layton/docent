import { evaluateMemoryGate, selectPrimaryToolRoute } from '../src/services/memoryGatekeeper';

type Expected = {
  shouldSave?: boolean;
  destination?: string;
  memoryType?: string;
  evidenceState?: string;
  confidence?: string;
  privacy?: string;
  route?: string | null;
  tags?: string[];
};

const cases: Array<{
  name: string;
  text: string;
  context?: Parameters<typeof evaluateMemoryGate>[0];
  expect: Expected;
}> = [
  {
    name: 'trivial gratitude is skipped',
    text: 'lol thanks',
    expect: { shouldSave: false, destination: 'skip', memoryType: 'none' },
  },
  {
    name: 'explicit personal preference goes to agent memory',
    text: 'Remember my wife prefers morning appointments.',
    expect: {
      shouldSave: true,
      destination: 'agent_memory',
      memoryType: 'preference',
      evidenceState: 'first_party',
      confidence: 'high',
      privacy: 'personal',
    },
  },
  {
    name: 'specialist Star Wars CCG note is agent memory',
    text: 'This deck failed because it had no early Force generation.',
    context: { text: '', agentId: 'star-wars-ccg', agentName: 'Star Wars CCG Specialist' },
    expect: {
      shouldSave: true,
      destination: 'agent_memory',
      memoryType: 'project_context',
      evidenceState: 'first_party',
      tags: ['star-wars-ccg'],
    },
  },
  {
    name: 'channel decision stays channel scoped',
    text: 'In this product channel, we decided Brave search is supported.',
    context: { text: '', channelId: 'product' },
    expect: {
      shouldSave: true,
      destination: 'channel_memory',
      memoryType: 'decision',
      evidenceState: 'first_party',
      confidence: 'high',
    },
  },
  {
    name: 'unsourced web claim is not verified or saved',
    text: 'Unsourced web claim: Vitamin X cures headaches.',
    expect: {
      shouldSave: false,
      destination: 'skip',
      evidenceState: 'needs_verification',
      confidence: 'low',
    },
  },
  {
    name: 'medical note is sensitive first-party memory',
    text: 'Medical note: I am allergic to penicillin.',
    expect: {
      shouldSave: true,
      destination: 'agent_memory',
      memoryType: 'medical',
      evidenceState: 'first_party',
      privacy: 'sensitive',
    },
  },
  {
    name: 'knowledge search route is selected',
    text: 'What do you remember about the Agent Forge architecture?',
    context: { text: '', enabledTools: { local_workspace: true } },
    expect: {
      shouldSave: false,
      route: 'memory_search',
    },
  },
  {
    name: 'web search route is selected',
    text: 'Look up the latest news about Brave search.',
    context: { text: '', enabledTools: { web_search: true } },
    expect: {
      shouldSave: false,
      route: 'web_search',
    },
  },
];

const failures: string[] = [];

for (const item of cases) {
  const input = { ...(item.context ?? {}), text: item.text };
  const decision = evaluateMemoryGate(input);
  const route = selectPrimaryToolRoute(decision);

  for (const [key, expected] of Object.entries(item.expect)) {
    if (key === 'tags') {
      const missing = (expected as string[]).filter(tag => !decision.tags.includes(tag));
      if (missing.length > 0) failures.push(`${item.name}: missing tags ${missing.join(', ')}`);
      continue;
    }
    if (key === 'route') {
      if (route !== expected) failures.push(`${item.name}: expected route ${expected}, got ${route}`);
      continue;
    }
    const actual = decision[key as keyof typeof decision];
    if (actual !== expected) failures.push(`${item.name}: expected ${key}=${expected}, got ${String(actual)}`);
  }
}

if (failures.length > 0) {
  console.error('Memory Gatekeeper eval failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Memory Gatekeeper eval passed (${cases.length} cases).`);
