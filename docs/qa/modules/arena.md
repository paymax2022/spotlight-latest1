# Module: Arena (Naija Driver competition engine)

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** yes (Support debit · Play-Along cashback credit · Pot disburse credit) &nbsp;·&nbsp; **Feature flag:** `FEATURE_ARENA_ENABLED`
**Code:** `backend/internal/arena/` — merit firewall core: `merit.go`, `scoring.go`, `rails.go`, `lifecycle.go`, `credential.go`; adapters `adapters/adapters.go` (theory-exam · practical-judge · first-aid); transport `handler/handler.go`; services `service/*.go` (`contestant.go`, `scoring.go`, `merit.go`, `support.go`, `pot.go`, `playalong.go`, `credential.go`, `decide.go`, `ports.go`); quiz bank `quiz/*.go`; repos `repo/*.go`; route wiring `internal/app/arena_routes.go` (flag guard `internal/app/router.go` ~L356). Tests: `arena_test.go`, `quiz/{scoring_test.go,view_test.go}`, `service/{service_test.go,lifecycle_test.go,firewall_integration_test.go,playalong_cashback_test.go}`, `backend/tests/arenaquiz/live_db_integration_test.go`.
**Slug:** `ARENA` (uppercase, used in Case IDs)

## 1. Overview & scope

Arena is the config-driven competition engine (ADR-014); "Naija Driver" is instance #1 — a multi-stage driver-safety contest with a quiz/exam lifecycle. It is mounted on three groups under `/api/arena`: **public** (catalogue, merit leaderboard, pot, credential verify — no auth), **member** (`RequireAuthContext` + `requireUserID`: apply, self views, support, play-along, exam, predictions), and **admin** (`/api/arena/admin/*` — member-auth + per-route RBAC `arena.*`). The whole engine is behind `FEATURE_ARENA_ENABLED`, enforced upstream in `router.go`: flag off ⇒ routes never registered.

The defining property under test is the **MERIT FIREWALL** (NDC-1/2/6): the crown is a pure function of signed merit, and merit can be minted *only* by an authorized `ScoringAdapter` holding a `*crypto.Signer` inside the `ScoringGateway`. The money/engagement rails (Support, Play-Along, Prediction, Pot) receive only the `LedgerPort` + repos — no signer — so no code path there can construct a valid merit write. `MeritService.Append` verifies each entry against the competition's authorized adapter public keys **before** insert (verify-before-append). Advancement (`→QUALIFIED/FINALIST/CROWNED`) reads the merit leaderboard **only**, never a money/engagement tally.

Three money paths exist, all integer kobo: **Support** debits a backer's wallet into the `arena_support_pot` standing account; **Play-Along cashback** credits a rate-limited reward on certification; **Pot disburse** credits the derived pot total to the crowned winner under NDC-4 multi-approval. Pot total is always a **projection** of tagged support rows, never a stored balance.

Cross-cutting invariants apply and are **not** repeated here: money (`../cross-cutting/money-invariants.md`), auth — Bearer→Supabase, suspended/locked/deleted→403 (`../cross-cutting/authentication.md`), RBAC — `RequirePermission`/`RequireScopedPermission` 403 fail-closed (`../cross-cutting/rbac-and-permissions.md`), KYC tier gate (`../cross-cutting/kyc-and-tiers.md`), flags/audit — flag-off→404 not 500 per `FLAG-SEC-001`, audit `AUDIT-INT-00x` (`../cross-cutting/feature-flags-and-audit.md`).

## 2. Services / endpoints in scope

