# Wallet Module — UAT Test Plan

Module 7 in the fixed 21-module go-live queue. Built fresh (unlike Contest, this module had no pre-existing test-plan artifact) from Phase 1 discovery findings — see the discovery notes folded into §0 below.

Status legend: ✅ Pass · ❌ Fail · 🚫 Missing · ⚠️ Blocked · 🚧 Partial · 🔧 Fixed · 🏗️ Built · ⬜ Not Run

## 0. Discovery summary (Phase 1)

- **Backend home**: `backend/internal/finance/wallet/` — thin (balance + transaction listing only). Top-up, PIN, and wallet-to-wallet transfer live in `frontend-web/src/server/wallet/` and `backend/internal/finance/transfers/`.
- **Unified ledger plane**: ADR-045 (one wallet plane) and ADR-051 (FX NGN single wallet) confirmed live in current code, not aspirational.
- **Card rail**: ADR-041 (card tops up wallet, waits for webhook credit before charging) confirmed live.
- **Top-up verify fallback**: `frontend-web/src/server/wallet/verify.ts` self-heals pending Paystack intents on read (handles the "webhook can't reach localhost" dev gap) — fails closed on ambiguity.
- **Real gap flagged in discovery, to verify in Phase 3**: no PIN set/change UI was found anywhere in `mobile-app/reactnative`, despite ADR-041 stating wallet debits are PIN-gated server-side (`backend/internal/finance/transfers/pin.go`). If confirmed, this blocks the entire debit-side golden path for any user who has never had a PIN provisioned some other way (e.g., at KYC/onboarding — needs checking).
- **RBAC**: wallet reuses Finance-wide `finance:adjust:initiate`/`finance:adjust:approve` (maker-checker) and Go's `finance.admin.transfers` — no wallet-specific permission exists.
- **Admin surface**: `frontend-admin/app/admin/finance/wallets/page.tsx` — balance + ledger lookup only, no manual adjustment UI on this page (adjustments live on the separate Finance-wide `/admin/payments-finance` maker-checker console).

## 1. Primary user journeys

| ID | Scenario | Priority | Entry point | Steps | Expected | Auto | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| WJ-001 | View wallet balance | P0 | Mobile wallet tab | Open app → wallet tab | Correct balance shown, matches ledger projection | Y | ⬜ Not Run | |
| WJ-002 | Top up via card (Paystack) | P0 | `app/wallet/add.tsx` | Enter amount → pay via Paystack → webhook credits | Balance increases by exact amount after webhook; topup intent resolves | Y | ⬜ Not Run | Core of ADR-041 |
| WJ-003 | Top up via bank transfer / virtual account | P0 | VA flow (`finance/va/me`) | Transfer to VA → webhook credits wallet | Same as WJ-002 via a different rail | Y | ⬜ Not Run | |
| WJ-004 | Top-up verify-on-read self-heal | P0 | Reload topup status page after a slow/missed webhook | Pending intent still resolves correctly on next page load | Balance credited without a second charge; no double-credit | Y | ⬜ Not Run | Exercises `verify.ts`'s self-heal path directly |
| WJ-005 | View transaction history | P1 | Wallet tab / transaction list | Scroll/paginate history | Correct chronological list, correct amounts, correct direction (credit/debit) | Y | ⬜ Not Run | |
| WJ-006 | View a single transaction detail | P1 | `app/wallet/transaction/[id].tsx` | Tap a transaction | Correct detail, matches ledger entry | Y | ⬜ Not Run | |
| WJ-007 | Set a transaction PIN (first time) | P0 | ⚠️ no located UI | New user attempts a wallet debit for the first time | PIN-set flow appears before any debit is allowed | ⬜ | 🚫 Missing | **Real gap flagged in discovery — confirm before scripting further debit tests** |
| WJ-008 | Change/reset PIN | P1 | ⚠️ no located UI | Existing user changes PIN | Old PIN invalidated, new PIN required for next debit | ⬜ | 🚫 Missing | Same gap as WJ-007 |
| WJ-009 | Wallet-to-wallet transfer (send) | P0 | `app/wallet/send.tsx` | Enter recipient + amount + PIN → send | Sender debited, recipient credited, balanced ledger, PIN required | Y | ⬜ Not Run | Verify `send.tsx` actually wires to `wallet-to-wallet.ts` (discovery flagged this as unconfirmed) |
| WJ-010 | Withdraw to bank account | P0 | `app/wallet/withdraw.tsx` (`PaymentActionScreen`) | Enter amount + destination + PIN → withdraw | Wallet debited, payout initiated, correct ledger entries | Y | ⬜ Not Run | |
| WJ-011 | Tier/limit display and upgrade flow | P1 | `app/connect/wallet/tier/*` | View tier status, submit upgrade docs | Correct tier shown, upgrade flow reachable | Y | ⬜ Not Run | Discovery found this may be a DIFFERENT wallet surface (Connect-module variant) from the core wallet tab — resolve which is canonical before scripting |

