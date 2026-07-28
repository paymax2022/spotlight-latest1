# Voting Engine Architecture — Unified Cross-Cutting Core

Status: implemented · Scope: `frontend-web/` · Owner: Voting

## TL;DR

The Spotlight web app runs **three distinct vote engines** for three distinct
products. They were never meant to share a database schema — but they were
silently drifting apart on the *cross-cutting* money-safety concerns
(idempotency, fraud signalling, audit, payment verification), each
re-implementing them slightly differently.

We extracted a single shared core at
**`src/server/voting/core/`** that all three engines now delegate to for those
cross-cutting concerns. **Endpoints, request/response contracts, and domain
tables are unchanged** — this is an internal de-duplication, not a schema or API
change.

## The three engines (and why they stay separate)

| Engine | Entry routes | Service | Domain tables | Product |
| --- | --- | --- | --- | --- |
| **v1 general** | `app/api/votes/*` | `src/server/voting/paid-vote.service.ts` (`verifyAndCreditPaidVote`), `free-vote.service.ts`, `totals.service.ts` | `votes`, `vote_transactions` | General contest voting (packages, receipts, daily free-vote limits) |
| **v2 bridge** | `app/api/v2/votes/*` | `src/server/voting-bridge/bridge.ts` | *(legacy Spotlight tables, via the protected legacy credit call)* | KYC-gated / outbox-driven bridge over the **protected** legacy Spotlight vote engine |
| **open-mic** | `app/api/open-mic/votes/*` | `src/server/openmic/persistence.ts` (`castVote`) | `competition_entry_votes`, `competition_entries` | Open-mic competition-entry voting (leaderboard recompute from source of truth) |

These three domain models are **intentionally different products** and their
tables are deliberately kept apart:

- **General vs competition-entry.** A general contest vote (`votes` +
  `vote_transactions`, with packages, bonus votes, and receipts) and an open-mic
  entry vote (`competition_entry_votes`, where the leaderboard is *recomputed
  from the source-of-truth rows*) have different lifecycles, different totals
  semantics, and different admin tooling. Merging them would couple two products
  that ship and evolve independently.
- **Legacy bridge / brownfield rule.** The v2 bridge wraps the **protected
  legacy Spotlight vote engine**. Per the iron rule in `CLAUDE.md`, legacy
  Spotlight vote files are never edited — they are wrapped via adapters. The
  bridge's legacy credit call stays exactly as-is; the bridge only adds
  cross-cutting concerns *around* it.

So we unified the **behaviour** (the cross-cutting contract) without unifying the
**data** (the domain tables).

## The shared core — `src/server/voting/core/`

| Module | Export(s) | Responsibility |
| --- | --- | --- |
| `idempotency.ts` | `resolveIdempotency`, `withIdempotency`, `IdempotencyAnchor` | One idempotency guard. Given a payment reference / idempotency key and a domain "anchor" (`lookupCached` + optional atomic `claim`), it returns **`cached → return the cached success (200)`** or **`fresh → proceed`**. A duplicate verify never re-verifies and never double-credits. |
| `payment.ts` | `verifyVotePayment`, `verifyPaystackPayment` (re-export) | The **single** Paystack verify wrapper. There is exactly one server-side verify implementation (`payment/paystack.ts`); this is the one import surface, so the success flag / amount-in-kobo / provider reference can't diverge between engines. |
| `fraud.ts` | `recordVoteFraudSignals`, `VoteEngineDomain` | One table-agnostic fraud-signal recorder for **velocity / high-volume**, **repeated device/IP**, and **mismatched amount**. Signals are persisted to the shared `fraud_flags` ledger (fire-and-forget — flagging never blocks a paid vote). |
| `audit.ts` | `recordVoteAudit` | One audit emitter. Wraps the canonical `appendAuditLog` (`vote_audit_logs`) so every engine writes a consistently-shaped, domain-namespaced entry (`<domain>:<action>`) for verify / credit / amount-mismatch events. |
| `index.ts` | barrel | `@/src/server/voting/core` is the single import surface. |

### How each engine now delegates

- **v1 general** (`paid-vote.service.ts#verifyAndCreditPaidVote`)
  - Idempotency via `resolveIdempotency`, with the transaction's
    `vote_credit_status === 'credited'` as the durable anchor.
  - Payment verify via `verifyVotePayment`.
  - On amount mismatch and on successful credit it calls
    `recordVoteFraudSignals` (amount-mismatch + high-volume) and
    `recordVoteAudit`. The pre-existing legacy `appendAuditLog` entries are kept
    for back-compat.

