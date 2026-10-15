# Runbook: self-hosted LiveKit (live classes, and later calls)

Decisions: ADR-PR789. Reference server config: `infra/livekit/`.

## What runs where

```
 mobile / web client ──wss:443──▶ reverse proxy ──▶ LiveKit :7880   (signalling)
        │                                              │
        └──── UDP 7882 / TCP 7881 / TURN 3478+5349 ───▶ LiveKit  (media)   ◀── Redis (rooms across nodes)

 backend (Railway) ── HTTPS ──▶ LiveKit server API    (create/close rooms, health)
 LiveKit ── HTTPS signed webhook ──▶ backend  POST /api/v1/webhooks/livekit
```

The backend never touches media. It mints short-lived join tokens, creates and closes rooms and
receives events. **The media path needs a host that accepts inbound UDP.** Railway does not offer
UDP ingress, so the LiveKit server must run on a Linux VM (or bare metal) with a public IP; only
the backend stays on Railway. TCP and TURN/TLS still work through restrictive networks, but UDP is
what gives acceptable quality.

## Environment (backend, on Railway)

| Variable | Value | Notes |
|---|---|---|
| `FEATURE_LIVEKIT_ENABLED` | `true` | off = previous provider, untouched |
| `LIVEKIT_URL` | `wss://rtc.example.com` | `wss://` required outside development |
| `LIVEKIT_API_KEY` | key name | same as the server's key |
| `LIVEKIT_API_SECRET` | ≥ 32 random chars | server-side only; never returned or logged |
| `LIVEKIT_TOKEN_TTL_SECONDS` | `600` | 1–21600. A token only has to be valid when the client connects |

A half-set or invalid configuration does **not** crash the backend: it logs
`[livekit][ALERT] ... NOT available` and live rooms keep using the previous provider.

## Server (LiveKit host)

1. Provision a VM with a public IPv4. Open: `443/tcp` (reverse proxy → 7880), `7881/tcp`,
   `7882/udp`, `3478/udp`, `5349/tcp`. Keep `7880`, `6789` (metrics) and Redis private.
2. DNS: `rtc.example.com` (signalling) and `turn.example.com` (TURN) → the VM.
3. TLS: terminate `wss://` at the reverse proxy; give TURN a certificate (`infra/livekit/livekit.yaml`).
4. `cd infra/livekit && cp .env.example .env`; set an **exact** image tag you tested, the key name
   and `openssl rand -base64 48 | tr -d '\n'` for the secret. Edit `webhook.api_key` and
   `webhook.urls` in `livekit.yaml`. `docker compose up -d`.
5. Put the same key/secret into Railway and set `FEATURE_LIVEKIT_ENABLED=true`.

`room.auto_create: false` is deliberate: rooms exist only because the backend created them, so a
token can never create one. The backend re-creates a room on rejoin (idempotent), so the empty-room
timeout cannot strand a live class.

## Verify (do this on staging before enabling anywhere real)

1. `GET /api/v1/admin/rtc/livekit` (needs `audit.logs.view`) → `reachable: true`. If `false`, the
   `error` says whether it is the network or the credentials (the secret is scrubbed from it).
2. Start a class (`POST .../academy/admin/live/sessions/{id}/start`): the room appears in the status
   `rooms` count.
3. Join twice (host + attendee). Response has `token` and `rtc.url`. Decode the token (jwt.io):
   `video.room` is `academy-live-<session id>`; the attendee has `canPublish:false`.
4. From a real device on mobile data and on office Wi-Fi, connect with the LiveKit CLI:
   `lk room join` (see `lk room join --help` for your CLI version); confirm media flows, and repeat
   with the client forced onto the TURN relay to prove the relay path works.
5. End the class: everyone is disconnected and the room disappears.
6. In the LiveKit logs confirm the webhook deliveries returned 200. A `401` means the key/secret
   differ between server and backend, or a proxy altered the body.
7. Load test before launch: `lk load-test --url ... --room load --video-publishers 5 --subscribers 50`
   from a separate host, and watch CPU, bandwidth and packet loss on the VM.

## Mobile build

LiveKit needs native code, so the app must be built as a development or EAS build (it cannot run in Expo Go;
it already cannot, because of maps and Sentry). After pulling this change: reinstall (`npm ci`), then rebuild the
native app (`npx expo run:android`, `npx expo run:ios`, or an EAS build). An old dev build without the LiveKit
modules opens everything else normally; only the live-class screen reports an error.