| Operation | Method + path (or service func) | Auth / permission | Money-path? |
|---|---|---|---|
| List competitions | `GET /api/arena/competitions` | public | no |
| Get competition | `GET /api/arena/competitions/:id` | public | no |
| Merit leaderboard | `GET /api/arena/competitions/:id/leaderboard/merit?stage=` | public | no |
| Pot totals + tallies | `GET /api/arena/competitions/:id/pot` | public | no (derived) |
| Verify credential | `GET /api/arena/credentials/:hash/verify` | public | no |
| Apply (join) | `POST /api/arena/competitions/:id/applications` | member; KYC tier gate | no |
| My contestant row | `GET /api/arena/competitions/:id/me` | member (own, token id) | no |
| My merit | `GET /api/arena/competitions/:id/me/merit` | member (own) | no |
| Support (gift) | `POST /api/arena/competitions/:id/support` | member; `Idempotency-Key`; KYC gate | **yes** (debit) |
| Play-Along questions | `GET …/playalong/questions?stage={1..3}` | member | no |
| Play-Along attempt | `POST …/playalong/attempt` | member; `Idempotency-Key` | **yes** (cashback credit) |
| My exam stage | `GET …/me/exam` | member; state `THEORY_ASSIGNED` | no |
| Submit exam | `POST …/me/exam/submit` | member; `Idempotency-Key` | no (mints NO merit) |
| Prediction | `POST …/predictions` | member; `Idempotency-Key` | no |
| Create competition | `POST /api/arena/admin/competitions` | `arena.admin.config` | no |
| Publish config | `POST …/admin/competitions/:id/config/publish` | `arena.admin.config` | no |
| Screening queue | `GET …/screening` | scoped `arena.reviewer.screen` (contest:id) | no |
| Screening decide | `POST …/screening/:cid/decide` | `arena.reviewer.screen` | no |
| Proctor attest (merit write) | `POST …/proctor/attest` | scoped `arena.proctor.attest` | no ($ = merit) |
| Judge score (merit write) | `POST …/judge/score` | scoped `arena.judge.score` | no ($ = merit) |
| Transition | `POST …/transitions/:cid` | `arena.admin.transition` | no |
| Audit merit | `GET …/merit` | `arena.auditor.read` | no |
| Finalize award (crown) | `POST …/awards/finalize` | `arena.admin.transition` | triggers pot |
| Pot disburse | `POST …/pot/disburse` | `arena.admin.disburse`; `Idempotency-Key`; NDC-4 | **yes** (credit) |
| Issue credential | `POST …/credentials/issue` | `arena.admin.credential` | no |
| Revoke credential | `POST …/credentials/:cid/revoke` | `arena.admin.credential` | no |
| Import / list / stats questions | `POST/GET …/questions[/import|/stats]` | `arena.admin.questions` | no |

