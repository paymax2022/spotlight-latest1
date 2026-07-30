# Groups & Associations — UAT Baseline Sweep (Pass 0)

**Date:** 2026-07-29 · **Target:** `/association` on Expo web `http://localhost:8083` · **Plan:** `Groups_Associations_Test_Plan.md` (212 cases, TS-1..TS-19)
**Method:** hybrid — live drive of the running app (authenticated as a throwaway synthetic Supabase user, mock mode) + code-level classification of every suite against `mobile-app/reactnative/…/association`, `backend/internal/association`, `frontend-admin`, and the backend test suites.

> **Scope note (critical):** The running app is in **MOCK mode** (`EXPO_PUBLIC_ASSOCIATION_USE_MOCK` unset ⇒ `USE_MOCK=true`). Every mobile screen reads `src/features/association/api/*.mock.ts`; it does **not** hit the Go backend. So "screen works" ≠ "invariant enforced." Per plan §0.4, **no P0 (election/money/privacy) row may be marked ✅ Pass on mock/static reasoning** — it needs an executed assertion. Where a backend assertion exists it is called out explicitly.

---

## 1. Executive summary

The association module is a **broad, stable, well-built front-end shell** (70+ screens, zero console errors across the whole live sweep, graceful loading/empty/error states via a shared `StateView`) sitting on a **partially-complete backend** whose **money + membership + RBAC core is genuinely solid and now proven against a live DB**, but whose **election, privacy/IDOR, PII, audit-immutability, and real-time (calls/AI) layers are missing or unenforced.**

**Verification win this pass:** the previously-unrun, `TEST_DATABASE_URL`-gated integration suite (`backend/tests/association/live_db_integration_test.go`) was executed against local Postgres — **17/17 PASS**. This upgrades the money/membership/RBAC P0s from "transcribed in CI" to **executed real-SQL assertions**:
charge-once idempotent, balanced double-entry, owner-only invoice pay, idempotency-key required (fail-closed), approve/reject membership activation, finance-RBAC + maker-side on offline payments, no self-escalation on AssignRole, publish-org audit, reject-without-terms.

### Baseline verdict distribution (212 cases)

| Bucket | Count | Meaning |
|---|---:|---|
| ✅/🏗️ Built & working | ~35 | Implemented; screen exists and functions (mostly money path + screen shells) |
| 🚧 Partial | ~90 | Present but incomplete / mock-only / not enforced server-side |
| 🚫 Missing | ~86 | Not built |
| ➖ N/A | 1 | MB-020 device farm (manual) |

**Production-readiness gate (§0.5): NOT MET.** Multiple P0 blockers remain (below). The module is **demo-grade**, not integrity-safe.

---

## 2. P0 / S0 release blockers (fix first)

