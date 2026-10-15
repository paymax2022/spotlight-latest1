# ADR-PR790: Mobile LiveKit client for academy live classes

Status: accepted (flag-off server side; **not yet verified on a device**) · Builds on ADR-PR789

## Context
ADR-PR789 made the backend issue LiveKit join tokens and the server URL. The mobile app had a placeholder room screen
(fake video, seeded chat, local-only raise-hand) and, underneath it, two API mismatches: the join response was never
unwrapped, and report bodies used field names the Go handler does not bind.

## Decision
- **Use `livekit-client` with `@livekit/react-native` (+ its WebRTC fork), not a hosted component library.** The screens
  keep the app's own design tokens; the SDK is confined to `useLiveRoom.native.ts` and `LiveStage.native.tsx`.
- **Platform split by file extension.** `*.native.ts(x)` hold the SDK; plain `.ts(x)` are stubs that report
  "unsupported", so the web bundle never imports a native module. The SDK is registered lazily on first room use, so a
  build lacking the native modules breaks only this screen, not app start.
- **Everything that decides trust is pure and unit-tested** (`connection`, `dataMessages`, `disconnect`,
  `joinResponse`, `report`), because the SDK parts cannot be exercised without a device:
  - dial only a response that says provider `livekit`, with a JWT-shaped token and a `wss://` URL (plaintext only in dev);
  - the sender of a chat message is LiveKit's authenticated participant identity, never a field in the payload;
  - incoming text is sanitised and everything is size/rate/length bounded;
  - what a user may do (publish or not) comes from the permissions in their token, reported by the room, not from the API
    response or the screen.
- **Final vs retryable disconnects.** Class ended, removed by the host and signed-in-elsewhere are final (no retry loop,
  no fighting for the seat). Network-type drops get a fresh token from the API, because the SDK would otherwise reuse an
  expired one.
- **Chat is peer data, not server chat.** LiveKit data messages are not stored or filtered by us. The old UI called the
  room "Moderated", which would now be false, so it says "Group chat only" and relies on reporting. A report names the
  session, the sender's user id and the message id so a moderator can find the person; the content itself is not kept.
- Fix the existing API mismatches in the same change because the screen cannot work without them.

## Consequences
- A new native build is required (dev client or EAS). The Expo config plugin must be the major matching the Expo SDK
  (13 for SDK 54), or prebuild breaks.
- Until someone runs the checklist in `docs/runbooks/livekit.md` on real devices, none of the media path is proven.
- iOS prebuild is broken in this repo independently of this change (`plist` vs `@xmldom/xmldom`); the iOS permission
  strings could not be inspected. Needs its own fix.
- Moderators cannot read reported messages. If minors use live classes, store chat server-side (or via a LiveKit
  webhook/egress path) before launch; this is a safeguarding decision, not a technical afterthought.

## Not covered
Picture-in-picture, background audio, screen share, host controls to mute or remove a participant, recording, web, and
moving telemedicine and Connect live to LiveKit.