Behavioral notes to assert:
- Identity always comes from the resolved token (`c.GetString("user_id")`), never the body. `Apply`, `Me`, `MyMerit`, `Support`, `PlayAlongAttempt`, `SubmitExam`, `Prediction` all key on `ctxUserID(c)`.
- Handlers requiring idempotency (`Support`, `PlayAlongAttempt`, `SubmitExam`, `Prediction`, `PotDisburse`) return **400** `IDEMPOTENCY_KEY_REQUIRED` when the `Idempotency-Key` header is empty — checked *before* body binding.
- `mapErr` mapping: `ErrForbidden`→403, `ErrNotFound`→404, `ErrConflict`/`ErrReplay`→409, `ErrKYCTierTooLow`→422 `KYC_TIER_TOO_LOW`, `ErrUnauthorizedSig`→403 `MERIT_SIG_UNAUTHORIZED`, `ErrBadState`→409 `BAD_STATE`, `ErrPotState`→409 `POT_STATE`, `ErrInvalidInput`→400, default→500.
- Play-Along and Theory exam share ONE question bank; the contestant-safe `QuestionView`/`StageView` strips `correctIndex`/`correctAnswer`/`explanation`. The server scores (`mark`) — clients never send a self-reported score.
- `ProctorAttest` sources the raw score from the stored `arena_quiz_attempt` (score/total) for the attested (contestant, theory stage) when `raw["score"]` is omitted; missing attempt ⇒ `ErrNotFound` (404).

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Lifecycle guard legality (`CanTransition`, terminal, self-loop) | unit/fsm | `internal/arena/arena_test.go` (`TestLifecycle_Guards`) | AUTOMATED |
| Advancement reads merit only | unit | `internal/arena/arena_test.go` (`TestAdvancement_ReadsMeritOnly`) | AUTOMATED |
| Sign→verify merit entry; tamper rejected | inv | `internal/arena/arena_test.go` (`TestMeritFirewall_SignAndVerify`) | AUTOMATED |
| Merit hash-chain links per contestant | inv | `internal/arena/arena_test.go` (`TestMeritChain_LinksEntries`) | AUTOMATED |
| Rail→target policy (only MERIT→merit ledger) | inv | `internal/arena/arena_test.go` (`TestRailFirewall_Policy`) | AUTOMATED |
| Verify-before-append rejects unauthorized signer | inv | `internal/arena/service/service_test.go` (`TestFirewall_VerifyBeforeAppend`) | AUTOMATED |
| Merit replay → `ErrReplay` | inv | `service/service_test.go` (`TestFirewall_Replay`) | AUTOMATED |
| Money rails hold no signer (compile firewall) | inv | `service/service_test.go` (`TestFirewall_MoneyRailsHaveNoSigner`) | AUTOMATED |
| End-to-end: Support moves pot, not merit | inv/int | `service/firewall_integration_test.go` (`TestFirewall_EndToEnd_SupportMovesPotNotMerit`) | AUTOMATED |
| Support idempotent; KYC gate fail-closed | inv | `service/service_test.go` (`TestSupport_Idempotent`, `TestSupport_KYCGate`) | AUTOMATED |
| Pot total derived from support rows (kobo) | inv | `service/service_test.go` (`TestPotTotal_DerivedFromSupportRows`) | AUTOMATED |
| Play-Along cashback daily cap exact | inv | `service/playalong_cashback_test.go` (`TestPlayAlong_CashbackDailyCapIsExact`) | AUTOMATED |
| Credential verify-by-hash | unit | `service/service_test.go` (`TestCredential_VerifyByHash`) | AUTOMATED |
| Service refuses illegal lifecycle jump | fsm | `service/lifecycle_test.go` (`TestLifecycle_GuardRejectsIllegalJump`) | AUTOMATED |
| Quiz `mark` scoring (full/zero/unanswered/unknown-opt) | unit | `quiz/scoring_test.go` (`TestMark_*`) | AUTOMATED |
| Pass-mark boundary per stage | unit | `quiz/scoring_test.go` (`TestPasses_*`, `TestScorePath_PartialAtStagePassMarks`) | AUTOMATED |
| Contestant-safe view strips answer fields | unit/sec | `quiz/view_test.go` (`TestContestantView_StripsAnswerFields`, `TestQuestionView_HasNoOptionCorrectness`, `TestStageView_Shape`) | AUTOMATED |
| Batch↔stage mapping | unit | `quiz/view_test.go` (`TestBatchToStage_And_StageToTheoryStage`) | AUTOMATED |
| Attempt insert idempotent + append-only (live DB) | int | `backend/tests/arenaquiz/live_db_integration_test.go` (`TestLiveDB_InsertAttempt_Idempotent`, `TestLiveDB_Attempt_Immutable`) | AUTOMATED (gated on `TEST_DATABASE_URL`) |
| Handler status codes / idem-header 400 / mapErr | con/int | — | TODO (§7) |
| Endpoint authz (member 401/403, admin RBAC, scoped, IDOR) | authz | — | TODO (§7) |
| SubmitExam full state-transition path (svc+contestant graph) | int/fsm | — | TODO (deliberately out of live-DB scope, see test header L29-36) |
| Pot disburse NDC-4 approvals + idempotent credit (DB) | inv | — | TODO (§7) |
| Flag-off route not mounted | sec | — | TODO (§7) |
| Audit event emission | int | `../cross-cutting/feature-flags-and-audit.md` `AUDIT-INT-001` (shared) | PARTIAL |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `ARENA-INT-001` | Apply happy path (KYC pass) | P0 | flag on; config `required_kyc_tier=1`; `qa-user-a` tier ≥ 1; no prior entry | `POST …/:id/applications` | `{home_state:"LAG"}` | 201; contestant `state=APPLIED`, `kyc_tier` echoed; audit `CONTESTANT_APPLY` |
| `ARENA-INT-002` | Play-Along stage view is contestant-safe | P0 | bank imported, stage 1 has questions | `GET …/playalong/questions?stage=1` | — | 200 `StageView`; each question has `options[].id/label` but **no** `correctIndex`/`correctAnswer`/`explanation` |
| `ARENA-INT-003` | Play-Along attempt scored server-side | P0 | as above; header `Idempotency-Key:pa-1` | `POST …/playalong/attempt` | `{stage:1, answers:[{questionId,optionId}…]}` | 200 `{score,total,passed,perQuestion[…reveal]}`; `score` = server `mark`, not client-sent |
| `ARENA-INT-004` | Submit exam advances lifecycle | P0 | contestant `THEORY_ASSIGNED`, `theory_batch=B1`; `Idempotency-Key:ex-1` | `POST …/me/exam/submit` | `{answers:[…], responseTimeMs:9000}` | 200 `{ok:true, state:"THEORY_TAKEN"}`; attempt recorded; **no** merit minted |
| `ARENA-INT-005` | Support contributes into pot (kobo) | P0 | `qa-user-a` wallet `500000`, tier ≥ required; `Idempotency-Key:sp-1` | `POST …/:id/support` | `{contestant_id:"k1", amount_kobo:20000}` | 200 `{ok:true}`; wallet debited exactly `20000`; `arena_support_pot` credited `20000`; support row tagged; audit `SUPPORT_CONTRIBUTE` |
| `ARENA-INT-006` | Proctor attest mints signed merit from stored attempt | P0 | exam attempt on file for (k1, B1); proctor holds `arena.proctor.attest` (contest:id) | `POST …/proctor/attest` | `{contestant_id:"k1", stage:"THEORY_B1", attestation:{proctor_id,webcam_ok}}` (no `raw.score`) | 200 `{entry_hash, normalized_score}`; score sourced from stored attempt; one `MERIT_APPEND` audit |
| `ARENA-INT-007` | Pot disburse to winner after approvals | P0 | pot total `>0`; `pot_approvals_required=2`; 2 distinct approvers; `Idempotency-Key:pd-1` | `POST …/pot/disburse` `{approve:true}` first by 2nd admin, then disburse | `{winner_user_id:"u9", approve:true}` | 200; winner credited exact derived pot total (kobo); pot→`DISBURSED`; audit `POT_DISBURSE` |
| `ARENA-INT-008` | Verify credential (public) | P1 | credential issued, `ACTIVE` | `GET /api/arena/credentials/:hash/verify` | valid hash | 200 `{valid:true, credential:{…}}`; revoked hash ⇒ `valid:false` |
| `ARENA-UNIT-001` | Pass-mark exact boundary passes | P1 | — | `passes(score,total,passMark)` at `score*100 == passMark*total` | stage-1 mark | Passes (≥, not >) — see `quiz/scoring_test.go` `TestPasses_Stage1ExactBoundary` |
| `ARENA-UNIT-002` | Zero-total fails closed | P1 | — | `passes(0,0,pm)` | empty stage | false (no divide-by-zero); `StageView` with 0 questions ⇒ `ErrNotFound` (404) |
| `ARENA-UNIT-003` | Normalize with max≤0 → 0 | P1 | — | `NormalizePercent(raw, 0)` and `(raw,-5)` | — | 0, clamped, no panic (fail-closed) |
| `ARENA-UNIT-004` | Practical trimmed-mean neutralizes outlier | P2 | — | `NormalizePractical` with 5 judge scores incl. one extreme | judges `[80,82,81,83,10]` | trimmed mean drops min+max; one biased judge cannot swing the score |
| `ARENA-CON-001` | Play-Along stage out of range | P1 | flag on | `GET …/playalong/questions?stage=0` and `?stage=4` | — | 400 `ErrInvalidInput`; same for `attempt` body `stage` <1 or >3 |
| `ARENA-CON-002` | Play-Along attempt missing Idempotency-Key | P0 | flag on | `POST …/playalong/attempt` no header | valid body | 400 `IDEMPOTENCY_KEY_REQUIRED`; nothing recorded (see MONEY-INV I10) |
| `ARENA-CON-003` | Support missing Idempotency-Key | P0 | flag on | `POST …/support` no header | valid body | 400 `IDEMPOTENCY_KEY_REQUIRED`; no debit |
| `ARENA-CON-004` | Support non-positive amount rejected | P0 | flag on, header set | `POST …/support` `amount_kobo:0` then `-100` | `0`, `-100` | 400 (`binding:"required"` rejects 0; `amountKobo<=0`→`ErrInvalidInput`); nothing posted (MONEY-INV I4) |
| `ARENA-CON-005` | Support missing `contestant_id` | P1 | flag on, header set | `POST …/support` without `contestant_id` | `{amount_kobo:20000}` | 400 `ErrInvalidInput`; nothing posted |
| `ARENA-CON-006` | Submit exam missing Idempotency-Key | P0 | flag on | `POST …/me/exam/submit` no header | valid | 400 `IDEMPOTENCY_KEY_REQUIRED` |
| `ARENA-CON-007` | Unanswered / unknown option scores 0 | P1 | stage loaded | attempt with a skipped question and an `optionId:"9"` | mixed | those questions score 0; persisted `option_index=-1` for unanswered (audit distinguishes skip vs option 0) — `quiz/scoring_test.go` `TestMark_Unanswered/UnknownOption` |
| `ARENA-CON-008` | Proctor attest with no stored attempt | P1 | no exam attempt for (k1,B1); `raw.score` omitted | `POST …/proctor/attest` `{contestant_id:"k1",stage:"THEORY_B1"}` | — | 404 `ErrNotFound`; no merit minted |
| `ARENA-INV-001` | Unauthorized signer rejected (verify-before-append) | P0 | entry signed by a key not in competition's authorized adapters | `MeritService.Append` | forged entry | `ErrUnauthorizedSig`→403 `MERIT_SIG_UNAUTHORIZED`; `MERIT_REJECT_UNAUTHORIZED` audit; nothing inserted (`TestFirewall_VerifyBeforeAppend`) |
| `ARENA-INV-002` | Merit replay rejected | P0 | entry already appended | re-`Append` same entry | duplicate | `ErrReplay`→409; entry count unchanged (`TestFirewall_Replay`) |
| `ARENA-INV-003` | Support replay = single debit | P0 | wallet `500000`; same `Idempotency-Key:sp-r1` twice | `POST …/support` ×2 identical | `amount_kobo:20000` | wallet moved once (`480000`); one support row; pot credited once (MONEY-INV-006; `TestSupport_Idempotent`) |
| `ARENA-INV-004` | Play-Along cashback daily cap is exact | P0 | `cashback_kobo>0`, `cashback_per_day=N` | pass N+1 times (distinct keys) same day | crossing threshold each time | exactly N cashbacks credited; the (N+1)th grants none (strict `<` cap; `TestPlayAlong_CashbackDailyCapIsExact`) |
| `ARENA-INV-005` | Pot total is a projection (kobo) | P0 | support rows summing to T kobo | `GET …/pot` and disburse | integer kobo | `pot_total_kobo == T`; disburse credits exactly T; no stored mutable balance (`TestPotTotal_DerivedFromSupportRows`) |
| `ARENA-INV-006` | Pot disburse idempotent by key | P0 | approvals met; same `Idempotency-Key:pd-r1` twice | `POST …/pot/disburse` ×2 | same winner | winner credited once; 2nd is a no-op/`POT_STATE`; state stays `DISBURSED` (MONEY-INV-006) |
| `ARENA-AUTHZ-001` | Unauthenticated member route | P0 | no token | `POST …/:id/applications` | valid | 401 `authentication required`; nothing created |
| `ARENA-AUTHZ-002` | Suspended account blocked | P0 | `qa-suspended`, valid token | `POST …/support` | valid | 403 `account restricted` (AUTH-SEC-001); no debit |
| `ARENA-AUTHZ-003` | Admin route without permission fail-closed | P0 | `qa-user-a` no `arena.*` role | `POST /api/arena/admin/competitions` | valid | 403 (RequirePermission fail-closed); nothing created |
| `ARENA-AUTHZ-004` | Scoped permission for a different competition denied | P0 | actor has `arena.proctor.attest` scoped to competition `X` | `POST …/competitions/Y/proctor/attest` | for comp `Y` | 403 (RequireScopedPermission on `contest:id`); a `global` arena role would satisfy it |
| `ARENA-AUTHZ-005` | IDOR — self views bound to token identity | P0 | `qa-user-a` and `qa-user-b` both entered | `qa-user-a` calls `GET …/me`, `…/me/merit`, `…/me/exam` | token = a | Only `qa-user-a`'s contestant row/merit/exam returned; cannot address `qa-user-b` (lookup keyed on `ctxUserID`), no `contestant_id` accepted from body |
| `ARENA-SEC-001` | Flag off → routes not mounted | P0 | `FEATURE_ARENA_ENABLED=false` | any `/api/arena/*` request | valid | 404 (RegisterArena skipped in router.go); never 500 (FLAG-SEC-001) |
| `ARENA-SEC-002` | Apply KYC gate fail-closed | P0 | config `required_kyc_tier=2`; `qa-user-a` tier 1, and a tier-lookup-error case | `POST …/applications` | below tier / lookup error | 422 `KYC_TIER_TOO_LOW` in both cases (tier lookup error ⇒ `ErrKYCTierTooLow`, fail-closed); no contestant created (see `kyc-and-tiers.md`) |
| `ARENA-SEC-003` | Pot disburse blocked below required approvals (NDC-4) | P0 | `pot_approvals_required=2`, only 1 approval | `POST …/pot/disburse` | valid winner | 403 `ErrForbidden`; no credit; empty pot ⇒ `POT_STATE` (409) |
| `ARENA-SEC-004` | Crown/advancement reads merit only | P0 | contestant leads *support* tally but is NOT merit leader | `POST …/awards/finalize` (→CROWNED) | that contestant | 403 `ErrForbidden` (`MeritLeader(rows)` mismatch); Support can never crown (`AwardFedByMeritOnly` true only for `NAIJA_DRIVER_CROWN`) |
| `ARENA-SEC-005` | Answer key never leaks to contestants | P0 | bank imported | `GET …/playalong/questions`, `GET …/me/exam` | — | Response envelope carries no `correctIndex`/`correctAnswer`/`explanation`; only the admin `GET …/questions` (perm `arena.admin.questions`) exposes them |
| `ARENA-SEC-006` | Audit event emitted on money mutation | P1 | flag on | Support / Pot disburse / merit append | valid | Exactly one audit row per action (`SUPPORT_CONTRIBUTE` / `POT_DISBURSE` / `MERIT_APPEND`) with actor + kobo/entry_hash (AUDIT-INT-001) |

