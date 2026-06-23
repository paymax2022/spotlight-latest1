# Paymax Connect — Claude Code Build Plan

How to use this file with Claude Code so the build stays coherent and safe.

## Why this structure
The PRD describes ~360 mobile screens, ~106 admin screens, and 30 services. **Do not** paste
the whole spec as one prompt — Claude Code loses coherence and drops the safety invariants.
Instead:

1. Put `CLAUDE.md` at the repo root (auto-loaded every session — durable rules + guardrails).
2. Put the PRD at `docs/paymax-connect-prd.md` (canonical spec, referenced by section).
3. Drive the build with the **phase kickoff prompts** below — one phase at a time, each built
   as **vertical slices** (a feature end-to-end: service + API + mobile + admin + tests), each
   ending in a **verify** step against PRD §27 acceptance criteria.

### Working rhythm per phase
- Start a fresh session, paste the phase kickoff prompt.
- Let Claude **investigate read-only, then present a plan, and wait for your confirmation.**
- Approve/adjust the plan; build slice by slice; review each PR.
- Run the phase's acceptance checks before moving on. Don't start phase N+1 until N passes.

### Slice template (use for every feature inside a phase)
> "Implement the `<feature>` slice from PRD §`<n>` (screens `<range>`, endpoints `<list>`).
> Investigate existing code first, propose a plan (service changes, migrations, endpoints,
> mobile screens, admin screens, tests), wait for my confirmation, then build. Uphold every
> safety invariant in CLAUDE.md. Verify against the acceptance criteria, then summarize files changed."

---

## Phase 0 — Foundation, safety, architecture (do this first)
**Goal:** scaffold the repo and the safety/config backbone everything else depends on.
**Covers:** PRD §25 Phase 0, §26.2 repo structure, §26.3 engineering rules, §6 compliance.

**Kickoff prompt:**
```
You are setting up the Paymax Connect module inside the existing Paymax/Spotlight super app.
Read CLAUDE.md and docs/paymax-connect-prd.md (esp. §6, §21, §22, §26) before acting.

PHASE 0 SCOPE (foundation only — no feature screens yet):
1. Investigate the existing monorepo READ-ONLY: auth, wallet, events, admin, shared packages,
   CI, and any existing `connect` code. Report what exists and what you'll reuse.
2. Propose a plan, wait for my confirmation, then scaffold per PRD §26.2:
   - service skeletons under /services/* (Go): connect-profile, verification, matchmaking,
     chat, safety, scam-detection, moderation, subscription, notification, ai-assistant,
     admin, audit, analytics — health checks + module boundaries only, no business logic yet.
   - shared /packages/*: shared-types, api-client, ui, logger, errors, feature-flags,
     moderation-rules.
   - mobile module shell apps/mobile/src/modules/connect (navigation + folder structure).
   - admin module shell for connect.
3. Build the SAFETY/CONFIG BACKBONE (this is the point of Phase 0):
   - Feature-flag + config service exposing flags, matching weights, premium entitlements,
     moderation/safety rules, discovery limits, verification requirements (backend-owned).
   - Audit service: append-only AdminAuditLog (PRD §22) with the full field set.
   - Case/Incident scaffold so every safety report can create a case.
   - Encryption + retention policy hooks for verification data.
   - 18+ age-gate primitive + underage-flag pathway used by onboarding later.
4. CI: lint, unit tests, build; block merges on red.

Do NOT build feature screens or matching logic yet. Output: scaffolded repo, the config/flag
service, audit + case scaffolds, and a README explaining the structure and how flags are read.
```
**Acceptance:** repo matches §26.2; flag/config service returns backend-owned config; audit log
writes with full fields; age-gate + underage pathway exist; CI green.

---