- **v2 bridge** (`bridge.ts`)
  - Both `bridgedCastFreeVote` and `bridgedVerifyPaidVote` now resolve
    idempotency through `resolveIdempotency`, backed by the
    `bridge_idempotency_keys` table exposed as an `IdempotencyAnchor`
    (`bridgeIdempotencyAnchor` in `voting-bridge/idempotency.ts`). Same helper,
    same semantics as v1/open-mic — only the storage differs.
  - The **legacy credit call is untouched**: the bridge still delegates to the
    protected `verifyAndCreditPaidVote` / legacy free-vote path, which themselves
    now run the core. This is belt-and-braces dedup plus response caching for
    fast 200s on retries.

- **open-mic** (`pay/verify/route.ts` + `persistence.ts#castVote`)
  - The verify route resolves idempotency through `resolveIdempotency`, anchored
    on the Paystack `payment_reference` already persisted on
    `competition_entry_votes`, and verifies via `verifyVotePayment`. Response
    shape (`{ success, alreadyProcessed, newCount }`) is unchanged.
  - `castVote` now also calls `recordVoteFraudSignals` and `recordVoteAudit` on
    the paid path, in addition to its existing open-mic-specific
    `admin_audit_logs` payment event and spike alert.

## The single money-safety contract

All three engines now satisfy the **same** contract for a paid/credited vote:

1. **Idempotency.** Every verify is idempotent on its payment reference /
   idempotency key. A duplicate returns the cached success (200) and never
   double-credits — enforced by `core/idempotency`.
2. **Double-entry / recompute-from-source-of-truth.** Money is integer minor
   units (kobo). v1 posts to `vote_transactions` + `votes`; open-mic recomputes
   the leaderboard count from the `competition_entry_votes` source rows; the v2
   bridge defers to the legacy double-entry credit. The credited total is always
   derived, never blindly incremented.
3. **Audit.** Every money event writes a consistent, domain-namespaced entry to
   `vote_audit_logs` via `core/audit` (in addition to any domain-specific audit).
4. **Fraud.** Every credited paid vote runs the shared `recordVoteFraudSignals`
   (amount-mismatch, high-volume/velocity, repeated device/IP) and persists
   signals to the shared `fraud_flags` ledger.

## Gaps closed

- **open-mic** previously had no amount-mismatch or velocity fraud signalling in
  the shared ledger and no canonical `vote_audit_logs` entry on credit — only its
  own `admin_audit_logs` events. Both are now emitted via the core.
- **v2 bridge** dedup'd via its own table with bespoke claim/store logic that did
  not share the v1/open-mic idempotency contract. It now expresses the same
  contract through `resolveIdempotency`.
- **Payment verification** was imported from three call sites with subtly
  different handling. It is now the single `verifyVotePayment` wrapper.

## Deliberately left separate (with rationale)

- **Domain vote tables** (`votes`/`vote_transactions` vs
  `competition_entry_votes`/`competition_entries` vs legacy bridge tables) — these
  are different products with different lifecycles; merging them is out of scope
  and explicitly disallowed.
- **The legacy Spotlight credit path** behind the v2 bridge — protected by the
  brownfield rule; wrapped, never edited.
- **v1's settings-driven free-vote scorer** (`fraud.service.ts#runFraudChecks`) —
  it reads the general-contest `votes` table and stays the v1-specific scorer.
  The shared `recordVoteFraudSignals` adds the cross-cutting signals on top; it
  does not replace the rich per-engine scoring.
- **open-mic's `admin_audit_logs` payment events and spike alerts** — kept as the
  open-mic-native audit surface, now complemented (not replaced) by the shared
  `vote_audit_logs` entry.

## Tests

`tests/unit/voting/core.spec.ts` covers the core directly: idempotency cache-hit
(no re-run of the `fresh` callback) vs fresh, claim race-loss as a cache hit,
fraud signal recording (amount-mismatch + high-volume + persistence), and audit
emission (domain-namespaced shape + failure-swallowing). The existing engine
specs (`free-vote`, `open-mic-pay-verify`, `vote-reversal-refund`,
`contract-presence`) remain green and unchanged in behaviour.
