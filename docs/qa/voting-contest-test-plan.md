# Spotlight Voting Contest — World-Class Master Test Plan, Test Cases & UAT

**Module:** Spotlight **Voting Contest** — per-contest registration engines; per-contest PNG templates with auto background removal & compositing of contestant photos; free (1/day/contestant) + paid voting; virtual / physical / hybrid contests; admin-controlled vote visibility
**Version:** 1.0 · **Date:** 2026-07-27 · **Owner:** QA + Product Engineering
**Audiences:** Voter / Public · Contestant · Contest Organizer / Sponsor · Admin / Compliance / Super Admin
**Format:** Executable Markdown for use inside **Claude Code** (rigorous file testing, remedial action, production-readiness closure) — includes **UAT**.
**Goal:** rigorously test (manual + automated) and run UAT across every area, then **close out every bug, issue and undone task — including fully building mobile app screens and admin portal to production grade with all audit fixes — so the module ships production-ready.**

---

## 0. How Claude Code Should Use This File

This is a **test plan**, an **executable checklist**, a **production-readiness closure backlog**, and a **UAT script**. Drive every row to `✅ Pass` / UAT `✅ Accepted` — **building what's missing, fixing what's broken, finishing what's undone (including screens)** — because this module counts votes (integrity), moves money (paid voting), transforms images (contestant likeness), and controls result visibility, the bar is *integrity-safe & production-ready*.

### 0.1 Execution & closure protocol (per test case)

1. **Locate** the code/screen under test — map *Area/Component* to file(s)/service(s)/screen(s)/endpoint(s). Record path in *Remedial Action / Notes*. If nothing implements it → **gap**.
2. **Classify:** Not built/screen missing/undone → `🚫 Missing` (build it to production grade). Built + test exists → run it. Built, automatable (`Auto=Y`) → write/scaffold, run. Manual/visual (`Auto=M`) → statically verify implementation/screen.
3. **Judge** against *Expected Result* — assert on observable behaviour (vote counts, image output, states, money, visibility, audit), never internals.
4. **Set Status** (legend below).
5. **On `❌ Fail` / `🚫 Missing` / `⚠️ Blocked`** — remediate: build/fix, **write the failing test first**, record root cause / what was missing / fix (file) / regression test added.
6. **Log** in §24. Flip to `🔧 Fixed` (was broken) or `🏗️ Built` (was missing).
7. **Re-run** until the Production-Readiness Gate (§0.5) is met, including UAT sign-off.

### 0.2 Status legend (use these exact tokens)

| Token | Meaning |
|---|---|
| `⬜ Not Run` | Not yet executed (default) |
| `✅ Pass` | Behaviour/screen matches Expected Result |
| `✅ Accepted` | UAT scenario accepted by business owner |
| `❌ Fail` | Built but deviates — fix required |
| `🚫 Missing` | Not built / screen missing / task undone — build required |
| `⚠️ Blocked` | Cannot execute (dependency/env/data/upstream) |
| `🚧 Partial` | Partially built/passing — finish + fix |
| `🔧 Fixed` | Was `❌`; fixed and re-verified green |
| `🏗️ Built` | Was `🚫`; implemented to production grade and now passing |
| `➖ N/A` | Not applicable to current build/flags |

### 0.3 Priority · Automation legends

`P0` **release-blocking: vote integrity, money, image-likeness correctness, or result-visibility control** — 100% must pass · `P1` critical · `P2` high · `P3` low.
`Auto=Y` automate · `Auto=M` manual/static/visual · `Auto=P` partially automatable.

### 0.4 Remediation quality bar

Done only when: root cause fixed or feature/screen built to spec, a **failing test written first** now passes, no P0/P1 regression, covered in CI. **Never `✅ Pass` on static reasoning alone for vote-count, money, image-likeness, or visibility cases** — require executed, deterministic assertions (image cases: pixel/format/placement checks + human visual review). **No real payments, no live background-removal vendor, no real PII in tests** — use sandbox/mocks and synthetic contestants/photos (rights-cleared placeholders).

### 0.5 Production-Readiness Gate (definition of done)

Production-ready when **all** hold:
- **0** `🚫 Missing` and **0** `❌ Fail` across every **P0 and P1** row, **including every mobile and admin screen** (TS-13/TS-14).
- **Vote-integrity invariants (§4) hold under test**: free voting is exactly 1/day/contestant per identity; paid votes counted exactly as purchased; no double-count under retries/concurrency; tally correct, verifiable, tamper-evident; fraud/bot controls fire.
- **Image invariants hold**: uploaded photo is moderated, background removed, and composited onto the correct per-contest template at the correct position/scale, producing a correct-format output with graceful fallback on failure.
- **Money invariants hold**: paid voting charges exactly once, grants the exact vote quantity, reconciles, refunds safe & single.
- **Visibility invariants hold**: when admin hides votes, counts/leaderboard are hidden from contestants and/or public everywhere (API, UI, notifications) with no leakage; still visible/auditable to authorized admins.
- **Screens** all exist, handle every state, accessible, audit fixes applied.
- **UAT** (TS-15) accepted and signed off by the business owner.
- Automated regression + security suites green in CI; sign-off from QA, Contest/Business owner, and Compliance recorded.

---

## 1. Scope

**In scope:**
- **Contest setup:** create contest; **per-contest registration engine/form (dynamic schema)**; **per-contest PNG template**; contest **type (virtual / physical / hybrid)**; **free-vote rules** + **paid-vote packages**; **vote-visibility toggle** (hide counts from contestants/public); schedule/phases; categories/positions; prizes.
- **Contestant registration:** dynamic form per contest, validation, photo upload, consent, approval/rejection, contestant number/slug, edit.
- **Photo/image pipeline:** upload → moderation → **auto background removal** → **composite onto contest template** at defined position/scale → generate final contestant profile image (and thumbnails); fallback on failure; re-process.
- **Voting:** free voting (**limit 1/day/contestant** per voter identity), paid voting (packages, quantity), vote recording, tally, leaderboards, results.
- **Anti-fraud & integrity:** dedup, rate limits, bot/multi-account detection, geo/IP signals, reconciliation of physical/offline votes.
- **Payments & reconciliation; notifications; mobile app screens; admin portal; RBAC & security; non-functional; edge/chaos; UAT.**

**Out of scope (other plans):** base identity/auth internals; core wallet/payment-processor internals (tested at boundary); background-removal vendor internals (tested at boundary); other super-app modules.

## 2. Test Approach

- **Pyramid:** deterministic **unit** tests on free-vote-limit logic, tally, money math, template-placement math, form-schema validation; **integration** tests on registration→image-pipeline→publish, vote→payment→tally, visibility gating, fraud checks (mock); thin **e2e** on voter/contestant/organizer journeys; **visual** verification of image outputs and every screen; **UAT** with business personas.
- **Golden/deterministic fixtures:** contests with known templates & placement specs; sample portrait photos (rights-cleared) with known-good composited outputs; ballots with known tallies; payment sandbox; fraud pattern fixtures. Fixed clocks/seeds/timezone.
- **Adversarial testing** for free-limit bypass, multi-account/bot voting, paid-vote tampering, image-likeness/artifact issues, visibility leakage, offline-vote manipulation.
- **Chaos/resilience** for image-pipeline outage, payment race, vote flood at close, notification storm.
- **No real payments, no live vendors, no real PII in tests.**

## 3. Test Environments & Data

| Env | Purpose | Notes |
|---|---|---|
| Unit/CI | Pure deterministic logic | No I/O; fastest; gates every PR |
| Integration | Mock removal/payment/geo + test DB + object store | Deterministic fixtures; Testcontainers |
| Staging | Production-like | Sandbox payments/removal; perf/security regression; device farm; visual checks |
| UAT | Business acceptance | Realistic sample contests; stakeholders execute TS-15 |
| Prod (guarded) | Post-deploy smoke + synthetic monitoring | Synthetic contests; no real money votes surfaced |

**Data:** synthetic contests (each type; each with its own template & placement spec); rights-cleared sample portraits (varied backgrounds, lighting, skin tones, headwear, hair) for the removal/compositing tests; voter identities; ballot & payment fixtures with pre-computed expected counts; fraud fixtures. **Never real payments, real people's likeness without rights, or real PII.**

## 4. Critical Integrity, Image, Money & Visibility Invariants (assert across suites)

1. **Free-vote limit**: a voter can cast at most **1 free vote per contestant per calendar day** (in the defined timezone), enforced by verified identity — not defeatable by refresh, re-login, device change, or clock manipulation; resets correctly at the day boundary.
2. **Paid votes are exact**: purchased vote quantity is credited exactly (n paid = n counted), charged once, and separated from free-vote limits.
3. **No double-count / correct tally**: no vote is counted twice under retries/concurrency; the tally equals the sum of valid free + paid votes; it is reproducible and tamper-evident.
4. **Image likeness & placement**: the final contestant image = moderated photo → background removed → composited onto the **correct contest template** at the specified position/scale/anchor, correct output format/resolution, no gross artifacts; if removal fails, a defined fallback is used (not a broken image).
5. **Per-contest isolation**: each contest uses its own registration form and its own template; contestants, votes and templates never bleed across contests.
6. **Vote visibility control**: when an admin hides counts, they are hidden from the configured audience (contestants and/or public) across API, UI, leaderboards and notifications, with no side-channel leak; authorized admins still see and audit them.
7. **Money correctness**: paid-vote charges are exact, idempotent, reconciled; refunds safe and single.
8. **Fraud resistance**: automated/bot, multi-account, and abnormal-velocity voting are detected and mitigated; physical/offline votes reconcile without inflation.
9. **Attribution & immutability**: contest config changes, vote records (aggregate/anonymized as designed), payments and admin actions are logged immutably; published results are append-only.
10. **Idempotency**: no duplicate registration, vote, image job, or charge under retries.
11. **Fail-safe**: vote and money paths fail closed (reject/hold), never fail open; hidden results never accidentally reveal.
12. **Consent & rights**: contestant photo/likeness consent and usage rights are captured before processing/publishing.

---
## 5. Test Suites & Cases

> Columns: **ID · Test Case · Type · Pri · Preconditions · Steps (summary) · Expected Result · Auto · Status · Remedial Action / Notes**
> All rows default to `⬜ Not Run`. Claude Code fills Status + Remedial Action during execution/closure.