## 5. State-machine transitions

Contestant lifecycle (`lifecycle.go`, ADR-014 §8/NDC-5). `CanTransition(from,to)` is the guard; `from==to` is always illegal (no self-loop). Advancement transitions (`→QUALIFIED/FINALIST/CROWNED`) are legality-checked here **and** merit-gated in `ContestantService.assertMeritAdvancement` (leaderboard only). `WITHDRAWN` is reachable from any non-terminal state (admin path). Terminal states `{CROWNED, ELIMINATED, REJECTED, WITHDRAWN}` are absorbing.

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| APPLIED | screening approve | SCREENED | audit `SCREENING_APPROVE` | `ARENA-FSM-001` |
| APPLIED | screening reject | REJECTED | audit `SCREENING_REJECT` (terminal) | `ARENA-FSM-002` |
| SCREENED | assign training | TRAINED | audit | `ARENA-FSM-003` |
| TRAINED | assign theory | THEORY_ASSIGNED | batch set (B1/B2/B3) | `ARENA-FSM-004` |
| THEORY_ASSIGNED | submit exam | THEORY_TAKEN | attempt recorded; **no merit** (NDC-2) | `ARENA-FSM-005` |
| THEORY_TAKEN | merit cut (top-N) | QUALIFIED | `assertMeritAdvancement` (merit only) | `ARENA-FSM-006` |
| QUALIFIED | merit cut (finalist-N) | FINALIST | merit only | `ARENA-FSM-007` |
| FINALIST | merit leader | CROWNED | atomic: finalize signed award + issue `NAIJA_DRIVER` credential + pot trigger | `ARENA-FSM-008` |
| any non-terminal | admin withdraw | WITHDRAWN | audit (terminal) | `ARENA-FSM-009` |

