# Estate UAT lane B — M07–M11 (dues, rent/lease, payments, meetings, elections)

Lane: `uat/estate-b` · Worktree `/tmp/uat-estate-b` · Base `f0816a2c4` · 116 cases (EST-UAT-0116..0231)

## Environment (honest limits)

- **No live backend.** `localhost:8080` is an unrelated `rx-api-gateway` container; no spotlight backend is running. `backend/.env` (main checkout) points at `127.0.0.1:54322` — local Supabase is **down** (`supabase status`: no container). `TEST_DATABASE_URL` unset → all `TestLiveDB_*` suites SKIP.
- Executed evidence is therefore: `go build` (OK), `go vet` (OK), `go test` unit suites (all PASS), `npx vitest run tests/unit/estate` (48 PASS incl. 12 new), `npx tsc --noEmit` (clean), and structured code review. API_LIVE rows are BLOCKED by environment, not by product.

## M07 — Dues, levies & assessments (22 cases: 0 impl-full, ~6 partial, 16 missing)

Exists and hardened: ad-hoc `CreateInvoice` (category enum, admin-only, kobo validation), `ListInvoices` (resident-scoped), `PayDues` wallet path (Idempotency-Key fail-closed, tier gate in-tx, FOR UPDATE invoice lock, partial-unique ON CONFLICT — PROPMGMT-013 fix VERIFIED intact), `PayDuesPaystackFunded` (verified-amount cross-check), soft/hard `estate_dues_restrictions` (lifted on payment), `MarkOverdueInvoices` + `AutoApplyOverdueRestrictions` maintenance jobs, platform reconciliation read (`/estate-admin/dues/reconciliation`).

Missing: dues-type entity with frequency/GL/eligible-payer rules (0116), batch assessment runs monthly/annual with cycle idempotency (0117/0118/0123), unit-type tariffs + effective dating (0119/0121), vacant discount (0120), one-off levy targeting (0122), penalty/grace engine (0124/0125), waiver workflow (`waived` status exists; no setter) (0126/0127), liability split (0128), partial/over-payment handling — both paths enforce exact amount (0129/0130), disputes (0131), aging buckets (0132), bulk import (0133), scheduled reminders (0134), statements (0135), write-offs (0136), locked periods (0137).

## M08 — Rent, lease & landlord (22: ~4 implemented, ~5 partial, 13 missing)

Exists: `realtor_leases` funnel (application→lease, tenant e-sign + `signed_at` + signature name — 0139), unsigned-lease gating (invoice only created at sign; `active` only via verified payment — 0140), single annual rent+deposit+service-charge invoice at signing (0143), `realtor_pay_invoice` hardened (verified wallet debit, service_role only), inspection-gated escrow release/forfeit via `ResolveEscrow` (all-or-nothing, audit-logged — 0153 partial/0154), tenancy requests + landlord/tenant assignment + transfer requests (0155 partial), RLS tenant scoping (0156), rent/dues table+ledger separation (0159).

Missing: direct lease registration outside application funnel (0138), overlap detection (0141), recurring monthly invoicing (0142), proration (0144), due-date/grace/late-fee engine + cap (0145/0146), partial & split payments (0147/0148), adjustments (0149), renewal (0150), expiry notifications (0151), early termination (0152), partial deposit deductions (0153), arrears follow-up (0158), PAYSTACK channel for rent (0161 — 501 disclosed gap, ESTB-D009).

## M09 — Payments, ledger, refunds & settlement (26: ~16 pass, ~4 partial, 6 missing)

Strong: `estate/paystackcheckout` (quoted-amount freeze, intent dedup by idempotency key, `ClaimForProcessing` single-claim, verify-then-pay, amount-mismatch→refund, failure→refund, self-heal `CheckStatus`) — unit-tested. Wallet dues path idempotent end-to-end. NEW: BFF cross-idempotency-key double-charge race closed on both dues and realtor paths (ESTB-D004/D005), foreign-key replay → 409.

Missing/partial: resident refund request + approval flow (0175/0176), combined dues+rent checkout (0172 partial — separate ledgers exist), fee disclosure (0173), gateway/bank payout destination verification (0180 — payouts are wallet credits), reconciliation exception listing beyond billed/collected variance (0182 partial), daily cash ledger tie-out (0183), general reversal-with-approval flow outside escrow resolve (0185 partial). Webhook signature/dup-delivery at the platform seam is platform-owned (0165 recorded shared_platform).

## M10 — Meetings & minutes (16: ~7 pass, ~4 partial, 5 missing)

Exists: create/list/get (resident-scoped, BFF + Go), RSVP upsert yes/no/maybe + counts, attendance check-in unique per (meeting,user), start/end/cancel/reschedule FSM (admin, audited), minutes upload + approve (re-upload un-approves), meeting documents, estate-scoped isolation.

Missing: committee-only audiences (0187), per-invitee invites (0188 partial — broadcast notify), quorum gating (0195), task-linked action items + overdue follow-up (0197/0198), export (0200). Note ESTB-D008: BFF `POST /api/v1/estate/meetings` allows any resident (mobile ships a create screen) while Go `CreateMeeting` is estate_admin — inconsistent, needs product decision.

## M11 — Voting, polls & estate elections (30: ~14 pass, ~5 partial, 11 missing)

Exists + hardened this lane: draft create (Go; BFF creates directly — PARTIAL), single-position ballot, UNIQUE(election_id,voter_id) one-vote, server-side window enforcement, `election_eligibility_rules` (KYC/payment/resident-types) + dues-restriction gate — **now enforced on the BFF path too (ESTB-D001, was completely bypassed)**, banned/deleted members fail closed (ESTB-D002), sealed receipts + pre-publish tally withholding (ESTB-D003/D006), admin integrity audit (ballots vs distinct voters), certified publish (`tallied`), cross-estate isolation.

Missing: electoral roll entity/freeze/challenge (0204/0208/0219 partial), one-vote-per-unit weighting (0205), nomination/vetting workflow (0209-0211), abstain/ranked/multi-seat ballots (0221/0222 — documented schema limit), election quorum (0223), tie-break config (0225), recount/complaint (0227), cancellation (0229), informal polls (0230). Schema-level voter→choice link remains (pending migration `20261021000001_*.pending.sql`, ESTB-D003).

## Defects

| ID | Sev | Status | Summary |
|---|---|---|---|
| ESTB-D001 | S1 | FIXED | BFF vote ignored eligibility rules + dues restrictions |
| ESTB-D002 | S2 | FIXED | BFF getResidentContext ignored banned/deleted members |
| ESTB-D003 | S2 | PARTIAL+recorded | Ballot secrecy: voter→choice link in schema + receipt echo |
| ESTB-D004 | S1 | FIXED | Dues BFF cross-key double-debit race (no atomic claim) |
| ESTB-D005 | S1 | FIXED | Realtor BFF same race + foreign-key receipt misattribution |
| ESTB-D006 | S2 | FIXED | Live tally exposed to all residents mid-poll |
| ESTB-D007 | S3 | FIXED | Admin arrears join used resident row id → always ₦0 |
| ESTB-D008 | S3 | recorded | BFF meeting-create open to residents vs Go admin-only |
| ESTB-D009 | S3 | recorded | Realtor PAYSTACK channel unimplemented (501) |
| ESTB-D010 | S3 | shared_platform | Webhook signature/dup handling is platform-owned |

See `defects-estate-b.csv` for full root causes; `rtm-estate-b.csv` for all 116 rows; `exec-estate-b.csv` for every executed check. Pending migrations under `migrations-estate-b/`.
