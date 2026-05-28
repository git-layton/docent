#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const repoRoot = path.resolve(import.meta.dirname, '..');
const relayScript = path.join(repoRoot, 'scripts', 'forge-relay.mjs');
const port = 18765 + Math.floor(Math.random() * 1000);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-forge-relay-test-'));
const url = `http://127.0.0.1:${port}`;
const token = 'relay-smoke-owner-token';
const adminToken = 'relay-smoke-admin-token';

const child = spawn(process.execPath, [relayScript], {
  cwd: repoRoot,
  env: {
    ...process.env,
    FORGE_RELAY_HOST: '127.0.0.1',
    FORGE_RELAY_PORT: String(port),
    FORGE_RELAY_ROOT: root,
    FORGE_RELAY_INSTANCE_ID: 'agent-forge-test',
    FORGE_RELAY_TOKENS: `primary:Primary:${token}:agent-forge-test:primary-shortcut`,
    FORGE_RELAY_ADMIN_TOKEN: adminToken,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', chunk => { stdout += chunk.toString(); });
child.stderr.on('data', chunk => { stderr += chunk.toString(); });

async function waitForRelay() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return;
    } catch {
      // Keep waiting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Relay did not start.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

async function requestJson(pathname, options = {}) {
  const res = await fetch(`${url}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function waitForExit(process) {
  if (process.exitCode !== null || process.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => process.once('exit', resolve));
}

try {
  await waitForRelay();

  const unauthorized = await requestJson('/v1/captures');
  assert(unauthorized.status === 401, `expected unauthorized request to return 401, got ${unauthorized.status}`);

  const created = await requestJson('/v1/captures', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      id: 'cap-smoke-test',
      source: 'relay_smoke_test',
      kind: 'file',
      title: 'Relay smoke test',
      bodyText: 'Save a raw attachment and manifest.',
      attachments: [{
        name: 'note.txt',
        mimeType: 'text/plain',
        dataBase64: 'aGVsbG8gZm9yZ2U=',
      }],
    }),
  });
  assert(created.status === 200 && created.json.ok, `expected capture create ok, got ${created.status}: ${JSON.stringify(created.json)}`);
  assert(created.json.capture.ownerId === 'primary', 'expected owner route to tag capture as primary');

  const manifestPath = path.join(root, 'inbox', 'raw', 'primary', 'cap-smoke-test', 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert(!manifest.attachments[0].dataBase64 && !manifest.attachments[0].dataUrl, 'manifest should not embed base64 attachment data');
  assert(manifest.attachments[0].path, 'manifest should store attachment file path');
  assert((await fs.readFile(manifest.attachments[0].path, 'utf8')) === 'hello forge', 'attachment bytes were not preserved');

  const duplicate = await requestJson('/v1/captures', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ id: 'cap-smoke-test', title: 'Duplicate' }),
  });
  assert(duplicate.status === 200 && duplicate.json.duplicate === true, 'expected duplicate capture to be detected');

  const listed = await requestJson('/v1/captures', {
    headers: { authorization: `Bearer ${token}` },
  });
  assert(listed.status === 200 && listed.json.captures?.length === 1, 'expected owner token to list one capture');

  const patched = await requestJson('/v1/captures/cap-smoke-test', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: 'saved', summary: 'Smoke test saved.' }),
  });
  assert(patched.status === 200 && patched.json.capture?.status === 'saved', 'expected patch to update capture status');

  const adminListed = await requestJson('/v1/captures?owner=all', {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert(adminListed.status === 200 && adminListed.json.captures?.length === 1, 'expected admin token to list all captures');

  const badAttachment = await requestJson('/v1/captures', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      id: 'cap-bad-base64',
      attachments: [{ name: 'bad.txt', mimeType: 'text/plain', dataBase64: 'not valid?' }],
    }),
  });
  assert(badAttachment.status === 400, `expected invalid attachment base64 to return 400, got ${badAttachment.status}`);

  console.log('Forge Relay smoke test passed.');
} finally {
  child.kill();
  await waitForExit(child);
  await fs.rm(root, { recursive: true, force: true });
}