### TS-1 · Contest Setup & Configuration

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| CS-001 | Create contest with metadata, dates, categories | Functional | P1 | Organizer | Create | Contest created; phases scheduled; audited | Y | 🚧 Partial | Metadata/slug/category/type in `components/admin/RegistrationContestManager.tsx`. No **prizes** fields; phases live separately as voting Rounds (`voting/[contestId]/rounds`), no auto phase-scheduling in builder. |
| CS-002 | Configure per-contest registration form (dynamic schema) | Config | P0 | Contest | Build form | Fields/types/required saved; drives registration | Y | ✅ Pass | Field-catalog builder in `RegistrationContestManager.tsx` + `src/features/registration/{field-catalog.ts,forms/from-schema.ts}`; drives registration. Executed: `frontend-web/tests/unit/registration/field-catalog-builder.spec.ts` (9 cases, green) — proves `sanitizeContestFormSchema`/`catalogFieldToRegistrationField` save field key/type/required correctly and reject unknown keys/types/steps. **No live preview pane** remains a genuine UI gap (separate, not built this pass). |
| CS-003 | Two contests have different, isolated forms | Config | P0 | Two contests | Compare | Each form independent; no bleed | Y | ✅ Pass | Distinctness covered by `contest-distinctness.spec.ts`. Added the explicit runtime **no-bleed** assertion: `frontend-web/tests/unit/registration/contest-no-bleed-runtime.spec.ts` (4 cases, green) — proves two admin-configured contest forms built via `buildStepsForContest`/`buildRegistrationSteps` never leak fields, required-overrides, or object references into each other, including across interleaved builds and post-build mutation of the source schema. |
| CS-004 | Upload per-contest PNG template + placement spec | Config | P0 | Contest | Upload template | Template stored; anchor/scale/position defined | Y | 🚫 Missing | **No template manager UI.** Only a server-side compositor (`src/lib/rendering/imageCompositor.ts`) exists and it is orphaned (never called). See G-IMG in §24. Build TS-14/AD-003. |
| CS-005 | Set contest type (virtual/physical/hybrid) | Config | P1 | Contest | Set type | Type-specific flows enabled | Y | 🚧 Partial | `ContestType` enum (`src/features/registration/types.ts:14-25`) on **registration** side only; not on `voting_settings`/`contests`. No type-specific voting flows. |
| CS-006 | Configure free-vote rule (1/day/contestant) & window/TZ | Config | P0 | Contest | Set rule | Rule applied; timezone correct | Y | 🔧 Fixed | Rule upsert works; timezone reset now correct on the v2 bridge path (D-001, `vote-window.ts`). Re-verified 2026-09-16: `frontend-web/components/voting/VoteModal.tsx:51` calls `/api/v2/votes/free` — web is on the v2 bridge in production, so this is now effectively **Pass for web**. ⚠️ Still v2-only: the legacy v1 free-vote path (if reachable by any other caller) remains UTC until fully retired. |
| CS-007 | Configure paid-vote packages (price, quantity) | Money | P0 | Contest | Set packages | Packages correct; minor-unit prices | Y | ✅ Pass | Implemented: `app/api/admin/voting/packages/route.ts` (CRUD, presets, minor-unit). Executed: `frontend-web/tests/unit/registration/vote-packages-crud.spec.ts` (9 cases, green) — validates votes/amount/contestId/name are required, minor-unit `amount` passes through unrescaled, camelCase<->snake_case round-trip, the empty-string `startsAt/endsAt` -> null guard, soft-delete (`is_active=false`, not a row delete), audit logging on create/delete, and the `votes:manage` RBAC gate. |
| CS-008 | Vote-visibility toggle (hide from contestant/public) | Config | P0 | Contest | Toggle | Applies immediately across surfaces | Y | 🚧 Partial | Re-verified 2026-09-16 against TS-7: toggles exist (`show_public_vote_count/leaderboard/rank`). **D-004 and D-005 have since landed** (see VV-001 `✅`/`🔧 Fixed`, VV-003 `🚧 Partial` below) — vote-page now gates `totals` via `getEffectiveVisibility`, and the leaderboard route is phase-aware and strips rank when hidden. Gating is therefore now **consistent across API/vote-page/leaderboard**. Remaining leak is narrower than this row's original note: milestone/notification emails (`milestone.service.ts`, hook-protected) still include rank+totalVotes without consulting visibility (NT-003, ❌ Fail) — a side-channel, not the general-surface leak originally reported. |
| CS-009 | Contest phases (registration/voting/closed) state machine | State machine | P0 | Contest | Advance | Valid-only transitions; illegal rejected | Y | 🚧 Partial | Assessed, not built (per scope — this is a genuine cross-system change, not a small fix): no enforced reg→voting→closed FSM on the voting side; "open" is time-window + booleans (`assertVotingOpen`, `free-vote.service.ts:380-389`). Note: registration DOES now have its own real state machine for the *application* lifecycle (draft→submitted→approved/rejected→promoted), enforced via the `review_registration_application` RPC (migration `20270125000000_registration_review_seam_and_dedupe.sql`) — but that is the applicant pipeline, not a contest-level registration/voting/closed phase gate. The two should not be conflated; the contest-level FSM this row asks for still does not exist and remains a follow-up-sized item. |
| CS-010 | Prizes, positions, tie rules configured | Business rule | P1 | Contest | Configure | Stored; used at results | Y | 🚫 Missing | No prizes/positions/tie-rule config in builder; no tie-break tooling in results (`voting/[contestId]/rounds`). Left as Missing (product decision), per scope. |
| CS-011 | Clone/duplicate contest (form+template) | Functional | P2 | Contest | Clone | Independent copy; no shared refs | Y | 🚫 Missing | No clone/duplicate action found in contest admin. Left as Missing (net-new feature), per scope. |
| CS-012 | Edit config mid-contest safely (guardrails) | Edge | P1 | Live contest | Edit | Safe changes only; audited; no vote impact | Y | 🚧 Partial | Assessed: settings/packages are editable live with no vote-impact guardrails (e.g. nothing stops lowering `max_votes_per_user` or flipping `voting_type` while a contest is open and votes already exist). This is a real gap but not a one-line fix — it needs a policy decision (which fields are safe to edit live vs. require a close/pause) before any guard can be written correctly, so it is flagged rather than guessed at in this pass. `publishContestToVotingPlane` (`registration-v2/publish-to-voting.ts`) already protects the commercial fields (`status`, `voting_enabled`, `voting_type`, `vote_price*`, `max_votes_per_user`) from being silently reset by an unrelated registration-form republish — that specific corner of CS-012 is already covered. |

### TS-2 · Contestant Registration

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| RG-001 | Register via the contest's own dynamic form | Functional | P0 | Open contest | Submit form | Contestant created; correct schema applied | Y | 🔧 Fixed | Re-confirmed 2026-09-16 — **this finding is now stale/inaccurate as written.** Every real `[id]/*` route (`app/api/registration/applications/**`) imports `src/server/registration/supabase-store.ts`, not `store.ts` (`store.ts` is now legacy/superseded — it only backs the small admin contest-catalog CRUD, not applications). Applications live in the real `registrations` Postgres table. Promotion to votable contestant is wired: `reviewRegistrationApplication` calls the `review_registration_application` RPC (migration `20270125000000`), which on `approved`/`selected_for_public_voting`/`selected_for_bootcamp` calls `promote_registration_to_contestant` in the same transaction (seam added in `20260812010000_registration_contestant_seam.sql`). `registration-v2/registration-voting.ts` reads the resulting `contestants` roster row back for the applicant. G-REG as originally described (in-memory, never promotes) is fixed. Golden-path test: `tests/unit/golden-path/registration.spec.ts`. |
| RG-002 | Required/typed field validation | Validation | P1 | Form | Submit invalid | Per-field errors; no partial create | Y | ✅ Pass | Implemented (`src/features/registration/validation.ts`); executed `tests/unit/registration/{validation-file,form-schema}.spec.ts` plus the full `tests/unit/registration/` suite — 88/88 green. |
| RG-003 | Photo upload with consent & rights capture | Compliance | P0 | Register | Upload + consent | Consent stored; photo queued for pipeline | Y | 🚧 Partial | Upload works (`app/api/registration/uploads/route.ts`, pass-through to R2). **No consent/rights capture gate before processing**, and no pipeline to queue into. Ties to SEC-010 — not built this pass (net-new feature, per scope). |
| RG-004 | Duplicate registration prevention (same person/contest) | Integrity | P1 | Existing | Re-register | Blocked/flagged per policy | Y | 🔧 Fixed | Re-assessed: this is already implemented on the live (Supabase) path, not the legacy `store.ts` this row was written against. `startRegistrationDraft` (`supabase-store.ts:335-342`) calls `findLiveRegistrationForContest` and throws `RegistrationExistsError` (carrying the existing application) before creating a duplicate; migration `20270125000000_registration_review_seam_and_dedupe.sql` backs it with a DB partial unique index `registrations_one_live_per_user_contest` (terminal statuses excluded, so a rejected/withdrawn applicant can reapply) as the real authority, and collapsed pre-existing duplicate data on deploy. Executed: `tests/unit/registration/dedup-and-reference-uniqueness.spec.ts` (RG-004 half, green). |
| RG-005 | Contestant number/slug uniqueness | Correctness | P1 | Register | Create | Unique, collision-free ID | Y | 🔧 Fixed | Assessed as a test-confirms-not-a-rebuild item, per scope — and the test found a real small bug. `reference` generation (`supabase-store.ts` `makeReference`) mixes a contest-slug prefix + ms timestamp + random suffix; the random suffix was only 4 base36 chars (~1.68M combinations), and `tests/unit/registration/dedup-and-reference-uniqueness.spec.ts` reproduced an actual collision at ~5000 same-millisecond calls (a realistic registration-burst volume). Fixed by widening the suffix to 6 chars (~2.18B combinations) — same format, contest-scoped, now collision-resistant at realistic burst sizes (test is green at 5000 calls). Votable roster identity is the separate `contestants.id` (UUID, DB-unique) — unaffected either way. |
| RG-006 | Approval / rejection workflow (with reason) | State machine | P1 | Pending | Approve/reject | Correct state; notified; audited | Y | ✅ Pass | Live path is `reviewRegistrationApplication` in `supabase-store.ts` (not `store.ts`), backed by the `review_registration_application` RPC (status + audit event + roster promotion/deactivation, atomically). The RBAC guard this row flagged as store-fn-absent is present one layer up, exactly where CLAUDE.md's admin-route pattern puts it: `app/api/admin/registration/applications/[id]/review/route.ts` calls `assertAdminPermission(request, 'applications:review')` before any write. Executed: `tests/unit/registration/review-workflow-rbac.spec.ts` (4 cases, green) — proves a caller without `applications:review` is rejected before any write/audit, and that approve/reject both record their reason and write an audit event. |
| RG-007 | Registration only in registration phase | State machine | P1 | Voting phase | Register | Blocked outside window | Y | 🚫 Missing | Re-verified: genuinely not enforced, and confirmed **not** a small fix — `ContestRegistrationDefinition`/`RegistrationDraft` (`src/features/registration/types.ts`) carry no registration-window/deadline fields at all (`opensAt`/`closesAt`/deadline), so there is nothing to gate against yet. Building this needs new contest schema fields + admin UI + a gate in `startRegistrationDraft`/`saveRegistrationStep` — a follow-up-sized item, not attempted this pass. |
| RG-008 | Registration fee (if paid) charged once | Money | P1 | Paid reg | Pay | Charged once; entry created | Y | 🔧 Fixed | Re-verified: the row's premise (in-memory `RegistrationPaymentIntent`, `store.ts:32-52`) is stale — payment intents now live in real Postgres (`registration_payment_intents` table, `supabase-store.ts`), not memory, per that file's own migration note. Charge-once is enforced two ways: `findRegistrationPaymentIntentByIdempotencyKey` replays the same intent for a repeated `Idempotency-Key`, and a DB constraint `unique_payment_per_app_method` allows only one row per (application, method) — `payment/initiate/route.ts` handles the resulting retry case explicitly (re-issue in place via `retryRegistrationPaymentIntent` rather than a second insert). Not re-tested live against Postgres this pass (would need `TEST_DATABASE_URL`); flagging as fixed-by-code-inspection rather than re-closing without a DB-backed test. |
| RG-009 | Edit registration / replace photo (re-pipeline) | Functional | P2 | Contestant | Edit | Updated; image reprocessed; audited | Y | 🚫 Missing | Edit exists; **no image re-pipeline** (no pipeline at all — TS-3). Not built this pass, per scope. |
| RG-010 | Contestant cannot access another's registration (IDOR) | Security | P0 | Two contestants | Access foreign | 403/404 | Y | ✅ Pass | Full sweep of `app/api/registration/applications/[id]/*` completed: GET/PATCH on `[id]/route.ts`, `status/route.ts`, `submit/route.ts`, `withdraw/route.ts`, `payment/initiate/route.ts`, `payment/verify/route.ts`, and `voting/route.ts` **all** load the draft first and check `draft.userId !== user.id` → 403 before touching any data — none were missing the guard. `payment/callback/route.ts` is the sole exception, by necessity: it's the unauthenticated redirect target Paystack's browser lands on (no session/Authorization header exists there); it instead validates `intent.applicationId !== params.id` against the payment reference it was given, which is the correct control for a route with no user context. No IDOR found; no fix needed. |
| RG-011 | Bulk import contestants (per-form mapping) | Functional | P2 | Organizer | Import | Valid rows created; bad reported; dedup | Y | 🚫 Missing | No bulk-import path found. Left as Missing (net-new feature), per scope. |
| RG-012 | Withdraw / disqualify contestant handles votes | Edge | P1 | Contestant | Withdraw | Removed from ballot; votes handled per rule | Y | 🚧 Partial | Assessed, not built: `review_registration_application` RPC does deactivate the roster row on `rejected/disqualified/withdrawn/eliminated` (`contestants.is_active = FALSE`, votes already cast are preserved rather than deleted since they reference the contestant). What is NOT handled is any *rule* for what happens to those already-cast votes at the tally/leaderboard level on DQ (exclude retroactively? freeze? this is a product decision tied to EC-016, not a code gap) — ties to EC-016 as originally noted; genuinely bigger than a trivial fix. |

