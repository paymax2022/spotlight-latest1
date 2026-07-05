# Association module — QA report (Agent D)

Boundary: `backend/tests/association/**` (external Go test package, exported
API only) + this file. No changes were made inside `backend/internal/association/`.

## Test files

| File | Package | Needs live DB? |
|---|---|---|
| `backend/tests/association/money_invariants_test.go` | `association_test` | No — pure logic / transcribed invariants |
| `backend/tests/association/live_db_integration_test.go` | `association_test` | Yes — skips cleanly if `DATABASE_URL`/`TEST_DATABASE_URL` unset |

Both files compile against `spotlight/backend/internal/association`'s exported
API only (`Service`, `NewService`, `PayInvoice`, `DecideApplication`,
`DecideOfflinePayment`, `SuspendMember`, `RestoreMember`, `TransferMember`,
`AssignRole`, `PublishOrganisation`, `SetAiNoteStatus`, `GetAiNote`,
`GetOrganisations`, `RevenueSplit`, request/response DTOs, `AdminCapabilities`).

## Why two tiers (mirrors `finance/settlement/split_invariant_test.go`)

`association.Service` takes a concrete `*pgxpool.Pool` (`NewService(db
*pgxpool.Pool, ledger *ledger.Service) *Service`), so none of its DB-backed
methods can execute without a live, migrated Postgres. Following the existing
house pattern in `backend/internal/finance/settlement/split_invariant_test.go`
and `backend/tests/transport_scheduled/live_db_integration_test.go`:

- **`money_invariants_test.go`** proves the properties that are independent of
  the DB driver by transcribing the exact formulas/branches from the cited
  production source lines, and by modeling the persistence/idempotency
  contract with small in-memory fakes (`fakeDuesLedger`, `fakeInvoiceStore`,
  `fakeOfflineLedger`) whose dedup semantics mirror the real `ON CONFLICT
  (idempotency_key) DO NOTHING` / `ledger.ErrDuplicate` behavior described in
  `service.go` / `service_actions.go` / `finance/ledger/service.go`. Any drift
  between this file and the cited source lines is the bug the
  `ledger-auditor` subagent should catch on review.
- **`live_db_integration_test.go`** drives the REAL `association.Service`
  against a REAL Postgres — full round-trip, real ledger postings, real audit
  rows. Skip-gated, not stubbed: every step is fully written so it runs the
  moment `DATABASE_URL`/`TEST_DATABASE_URL` is exported.

## Invariants covered

### Dues payment (`PayInvoice`) — money path
- DB-free: `TestPayInvoice_ReceiptIDDerivation`, `TestPayInvoice_LedgerReference`
  (exact `"rcpt_"+invoiceID` / `"assoc_dues:"+invoiceID` derivations, cited to
  `service.go` L103/113/149/154-157).
- DB-free: `TestPayInvoice_IdempotentRetry_OnePostingOneReceipt` and
  `TestPayInvoice_DifferentIdempotencyKeySameInvoice_StillOnlyOnePayment` model
  the already-PAID short-circuit (service.go L101-104) — exactly one ledger
  debit, one `assoc_payments` row, and the same receipt id returned on retry,
  even with a different Idempotency-Key on the second call.
- Live-DB: `TestLiveDB_PayInvoice_IdempotentSamePostingSameReceipt` — same
  Idempotency-Key twice → exactly one `assoc_payments` row, invoice flips to
  `PAID` once, one `DUES_PAY` audit row, and the correct number of
  `assoc_revenue_splits` rows (`len(RevenueSplit(amount))`).
- Live-DB: `TestLiveDB_PayInvoice_PostsBalancedDoubleEntry` — wallet balance
  drops by EXACTLY the invoice amount (the debit leg of the balanced entry;
  the credit leg lands on the settlement standing account per `service.go`
  L107-116).
- Live-DB: `TestLiveDB_PayInvoice_ForbidsPayingSomeoneElsesInvoice` — OLA:
  non-owner gets `ErrForbidden`.
