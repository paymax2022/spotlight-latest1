# Spotlight Connect — World-Class Master Test Plan & Test Cases

**Module:** Spotlight **Connect** — unified professional networking (LinkedIn-style) + social/dating networking (Bumble-style)
**Version:** 1.0 · **Date:** 2026-07-27 · **Owner:** QA + Product Engineering (Trust & Safety)
**Format:** Executable Markdown for use inside **Claude Code** (rigorous file testing, remedial action & production-readiness closure)
**Audiences:** Member (professional + dating personas) · Recruiter / Business · Trust & Safety Moderator · Admin / Compliance / Super Admin
**Goal:** rigorously test (manual + automated) every area, then **close out every bug, issue and undone task — including fully building the mobile app screens and admin portal to production grade — so the entire module ships production-ready.**

---

## 0. How Claude Code Should Use This File

This is a **test plan**, an **executable checklist**, and a **production-readiness closure backlog**. Every row in every `TC-*` table is a unit of work. Drive every row to `✅ Pass` — **building what's missing, fixing what's broken, finishing what's undone (including screens)** — because Connect handles identity, personal/sensitive data and real-world introductions between people, the bar is *trust-safe & production-ready*, not *demo-ready*.

### 0.1 Execution & closure protocol (per test case)

1. **Locate** the code/screen under test — map the *Area/Component* to file(s)/service(s)/screen(s)/endpoint(s). Record the path in *Remedial Action / Notes*. If nothing implements it → **gap**.
2. **Classify current state:**
   - **Not built / screen missing / task undone** → `🚫 Missing`. Specify what to build (endpoint, guard, model, mobile screen, admin screen, migration) to satisfy *Expected Result*, then build it to production grade.
   - **Built + automated test exists** → **run it**.
   - **Built, no test but automatable (`Auto=Y`)** → **write/scaffold** the test, then run.
   - **Manual/static/visual (`Auto=M`)** → **statically verify** the implementation/screen satisfies *Expected Result* (read the flow, guard, state machine; verify the screen’s states).
3. **Judge** against *Expected Result* — assert on observable behaviour (states, access decisions, safety blocks, records written, audit entries, rendered screen states), never internals.
4. **Set Status** using the legend below.
5. **On `❌ Fail` / `🚫 Missing` / `⚠️ Blocked`** — remediate: build/fix the code or screen, **write the failing test first** so it now passes; record **root cause / what was missing**, the **fix (file + change)**, and the **regression test added**.
6. **Log** in §24 (Defect & Task Log). Flip Status to `🔧 Fixed` (was broken) or `🏗️ Built` (was missing) once green.
7. **Re-run** until the Production-Readiness Gate (§0.5) is met — including all mobile and admin screens.

### 0.2 Status legend (use these exact tokens in the Status column)

| Token | Meaning |
|---|---|
| `⬜ Not Run` | Not yet executed (default) |
| `✅ Pass` | Behaviour/screen matches Expected Result |
| `❌ Fail` | Built but deviates — fix required |
| `🚫 Missing` | Not built / screen missing / task undone — build required |
| `⚠️ Blocked` | Cannot execute (dependency/env/data/upstream) |
| `🚧 Partial` | Partially built/passing — finish + fix |
| `🔧 Fixed` | Was `❌`; fixed and re-verified green |
| `🏗️ Built` | Was `🚫`; implemented to production grade and now passing |
| `➖ N/A` | Not applicable to current build/flags |

### 0.3 Priority · Automation legends

`P0` **release-blocking: user safety, identity/privacy, minor protection, or payment** — 100% must pass · `P1` critical · `P2` high · `P3` medium/low.
`Auto=Y` automate (unit/API/integration/e2e) · `Auto=M` manual/static/visual · `Auto=P` partially automatable.

### 0.4 Remediation quality bar

Done only when: root cause fixed or feature/screen built to spec, a **failing test written first** now passes, no P0/P1 regression, covered in CI. Correctness, safety, privacy and auditability over cleverness. **Never mark `✅ Pass` on static reasoning alone for safety, privacy, minor-protection or payment cases** — those require an executed, deterministic assertion. **No real user PII in tests** — use synthetic members and mock integrations.

### 0.5 Production-Readiness Gate (definition of done)

Production-ready when **all** hold:
- **0** `🚫 Missing` and **0** `❌ Fail` across every **P0 and P1** row, **including every mobile and admin screen** in TS-16/TS-17.
- **Safety invariants (§4) hold under test**: minors are kept out of dating; blocking is absolute and mutual-invisibility holds; report→moderation→action works; no location precision leak; image/text moderation fires; consent (mutual match) precedes contact.
- **Privacy invariants hold**: personas are isolated (professional vs dating), profile visibility honors settings, no cross-user data leakage (IDOR), PII minimally exposed and audited.
- **Integrity/idempotency**: no duplicate match, connection, message, or charge under retries; every safety and admin action is attributable and immutable.
- **Payments** (subscriptions, boosts, super-likes, InMail) reconcile; refunds safe and single.
- **Screens**: all mobile and admin screens exist, handle loading/empty/error/permission/blocked states, are accessible, and match the audited fixes.
- Automated regression + security suites green in CI; sign-off from QA, **Trust & Safety**, and Compliance recorded.

---

## 1. Scope

**In scope:**
- **Identity & profiles:** onboarding, verification (photo/ID/employer), dual persona (Professional & Dating), profile fields, visibility & privacy settings, account states.
- **Professional networking (LinkedIn-style):** rich professional profile (experience, skills, education), connections (request/accept), follow, endorsements/recommendations, feed/posts, job posts & applications, recruiter/business tools, InMail/messaging, search & discovery.
- **Social/dating networking (Bumble-style):** dating profile, preferences & filters, discovery deck / swipe, matching (mutual like), women-message-first / first-move rules, super-like/boost, match expiry, ice-breakers, safe chat, video/voice date, location-based discovery.
- **Matching & recommendation engine:** ranking, filters (age, distance, intent, industry), mutual-consent gating, deduplication, fairness.
- **Messaging:** 1:1 chat, media, read receipts, typing, moderation, safety tooling, InMail vs match-chat separation.
- **Trust & Safety:** block/report/unmatch, image & text moderation, verification badges, minor protection, anti-catfishing, anti-harassment, romance-scam detection, rate/velocity abuse.
- **Monetization:** subscription tiers (Premium/Recruiter), boosts, super-likes, InMail credits, wallet/payments.
- **Notifications, mobile app screens, admin/moderation portal, RBAC & security, non-functional, edge/chaos.**

