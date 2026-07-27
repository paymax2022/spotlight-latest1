# Module: Association (Group Membership)

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FeatureAssociationsEnabled` (env `FEATURE_ASSOCIATIONS_ENABLED`, default `false` — `internal/config/config.go` L144, L555)
**Code:** `backend/internal/association/` — `routes.go`, `handler.go`, `handler_actions.go`, `handler_detail.go`, `handler_ext.go`, `model.go`, `model_detail.go`, `model_ext.go`, `service.go`, `service_actions.go`, `service_detail.go`, `service_ext.go`, `model_test.go`. Mount: `internal/app/finance_routes.go` L848-863.
**Slug:** `ASSOCIATION` (uppercase, used in Case IDs)

## 1. Overview & scope

The Association module turns Spotlight into a membership-body platform for Nigerian associations (national / state / local chapter hierarchy): member onboarding + approvals, a dues money-path, meetings, tasks, documents, committees, events, chat, support tickets, per-member settings, AI-generated meeting minutes ("AI notes"), and an admin console (KPIs, audit log, approvals, finance, offline-payment reconciliation, member lifecycle, CSV bulk import). It is mounted at `/api/finance/associations` behind the `FeatureAssociationsEnabled` flag and the finance group's auth guard; `user_id` is taken from the auth context (`c.GetString("user_id")`), never from the body. ~83 endpoints across `routes.go`.

Authorization is **per-association scoped and role-based** — not global RBAC middleware. Every admin/finance mutation calls one of two in-service gates against `assoc_member_roles` joined to the caller's `assoc_memberships` row: `requireAssocAdmin` (any non-`NONE` role in the caller's association, admits `SECRETARY`) or `requireCap(check)` over `AdminCapabilities{ApproveMembers, ManageMembers, ManageFinance, ImportMembers}` derived by `capabilitiesFor(role)` (`service.go` L579-629). Object-level ownership is enforced in the money-path: `PayInvoice` and `GetReceipt` reject when `ownerID != userID` with `ErrForbidden` (`service.go` L150-152, L244-246).

**Known authorization gap (now closed, regression-guarded):** the AI-note approve/publish path (`SetAiNoteStatus`) historically performed **no** authorization check, so any authenticated member could approve/publish meeting minutes. It now calls `requireAssocAdmin` as its first statement. This is locked by `TestAiNoteStatus_NoAuthorizationGate_DocumentsKnownGap` — see §4 `ASSOCIATION-AUTHZ-004` (P0) and §6.

Cross-cutting invariants apply and are **not** re-derived here — reference: [`../cross-cutting/money-invariants.md`](../cross-cutting/money-invariants.md), [`authentication.md`](../cross-cutting/authentication.md), [`rbac-and-permissions.md`](../cross-cutting/rbac-and-permissions.md) (RBAC-AUTHZ-005/006/007), [`kyc-and-tiers.md`](../cross-cutting/kyc-and-tiers.md), [`feature-flags-and-audit.md`](../cross-cutting/feature-flags-and-audit.md).

## 2. Services / endpoints in scope

~83 endpoints. Read-only and self-service groups are summarized; **every money-path and privileged mutation is listed explicitly**.

### Money-path + privileged operations (listed explicitly)

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Pay dues invoice | `POST /dues/:invoiceId/pay` | auth + owner (`ownerID==userID`) + `Idempotency-Key` required | **yes** — ledger `Debit`, revenue split, commission row |
| Get receipt | `GET /receipts/:receiptId` | auth + owner (`ownerID==userID`) | no (reads settled money) |
| Decide membership application | `POST /admin/approvals/:id/decision` | `requireCap(ApproveMembers)` + `Idempotency-Key` (all decisions) | no (flips membership status) |
| Admin finance summary | `GET /admin/finance` | `requireCap(ManageFinance)` | no (reads money) |
| List offline payments | `GET /admin/finance/offline` | `requireCap(ManageFinance)` | no |
| Decide offline payment | `POST /admin/finance/offline/:id/decision` | `requireCap(ManageFinance)` + `Idempotency-Key` on **approve** only | **yes** on approve — `PostJournal` DR provider_clearing / CR settlement |
| Suspend member | `POST /admin/members/:id/suspend` | `requireCap(ManageMembers)` | no |
| Restore member | `POST /admin/members/:id/restore` | `requireCap(ManageMembers)` | no |
| Transfer member | `POST /admin/members/:id/transfer` | `requireCap(ManageMembers)` | no |
| Assign role | `POST /admin/members/:id/role` | `requireCap(ManageMembers && ManageFinance)` — no self-escalation | no |
| Import preview | `POST /admin/import/preview` | `requireCap(ImportMembers)` | no |
| Confirm import | `POST /admin/import/confirm` | `requireCap(ImportMembers)` | no |
| Bulk import CSV | `POST /admin/import/members?org_id=` | `requireCap(ImportMembers)` | no |
| Approve AI note (minutes) | `POST /ai-notes/:id/approve` | `requireAssocAdmin` (admits SECRETARY) — **see gap §6** | no |
| Publish AI note (minutes) | `POST /ai-notes/:id/publish` | `requireAssocAdmin` (admits SECRETARY) — **see gap §6** | no |
| Convert action item → task | `POST /ai-notes/:id/action-items/:itemId/convert` | auth (scoped) | no |
| Publish organisation | `POST ` (root) | auth; requires accepted terms | no |
| Submit application | `POST /apply` | auth | no |

### Summarized groups (privileged status noted)

| Group | Endpoints | Method + path (representative) | Auth / permission |
|---|---|---|---|
| Discovery | 2 | `GET ` (list), `GET /orgs/:id` | auth |
| Member self (dashboard/card/profile/privacy/activity/admin-access/dues) | 9 | `GET|PUT /me/*`, `GET /me/dues` | auth, self only (`user_id`) |
| Directory | 2 | `GET /members`, `GET /members/:id` | auth, scoped to caller's org |
| Engagement | 5 | `GET /announcements`, `POST /announcements/:id/acknowledge`, `GET /notifications`, `POST /notifications/read` | auth, scoped |
| Meetings | 4 | `GET /meetings[/:id]`, `POST /meetings/:id/rsvp`, `POST /meetings/:id/attendance` | auth, scoped |
| Tasks | 3 | `GET /tasks[/:id]`, `PATCH /tasks/:id` | auth, scoped |
| Documents | 3 | `GET /documents[/:id]`, `POST /documents/:id/acknowledge` | auth, scoped |
| Committees | 3 | `GET /committees[/:id]`, `POST /committees/:id/join` | auth, scoped |
| Events | 5 | `GET /events[/:id]`, `POST /events/:id/{rsvp,register,feedback}` | auth, scoped |
| Admin reads | 4 | `GET /admin/{kpis,audit-log,approvals,approvals/:id}` | `requireAssocAdmin` / `requireCap` |
| Settings | 8 | `GET|PUT /me/{notification-prefs,security,preferences}`, `GET /me/devices`, `DELETE /me/devices/:id` | auth, self only |
| Support | 5 | `GET /support/faqs`, `GET|POST /support/tickets[/:id]`, `POST /support/tickets/:id/messages` | auth, scoped |
| Chat | 5 | `GET /chat/threads[/:id]`, `POST /chat/threads/:id/{messages,messages/:messageId/react,mute}` | auth, thread membership scoped |
| AI notes (read) | 4 | `GET /ai-notes[/:id]`, `GET /ai-notes/:id/status`, `POST /ai-notes`, `POST /ai-notes/:id/regenerate-summary` | auth, scoped |
| Join / validation | 2 | `POST /invites/validate`, `POST /access-codes/validate` | auth |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| RevenueSplit sums exactly, no leaked kobo | INV | `tests/association/money_invariants_test.go` `TestRevenueSplit_SumsExactlyToTotal`; `internal/association/model_test.go` `TestRevenueSplitSumsExactly` | AUTOMATED |
| RevenueSplit proportions 50/30/15/5 + National absorbs remainder | INV | `model_test.go` `TestRevenueSplitProportions`; `money_invariants_test.go` `TestRevenueSplit_NationalAbsorbsRemainder` | AUTOMATED |
| RevenueSplit no negative legs | INV | `money_invariants_test.go` `TestRevenueSplit_NoNegativeLegs` | AUTOMATED |
| RevenueSplit labels stable & distinct | UNIT | `money_invariants_test.go` `TestRevenueSplit_LabelsAreStableAndDistinct` | AUTOMATED |
| PayInvoice fail-closed w/o Idempotency-Key | INV | `model_test.go` `TestPayInvoiceRequiresIdempotencyKey`; live `TestLiveDB_PayInvoice_RequiresIdempotencyKey` | AUTOMATED |
| PayInvoice receipt-id round-trip & ledger ref format | UNIT | `money_invariants_test.go` `TestPayInvoice_ReceiptIDDerivation`, `TestPayInvoice_LedgerReference` | AUTOMATED |
| PayInvoice idempotent retry → one posting/receipt | INV | `money_invariants_test.go` `TestPayInvoice_IdempotentRetry_OnePostingOneReceipt`, `TestPayInvoice_DifferentIdempotencyKeySameInvoice_StillOnlyOnePayment`; live `TestLiveDB_PayInvoice_IdempotentSamePostingSameReceipt` | AUTOMATED |
| PayInvoice posts balanced double-entry | INT | `tests/association/live_db_integration_test.go` `TestLiveDB_PayInvoice_PostsBalancedDoubleEntry` (gated on `DATABASE_URL`) | AUTOMATED (gated) |
| PayInvoice forbids paying another member's invoice (IDOR) | AUTHZ | `live_db_integration_test.go` `TestLiveDB_PayInvoice_ForbidsPayingSomeoneElsesInvoice` | AUTOMATED (gated) |
| DecideOfflinePayment approve needs key; reject does not | INV | `money_invariants_test.go` `TestDecideOfflinePayment_ApproveRequiresIdempotencyKey`, `TestDecideOfflinePayment_RejectDoesNotRequireIdempotencyKey` | AUTOMATED |
| DecideOfflinePayment approve idempotent single posting; reject no ledger | INV/INT | `money_invariants_test.go` `TestDecideOfflinePayment_ApproveIdempotentSinglePosting`, `TestDecideOfflinePayment_RejectNeverPostsLedger`; live `TestLiveDB_DecideOfflinePayment_ApprovePostsBalancedJournal`, `TestLiveDB_DecideOfflinePayment_RejectNoLedgerMovement` | AUTOMATED |
| DecideOfflinePayment capability gate (ManageFinance) | AUTHZ | `money_invariants_test.go` `TestDecideOfflinePayment_CapabilityGate_OnlyManageFinance`; live `TestLiveDB_DecideOfflinePayment_NonFinanceAdminForbidden` | AUTOMATED |
| AssignRole requires ManageMembers && ManageFinance (no self-escalation) | AUTHZ | `money_invariants_test.go` `TestAssignRole_RequiresBothManageMembersAndManageFinance`; live `TestLiveDB_AssignRole_PersistsRoleAndAudit_ChapterAdminForbidden` | AUTOMATED |
| DecideApplication transitions + key required + activates membership only on APPROVE | FSM | `money_invariants_test.go` `TestDecideApplication_AllowedTransitions`, `TestDecideApplication_RequiresIdempotencyKey`, `TestDecideApplication_ApproveActivatesMembership`; live `TestLiveDB_DecideApplication_ApprovePersistsAndActivatesMembership`, `TestLiveDB_DecideApplication_RejectDoesNotActivateMembership` | AUTOMATED |
| Member status allowed values + suspend/restore/transfer require ManageMembers | FSM/AUTHZ | `money_invariants_test.go` `TestMemberStatus_AllowedValues`, `TestSuspendMember_And_RestoreMember_RequireManageMembers`; live `TestLiveDB_SuspendThenRestoreMember_PersistsStatusAndAudit`, `TestLiveDB_SuspendMember_NonAdminForbidden`, `TestLiveDB_TransferMember_PersistsChapterAndAudit` | AUTOMATED |
| AI-note approve/publish (status,action) pairs valid vs CHECK constraint | FSM | `money_invariants_test.go` `TestAiNoteStatus_ApprovePublishTransitions`; live `TestLiveDB_AiNote_ApproveThenPublish_PersistsStatusAndAudit` | AUTOMATED |
| **AI-note authorization gate present (regression-guard)** | **SEC/AUTHZ** | **`money_invariants_test.go` `TestAiNoteStatus_NoAuthorizationGate_DocumentsKnownGap`** + live approve/publish non-admin-forbidden round-trip in `TestLiveDB_AiNote_ApproveThenPublish_PersistsStatusAndAudit` | AUTOMATED |
| PublishOrganisation full graph + rejects w/o accepted terms | INT | `live_db_integration_test.go` `TestLiveDB_PublishOrganisation_PersistsFullGraphAndAudit`, `TestLiveDB_PublishOrganisation_RejectsWithoutAcceptedTerms` | AUTOMATED (gated) |
| Commission recording → Community/Group Membership earning-row only (no ledger re-post) | INT | — (mount `finance_routes.go` L858-861; no test asserts single earning row w/o double ledger post) | TODO |
| Flag-off (`FeatureAssociationsEnabled=false`) → routes unmounted (404) | SEC | — (no automated flag-off assertion) | TODO |
| HTTP handler layer (bind errors, `statusFor` mapping, `Idempotency-Key` header wiring) | CON | — (handlers thin; only service layer tested) | TODO |

## 4. Manual test cases

Money = integer kobo. Auth context supplies `user_id`; base path `/api/finance/associations`.

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `ASSOCIATION-INT-001` | Pay dues happy path posts balanced double-entry | P0 | Member owns invoice `inv-A` status `DUE`, amount `2_000_000` kobo | `POST /dues/inv-A/pay` with `Idempotency-Key: k1`, body `{"method":"WALLET"}` | amount `2_000_000` | 200; `{ReceiptID:"rcpt_inv-A", Status:"SUCCESS"}`; ledger `Debit` user→settlement for `2_000_000`; 4 `assoc_revenue_splits` rows summing to `2_000_000` (1_000_000/600_000/300_000/100_000); invoice→`PAID`; audit `DUES_PAY` |
| `ASSOCIATION-INT-002` | Receipt read after pay | P1 | `inv-A` paid via 001 | `GET /receipts/rcpt_inv-A` as owner | — | 200; receipt with `AmountKobo=2_000_000`, org + member name |
| `ASSOCIATION-INV-003` | Dues split kobo-exact on non-round amount | P0 | Invoice `inv-B` amount `10_007` kobo | `POST /dues/inv-B/pay` key `k2` | `10_007` | Legs: State `3_002`, Local `1_501`, Platform `500`, National `5_004` (remainder); sum == `10_007` exactly |
| `ASSOCIATION-INV-004` | PayInvoice rejects missing Idempotency-Key | P0 | Invoice `inv-C` DUE, owner caller | `POST /dues/inv-C/pay` with **no** `Idempotency-Key` header | — | 400 `ErrIdempotencyRequired`; no ledger call, invoice stays `DUE` |
| `ASSOCIATION-INV-005` | Dues idempotent replay — same key | P0 | `inv-A` paid | Re-`POST /dues/inv-A/pay` key `k1` | — | 200 same `rcpt_inv-A`; exactly ONE ledger debit total, ONE payment row, no extra split rows |
| `ASSOCIATION-INV-006` | Already-PAID short-circuit ignores fresh key | P0 | `inv-A` paid | `POST /dues/inv-A/pay` with a **different** key `k1b` | — | 200 same receipt; invoice-status guard prevents second debit (no double-pay) |
| `ASSOCIATION-INT-007` | Dues concurrency — parallel double-submit | P0 | `inv-D` DUE | Fire 2 concurrent `POST /dues/inv-D/pay` same key `k3` | — | Exactly one settlement; one payment row (`ON CONFLICT (idempotency_key) DO NOTHING`); one set of split rows |
| `ASSOCIATION-INT-008` | Commission split records earning-row only | P0 | `FeatureCommissionEnabled=true`; `inv-E` amount `2_000_000` | Pay `inv-E` key `k4` | platform share `100_000` | `commission_earnings` gains ONE Community/Group Membership row = platform share `100_000`; **no** second ledger post (dues split already routed the fee — `finance_routes.go` L858-861) |
| `ASSOCIATION-AUTHZ-001` | IDOR — pay another member's invoice | P0 | `inv-X` owned by member M2; caller M1 | `POST /dues/inv-X/pay` key `k5` as M1 | — | 403 `ErrForbidden`; no ledger movement (mirrors `TestLiveDB_PayInvoice_ForbidsPayingSomeoneElsesInvoice`). Cross-ref RBAC-AUTHZ-005 |
| `ASSOCIATION-AUTHZ-002` | Offline-payment decide denied for non-finance role | P0 | Caller is `CHAPTER_ADMIN` (ManageFinance=false); pending offline `pay-1` | `POST /admin/finance/offline/pay-1/decision` `{approve:true}` key `k6` | — | 403 `ErrForbidden`; no `PostJournal`. Cross-ref RBAC-AUTHZ-006 |
| `ASSOCIATION-AUTHZ-003` | AssignRole blocks self-escalation | P0 | Caller `CHAPTER_ADMIN` (ManageMembers=true, ManageFinance=false) | `POST /admin/members/:id/role` `{role:"SUPER_ADMIN"}` | — | 403 — needs BOTH ManageMembers && ManageFinance; only SUPER/NATIONAL admin may assign. Cross-ref RBAC-AUTHZ-007 |
| `ASSOCIATION-AUTHZ-004` | **AI-note approve requires admin (gap regression-guard)** | **P0** | Caller is a plain member (no `assoc_member_roles` row); AI note `note-1` status `READY` | `POST /ai-notes/note-1/approve` | — | **403 `ErrForbidden`; status stays `READY`, no audit row.** Guards the documented gap where any member could approve/publish minutes. Positive path: `SECRETARY` succeeds → `APPROVED` + `MINUTES_APPROVE` audit. Locked by `TestAiNoteStatus_NoAuthorizationGate_DocumentsKnownGap` |
| `ASSOCIATION-AUTHZ-005` | AI-note publish requires admin | P0 | Plain member caller; `note-1` status `APPROVED` | `POST /ai-notes/note-1/publish` | — | 403; status unchanged. `SECRETARY`/admin → `PUBLISHED` + `MINUTES_PUBLISH` audit |
| `ASSOCIATION-AUTHZ-006` | Per-association scope isolation on directory | P0 | Caller belongs to org O1 only; member `mid-O2` in org O2 | `GET /members/mid-O2` | — | Not returned / 403 — directory + member reads are scoped to caller's association; no cross-org leakage |
| `ASSOCIATION-FSM-007` | DecideApplication REJECT does not activate membership | P1 | Pending application `app-1` | `POST /admin/approvals/app-1/decision` `{decision:"REJECT"}` key `k7` as ApproveMembers admin | — | 200; application→`REJECTED`; `assoc_memberships` untouched (not activated) |
| `ASSOCIATION-INV-008` | DecideApplication requires key for every decision | P0 | Pending `app-2` | `POST /admin/approvals/app-2/decision` `{decision:"REJECT"}` **no key** | — | 400 `ErrIdempotencyRequired` — stricter than offline-pay (all decisions need a key) |
| `ASSOCIATION-VAL-009` | DecideApplication rejects unknown decision | P2 | Pending `app-3` | `POST .../decision` `{decision:"MAYBE_LATER"}` key `k8` | — | 400/rejected; case-sensitive (`approve` lowercase invalid too) |
| `ASSOCIATION-INT-010` | Offline payment approve posts balanced journal (idempotent) | P0 | Finance admin; offline `pay-2` pending, amount `250_000` | `POST /admin/finance/offline/pay-2/decision` `{approve:true}` key `k9`, then retry same key | `250_000` | First: `PostJournal` DR provider_clearing / CR settlement, payment `SUCCESS`, invoice `PAID`; retry swallows `ledger.ErrDuplicate` → single posting |
| `ASSOCIATION-INT-011` | Offline payment reject moves no money | P1 | Finance admin; offline `pay-3` pending | `POST .../decision` `{approve:false}` (no key needed) | — | Payment→`FAILED`; audit `OFFLINE_PAYMENT_REJECTED`; zero ledger calls |
| `ASSOCIATION-FSM-012` | Suspend then restore member | P1 | ManageMembers admin; active member `mid-1` | `POST /admin/members/mid-1/suspend` then `/restore` | — | Status `ACTIVE`→`SUSPENDED`→`ACTIVE`; each writes an allowed status value + audit row |
| `ASSOCIATION-VAL-013` | Publish organisation requires accepted terms | P1 | Authed caller | `POST ` (root) with draft where terms not accepted | — | Rejected (mirrors `TestLiveDB_PublishOrganisation_RejectsWithoutAcceptedTerms`) |
| `ASSOCIATION-SEC-014` | Flag-off unmounts all routes | P0 | `FEATURE_ASSOCIATIONS_ENABLED=false` | `GET /associations` and `POST /dues/:id/pay` | — | 404 (routes never registered — `finance_routes.go` L849). See [`../cross-cutting/feature-flags-and-audit.md`](../cross-cutting/feature-flags-and-audit.md) |
| `ASSOCIATION-SEC-015` | Unauthenticated request rejected | P0 | No/invalid bearer token | Any `/associations/*` call | — | 401 at finance-group auth guard (before handler). See [`../cross-cutting/authentication.md`](../cross-cutting/authentication.md) |
| `ASSOCIATION-VAL-016` | Malformed JSON body | P2 | Authed member | `POST /support/tickets` with invalid JSON / missing required `body` on reply | — | 400 from `ShouldBindJSON`; no side effect |

## 5. State-machine transitions

The module carries several small status machines (no single central FSM). Key transitions and their guards:

### Membership application (`DecideApplication` — `service.go` L196-236)

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| PENDING | `APPROVE` | APPROVED | activates `assoc_memberships` row | `ASSOCIATION-FSM-007` / live `TestLiveDB_DecideApplication_ApprovePersistsAndActivatesMembership` |
| PENDING | `REJECT` | REJECTED | membership NOT activated | `ASSOCIATION-FSM-007` |
| PENDING | `REQUEST_INFO` | INFO_REQUESTED | membership untouched | `TestDecideApplication_AllowedTransitions` |
| any | (unknown, e.g. `MAYBE_LATER`, `approve` lowercase) | — | rejected | `ASSOCIATION-VAL-009` |

All decisions require `Idempotency-Key` (`ASSOCIATION-INV-008`).

### Member lifecycle (`service_actions.go` — `SuspendMember`/`RestoreMember`)

Allowed `assoc_memberships.status` set (DB CHECK): `DRAFT, PENDING, ACTIVE, INACTIVE, SUSPENDED, EXPIRED, RESTRICTED, REJECTED, REMOVED`. `SuspendMember` → `SUSPENDED`; `RestoreMember` → `ACTIVE`. Both require `ManageMembers`. Illegal target status (outside CHECK set) must be rejected by the schema — do not attempt.

### AI note / minutes (`SetAiNoteStatus` — `service_ext.go`)

Allowed `assoc_ai_notes.status` (DB CHECK): `PROCESSING, READY, APPROVED, PUBLISHED, FAILED`.

| From | Event | To | Guard | Case ID |
|---|---|---|---|---|
| READY | approve | APPROVED (`MINUTES_APPROVE` audit) | `requireAssocAdmin` (admits SECRETARY) | `ASSOCIATION-AUTHZ-004` |
| APPROVED | publish | PUBLISHED (`MINUTES_PUBLISH` audit) | `requireAssocAdmin` | `ASSOCIATION-AUTHZ-005` |

### Dues invoice

`DUE → PAID` (via `PayInvoice` or offline-payment approve). Re-entering `PAID` is idempotent — the already-PAID short-circuit returns the same receipt without re-posting (`ASSOCIATION-INV-005/006`). No downgrade from `PAID`.

## 6. Security & abuse cases

- **AI-note authorization gap (call-out).** `SetAiNoteStatus` (`service_ext.go`) originally had **no** `requireCap`/`requireAssocAdmin` check while every sibling admin mutation did, so any authenticated member could approve/publish official meeting minutes (an integrity/impersonation risk). Now fixed by `requireAssocAdmin` as the first statement; deliberately `requireAssocAdmin` (not `requireCap`) so `SECRETARY` — the intended minutes reviewer, whose every `AdminCapabilities` flag is false — is admitted. The regression-guard `TestAiNoteStatus_NoAuthorizationGate_DocumentsKnownGap` (`backend/tests/association/money_invariants_test.go` L610-642) must FAIL loudly if the guard is ever removed and must be updated deliberately, never silently deleted. Covered as P0 `ASSOCIATION-AUTHZ-004/005`.
- **IDOR / object-level ownership.** `PayInvoice` + `GetReceipt` compare `ownerID != userID` server-side (`ASSOCIATION-AUTHZ-001`). Never trust a body-supplied owner or membership id.
- **Per-association scope isolation.** Role gates read `assoc_member_roles` joined to the caller's own membership; a role in org O1 must not authorize actions in org O2, and directory/member reads must not leak cross-org (`ASSOCIATION-AUTHZ-006`).
- **Privilege escalation.** `AssignRole` needs BOTH `ManageMembers && ManageFinance` — `CHAPTER_ADMIN` and `FINANCE_ADMIN` are each individually blocked (`ASSOCIATION-AUTHZ-003`).
- **Idempotency-Key.** Missing key fails closed on `PayInvoice` and on every `DecideApplication`; on `DecideOfflinePayment` the approve branch requires it, reject does not (no money moves). See [`../cross-cutting/money-invariants.md`](../cross-cutting/money-invariants.md).
- **Amount tampering / server-side pricing.** Dues amount comes from `assoc_dues_invoices.amount_kobo`, never the request body; the client cannot re-price. `RevenueSplit` is deterministic and kobo-exact.
- **Commission double-count.** Recorder is wired WITHOUT a ledger (nil) on purpose — the dues split already routes the 5% platform fee, so it appends an earning ROW only; a second ledger post would double-count (`ASSOCIATION-INT-008`, `finance_routes.go` L855-861).
- **Fail-closed on dependency errors.** Ledger/settlement-account errors abort the pay with no partial writes (tx rollback). KYC/tier gating is not applied at this module (dues debit routes through the ledger wallet) — see [`../cross-cutting/kyc-and-tiers.md`](../cross-cutting/kyc-and-tiers.md) for the wallet-side gate.
- **Feature flag.** No flag ⇒ no recorder and no mounted routes (`ASSOCIATION-SEC-014`).

## 7. Automated specs to add

- `backend/tests/association/commission_recording_test.go` — assert a settled dues pay records exactly ONE `commission_earnings` Community/Group Membership row equal to the platform share and posts NO second ledger entry (the `finance_routes.go` L858-861 contract). Follow the transcribed-invariant style of `money_invariants_test.go`. **TODO.**
- `backend/tests/association/flag_off_test.go` — build the finance router with `FeatureAssociationsEnabled=false` and assert `/associations/*` returns 404 (routes unregistered). **TODO.**
- `backend/internal/association/handler_test.go` — thin HTTP-layer table test (httptest + gin) covering `statusFor` mapping (`ErrForbidden`→403, `ErrIdempotencyRequired`→400, default→500), `Idempotency-Key` header→`req.IdempotencyKey` wiring, and `ShouldBindJSON` 400s. **TODO.**
- Promote the AI-note negative-authz assertion (`ASSOCIATION-AUTHZ-004`) into a DB-free service test with a fake role store if `requireAssocAdmin` is refactored to an injectable dependency, so it runs without `DATABASE_URL`. **TODO.**

## 8. Coverage target & exit criteria

Tier 0 money-path: pure-logic (`RevenueSplit`, split/idempotency invariants, capability tables) ≥ 85% — already met by `model_test.go` + `money_invariants_test.go`. DB-backed paths covered by `live_db_integration_test.go` (gated on `DATABASE_URL`) must run green in the association CI lane.

**Exit criteria — all P0 cases green before release:** `ASSOCIATION-INT-001` (balanced double-entry), `ASSOCIATION-INV-003/004/005/006` (kobo-exact + idempotency), `ASSOCIATION-INT-007` (concurrency), `ASSOCIATION-INT-008` (commission earning-row only), `ASSOCIATION-AUTHZ-001/002/003/006` (IDOR, finance gate, no self-escalation, scope isolation), `ASSOCIATION-AUTHZ-004/005` (**AI-note authorization regression-guard**), `ASSOCIATION-INT-010` (offline approve idempotent), `ASSOCIATION-INV-008` (decision key), `ASSOCIATION-SEC-014/015` (flag-off + auth). The regression-guard test `TestAiNoteStatus_NoAuthorizationGate_DocumentsKnownGap` must be present and passing — its removal or silent inversion blocks release.
