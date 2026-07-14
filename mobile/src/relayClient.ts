// Client for the forge-relay wire protocol (see docs/mobile-companion-architecture.md
// in the repo root). Plain ws:// — on the LAN that's local traffic, remotely it
// rides inside Tailscale's WireGuard tunnel.

export interface RelayConfig {
  hosts: string[];
  port: number;
  token: string;
  deviceId: string;
  instanceId: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  role: string;
}

export interface ChatSummary {
  id: string;
  name: string;
  agentId: string;
  updatedAt: number;
  messageCount: number;
  lastMessage: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string | null;
  timestamp?: number | null;
}

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export interface ChatStreamHandlers {
  onAccepted?: (chatId: string) => void;
  onToken?: (token: string) => void;
  onDone?: (message: ChatMessage, chatId: string) => void;
  onQueued?: (captureId: string) => void;
  // Mac unreachable — the message is held on the phone and sent automatically
  // once the connection comes back.
  onWaiting?: () => void;
  onCancelled?: () => void;
  onError?: (error: string) => void;
}

export interface QrPayload {
  v: number;
  hosts: string[];
  port: number;
  code: string;
  instanceId?: string;
}

const CLAIM_TIMEOUT_MS = 6000;
const CONNECT_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RECONNECT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

// Trades a pairing code for a device token, trying each host until one answers.
export async function claimPairing(
  hosts: string[],
  port: number,
  code: string,
  deviceName: string,
): Promise<RelayConfig> {
  let lastError = 'No hosts reachable';
  for (const host of hosts) {
    try {
      const res = await withTimeout(
        fetch(`http://${host}:${port}/v1/pair/claim`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, deviceName }),
        }),
        CLAIM_TIMEOUT_MS,
        `Pairing via ${host}`,
      );
      const json = await res.json();
      if (!res.ok || !json.ok) {
        // The host answered — a bad code won't get better on another host.
        throw Object.assign(new Error(json.error ?? `Pairing failed (${res.status})`), { fatal: true });
      }
      return {
        hosts,
        port,
        token: json.token,
        deviceId: json.deviceId,
        instanceId: json.instanceId ?? '',
      };
    } catch (e: any) {
      if (e?.fatal) throw e;
      lastError = e?.message ?? String(e);
    }
  }
  throw new Error(lastError);
}