## 2. Edge cases & negative paths

| ID | Scenario | Priority | Expected | Auto | Status | Notes |
|---|---|---|---|---|---|---|
| WE-001 | Top up with amount = 0 or negative | P0 | Rejected client- and server-side | Y | ⬜ Not Run | |
| WE-002 | Debit exceeding balance | P0 | Rejected, no partial debit, no negative balance | Y | ⬜ Not Run | |
| WE-003 | Debit exceeding tier daily/monthly limit | P0 | Rejected fail-closed (`tiers.EnforceWalletDebitLimit`) | Y | ⬜ Not Run | Confirm the limit check is genuinely enforced, not just present in code |
| WE-004 | Wrong PIN entered | P0 | Rejected, attempt counted | Y | ⬜ Not Run | |
| WE-005 | PIN lockout after repeated wrong attempts | P0 | Locked for the documented window (5 attempts / 15 min per `pin.go`) | Y | ⬜ Not Run | Confirm the lockout window matches what's documented, not assumed |
| WE-006 | Duplicate top-up webhook delivery (replay) | P0 | Idempotency-Key prevents double-credit | Y | ⬜ Not Run | |
| WE-007 | Concurrent top-up + debit race | P0 | Ledger stays balanced under concurrency (DB-executed proof required, not mocked) | Y | ⬜ Not Run | Mirror Contest module's DB-executed-proof standard |
| WE-008 | Paystack webhook forged/invalid signature | P0 | Rejected, no credit | Y | ⬜ Not Run | |
| WE-009 | Top-up intent abandoned (never completes) | P1 | Stays pending indefinitely, no phantom credit, no crash on repeated status polls | Y | ⬜ Not Run | |
| WE-010 | Transfer to a non-existent/invalid recipient | P0 | Rejected before any debit | Y | ⬜ Not Run | |
| WE-011 | Transfer to self | P1 | Rejected or explicitly handled (define expected behavior) | Y | ⬜ Not Run | |
| WE-012 | Withdrawal to an invalid/unverified bank account | P0 | Rejected before debit | Y | ⬜ Not Run | |
| WE-013 | Network/timeout failure mid-withdrawal | P0 | No debit without confirmed payout initiation; no stuck ambiguous state without a recovery path | Y | ⬜ Not Run | Discovery found no admin recovery tooling for stuck wallet topups specifically — check withdrawals too |
| WE-014 | Currency/precision: fractional kobo, rounding | P1 | Exact integer kobo throughout, no float drift | Y | ⬜ Not Run | |
| WE-015 | Empty state: brand-new user, zero transactions | P2 | Clean empty state, no crash, balance shows ₦0 | Y | ⬜ Not Run | |

## 3. Cross-cutting concerns