**Out of scope (other plans):** base identity/auth internals; core wallet/payment-processor internals (tested at boundary); other super-app modules. Tested here at the boundary.

## 2. Test Approach

- **Pyramid:** deterministic **unit** tests on matching/consent rules, visibility/access rules, state machines, moderation gating, minor logic; **integration** tests on match→chat→safety flows, feed/search, payments, moderation adapters (mock); thin **e2e** on member journeys and moderator/admin flows; **visual/UX** verification of every mobile & admin screen.
- **Golden/deterministic fixtures:** synthetic members across ages, personas, orientations, locations; block/report scenarios; moderation test images/text (safe placeholders); payment sandbox. Fixed clocks/seeds.
- **Adversarial testing** for cross-persona leakage, block bypass, minor-in-dating, location de-anonymization, IDOR on profiles/chats, moderation evasion, and payment/refund abuse.
- **Chaos/resilience** for chat delivery under failure, moderation backlog, match-write races, notification storms.
- **No real user PII, no live moderation vendors, no real payments in tests.**

## 3. Test Environments & Data

| Env | Purpose | Notes |
|---|---|---|
| Unit/CI | Pure deterministic logic | No I/O; fastest; gates every PR |
| Integration | Mock moderation/geo/payment + test DB | Deterministic fixtures; Testcontainers DB |
| Staging | Production-like | Full stack; sandbox chat/geo/pay; perf/security regression; device farm for screens |
| Prod (guarded) | Post-deploy smoke + synthetic monitoring | Synthetic members; no real matches surfaced to real users |

**Data:** synthetic members with dual personas; minors (for negative gating tests); geo fixtures (near/far/boundary, spoofed); moderation fixtures (safe stand-ins for disallowed content); subscription/boost sandbox; blocked/reported pairs. **Never real PII; never real people’s photos.**

## 4. Critical Safety, Privacy & Integrity Invariants (assert across suites)

1. **Minor protection**: users under the platform’s minimum age are blocked from the dating experience entirely; age is verified/enforced; no adult–minor matching is ever possible.
2. **Mutual consent before contact (dating)**: no user can message another in the dating context without a mutual match; “first-move” rules (e.g., women message first) are enforced where configured.
3. **Blocking is absolute & mutual-invisible**: a blocked user cannot view, match, message, search-find, or be recommended the blocker; both disappear from each other’s surfaces immediately and permanently until unblocked.
4. **Persona isolation**: professional and dating personas, data and discovery are separated; dating activity never leaks into professional surfaces (colleagues/recruiters) or vice-versa, per user settings.
5. **Location privacy**: only coarse/necessary location is exposed; exact coordinates never leak; distance is fuzzed; location updates stop per settings.
6. **Report→moderation→action**: every report creates an auditable case; moderation decisions (warn/limit/suspend/ban/remove) are enforced and attributable; critical reports (CSAM, threats) escalate.
7. **Content moderation fires**: profile photos and text and chat media pass moderation (nudity, CSAM, violence, hate, scam patterns) before/at publish; hard stops on illegal content.
8. **No cross-user data leakage (IDOR)**: a user can only access their own profile edits, matches, chats, and settings.
9. **Idempotency**: no duplicate match, connection, like, message, or charge under retries/concurrency.
10. **Payment correctness**: subscriptions/boosts/credits charge exactly once, entitlements granted correctly, refunds safe and single.
11. **Attribution & immutability**: safety and admin actions are logged immutably (actor/time/before→after/reason).
12. **Fail-safe**: safety-critical paths (block, report, minor gate, moderation) fail closed, never fail open.

---
## 5. Test Suites & Cases

> Columns: **ID · Test Case · Type · Pri · Preconditions · Steps (summary) · Expected Result · Auto · Status · Remedial Action / Notes**
> All rows default to `⬜ Not Run`. Claude Code fills Status + Remedial Action during execution/closure.

> **Execution status:** see `EXECUTION-LOG.md` (same folder) for the live baseline, per-suite
> classification, defect log, and remaining P0 backlog. Fixes landed this pass (all with executed
> tests in `backend/tests/connect/`): **D-001** block-absolute across all surfaces, **D-002** report
> severity routing, **D-003** minor-in-deck defense-in-depth, **D-004** moderation ban/suspend enforcement.

### TS-1 · Onboarding, Identity & Verification

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| ON-001 | Sign-up + phone/email OTP verification | Functional | P1 | New user | Register → verify | Account created; verified; audit written | Y | ⬜ Not Run | — |
| ON-002 | Age capture & minimum-age gate for dating | Safety | P0 | Under-age DOB | Enable dating persona | Dating blocked; only allowed experiences shown | Y | ⬜ Not Run | — |
| ON-003 | Age tamper / edit-after attempts | Safety | P0 | Verified age | Try to change DOB to bypass | Blocked/re-verification; no minor in dating | Y | ⬜ Not Run | — |
| ON-004 | Photo/selfie liveness verification badge | Trust | P0 | Onboarding | Submit selfie | Verified badge on match; anti-catfish | P | ⬜ Not Run | — |
| ON-005 | Government-ID verification (optional/gated) | Compliance | P1 | ID submit | Verify | Badge; encrypted; access audited | Y | ⬜ Not Run | — |
| ON-006 | Employer/professional verification (LinkedIn-style) | Functional | P1 | Work email/domain | Verify | Professional badge; correct company | Y | ⬜ Not Run | — |
| ON-007 | Dual-persona creation (Professional + Dating) | Functional | P1 | Verified user | Enable both | Two isolated personas created | Y | ⬜ Not Run | — |
| ON-008 | Consent to community guidelines & data terms | Compliance | P0 | Onboarding | Proceed w/o consent | Blocked until consented; versioned | Y | ⬜ Not Run | — |
| ON-009 | Duplicate/multi-account & ban-evasion detection | Trust | P1 | Banned device/user | Re-register | Flagged/blocked per policy | P | ⬜ Not Run | — |
| ON-010 | Account deletion / data-subject request | Compliance | P1 | Member | Request deletion | Data removed/anonymised; matches/chats handled; audited | Y | 🏗️ Built | D-008: DELETE /api/v1/connect/account cascade (anonymise+erase+graceful matches+audit, idempotent); TestConnectAccountDeletionCascade |