| # | Area | Finding | Evidence | Remediation |
|---|---|---|---|---|
| B1 | **Elections (whole)** | **No association election backend exists.** `governance.tsx` deep-links OUT of `/association` to `/election?id=…` — the standalone **Estate** module in client mock mode. Live-confirmed: screen titled "Estate Election", copy "…run Amber Court". No association ballot/tally/roll persistence; one-vote & tally are client-side only. | `backend/internal/{association,groups}` grep: zero election code; `governance.tsx`→`app/election/*`; `election.constants.ts` USE_MOCK default true | Build an association-scoped election service (positions, candidates, `assoc_election_votes UNIQUE(election_id,position_id,voter_id)`, Redlock, window+eligibility gates, tally) **or** bind to a hardened association-scoped backend. Flip mock off; add integration tests. |
| B2 | **Ballot secrecy** | Even the borrowed estate backend stores `voter_id` + `candidate_id` in the **same row** → any service_role/admin can link voter→choice. `votebridge` writes voter→choice into the ledger ref. | `supabase/migrations/20260616250000_estate.sql:82-88`; `estate/service.go:254`; `votebridge/handler.go:34` | Separate anonymized ballot store (blind token / choice-only table, no voter FK) from a distinct turnout marker. |
| B3 | **Eligibility fails OPEN** | Mobile default path returns `eligible:true` on read error, and mock always eligible. Live-confirmed: governance banner says "in good standing" for a member with a **58-day-overdue** levy. Violates §4.12 fail-closed. | `election.api.ts:82-85`; live `governance` screen | Fail closed on eligibility errors; make eligibility server-authoritative and tied to dues standing. |
| B4 | **Cross-group IDOR** | Chat thread read/write and AI-notes get/set are **not org-scoped**; admin decision/suspend/role ops act on any org's id. Admin/member of org A can read/write org B. | `service_ext.go:300,376,412,432,454`; `service.go:258,1013`; `service_actions.go:210,277` | Add `AND organisation_id = <caller org>` + membership/committee checks on every by-id read/write; fail-closed. Add negative IDOR tests. |
| B5 | **Membership card verification** | No verify/scan endpoint or verifier screen; QR = **unsigned plaintext** `assoc:<memberId>`. Forged/revoked/expired cards cannot be detected. | `service.go:443`; no verify route in `routes.go`; `join/scan.tsx` scans join-codes only | Signed QR (HMAC/JWS) + server verify endpoint + verifier screen; offline signed-token w/ anti-replay. |
| B6 | **Card validity not tied to dues** | `payment_standing`/`valid_through` are static columns; `PayInvoice` never recomputes them; card renders **Active/Verified** despite arrears. Live-confirmed on member with overdue levy. | `service.go:127`; `MembershipCardView.tsx:25`; live `card`/`home` | On pay/arrears, recompute standing + valid_through; derive card validity from unpaid invoices. |
| B7 | **Audit log mutable** | `assoc_audit_log` has no append-only trigger/REVOKE/RLS; rows updatable/deletable; no before→after; many sensitive actions unaudited. Retroactive edits to results/minutes not blocked. | migration `…association_module.sql:374`; `service.go:1097` | Append-only enforcement (trigger + REVOKE UPDATE/DELETE / RLS); capture before→after+reason; seal results at close. |
| B8 | **PII plaintext at rest** | email/phone/dob/next_of_kin/emergency stored plaintext, no encryption/RLS. | migration `…association_module.sql:90` | Encrypt sensitive columns (pgcrypto/app-layer) + RLS; audit PII reads. |
| B9 | **No maker–checker** | Offline-payment approval and membership approval are single-approver. | `service_actions.go:210`; `service.go:258` | Require 2nd approver on money/membership/election-sensitive ops. |
| B10 | **Subscription-gated calls absent** | No voice/video call screen, no RTC, **no subscription gate** anywhere. `meetings/[id].tsx` shows only a "Video/Physical" label. §4.5 unimplemented. | grep webrtc/agora/twilio/livekit/jitsi → 0 hits; `meetings/[id].tsx:51` | Build calls (or integrate RTC) with entitlement gate + recording consent; or de-scope from P0 with sign-off. |
| B11 | **AI-notes consent + IDOR + fidelity** | No consent capture before record/transcribe (live-confirmed: passive caption only); `getAiNote(id)` returns/​fabricates any note (IDOR); no source-attribution/fabrication controls. | `ai-notes/new.tsx:28,72`; `ainotes.api.ts:28,96`; `service_ext.go:412` | Consent gate + participant notice; org/attendee scoping fail-closed; source-segment attribution + uncertainty flags. |
| B12 | **Non-atomic dues settlement** | `DecideOfflinePayment` commits invoice tx then posts ledger in a **separate tx** → crash-between leaves PAID with no ledger entry (fail-open). | `service_actions.go:240-261` | Single tx (or outbox) so invoice-PAID and ledger post commit atomically. |
| B13 | **Closed/secret groups discoverable** | `GetOrganisations` filters only `published=true`; CLOSED orgs appear in discovery/search (live: NMA "Closed" shown). §4.9 privacy. | `service.go:302`; live `index` | group_type-aware discovery gating; invite/approval-only for closed/secret. |

Plus admin-portal P0 gaps: **AD-003** card admin, **AD-006** election audit/export, **AD-016** kill switch (suspend group / halt election / freeze finances) — all MISSING.

---

## 3. Live-drive log (what was actually exercised on :8083)

Authenticated via a throwaway synthetic Supabase user (session injected to `localStorage[paymax_secure_sb-127-auth-token]`; transaction PIN `1234` set as fixture). Screens visited render correctly with mock data and **no console errors**:

- **Discovery** (MB-002): search, Invite/Access/Scan join methods, org cards with membership-type badges, Create FAB. ✔
- **Home** (MB-001): membership summary, outstanding-dues + Pay, role-aware quick actions. ✔
- **Card** (MB-003): QR, Share/Download, offline-verification copy. ✔ (⚠ shows Active+Due, see B6)
- **Directory** (MB-004): search + All/Active/Pending/Suspended filters + status badges. ✔
- **Dues** (MB-015): balance, All/Outstanding/Paid, Due/Overdue/Paid invoice cards. ✔ (⚠ balance ₦20,000 ≠ Σ unpaid ₦25,000 — see D-L1)
- **Governance** (MB-013): eligibility banner, active election, admin setup. ✔ (⚠ B1/B3)
- **Election/Voting** (MB-014): opened `/election?id=elec_2026_exco` — **Estate** module, positions + candidates + Cast vote. ✔ render / ✗ integrity (B1/B2)
- **Admin console** (MB-018): KPIs, dues YTD/outstanding, approval queue, finance, bulk upload, manage members. ✔
- **New AI note** (MB-010): sources + Start recording. ✔ render / ✗ consent (B11)
- **Error state** (MB-019): bogus org id → graceful "Couldn't load / Retry". ✔

