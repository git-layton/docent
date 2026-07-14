# Mobile Companion Architecture

*Status: relay + app bridge + Settings pairing QR UI + Expo client (`mobile/`) implemented (July 2026). Not yet field-tested on a physical phone.*

The mobile app is a thin client. All data, memory, and model execution stay on
the Mac — the phone renders chat and streams tokens over an encrypted link.
No cloud databases, no hosted services.

## Alignment with the original spec

The original "Mobile Companion App Architecture" spec was written without
familiarity with the existing codebase. Every open question and mismatched
assumption in it is resolved below — defaulting to infrastructure the app
already has rather than anything new or hosted. This table is the record;
the spec itself is superseded by this document.

| Spec said | Resolution |
| --- | --- |
| Open question: WebRTC vs Tailscale vs CloudKit (vs Cloudflare Tunnel) | **LAN-first + Tailscale.** Zero hosted infrastructure; protocol is transport-agnostic if that ever changes. WebRTC needs a signaling server + TURN relay (cloud infra, cost); Cloudflare terminates TLS at its edge; CloudKit can't stream tokens and excludes Android. |
| Tiny hosted "signaling server" to help devices find each other | **None.** Nothing is hosted anywhere. Discovery = mDNS `.local` name on the LAN, Tailscale MagicDNS remotely — both already resolvable without us running anything. |
| "Secure API to read SQLite chat history" | **There is no SQLite.** History lives in the Tauri Store (`agent_forge_db.bin`) owned by the webview with merge-on-persist semantics. The running app answers `history.*` frames from its stores; the relay never reads app data. |
| `GET /v1/chat/history?agent=coding` REST endpoint | Replaced by WS frames (`history.list`, `history.get`) — one socket for reads and streaming instead of a parallel REST surface. |
| "Route mobile messages into the Tauri app so local models respond" | The model pipeline is frontend TypeScript inside the webview — nothing external can call it. So the **app connects out** to the relay (`role=app`, loopback + admin token) and serves requests; the relay stays a dumb router. |
| "Mac runs the AI model (LM Studio or native engine)" | The app's existing model pipeline runs the chat — whatever model is currently selected (local or cloud provider), same as a desktop chat. No mobile-specific model path. |
| "Pre-shared cryptographic key scanned via QR on setup" | Slightly better: the QR carries a **one-time short-lived pairing code**; the phone trades it for a **per-device revocable token** (`/v1/pair/claim`, stored in `devices.json`). No long-lived shared secret ever appears in a QR. |
| Wake-on-LAN packet generator / APNs to wake the Mac | **Deferred.** A sleeping Mac drops off Tailscale too, and WOL from outside the LAN needs a helper on the LAN. v1 answer: keep the Mac awake while plugged in (energy settings). The relay is a launchd agent (`RunAtLoad` + `KeepAlive`), so it's up whenever the Mac is. |
| "Mac wakes up, starts forge-relay, connects to the Secure Tunnel" | The relay is always running via launchd and never dials out — Tailscale is system-level, and the phone connects **in**. Offline sends are absorbed by the existing capture inbox instead of being lost. |
| Phone "stores no chat history locally (cache only)" | Honored: the Expo client keeps messages in memory only; the sole persisted item is the pairing credential in the phone's secure enclave storage. |

## Decisions

**Transport: LAN-first, Tailscale for remote.** The phone talks plain
WebSocket/HTTP to `forge-relay` on port 8765. At home that's the Mac's LAN
address; away from home it's the Mac's Tailscale address (WireGuard E2EE,
zero infrastructure for us). The protocol is transport-agnostic — WebRTC could
be added later without touching the frame format, but it requires hosting a
signaling server + TURN relay, which contradicts the cloud-free constraint.
Cloudflare Tunnel terminates TLS at Cloudflare's edge (weakest privacy fit);
CloudKit is too slow for token streaming and locks out Android. Rejected.

**Corrected assumption #1 — there is no SQLite chat history.** Chats live in
the Tauri Store file `agent_forge_db.bin` (keys `chats`, `messages`), written
by the webview with merge-on-persist semantics because the main window and the
Spotlight overlay already share it (`useChatStore.persist()`). The relay never
touches that file. History requests are routed to the running app, which
answers from its stores.