### TS-2 · Profiles, Personas & Visibility (Privacy-critical)

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| PF-001 | Professional profile (experience, skills, education) | Functional | P1 | Member | Build profile | Fields saved; render correct | Y | ⬜ Not Run | — |
| PF-002 | Dating profile (photos, bio, intent, interests) | Functional | P1 | Member | Build profile | Saved; used in discovery | Y | ⬜ Not Run | — |
| PF-003 | Persona isolation — dating hidden from professional surfaces | Privacy | P0 | Dual persona | View as colleague/recruiter | Dating profile not visible; no leak | Y | ⬜ Not Run | — |
| PF-004 | Profile visibility settings (public/connections/hidden) | Privacy | P0 | Settings | Set visibility | Enforced across search/feed/discovery | Y | ⬜ Not Run | — |
| PF-005 | Incognito / private browsing (view without being seen) | Privacy | P1 | Premium | Browse | Viewed users don’t see viewer per tier rules | Y | ⬜ Not Run | — |
| PF-006 | Profile edit versioned; photo moderation on upload | Trust | P0 | Edit | Upload disallowed photo | Moderated/blocked pre-publish | P | ⬜ Not Run | — |
| PF-007 | Block list of fields (no contact info in bio) | Trust | P2 | Bio | Insert phone/handle | Stripped/flagged per policy | Y | ⬜ Not Run | — |
| PF-008 | Cannot view another user’s private profile (IDOR) | Security | P0 | Two users | Access by ID | 403; visibility rules enforced | Y | ⬜ Not Run | — |
| PF-009 | Profile completeness & verification affect ranking | Functional | P2 | Profiles | Compute | Complete/verified ranked appropriately | Y | ⬜ Not Run | — |
| PF-010 | Sensitive attributes (orientation, religion) optional & protected | Privacy | P0 | Profile | Set sensitive fields | Optional; access-controlled; not leaked | Y | ⬜ Not Run | — |

### TS-3 · Professional Networking (LinkedIn-style)

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| PN-001 | Send / accept / decline connection request | State machine | P1 | Two members | Request→accept | Correct states; mutual connection formed | Y | ⬜ Not Run | — |
| PN-002 | Follow (asymmetric) vs connect (mutual) | Functional | P2 | Members | Follow | Follower/following correct; no mutual needed | Y | ⬜ Not Run | — |
| PN-003 | Connection limits / spam-invite throttling | Trust | P1 | Mass invites | Send many | Throttled; abuse flagged | Y | ⬜ Not Run | — |
| PN-004 | Endorsements & recommendations | Functional | P2 | Connection | Endorse | Recorded; attributable; removable | Y | ⬜ Not Run | — |
| PN-005 | Feed: create post, like, comment, share | Functional | P1 | Member | Post | Renders; interactions correct; moderated | Y | ⬜ Not Run | — |
| PN-006 | Feed ranking & no disallowed content | Trust | P1 | Feed | Load | Relevant; moderated; no leaked private posts | P | ⬜ Not Run | — |
| PN-007 | Job posting create & application flow | Functional | P1 | Recruiter | Post job / apply | Job live; applications routed; status tracked | Y | ⬜ Not Run | — |
| PN-008 | Recruiter search & InMail (paid) | Functional | P1 | Recruiter tier | Search+InMail | Gated by tier/credits; delivered | Y | ⬜ Not Run | — |
| PN-009 | Professional search & filters | Functional | P2 | Members | Search | Correct results; visibility-respecting | Y | ⬜ Not Run | — |
| PN-010 | Mutual connections / network graph correctness | Correctness | P2 | Graph | Query | Correct degrees; no phantom links | Y | ⬜ Not Run | — |
| PN-011 | Block hides professional profile & content too | Privacy | P0 | Blocked pair | Search/feed | Blocked user invisible in professional surfaces | Y | 🔧 Fixed | D-001: feed+professional Discover now block-aware; test block_absolute_live_db_test.go |

