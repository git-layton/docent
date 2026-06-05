import assert from 'node:assert/strict';
import {
  assessConversationMemory,
  validateConversationMemoryAssessment,
} from '../src/services/memoryPolicy.ts';

const cases = [];

function test(name, fn) {
  cases.push({ name, fn });
}

function assertValid(assessment) {
  assert.deepEqual(validateConversationMemoryAssessment(assessment), []);
}

test('skips trivial acknowledgements without notification', () => {
  const assessment = assessConversationMemory({
    question: 'ok',
    answer: 'Sounds good.',
  });

  assertValid(assessment);
  assert.equal(assessment.shouldSave, false);
  assert.equal(assessment.level, 'skip');
  assert.equal(assessment.notification, 'none');
  assert.equal(assessment.reason, 'trivial acknowledgement');
});

test('skips short casual/silly exchanges unless explicit memory is requested', () => {
  const assessment = assessConversationMemory({
    question: 'lol random thought',
    answer: 'That is funny, but probably not something durable.',
  });

  assertValid(assessment);
  assert.equal(assessment.shouldSave, false);
  assert.equal(assessment.level, 'skip');
  assert.equal(assessment.notification, 'none');
});

test('saves durable preferences quietly as background memory', () => {
  const assessment = assessConversationMemory({
    question: 'I prefer concise direct answers when we are working through release bugs.',
    answer: 'Got it. I will keep release debugging answers concise and focused on the next useful action.',
  });

  assertValid(assessment);
  assert.equal(assessment.shouldSave, true);
  assert.equal(assessment.level, 'background');
  assert.equal(assessment.notification, 'none');
  assert.ok(assessment.tags.includes('durable-user-signal'));
  assert.ok(assessment.tags.includes('memory-background'));
});

test('explicit remember requests save and notify', () => {
  const assessment = assessConversationMemory({
    question: 'Remember that I prefer concise direct answers during release debugging.',
    answer: 'Memory updated. I will use concise direct answers during release debugging.',
  });

  assertValid(assessment);
  assert.equal(assessment.shouldSave, true);
  assert.equal(assessment.level, 'explicit');
  assert.equal(assessment.notification, 'toast');
  assert.ok(assessment.tags.includes('explicit-memory'));
  assert.ok(assessment.tags.includes('memory-explicit'));
});

test('image attachments are saved quietly as multimodal context', () => {
  const assessment = assessConversationMemory({
    question: 'What is going on in this screenshot?',
    answer: 'The screenshot shows a settings panel with a model connection warning.',
    attachments: [{ name: 'settings.png', type: 'image/png', isImage: true }],
  });

  assertValid(assessment);
  assert.equal(assessment.shouldSave, true);
  assert.equal(assessment.level, 'background');
  assert.equal(assessment.notification, 'none');
  assert.ok(assessment.tags.includes('multimodal-input'));
});

test('project image context becomes notable when it has durable release signal', () => {
  const assessment = assessConversationMemory({
    question: 'Use this screenshot for the project release bug we are fixing.',
    answer: 'I will use the screenshot as context for the release bug and track the fix against that UI state.',
    attachments: [{ name: 'release-bug.png', type: 'image/png', isImage: true }],
  });

  assertValid(assessment);
  assert.equal(assessment.shouldSave, true);
  assert.equal(assessment.level, 'notable');
  assert.equal(assessment.notification, 'toast');
  assert.ok(assessment.tags.includes('multimodal-input'));
  assert.ok(assessment.tags.includes('memory-notable'));
});

test('multi-agent channel work is notable and channel-scoped', () => {
  const assessment = assessConversationMemory({
    question: 'We need a release plan for this integration and the likely risks.',
    answer: 'Plan: validate model setup, verify search citations, run build checks, then package the release.',
    chatKind: 'channel',
    contributions: ['[Logic Checker]\nRisk: missing model validation could break first run.'],
  });

  assertValid(assessment);
  assert.equal(assessment.shouldSave, true);
  assert.equal(assessment.level, 'notable');
  assert.equal(assessment.notification, 'toast');
  assert.ok(assessment.tags.includes('channel-memory'));
  assert.ok(assessment.tags.includes('multi-agent'));
});

test('validation catches impossible saved skip state', () => {
  const errors = validateConversationMemoryAssessment({
    shouldSave: true,
    level: 'skip',
    notification: 'none',
    reason: 'bad state',
    tags: ['conversation'],
    score: 3,
  });

  assert.ok(errors.some(error => error.includes('Saved memories cannot use level "skip"')));
});

test('validation catches noisy background memory', () => {
  const errors = validateConversationMemoryAssessment({
    shouldSave: true,
    level: 'background',
    notification: 'toast',
    reason: 'bad state',
    tags: ['conversation', 'memory-background'],
    score: 3,
  });

  assert.ok(errors.some(error => error.includes('Background saves must be silent')));
});

test('validation catches duplicate tags and missing explicit tag', () => {
  const errors = validateConversationMemoryAssessment({
    shouldSave: true,
    level: 'explicit',
    notification: 'toast',
    reason: 'bad state',
    tags: ['conversation', 'conversation', 'memory-explicit'],
    score: 7,
  });

  assert.ok(errors.some(error => error.includes('Tags must be unique')));
  assert.ok(errors.some(error => error.includes('explicit-memory tag')));
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
  console.error(`${failures} memory policy test${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}

console.log(`${cases.length} memory policy tests passed.`);