**Corrected assumption #2 — the AI pipeline runs in the webview.** System
prompts, memory, tools, and `generateTextResponse` are frontend TypeScript,
not Rust and not anything the relay can invoke. So "route mobile messages
into the app" means the app connects *out* to the relay as a privileged
client (`role=app`) and serves requests. The relay stays a dumb router.

**Offline story: two tiers, both queue.**
*Tier 1 — Mac awake, desktop app closed:* a mobile `chat.send` is written as
an inbox capture (`source: mobile_chat`, `targetKind: agent`) and acknowledged
with `chat.queued`; it is processed the next time the app opens. Reads
(`history.*`, `agents.list`) fail fast with `app_offline`.
*Tier 2 — Mac asleep/unreachable:* nothing on the Mac can hear the phone, so
the client holds `chat.send` frames in an in-memory outbox (`onWaiting` fires,
UI shows "Mac unreachable"), and flushes them in order the moment the
connection comes back. Intentional close or revocation drops the outbox.

**One token per phone, for everything.** Paired device tokens also
authenticate the capture API (`POST /v1/captures`, routed to the device's
`ownerId` with `shareId: mobile`), so a paired phone needs no separate
share-token setup — the owner-token routes in the launchd env remain only for
multi-person/team shares and legacy Shortcuts.

**Wake-on-LAN: deferred.** A sleeping Mac drops off Tailscale too. The v1
answer is an energy-settings nudge (prevent sleep while plugged in). The
relay itself is a launchd agent (`RunAtLoad` + `KeepAlive`), so it is up
whenever the Mac is awake.

## Components

```
┌────────────┐   WSS (LAN or Tailscale)   ┌──────────────┐   WS (loopback)   ┌─────────────┐
│ Expo app   │ ─────────────────────────▶ │ forge-relay  │ ◀──────────────── │ Desktop app │
│ role=mobile│    device token (QR pair)  │  port 8765   │    admin token    │  role=app   │
└────────────┘                            │  (launchd)   │                   │ (webview,   │
                                          └──────┬───────┘                   │  runs LLMs) │
                                   app offline?  │ writes                    └─────────────┘
                                                 ▼
                                     ~/AgentForge/inbox/raw (captures)
```

- **`scripts/forge-relay.mjs`** — Node stdlib only (it is spawned by launchd
  from the app bundle with no `node_modules`, so RFC 6455 framing is
  implemented inline). Holds one app socket and N mobile sockets.
- **`src/services/relayBridge.ts`** — started from the App boot effect in the
  main window only (the Spotlight overlay renders the same `App` component and
  must not connect; the relay allows a single app socket, latest wins).
- **`~/AgentForge/relay/devices.json`** — paired device registry (mode 600).
  Device tokens live here, not in the launchd env file, so pairing works
  without a relay restart.

## Pairing flow

1. Desktop app (loopback + admin token) calls `POST /v1/pair/start` →
   `{ code, expiresAt }`. Codes are 8 chars from an unambiguous alphabet,
   single-use, 10-minute TTL.
2. Desktop shows a QR encoding `{ v: 1, hosts: [lanHost, tailscaleHost], code }`.
   (QR UI not built yet — `get_relay_status` already returns
   `tailscaleHostname` and `adminToken`.)
3. Phone calls `POST /v1/pair/claim` with `{ code, deviceName }` →
   `{ deviceId, token, ownerId, instanceId }`. The token is shown exactly once
   and stored in the phone's secure storage. Claims are rate-limited
   (10 per 5 min) and codes are consumed on first try.
4. Revocation: `GET /v1/devices` / `DELETE /v1/devices/:id` (admin token);
   deleting closes the device's live socket immediately.

## WebSocket endpoint

`GET /v1/ws?role=app|mobile&token=<token>` (token also accepted as
`Authorization: Bearer` — the query form exists because browser/webview
WebSocket clients cannot set headers).

- `role=app`: admin token **and** loopback source required.
- `role=mobile`: paired device token required.
- All frames are JSON text frames. Relay pings every 30 s; dead sockets are
  dropped. Max message 16 MB (`FORGE_RELAY_MAX_WS_MESSAGE_BYTES`).

### Routing rule

Mobile frames are forwarded to the app with `deviceId` + `deviceName`
injected. App frames carrying `deviceId` are routed to that device (with
`deviceId` stripped); app frames **without** `deviceId` broadcast to every
connected phone (e.g. `chats.updated`).

### Frames: relay → client on connect