- Live-DB: `TestLiveDB_PayInvoice_RequiresIdempotencyKey` — fail-closed with
  zero DB writes when the header is missing.

### RevenueSplit (pure function, exercised directly, no DB)
- `TestRevenueSplit_SumsExactlyToTotal`, `TestRevenueSplit_NoNegativeLegs`,
  `TestRevenueSplit_NationalAbsorbsRemainder`,
  `TestRevenueSplit_LabelsAreStableAndDistinct` — value conservation (legs sum
  to exactly `amountKobo`, National absorbs the truncation remainder, no
  negative legs, stable label strings for 4 destinations: National/State/
  Local/Platform).

### Approval decisions (`DecideApplication`)
- DB-free: `TestDecideApplication_AllowedTransitions` (APPROVE/REJECT/
  REQUEST_INFO → APPROVED/REJECTED/INFO_REQUESTED; any other value, including
  a differently-cased `"approve"`, is rejected),
  `TestDecideApplication_RequiresIdempotencyKey`,
  `TestDecideApplication_ApproveActivatesMembership` (only APPROVE touches
  `assoc_memberships`).
- Live-DB: `TestLiveDB_DecideApplication_ApprovePersistsAndActivatesMembership`
  — application → `APPROVED`, membership → `ACTIVE`, one `APPROVAL_DECISION`
  audit row.
- Live-DB: `TestLiveDB_DecideApplication_RejectDoesNotActivateMembership` —
  REJECT flips application status only; membership untouched.

### Offline payment decisions (`DecideOfflinePayment`)
- DB-free: `TestDecideOfflinePayment_ApproveRequiresIdempotencyKey` /
  `_RejectDoesNotRequireIdempotencyKey` (the guard is `approve &&
  idempotencyKey==""` — reject never needs a key since no money moves).
- DB-free: `TestDecideOfflinePayment_ApproveIdempotentSinglePosting` /
  `_RejectNeverPostsLedger` model the `ledger.ErrDuplicate`-tolerant retry
  contract (service_actions.go L258-260).
- DB-free: `TestDecideOfflinePayment_CapabilityGate_OnlyManageFinance`
  transcribes `capabilitiesFor()` (service.go L554-567) — only SUPER_ADMIN /
  NATIONAL_ADMIN / FINANCE_ADMIN may decide; CHAPTER_ADMIN and SECRETARY may
  not.
- Live-DB: `TestLiveDB_DecideOfflinePayment_ApprovePostsBalancedJournal` —
  payment → `SUCCESS`, invoice → `PAID`, exactly 2 `ledger_entries` rows
  (one balanced DEBIT/CREDIT pair, `provider_clearing → settlement`) for
  reference `assoc_offline_approval:<paymentID>`, and a same-key retry posts
  no additional rows.
- Live-DB: `TestLiveDB_DecideOfflinePayment_RejectNoLedgerMovement` — status →
  `FAILED`, zero ledger rows, one `OFFLINE_PAYMENT_REJECTED` audit row.
- Live-DB: `TestLiveDB_DecideOfflinePayment_NonFinanceAdminForbidden` — a
  CHAPTER_ADMIN is rejected.

### Member lifecycle (suspend / restore / transfer / role) — OLA
- DB-free: `TestMemberStatus_AllowedValues`,
  `TestSuspendMember_And_RestoreMember_RequireManageMembers`,
  `TestAssignRole_RequiresBothManageMembersAndManageFinance` (transcribes the
  `ManageMembers && ManageFinance` gate — only SUPER_ADMIN/NATIONAL_ADMIN may
  assign roles; no self-escalation by CHAPTER_ADMIN or FINANCE_ADMIN).
- Live-DB: `TestLiveDB_SuspendThenRestoreMember_PersistsStatusAndAudit` — full
  SUSPENDED → ACTIVE cycle, one audit row per transition
  (`MEMBER_SUSPEND`/`MEMBER_RESTORE`).