interface PendingRequest {
  resolve: (frame: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RelayConnection {
  private config: RelayConfig;
  private ws: WebSocket | null = null;
  private hostIndex = 0;
  private reqCounter = 0;
  private reconnectMs = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private pending = new Map<string, PendingRequest>();
  private streams = new Map<string, ChatStreamHandlers>();
  // chat.send frames held while the Mac is unreachable, flushed in order on
  // reconnect. In-memory only, per the thin-client rule.
  private outbox: Array<Record<string, any>> = [];
  private statusListeners = new Set<(status: ConnectionStatus, appOnline: boolean) => void>();

  status: ConnectionStatus = 'connecting';
  appOnline = false;

  constructor(config: RelayConfig) {
    this.config = config;
    this.connect();
  }

  onStatus(listener: (status: ConnectionStatus, appOnline: boolean) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status, this.appOnline);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: ConnectionStatus, appOnline = this.appOnline) {
    this.status = status;
    this.appOnline = appOnline;
    for (const listener of this.statusListeners) listener(status, appOnline);
  }

  private connect() {
    if (this.closed) return;
    const host = this.config.hosts[this.hostIndex % this.config.hosts.length];
    const url = `ws://${host}:${this.config.port}/v1/ws?role=mobile&token=${encodeURIComponent(this.config.token)}`;
    this.setStatus('connecting');

    const ws = new WebSocket(url);
    this.ws = ws;

    const connectTimer = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) ws.close();
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      clearTimeout(connectTimer);
      this.reconnectMs = 1000;
    };
    ws.onmessage = event => {
      let frame: any;
      try { frame = JSON.parse(String(event.data)); } catch { return; }
      this.handleFrame(frame);
    };
    ws.onerror = () => { /* onclose always follows */ };
    ws.onclose = () => {
      clearTimeout(connectTimer);
      if (this.ws === ws) this.ws = null;
      this.failInflight('Connection lost');
      if (this.closed) return;
      this.setStatus('offline', false);
      this.hostIndex += 1; // rotate LAN → Tailscale → LAN …
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectMs);
      this.reconnectMs = Math.min(this.reconnectMs * 2, MAX_RECONNECT_MS);
    };
  }

  private failInflight(message: string) {
    for (const [, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error(message));
    }
    this.pending.clear();
    // Streams whose frame is still waiting in the outbox aren't in flight —
    // keep their handlers so they fire when the message finally sends.
    const waiting = new Set(this.outbox.map(frame => frame.reqId));
    for (const [reqId, handlers] of this.streams) {
      if (waiting.has(reqId)) continue;
      this.streams.delete(reqId);
      handlers.onError?.(message);
    }
  }

  private handleFrame(frame: any) {
    const { type, reqId } = frame ?? {};

    if (type === 'welcome') {
      this.setStatus('online', Boolean(frame.appOnline));
      // Flush messages queued while the Mac was unreachable, in send order.
      const held = this.outbox;
      this.outbox = [];
      for (const heldFrame of held) this.send(heldFrame);
      return;
    }
    if (type === 'presence') {
      this.setStatus(this.status, Boolean(frame.appOnline));
      return;
    }

    const stream = reqId ? this.streams.get(reqId) : undefined;
    if (stream) {
      switch (type) {
        case 'chat.accepted': stream.onAccepted?.(frame.chatId); return;
        case 'chat.token': stream.onToken?.(frame.token ?? ''); return;
        case 'chat.done':
          this.streams.delete(reqId);
          stream.onDone?.(frame.message, frame.chatId);
          return;
        case 'chat.queued':
          this.streams.delete(reqId);
          stream.onQueued?.(frame.captureId);
          return;
        case 'chat.cancelled':
          this.streams.delete(reqId);
          stream.onCancelled?.();
          return;
        case 'error':
          this.streams.delete(reqId);
          stream.onError?.(frame.error ?? 'Unknown error');
          return;
      }
    }

    const request = reqId ? this.pending.get(reqId) : undefined;
    if (request) {
      this.pending.delete(reqId);
      clearTimeout(request.timer);
      if (type === 'error') request.reject(new Error(frame.error ?? 'Unknown error'));
      else request.resolve(frame);
    }
  }

  private send(frame: Record<string, any>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(frame));
    return true;
  }

  private request(frame: Record<string, any>): Promise<any> {
    const reqId = `req-${Date.now()}-${++this.reqCounter}`;
    return new Promise((resolve, reject) => {
      if (!this.send({ ...frame, reqId })) return reject(new Error('Not connected'));
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error('Request timed out'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(reqId, { resolve, reject, timer });
    });
  }

  async listAgents(): Promise<AgentSummary[]> {
    const frame = await this.request({ type: 'agents.list' });
    return frame.agents ?? [];
  }

  async listChats(): Promise<ChatSummary[]> {
    const frame = await this.request({ type: 'history.list' });
    return frame.chats ?? [];
  }

  async getHistory(chatId: string): Promise<ChatMessage[]> {
    const frame = await this.request({ type: 'history.get', chatId });
    return frame.messages ?? [];
  }

  // Returns the reqId (usable with cancelChat); stream results arrive via handlers.
  // If the Mac is unreachable the frame is held on the phone (onWaiting fires)
  // and sent automatically on reconnect.
  sendChat(params: { text: string; agentId?: string; chatId?: string }, handlers: ChatStreamHandlers): string {
    const reqId = `req-${Date.now()}-${++this.reqCounter}`;
    const frame = { type: 'chat.send', reqId, ...params };
    this.streams.set(reqId, handlers);
    if (!this.send(frame)) {
      this.outbox.push(frame);
      handlers.onWaiting?.();
    }
    return reqId;
  }

  cancelChat(reqId: string) {
    const heldIndex = this.outbox.findIndex(frame => frame.reqId === reqId);
    if (heldIndex >= 0) {
      this.outbox.splice(heldIndex, 1);
      const handlers = this.streams.get(reqId);
      this.streams.delete(reqId);
      handlers?.onCancelled?.();
      return;
    }
    this.send({ type: 'chat.cancel', reqId });
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.outbox = []; // intentional close — nothing left to hold for
    this.failInflight('Connection closed');
    this.ws?.close();
    this.ws = null;
  }
}
