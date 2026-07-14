#!/usr/bin/env node
// Smoke test for the relay's mobile-companion layer: QR pairing, WebSocket
// auth, app<->mobile frame routing, streaming, offline capture queue, and
// device revocation. Uses Node's built-in WebSocket client (Node 22+).
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const repoRoot = path.resolve(import.meta.dirname, '..');
const relayScript = path.join(repoRoot, 'scripts', 'forge-relay.mjs');
const port = 18765 + Math.floor(Math.random() * 1000);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-forge-relay-ws-test-'));
const url = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}`;
const ownerToken = 'relay-ws-owner-token';
const adminToken = 'relay-ws-admin-token';

const child = spawn(process.execPath, [relayScript], {
  cwd: repoRoot,
  env: {
    ...process.env,
    FORGE_RELAY_HOST: '127.0.0.1',
    FORGE_RELAY_PORT: String(port),
    FORGE_RELAY_ROOT: root,
    FORGE_RELAY_INSTANCE_ID: 'agent-forge-test',
    FORGE_RELAY_TOKENS: `primary:Primary:${ownerToken}:agent-forge-test:primary-shortcut`,
    FORGE_RELAY_ADMIN_TOKEN: adminToken,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', chunk => { stdout += chunk.toString(); });
child.stderr.on('data', chunk => { stderr += chunk.toString(); });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

// Wraps a WebSocket in an awaitable message queue so the test can assert on
// ordered frames without callback nesting.
function connect(pathAndQuery) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}${pathAndQuery}`);
    const queue = [];
    const waiters = [];
    let closed = false;

    ws.addEventListener('message', event => {
      const frame = JSON.parse(event.data);
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else queue.push(frame);
    });
    ws.addEventListener('close', () => {
      closed = true;
      while (waiters.length) waiters.shift()(null);
    });

    const client = {
      ws,
      get closed() { return closed; },
      send: obj => ws.send(JSON.stringify(obj)),
      next: (timeoutMs = 3000) => new Promise((res2, rej2) => {
        if (queue.length) return res2(queue.shift());
        if (closed) return res2(null);
        const timer = setTimeout(() => rej2(new Error('Timed out waiting for frame')), timeoutMs);
        waiters.push(frame => { clearTimeout(timer); res2(frame); });
      }),
      waitClose: (timeoutMs = 3000) => new Promise((res2, rej2) => {
        if (closed) return res2();
        const timer = setTimeout(() => rej2(new Error('Timed out waiting for close')), timeoutMs);
        ws.addEventListener('close', () => { clearTimeout(timer); res2(); });
      }),
      close: () => ws.close(),
    };

    ws.addEventListener('open', () => resolve(client));
    ws.addEventListener('error', () => reject(new Error('WebSocket connection failed')));
  });
}

function waitForExit(process) {
  if (process.exitCode !== null || process.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => process.once('exit', resolve));
}