### Additional live findings
- **D-L1 (DU-004/DU-010):** Dues "Outstanding balance" ₦20,000 excludes the ₦5,000 overdue Lagos Chapter levy (Σ unpaid = ₦25,000). Arrears total under-counts. Verify mock vs. real `service.go:100`.
- **D-L0 (app-wide, minor):** transaction-PIN onboarding renders digits in plaintext during entry (not the association module).
- **MT-006 dead control:** "View published minutes" Pressable has no `onPress` (`meetings/[id].tsx:141`).

---

## 4. Rollup (§20) — baseline classification

Legend: **B**=Built/working · **P**=Partial (incl. mock-only/unenforced) · **M**=Missing.

| Suite | Total | B | P | M | Key P0 blockers |
|---|---:|---:|---:|---:|---|
| TS-1 Setup/Membership/Roles | 12 | 6 | 3 | 3 | GR-004 closed discoverable (B13), GR-010 IDOR (B4), GR-007 no revoke/handover |
| TS-2 Membership Card | 9 | 1 | 2 | 6 | MC-002 (B6), MC-003/004/005 verification (B5) |
| TS-3 Directory | 6 | 2 | 3 | 1 | DR-004 IDOR (B4); DR-003 masking real but mock-unverifiable |
| TS-4 Group Chat | 10 | 0 | 7 | 3 | CH-005 chat IDOR (B4); CH-007 idempotency ignored server-side |
| TS-5 Voice/Video Calls | 10 | 0 | 0 | 10 | Entire suite absent (B10) |
| TS-6 Meetings & Reminders | 8 | 0 | 5 | 3 | MT-008 committee-private not scoped; MT-006 dead control |
| TS-7 Events & Ticketing | 8 | 0 | 2 | 6 | EV-004 unsigned ticket QR / no single-use; EV-003 charge unverifiable |
| TS-8 Documents | 8 | 0 | 6 | 2 | DC-004 restriction client-side only |
| TS-9 AI Notes | 10 | 0 | 4 | 6 | AI-001 consent, AI-007 IDOR, AI-005 fidelity (B11) |
| TS-10 Tasks & Tracker | 12 | 0 | 7 | 5 | AT-003 state machine unenforced; AT-009 convert not idempotent |
| TS-11 Committees | 5 | 0 | 2 | 3 | CM-002 isolation (chat IDOR) |
| TS-12 Announcements/Notif | 7 | 0 | 7 | 0 | AN-007 PII in bodies; AN-001 no admin broadcast path |
| TS-13 Elections & Voting | 18 | 0 | 11 | 7 | B1/B2/B3 + tally not tamper-evident + no handover |
| TS-14 Subscription & Dues | 14 | 4 | 6 | 4 | Core proven (DU-006/008/010/013); refunds/exemptions/installments missing; B12 |
| TS-15 Security/Privacy/RBAC | 10 | 2 | 4 | 4 | B4 IDOR, B7 audit, B8 PII, B9 maker-checker |
| TS-16 Non-Functional | 10 | 1 | 4 | 5 | NF-004 atomicity (B12); no perf/observability |
| TS-17 Edge & Chaos | 18 | 0 | 9 | 9 | EC-004 secrecy, EC-013 cross-group, EC-017 immutability |
| TS-18 Mobile Screens | 20 | 17 | 1 | 1 (+1 N/A) | MB-006 calls missing (B10); MB-019 offline/NS not auto-wired |
| TS-19 Admin Portal Screens | 17 | 2 | 7 | 8 | AD-003 card admin, AD-006 election audit, AD-016 kill switch |
| **TOTAL** | **212** | **~35** | **~90** | **~86** | 13 P0 blocker themes |

---

## 5. Backend test status
- `go vet ./internal/association/... ./internal/groups/...` — clean.
- `go test ./internal/association/... ./internal/groups/... ./tests/association/...` — **PASS** (money_invariants transcribed).
- **`live_db_integration_test.go` against local Postgres (`TEST_DATABASE_URL=…54322`) — 17/17 PASS** (executed this sweep). Recommend wiring this into a CI lane with Testcontainers so money/RBAC/membership stay asserted, not transcribed.

