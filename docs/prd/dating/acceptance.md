# Paymax Connect — Acceptance Criteria (§27)

Each phase ships as vertical slices; a slice is done only when its checks pass **and** no safety
invariant (`compliance.md`) was weakened. Tests must cover state machines, authz, and safety paths.

## Phase 0 — Foundation
- [ ] `GET /api/v1/connect/config` returns backend-owned flags/weights/limits (mobile reads, none hard-coded).
- [ ] `connect_audit_log` writes with the full field set (actor, role, action, entity, old/new, reason, IP, ts).
- [ ] Every safety report path can open a `connect_case` (scaffold present + tested).
- [ ] 18+ age-gate primitive + `connect_underage_flags` pathway exist and route suspected minors.
- [ ] Verification-data encryption + retention hooks present (no plaintext PII, no PII in logs).
- [ ] Module skeletons compile (`go build ./...`), routes gated by `FeatureConnectEnabled`, CI green.

## Phase 1 — Core Dating & Friendship MVP
- [ ] 18+ confirmed at onboarding; phone/email verified before core use.
- [ ] Profile modes work with independent per-mode visibility.
- [ ] L0–L1 selfie/liveness verification + badge.
- [ ] Curated daily matches render with match-reason cards; anti-fatigue limits come from config.
- [ ] Matches are **mutual-only**; likes/super-likes idempotent.
- [ ] Search filters: verified-only, intent, approximate distance.
- [ ] Chat available only after match; scam/money/off-platform/harassment warnings fire; flagged
      conversations reach moderation.
- [ ] Report/block **create cases**; never fail silently.
- [ ] Date plan + trusted-contact share + check-in + post-date feedback work.
- [ ] Admin can manage users, review verification, moderate profiles/chat, handle cases, read audit.

## Phase 2 — Professional
- [ ] Create professional profile + business verification; send intro request (consent before
      messaging); exchange business card; save contacts; join + moderate professional rooms.

## Phase 3 — Event networking
- [ ] Explicit opt-in; discover attendees with opt-in privacy; QR check-in/scan; save event
      contacts; follow-up — reusing existing `events`/`event_tickets` (no rebuild).

## Phase 4 — Creator
- [ ] Build portfolio; request Spotlight creator verification; receive collaboration requests;
      control fan messages; admin reviews creator verification.

## Phase 5 — AI & trust
- [ ] AI coach/assistant produce safe, on-policy output (no manipulative/sexual/harassing/deceptive
      content); scam-shield flags store reason codes and surface to moderators; group date +
      circles function with moderation.

## Phase 6 — Monetization
- [ ] Subscribe via Paymax wallet; entitlements enforced server-side; boosts/passes purchasable;
      rides/tickets bookable from the date planner; admin manages plans + reconciles payments.