try {
  await waitForRelay();

  // ── Pairing ────────────────────────────────────────────────────────────────
  const notAdmin = await requestJson('/v1/pair/start', {
    method: 'POST',
    headers: { authorization: `Bearer ${ownerToken}` },
    body: '{}',
  });
  assert(notAdmin.status === 403, `expected owner token pair/start to 403, got ${notAdmin.status}`);

  const started = await requestJson('/v1/pair/start', {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}` },
    body: '{}',
  });
  assert(started.status === 200 && /^[A-Z2-9]{8}$/.test(started.json.code), `expected pairing code, got ${JSON.stringify(started.json)}`);

  const badClaim = await requestJson('/v1/pair/claim', {
    method: 'POST',
    body: JSON.stringify({ code: 'WRONGCOD', deviceName: 'Test Phone' }),
  });
  assert(badClaim.status === 400, `expected wrong code to 400, got ${badClaim.status}`);

  const claimed = await requestJson('/v1/pair/claim', {
    method: 'POST',
    body: JSON.stringify({ code: started.json.code, deviceName: 'Test Phone' }),
  });
  assert(claimed.status === 200 && claimed.json.token && claimed.json.deviceId, `expected claim to return device token, got ${JSON.stringify(claimed.json)}`);
  const deviceToken = claimed.json.token;
  const deviceId = claimed.json.deviceId;

  const reused = await requestJson('/v1/pair/claim', {
    method: 'POST',
    body: JSON.stringify({ code: started.json.code, deviceName: 'Second Phone' }),
  });
  assert(reused.status === 400, 'expected pairing code to be single-use');

  // Paired device tokens double as capture-API credentials — no separate
  // share-token setup needed for a paired phone.
  const deviceCapture = await requestJson('/v1/captures', {
    method: 'POST',
    headers: { authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify({ id: 'cap-from-device', source: 'mobile_share', bodyText: 'Captured via device token' }),
  });
  assert(deviceCapture.status === 200 && deviceCapture.json.ok, `expected device-token capture to succeed, got ${deviceCapture.status}`);
  assert(deviceCapture.json.capture.ownerId === 'primary' && deviceCapture.json.capture.shareId === 'mobile',
    'device-token capture should route to the device owner with the mobile shareId');

  // ── WS auth ────────────────────────────────────────────────────────────────
  await connect('/v1/ws?role=mobile&token=bogus').then(
    () => { throw new Error('expected bogus token WS connect to fail'); },
    () => {},
  );

  // ── Offline queue ──────────────────────────────────────────────────────────
  const mobile = await connect(`/v1/ws?role=mobile&token=${deviceToken}`);
  const welcome = await mobile.next();
  assert(welcome.type === 'welcome' && welcome.role === 'mobile' && welcome.appOnline === false,
    `expected offline mobile welcome, got ${JSON.stringify(welcome)}`);

  mobile.send({ type: 'agents.list', reqId: 'r1' });
  const offlineErr = await mobile.next();
  assert(offlineErr.type === 'error' && offlineErr.error === 'app_offline', `expected app_offline, got ${JSON.stringify(offlineErr)}`);

  mobile.send({ type: 'chat.send', reqId: 'r2', agentId: 'alexis', text: 'Queued while Mac app is closed' });
  const queued = await mobile.next();
  assert(queued.type === 'chat.queued' && queued.reqId === 'r2' && queued.captureId, `expected chat.queued, got ${JSON.stringify(queued)}`);
  const manifestPath = path.join(root, 'inbox', 'raw', 'primary', queued.captureId, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert(manifest.source === 'mobile_chat' && manifest.targetKind === 'agent' && manifest.agentId === 'alexis',
    'queued capture should carry mobile_chat routing fields');

  // ── App bridge routing ─────────────────────────────────────────────────────
  const app = await connect(`/v1/ws?role=app&token=${adminToken}`);
  const appWelcome = await app.next();
  assert(appWelcome.type === 'welcome' && appWelcome.role === 'app', `expected app welcome, got ${JSON.stringify(appWelcome)}`);
  assert(appWelcome.devices.includes(deviceId), 'app welcome should list connected devices');

  const presence = await mobile.next();
  assert(presence.type === 'presence' && presence.appOnline === true, `expected appOnline presence, got ${JSON.stringify(presence)}`);

  mobile.send({ type: 'agents.list', reqId: 'r3' });
  const forwarded = await app.next();
  assert(forwarded.type === 'agents.list' && forwarded.reqId === 'r3' && forwarded.deviceId === deviceId && forwarded.deviceName === 'Test Phone',
    `expected forwarded agents.list with device identity, got ${JSON.stringify(forwarded)}`);

  app.send({ type: 'agents.list.result', deviceId, reqId: 'r3', agents: [{ id: 'alexis', name: 'Alexis' }] });
  const agentsResult = await mobile.next();
  assert(agentsResult.type === 'agents.list.result' && agentsResult.agents?.[0]?.id === 'alexis' && !('deviceId' in agentsResult),
    `expected routed agents result without deviceId, got ${JSON.stringify(agentsResult)}`);

  // Streaming: app emits token frames then a done frame; mobile sees them in order.
  mobile.send({ type: 'chat.send', reqId: 'r4', agentId: 'alexis', chatId: 'chat-1', text: 'Hello from phone' });
  const chatSend = await app.next();
  assert(chatSend.type === 'chat.send' && chatSend.text === 'Hello from phone' && chatSend.deviceId === deviceId,
    `expected forwarded chat.send, got ${JSON.stringify(chatSend)}`);
  for (const token of ['Hel', 'lo ', 'phone']) {
    app.send({ type: 'chat.token', deviceId, reqId: 'r4', token });
  }
  app.send({ type: 'chat.done', deviceId, reqId: 'r4', chatId: 'chat-1', message: { role: 'assistant', content: 'Hello phone' } });
  let streamed = '';
  for (let i = 0; i < 3; i++) {
    const frame = await mobile.next();
    assert(frame.type === 'chat.token' && frame.reqId === 'r4', `expected chat.token, got ${JSON.stringify(frame)}`);
    streamed += frame.token;
  }
  assert(streamed === 'Hello phone', `expected streamed tokens in order, got "${streamed}"`);
  const done = await mobile.next();
  assert(done.type === 'chat.done' && done.message?.content === 'Hello phone', `expected chat.done, got ${JSON.stringify(done)}`);

  // App frames without a deviceId broadcast to every connected phone.
  app.send({ type: 'chats.updated' });
  const broadcast = await mobile.next();
  assert(broadcast.type === 'chats.updated', `expected broadcast frame, got ${JSON.stringify(broadcast)}`);

  // ── Presence + revocation ──────────────────────────────────────────────────
  app.close();
  const offline = await mobile.next();
  assert(offline.type === 'presence' && offline.appOnline === false, `expected appOnline:false presence, got ${JSON.stringify(offline)}`);

  const listed = await requestJson('/v1/devices', { headers: { authorization: `Bearer ${adminToken}` } });
  assert(listed.status === 200 && listed.json.devices?.length === 1 && !listed.json.devices[0].token,
    'device list should have one device and never expose tokens');

  const revoked = await requestJson(`/v1/devices/${deviceId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert(revoked.status === 200, `expected revocation to succeed, got ${revoked.status}`);
  await mobile.waitClose();

  await connect(`/v1/ws?role=mobile&token=${deviceToken}`).then(
    () => { throw new Error('expected revoked token WS connect to fail'); },
    () => {},
  );

  console.log('Forge Relay WebSocket smoke test passed.');
} finally {
  child.kill();
  await waitForExit(child);
  await fs.rm(root, { recursive: true, force: true });
}
