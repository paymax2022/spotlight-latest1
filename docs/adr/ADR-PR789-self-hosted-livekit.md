# ADR-PR789: Self-hosted LiveKit for real-time rooms

Status: accepted (flag-off) · Scope of this change: academy live classes

## Context
Real-time media was VideoSDK-only (`integrations/rtc`), and academy live classes ran on a deterministic stub when it was
not configured. The business chose to run **LiveKit on its own infrastructure** (no per-minute vendor billing, data stays
in our estate). The backend runs on Railway, which has no UDP ingress, so the media server cannot live there.

## Decision
- **A separate `internal/integrations/livekit` package, not a second provider inside `integrations/rtc`.** `rtc.Issuer`
  is a token-only, VideoSDK-shaped API whose tests assert an unknown provider is refused. LiveKit also needs room
  control and webhook verification, so it gets its own client; `rtc` is untouched and the other consumers keep working.
- **Use the official `livekit/protocol` SDK** rather than hand-rolled JWTs and Twirp calls. It guarantees the token
  claims, the server API and the webhook signing match the server we cannot run in CI. Cost: 50 new indirect modules.
- **Explicit, minimal permissions per role.** LiveKit treats an unset permission as allowed, so `CanPublish`,
  `CanSubscribe` and `CanPublishData` are always set. Host publishes; participant sends data only; viewer only listens.
  Tokens are bound to one room and one identity, default 10 minutes, hard cap 6 hours, never admin.
- **Rooms exist only because the backend made them** (`room.auto_create: false`). A token can never create a room. To
  keep that from stranding a live class after the empty-room timeout, the academy adapter re-provisions the room
  (idempotent) before every token it issues.
- **Close rooms when a class ends or is cancelled**, as an optional provider capability (`RoomCloser`), best effort and
  after the state change has committed. Same pattern for `ConnectionInfoProvider` so the client learns the URL; VideoSDK
  and the stub do not implement either, so their behaviour is byte-identical.
- **Fail closed.** Strict validation outside development (`wss://`, secret of at least 32 characters, bounded TTL).
  With the flag on and LiveKit unusable, live classes **refuse** instead of falling back: the dev stub's tokens would look
  like a working class but no media server accepts them (found in security review). The config package does only light checks so it does not import the SDK; the full check runs at mount.
- **Webhooks are authenticated by signature only** (they come from the LiveKit server, not a user) and answer 401 for
  anything unsigned or altered and 500 on consumer failure so LiveKit retries. Today they are logged, not acted on.
- **A status endpoint** (`audit.logs.view`) separates "credentials wrong" from "network wrong" without exposing either.

## Consequences
- The media server is a separate operational surface: a Linux VM with UDP, TURN, TLS and Redis, owned by ops
  (`docs/runbooks/livekit.md`, `infra/livekit/`). The reference config is unverified against a running server.
- No client can join media until a LiveKit client SDK is added to the mobile and web apps; the backend work is
  inert for users until then.
- A user connecting twice with the same identity drops their first connection (LiveKit semantics).
- Another LiveKit-specific path for telemedicine and Connect live is a follow-up; they remain on VideoSDK.

## Known risks accepted
- Join has no enrollment gate (pre-existing in academy live); now consequential. Needs a product decision.
- Webhook replay inside the one-minute window; de-duplicate by event ID before acting on events.
- Attendee data-message spam; no server-side filter.
- A late join can briefly re-create a just-closed room (bounded by the empty-room timeout).

## Not covered
Client SDK integration, telemedicine and Connect live migration, recording / egress, acting on webhook events (for
example ending a session when the room finishes), multi-node scaling beyond the documented reference.