- Live-DB: `TestLiveDB_SuspendMember_NonAdminForbidden` — OLA: a plain member
  with no `assoc_member_roles` row cannot suspend anyone; target status
  unchanged.
- Live-DB: `TestLiveDB_TransferMember_PersistsChapterAndAudit` — `chapter_id`
  persists to the resolved chapter, one `MEMBER_TRANSFER` audit row.
- Live-DB: `TestLiveDB_AssignRole_PersistsRoleAndAudit_ChapterAdminForbidden`
  — NATIONAL_ADMIN can grant SECRETARY (persists + audits); CHAPTER_ADMIN is
  forbidden from assigning any role.

### Organisation publish (`PublishOrganisation`)
- Live-DB: `TestLiveDB_PublishOrganisation_PersistsFullGraphAndAudit` —
  organisation row `published=true`, all seeded chapters/committees/
  membership-categories persist, one `ORG_PUBLISH` audit row, AND the new org
  is immediately visible via the `GetOrganisations` read path (publish/read
  consistency).
- Live-DB: `TestLiveDB_PublishOrganisation_RejectsWithoutAcceptedTerms` — the
  `AcceptedTerms` guard fires before any row is written (zero rows on reject).

### AI-notes approve/publish
- DB-free: `TestAiNoteStatus_ApprovePublishTransitions` — locks the exact
  (status, action) pairs the handlers send to `SetAiNoteStatus`
  (`APPROVED`/`MINUTES_APPROVE`, `PUBLISHED`/`MINUTES_PUBLISH`), both valid
  against the `assoc_ai_notes.status` CHECK constraint.
- Live-DB: `TestLiveDB_AiNote_ApproveThenPublish_PersistsStatusAndAudit` —
  READY → APPROVED → PUBLISHED, one audit row per transition, and the read
  path (`GetAiNote`) reflects the final state.
- Live-DB: `TestLiveDB_AiNote_SetStatus_NotFoundIsReported` — documents
  CURRENT behavior for a missing note id (see gap below).

## KNOWN GAP found during this audit (flag for Agent A / security-reviewer)

**`SetAiNoteStatus` (`backend/internal/association/service_ext.go`
L454-467) performs NO authorization check.** Every other admin-style mutation
in this package calls `requireCap(...)` or `requireAssocAdmin(...)` first
(`DecideOfflinePayment`, `SuspendMember`, `RestoreMember`, `TransferMember`,
`AssignRole`, `BulkImportMembers`, `ImportPreview`, `ConfirmImport`,
`GetAdminKpis`, `GetApprovalQueue`, `GetFinanceSummary`,
`GetOfflinePayments`, `GetAuditLog`). `SetAiNoteStatus` does not, and its
callers (`handler_ext.go` `ApproveAiNote` / `PublishAiNote`) pass
`c.GetString("user_id")` straight through as `adminID` without any upstream
admin/secretary check either. **Result: any authenticated member — not just a
SECRETARY or org admin — can approve or publish meeting minutes today.**

This is documented, not silently patched (out of QA's boundary — Agent A owns
`internal/association`):
- `money_invariants_test.go::TestAiNoteStatus_NoAuthorizationGate_DocumentsKnownGap`
  is a regression-guard test that will fail (forcing a deliberate, reviewed
  update) the moment an authorization check is added, so the fix can't
  regress silently.
- `live_db_integration_test.go::TestLiveDB_AiNote_SetStatus_NotFoundIsReported`
  additionally documents that `SetAiNoteStatus` does not check
  `RowsAffected()` — calling it with a non-existent note id still writes an
  audit row and returns `nil` rather than a not-found error.

Recommend Agent A add a `requireCap`/`requireAssocAdmin` (likely
`SECRETARY`-or-above, per the FAQ's "a committee admin will review" framing
for minutes) check to `SetAiNoteStatus` or its two call sites, and request
`security-reviewer` sign-off before this ships, per CLAUDE.md's "before any PR
touching auth/PII" rule.

## Which tests need live Postgres vs. run DB-free

- **DB-free (always run, no infra needed):** all 22 tests in
  `money_invariants_test.go`. Run in ~0.02s.
