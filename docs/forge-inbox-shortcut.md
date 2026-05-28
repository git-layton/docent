# Forge Inbox Shortcut Setup

Forge Inbox capture is generic. A Shortcut belongs to a **capture owner** and a **share route**, not to a hardcoded person. Use owner IDs like `primary`, `partner`, `family`, `work`, or `field-notes`.

## 1. Install the Mac Relay

Install Tailscale on the Mac and phones, then run:

```bash
bash scripts/install-forge-relay-launchd.sh
```

The installer creates `~/.agent-forge-relay.env` with local tokens:

```bash
FORGE_RELAY_INSTANCE_ID=agent-forge-home
FORGE_RELAY_TOKENS=primary:Primary:<token>:agent-forge-home:primary-shortcut,partner:Partner:<token>:agent-forge-home:partner-shortcut
FORGE_RELAY_ADMIN_TOKEN=<admin-token>
```

Each token route is:

```text
ownerId:Owner Label:token:instanceId:shareId
```

The `ownerId` should also exist in Agent Forge Settings -> Inbox. The relay writes raw captures into `~/AgentForge/inbox/raw/<ownerId>/<capture-id>/`, where the desktop app can read them even if Agent Forge was closed when the capture arrived.

## 2. Verify the Relay

On the Mac:

```bash
curl http://127.0.0.1:8765/healthz
```

Expected response:

```json
{"ok":true}
```

Run the local smoke test from the repo:

```bash
npm run relay:test
```

That test checks unauthorized rejection, token routing, attachment persistence, duplicate capture detection, listing, patching, and invalid base64 handling.

## 3. Build the iOS Shortcut

Create a Shortcut named `Send to Agent Forge` and enable **Use as Share Sheet** with all input types.

### Text or Link Capture

1. Add `Receive Any input from Share Sheet`.
2. Add `Ask for Input` named `Note`; make it optional.
3. Add `Text` and build this JSON. Insert the actual Shortcut variables for `Shortcut Input` and `Note`; do not type those names as literal text.

```json
{
  "source": "ios_shortcut",
  "kind": "text",
  "title": "Shared from iPhone",
  "bodyText": "<Shortcut Input>",
  "note": "<Note>",
  "instanceId": "agent-forge-home",
  "shareId": "primary-shortcut",
  "deviceName": "Layton iPhone"
}
```

4. Add `Get Contents of URL`.
5. URL: `http://<mac-tailscale-name-or-ip>:8765/v1/captures`.
6. Method: `POST`.
7. Headers:

```text
Authorization: Bearer <owner-token>
Content-Type: application/json
```

8. Request body: the JSON text from step 3.
9. Add `Show Notification` with `Saved to Agent Forge` when the response contains `ok = true`.
10. Add an error branch that shows `Agent Forge relay unreachable` if the request fails.

### Photo, PDF, File, or Audio Capture

Use the same Shortcut, but add a `Repeat with Each` block over `Shortcut Input`:

1. Inside the repeat block, add `Base64 Encode` for the repeat item.
2. Add a dictionary with:

```json
{
  "name": "<Repeat Item Name>",
  "mimeType": "application/octet-stream",
  "dataBase64": "<Base64 Encoded Repeat Item>"
}
```

3. Add each dictionary to an `attachments` variable.
4. POST this JSON:

```json
{
  "source": "ios_shortcut",
  "kind": "mixed",
  "title": "Shared files from iPhone",
  "bodyText": "",
  "note": "<Note>",
  "instanceId": "agent-forge-home",
  "shareId": "primary-shortcut",
  "deviceName": "Layton iPhone",
  "attachments": "<Attachments>"
}
```

For v1, payloads over roughly 50MB are rejected so the phone gets a clear failure instead of silently losing data.

## 4. Process Captures

Open Agent Forge -> Inbox:

- Filter by owner, or use All.
- Choose Agent, Channel, or Library as the destination.
- Process one capture or Process All.
- Raw originals remain in `~/AgentForge/inbox/raw/`.
- Derived grounded Markdown is saved into agent memory, channel memory, or library.

If capture fails away from home, check that Tailscale is connected on both devices and the Mac relay is running.