### TS-4 · Dating Discovery & Matching (Bumble-style)

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| DM-001 | Discovery deck respects filters (age, distance, intent) | Correctness | P1 | Preferences | Load deck | Only eligible profiles shown | Y | ⬜ Not Run | — |
| DM-002 | Like / pass / super-like actions | Functional | P1 | Deck | Swipe | Recorded once; deck advances | Y | ⬜ Not Run | — |
| DM-003 | Mutual like creates a match | State machine | P0 | Two likes | Both like | Match created exactly once; both notified | Y | ✅ Pass | matching/service.go reciprocal→match (tx); swipe_test.go |
| DM-004 | No contact before mutual match | Safety | P0 | One-sided like | Try to message | Blocked until mutual | Y | ✅ Pass | chat/service.go requires status='matched'+participant; +RLS backstop |
| DM-005 | First-move rule (e.g., women message first) | Business rule | P1 | Hetero match | Wrong party messages | Enforced per config; other party blocked from first msg | Y | ⬜ Not Run | — |
| DM-006 | Match expiry (e.g., 24h to message) | State machine | P1 | Match | Let timer lapse | Expires per rule; extend option per tier | Y | ⬜ Not Run | — |
| DM-007 | Minor never appears in adult deck (and vice-versa) | Safety | P0 | Age fixtures | Load decks | Absolute age-appropriate separation | Y | 🔧 Fixed | D-003: deck age predicate + Like refusal (ErrIneligibleTarget); test DM-007 subtest |
| DM-008 | Blocked/reported user never recommended | Safety | P0 | Blocked pair | Load deck | Never surfaced | Y | 🔧 Fixed | D-001: discovery candidateQuery bidirectional block predicate; test DM-008 subtest |
| DM-009 | Already-seen/passed not re-shown (dedup) | Correctness | P2 | Deck | Re-load | No repeats (per rewind rules) | Y | ⬜ Not Run | — |
| DM-010 | Rewind/undo last swipe (premium) | Functional | P2 | Premium | Undo | Restores previous card per tier | Y | ⬜ Not Run | — |
| DM-011 | Daily like limits (free vs premium) | Business rule | P1 | Free tier | Exceed likes | Limited; upsell; premium unlimited | Y | ⬜ Not Run | — |
| DM-012 | Boost increases visibility for window | Functional | P2 | Boost bought | Activate | Higher placement for duration; then reverts | Y | ⬜ Not Run | — |
| DM-013 | Matching fairness / no manipulation of one side | Fairness | P2 | Engine | Audit | No unfair suppression; documented ranking | P | ⬜ Not Run | — |
| DM-014 | Match write race (both like simultaneously) | Concurrency | P0 | Concurrent likes | Race | Exactly one match; no duplicate/no missed | Y | 🔧 Fixed | D-005: pg_advisory_xact_lock on canonical pair → exactly-once; TestConnectMatchRaceExactlyOnce (was 24/25 missed) |
### TS-5 · Messaging & Communication

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| MS-001 | Match chat 1:1 delivery (real-time) | Functional | P1 | Match | Send message | Delivered; ordered; persisted | Y | 🔧 Fixed | D-007: fixed reason_codes NULL that broke all unflagged sends; delivery proven in TestConnectBanSeversActiveChat |
| MS-002 | Professional InMail vs dating match-chat separated | Privacy | P0 | Dual persona | Send each | Threads isolated per persona; no cross-leak | Y | ⬜ Not Run | — |
| MS-003 | Media/photo share in chat (moderated, consent) | Trust | P0 | Chat | Send image | Moderated; disallowed blocked; no unsolicited explicit | P | ⬜ Not Run | — |
| MS-004 | Read receipts / typing per tier & settings | Functional | P2 | Chat | Exchange | Correct per settings/tier | Y | ⬜ Not Run | — |
| MS-005 | Scam/harassment keyword detection & safety nudges | Trust | P0 | Chat | Send scam/abuse pattern | Flagged; safety tips; report prompt | P | ⬜ Not Run | — |
| MS-006 | Unmatch removes chat & access both sides | Safety | P0 | Match+chat | Unmatch | Thread removed; no further contact | Y | ✅ Pass | chat resolves only active mutual match; unmatch/blocked → ErrNoMatch/ErrBlocked |
| MS-007 | Block from chat cuts all contact | Safety | P0 | Chat | Block | Immediate mutual invisibility | Y | ✅ Pass | chat blockExists bidirectional cut; block_absolute suite |
| MS-008 | Only participants access a thread (IDOR) | Security | P0 | Two threads | Access foreign | 403; participants only | Y | ✅ Pass | resolveConversationByID requires caller be a participant (IDOR-safe) |
| MS-009 | Message idempotency (double-send) | Idempotency | P1 | Chat | Resend | One message; no dup | Y | ⬜ Not Run | — |
| MS-010 | Video/voice date (safe, consented, no PII leak) | Functional | P1 | Match | Start call | Consented; masked; no number leak | P | ⬜ Not Run | — |
| MS-011 | Message retention & export per policy/DSR | Compliance | P2 | History | Export/delete | Correct per policy | Y | ⬜ Not Run | — |
| MS-012 | Rate limiting / anti-spam in chat | Trust | P1 | Chat | Flood | Throttled | Y | ⬜ Not Run | — |

### TS-6 · Trust & Safety (safety-critical)

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| TS-001 | Block is absolute & mutual-invisible | Safety | P0 | Two users | Block | No view/match/msg/search/recommend either way | Y | 🔧 Fixed | D-001: block now enforced in chat+deck+match+feed+professional; block_absolute_live_db_test.go |
| TS-002 | Report user creates auditable moderation case | Safety | P0 | Any user | Report | Case created; evidence captured; queued | Y | ⬜ Not Run | — |
| TS-003 | Report categories & severity routing | Safety | P0 | Report | Choose category | Severe (CSAM/threats) auto-escalate | Y | 🔧 Fixed | D-002: SeverityForReport auto-escalates underage/media→critical, safety→high; model_test.go |
| TS-004 | Photo moderation (nudity/violence/CSAM) | Safety | P0 | Upload | Disallowed image | Blocked; CSAM hard-stop + escalation | P | ⬜ Not Run | — |
| TS-005 | Text moderation (hate/harassment/scam) | Safety | P0 | Text fields/chat | Disallowed text | Flagged/blocked per policy | P | ⬜ Not Run | — |
| TS-006 | Minor-protection sweep (no minor in dating anywhere) | Safety | P0 | Age fixtures | Sweep surfaces | Absolute; fail-closed | Y | ⬜ Not Run | — |
| TS-007 | Anti-catfishing (verification, reverse-image signals) | Trust | P1 | Fake profile | Detect | Flagged; verification prompted | P | ⬜ Not Run | — |
| TS-008 | Romance-scam pattern detection | Trust | P1 | Scam behaviour | Detect | Flagged; user warned; case raised | P | ⬜ Not Run | — |
| TS-009 | Moderation action enforcement (warn/limit/suspend/ban) | Safety | P0 | Case | Apply action | Enforced immediately; content/access restricted | Y | 🔧 Fixed | D-004: connect_account_restrictions written on ban/suspend; enforced in deck/match/chat; TestConnectBanIsEnforced |
| TS-010 | Ban-evasion & repeat-offender linking | Trust | P1 | Banned user | Return | Detected; blocked | P | ⬜ Not Run | — |
| TS-011 | Safety center / resources & panic/exit tools | Safety | P1 | In-app | Open safety center | Resources, block/report shortcuts present | M | ⬜ Not Run | — |
| TS-012 | Every safety action audited & attributable | Compliance | P0 | Actions | Inspect | Immutable actor/time/before→after/reason | Y | ⬜ Not Run | — |
| TS-013 | Safety paths fail closed under error | Safety | P0 | Inject failure | Block/report/moderate | Fails safe (deny/hold), never open | Y | 🔧 Fixed | D-006: chat SendMessage fails closed (ErrSafetyUnavailable) on safety-config load error; chat/failclosed_test.go |

### TS-7 · Location & Geo Privacy

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| GEO-001 | Distance shown coarse; exact coords never exposed | Privacy | P0 | Located users | Inspect payload/API | Only fuzzed distance; no lat/long leak | Y | ✅ Pass | only coarse buckets serialized; distance_test.go + swipe_test.go assert no lat/lng |
| GEO-002 | Distance-filter correctness at boundary | Correctness | P1 | Radius | Near/far | Correct include/exclude | Y | ⬜ Not Run | — |
| GEO-003 | Location off / hide distance honored | Privacy | P0 | Setting off | Discovery | No location-based exposure | Y | ⬜ Not Run | — |
| GEO-004 | Passport/travel mode (set location elsewhere) | Functional | P2 | Premium | Set city | Discovery in chosen area; honest labeling | Y | ⬜ Not Run | — |
| GEO-005 | GPS spoof / trilateration de-anonymization guard | Security | P0 | Attack | Attempt to triangulate | Fuzzing/jitter prevents locating a user | P | ⬜ Not Run | — |
| GEO-006 | Location updates stop when app closed/opted out | Privacy | P1 | Background | Observe | No tracking beyond consent | P | ⬜ Not Run | — |