Device verification checklist (do this once on a real Android and a real iPhone, on Wi-Fi and on mobile data):
1. Host account: start a class, open the room, tap the camera and mic buttons. The OS asks for camera and
   microphone permission with the text from `app.json`.
2. Learner account on a second device: join. The host's video appears; the participant count is 2.
3. Learner raises a hand: the host sees the name. Learner sends a chat message: it appears on both devices with
   the sender's display name. A message with RTL-override characters shows without them.
4. Turn off Wi-Fi on the learner for 20 seconds: status shows "Reconnecting…", then recovers.
5. Host ends the class: the learner sees "This class has ended." and the room disappears from the status endpoint.
6. Put the learner app in the background for the token lifetime (10 minutes), return, and rejoin: it fetches a
   fresh token rather than reusing the expired one.

`npx expo prebuild --platform ios` currently fails in this repo on an unrelated `plist` / `@xmldom/xmldom`
incompatibility (it fails identically without the LiveKit plugins), so iOS native configuration, including the
microphone and camera permission strings, is not verified by that route. Android prebuild succeeds and includes
CAMERA, RECORD_AUDIO and MODIFY_AUDIO_SETTINGS.

## Rotating the secret

LiveKit accepts more than one key at once. Add the new pair alongside the old one in the server's
key list (use the syntax in the LiveKit docs for your release), restart LiveKit, switch the backend to the new pair, confirm the
status endpoint, then remove the old pair. Webhook signing uses `webhook.api_key`: change it with the
switch. Tokens already issued stay valid until they expire (≤ `LIVEKIT_TOKEN_TTL_SECONDS`).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Status `reachable:false`, error `401`/`permission_denied` | key/secret mismatch between Railway and the server |
| Status `reachable:false`, error mentions timeout | firewall, DNS, proxy not forwarding `/twirp` |
| Client: token rejected | server clock skew (>1 min), wrong key, or expired token (rejoin via the API) |
| Client: connects, no media | UDP blocked and TURN not reachable: check 3478/5349 and the cert |
| Join fails with "room does not exist" | `auto_create:false` and the backend could not create it: check the status endpoint |
| Webhooks 401 | secret mismatch, or a reverse proxy rewrites/gzips the body |
| Audio but no video for some users | codec list in `room.enabled_codecs`; add what your clients need |

## Rollback

Set `FEATURE_LIVEKIT_ENABLED=false`. Live rooms revert to the previous provider on the next backend
restart. Sessions already started on LiveKit keep their `academy-live-*` room reference, which the
previous provider cannot join, so roll back between classes, not during one.

## Known limits

- **Joining a class needs no enrollment.** The existing academy join only requires an authenticated user
  and a live session, so anyone who knows a live session ID gets a subscribe-and-chat token. This predates
  LiveKit but now reaches a real media room: decide whether live classes must be gated on enrollment or
  booking before enabling this for paid classes.
- **TURN ships disabled** (it needs a certificate and the server will not start without one). Without it,
  users on networks that block UDP will not get media. Enable it before launch (`infra/livekit/livekit.yaml`).
- Attendees can send data messages (chat, raise-hand), so a malicious attendee can spam them; there is no
  server-side filter. Revoke by removing the participant.
- A join that races with the end of a class can re-create the room (it lives until the empty-room timeout,
  5 minutes) and its token stays valid for up to 10 minutes. Closing the room is best effort and only logged.
- Webhooks are replayable inside their one-minute validity window. Events are only logged today; add
  de-duplication on the event ID before acting on them.
- If `FEATURE_LIVEKIT_ENABLED` is on but LiveKit cannot be used, live classes refuse (HTTP 502 on start and
  join) rather than falling back to the dev stub. Check the `[livekit][ALERT]` log line.

- **The mobile client exists but has not been run on a device.** The Android and iOS app joins academy live
  classes through `src/features/academy/live/` (host: mic and camera, raised hands; learner: watch, chat, raise
  hand). It type-checks against the real SDK and its logic is unit-tested, but no one has joined a real room from
  a phone yet. There is **no web client**: on web the screen says to open the app. See "Mobile build" below.
- Only academy live classes use LiveKit. Telemedicine calls and Connect live still use VideoSDK.
- No recording or egress, and no domain action on webhooks (events are logged only).
- A user joining the same room from two devices is disconnected from the first (same identity).
- Single node reference. Scale-out needs several LiveKit nodes behind the same Redis and a load balancer
  that is aware of WebSocket stickiness; test it before relying on it.