Illegal transitions to assert (all `ErrBadState`→409 `BAD_STATE`, nothing mutated):
- `ARENA-FSM-010` — APPLIED → CROWNED (skip-ahead jump; `TestLifecycle_GuardRejectsIllegalJump`).
- `ARENA-FSM-011` — THEORY_ASSIGNED → QUALIFIED (skips THEORY_TAKEN).
- `ARENA-FSM-012` — SCREENED → SCREENED (self-loop rejected).
- `ARENA-FSM-013` — merit-legal shape but not merit leader: FINALIST → CROWNED when `MeritLeader≠contestant` ⇒ `ErrForbidden` (403), not `ErrBadState` (guard passes, merit gate fails).

Terminal-state idempotency:
- `ARENA-FSM-014` — CROWNED → any (incl. CROWNED): rejected `ErrBadState`; a re-`FinalizeAward` on an already-crowned contestant does not double-issue the credential/pot trigger (side-effects run once inside the state-change tx; a second attempt fails the guard before the tx).
- `ARENA-FSM-015` — SubmitExam replay after THEORY_TAKEN: returns `{ok:true, state:"THEORY_TAKEN"}` as a no-op (single attempt per contestant/batch), never a second attempt row or transition.

## 6. Security & abuse cases

- **Merit firewall / signer isolation** — only `ScoringGateway` adapters hold a `*crypto.Signer`; money/engagement rails receive none (`TestFirewall_MoneyRailsHaveNoSigner`). Unauthorized or tampered entries are rejected verify-before-append (`ARENA-INV-001`). Forged/replayed entries unreachable (`ARENA-INV-002`).
- **Advancement/crown cannot be bought** — support money and play-along points never feed the crown; advancement reads merit leaderboard only (`ARENA-SEC-004`, `ARENA-FSM-013`).
- **Answer-key exposure / IDOR on quiz** — contestant-safe views strip correctness; only `arena.admin.questions` sees the key (`ARENA-SEC-005`). Self views keyed on token id (`ARENA-AUTHZ-005`).
- **Missing / weak Idempotency-Key** — money + engagement mutations require the header, checked before binding (`ARENA-CON-002/003/006`). Note openapi's ≥8-char rule (`money-invariants.md` I10) is a header presence check only here — flag the gap (§7).
- **Replay / double-spend** — Support (`ARENA-INV-003`), cashback cap (`ARENA-INV-004`), pot disburse (`ARENA-INV-006`); attempt insert idempotent + append-only immutable (live-DB `TestLiveDB_*`).
- **NDC-4 multi-approve on payout** — pot disburse requires N distinct approvers, fails closed below threshold and on empty pot (`ARENA-SEC-003`).
- **KYC gate fail-closed** — Apply and Support fail closed on tier-lookup error (`ARENA-SEC-002`; see `kyc-and-tiers.md`).
- **RBAC fail-closed + scoping** — admin routes 403 without permission; scoped routes bind to `contest:id` (`ARENA-AUTHZ-003/004`; see `rbac-and-permissions.md`).
- **Amount / score tampering** — server scores the quiz (`mark`); clients cannot self-report a score. Support debits only server-validated `amount_kobo`. Merit normalized_score is deterministic in the signed adapter.
- **Fail-closed on flag off** — `ARENA-SEC-001` (FLAG-SEC-001).
- **Config risk to flag** — `config/validate.go` warns `FEATURE_ARENA_ENABLED=true` with no `ARENA_SIGNING_SEED_*` (merit cannot be signed) and no dedicated `ARENA_AWARD_SIGNING_SEED` (crown falls back to the practical merit key — weakens NDC-1 defense-in-depth). Verify startup validation surfaces both.