### TS-8 · Monetization, Subscriptions & Payments (money-critical)

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| PAY-001 | Subscribe to Premium/Recruiter tier | Functional | P0 | Payment method | Subscribe | Entitlements granted; charged once | Y | ✅ Pass | Purchase: server-side price, Idempotency-Key, balanced double-entry, entitlement projection (money_test.go) |
| PAY-002 | Buy boosts / super-likes / InMail credits | Functional | P0 | Wallet/card | Purchase | Credits granted exactly; charged once | Y | ✅ Pass | Same idempotent Purchase path (boost/pass kinds) |
| PAY-003 | Entitlement gating (feature locked without tier) | Correctness | P1 | Free user | Use premium feature | Blocked; upsell | Y | 🏗️ Built | D-012: super-like now consumes a super_like credit (fail-closed, 402+upsell); TestConnectSuperLikeRequiresCredit. Other premium gates (rewind/incognito) follow the same pattern |
| PAY-004 | Double-tap purchase idempotency | Idempotency | P0 | Checkout | Submit twice | One charge, one grant | Y | ✅ Pass | idemKey → wallet.Debit → ledger unique key; retry no-op |
| PAY-005 | Payment fail → no entitlement, no charge | Negative | P0 | Failing card | Purchase | No grant; clear message | Y | ✅ Pass | debit error returns before recordPurchase — no order/entitlement on fail |
| PAY-006 | Auto-renewal, cancellation & proration | Correctness | P0 | Active sub | Renew/cancel | Correct billing; entitlements adjust | Y | 🏗️ Built | D-010: cancel (end-of-period + immediate/proration), auto-renew batch (ProcessRenewals), lapse-on-no-funds; TestConnectSubscriptionBillingCycle |
| PAY-007 | Refund safe & single (idempotent) | Idempotency | P0 | Refund | Retry | At most one refund; reconciled | Y | 🏗️ Built | D-009: Refund reversing ledger entry, single+idempotent+concurrent-safe; TestConnectRefundSafeAndSingle |
| PAY-008 | Consumed credit not double-spent | Correctness | P1 | Credits | Use concurrently | Balance correct; no negative | Y | 🏗️ Built | D-011: connect_credits balance (CHECK>=0) + idempotent guarded consume; grant-on-pass-purchase; TestConnectCreditsNoDoubleSpend (concurrent) |
| PAY-009 | Charge amount == quoted; minor-unit exact | Correctness | P0 | Purchase | Pay | Exact; ledger balances | Y | ✅ Pass | plan.PriceKobo int64 is the charge source; kobo-exact, client never supplies price |
| PAY-010 | Webhook authenticity (billing) | Security | P0 | Webhook | Forged event | Rejected; only signed | Y | ➖ N/A | Connect money is internal wallet→wallet; external Paystack webhook HMAC verified in frontend-web boundary |

### TS-9 · Notifications

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| NT-001 | New match / message / connection notifications | Functional | P1 | Events | Trigger | Timely, correct, deduped | Y | ⬜ Not Run | — |
| NT-002 | Notification body leaks no sensitive content | Privacy | P0 | Message | Notify | No explicit/PII content in payload | Y | ⬜ Not Run | — |
| NT-003 | Notification respects block/unmatch/settings | Safety | P0 | Blocked | Trigger | No notification to/from blocked user | Y | ⬜ Not Run | — |
| NT-004 | Preferences / opt-out honored | Functional | P3 | Opted out | Events | Suppressed | Y | ⬜ Not Run | — |
| NT-005 | No duplicate/stale notifications | Idempotency | P2 | Retried | Observe | Deduped | Y | ⬜ Not Run | — |
### TS-10 · Security, Privacy & RBAC

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| SEC-001 | IDOR: profile/match/chat/settings own-only | Security | P0 | Two users | Access foreign | 403/404 | Y | ⬜ Not Run | — |
| SEC-002 | Persona/data isolation enforced server-side | Privacy | P0 | Dual persona | Cross-query | No cross-persona leak | Y | ⬜ Not Run | — |
| SEC-003 | PII encrypted at rest & in transit | Security | P0 | Data | Inspect | Encryption; TLS; no plaintext PII/photos | Y | ⬜ Not Run | — |
| SEC-004 | RBAC: member/recruiter/moderator/admin scoping | Security | P0 | Each role | Cross-scope | Only own scope; else 403 | Y | ⬜ Not Run | — |
| SEC-005 | Moderator sees only what’s needed; PII masked | Privacy | P0 | Moderator | Open case | Minimal exposure; masked; audited | Y | ⬜ Not Run | — |
| SEC-006 | No client-side trust (server authoritative on match/entitlement) | Security | P0 | Tamper | Alter payload | Recomputed; rejected | Y | ⬜ Not Run | — |
| SEC-007 | Media upload safety (type/size/EXIF/GPS stripped) | Security | P0 | Upload | Photo w/ GPS EXIF | EXIF/GPS stripped; validated | Y | ⬜ Not Run | — |
| SEC-008 | Injection / API abuse on Connect endpoints | Security | P0 | Endpoints | Payloads | Sanitized; rejected | Y | ⬜ Not Run | — |
| SEC-009 | Rate limiting (swipes/messages/reports/search) | Security | P2 | Flood | Hit endpoints | Throttled (429) | Y | ⬜ Not Run | — |
| SEC-010 | Maker–checker on bans & sensitive admin ops | Security | P0 | Admin op | Single actor | 2nd approver required | Y | ⬜ Not Run | — |
| SEC-011 | Audit trail for admin/moderation actions | Compliance | P0 | Admin ops | Perform | Attributable; before/after | Y | ⬜ Not Run | — |

