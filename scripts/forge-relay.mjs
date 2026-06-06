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

function authOwner(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (ADMIN_TOKEN && token === ADMIN_TOKEN) return { ownerId: 'all', admin: true };
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

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
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

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/healthz') return send(res, 200, { ok: true });

    const auth = authOwner(req);
    if (!auth) return send(res, 401, { ok: false, error: 'Unauthorized' });

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

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

server.listen(PORT, HOST, () => {
  console.log(`Forge Relay listening on http://${HOST}:${PORT}`);
  console.log(`Writing captures to ${RAW_ROOT}`);
});

function shutdown(signal) {
  console.log(`[relay] ${signal} received — closing server`);
  server.close(err => {
    if (err) console.error('[relay] Close error:', err);
    process.exit(err ? 1 : 0);
  });
  // Force-exit after 5 s if pending connections don't drain
  setTimeout(() => { console.error('[relay] Drain timeout — forcing exit'); process.exit(1); }, 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
