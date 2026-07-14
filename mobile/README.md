# Agent Forge Mobile

Thin client for the Mac app — all chats, memory, and models stay on the Mac
(see `../docs/mobile-companion-architecture.md` for the wire protocol).

## Run it on your phone (development)

1. On the Mac: make sure the relay is running and the desktop app is open
   (the app answers chats; the relay queues them to the Inbox if it's closed).
2. Install **Expo Go** from the App Store / Play Store.
3. In this directory: `npm install && npm start`, then scan the terminal QR
   with the phone camera (iOS) or Expo Go (Android). Phone and Mac must be on
   the same Wi-Fi.
4. In the app: pair by scanning the QR from the desktop's
   **Settings → Connect → Mobile Companion → Pair a Phone** (or enter the
   host + code manually).

Remote use: install Tailscale on both devices — the pairing QR already
includes the Mac's Tailscale hostname when available, and the client falls
back between hosts automatically.

## Notes

- Transport is plain `ws://` (LAN traffic, or WireGuard-encrypted inside
  Tailscale). ATS/cleartext exceptions are configured in `app.json`;
  relay-side TLS is future work.
- Device tokens live in the phone's secure storage (`expo-secure-store`).
  Revoke a phone anytime from the desktop's Mobile Companion card.
- Standalone/TestFlight builds: `npx eas build` (Apple Developer account
  required for iOS).
