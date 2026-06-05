import assert from 'node:assert/strict';
import {
  assessMemoryGatekeeper,
  mergeModelGatekeeperSuggestion,
  validateMemoryGatekeeperDecision,
} from '../src/services/memoryGatekeeper.ts';
import { routeToolForMessage } from '../src/services/toolRouter.ts';

const cases = [];

function test(name, fn) {
  cases.push({ name, fn });
}

function assertValid(decision) {
  assert.deepEqual(validateMemoryGatekeeperDecision(decision), []);
}

test('skips trivial chat and refuses a memory destination', () => {
  const decision = assessMemoryGatekeeper({
    sourceKind: 'conversation',
    text: 'ok',
    answer: 'Sounds good.',
    chatKind: 'dm',
  });

  assertValid(decision);
  assert.equal(decision.shouldSave, false);
  assert.equal(decision.destination, 'skip');
  assert.equal(decision.level, 'skip');
});

test('saves explicit user preference as agent memory with first-party verification', () => {
  const decision = assessMemoryGatekeeper({
    sourceKind: 'conversation',
    text: 'Remember that I prefer concise direct answers during release debugging.',
    answer: 'Memory updated.',
    chatKind: 'dm',
  });

  assertValid(decision);
  assert.equal(decision.shouldSave, true);
  assert.equal(decision.destination, 'agent_memory');
  assert.equal(decision.memoryType, 'preference');
  assert.equal(decision.evidenceState, 'mixed');
  assert.equal(decision.verification, 'needs_verification');
  assert.equal(decision.confidence, 'high');
});

test('routes multi-agent channel decisions into channel memory', () => {
  const decision = assessMemoryGatekeeper({
    sourceKind: 'conversation',
    text: 'We decided the release channel must use Brave search and source-required answers.',
    answer: 'I will treat that as the channel release requirement.',
    chatKind: 'channel',
    contributions: ['[Logic Checker]\nRisk: unsourced answers must abstain.'],
  });

  assertValid(decision);
  assert.equal(decision.shouldSave, true);
  assert.equal(decision.destination, 'channel_memory');
  assert.equal(decision.memoryType, 'decision');
  assert.ok(decision.tags.includes('channel_memory'));
  assert.ok(decision.tags.includes('multi-agent'));
});

test('marks medical memories sensitive and unverified', () => {
  const decision = assessMemoryGatekeeper({
    sourceKind: 'conversation',
    text: 'Remember that my medication list may affect travel planning.',
    answer: 'I will treat that as sensitive and verify details before relying on it.',
    chatKind: 'dm',
  });

  assertValid(decision);
  assert.equal(decision.shouldSave, true);
  assert.equal(decision.memoryType, 'medical');
  assert.equal(decision.sensitivity, 'high');
  assert.equal(decision.verification, 'needs_verification');
  assert.equal(decision.confidence, 'low');
});

test('classifies routed captures with capture-backed evidence', () => {
  const decision = assessMemoryGatekeeper({
    sourceKind: 'capture',
    text: 'PDF from school with the field trip permission deadline.',
    explicitTargetKind: 'library',
    urls: ['https://school.example/field-trip'],
    attachments: [{ name: 'permission.pdf', mimeType: 'application/pdf' }],
    captureId: 'cap-1',
  });

  assertValid(decision);
  assert.equal(decision.shouldSave, true);
  assert.equal(decision.destination, 'library');
  assert.equal(decision.memoryType, 'todo');
  assert.equal(decision.evidenceState, 'capture_backed');
  assert.equal(decision.verification, 'partially_verified');
});

test('routes explicit local memory questions to Knowledge Search', () => {
  const route = routeToolForMessage({
    message: 'What did we decide about the Brave search integration?',
    agentTools: { local_workspace: true, web_search: true },
  });

  assert.equal(route.tool, 'Knowledge Search');
  assert.equal(route.forced, false);
});

test('routes current sourced questions to Web Search', () => {
  const route = routeToolForMessage({
    message: 'Look up the latest Brave Search API docs and cite sources.',
    agentTools: { local_workspace: true, web_search: true },
  });

  assert.equal(route.tool, 'Web Search');
});

test('model suggestions can refine labels but cannot upgrade grounding authority', () => {
  const local = assessMemoryGatekeeper({
    sourceKind: 'research',
    text: 'Latest guidance on retrieval grounded citations.',
    urls: ['https://example.com/source'],
  });
  const merged = mergeModelGatekeeperSuggestion(local, {
    memoryType: 'decision',
    reason: 'Model thinks this is verified forever.',
    tags: ['model-suggested', 'verified'],
    verification: 'verified',
    confidence: 'high',
  });

  assertValid(merged);
  assert.equal(merged.memoryType, 'decision');
  assert.equal(merged.verification, local.verification);
  assert.equal(merged.confidence, local.confidence);
  assert.ok(merged.tags.includes('model-suggested'));
});

test('validation rejects impossible verified source-backed state', () => {
  const decision = assessMemoryGatekeeper({
    sourceKind: 'research',
    text: 'Source-backed research note.',
    urls: ['https://example.com'],
  });
  const errors = validateMemoryGatekeeperDecision({ ...decision, verification: 'verified' });

  assert.ok(errors.some(error => error.includes('Source-backed memories')));
});

let failures = 0;

for (const { name, fn } of cases) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

if (failures > 0) {
  console.error(`${failures} memory gatekeeper test${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}

console.log(`${cases.length} memory gatekeeper tests passed.`);