| ID | Scenario | Priority | Expected | Auto | Status | Notes |
|---|---|---|---|---|---|---|
| WC-001 | IDOR: user A cannot view/act on user B's wallet | P0 | 403/404 on any foreign wallet access attempt | Y | ⬜ Not Run | |
| WC-002 | Idempotency-Key required and enforced on every money-mutating route | P0 | Missing/duplicate key handled correctly per CLAUDE.md's iron rule | Y | ⬜ Not Run | |
| WC-003 | Every money mutation posts a balanced double-entry ledger pair | P0 | DB-executed proof: no unbalanced ledger entries under any tested path | Y | ⬜ Not Run | |
| WC-004 | Every money mutation emits an audit event | P0 | Audit trail present and queryable | Y | ⬜ Not Run | |
| WC-005 | Wallet balance is always a ledger projection, never directly written | P0 | Code-level check: no direct `UPDATE` on a balance column anywhere in the money path | Y | ⬜ Not Run | |
| WC-006 | Notification on top-up success / debit / failed webhook | P1 | Correct, timely notification fires | Y | ⬜ Not Run | |
| WC-007 | Error messaging quality (user-facing, not raw stack traces / DB errors) | P1 | Clean, actionable error copy | Y | ⬜ Not Run | |

## 4. Admin portal coverage

| ID | Scenario | Priority | Expected | Auto | Status | Notes |
|---|---|---|---|---|---|---|
| WA-001 | Admin wallet lookup by user ID | P0 | Correct balance + transaction history shown | Y | ⬜ Not Run | `frontend-admin/app/admin/finance/wallets/page.tsx` |
| WA-002 | Admin manual credit/debit adjustment (maker-checker) | P0 | Propose → approve/reject flow works, self-approval blocked | Y | ⬜ Not Run | Reuses the Finance-wide ADR-005 maker-checker — should already work; verify it actually covers wallet balances end to end, not just in theory |
| WA-003 | Admin adjustment audit trail | P0 | Every adjustment traceable to an admin identity, immutable record | Y | ⬜ Not Run | |
| WA-004 | RBAC: non-finance admin cannot access wallet admin actions | P0 | 403 for a role without `finance:adjust:*`/`finance.admin.transfers` | Y | ⬜ Not Run | |
| WA-005 | Stuck/orphaned transaction recovery tooling | P1 | Admin can identify and resolve a stuck top-up/withdrawal | ⬜ | 🚫 Missing | Discovery found none beyond the member-facing self-heal in `verify.ts` — confirm this is a genuine gap, not just unfound |
| WA-006 | Reporting: aggregate wallet metrics (total balance, volume, active wallets) | P2 | Some reporting view exists and is accurate | ⬜ | 🚫 Missing (unconfirmed) | Not located in discovery — verify before marking Missing |

## 5. Non-functional

| ID | Scenario | Priority | Expected | Auto | Status | Notes |
|---|---|---|---|---|---|---|
| WN-001 | Concurrency at realistic scale (multiple simultaneous debits on one wallet) | P0 | No lost/duplicate updates — DB-executed proof | Y | ⬜ Not Run | |
| WN-002 | Mobile responsiveness of wallet screens | P2 | Usable on real device sizes | Y | ⬜ Not Run | |
| WN-003 | Accessibility basics (labels, contrast, screen-reader) | P2 | No blocking a11y gaps | Y | ⬜ Not Run | |
| WN-004 | Security: authz bypass attempts on every wallet route | P0 | Every route properly gated | Y | ⬜ Not Run | Overlaps WC-001/WA-004 — consolidate findings |
| WN-005 | Secrets exposure check (no leaked keys/tokens in logs or responses) | P0 | Clean | Y | ⬜ Not Run | |

## 6. Rollup

| Suite | Total | ✅ Pass | ❌ Fail | 🚫 Missing | ⚠️ Blocked | 🚧 Partial | 🔧 Fixed | 🏗️ Built | ⬜ Not Run |
|---|---|---|---|---|---|---|---|---|---|
| Primary journeys | 11 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 9 |
| Edge cases | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 15 |
| Cross-cutting | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 |
| Admin portal | 6 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 4 |
| Non-functional | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5 |
| **TOTAL** | **44** | **0** | **0** | **4** | **0** | **0** | **0** | **0** | **40** |

## 7. Defect log

_(populated as Phase 3 execution finds issues — mirrors Contest's §24 format: ID, description, root cause, fix, test, status)_

None logged yet — plan just constructed, execution not yet started.
