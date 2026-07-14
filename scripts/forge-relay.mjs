#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// Single source of truth for capture shape — write fields and patchable fields
// are derived from this so adding a new field only requires one edit here.
const CAPTURE_SCHEMA = {
  write: ['id', 'ownerId', 'ownerLabel', 'instanceId', 'shareId', 'deviceName',
          'source', 'kind', 'status', 'createdAt', 'updatedAt', 'title',
          'bodyText', 'urls', 'attachments', 'note', 'channelHint', 'channelId',
          'agentId', 'targetKind', 'tags', 'rawPath', 'processedPaths', 'error', 'summary'],
  patch:  ['status', 'ownerLabel', 'instanceId', 'shareId', 'deviceName', 'title',
           'bodyText', 'note', 'channelHint', 'channelId', 'agentId', 'targetKind',
           'tags', 'processedPaths', 'summary', 'error'],
};

const PORT = Number(process.env.FORGE_RELAY_PORT || 8765);
const HOST = process.env.FORGE_RELAY_HOST || '0.0.0.0';
const ROOT = expandHome(process.env.FORGE_RELAY_ROOT || '~/AgentForge');
const RAW_ROOT = path.join(ROOT, 'inbox', 'raw');
const DEVICES_PATH = path.join(ROOT, 'relay', 'devices.json');
const MAX_WS_MESSAGE_BYTES = Number(process.env.FORGE_RELAY_MAX_WS_MESSAGE_BYTES || 16 * 1024 * 1024);
const PAIR_CODE_TTL_MS = Number(process.env.FORGE_RELAY_PAIR_TTL_MS || 10 * 60 * 1000);
const INSTANCE_ID = sanitizeId(process.env.FORGE_RELAY_INSTANCE_ID || 'agent-forge-local', 'agent-forge-local');
const MAX_BODY_BYTES = Number(process.env.FORGE_RELAY_MAX_BODY_BYTES || 60 * 1024 * 1024);
const OWNER_TOKENS = parseOwnerTokens(process.env.FORGE_RELAY_TOKENS || '');
const ADMIN_TOKEN = process.env.FORGE_RELAY_ADMIN_TOKEN || '';

if (OWNER_TOKENS.size === 0) {
  console.error('FORGE_RELAY_TOKENS is required, for example: primary:Primary:token:agent-forge-home:primary-shortcut');
  process.exit(1);
}

function expandHome(input) {
  return input.startsWith('~/') ? path.join(os.homedir(), input.slice(2)) : input;
}

function parseOwnerTokens(raw) {
  const out = new Map();
  for (const pair of raw.split(',').map(v => v.trim()).filter(Boolean)) {
    const parts = pair.split(':').map(v => v.trim());
    if (parts.length < 2) continue;
    const ownerId = sanitizeId(parts[0], 'primary');
    const ownerLabel = parts.length >= 3 ? (parts[1] || ownerId) : ownerId;
    const token = parts.length >= 3 ? parts[2] : parts[1];
    const instanceId = sanitizeId(parts[3] || INSTANCE_ID, INSTANCE_ID);
    const shareId = sanitizeId(parts[4] || `${ownerId}-shortcut`, `${ownerId}-shortcut`);
    if (ownerId && token) out.set(token, { ownerId, ownerLabel, instanceId, shareId });
  }
  return out;
}

function sanitizeId(input, fallback = '') {
  const safe = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return safe || fallback;
}

function sanitizeFileName(input, fallback = 'attachment') {
  const safe = String(input || fallback)
    .replace(/[^a-zA-Z0-9._ -]+/g, '_')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return safe || fallback;
}

function decodeAttachmentBase64(rawData) {
  const base64 = String(rawData || '').includes(',') ? String(rawData || '').split(',').pop() : String(rawData || '');
  const normalized = base64.replace(/\s+/g, '');
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    const error = new Error('Attachment data must be valid base64');
    error.statusCode = 400;
    throw error;
  }
  return Buffer.from(normalized, 'base64');
}

