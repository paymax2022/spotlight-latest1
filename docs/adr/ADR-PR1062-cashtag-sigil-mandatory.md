# ADR-PR1062: Cashtag recipients on the wallet→wallet rail are sigil-mandatory

Status: accepted — the Go rail and the contract ship in this PR; the Next BFF and mobile parity
legs ship in the follow-up PR (behind the existing `FEATURE_WALLET_TRANSFERS_ENABLED`; no new flag)

## Context

`contracts/openapi.yaml` has described a `/transfers/paymax` recipient as "phone, email, or
Paymax username" since the rail was specified, and the crypto P2P endpoint repeats the claim.
Only phone was ever implemented in the Go rail, plus email in the Next BFF. Users who typed
`@bisi` — the identifier the Social Pay, Events ticket-transfer and Creator-tip rails already
use — got a 404 naming an identifier they believed existed.

The directory (`cashtag_handles`, `uq_cashtag_handle`, `uq_cashtag_user`) already answers
"who owns this handle", so this was a closed contract leg rather than a new interface. But the
handle grammar `[a-z0-9][a-z0-9_]{2,29}` admits strings that are also digit runs, and a wallet
credit cannot be clawed back. An identifier that silently means two things depending on who is
looking is the failure mode this rail already refuses with `ErrAmbiguousRecipient` (409) for
shared phone numbers.

## Decision

1. **The `@`/`$` sigil is mandatory.** A sigil'd input is addressed through the directory;
   a bare `bisi` keeps its current meaning — not a phone, not an email, 404. We never guess
   which identifier the sender meant.
2. **One recogniser, one shape rule, shared across both entry points.** The Go rail's
   `transfers.ParseCashtagRecipient` (this PR) and the BFF's `parseCashtagIdentifier` (parity PR)
   are the same algorithm, and both delegate the grammar to one pattern — Go via
   `cashtag.IsValidShape`, newly exported for exactly this reason, the BFF via a `CASHTAG_SHAPE`
   literal commented to stay byte-identical. `tests/unit/finance/paymax-resolve.spec.ts` asserts
   the same table `TestParseCashtagRecipient` asserts, so the two cannot diverge about what a
   handle *is*, not merely about how to look one up. That matters because the mobile app reaches
   the BFF and the web app reaches Go: one divergence makes the same `$handle` payable from one
   client and refused from the other.
3. **Same rail, one row.** Resolution happens inside `ResolvePaymaxUser`, which sits strictly
   after PIN verification and strictly before the tier guard, so a handle send runs the
   existing mutation unchanged: fee schedule, tier daily limit, self-transfer refusal,
   `transfer_wallet_atomic`, one `wallet_transfers` row, one audit event. No new table, no
   second endpoint, no new kind of transfer.
4. **A handle cannot be ambiguous.** `uq_cashtag_handle` makes the 409 class impossible here,
   so the cashtag leg never returns `ambiguous_recipient`; the spec's 409 stays scoped to phones.
   Do not "unify" those two legs — the phone leg's refusal exists because two accounts really can
   share a number.
5. **404 means "unclaimed", 500 means "we could not tell".** Unclaimed handle → 404; the
   database failing → 500 (`cashtagLookupFailure`), matching the BFF, which already threw 500.
   The pre-existing phone leg collapses infra errors into 404; left as-is deliberately —
   changing it alters an existing rail's contract, so it is a separate follow-up.
6. **`user_profiles.phone` is read defensively.** The phone leg never sees a NULL because its
   WHERE clause excludes them (`user_profiles_phone_nsn_idx` is partial on exactly that
   predicate); the cashtag leg looks the owner up by `user_id`, so it COALESCEs — otherwise a
   handle owned by a phone-less account is unpayable from one client while the other pays it.
   Pinned live by `TestLiveDB_CashtagRecipient_PhonelessProfileIsStillPayable`.
7. **No new feature flag.** No new module is added and both entry points already sit behind the
   wallet-transfers flag (`FEATURE_WALLET_TRANSFERS_ENABLED` on the Go mount,
   `requireFeature('walletTransfers')` on both BFF routes). If a staged rollout is wanted, the
   seam is `SetCashtagDirectory(nil)`, which fails closed as 500 rather than falling through to
   phone.

## Consequences

- Typing a handle without its sigil stays a 404 on a money path. Accepted: the alternative is
  guessing, and a guess can pay a stranger permanently. The recipient-field placeholder on the
  transfer screens names the sigil (`@cashtag, phone, or email`), which lands with the parity PR.
- Reserved and impersonation-prone handles stay unreachable-by-addressing because `Claim`
  rejects them at creation; the addressing path checks shape only, so a lookup can never leak
  the block list. The residual risk is a direct insert into `cashtag_handles` behind `Claim`,
  which is true of every table in the schema and not specific to transfers.
- Until the parity PR merges, web can pay a `@handle` and the app cannot. That is additive
  breakage only: no existing send changes behaviour.
- Out of scope and reported, not fixed: the crypto `/transfers/crypto` spec text claims handle
  parity it never implemented; `mobile .../social.constants.ts` `CASHTAG_REGEX`
  (`^@?[a-zA-Z0-9_]{3,20}$`) is a looser grammar than the directory's and serves only the
  `app/social/*` screens; `GET /transfers/paymax/resolve` is metered on neither rail, which is
  the security follow-up recorded in this PR's description.