### TS-11 · Non-Functional (Performance, Resilience, Availability, A11y)

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| NF-001 | Discovery/feed load under peak | Performance | P1 | Load env | Ramp | Within SLO; no drops | Y | ⬜ Not Run | — |
| NF-002 | Chat delivery latency & fan-out at scale | Performance | P1 | Many chats | Stream | Stable; ordered; no loss | Y | ⬜ Not Run | — |
| NF-003 | Matching engine throughput | Performance | P2 | Load | Compute | Within budget | Y | ⬜ Not Run | — |
| NF-004 | Moderation pipeline backlog / graceful degrade | Resilience | P0 | Spike | Flood content | Prioritized; fail-closed on unmoderated risky content | P | ⬜ Not Run | — |
| NF-005 | Service/DB failover without data loss | Resilience | P0 | Failover | In-flight matches/chats | Consistent; no lost/dup | Y | ⬜ Not Run | — |
| NF-006 | Idempotency under retry storm | Resilience | P0 | Storm | Replay | No dup matches/messages/charges | Y | ⬜ Not Run | — |
| NF-007 | Notification storm handling | Resilience | P2 | Burst | Trigger many | Deduped; batched; no spam | Y | ⬜ Not Run | — |
| NF-008 | Accessibility (onboarding, discovery, chat, safety) | Accessibility | P1 | A11y tools | Audit | WCAG-aligned; screen-reader labels | M | ⬜ Not Run | — |
| NF-009 | Localization / RTL | Localization | P3 | Locales | Switch | Correct; no truncation | M | ⬜ Not Run | — |
| NF-010 | Observability: metrics/logs/traces/alerts (no PII in logs) | Ops | P1 | Running | Inspect | Signals; no PII leak | M | ⬜ Not Run | — |

### TS-12 · Edge Cases & Chaos ("outside the box")

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| EC-001 | Block after match mid-conversation | Safety | P0 | Active chat | Block | Instant cut both sides; thread gone | Y | ⬜ Not Run | — |
| EC-002 | User turns 18 / crosses age boundary | Edge | P1 | Birthday | Cross | Correct experience transition; still safe | Y | ⬜ Not Run | — |
| EC-003 | Minor attempts age falsification chain | Safety | P0 | Under-age | Multiple bypass attempts | All blocked; fail-closed; flagged | Y | ⬜ Not Run | — |
| EC-004 | Simultaneous mutual like + block | Concurrency | P0 | Race | Like+block same instant | Block wins; no match/contact | Y | 🔧 Fixed | D-001: matching.Like returns ErrBlocked; no match forms; EC-004 subtest (verified fails without guard) |
| EC-005 | Reported user mid-match removed from partner’s deck/chat | Safety | P0 | Report+ban | Enforce | Access severed everywhere immediately | Y | 🔧 Fixed | D-004+D-007: report→case→ban severs deck+chat both ways; TestConnectBanSeversActiveChat |
| EC-006 | Location spoofing to appear local | Security | P1 | Spoof | Fake GPS | Detected/limited; honest distance | P | ⬜ Not Run | — |
| EC-007 | Screenshot / content-leak deterrents (photos) | Privacy | P2 | Chat photo | Screenshot | Policy/notice per design | M | ⬜ Not Run | — |
| EC-008 | Duplicate match webhook / event replay | Idempotency | P0 | Event | Replay | One match; idempotent | Y | ✅ Pass | matching ON CONFLICT + D-005 advisory lock; TestConnectMatchRaceExactlyOnce |
| EC-009 | Cross-persona leak: recruiter sees dating activity | Privacy | P0 | Dual persona | Recruiter view | No dating data reachable | Y | ⬜ Not Run | — |
| EC-010 | Boost purchased then account suspended | Edge | P1 | Boost+ban | Concurrent | Boost voided/refunded per policy; no visibility | Y | ⬜ Not Run | — |
| EC-011 | Deleted account’s matches/chats cleaned up | Privacy | P1 | Delete | Post-delete | Partner sees graceful state; data anonymised | Y | 🏗️ Built | D-008: deletion anonymises profile, ends matches ('unmatched'), partner ErrNoMatch, redacts messages; TestConnectAccountDeletionCascade |
| EC-012 | App killed mid-swipe / mid-payment | Resilience | P1 | In flow | Kill app | Consistent; no dup like/charge; safe resume | Y | ⬜ Not Run | — |
| EC-013 | Mass-report brigading of an innocent user | Trust | P1 | Coordinated reports | Flood reports | Weighted; not auto-banned; reviewed | P | ⬜ Not Run | — |
| EC-014 | Moderation false-positive appeal & reinstatement | Trust | P1 | Wrong ban | Appeal | Appeal flow; reinstated; audited | Y | ⬜ Not Run | — |
| EC-015 | Partial outage (feed up, chat down) | Chaos | P1 | Outage | Use module | Safe degrade; clear messaging | Y | ⬜ Not Run | — |
| EC-016 | Cross-role escalation (member→moderator→admin) | Security | P0 | Multi-role | Chain access | No cross-role capability reachable | Y | ⬜ Not Run | — |
### TS-13 · Mobile App Screens (member) — build to production grade

> Every screen must exist and handle **loading / empty / error / permission-denied / blocked / offline** states, be accessible, and reflect the audited fixes. `🚫 Missing` = screen not built → build it.