## 7. Automated specs to add

- `internal/arena/handler/handler_test.go` — httptest table over a faked `Services`: idem-header-missing 400 on Support/PlayAlongAttempt/SubmitExam/Prediction/PotDisburse; `mapErr` status matrix (403/404/409/422/400); play-along `stage` range 400; spoofed body ignored (identity from `user_id` context). Table-driven Go.
- `internal/arena/handler/authz_test.go` — member routes 401 unauth / 403 suspended; admin `RequirePermission`/`RequireScopedPermission` 403 fail-closed and cross-competition scope denial; IDOR: `Me`/`MyExam` bound to token id.
- `backend/tests/arena/pot_disburse_test.go` — DB-backed NDC-4: below-threshold 403, exactly-N approvals then single idempotent credit of derived pot total; concurrent same-key ⇒ one disburse. Mirrors `ledger_invariants_test.go` (gated on `TEST_DATABASE_URL`).
- `backend/tests/arena/submit_exam_fsm_test.go` — the full `SubmitExam` graph (quiz.Service + PlayAlongService + ContestantService): THEORY_ASSIGNED→THEORY_TAKEN happy path, replay no-op, and not-assigned ⇒ 409 (the follow-up noted in the live-DB test header L29-36).
- `backend/tests/arena/support_idempotency_test.go` — DB-backed Support replay + N-concurrent-same-key: one debit, one support row, pot credited once.
- `internal/arena/service/idemkey_length_test.go` — assert (after adding) `Idempotency-Key` ≥ 8 chars on money mutations, aligning with openapi I10.
- `internal/arena/handler/flag_off_test.go` — with `FEATURE_ARENA_ENABLED=false`, assert `/api/arena/*` returns 404, never 500 (FLAG-SEC-001).

## 8. Coverage target & exit criteria

Tier-2 module, but it owns money paths and the merit firewall — treat the firewall + money-path logic as Tier-0-equivalent: ≥ 85% on `merit.go`, `scoring.go`, `rails.go`, `lifecycle.go`, and the Support/Pot/PlayAlong service money math; ≥ 70% on handlers. **Exit criteria (all must be green before release):** `ARENA-INT-001`, `ARENA-INT-005`, `ARENA-INT-006`, `ARENA-INT-007`, `ARENA-INV-001`, `ARENA-INV-002`, `ARENA-INV-003`, `ARENA-INV-005`, `ARENA-INV-006`, `ARENA-AUTHZ-001`, `ARENA-AUTHZ-003`, `ARENA-AUTHZ-005`, `ARENA-SEC-001`, `ARENA-SEC-002`, `ARENA-SEC-003`, `ARENA-SEC-004`, `ARENA-FSM-010`, `ARENA-FSM-013`, `ARENA-FSM-015`. Any red among these — especially a merit-firewall or money-path case — is a **do-not-ship** blocker.
