# Voting Engine Architecture

The platform runs **three vote surfaces** that serve genuinely different products.
They intentionally keep separate domain tables, but they now share **one
cross-cutting core** so money-safety behavior can never drift between them.

## The three surfaces

| Surface | Routes | Domain service | Tables |
|---|---|---|---|
| **General contests (v1)** | `app/api/votes/*` | `src/server/voting/paid-vote.service.ts`, `free-vote.service.ts`, `totals.service.ts` | `votes`, `vote_transactions` |
| **Bridge (v2)** | `app/api/v2/votes/*` | `src/server/voting-bridge/bridge.ts` → Go `votebridge` debit → legacy Spotlight credit | Go ledger + legacy Spotlight |
| **Open-mic competitions** | `app/api/open-mic/votes/*` | `src/server/openmic/persistence.ts` (`castVote`) | `competition_entry_votes`, `competition_entries` |

## Why they stay separate

- They model **different products**: general talent contests, the legacy
  Spotlight vote engine (reached only through the Go bridge), and open-mic
  song competitions. Their schemas, lifecycles, and reporting differ.
- **Brownfield iron rule:** the legacy Spotlight vote engine is protected — the
  v2 bridge *wraps* it (debit in the Go ledger, then call the legacy credit). We
  never edit legacy vote files. Merging schemas would violate this.

## The shared cross-cutting core — `src/server/voting/core/`

All three surfaces delegate the cross-cutting concerns to one place. Endpoints,
request/response contracts, and domain tables are unchanged — this is internal
de-duplication, not a contract change.

- **`idempotency.ts`** — `resolveIdempotency` / `withIdempotency` with a
  domain-supplied `IdempotencyAnchor` (`lookupCached` + optional atomic `claim`).
  A duplicate verify returns the **cached success (200)**; a vote is never
  credited twice. v1 anchors on `vote_transactions.vote_credit_status`, v2 on
  `bridge_idempotency_keys`, open-mic on `competition_entry_votes.payment_reference`.
- **`payment.ts`** — `verifyVotePayment`, the single Paystack verify wrapper
  (kobo-normalized). A vote is only cast after Paystack confirms success.
- **`fraud.ts`** — `recordVoteFraudSignals(...)`: table-agnostic detection of
  amount-mismatch, velocity/high-volume, and repeated device/IP; persisted to the
  shared `fraud_flags` ledger (fire-and-forget, never blocks the money path).
- **`audit.ts`** — `recordVoteAudit(...)`: one emitter writing consistently
  shaped, domain-namespaced (`<domain>:<action>`) entries to `vote_audit_logs`;
  swallows failures so auditing can never break a credit.
- **`index.ts`** — barrel; `@/src/server/voting/core` is the single import surface.

## The single money-safety contract

Every paid-vote path now satisfies the same four guarantees:

1. **Idempotency** — keyed dedup; duplicate/retried verifies return cached success.
2. **Source-of-truth totals** — counts recompute from the authoritative rows
   (double-entry ledger for wallet funds; `castVote` recompute for open-mic),
   never blind increments.
3. **Audit** — a consistent `vote_audit_logs` entry on every credit and reversal.
4. **Fraud signals** — recorded on every paid cast.

Reversals (`app/api/admin/voting/votes/[voteId]/reverse`) refund wallet-funded
votes via a reversing ledger entry keyed `vote-reversal-refund:<txId>` (idempotent),
and are blocked once a vote is already `reversed`.

## Deliberately left separate

- Domain vote tables (general vs competition-entry vs legacy bridge).
- The protected legacy Spotlight credit path (wrapped, never edited).
- v1's settings-driven `runFraudChecks` scorer and open-mic's native
  `admin_audit_logs` events — the core *complements* these, it does not replace them.

## Tests

`tests/unit/voting/` — 104 tests including `core.spec.ts` (idempotency
cache-hit/fresh/claim-race, fraud signal recording + persistence, audit emission +
failure-swallowing), reversal-refund idempotency, and open-mic idempotent verify.