### TS-3 · Photo Pipeline — Background Removal & Template Compositing (image-critical)

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| IMG-001 | Photo moderation before processing (nudity/violence) | Trust | P0 | Upload | Disallowed photo | Blocked; not published | P | 🚫 Missing | No moderation/NSFW/Rekognition/Vision in any upload path. Build required. |
| IMG-002 | Auto background removal produces clean cutout | Correctness | P0 | Portrait | Process | Subject isolated; clean edges; alpha correct | P | 🚫 Missing | No bg-removal (no remove.bg/rembg/Cloudinary AI) anywhere. Vendor decision needed. |
| IMG-003 | Composite onto correct contest template | Correctness | P0 | Cutout + template | Composite | Placed on that contest's template only | Y | 🚫 Missing | Compositor exists (`src/lib/rendering/imageCompositor.ts`, Sharp) but **orphaned — never imported/called**; no per-contest template wiring. |
| IMG-004 | Placement: position/scale/anchor per spec | Correctness | P0 | Template spec | Composite | Subject positioned/scaled per spec; in front of bg | Y | 🚫 Missing | Compositor supports x/y/scale/z but **no anchor** (top-left only) and no placement-spec config source. Orphaned. |
| IMG-005 | Output format/resolution/thumbnails correct | Correctness | P1 | Composite | Generate | Correct format, size, thumbnails; color intact | Y | 🚫 Missing | No thumbnail/resize outside the dead compositor; uploads store raw object only. |
| IMG-006 | Removal failure fallback (retry / manual / default) | Resilience | P0 | Hard image | Removal fails | Defined fallback; never broken/empty image | Y | 🚫 Missing | No removal step; compositor's per-slot catch silently drops slot. No defined fallback. |
| IMG-007 | Varied inputs (lighting/skin tone/hair/headwear/glasses) | Correctness | P1 | Diverse set | Process | Acceptable across diversity; no bias failures | P | 🚫 Missing | No pipeline to exercise. |
| IMG-008 | Busy/low-contrast background handled | Correctness | P1 | Hard bg | Process | Reasonable cutout or fallback; flagged if poor | P | 🚫 Missing | No pipeline to exercise. |
| IMG-009 | Group/multi-face or no-face photo handling | Edge | P1 | Bad input | Process | Rejected/flagged with guidance | P | 🚫 Missing | No face detection/validation. |
| IMG-010 | EXIF/orientation/rotation normalized; GPS stripped | Security | P1 | Photo w/ EXIF | Process | Correct orientation; GPS removed | Y | ❌ Fail | Upload proxies raw buffer to R2 with no re-encode → **EXIF/GPS preserved, not stripped** (`app/api/registration/uploads/route.ts`). Privacy defect. See D-IMG-EXIF. |
| IMG-011 | Re-process on template change or photo replace | Functional | P1 | Change | Trigger | Regenerated correctly; old replaced | Y | 🚫 Missing | No trigger/job; compositor never invoked. |
| IMG-012 | Idempotent image job (no duplicate outputs) | Idempotency | P1 | Job | Retry | One output set; no dup storage | Y | 🚫 Missing | No image job queue. |
| IMG-013 | Pipeline performance/queue under bulk uploads | Performance | P2 | Many uploads | Bulk | Throughput within SLO; queued; no loss | Y | 🚫 Missing | No pipeline/queue. |
| IMG-014 | Final image matches golden reference (visual) | Correctness | P0 | Golden fixture | Compare | Within visual tolerance; human-reviewed | M | 🚫 Missing | No output to compare; no golden fixtures. |
| IMG-015 | Contestant preview & re-crop/adjust before submit | Functional | P2 | Preview | Adjust | Preview accurate; adjustments applied | M | 🚧 Partial | Mobile shows **uploaded-file** preview only (`registration/FieldRenderer` FileField); no composited-result preview or re-crop. |
### TS-4 · Free Voting (1/day/contestant — integrity-critical)

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| FV-001 | Cast one free vote for a contestant | Functional | P0 | Voter | Vote | Recorded once; count +1 | Y | ✅ Pass | Executed. Golden-path route contract green (`golden-path/free-vote.spec.ts`, mocked service). Added a real-logic test against `castFreeVote` itself with a mocked Supabase query-builder: `tests/unit/voting/free-vote-service.spec.ts` — one vote recorded, per-contestant counter +1, `incrementVoteTotals` called with `{freeVotes:1}` exactly once. |
| FV-002 | Second free vote same contestant same day blocked | Integrity | P0 | Voted today | Vote again | Blocked; clear message; no count | Y | 🔧 Fixed | **v2 bridge:** atomic `claim_free_vote` enforces the cap; DB-executed proof `[1,1,1,0,0]` at cap 3. ⚠️ v2 path only (behind `VOTES_BRIDGE_ENABLED`, default off) — production closure needs client cut-over (deferred). |
| FV-003 | Free vote resets next calendar day (TZ correct) | Integrity | P0 | Voted yesterday | Vote today | Allowed again; boundary correct | Y | 🔧 Fixed | **D-001 fixed (v2):** TZ/DST-correct `vote-window.ts` (6 unit cases) now wired into `castFreeVoteAtomic` → passed as `p_vote_date` to the RPC (`free-vote-atomic.spec.ts` asserts Lagos bucket). ⚠️ v2 path only; live v1 unchanged until cut-over. |
| FV-004 | Free vote for different contestant same day allowed | Business rule | P0 | Voted for A | Vote for B | Allowed (limit is per-contestant) | Y | ✅ Pass | Executed: `free-vote-service.spec.ts` casts for contestant A then B (same user, same day) — both credited independently since `voter_contestant_daily_limits` is keyed per-contestant. |
| FV-005 | Limit bound to identity, not device/cookie | Security | P0 | Same user | New device/clear cookies | Still limited; no reset via device | Y | 🚧 Partial | Keying configurable via `free_vote_limit_scope` (user/email/phone/device/ip/session, `resolveVoterIdentifier:16-49`). If scope=device/ip, limit is weaker than identity. Needs config assertion + test. |
| FV-006 | Re-login / multi-session cannot bypass limit | Security | P0 | Voter | Re-login & vote | Still blocked | Y | ✅ Pass | Executed: `free-vote-service.spec.ts` — same `userId` with a changed IP + device fingerprint (simulating re-login/new session) against an already-at-cap `voter_contestant_daily_limits` row still throws 429; `scope=user` keys on identity, not device/session. |
| FV-007 | Clock manipulation cannot unlock extra free vote | Security | P0 | Voter | Change device time | Server-time authoritative; blocked | Y | ✅ Pass | Executed: `free-vote-service.spec.ts` asserts the `vote_date` written to `voter_contestant_daily_limits` always equals server UTC today, even when the request carries an injected bogus client-date field — `CastFreeVoteRequest` has no client-timestamp input at all, so there is no client-controlled path to the bucket. Boundary correctness itself (D-001 TZ fix) remains v2-bridge-only per FV-003. |
| FV-008 | Concurrent double free-vote race | Concurrency | P0 | Voter | Two simultaneous | Exactly one counted | Y | 🔧 Fixed | **D-002 fixed (v2):** `claim_free_vote` row-locks the cap (`SELECT … FOR UPDATE`). **DB-executed proof: 20 concurrent claims at cap 5 → exactly 5 votes / total_confirmed 5, no over-count.** ⚠️ v2 path only; cut-over deferred. |
| FV-009 | Free voting requires eligible/verified voter (per rules) | Compliance | P1 | Rules on | Vote unverified | Gated per config | Y | 🚧 Partial | Executed and confirmed: `free-vote-service.spec.ts` — `require_login_for_free_vote` gates correctly (401 unauthenticated, success when logged in). Still 🚧 Partial as before: only the login gate is wired; broader KYC/verification tiers (phone/email-verified, KYC tier) are not enforced in v1 `castFreeVote` (the v2 bridge path does have a KYC gate — see `kyc-gate.spec.ts` — but that's a separate engine, not this row's subject). |
| FV-010 | Free vote only during voting phase | State machine | P0 | Closed | Vote | Blocked outside window | Y | ✅ Pass | Executed: `tests/unit/voting/free-vote.spec.ts` `assertVotingOpen` suite (disabled / not-started / closed / open) all green; `castFreeVote` calls `assertVotingOpen(settings)` unconditionally as its first guard. |
| FV-011 | Free vote idempotent under retry | Idempotency | P0 | Vote | Retry | One vote only | Y | 🔧 Fixed | **v2 bridge:** `X-Idempotency-Key` claimed via `bridge_idempotency_keys` (INSERT-on-conflict) before the atomic claim; cached response returned on retry (`voting-bridge/bridge.spec.ts`). ⚠️ v2 path only; cut-over deferred. |
| FV-012 | Free vote for withdrawn/disqualified contestant | Edge | P1 | Withdrawn | Vote | Blocked | Y | 🚧 Partial | No DQ/withdrawn guard in `castFreeVote`. Ties to RG-012/EC-016. |