## Phase 1 — Core Dating & Friendship MVP
**Goal:** the trust-first MVP loop end-to-end.
**Covers:** PRD §19.1–19.5, §19.8–19.11, §19.18, §19.22; §9 (L0–L1 verification); §10 matching;
§12 chat + safety; §13 date planner (basic); §18 admin (users, moderation, safety, audit);
§22 data models; §23 APIs; §27 acceptance.

**Kickoff prompt:**
```
PHASE 1 — Core Dating & Friendship MVP for Paymax Connect. Read CLAUDE.md + PRD §9,10,12,13,19,27.
Build as vertical slices, each: investigate → plan → confirm → build → verify. Slices, in order:

A. Onboarding + 18+ age gate + phone/email verification + Terms/Privacy/Guidelines consent
   (PRD screens 1–21). Block + queue suspected minors.
B. Profile modes + per-mode visibility/privacy; Dating + Friendship profiles (screens 22–30, 52–82).
C. Selfie/liveness verification L0–L1 + verification badges (screens 31–36, 50–51; §9).
D. Discovery (curated daily matches, intent-first, match-reason cards) + likes/super-likes +
   mutual-match creation; anti-fatigue limits from backend config (screens 109–131; §10, §11).
E. Search & filters incl. verified-only + intent + distance (screens 132–147).
F. Chat after match: text/voice/icebreakers + AI safety hooks (scam/money/off-platform/
   harassment warnings) + report/block; flagged convos to moderation (screens 159–184; §12).
G. Safety center: trusted contacts, report flows, block list, privacy + location-visibility
   controls (screens 274–293; §6).
H. Date planner (basic): date idea, safe venue, invite, share-with-trusted-contact, check-in,
   post-date feedback/report (screens 185–205; §13).
I. Admin core: user mgmt, verification review, profile + chat moderation queues, safety incident
   center, audit logs (PRD §18 modules; admin screens 1–49, 105).

Enforce all CLAUDE.md invariants. Matching weights, discovery limits, and moderation rules come
from the Phase-0 config service. Verify each slice against PRD §27 before moving on.
```
**Acceptance (PRD §27):** 18+ confirmed; phone verified before core use; mode visibility works;
curated matches with reasons; mutual-only matches; scam/money/harassment warnings fire; report/
block create cases; date plan + trusted-contact share + check-in work; admin can moderate + audit.

---

## Phase 2 — Professional Networking
**Covers:** PRD §14; §9 L3 + L5 verification; screens 83–97, 216–233; admin §18 professional
modules; APIs §23 professional.

**Kickoff prompt:**
```
PHASE 2 — Professional networking for Paymax Connect. Read CLAUDE.md + PRD §14, §9 (L3/L5), §27.
Vertical slices: (A) professional profile + work/business verification; (B) professional
discovery + intent filters (open to hiring/funding/mentorship/collaboration); (C) digital
business card + QR exchange + saved contacts + follow-up reminders; (D) networking rooms +
moderation; (E) admin: professional categories, business verification, room moderation, fake-
opportunity reports. Investigate → plan → confirm → build → verify per slice. No messaging
before connection consent; uphold all invariants.
```
**Acceptance:** create professional profile; send intro request; exchange business card; save
contacts; join professional rooms; admin verifies business + moderates rooms.

---

## Phase 3 — Event Networking (+ Spotlight events)
**Covers:** PRD §15.3, §16 (event circles); screens 246–260; admin event modules; APIs §23 events.
Integrate the **existing Spotlight event infrastructure** — do not rebuild ticketing/events.

**Kickoff prompt:**
```
PHASE 3 — Event networking for Paymax Connect, integrating EXISTING Spotlight events (reuse,
don't rebuild). Read CLAUDE.md + PRD §15.3, §16, §27. Slices: (A) event networking opt-in +
event profile; (B) attendee/speaker/sponsor/VIP discovery with opt-in privacy; (C) pre-event
matchmaking; (D) QR check-in + scan + save event contact; (E) post-event follow-up + match
suggestions; (F) admin: event community, attendee moderation, QR logs, event reports.
Opt-in must be explicit. Investigate → plan → confirm → build → verify.
```
**Acceptance:** opt into event networking; discover attendees; scan QR; save contacts; follow up.