| ID | Screen / Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| MB-001 | Onboarding & age/verification stepper | Functional | P0 | New user | Complete flow | Age gate + verification enforced; resumable | Y | ⬜ Not Run | — |
| MB-002 | Persona switcher (Professional ↔ Dating) | Functional | P1 | Dual persona | Switch | Clean context swap; no data bleed | Y | ⬜ Not Run | — |
| MB-003 | Professional profile view/edit screen | Functional | P1 | Member | Edit | Saves; renders; photo moderation | Y | ⬜ Not Run | — |
| MB-004 | Dating profile view/edit screen | Functional | P1 | Member | Edit | Saves; photo moderation; preview | Y | ⬜ Not Run | — |
| MB-005 | Discovery deck / swipe screen | Functional | P1 | Preferences | Swipe | Smooth; filters applied; empty-state handled | Y | ⬜ Not Run | — |
| MB-006 | Filters & preferences screen | Functional | P1 | Member | Set filters | Persisted; applied to deck | Y | ⬜ Not Run | — |
| MB-007 | Matches list & match screen | Functional | P1 | Matches | Open | Correct matches; expiry shown | Y | ⬜ Not Run | — |
| MB-008 | Chat / messaging screen (match + InMail) | Functional | P1 | Match | Message | Real-time; media; safety tools inline | Y | ⬜ Not Run | — |
| MB-009 | Professional feed & post composer | Functional | P1 | Member | Post | Renders; interactions; moderation | Y | ⬜ Not Run | — |
| MB-010 | Connections / network screen | Functional | P2 | Member | Manage | Requests/accepts; correct graph | Y | ⬜ Not Run | — |
| MB-011 | Jobs & applications screen | Functional | P1 | Member | Apply | Job detail; apply; status | Y | ⬜ Not Run | — |
| MB-012 | Search screen (people/jobs) with visibility rules | Functional | P2 | Member | Search | Correct, visibility-respecting results | Y | ⬜ Not Run | — |
| MB-013 | Block / report / unmatch actions (reachable ≤2 taps) | Safety | P0 | Any user | Act | Immediate effect; confirmation; audited | Y | ⬜ Not Run | — |
| MB-014 | Safety center screen | Safety | P1 | In-app | Open | Resources, shortcuts, guidelines | M | ⬜ Not Run | — |
| MB-015 | Subscription & purchase screens (tiers/boosts/credits) | Functional | P0 | Member | Buy | Correct pricing; step-up; entitlement | Y | ⬜ Not Run | — |
| MB-016 | Notifications center | Functional | P2 | Events | Open | Correct, deduped, privacy-safe | Y | ⬜ Not Run | — |
| MB-017 | Privacy & visibility settings screen | Privacy | P0 | Member | Configure | All toggles enforced end-to-end | Y | ⬜ Not Run | — |
| MB-018 | Verification screen (selfie/ID/employer) | Trust | P0 | Member | Verify | Badges granted; secure upload | Y | ⬜ Not Run | — |
| MB-019 | Video/voice date screen | Functional | P1 | Match | Call | Consented; masked; controls | P | ⬜ Not Run | — |
| MB-020 | Account/delete/data-request screen | Compliance | P1 | Member | Request | Deletion/export flow works | Y | 🚧 Partial | Backend DSR endpoint built (D-008); mobile delete-account.tsx exists — wire it to DELETE /connect/account + verify states |
| MB-021 | All screens: loading/empty/error/offline states | UX | P1 | Each screen | Force states | Graceful; no crash; retriable | Y | ⬜ Not Run | — |
| MB-022 | Device/OS matrix + responsiveness | Compatibility | P2 | Device farm | Smoke | Consistent across matrix | M | ⬜ Not Run | — |

### TS-14 · Admin & Trust-&-Safety Portal — build to production grade

| ID | Screen / Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| AD-001 | Moderation queue (reports, flags, SLA) | Safety | P0 | Reports | Open queue | Prioritized; filters; assignment; timers | Y | ⬜ Not Run | — |
| AD-002 | Case detail with evidence & action panel | Safety | P0 | Case | Review | Warn/limit/suspend/ban/remove; maker–checker | Y | ⬜ Not Run | — |
| AD-003 | CSAM/critical escalation workflow | Safety | P0 | Critical report | Escalate | Immediate escalation + external-report hooks; locked audit | Y | ⬜ Not Run | — |
| AD-004 | User management (search, masked PII, suspend/ban/reinstate) | Security | P0 | Admin | Manage | Scoped; audited; ban-evasion links | Y | ⬜ Not Run | — |
| AD-005 | Verification review (selfie/ID/employer) | Trust | P0 | Pending | Decide | Approve/reject; badge; audited | Y | ⬜ Not Run | — |
| AD-006 | Content moderation dashboard (photos/text/AI signals) | Safety | P0 | Content | Review | Correct signals; bulk actions; audit | P | ⬜ Not Run | — |
| AD-007 | Appeals management | Trust | P1 | Appeals | Resolve | Maker–checker; reinstatement; audited | Y | ⬜ Not Run | — |
| AD-008 | Config: age limits, match rules, filters, tiers, feature flags | Config | P1 | Admin | Configure | Applied safely; versioned; audited | Y | ⬜ Not Run | — |
| AD-009 | Payments/subscription admin (refunds, entitlements) | Security | P0 | Billing | Adjust | Maker–checker; idempotent; reconciled | Y | ⬜ Not Run | — |
| AD-010 | Analytics (de-identified: matches, DAU, reports, safety KPIs) | Privacy | P2 | Data | View | Aggregated; no PII leak | P | ⬜ Not Run | — |
| AD-011 | RBAC & admin sub-role scoping | Security | P0 | Sub-roles | Cross-scope | Only own scope; else 403 | Y | ⬜ Not Run | — |
| AD-012 | Full immutable audit log & export | Compliance | P0 | Actions | Query/export | Complete; immutable; regulator-ready | Y | ⬜ Not Run | — |
| AD-013 | Admin screens: loading/empty/error/permission states | UX | P1 | Each screen | Force states | Graceful; no crash | Y | ⬜ Not Run | — |
| AD-014 | Kill switch: suspend discovery/chat/region | Safety | P0 | Incident | Halt | Scope halted; audited | Y | ⬜ Not Run | — |

---

## 6. Automated Regression / CI Suite Mapping

| Layer | Scope | Reference tooling (swap for your stack) | CI stage | Gate |
|---|---|---|---|---|
| Unit | Match/consent/visibility rules, minor gating, state machines, moderation gating, money math | Jest / PyTest / JUnit | Every PR | Block on fail |
| Integration | Match→chat→safety flows, feed/search, payments, moderation/geo adapters (mock), RBAC | Supertest / pytest+requests / Testcontainers | Every PR | Block on fail |
| Contract | Profile/match/chat/report/payment/admin API contracts | Pact | Every PR | Block on breaking change |
| E2E | Member journeys + moderator/admin flows (sandbox) | Playwright / Appium/Detox | Pre-merge/nightly | Block on P0/P1 fail |
| Visual/Screens | Every mobile & admin screen incl. state variants | Screenshot/visual regression + device farm | Pre-release | Block on P0/P1 screen fail |
| Performance | Discovery, chat fan-out, matching | k6 / JMeter / Locust | Pre-release | SLO gate |
| Security/Privacy | IDOR/authZ, persona isolation, geo de-anon, EXIF, injection, webhook auth | OWASP ZAP + custom privacy-adversarial scripts | Nightly | P0 gate |
| Chaos/Resilience | Moderation backlog, failover, idempotency, block-races | Fault-injection harness | Scheduled | Review |