---

## 6. Recommended remediation order (next passes)
1. **Elections rebuild (B1–B3) + handover (EL-015)** — highest risk; governance integrity. Backend-first, tests-first, ballot-secrecy by construction.
2. **IDOR sweep (B4, CH-005, AI-007, admin cross-org) + closed-group discovery (B13)** — one focused backend PR adding org/membership scoping + negative tests; run against local DB.
3. **Card integrity (B5, B6)** — signed QR + verify endpoint + standing recompute on pay.
4. **Audit immutability (B7) + PII encryption (B8) + maker-checker (B9) + atomic settlement (B12)** — data-integrity PR.
5. **AI-notes consent/scoping (B11); calls decision (B10 — build or de-scope w/ sign-off).**
6. Feature completion: dues refunds/exemptions/installments; admin portal AD-003/006/016; meetings/committees/events CRUD; real-time chat + moderation.
7. Wire live-DB + IDOR + election-integrity suites into CI as merge-blocking P0 gates.

---

## 7. Pass 1 remediation — IDOR + closed-group sweep (backend)

**Status: DONE, tests green against local Postgres (`-race`).** Tests-first: `backend/tests/association/idor_scope_test.go` (11 new live-DB cases) written before the fixes; all pass, plus the existing 17 live-DB cases still green.

Fixed (all fail-closed; cross-org attempts now return `ErrForbidden`/not-found):
- **B4 / SEC-001 / CH-005 / AI-007 / EC-013 cross-group IDOR:**
  - `GetChatThread`, `SendChatMessage`, `ReactToMessage`, `MuteThread` — scoped to caller's ACTIVE membership in the *thread's* org (ReactToMessage/MuteThread found during the security-review pass). (`service_ext.go`, `service_detail.go`)
  - `GetAiNote`, `GetAiNoteStatus`, `ConvertActionItem`, `SetAiNoteStatus` — org-scoped (reads require membership; status-write requires admin *in the note's org*). (`service_ext.go`)
  - `GetDirectory` — restricted to orgs where the viewer holds an ACTIVE membership. `GetMember` — requires a shared org. (`service.go`)
  - Admin ops `DecideApplication`, `DecideOfflinePayment`, `SuspendMember`/`RestoreMember`, `TransferMember`, `AssignRole`, `GetApplication` — new `requireCapInOrg`/`requireAdminInOrg` helpers enforce the capability **in the target resource's org**. (`service.go`, `service_actions.go`)
  - **`DecideApplication` also had NO authorization at all** (any authenticated user could approve/activate any application) — now gated. (`service.go`)
- **B13 / GR-004 invite-only discovery:** `GetOrganisations` excludes `INVITE_ONLY`; `GetOrganisation` hides `INVITE_ONLY` detail from non-members (adds `viewerID`). (`service.go`, handlers updated.)
- **Latent bug found + fixed:** `GetChatThread` selected `t.description`, a column that does not exist on `assoc_chat_threads` — every thread read would have errored. Now selects a literal `''`.

**CM-002 (committee/executive CHAT isolation) — DONE (follow-up commit).** Added a nullable `assoc_chat_threads.committee_id` (additive migration `20260730120000`) and scope-aware gating via a new `assertThreadAccess` guard: EXECUTIVE threads → org admins/execs; COMMITTEE threads → ACTIVE members of the linked committee (unlinked/legacy → org-scoped fallback); GENERAL/EVENT unchanged. Applied to `GetChatThread`/`SendChatMessage`/`ReactToMessage`/`MuteThread` and the `GetChatThreads` list filter. Tests-first: `cm002_committee_chat_test.go` (4 live-DB cases). Committee-scoping for **meetings & documents** (also part of CM-002) remains open.

Still open (staged follow-ups): committee scoping for meetings/documents, role-based chat posting, closed-group *join-link* leak (EC-008), non-atomic offline-settlement (B12/NF-004), and all other P0s (B1–B3 elections, B5–B11).

**Required before merge (CLAUDE.md):** `security-reviewer` sign-off (auth/PII paths) and `ledger-auditor` review (touches `DecideOfflinePayment` money path — change adds an authz gate only, no ledger-logic change). Wire `tests/association` live-DB lane into CI so these stay asserted.

---
*Baseline (§1–§6) changed no code — assessment only. §7 is the Pass-1 remediation. Money/security/election fixes are deferred to dedicated tests-first PRs with ledger-auditor / security-reviewer / electoral sign-off as CLAUDE.md requires. Throwaway synthetic test user is local-only and disposable.*