---

## Phase 4 — Creator Networking
**Covers:** PRD §15.1–15.2; §9 L4 (Spotlight creator verification); screens 98–108, 234–245;
admin creator modules; APIs §23 creators. Reuse Spotlight creator verification.

**Kickoff prompt:**
```
PHASE 4 — Creator networking for Paymax Connect. Read CLAUDE.md + PRD §15, §9 (L4), §27. Slices:
(A) creator profile + portfolio (video/audio/photo) + social links; (B) Spotlight creator
verification request/review; (C) collaboration discovery (music/film/brand/producer/manager) +
collaboration & booking-inquiry requests; (D) creator safety controls (fan-message limits,
manager inbox, booking-only mode, blocklist); (E) admin: creator applications, portfolio review,
fan-interaction rules, creator reports. Investigate → plan → confirm → build → verify.
```
**Acceptance:** creator builds portfolio; requests verification; receives collaboration requests;
controls fan messages; admin reviews creator verification.

---

## Phase 5 — AI & Trust expansion
**Covers:** PRD §21.2 AI services, §12.3 nudges, §19.19 AI screens (294–305); group/double date
(§13.4, screens 206–215); circles (§16, screens 261–273); scam-shield admin console (§18).

**Kickoff prompt:**
```
PHASE 5 — AI assistance + trust expansion for Paymax Connect. Read CLAUDE.md + PRD §12, §16, §21.2, §27.
Slices: (A) AI Profile Coach (bio/prompt/photo guidance; warn against unsafe personal info);
(B) AI Conversation Assistant (respectful openers, intros, follow-ups — MUST NOT produce
manipulative, sexual, harassing, or deceptive content); (C) AI Match Explanation; (D) AI Safety
Shield service hardening (romance-scam scripts, reused-text, money requests, link scoring,
deepfake-suspicion, bot behavior) with stored reason codes + moderator review; (E) group/double
date; (F) communities/circles. Every AI moderation decision stores reason codes. Investigate →
plan → confirm → build → verify.
```
**Acceptance:** AI coach/assistant produce safe, on-policy output; scam-shield flags store reason
codes and surface to moderators; group date + circles function with moderation.

---

## Phase 6 — Monetization & ecosystem
**Covers:** PRD §17 monetization, §19.20 subscription screens (306–320); Paymax wallet, boosts,
event passes; Paymax Mobility (ride) + Events (tickets) integration; admin subscription/finance.

**Kickoff prompt:**
```
PHASE 6 — Monetization + ecosystem for Paymax Connect. Read CLAUDE.md + PRD §17, §19.20, §27.
ALL payments via existing Paymax wallet/payment infra; entitlements validated SERVER-SIDE
(never hard-coded in mobile). Slices: (A) premium plans + tiers (Connect Plus/Pro/Elite,
Creator Pro) with backend entitlement checks; (B) subscribe/cancel/manage + payment history +
refunds; (C) boosts, super-likes, event passes; (D) Paymax Mobility (date rides) + Paymax Events
(tickets) integration in the date planner; (E) admin: plan setup, pricing, promo codes,
reconciliation, revenue reports. Investigate → plan → confirm → build → verify.
```
**Acceptance:** subscribe via Paymax wallet; entitlements enforced server-side; boosts/passes
purchasable; rides/tickets bookable from date planner; admin manages plans + reconciles payments.

---

## Standing reminders (apply to every phase)
- One phase at a time; vertical slices; plan → confirm → build → verify.
- Cite PRD section numbers in plans and PRs.
- Never weaken a CLAUDE.md safety invariant; never implement §24 "Must Not Have" items.
- Backend owns flags/weights/entitlements/moderation rules — mobile reads them.
- If a slice grows too large for one session, split it and keep each piece independently verifiable.