**CI quality gates:** unit + integration + contract on every PR (merge-blocking); nightly full regression + security/privacy; pre-release performance + E2E + **visual screen** checks; **coverage enforced on safety-critical paths** (minor gating, block/report/moderation, persona isolation, geo privacy, payments) — not a blanket %. **A red P0/P1 gate blocks release; no override without Trust & Safety + Compliance sign-off.**

## 7. Entry & Exit Criteria

**Entry:** module + screens deployed to integration/staging; mock moderation/geo/payment wired; synthetic members (incl. minors for negative tests) and geo/moderation fixtures seeded; smoke (onboard→discover→match→chat→block/report) green.

**Exit = Production-Readiness Gate (§0.5):** 0 `🚫 Missing` + 0 `❌ Fail` on all P0/P1 **including every mobile & admin screen**; safety/privacy/minor/payment invariants proven; regression + security + visual green in CI; **QA + Trust & Safety + Compliance sign-off recorded.**

## 8. Defect / Task Severity

`S0` user-safety failure (minor exposure, block bypass, CSAM mishandling, PII/geo leak), core safety feature/screen missing → hard release-block · `S1` broken P0/P1 flow or missing screen → release-block · `S2` degraded non-critical · `S3` cosmetic.

---

## 20. Execution Rollup (Claude Code updates as it runs)

| Suite | Total | ✅ Pass | ❌ Fail | 🚫 Missing | ⚠️ Blocked | 🚧 Partial | 🔧 Fixed | 🏗️ Built | ⬜ Not Run |
|---|---|---|---|---|---|---|---|---|---|
| TS-1 Onboarding & Identity | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| TS-2 Profiles & Visibility | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| TS-3 Professional Networking | 11 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 11 |
| TS-4 Dating Discovery & Matching | 14 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| TS-5 Messaging | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 12 |
| TS-6 Trust & Safety | 13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 13 |
| TS-7 Location & Geo Privacy | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| TS-8 Monetization & Payments | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| TS-9 Notifications | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5 |
| TS-10 Security/Privacy/RBAC | 11 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 11 |
| TS-11 Non-Functional | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| TS-12 Edge & Chaos | 16 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 16 |
| TS-13 Mobile Screens | 22 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 22 |
| TS-14 Admin Portal | 14 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| **TOTAL** | **164** | **0** | **0** | **0** | **0** | **0** | **0** | **0** | **164** |

## 21. Priority Coverage Snapshot

| Priority | Approx count | Target before production |
|---|---|---|
| P0 (safety/privacy/minor/payment) | ~85 | 100% Pass/Fixed/Built; 0 Missing/Fail |
| P1 (critical) | ~60 | 100% on critical paths incl. screens; 0 Missing/Fail |
| P2/P3 | ~19 | ≥ 90% green |

## 22. Production-Readiness Burndown (Claude Code maintains)

| Pass # | 🚫 Missing (P0) | ❌ Fail (P0) | 🚫 Missing (P1, incl. screens) | ❌ Fail (P1) | Notes |
|---|---|---|---|---|---|
| Baseline | TBD | TBD | TBD | TBD | First full sweep to classify every row & screen |
| Pass 1 | — | — | — | — | — |
| Pass 2 | — | — | — | — | — |
| Prod-Ready | 0 | 0 | 0 | 0 | §0.5 gate met; QA+T&S+Compliance sign-off |

---

## 24. Defect & Task Log (Claude Code appends on every ❌ / 🚫)

| ID | Test ID | Type (Bug/Gap/Task) | Severity | Summary | Root Cause / What's Missing | Fix or Build (file / PR) | Regression Test Added | Status |
|---|---|---|---|---|---|---|---|---|
| _e.g._ G-001 | MB-013 | Gap | S0 | No in-chat block/report screen | Screen not built | `mobile/chat/SafetyActions.tsx` + API | `chat.block.spec.ts` | 🏗️ Built |
| _e.g._ D-001 | DM-004 | Bug | S0 | Can message before mutual match | Missing consent guard | `dating/message.guard.ts` mutual-match check | `match.consent.spec.ts` | 🔧 Fixed |
| _e.g._ D-002 | GEO-001 | Bug | S0 | Exact coordinates returned in API | Raw lat/long serialized | `geo/serializer.ts` fuzz + drop coords | `geo.privacy.spec.ts` | 🔧 Fixed |

## 25. Traceability (invariant → tests)

| Invariant (§4) | Positive Tests | Negative / Adversarial Tests |
|---|---|---|
| Minor protection | DM-007, ON-002 | ON-003, TS-006, EC-003 |
| Mutual consent before contact | DM-003, DM-005 | DM-004, MS-001 |
| Block absolute & mutual-invisible | TS-001, PN-011 | DM-008, EC-001, EC-004 |
| Persona isolation | PF-003, SEC-002 | EC-009, MS-002 |
| Location privacy | GEO-001, GEO-003 | GEO-005, EC-006 |
| Report→moderation→action | TS-002, TS-009 | TS-013, EC-005 |
| Content moderation fires | TS-004, TS-005 | PF-006, MS-003 |
| No cross-user leakage (IDOR) | — | SEC-001, MS-008, PF-008 |
| Idempotency | DM-014, PAY-004 | EC-008, NF-006 |
| Payment correctness | PAY-001, PAY-009 | PAY-007, EC-010 |
| Screens built to grade | MB-001..MB-022 | AD-001..AD-014, MB-021 |

---

### Appendix A — Conventions for Claude Code

- **Stable IDs**: never renumber; append new cases with the next free number in a suite.
- **Three closure modes:** `❌ Fail` → **fix**; `🚫 Missing` → **build** the feature/undone task/screen to production grade; both require a **failing test written first** that then passes.
- **P0 = safety/privacy/minor/payment**: never mark `✅ Pass` on static reasoning alone; require an executed, deterministic assertion; **no real PII, no live moderation vendors, no real payments in tests.**
- **Screens are deliverables**: TS-13 and TS-14 must all reach `✅/🏗️`, with every state variant handled and the audit fixes applied, before the module is production-ready.
- **Safety guardrails (minor gate, block, report/moderation, geo privacy, persona isolation) are tested, not assumed, and must fail-closed.**
- Keep this file the single source of truth; rollup (§20), burndown (§22), and log (§24) stay in sync.
- **Production-ready (repeat):** 0 `🚫 Missing` + 0 `❌ Fail` on all P0/P1 including all mobile & admin screens; safety/privacy/minor/payment invariants proven; QA + Trust & Safety + Compliance sign-off recorded.