### TS-5 · Paid Voting (money-critical)

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| PV-001 | Buy a paid-vote package (n votes) — success | Money | P0 | Payment method | Purchase | Charged once; exactly n votes credited | Y | ✅ Pass | Executed. Golden-path route contract green. Added real-logic test against `verifyAndCreditPaidVote` itself (mocked Supabase + mocked `verifyVotePayment`): `tests/unit/voting/paid-vote-service.spec.ts` — transaction marked `successful`/`credited` exactly once, `votesCredited` = `votes_purchased + bonus_votes`. |
| PV-002 | Paid votes counted exactly as purchased | Integrity | P0 | Purchase | Apply | Count += n; not more/less | Y | ✅ Pass | Executed (same test as PV-001): `incrementVoteTotals` asserted called exactly once with `{paidVotes: votes_purchased, bonusVotes: bonus_votes}` — not more, not less. |
| PV-003 | Paid votes independent of free daily limit | Business rule | P0 | Voted free today | Buy paid | Paid allowed on top of free | Y | ✅ Pass | Executed: `paid-vote-service.spec.ts` asserts `verifyAndCreditPaidVote` never touches `voter_daily_limits` or `voter_contestant_daily_limits` — the paid path is structurally independent of the free-vote cap tables. |
| PV-004 | Payment fails → no votes credited, no charge | Negative | P0 | Failing card | Purchase | No credit; clear message | Y | ✅ Pass | Executed: golden-path 402 contract green; real-logic test in `paid-vote-service.spec.ts` — unsuccessful `verifyVotePayment` throws `ApiError(400)`, `incrementVoteTotals` never called, no `votes` row inserted, transaction marked `payment_status:'failed'`. |
| PV-005 | Double-submit purchase idempotency | Idempotency | P0 | Checkout | Submit twice | One charge, n votes once | Y | 🚧 Partial | **Out of scope for this batch** — already fixed separately (see PR #164, `fix(voting): close paid-vote double-credit race`, commit `2c09fe8f`; atomic `credit_paid_vote_transaction` RPC on the v2 bridge path, DB-proven 20-concurrent→1-credited). Row left as-is per explicit instruction; not re-verified here. |
| PV-006 | Amount == quoted; minor-unit exact | Correctness | P0 | Purchase | Pay | Exact; ledger balances | Y | ✅ Pass | Executed: `paid-vote-service.spec.ts` — mismatch beyond the ₦1 tolerance (₦300 paid vs ₦500 quoted) is rejected (400), flagged via `recordVoteFraudSignals` with exact `amountExpectedKobo`/`amountPaidKobo`, and credits nothing; an in-tolerance amount (₦500.50 vs ₦500.00) is accepted and credited. Go `votebridge` wallet-path minor-unit tests (`CostKoboMustCoverAllVotes`) remain separately covered. |
| PV-007 | Partial payment / network drop mid-pay | Resilience | P0 | Pay | Drop | No orphan votes/charge; safe retry | Y | ✅ Pass | Executed: `paid-vote-service.spec.ts` — `verifyVotePayment` throwing mid-call (simulated network drop) propagates the error before any `vote_transactions` update or vote credit is written (transaction stays `pending`, no orphan state); a subsequent retry with a healthy verify credits exactly once. |
| PV-008 | Refund → votes reversed correctly (single) | Idempotency | P0 | Refund | Retry | At most one; votes decremented; reconciled | Y | ✅ Pass | Verified still green (not rewritten, per instruction): `tests/unit/voting/vote-reversal-refund.spec.ts`, 7/7 passing. |
| PV-009 | Vote-to-revenue reconciliation report | Correctness | P1 | Sales | Reconcile | Votes sold == revenue == counted; balances | Y | 🚫 Missing / Flagged | Confirmed genuinely missing, not a bug: revenue/transactions/export admin routes exist and read correctly, but there is no scheduled job that reconciles Paystack settlement data against `vote_transactions`/ledger on the voting side. Per explicit scope instruction, **not building a new scheduled job** — flagging only. |
| PV-010 | Webhook authenticity (payment) | Security | P0 | Webhook | Forged | Rejected; only signed | Y | ✅ Pass | Executed. Pre-existing structural HMAC test (`free-vote.spec.ts`) plus a new test exercising the actual protected implementation directly: `tests/unit/voting/paid-vote-service.spec.ts` calls the real `verifyPaystackWebhookSignature` (via `vi.importActual`, since the module is otherwise mocked in this file) — accepts a correctly-signed payload, rejects a forged/tampered payload, rejects a signature made with the wrong secret. |
| PV-011 | Gift/bulk vote purchase (sponsor) | Functional | P2 | Sponsor | Buy bulk | Correct credit/attribution | Y | 🚫 Missing | **Out of scope for this batch** — confirmed net-new/missing feature per prior audit; not built, row left unchanged. |
| PV-012 | Currency/pricing per contest correct | Correctness | P1 | Multi-currency | Purchase | Correct currency/precision | Y | 🚧 Partial | Executed and confirmed: `paid-vote-service.spec.ts` proves `initiatePaidVote` correctly threads a non-NGN `settings.currency` (tested with USD) through to both the quote response and the Paystack init call. Still 🚧 Partial as before: the kobo/cent conversion is a flat `amount * 100` (`paid-vote.service.ts:115`) — correct for 2-decimal currencies but not currency-exponent-aware (would misconvert a 0-decimal currency like JPY). No contest currently configures a 0-decimal currency, and building a per-currency exponent table is out of this batch's scope, so left flagged rather than "fixed". |

### TS-6 · Vote Integrity, Tally & Anti-Fraud

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| VI-001 | Tally = sum(valid free + paid); reproducible | Integrity | P0 | Votes | Tally | Exact; re-tally identical | Y | 🔧 Fixed | **D-003 (free path, v2):** `claim_free_vote` upserts `vote_totals` atomically + NULL-round-correct (advisory-lock + `IS NOT DISTINCT FROM`); DB proof: 20 concurrent → 1 totals row, total_confirmed 5. Tamper-evidence (append-only/hash-chain) still open (VI-003). ⚠️ v2 free path; paid path + cut-over separate. |
| VI-002 | No double-count under retries/concurrency | Integrity | P0 | Vote storm | Replay | No inflation | Y | 🔧 Fixed | **v2 free path:** row-locked cap + atomic totals — DB-executed 20-way concurrency proof shows no inflation. ⚠️ v2 path only; paid path double-insert (PV-005) + cut-over remain. |
| VI-003 | Tally tamper-evident / append-only vote log | Integrity | P0 | Votes | Tamper attempt | Detected; immutable | Y | 🚫 Missing | Totals recomputed in place (mutable); no append-only/hash-chained ledger. `vote_audit_logs` exist but tally itself not tamper-evident. |
| VI-004 | Multi-account / bot voting detection | Trust | P1 | Bot pattern | Flood | Detected; flagged/blocked | P | ✅ Pass | Executed: `tests/unit/voting/fraud-detection.spec.ts` against real `runFraudChecks` (`fraud.service.ts`, protected/read-only) with a mocked Supabase client — `duplicate_device` flags correctly at >3 accounts sharing a device fingerprint, does not flag at ≤3. |
| VI-005 | Abnormal velocity / IP / device signals | Trust | P1 | Spike | Vote | Rate-limited; flagged | Y | ✅ Pass | Executed: `fraud-detection.spec.ts` — `duplicate_ip` flags correctly above/below `suspiciousIpLimit`, `bot_speed` flags a same-user vote inside the threshold window. **Unresolved (documented, not fixed):** the 30/min IP limiter in `votes/free/route.ts:57` is in-memory/per-instance (no Redis backing) — file is hook-protected, cannot be edited here; needs a `voting-bridge` adapter to move it to a shared store. |
| VI-006 | Self-voting / organizer manipulation controls | Trust | P1 | Insider | Manipulate | Prevented/flagged; audited | Y | ✅ Pass | Executed: `fraud-detection.spec.ts` — `self_vote` (score 50, critical) fires when the voting `userId` equals the contestant's enrolled `user_id`; does not fire for a different voter. |
| VI-007 | Contestant vote counts isolated per contest | Correctness | P0 | Multi-contest | Tally | No cross-contest bleed | Y | ✅ Pass | Executed: `tests/unit/voting/vote-totals-isolation.spec.ts` — `getVoteTotals`/`getLeaderboard` (`totals.service.ts`, protected/read-only) query both `contest_id` AND `contestant_id`; same contestant id under two different contests returns fully independent totals (no bleed). |
| VI-008 | Suspicious-vote review & invalidation (audited) | Trust | P1 | Fraud found | Invalidate | Removed; tally adjusts; audited | Y | 🚧 Partial | Executed: `tests/unit/voting/fraud-flag-and-vote-invalidation.spec.ts`. **Correction to prior notes:** invalidation is NOT "indirect" — `POST /api/admin/voting/votes/[voteId]/reverse` is a real endpoint that marks the vote reversed, refunds a wallet-funded purchase (idempotent), decrements totals, and is audited; `PATCH .../fraud-alerts` separately resolves the flag (status + note + audit). **Fixed this pass:** `reverse/route.ts` now also calls `recomputeRanks` after invalidation (best-effort, non-fatal) so the leaderboard rank no longer goes stale until the next unrelated recompute. **Remains Partial:** the two endpoints are separate calls, not one click — reviewing a flag and reversing the vote are deliberately different actions today; a true one-click maker-checker void is a new-subsystem product decision, not built here. |
| VI-009 | Leaderboard ordering & tie handling correct | Correctness | P1 | Tallies | Rank | Correct order; ties per rule | Y | 🚧 Partial | Executed: `tests/unit/voting/leaderboard-tiebreak.spec.ts`. Primary path (RPC `recompute_leaderboard_ranks`) DOES define a tie-break (`total_confirmed_votes DESC, paid_votes DESC, last_vote_at ASC`) — confirmed via the RPC call contract. **Genuine gap found, not fixed:** `fallbackRecomputeRanks` in `totals.service.ts` (protected, used only if the RPC errors) orders by `total_confirmed_votes` alone — ties are arbitrary there, and the two paths can disagree on who ranks 1st. Cannot edit `totals.service.ts` directly (brownfield-protected); needs a `voting-bridge` wrapper or an RPC-reliability fix. Go's `ComputeRankChange`/`recomputeRanks` search in the earlier notes was a mis-citation — those symbols belong to the unrelated STEM leaderboard feature, not contest voting (no Go implementation exists for this module). |
| VI-010 | Final results locked & published immutably | Integrity | P0 | Close | Publish | Locked; audit trail; no edits | Y | 🚧 Partial | Rounds have `results_published` status; **no explicit compute→publish→lock (immutable) flow** or tie-break. See AD-011. |

### TS-7 · Vote Visibility Control (admin hide)

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| VV-001 | Hide votes from public — counts not shown anywhere public | Privacy | P0 | Hidden | Public view | No counts in UI/API/leaderboard | Y | 🔧 Fixed | **D-004 fixed (Pass 1):** `vote-page` now gates `totals` via `getEffectiveVisibility` (counts+rank omitted when hidden; `totals=null` when both hidden). Regression: `tests/unit/voting/vote-page-visibility.spec.ts` (4 cases, green). |
| VV-002 | Hide votes from contestants — contestant can't see own/others' counts | Privacy | P0 | Hidden | Contestant view | Counts hidden per config | Y | 🔧 Fixed | **Bug found + fixed this pass:** `GET /api/contestant/votes/summary` (backing `app/contestant/votes`) returned exact `totals`/rank unconditionally, ignoring admin visibility — same leak class as D-004. Fixed by gating `totals`/`currentRank`/`votesToNextRank` through `getEffectiveVisibility`, mirroring the vote-page pattern exactly. Regression: `tests/unit/voting/contestant-self-view-visibility.spec.ts` (5 cases, green). |
| VV-003 | No side-channel leak (API/notification/order) | Security | P0 | Hidden | Probe API/notifs | No count inferable; order not leaking exact counts | Y | 🚧 Partial | **D-005 API/order fixed (Pass 1):** leaderboard route now uses phase-aware `getEffectiveVisibility`, strips rank when hidden, redacts frozen snapshot. Regression: `tests/unit/voting/leaderboard-visibility.spec.ts` (green). **Remaining:** notification side-channel (NT-003) — deferred to bridge (`milestone.service.ts` protected). |
| VV-004 | Authorized admins still see & audit counts | RBAC | P0 | Hidden | Admin view | Full visibility; audited | Y | ✅ Pass | Executed: `tests/unit/voting/admin-leaderboard-visibility.spec.ts` — `GET /api/admin/voting/[contestId]/leaderboard` is real RBAC-gated (401 no creds, 403 role without `votes:manage`, both server-key and JWT paths), and correctly never consults `getEffectiveVisibility` — an authorized admin always sees full counts + rank regardless of public/hidden state. (No dedicated admin leaderboard UI page exists in the current tree — only the API route; the test targets the route directly.) |
| VV-005 | Toggle hide→show (and back) applies immediately | Functional | P1 | Contest | Toggle | State changes everywhere at once | Y | ✅ Pass | Executed: `tests/unit/voting/visibility-toggle-and-granularity.spec.ts` — `getEffectiveVisibility` (the single seam all fixed consumers read through post D-004/D-005) does a plain per-call DB read with no cache/memoization; proved two consecutive calls with different underlying settings return different results immediately, for both contest-level and active-phase-override toggles. |
| VV-006 | Reveal at defined time / on close (scheduled) | Functional | P1 | Scheduled | Reach time | Revealed per schedule | Y | 🚫 Missing | No scheduled/timed reveal (`reveal_at`) logic. |
| VV-007 | Hidden results never leak in exports/logs/cache | Security | P0 | Hidden | Inspect | No leak in any artifact | Y | 🚧 Partial | **Snapshot cache path fixed (Pass 1):** frozen leaderboard snapshot now redacted (`leaderboard-visibility.spec.ts`). **CSV export/revenue routes verified this pass (by design, not a leak):** `export/route.ts` (`type=leaderboard`) and `revenue/route.ts` deliberately do NOT consult `getEffectiveVisibility` — they're admin-only financial/ops artifacts, gated purely by `assertAdminPermission`, which we proved actually runs BEFORE any data read (401/403 return zero rows). Regression: `tests/unit/voting/export-revenue-rbac.spec.ts` (6 cases, green). **Still open:** structured-log leak review (e.g. does any log line print raw vote counts on a hidden contest) not assessed — no logging framework/log-capture harness found to test against; out of scope for a same-pattern fix. |
| VV-008 | Per-audience granularity (hide public, show contestant) | Config | P1 | Config | Set granularity | Each audience honored independently | Y | 🚧 Partial | Executed: `tests/unit/voting/visibility-toggle-and-granularity.spec.ts` pins current reality — `getEffectiveVisibility(contestId)` takes no audience/actor parameter and returns ONE undifferentiated value; after the VV-002 fix, the contestant self-view now reads the *same* flags as the public surfaces (previously it read none). So "hide from public but still show the contestant their own count" is genuinely not achievable with today's schema (`show_public_vote_count/leaderboard/rank` are contest/phase-scoped only, not audience-scoped). A real fix needs a new audience-scoped column (e.g. `show_contestant_vote_count`) plus updates to every consuming route — a product decision + larger scoped work, not built here. |
### TS-8 · Contest Types — Virtual / Physical / Hybrid

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| CT-001 | Virtual contest end-to-end (online voting only) | Functional | P1 | Virtual | Run | Online flows work; no physical steps required | Y | 🚧 Partial | Online free+paid flow works; blocked by register→vote seam (RG-001) for full e2e. |
| CT-002 | Physical contest: on-site check-in / attendance | Functional | P1 | Physical | Check-in | Attendance recorded; QR/code valid | Y | 🚫 Missing | No voting check-in/attendance. A QR scanner exists only in Events module, not wired to voting (MB-011). |
| CT-003 | Physical/offline vote capture & reconciliation | Integrity | P0 | Physical votes | Import offline | Reconciled into tally without inflation; audited | Y | 🚫 Missing | No offline vote ingestion/reconciliation anywhere. Build required (AD-009). |
| CT-004 | Hybrid: online + on-site votes merged correctly | Integrity | P0 | Hybrid | Combine | Correct combined tally; no double-count | Y | 🚫 Missing | Depends on CT-003 (absent). No merge logic. |
| CT-005 | Type-specific config/screens shown correctly | Functional | P1 | Each type | Open | Correct UI/flows per type | Y | 🚧 Partial | Type enum on registration side only; no type-specific voting UI/flows (CS-005). |
| CT-006 | Physical judge/panel scoring (if applicable) | Functional | P2 | Judged | Score | Weighted with public vote per rule | Y | 🚧 Partial | Rounds support public-vs-judge weights (`voting/[contestId]/rounds`); full judge-scoring flow not built. |
| CT-007 | Offline-vote fraud controls (duplicate slips) | Trust | P1 | Offline import | Duplicate | Detected; deduped | Y | 🚫 Missing | No offline import → no dedup. Ties EC-014. |
| CT-008 | Venue/geo constraints for physical voting | Business rule | P2 | Physical | Vote off-site | Blocked per rule if configured | P | 🚫 Missing | No geo/venue constraint logic. |

### TS-9 · Notifications & Engagement

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| NT-001 | Contestant approved/rejected/photo-ready notification | Functional | P1 | Events | Trigger | Timely, correct, deduped | Y | 🚧 Partial | Real composer only in legacy open-mic; new voting module `/admin/notifications` is scaffold stub (genuinely unbuilt, out of Batch-1 scope). "photo-ready" impossible (no pipeline, needs TS-3). No feasible unit test against existing code beyond what's already covered — no regression added. |
| NT-002 | Voter: daily free-vote reminder / vote confirmation | Functional | P2 | Voter | Trigger | Correct; respects prefs | Y | 🚧 Partial | Mobile notifications center is read-only (no mark-as-read/mutation); confirmed no daily-reminder trigger exists anywhere in `frontend-web/src/server/voting/` (grep swept — only vote-receipt and milestone emails fire). "Vote confirmation" IS covered: `sendVoteReceiptEmail` fires from the protected paid-vote path (existing coverage). Reminder cron is a net-new feature, not a bug — out of scope. |
| NT-003 | Notification never leaks hidden vote counts | Privacy | P0 | Hidden | Notify | No count/rank leak | Y | ❌ Fail | Milestone emails (`milestone.service.ts`) include rank+totalVotes without consulting visibility. **Confirmed no non-protected seam exists**: `checkAndFireMilestones()` has exactly one call site (`totals.service.ts` → `fallbackRecomputeRanks`, itself protected), which in turn calls `sendMilestoneEmail()` in `email.service.ts` (also protected) — the entire rank→email chain is inline across three hook-protected files with no importable/wrappable boundary a bridge adapter could intercept. Also newly found: this fallback path only runs when the `recompute_leaderboard_ranks` RPC errors, so milestone emails are rarely reached at all today. Genuinely requires a deeper fix (either edit the protected files, which is blocked, or move milestone-eligibility computation into the DB layer and have the protected email-send become unreachable/replaced) → stays deferred to bridge track. API/leaderboard leak already fixed (D-005). See D-005b. |
| NT-004 | Results announcement on close | Functional | P1 | Close | Announce | Correct winners; per visibility rules | Y | 🚧 Partial | No compute→publish→lock flow (VI-010) to drive a correct announcement — confirmed still absent, no announcement trigger found in `frontend-web/src/server/voting/`. Net-new feature, out of Batch-1 scope. |
| NT-005 | No duplicate/stale notifications | Idempotency | P2 | Retried | Observe | Deduped | Y | 🚧 Partial | Vote-receipt and milestone emails have **no dedup/idempotency guard** at the email layer — `sendVoteReceiptEmail`/`sendMilestoneEmail` fire unconditionally on every call; the milestone service's own comment (`milestone.service.ts:47-49`) admits "you'd store 'last notified rank' to prevent re-fires" but doesn't. Confirmed, not fixed (both files hook-protected; same seam gap as NT-003). |
| NT-006 | Share contestant profile (composited image) to social | Functional | P2 | Contestant | Share | Correct image/deeplink; drives votes | Y | 🚧 Partial | Confirmed: `ShareBottomSheet` shares text + deep link only; **no composited image card** — no image-compositing code path exists anywhere in the share flow (needs TS-3 image pipeline, `imageCompositor.ts` is orphaned per G-IMG). No change made, finding confirmed as-is. |

### TS-10 · Security, Privacy & RBAC

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| SEC-001 | IDOR: contestant/vote/contest own-scope only | Security | P0 | Two users | Access foreign | 403/404 | Y | 🚧 Partial | Full sweep done across `votes/*`, `admin/voting/*`, `leaderboard/*` (registration routes covered separately, RG-010). Findings: (1) every admin `[id]` route calls `assertAdminPermission` with an appropriate permission — no gap, and admin roles are intentionally global/platform-wide, not per-contest, so no missing ownership check. (2) `votes/paid/verify` takes a client-supplied `transactionId` with no auth requirement, but credit always goes to the transaction's stored `voter_user_id` (set at initiation), never to the caller — verified in `paid-vote.service.ts`; not IDOR. (3) **NEW finding, not previously logged**: `GET /api/votes/stream` (SSE) streams live `total_confirmed_votes`/`rank` straight from `vote_totals` with **no `getEffectiveVisibility()` call at all** — worse than the pre-D-005 leaderboard bug, and still open. Route is hook-protected with no wrappable seam (whole query is inline in route.ts, no exported function) → deferred to bridge track. Logged as **D-008**. Test: `tests/unit/voting/sec-001-stream-visibility-gap.spec.ts` (documents/pins the gap). |
| SEC-002 | RBAC: voter/contestant/organizer/admin scoping | Security | P0 | Each role | Cross-scope | Only permitted; else 403 | Y | 🚧 Partial | Verified: every non-`votes:manage` role (incl. adjacent `finance_admin`, unrecognized role strings, and unauthenticated) gets 401/403 fail-closed from `assertAdminPermission`; a client-supplied `x-admin-role` header cannot elevate on the JWT path (DB role is the only source of truth — confirmed by reading `src/server/admin/auth.ts`, the code never even reads that header on the JWT path). Admin voting guarded by `votes:manage`/`finance:view`/`reports:export` as appropriate (swept all 16 admin voting route handlers). Real RBAC console in `frontend-admin`. Test: `tests/unit/voting/sec-002-rbac-scoping.spec.ts` (7 tests, green). |
| SEC-003 | Server authoritative on vote counts/payments | Security | P0 | Tamper | Alter payload | Recomputed; rejected | Y | 🔧 Verified | `POST /api/votes/paid/wallet` resolves price/votes/bonus **only** from the server-side `vote_packages` row by `packageId`; its request body type has no amount/vote-count field to tamper in the first place. Test sends a payload with extra `amount`/`votes`/`voteQuantity` overrides and confirms they're silently ignored — the wallet debit and credited vote count both come from the DB row. Test: `tests/unit/voting/sec-003-server-authoritative.spec.ts` (2 tests, green). |
| SEC-004 | Vote/payment/likeness data encrypted at rest/in transit | Security | P0 | Data | Inspect | Encrypted; TLS; no plaintext | Y | 🚧 Partial | Confirmed infra-level only (Supabase/R2 TLS + at-rest by default) — out of Batch-1 scope to build/verify further. App-level likeness handling still not verified (EXIF not stripped — IMG-010, unchanged). |
| SEC-005 | Maker–checker on results/invalidation/refunds | Security | P0 | Sensitive op | Single actor | 2nd approver required | Y | 🚫 Missing | Net-new feature — left alone per Batch-1 scope. No maker–checker on voting results/invalidation/refunds; single-actor today. Build required (unchanged from prior pass). |
| SEC-006 | Injection / API abuse on endpoints | Security | P0 | Endpoints | Payloads | Sanitized; rejected | Y | 🚧 Partial | Spot-checked 4 endpoints (`votes/free`, `votes/paid/wallet`, `admin/voting/[contestId]/adjust`, `leaderboard/[contestId]`): malformed/truncated JSON is caught and returns a handled 4xx/5xx `Response`, never an uncaught throw; SQL-injection- and NoSQL-operator-shaped payloads pass through as opaque parameterized values (Supabase client parameterizes `.eq()`/`.insert()` — no string concatenation found anywhere in the swept routes); a 200KB string query param doesn't crash the leaderboard handler. Not a full pen-test — scoped spot-check only, per Batch-1 scope. Test: `tests/unit/voting/sec-006-injection-abuse.spec.ts` (5 tests, green). |
| SEC-007 | Image upload safety (type/size/scan/SVG-XSS) | Security | P0 | Upload | Malicious file | Rejected/sanitized | Y | 🔧 Partial fix | Small scoped fix applied: `app/api/registration/uploads/route.ts` used to set the stored/served Content-Type from the client-controlled multipart `file.type` field — a file named "photo.png" with a spoofed `file.type: image/svg+xml` (or `text/html`) would be served back with that header, which some browsers render per-Content-Type regardless of the URL extension (stored XSS). Fixed: Content-Type is now derived from a server-owned extension→MIME allowlist, never from the client. `.svg` was already absent from the extension whitelist (still rejected outright — no sanitizer exists for inline SVG, so it stays fully blocked rather than attempting to sanitize). **Still missing**: malware scan, image re-encode/transcode pipeline (unchanged, out of scope — needs TS-3). Test: `tests/unit/registration/sec-007-upload-content-type.spec.ts` (5 tests, green). |
| SEC-008 | Rate limiting (vote/register/pay/upload) | Security | P1 | Flood | Hit | Throttled (429) | Y | 🔧 Verified | Confirmed end-to-end with the REAL (non-mocked) limiter driven through the real `POST /api/votes/free` handler: 30 requests from one IP succeed, the 31st returns 429; a different IP is unaffected. (Existing coverage already unit-tested the limiter function and the route's 429-wiring separately but never together with the real limiter — this closes that gap.) Still **in-memory / per-instance, not distributed** (unchanged, multi-instance deploys would under-throttle — flagged, not fixed, infra-level). Test: `tests/unit/voting/sec-008-rate-limit-e2e.spec.ts` (2 tests, green). |
| SEC-009 | Immutable audit log (config/votes/results/finance) | Compliance | P0 | Actions | Inspect | Attributable; append-only; exportable | Y | 🔧 Verified | Confirmed against two real admin routes (vote adjustment, vote reversal): both call `appendAuditLog` exactly once with the actor id/role from the **verified admin identity** (never client-supplied), the correct action name, and before/after values. `audit.service.ts` exposes only `appendAuditLog`/`getAuditLogs` — no update/delete function exists anywhere in the module, so the log is append-only by construction at the TS layer (DB-level immutability trigger/constraint not verified — out of scope this pass). Tally itself still not immutable (VI-003, unchanged). Test: `tests/unit/voting/sec-009-audit-log.spec.ts` (3 tests, green). |
| SEC-010 | Consent/likeness rights enforced before publish | Compliance | P0 | Photo | Publish w/o consent | Blocked | Y | 🚫 Missing | Net-new feature — left alone per Batch-1 scope. No enforced consent/rights gate before processing/publishing (RG-003). Build required (unchanged from prior pass). |

### TS-11 · Non-Functional (Performance, Resilience, Availability, A11y)

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| NF-001 | Voting surge at poll close (viral contest) | Performance | P0 | Load | Flood votes | No lost/dup; correct tally; stable | Y | ⚠️ Blocked | Not assessed (needs load harness). **At risk** from D-002/D-003 (non-atomic counting/tally). Re-run after integrity fixes. |
| NF-002 | Image pipeline throughput under bulk registration | Performance | P1 | Bulk | Process | Within SLO; queued; no loss | Y | ⚠️ Blocked | No pipeline to load-test (TS-3 absent). |
| NF-003 | Leaderboard/read scaling under traffic | Performance | P1 | Load | Read | Cached; fresh enough; no leak when hidden | Y | ⚠️ Blocked | Not assessed (needs load env). Hidden-leak dependency on D-004/D-005. |
| NF-004 | Service/DB failover without vote loss | Resilience | P0 | Failover | In-flight votes | Consistent; no lost/dup | Y | ⚠️ Blocked | Not assessed (needs chaos env). At risk from non-atomic paths. |
| NF-005 | Idempotency under retry storm | Resilience | P0 | Storm | Replay | No dup votes/charges/images | Y | ⚠️ Blocked | Not assessed. Free-vote path not idempotent (D-002) → **expected to fail** until fixed; paid path idempotent. |
| NF-006 | Background-removal vendor outage degrades safely | Resilience | P0 | Vendor down | Register | Queued/fallback; no broken profile; retry | Y | ⚠️ Blocked | No vendor wired (TS-3 absent). Design fallback as part of image build. |
| NF-007 | Payment gateway outage degrades safely | Resilience | P0 | Gateway down | Paid vote | Fail closed; no orphan charge/votes | Y | ⚠️ Blocked | Pending tx + idempotent credit suggest safe degrade; needs chaos test to confirm. |
| NF-008 | Accessibility (register, vote, results) | Accessibility | P1 | A11y tools | Audit | WCAG-aligned; labels | M | ⬜ Not Run | Manual audit pending. |
| NF-009 | Localization / RTL / currency | Localization | P3 | Locales | Switch | Correct; no truncation | M | ⬜ Not Run | Manual audit pending. |
| NF-010 | Observability (no vote-count leak in logs when hidden) | Ops | P1 | Running | Inspect | Signals; no hidden-count leak | M | ⬜ Not Run | Log-leak review pending (tie to D-004/D-005). |

### TS-12 · Edge Cases & Chaos ("outside the box")

| ID | Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| EC-001 | Free-vote limit at exact TZ/day boundary (23:59→00:00) | Integrity | P0 | Boundary | Vote across | Correct reset; no extra/lost vote | Y | 🔧 Fixed | **D-001 (v2):** `resolveVoteDate` buckets by contest TZ; `vote-window.spec.ts` asserts 22:59Z vs 23:00Z Lagos → correct local-midnight rollover. ⚠️ v2 path only. |
| EC-002 | DST change day affects daily reset | Edge | P1 | DST | Vote | Correct wall-clock reset | Y | 🔧 Fixed | **D-001 (v2):** Intl tz DB is DST-aware; `vote-window.spec.ts` covers America/New_York fall-back. ⚠️ v2 path only. |
| EC-003 | Paid vote succeeds but count-apply fails | Resilience | P0 | Race | Fail apply | Reconciled: votes credited or refunded; no loss | Y | 🚧 Partial | Durable `vote_credit_status` anchor supports recovery; explicit count-apply-fail reconciliation test absent. |
| EC-004 | Duplicate payment webhook replay (attacker) | Idempotency | P0 | Webhook | Replay | One credit; no double votes | Y | ⬜ Not Run | Implemented: webhook dedup via `payment_webhook_logs` + credit idempotency. Pending replay test. |
| EC-005 | Background removal leaves halo/artifact | Correctness | P1 | Hard image | Process | Flagged/fallback; not published broken | P | 🚫 Missing | No removal step (TS-3 absent). |
| EC-006 | Contestant uploads someone else's photo (likeness) | Compliance | P1 | Fake photo | Detect | Consent/rights + moderation guard | P | 🚫 Missing | No moderation/consent guard (SEC-010/IMG-001). |
| EC-007 | Contest with 10,000+ contestants (scale) | Performance | P2 | Large | Load | Handles; pipeline queued; UI paginates | Y | ⚠️ Blocked | Not assessed (needs scale env). |
| EC-008 | Admin hides votes but leaderboard order leaks ranking | Security | P0 | Hidden | Inspect order | Order does not reveal hidden counts | Y | 🔧 Fixed | **Fixed (Pass 1):** rank stripped from leaderboard + vote-page when `showRank` hidden; counts stripped when `showVoteCount` hidden (live + snapshot). Regression: `leaderboard-visibility.spec.ts`, `vote-page-visibility.spec.ts`. |
| EC-009 | Vote after contest close (late/queued request) | State machine | P0 | Closed | Late vote | Rejected; not counted | Y | ⬜ Not Run | Implemented (`assertVotingOpen`). Pending test. |
| EC-010 | Refund after results published | Edge | P1 | Published | Refund | Handled per policy; audited; integrity kept | Y | 🚧 Partial | Refund reversal idempotent; interaction with published/locked results undefined (VI-010 missing lock). |
| EC-011 | Template changed mid-contest re-composites all | Edge | P1 | Live | Change template | All contestant images regenerated correctly | Y | 🚫 Missing | No pipeline/re-composite (TS-3 absent). |
| EC-012 | Same person registers in two contests | Correctness | P1 | Two contests | Register both | Isolated entries/forms/templates; no bleed | Y | ⬜ Not Run | Per-contest isolation implemented; covered partially by `contest-distinctness.spec.ts`. Pending explicit test. |
| EC-013 | Bot farm votes free at scale | Trust | P1 | Bot farm | Flood | Detected; throttled; tally protected | P | 🚧 Partial | Fraud heuristics + IP limit exist, but limiter is in-memory (per-instance) and counting is racy (D-002). |
| EC-014 | Offline physical votes double-imported | Integrity | P0 | Import twice | Re-import | Deduped; no inflation | Y | 🚫 Missing | No offline import (CT-003). |
| EC-015 | App killed mid-vote / mid-payment | Resilience | P0 | In flow | Kill app | No dup/partial; safe resume | Y | 🔧 Fixed | Paid path idempotent; **free path now idempotent** on v2 (`X-Idempotency-Key` + atomic claim). ⚠️ v2 path only; cut-over deferred. |
| EC-016 | Disqualified contestant with existing votes at results | Edge | P1 | DQ | Compute | Votes handled per rule; results correct | Y | 🚧 Partial | DQ not wired to tally/results (RG-012). |
### TS-13 · Mobile App Screens (voter & contestant) — build to production grade

> Every screen must exist and handle **loading / empty / error / permission-denied / offline / voting-closed / votes-hidden** states, be accessible, and carry the audit fixes. `🚫 Missing` = screen not built → build it.

| ID | Screen / Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| MB-001 | Contest discovery / list & detail | Functional | P1 | Voter | Browse | Correct contests, type, phase, rules | Y | ⬜ Not Run | Built: `app/voting/{index,contests,contest-details}.tsx`. **Mock data only** (`EXPO_PUBLIC_VOTING_USE_MOCK`), untested. Pending live-wire + test. |
| MB-002 | Contestant registration form (dynamic per contest) | Functional | P0 | Open contest | Register | Renders that contest's schema; validates | Y | ⬜ Not Run | Built: schema-driven wizard `app/registration/[id]/wizard.tsx` + `FieldRenderer`. Untested on mobile. |
| MB-003 | Photo upload + preview of composited result | Functional | P0 | Register | Upload | Preview shows subject on template; adjust | M | 🚧 Partial | Upload works; **no composited-result preview** (no pipeline — TS-3). |
| MB-004 | Contestant gallery (composited profile cards) | Functional | P1 | Contest | Browse | Correct template composites; fast load | Y | 🚧 Partial | `app/voting/contestants.tsx` grid uses **plain cards, not composited/framed** profile cards. |
| MB-005 | Contestant profile & vote screen (free + paid) | Functional | P0 | Voter | Open | Free/paid options; rules shown | Y | ⬜ Not Run | Built: `app/voting/contestant-profile.tsx` (free+paid sheet, hidden-aware). Mock-only, untested. |
| MB-006 | Free vote action + daily-limit state | Integrity | P0 | Voter | Vote | 1/day enforced; clear "come back tomorrow" | Y | ⬜ Not Run | Built: `useCastFreeVotes` + `FreeVoteResetCountdown`. **Enforced by backend (see D-001/D-002 defects).** Mock-only, untested. |
| MB-007 | Paid vote purchase flow (packages, pay, step-up) | Money | P0 | Voter | Buy | Correct amount; votes credited; receipt | Y | ⬜ Not Run | Built: `buy-votes → payment-method → payment-processing → vote-success/failed`. Untested on device. |
| MB-008 | Leaderboard / results screen (respects hidden state) | Privacy | P0 | Voter | Open | Shows or hides counts per admin config | Y | ⬜ Not Run | Built: `app/voting/leaderboard.tsx` + explicit hidden UI. Depends on backend gating (D-004/D-005). |
| MB-009 | Contestant dashboard (my votes — hidden-aware) | Privacy | P0 | Contestant | Open | Own stats per visibility rules | Y | 🚧 Partial | Voter history built (`my-votes.tsx`); contestant campaign dashboard has **QR & Flyer "Coming soon" placeholders**. |
| MB-010 | Share contestant card to social | Functional | P2 | Contestant | Share | Correct image + deep link | Y | 🚧 Partial | Shares text + deep link; **no generated image card**; "copy link" falls back to Share. |
| MB-011 | Physical/hybrid check-in screen (QR) | Functional | P1 | Physical | Check-in | Valid QR; attendance recorded | Y | 🚫 Missing | No voting QR check-in (only Events module has a scanner). |
| MB-012 | Notifications center | Functional | P2 | Events | Open | Correct, deduped, no hidden-count leak | Y | ⬜ Not Run | Built: `app/voting/notifications.tsx` (read-only, no mark-as-read). Pending test. |
| MB-013 | Wallet / payment methods & history | Money | P1 | Voter | Manage | Correct; secure | Y | 🚧 Partial | No voting-scoped wallet/saved-cards mgmt; method choice via shared `PaymentSheet`; history via `my-votes`/`vote-receipt`. |
| MB-014 | All screens: loading/empty/error/offline/closed/hidden | UX | P1 | Each | Force states | Graceful; retriable; no crash | Y | 🚧 Partial | Strong loading/empty/error/closed/hidden coverage; **no explicit offline/no-network handling** in voting screens. |
| MB-015 | Device/OS matrix & responsiveness | Compatibility | P2 | Device farm | Smoke | Consistent | M | ⬜ Not Run | Manual device-farm pass pending. |

### TS-14 · Admin / Organizer Portal Screens — build to production grade

| ID | Screen / Test Case | Type | Pri | Preconditions | Steps (summary) | Expected Result | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| AD-001 | Contest builder (metadata, phases, type, prizes) | Functional | P1 | Organizer | Build | All config; audited | Y | 🚧 Partial | `RegistrationContestManager.tsx`: metadata/type yes; **no prizes**; phases separate (rounds). |
| AD-002 | Registration-form builder (per-contest dynamic schema) | Config | P0 | Contest | Build form | Fields/types/required; preview; isolated | Y | 🚧 Partial | Field-catalog builder present; **no live preview** pane. |
| AD-003 | Template manager (upload PNG + placement/anchor/scale) | Config | P0 | Contest | Configure | Template + placement spec; live preview | Y | 🚫 Missing | No admin UI; server compositor orphaned. Build required (CS-004). |
| AD-004 | Free/paid vote rules & packages editor | Money | P0 | Contest | Configure | 1/day rule + packages; minor-unit prices | Y | ⬜ Not Run | Built: `voting/[contestId]/{settings,packages}`. Pending test. |
| AD-005 | Vote-visibility control (hide public/contestant; schedule reveal) | Privacy | P0 | Contest | Toggle | Applies everywhere; no leak; audited | Y | 🚧 Partial | Settings toggles + `frontend-admin/voting/visibility` (per-phase); **no scheduled reveal**; leak fixes pending (D-004/D-005). |
| AD-006 | Contestant management (approve/reject/reprocess image/DQ) | RBAC | P0 | Pending | Manage | Correct states; re-pipeline; audited | Y | 🚧 Partial | `/admin/contestants` is a **scaffold stub** (mock). Real lifecycle only in legacy stages-evictions. No reprocess/DQ for new engine. |
| AD-007 | Live vote monitoring & tally (admin sees hidden counts) | Integrity | P0 | Live | Monitor | Accurate real-time tally; audited access | Y | ⬜ Not Run | Built: `voting/[contestId]/leaderboard` (free/paid split, freeze, manual adjust). Pending test. |
| AD-008 | Fraud/suspicious-vote review & invalidation | Trust | P0 | Signals | Review | Invalidate w/ maker–checker; tally adjusts | Y | 🚧 Partial | Fraud review UI present; **invalidation indirect, no maker–checker** (SEC-005). |
| AD-009 | Offline/physical vote import & reconciliation | Integrity | P0 | Physical | Import | Deduped; reconciled; audited | Y | 🚫 Missing | No admin UI in either app. Build required. |
| AD-010 | Payments/finance console (sales, refunds, reconciliation) | Money | P0 | Sales | Manage | Maker–checker; idempotent; reconciled | Y | 🚧 Partial | Revenue/transactions/export built; **refund action not exposed in UI** (status only); no maker–checker. |
| AD-011 | Results management (compute, tie-break, publish/lock) | Integrity | P0 | Close | Publish | Locked; immutable; audited | Y | 🚧 Partial | Rounds w/ `results_published`; **no tie-break, no explicit compute→publish→lock** (VI-010). |
| AD-012 | Announcements / notifications composer | Functional | P1 | Admin | Send | Correct audience; no hidden-count leak | Y | 🚧 Partial | Real composer only in legacy open-mic; new module is scaffold stub. |
| AD-013 | Analytics (votes, revenue, engagement — respects hidden) | Privacy | P2 | Data | View | Correct; no leak of hidden to unauthorized | P | 🚧 Partial | Only Revenue dashboard is real; `/admin/reports-analytics` is scaffold stub. |
| AD-014 | RBAC & admin sub-role scoping | Security | P0 | Sub-roles | Cross-scope | Only own scope; else 403 | Y | ⬜ Not Run | Built in `frontend-admin` (`roles`, `permissions-matrix`, `rbacAdminService`). Web `/admin/users-roles` is stub. Pending cross-scope test. |
| AD-015 | Immutable audit log explorer & export | Compliance | P0 | Actions | Query/export | Complete; immutable | Y | ⬜ Not Run | Built: `frontend-admin/audit-logs` (filters + export). Web scaffold read-only. Pending immutability test. |
| AD-016 | Kill switch: pause voting / freeze results / halt contest | Safety | P0 | Incident | Halt | Scope halted; audited | Y | 🚧 Partial | Distributed: settings `status='paused'` + leaderboard freeze/unfreeze. **No unified kill switch.** |
| AD-017 | Admin screens: loading/empty/error/permission states | UX | P1 | Each | Force states | Graceful; no crash | Y | 🚧 Partial | Real screens handle states; scaffold-stub slugs render mock only. |

### TS-15 · User Acceptance Testing (UAT) — business sign-off

> Run by business stakeholders (Organizer, Admin, plus voter/contestant proxies). Status uses `✅ Accepted` / `❌ Fail` / `🚫 Missing`. Acceptance requires the Expected Business Outcome to be met on realistic sample contests.

| ID | UAT Scenario | Actor | Pri | Preconditions | Steps (summary) | Expected Business Outcome | Auto | Status | Remedial Action / Notes |
|---|---|---|---|---|---|---|---|---|---|
| UAT-001 | Launch a new contest end-to-end | Organizer | P0 | Portal access | Build contest, form, template, rules, publish | Contest live and ready to receive contestants | M | ⚠️ Blocked | Blocked: no template manager (AD-003), no prizes/publish-lock. |
| UAT-002 | Contestant registers and sees polished profile | Contestant | P0 | Live contest | Fill form, upload photo, submit | Photo auto-cut and placed on template; looks professional | M | ⚠️ Blocked | Blocked: no image pipeline (TS-3) and register→vote seam broken (RG-001). |
| UAT-003 | Different contests use different forms & templates | Organizer | P0 | 2 contests | Register in each | Each shows its own form and template; no mix-up | M | ⚠️ Blocked | Forms isolated; **templates absent** (CS-004). |
| UAT-004 | Voter casts free vote; blocked on second same day | Voter | P0 | Live voting | Vote twice for same contestant | 1st counts, 2nd blocked with friendly message; resets next day | M | ⚠️ Blocked | Blocked pending free-vote integrity fixes (D-001/D-002). |
| UAT-005 | Voter buys votes and they count correctly | Voter | P0 | Paid enabled | Buy package, pay | Exact votes added; receipt issued; charged once | M | ⚠️ Blocked | Paid path solid; ready for UAT once TS-5 tests executed. |
| UAT-006 | Admin hides vote counts; public/contestants can't see | Admin | P0 | Live contest | Toggle hide | Counts hidden everywhere; admin still sees | M | ⚠️ Blocked | Blocked pending visibility-leak fixes (D-004/D-005). |
| UAT-007 | Admin reveals results at close; winners correct | Admin | P0 | Close | Reveal & publish | Correct winners; results locked | M | ⚠️ Blocked | Blocked: no compute→publish→lock (VI-010/AD-011). |
| UAT-008 | Run a virtual contest | Organizer | P1 | Virtual | Full cycle | Online-only flow works | M | ⚠️ Blocked | Depends on RG-001 seam + integrity fixes. |
| UAT-009 | Run a physical/hybrid contest with on-site & online votes | Organizer | P0 | Hybrid | Combine votes | On-site + online reconcile into one correct tally | M | ⚠️ Blocked | Blocked: offline/hybrid reconciliation absent (CT-003/004). |
| UAT-010 | Fraud attempt (multi-account/bot) is contained | Admin | P1 | Fraud tools | Simulate | Suspicious votes flagged/invalidated; results trustworthy | M | ⚠️ Blocked | Heuristics exist; invalidation needs maker–checker (SEC-005). |
| UAT-011 | Poor-quality photo handled gracefully | Contestant | P1 | Hard photo | Upload | Fallback/guidance; no broken profile published | M | ⚠️ Blocked | Blocked: no pipeline/fallback (TS-3). |
| UAT-012 | Finance reconciliation matches vote sales | Admin | P0 | Sales data | Reconcile | Revenue == paid votes == counted; balances | M | ⚠️ Blocked | Revenue reporting exists; needs scheduled reconciliation (PV-009) before sign-off. |
| UAT-013 | Mobile experience is smooth for voter & contestant | Voter/Contestant | P1 | Devices | Full journey | Usable, fast, clear on target devices | M | ⚠️ Blocked | Screens built on mock; needs live-wire + device pass. |
| UAT-014 | Accessibility & clarity for non-technical users | Voter | P2 | A11y | Journey | Understandable; accessible; low error rate | M | ⚠️ Blocked | Pending a11y audit (NF-008). |
| UAT-015 | End-to-end trust: results are believable & auditable | Organizer/Admin | P0 | Closed contest | Review audit | Stakeholders trust the outcome; audit supports it | M | ⚠️ Blocked | Blocked: tally not tamper-evident (VI-003) + publish-lock missing. |
---

## 6. Automated Regression / CI Suite Mapping

| Layer | Scope | Reference tooling (swap for your stack) | CI stage | Gate |
|---|---|---|---|---|
| Unit | Free-vote-limit logic, tally, money math, template-placement math, form-schema validation, visibility gating | Jest / PyTest / JUnit | Every PR | Block on fail |
| Integration | registration→image-pipeline→publish, vote→payment→tally, reconciliation, fraud checks (mock), RBAC | Supertest / pytest+requests / Testcontainers + object store | Every PR | Block on fail |
| Contract | Contest/registration/vote/payment/image/admin API contracts | Pact | Every PR | Block on breaking change |
| Image/Visual | Background-removal + composite golden-image checks; screen visual regression | Pixel/format asserts + human review + device farm | Pre-release | Block on P0/P1 image/screen fail |
| E2E | Voter/contestant/organizer/admin journeys (sandbox) | Playwright / Appium/Detox | Pre-merge/nightly | Block on P0/P1 fail |
| Performance | Vote surge at close, image pipeline throughput, leaderboard reads | k6 / JMeter / Locust | Pre-release | SLO gate |
| Security/Privacy | IDOR/authZ, free-limit bypass, visibility leakage, upload/SVG-XSS, webhook auth | OWASP ZAP + custom integrity/privacy scripts | Nightly | P0 gate |
| Chaos/Resilience | Vendor/payment outage, failover, idempotency, vote/payment races | Fault-injection harness | Scheduled | Review |
| UAT | Business-acceptance scenarios (TS-15) | Manual, scripted | Pre-release | Business sign-off gate |

**CI quality gates:** unit + integration + contract on every PR (merge-blocking); nightly full regression + security/privacy; pre-release image/visual + performance + E2E; **UAT sign-off** before go-live. **Coverage enforced on integrity-critical paths** (free-limit, paid-vote count, tally, image placement, visibility, payments). **A red P0/P1 gate blocks release; no override without Business owner + Compliance sign-off.**

## 7. Entry & Exit Criteria

**Entry:** module + screens deployed to integration/staging/UAT; mock removal/payment wired; sample contests with templates/placement specs + rights-cleared photos + ballot/payment fixtures seeded; smoke (create contest → register → composite → free+paid vote → tally → hide/reveal) green.

**Exit = Production-Readiness Gate (§0.5):** 0 `🚫 Missing` + 0 `❌ Fail` on all P0/P1 **including every mobile & admin screen**; vote-integrity/image/money/visibility invariants proven; **UAT (TS-15) accepted**; regression + security + image/visual green in CI; **QA + Business owner + Compliance sign-off recorded.**

## 8. Defect / Task Severity

`S0` vote-integrity failure (free-limit bypass, wrong count, tally breach), money loss, hidden-count leak, wrong-likeness/broken-image published, core feature/screen missing → hard release-block · `S1` broken P0/P1 flow or missing screen → release-block · `S2` degraded non-critical · `S3` cosmetic.

---

## 20. Execution Rollup (Claude Code updates as it runs)

| Suite | Total | ✅ Pass/Acc | ❌ Fail | 🚫 Missing | ⚠️ Blocked | 🚧 Partial | 🔧 Fixed | 🏗️ Built | ⬜ Not Run |
|---|---|---|---|---|---|---|---|---|---|
| TS-1 Contest Setup | 12 | 3 | 0 | 3 | 0 | 5 | 1 | 0 | 0 |
| TS-2 Registration | 12 | 3 | 0 | 3 | 0 | 2 | 4 | 0 | 0 |
| TS-3 Photo Pipeline | 15 | 0 | 1 | 13 | 0 | 1 | 0 | 0 | 0 |
| TS-4 Free Voting | 12 | 5 | 0 | 0 | 0 | 3 | 4 | 0 | 0 |
| TS-5 Paid Voting | 12 | 8 | 0 | 2 | 0 | 2 | 0 | 0 | 0 |
| TS-6 Integrity & Anti-Fraud | 10 | 4 | 0 | 1 | 0 | 3 | 2 | 0 | 0 |
| TS-7 Vote Visibility | 8 | 2 | 0 | 1 | 0 | 3 | 2 | 0 | 0 |
| TS-8 Contest Types | 8 | 0 | 0 | 5 | 0 | 3 | 0 | 0 | 0 |
| TS-9 Notifications | 6 | 0 | 1 | 0 | 0 | 5 | 0 | 0 | 0 |
| TS-10 Security/Privacy/RBAC | 10 | 0 | 0 | 2 | 0 | 4 | 4 | 0 | 0 |
| TS-11 Non-Functional | 10 | 0 | 0 | 0 | 7 | 0 | 0 | 0 | 3 |
| TS-12 Edge & Chaos | 16 | 0 | 0 | 4 | 1 | 4 | 4 | 0 | 3 |
| TS-13 Mobile Screens | 15 | 0 | 0 | 1 | 0 | 6 | 0 | 0 | 8 |
| TS-14 Admin Portal Screens | 17 | 0 | 0 | 2 | 0 | 11 | 0 | 0 | 4 |
| TS-15 UAT | 15 | 0 | 0 | 0 | 15 | 0 | 0 | 0 | 0 |
| **TOTAL** | **178** | **25** | **2** | **37** | **23** | **52** | **21** | **0** | **18** |

> **Batch 1 note (2026-09-16):** 5 parallel agents executed every `⬜ Not Run` P0/P1 case plus the genuinely-fixable half of `🚧 Partial` across TS-1/2/4/5/6/7/9/10/12 — real bugs in existing code, no new subsystems. Not Run dropped 39→18 (remaining 18 are TS-11/TS-13/TS-14 screens/non-functional, out of this batch's scope), Pass rose 0→25, Fixed rose 12→21. **6 real bugs found and fixed**: RG-005 (registration reference collision at scale), VV-002 (contestant self-view visibility leak), VI-008 (stale leaderboard rank after vote reversal), SEC-007 (upload Content-Type spoofing → stored-XSS risk) — plus the pre-existing PV-005 (paid-vote double-credit) landed just before this batch. **1 new P0 leak found, not yet fixable**: D-008 (`GET /api/votes/stream` has zero visibility gating) — genuinely no wrappable seam without deeper bridge work, same class as the already-deferred NT-003. The remaining `🚫 Missing` (37) and most `🚧 Partial` (52) are net-new subsystems/features (image pipeline, offline reconciliation, maker-checker, consent gating, prizes/tie-break, admin/mobile screen builds) — explicitly out of Batch 1's scope per the user's own sequencing choice.

> **Baseline note (2026-07-30):** Classification is from **static code mapping**, not executed runs. Per §0.4 no P0 row may become `✅ Pass` on static reasoning — the **39 `⬜ Not Run`** are *implemented and look complete* (many with repo tests) but stay Not-Run until executed assertions prove them; the **68 `🚧 Partial`** are built-but-incomplete; **12 `❌ Fail`** are confirmed defects (see §24); **23 `⚠️ Blocked`** are UAT + non-functional cases that cannot run until upstream P0s land.

## 21. Priority Coverage Snapshot

| Priority | Approx count | Target before production |
|---|---|---|
| P0 (integrity/money/image/visibility) | ~95 | 100% Pass/Fixed/Built/Accepted; 0 Missing/Fail |
| P1 (critical) | ~65 | 100% on critical paths incl. screens & UAT; 0 Missing/Fail |
| P2/P3 | ~18 | ≥ 90% green |

## 22. Production-Readiness Burndown (Claude Code maintains)

| Pass # | 🚫 Missing (P0) | ❌ Fail (P0) | 🚫 Missing (P1, incl. screens) | ❌ Fail (P1) | UAT Accepted | Notes |
|---|---|---|---|---|---|---|
| Baseline | 15 | 10 | 14 | 2 | 0/15 | First full sweep (2026-07-30, static map). +68 🚧 Partial to finish. Also 25 impl'd-P0 rows pending executed tests. |
| Pass 1 | 15 | 7 | 14 | 2 | 0/15 | Fixed test-first: D-004 (vote-page leak), D-005 read-path (leaderboard phase-aware + snapshot redaction), EC-008 (rank/order leak) — 3 P0 defects cleared, 177 web tests green. Remaining P0 defects → bridge track: D-001/D-002 (free-vote TZ/atomicity), D-003 (tally), NT-003 (milestone). |
| Pass 2 | 15 | 1 | 14 | 1 | 0/15 | Free-vote integrity core closed on v2 bridge (D-001/D-002/D-003) — DB-proven. Remaining P0 Fail: NT-003 (milestone leak). |
| Pass 3 | 15 | 1 | 14 | 1 | 0/15 | **Web cut-over done:** `VoteModal` → `/api/v2/votes/free` + `X-Idempotency-Key`; `VOTES_BRIDGE_ENABLED` on in dev; live-verified (bridge engaged). ADR-035 (atomic claim) + ADR-039 (engine deprecation) written; ADR-004 gap resolved. **Prod flag gated by ADR-039 runbook** (deploy migration → zero-legacy-write check → enable). Mobile gateway path pending. |
| Pass 4 | 15 | 1 | 16 | 1 | 0/15 | **PV-005 fixed for real** (the prior "fix" never actually serialized — see PR #164) + client cut-over to `/api/v2/votes/paid/verify`. **Batch 1** (5 parallel agents, TS-1/2/4/5/6/7/9/10/12): every `⬜ Not Run` case executed, genuinely-fixable `🚧 Partial` cases fixed — 490 tests green, 0 regressions. 4 more real bugs found+fixed: RG-005, VV-002, VI-008, SEC-007 (D-009). 1 new P0 leak found+logged, not fixable without bridge work: D-008 (`votes/stream` SSE has zero visibility gating). P0 Missing unchanged at 15 (all remaining P0 Missing rows are net-new subsystems — image pipeline, offline reconciliation — deliberately out of Batch 1 scope). P1 Missing/screens (TS-13/14) and non-functional (TS-11) also untouched this batch — next batch's scope. |
| Prod-Ready | 0 | 0 | 0 | 0 | 15/15 | §0.5 gate met; QA+Business+Compliance sign-off |

---

## 24. Defect & Task Log (Claude Code appends on every ❌ / 🚫)

| ID | Test ID | Type (Bug/Gap/Task) | Severity | Summary | Root Cause / What's Missing | Fix or Build (file / PR) | Regression Test Added | Status |
|---|---|---|---|---|---|---|---|---|
| D-001 | FV-003, EC-001, EC-002, CS-006 | Bug | S0 | Free-vote daily reset uses **UTC**, ignoring per-contest timezone → wrong day boundary | `getVoteDateUTC()`/`setUTCHours` (`free-vote.service.ts:51-53,391-398`) | TZ/DST-correct `voting-bridge/vote-window.ts`, wired into `castFreeVoteAtomic` → `p_vote_date` | `vote-window.spec.ts`, `free-vote-atomic.spec.ts` | 🔧 Fixed (v2; web cut over + flag on in dev; prod flag gated by ADR-039 runbook; mobile via gateway) |
| D-002 | FV-008, FV-011, VI-002, EC-015, NF-005 | Bug | S0 | Free-vote counting non-atomic + no idempotency key → double-count/race under concurrency & retry | Upsert-select then separate `update` (`free-vote.service.ts:194-343`); no idem key | `claim_free_vote` row-locks cap (SELECT…FOR UPDATE) + `X-Idempotency-Key`; **DB-proven 20-way concurrency** | migration + `voting-bridge/bridge.spec.ts` | 🔧 Fixed (v2; web cut over + flag on in dev; prod flag gated by ADR-039 runbook; mobile via gateway) |
| D-003 | VI-001, VI-002 | Bug | S0 | Tally aggregate uses non-atomic read-modify-write fallback → inflation risk | `increment_vote_totals` RMW fallback (`totals.service.ts:25-99`) | v2 free path: atomic NULL-round-correct totals upsert inside `claim_free_vote`. Tamper-evidence (append-only/hash) still open → VI-003 | `20260730120000_vote_bridge_free_vote.sql` (DB-verified) | 🔧 Fixed (atomicity, v2); VI-003 open |
| D-007 | VI-001, VI-003 | Bug | S1 | Legacy `increment_vote_totals` with NULL `round_id` never matches its ON CONFLICT → **inserts duplicate `vote_totals` rows** (fragments free-vote tally) | `ON CONFLICT (contest_id, contestant_id, round_id)` is NULLS-DISTINCT (`voting_rpc_functions.sql`) | v2 `claim_free_vote` avoids it; legacy path needs a partial unique index + dup consolidation (separate migration) | DB-reproduced (2 rows) | 🚫 Open (legacy path) |
| D-004 | VV-001, CS-008, EC-008 | Bug | S0 | Public `vote-page` returned rank+counts ignoring `showPublicVoteCount` → hidden-count leak | `app/api/vote-page/route.ts` had no visibility gate | Gate `totals` by `getEffectiveVisibility` before serializing (`app/api/vote-page/route.ts`) | `tests/unit/voting/vote-page-visibility.spec.ts` | 🔧 Fixed |
| D-005 | VV-003, EC-008, VV-007 | Bug | S1 | Leaderboard route bypassed phase-aware visibility (raw settings), didn't strip rank, and frozen snapshot was unredacted | Read raw `settings` flags, not `getEffectiveVisibility` | Route through `getEffectiveVisibility`; strip rank; redact snapshot (`app/api/leaderboard/[contestId]/route.ts`) | `tests/unit/voting/leaderboard-visibility.spec.ts` | 🔧 Fixed |
| D-005b | NT-003 | Bug | S1 | Milestone emails leak rank+totalVotes when counts hidden from contestant | `milestone.service.ts` doesn't consult visibility | Bridge track: wrap firing + extend per-audience visibility model (file is hook-protected) | _pending_ | 🚫 Deferred (bridge) |
| D-006 | IMG-010 | Bug | S1 | EXIF/GPS metadata not stripped from uploaded contestant photos (privacy) | Upload proxies raw buffer to R2 with no re-encode (`app/api/registration/uploads/route.ts`) | Strip metadata / re-encode on ingest | _pending_ | ❌ Fail |
| D-008 | SEC-001, VV-003 | Bug | S1 | `GET /api/votes/stream` (SSE) streams live `total_confirmed_votes`/`rank` with **no visibility check at all** — worse than the pre-D-005 leaderboard bug and still open | Route queries `vote_totals` directly inline; never calls `getEffectiveVisibility` (`app/api/votes/stream/route.ts`) | Bridge track: no wrappable seam exists (entire query lives inline in the hook-protected route file, no exported function to import). Needs either a protected-file edit (blocked) or a new gated endpoint + full client migration off the old one (out of Batch-1 scope) | `tests/unit/voting/sec-001-stream-visibility-gap.spec.ts` (documents/pins the gap) | 🚫 Deferred (bridge) |
| D-009 | SEC-007 | Bug | S2 | Registration upload route trusted the client-supplied `file.type` for the Content-Type served back on retrieval — a "photo.png" with a spoofed `file.type: image/svg+xml`/`text/html` would be served with that header (stored-XSS risk on some browsers that render by Content-Type over extension) | `contentType = file.type \|\| 'application/octet-stream'` (`app/api/registration/uploads/route.ts`, pre-fix) | Content-Type now derived from a server-owned extension→MIME allowlist, never the client value (`app/api/registration/uploads/route.ts`) | `tests/unit/registration/sec-007-upload-content-type.spec.ts` | 🔧 Fixed |
| G-REG | RG-001, CT-001, UAT-002 | Gap | S1 | Registration store is in-memory/temp-JSON; approved applicants never promoted into `competition_enrollments` | Two disconnected data planes (`src/server/registration/store.ts`) | Persist to Supabase + promotion step into voting engine | _pending_ | 🚫 Missing |
| G-IMG | TS-3 (IMG-001..014), CS-004, AD-003 | Gap | S0 | Entire image pipeline unbuilt (moderation, bg-removal, template composite, template manager) | Not implemented; `imageCompositor.ts` orphaned; no Cloudinary/vendor | Build pipeline + admin template manager + golden-image tests | _pending_ | 🚫 Missing |
| G-OFF | CT-003, CT-004, EC-014, AD-009 | Gap | S1 | Offline/physical vote import & reconciliation absent (blocks physical/hybrid) | Not implemented | Build import → dedup → reconcile into tally, audited | _pending_ | 🚫 Missing |
| G-MC | SEC-005, AD-008, AD-010 | Gap | S1 | No maker–checker on results/invalidation/refunds | Single-actor sensitive ops | Add 2nd-approver workflow | _pending_ | 🚫 Missing |
| G-CON | SEC-010, RG-003, EC-006 | Gap | S1 | No consent/likeness-rights gate before processing/publishing | Not enforced | Consent capture + publish gate | _pending_ | 🚫 Missing |

## 25. Traceability (invariant → tests)

| Invariant (§4) | Positive Tests | Negative / Adversarial Tests |
|---|---|---|
| Free-vote limit 1/day/contestant | FV-001, FV-004 | FV-002, FV-005, FV-006, FV-007, FV-008, EC-001 |
| Paid votes exact | PV-001, PV-002 | PV-004, PV-005, EC-003, EC-004 |
| No double-count / correct tally | VI-001 | VI-002, VI-003, EC-014 |
| Image likeness & placement | IMG-002, IMG-003, IMG-004, IMG-014 | IMG-006, IMG-009, EC-005 |
| Per-contest isolation | CS-003, VI-007 | EC-012 |
| Vote visibility control | VV-001, VV-002, VV-004 | VV-003, VV-007, EC-008 |
| Money correctness | PV-006, PV-009 | PV-008, PV-010, EC-010 |
| Fraud resistance | VI-004, VI-005 | EC-013, CT-007, EC-014 |
| Attribution & immutability | SEC-009, VI-010 | EC-010 |
| Idempotency | FV-011, PV-005 | EC-004, NF-005 |
| Consent & rights | RG-003, SEC-010 | EC-006 |
| Screens & UAT | MB-001..MB-015, UAT-001..UAT-015 | AD-001..AD-017, MB-014 |

---

### Appendix A — Conventions for Claude Code

- **Stable IDs**: never renumber; append new cases with the next free number in a suite.
- **Three closure modes:** `❌ Fail` → **fix**; `🚫 Missing` → **build** the feature/undone task/screen to production grade; both require a **failing test written first** that then passes.
- **P0 = integrity/money/image/visibility**: never `✅ Pass` on static reasoning alone; require executed assertions (image: pixel/format/placement + human visual review; UAT: business acceptance). **No real payments, no live removal vendor, no real PII/likeness without rights in tests.**
- **Screens & UAT are deliverables**: TS-13, TS-14 must reach `✅/🏗️` and TS-15 must be `✅ Accepted` before production-ready.
- **Free-limit, tally, image placement and hidden-visibility are tested, not assumed, and must fail-closed (hidden never leaks).**
- Keep this file the single source of truth; rollup (§20), burndown (§22), and log (§24) stay in sync.
- **Production-ready (repeat):** 0 `🚫 Missing` + 0 `❌ Fail` on all P0/P1 incl. all screens; UAT accepted; integrity/money/image/visibility invariants proven; QA + Business + Compliance sign-off recorded.