- **Live-DB (skip-gated on `DATABASE_URL`/`TEST_DATABASE_URL`):** all 16 tests
  in `live_db_integration_test.go`. Each seeds its own organisation/membership/
  invoice/etc. with fresh `uuid.New()` ids — no shared fixtures, no
  truncation, safe to re-run against the same test database repeatedly.
  `TestLiveDB_PayInvoice_*` tests additionally seed a wallet balance via a
  direct `ledger.Service.Credit` call before exercising `PayInvoice`'s debit,
  since `ledger.Debit` fails closed on insufficient funds.

## Bring-up note for live-DB tests

1. Apply migrations in order, at minimum:
   - `supabase/migrations/20260628000000_association_module.sql`
   - `supabase/migrations/20260629000000_assoc_committee_members.sql`
   - `supabase/migrations/20260629000100_association_settings.sql`
   Confirm: `psql "$DATABASE_URL" -c "\d assoc_dues_invoices"`
2. Point at a disposable/test database — never production:
   ```
   export DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
   ```
   (`supabase db reset`, local, port 54322, is the safest target.)
3. Run:
   ```
   cd backend && go test ./tests/association/... -run LiveDB -v
   ```

## go-test cheat sheet

Using portable Go 1.25 (per swarm contract):
```
PATH=/tmp/go125/go/bin:$PATH GOFLAGS=-buildvcs=false GOCACHE=/tmp/gocache GOMODCACHE=/tmp/gomod

# Compile + static check (this module's boundary):
cd backend && go build ./tests/association/...
cd backend && go vet ./tests/association/...

# Run the DB-free subset only (fast, no infra, safe in any CI job):
cd backend && go test ./tests/association/... -run 'Test[^L]|TestL[^i]|TestLi[^v]' -v
# (simplest in practice: just `go test ./tests/association/...` — the LiveDB
# tests self-skip when DATABASE_URL/TEST_DATABASE_URL is unset, so this is
# also the command to run with NO live DB available.)

# Run everything INCLUDING live-DB tests (requires a migrated Postgres):
export DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
cd backend && go test ./tests/association/... -v

# Run only the live-DB subset:
cd backend && go test ./tests/association/... -run LiveDB -v
```

## Build/test evidence (this run)

```
$ cd backend && go build ./tests/association/...
(clean, no output)

$ cd backend && go vet ./tests/association/...
(clean, no output)

$ cd backend && go build ./internal/association/... ./tests/association/...
(clean, no output)

$ cd backend && go test ./tests/association/... -v
=== 22 DB-free tests: PASS
=== 16 live-DB tests: SKIP (no TEST_DATABASE_URL/DATABASE_URL set)
PASS
ok  	spotlight/backend/tests/association	0.017–0.021s
```

Toolchain: portable Go 1.25.0 (linux/amd64) at `/tmp/go125/go/bin/go`,
`GOFLAGS=-buildvcs=false`, `GOCACHE=/tmp/gocache`, `GOMODCACHE=/tmp/gomod`, per
the swarm contract's pinned build recipe.

## Inventory of exported symbols exercised

`association.Service` (via `NewService(*pgxpool.Pool, *ledger.Service)`):
`PayInvoice`, `GetReceipt`, `DecideApplication`, `GetOrganisations`,
`DecideOfflinePayment`, `SuspendMember`, `RestoreMember`, `TransferMember`,
`AssignRole`, `PublishOrganisation`, `SetAiNoteStatus`, `GetAiNote`. DTOs:
`PayInvoiceRequest`, `PayInvoiceResult`, `ApprovalDecisionRequest`,
`OrgDraft`, `OrgDraftChapter`, `OrgDraftCommittee`, `OrgDraftCategory`,
`PublishResult`, `AdminCapabilities`. Pure function: `RevenueSplit`. No
internal (unexported) identifier is referenced anywhere in
`backend/tests/association/**` — confirmed by a clean `go vet` against an
external `_test` package.