| Frame | Notes |
| --- | --- |
| `{type:'welcome', role:'mobile', deviceId, instanceId, appOnline}` | first frame to a phone |
| `{type:'welcome', role:'app', instanceId, devices:[...]}` | first frame to the app; lists connected deviceIds |
| `{type:'presence', appOnline}` | to phones whenever the app socket attaches/detaches |
| `{type:'device.connected'/'device.disconnected', deviceId, deviceName}` | to the app on phone connect/drop |

### Frames: phone → Mac

| Frame | App reply (routed back by reqId) |
| --- | --- |
| `{type:'agents.list', reqId}` | `{type:'agents.list.result', reqId, agents:[{id,name,description,role}]}` |
| `{type:'history.list', reqId}` | `{type:'history.list.result', reqId, chats:[{id,name,agentId,updatedAt,messageCount,lastMessage}]}` |
| `{type:'history.get', reqId, chatId}` | `{type:'history.get.result', reqId, chatId, messages:[{id,role,content,agentId,timestamp}]}` (last 200; roles normalized `bot`→`assistant`) |
| `{type:'chat.send', reqId, text, agentId?, chatId?}` | `chat.accepted` → `chat.token`* → `chat.done` (below) |
| `{type:'chat.cancel', reqId}` | `{type:'chat.cancelled', reqId, chatId}` with partial text kept |
| `{type:'ping'}` | `{type:'pong', ts}` (answered by the relay itself) |

### Chat streaming sequence

```
phone  chat.send {reqId, agentId, chatId?, text}
mac    chat.accepted {reqId, chatId}            ← chat created if chatId absent
mac    chat.token {reqId, chatId, token} ×N     ← streamed as the model generates
mac    chat.done {reqId, chatId, message:{id, role:'assistant', content, agentId, agentName, timestamp}}
```

Errors at any stage: `{type:'error', reqId, error}` — notably
`app_offline`, `no_model_configured`, `empty_message`, `unknown_type`.
If the app is offline, `chat.send` instead returns
`{type:'chat.queued', reqId, captureId}`.

The bridge mirrors the exchange into the desktop UI live (user message +
streaming bot bubble), and persists through `useChatStore.persist()`, which
already merge-protects against concurrent overlay writes.

## Testing

- `node scripts/test-forge-relay.mjs` — original capture API smoke test.
- `node scripts/test-forge-relay-ws.mjs` — pairing, WS auth, routing,
  streaming order, offline queue, broadcast, revocation (needs Node 22+ for
  the built-in WebSocket client).

Manual poke without a phone:

```sh
source ~/.agent-forge-relay.env 2>/dev/null  # or read tokens from the file
curl -s -X POST -H "Authorization: Bearer $FORGE_RELAY_ADMIN_TOKEN" localhost:8765/v1/pair/start
curl -s -X POST -H 'content-type: application/json' -d '{"code":"<CODE>","deviceName":"curl"}' localhost:8765/v1/pair/claim
# then connect: ws://localhost:8765/v1/ws?role=mobile&token=<device token>
```

## Built so far

- **Pairing QR UI**: `src/components/MobileCompanionCard.tsx` in Settings →
  Connect — starts pairing, renders the QR (`{v, hosts, port, code,
  instanceId}` — mDNS `.local` + Tailscale hosts), lists/revokes devices with
  live online dots.
- **Expo client** (`mobile/`, SDK 57): PairScreen (QR scan via expo-camera +
  manual entry, token in expo-secure-store), ChatsScreen (agents + recent
  chats, presence banner), ChatScreen (streaming, stop, queued/offline
  states). `mobile/src/relayClient.ts` handles host fallback (LAN →
  Tailscale), reqId correlation, and reconnect with backoff — it is verified
  end-to-end in Node against the real relay with a simulated desktop bridge.

## Next steps

1. **Field test on a physical phone** (Expo Go): see `mobile/README.md`.
2. **Queued-capture pickup**: surface `mobile_chat` captures as chat messages
   (today they land in the Inbox like any capture).
3. **Relay TLS or Noise layer** so remote transports beyond Tailscale become
   an option; currently plain ws:// (fine on LAN / inside WireGuard).
4. Relay restart note: launchd runs the copy referenced by the installed
   plist — after changing `forge-relay.mjs`, `launchctl kickstart -k
   gui/$(id -u)/com.agentforge.relay` (or reinstall from onboarding) to pick
   it up.