function nowId() {
  return `cap-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// Constant-time compare so the admin token can't be brute-forced via response timing (length is
// still observable, which is standard/acceptable). Owner tokens are a Map hash-lookup, not a char
// compare, so they don't leak a prefix the same way.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function authOwner(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) return null;
  if (ADMIN_TOKEN && safeEqual(token, ADMIN_TOKEN)) return { ownerId: 'all', admin: true };
  const route = OWNER_TOKENS.get(token);
  return route ? { ...route, admin: false } : null;
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error('Request body exceeds relay limit');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Request body must be valid JSON');
    error.statusCode = 400;
    throw error;
  }
}

// CORS is permissive: auth is bearer tokens (never cookies), so browsers get no
// ambient credentials to abuse, and non-browser clients ignore CORS entirely.
// This lets browser-based clients (e.g. the mobile app's web preview) talk to
// the relay.
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
};

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    ...CORS_HEADERS,
  });
  res.end(body);
}

async function ensureDirs(ownerId) {
  await fs.mkdir(path.join(RAW_ROOT, ownerId), { recursive: true });
}

async function writeCapture(route, payload) {
  const ownerId = route.ownerId;
  await ensureDirs(ownerId);
  const captureId = sanitizeId(payload.id, nowId());
  const captureDir = path.join(RAW_ROOT, ownerId, captureId);
  const manifestPath = path.join(captureDir, 'manifest.json');

  try {
    const existing = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    return { duplicate: true, capture: existing };
  } catch {
    // New capture.
  }

  const attachmentsDir = path.join(captureDir, 'attachments');
  await fs.mkdir(attachmentsDir, { recursive: true });

  const attachments = [];
  let totalBytes = 0;
  for (const [idx, attachment] of (payload.attachments || []).slice(0, 25).entries()) {
    const rawData = String(attachment.dataBase64 || attachment.data || '');
    if (!rawData) continue;
    const bytes = decodeAttachmentBase64(rawData);
    totalBytes += bytes.length;
    if (totalBytes > 50 * 1024 * 1024) throw new Error('Capture attachments exceed 50MB limit');

    const name = attachment.name || `attachment-${idx + 1}`;
    const mimeType = attachment.mimeType || attachment.type || 'application/octet-stream';
    const fileName = `${idx + 1}-${sanitizeFileName(name)}`;
    const filePath = path.join(attachmentsDir, fileName);
    await fs.writeFile(filePath, bytes);
    attachments.push({
      id: `att-${idx + 1}-${Date.now()}`,
      name,
      mimeType,
      size: bytes.length,
      path: filePath,
    });
  }

  const now = Date.now();
  const capture = {
    id: captureId,
    ownerId,
    ownerLabel: payload.ownerLabel || route.ownerLabel || ownerId,
    instanceId: payload.instanceId || route.instanceId || INSTANCE_ID,
    shareId: payload.shareId || route.shareId || '',
    deviceName: payload.deviceName || '',
    source: payload.source || 'ios_shortcut',
    kind: payload.kind || inferKind(payload, attachments),
    status: payload.status || 'received',
    createdAt: Number(payload.createdAt || now),
    updatedAt: now,
    title: payload.title || deriveTitle(payload, attachments),
    bodyText: payload.bodyText || payload.text || '',
    urls: Array.isArray(payload.urls) ? payload.urls : extractUrls(payload.bodyText || payload.text || ''),
    attachments,
    note: payload.note || '',
    channelHint: payload.channelHint || '',
    channelId: payload.channelId || '',
    agentId: payload.agentId || '',
    targetKind: payload.targetKind || '',
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    rawPath: captureDir,
    processedPaths: [],
    error: '',
  };

  await fs.writeFile(manifestPath, JSON.stringify(capture, null, 2));
  return { duplicate: false, capture };
}

function extractUrls(text) {
  return Array.from(new Set(String(text || '').match(/https?:\/\/[^\s)]+/g) || []));
}

function inferKind(payload, attachments) {
  if (attachments.length > 1) return 'mixed';
  const mime = attachments[0]?.mimeType || '';
  if (mime.startsWith('image/')) return payload.bodyText || payload.text ? 'mixed' : 'image';
  if (mime.startsWith('audio/')) return payload.bodyText || payload.text ? 'mixed' : 'audio';
  if (attachments[0]) return payload.bodyText || payload.text ? 'mixed' : 'file';
  return extractUrls(payload.bodyText || payload.text || '').length ? 'url' : 'text';
}

function deriveTitle(payload, attachments) {
  const text = String(payload.bodyText || payload.text || payload.note || '').trim();
  if (text) return text.split(/\n/)[0].slice(0, 80);
  if (attachments.length === 1) return attachments[0].name;
  if (attachments.length > 1) return `${attachments.length} files`;
  return 'Inbox capture';
}

async function listCaptures(auth, queryOwner) {
  const owners = auth.admin && queryOwner === 'all'
    ? (await fs.readdir(RAW_ROOT, { withFileTypes: true }).catch(() => []))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    : [auth.ownerId];

  const captures = [];
  for (const ownerId of owners) {
    const ownerDir = path.join(RAW_ROOT, ownerId);
    const entries = await fs.readdir(ownerDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = path.join(ownerDir, entry.name, 'manifest.json');
      try {
        captures.push(JSON.parse(await fs.readFile(manifest, 'utf8')));
      } catch {
        // Ignore partial captures.
      }
    }
  }
  captures.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return captures;
}

async function patchCapture(auth, captureId, patch) {
  const ownerIds = auth.admin
    ? (await fs.readdir(RAW_ROOT, { withFileTypes: true }).catch(() => []))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    : [auth.ownerId];

  for (const ownerId of ownerIds) {
    const manifestPath = path.join(RAW_ROOT, ownerId, sanitizeId(captureId), 'manifest.json');
    try {
      const capture = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      for (const key of CAPTURE_SCHEMA.patch) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) capture[key] = patch[key];
      }
      capture.updatedAt = Date.now();
      await fs.writeFile(manifestPath, JSON.stringify(capture, null, 2));
      return capture;
    } catch {
      // Keep searching.
    }
  }
  return null;
}

// ── Paired mobile devices ─────────────────────────────────────────────────────
// devices.json is the durable registry of phones paired via QR code. Tokens live
// here (not in the launchd env file) so pairing works without a relay restart.

const devicesByToken = new Map();

async function loadDevices() {
  try {
    const parsed = JSON.parse(await fs.readFile(DEVICES_PATH, 'utf8'));
    for (const device of parsed.devices || []) {
      if (device?.token && device?.id) devicesByToken.set(device.token, device);
    }
  } catch {
    // First run — no devices yet.
  }
}

async function persistDevices() {
  await fs.mkdir(path.dirname(DEVICES_PATH), { recursive: true });
  const payload = JSON.stringify({ devices: Array.from(devicesByToken.values()) }, null, 2);
  await fs.writeFile(DEVICES_PATH, payload, { mode: 0o600 });
}

function publicDevice(device) {
  const { token, ...rest } = device;
  return { ...rest, online: mobileConns.has(device.id) };
}

// ── Pairing codes (one-time, short-lived, claimed by the phone) ───────────────

const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const pairCodes = new Map(); // code -> { ownerId, ownerLabel, expiresAt }
let claimAttempts = { count: 0, resetAt: 0 };

function generatePairCode() {
  let code = '';
  for (let i = 0; i < 8; i++) code += PAIR_ALPHABET[crypto.randomInt(PAIR_ALPHABET.length)];
  return code;
}

function prunePairCodes() {
  const now = Date.now();
  for (const [code, entry] of pairCodes) {
    if (entry.expiresAt <= now) pairCodes.delete(code);
  }
}

function claimRateLimited() {
  const now = Date.now();
  if (now > claimAttempts.resetAt) claimAttempts = { count: 0, resetAt: now + 5 * 60 * 1000 };
  claimAttempts.count += 1;
  return claimAttempts.count > 10;
}

function isLoopback(req) {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

// ── WebSocket server (RFC 6455, stdlib only) ──────────────────────────────────
// The relay is spawned by launchd from the app bundle with no node_modules, so
// framing is implemented here rather than pulled in via the `ws` package.

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WsConnection {
  constructor(socket, head, { onMessage, onClose }) {
    this.socket = socket;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    this.fragments = [];
    this.fragmentsBytes = 0;
    this.closed = false;
    this.isAlive = true;

    socket.setNoDelay(true);
    socket.on('data', chunk => this.#feed(chunk));
    socket.on('error', () => this.destroy());
    socket.on('close', () => this.destroy());

    this.pingTimer = setInterval(() => {
      if (!this.isAlive) return this.destroy();
      this.isAlive = false;
      this.#sendFrame(0x9, Buffer.alloc(0));
    }, 30_000);
    this.pingTimer.unref?.();

    if (this.buffer.length) this.#drain();
  }

  send(obj) {
    if (this.closed) return;
    this.#sendFrame(0x1, Buffer.from(JSON.stringify(obj)));
  }

  close(code = 1000) {
    if (this.closed) return;
    const body = Buffer.alloc(2);
    body.writeUInt16BE(code);
    this.#sendFrame(0x8, body);
    this.socket.end();
    setTimeout(() => this.destroy(), 2000).unref?.();
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pingTimer);
    this.socket.destroy();
    this.onClose?.();
  }

  #sendFrame(opcode, payload) {
    if (this.closed || this.socket.destroyed) return;
    let header;
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, payload.length]);
    } else if (payload.length < 65_536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  #feed(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    this.#drain();
  }

  #drain() {
    while (!this.closed) {
      const frame = this.#parseFrame();
      if (!frame) return;
      this.isAlive = true;
      const { fin, opcode, payload } = frame;

      if (opcode === 0x8) { this.close(); return; }
      if (opcode === 0x9) { this.#sendFrame(0xA, payload); continue; }
      if (opcode === 0xA) continue;
      if (opcode !== 0x0 && opcode !== 0x1 && opcode !== 0x2) { this.close(1002); return; }

      this.fragments.push(payload);
      this.fragmentsBytes += payload.length;
      if (this.fragmentsBytes > MAX_WS_MESSAGE_BYTES) { this.close(1009); return; }
      if (!fin) continue;

      const message = Buffer.concat(this.fragments).toString('utf8');
      this.fragments = [];
      this.fragmentsBytes = 0;
      try {
        this.onMessage?.(JSON.parse(message));
      } catch {
        this.send({ type: 'error', error: 'invalid_json' });
      }
    }
  }

  #parseFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let length = buf[1] & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (buf.length < offset + 2) return null;
      length = buf.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buf.length < offset + 8) return null;
      const big = buf.readBigUInt64BE(offset);
      if (big > BigInt(MAX_WS_MESSAGE_BYTES)) { this.close(1009); return null; }
      length = Number(big);
      offset += 8;
    }
    if (length > MAX_WS_MESSAGE_BYTES) { this.close(1009); return null; }

    // Clients MUST mask frames per RFC 6455 §5.1.
    if (!masked) { this.close(1002); return null; }
    if (buf.length < offset + 4 + length) return null;
    const mask = buf.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.from(buf.subarray(offset, offset + length));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

    this.buffer = buf.subarray(offset + length);
    return { fin, opcode, payload };
  }
}

// ── Connection hub: one desktop app, many paired phones ───────────────────────
// The desktop app connects out to the relay (role=app, admin token, loopback
// only) and owns all chat state + model execution. Phones (role=mobile, device
// token) send request frames; the relay injects deviceId and forwards to the
// app, then routes app replies back by deviceId. If the app is offline,
// chat.send falls back to the existing capture inbox so nothing is lost.

let appConn = null;
const mobileConns = new Map(); // deviceId -> WsConnection

const MOBILE_FRAME_TYPES = new Set(['chat.send', 'chat.cancel', 'agents.list', 'history.list', 'history.get']);

function broadcastToMobiles(frame) {
  for (const conn of mobileConns.values()) conn.send(frame);
}

function handleAppFrame(frame) {
  if (!frame || typeof frame !== 'object') return;
  if (frame.deviceId) {
    const target = mobileConns.get(frame.deviceId);
    if (!target) return;
    const { deviceId, ...rest } = frame;
    target.send(rest);
    return;
  }
  broadcastToMobiles(frame);
}

async function handleMobileFrame(device, conn, frame) {
  const type = frame?.type;
  if (type === 'ping') return conn.send({ type: 'pong', ts: Date.now() });
  if (!MOBILE_FRAME_TYPES.has(type)) {
    return conn.send({ type: 'error', reqId: frame?.reqId, error: 'unknown_type' });
  }
  if (appConn) {
    appConn.send({ ...frame, deviceId: device.id, deviceName: device.name });
    return;
  }
  if (type === 'chat.send') {
    // App is closed — queue the message as an inbox capture so it is processed
    // the next time the desktop app opens.
    try {
      const route = { ownerId: device.ownerId, ownerLabel: device.name, instanceId: INSTANCE_ID, shareId: 'mobile' };
      const { capture } = await writeCapture(route, {
        source: 'mobile_chat',
        kind: 'text',
        bodyText: String(frame.text || ''),
        agentId: String(frame.agentId || ''),
        channelId: String(frame.chatId || ''),
        targetKind: 'agent',
        deviceName: device.name,
      });
      conn.send({ type: 'chat.queued', reqId: frame.reqId, captureId: capture.id });
    } catch (error) {
      conn.send({ type: 'error', reqId: frame.reqId, error: error?.message || String(error) });
    }
    return;
  }
  conn.send({ type: 'error', reqId: frame?.reqId, error: 'app_offline' });
}

function attachAppSocket(socket, head) {
  appConn?.close(1012);
  const conn = new WsConnection(socket, head, {
    onMessage: frame => handleAppFrame(frame),
    onClose: () => {
      if (appConn === conn) {
        appConn = null;
        broadcastToMobiles({ type: 'presence', appOnline: false });
      }
    },
  });
  appConn = conn;
  conn.send({ type: 'welcome', role: 'app', instanceId: INSTANCE_ID, devices: Array.from(mobileConns.keys()) });
  broadcastToMobiles({ type: 'presence', appOnline: true });
}

function attachMobileSocket(device, socket, head) {
  mobileConns.get(device.id)?.close(1012);
  const conn = new WsConnection(socket, head, {
    onMessage: frame => { handleMobileFrame(device, conn, frame).catch(() => {}); },
    onClose: () => {
      if (mobileConns.get(device.id) === conn) {
        mobileConns.delete(device.id);
        appConn?.send({ type: 'device.disconnected', deviceId: device.id, deviceName: device.name });
      }
    },
  });
  mobileConns.set(device.id, conn);
  device.lastSeenAt = Date.now();
  persistDevices().catch(() => {});
  conn.send({ type: 'welcome', role: 'mobile', deviceId: device.id, instanceId: INSTANCE_ID, appOnline: Boolean(appConn) });
  appConn?.send({ type: 'device.connected', deviceId: device.id, deviceName: device.name });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }
    if (req.url === '/healthz') return send(res, 200, { ok: true });

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // Pairing claim is the one unauthenticated endpoint: the phone trades a
    // short-lived one-time code (shown as a QR on the Mac) for a device token.
    if (req.method === 'POST' && url.pathname === '/v1/pair/claim') {
      if (claimRateLimited()) return send(res, 429, { ok: false, error: 'Too many pairing attempts, try again later' });
      prunePairCodes();
      const body = await readJsonBody(req);
      const code = String(body.code || '').trim().toUpperCase();
      const entry = pairCodes.get(code);
      if (!entry) return send(res, 400, { ok: false, error: 'Invalid or expired pairing code' });
      pairCodes.delete(code);
      const device = {
        id: `dev-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        name: String(body.deviceName || 'Mobile device').slice(0, 60),
        ownerId: entry.ownerId,
        token: crypto.randomBytes(24).toString('hex'),
        createdAt: Date.now(),
        lastSeenAt: 0,
      };
      devicesByToken.set(device.token, device);
      await persistDevices();
      return send(res, 200, {
        ok: true,
        deviceId: device.id,
        deviceName: device.name,
        token: device.token,
        ownerId: device.ownerId,
        instanceId: INSTANCE_ID,
      });
    }

    const auth = authOwner(req);
    if (!auth) return send(res, 401, { ok: false, error: 'Unauthorized' });

    if (req.method === 'POST' && url.pathname === '/v1/pair/start') {
      if (!auth.admin || !isLoopback(req)) return send(res, 403, { ok: false, error: 'Pairing can only be started by the desktop app' });
      prunePairCodes();
      const body = await readJsonBody(req);
      const code = generatePairCode();
      pairCodes.set(code, {
        ownerId: sanitizeId(body.ownerId, 'primary'),
        expiresAt: Date.now() + PAIR_CODE_TTL_MS,
      });
      return send(res, 200, { ok: true, code, expiresAt: Date.now() + PAIR_CODE_TTL_MS });
    }

    if (req.method === 'GET' && url.pathname === '/v1/devices') {
      if (!auth.admin) return send(res, 403, { ok: false, error: 'Admin token required' });
      return send(res, 200, { ok: true, devices: Array.from(devicesByToken.values()).map(publicDevice) });
    }

    const deviceMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)$/);
    if (req.method === 'DELETE' && deviceMatch) {
      if (!auth.admin) return send(res, 403, { ok: false, error: 'Admin token required' });
      const deviceId = deviceMatch[1];
      const device = Array.from(devicesByToken.values()).find(d => d.id === deviceId);
      if (!device) return send(res, 404, { ok: false, error: 'Device not found' });
      devicesByToken.delete(device.token);
      mobileConns.get(deviceId)?.close(1008);
      await persistDevices();
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/v1/captures') {
      const payload = await readJsonBody(req);
      const route = auth.admin
        ? {
            ownerId: sanitizeId(payload.ownerId, 'primary'),
            ownerLabel: payload.ownerLabel || payload.ownerId || 'Primary',
            instanceId: sanitizeId(payload.instanceId || INSTANCE_ID, INSTANCE_ID),
            shareId: sanitizeId(payload.shareId || 'admin-import', 'admin-import'),
          }
        : auth;
      const result = await writeCapture(route, payload);
      return send(res, 200, { ok: true, ...result });
    }

    if (req.method === 'GET' && url.pathname === '/v1/captures') {
      const captures = await listCaptures(auth, url.searchParams.get('owner') || '');
      return send(res, 200, { ok: true, captures });
    }

    const patchMatch = url.pathname.match(/^\/v1\/captures\/([^/]+)$/);
    if (req.method === 'PATCH' && patchMatch) {
      const patch = await readJsonBody(req);
      const capture = await patchCapture(auth, patchMatch[1], patch);
      if (!capture) return send(res, 404, { ok: false, error: 'Capture not found' });
      return send(res, 200, { ok: true, capture });
    }

    send(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    send(res, error?.statusCode || 500, { ok: false, error: error?.message || String(error) });
  }
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const rejectUpgrade = (status, message) => {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  if (url.pathname !== '/v1/ws') return rejectUpgrade(404, 'Not Found');
  const key = req.headers['sec-websocket-key'];
  if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key) {
    return rejectUpgrade(400, 'Bad Request');
  }

  // Browser/webview WebSocket clients cannot set headers, so the token is also
  // accepted as a query parameter (loopback and paired-device traffic only).
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : String(url.searchParams.get('token') || '');
  const role = url.searchParams.get('role') || 'mobile';

  let device = null;
  if (role === 'app') {
    if (!ADMIN_TOKEN || !safeEqual(token, ADMIN_TOKEN) || !isLoopback(req)) {
      return rejectUpgrade(401, 'Unauthorized');
    }
  } else {
    device = devicesByToken.get(token);
    if (!device) return rejectUpgrade(401, 'Unauthorized');
  }

  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  if (role === 'app') attachAppSocket(socket, head);
  else attachMobileSocket(device, socket, head);
});

await loadDevices();

server.listen(PORT, HOST, () => {
  console.log(`Forge Relay listening on http://${HOST}:${PORT}`);
  console.log(`Writing captures to ${RAW_ROOT}`);
  console.log(`Paired devices: ${devicesByToken.size}`);
});

function shutdown(signal) {
  console.log(`[relay] ${signal} received — closing server`);
  appConn?.destroy();
  for (const conn of mobileConns.values()) conn.destroy();
  server.close(err => {
    if (err) console.error('[relay] Close error:', err);
    process.exit(err ? 1 : 0);
  });
  // Force-exit after 5 s if pending connections don't drain
  setTimeout(() => { console.error('[relay] Drain timeout — forcing exit'); process.exit(1); }, 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
