# ADR-PR<pr-number>: Mirror credited paid votes into the connect tally

- **Status:** Accepted
- **Date:** 2026-08-31
- **Module:** voting (money path)

## Context

A wallet purchase debited ₦5,000, returned `votesCredited: 50`, and the
contestant's displayed count stayed at zero.

Both halves were working. The purchase writes the **universal** engine —
`votes`, `vote_totals` — via `incrementVoteTotals()`. The mobile roster and
leaderboard are served by Go's `ListRoster`, which sums
`connect_votes.quantity` (`backend/internal/connect/voting/repo.go:34`). Free
votes cast through the connect path write `connect_votes`; paid votes bought
through the web path never did. Nothing joined the two engines, so the money
path wrote a plane the app does not read.

The ledger itself was correct throughout: balanced `DEBIT`/`CREDIT` of 500000
kobo. This was a projection gap, not an accounting one.

## Decision

**1. Mirror, do not migrate.** A credited purchase is projected into
`connect_votes` by a new bridge (`src/server/voting-bridge/connect-tally.ts`).
Neither engine changes. `paid-vote.service.ts` and `totals.service.ts` are
brownfield-protected; per the `vote-bridge` skill they are imported and called,
never edited.

**2. The database supplies idempotency.** `connect_votes` already carries
`uq_connect_votes_idem`, a partial unique index on `idempotency_key`. The key is
`connect-tally:<payment reference>`. A Paystack webhook and a browser redirect
verifying the same transaction therefore collapse to one row, rather than
doubling somebody's votes — the TOCTOU the vote-bridge skill documents in
`verifyAndCreditPaidVote()`.

**3. A mirror failure never fails the purchase.** By the time the bridge runs the
money has moved and the votes are credited in the universal engine. Returning an
error would report a failed purchase that actually succeeded. It returns a reason
the caller logs loudly, and because the write is idempotent the miss is
replayable (`scripts/dev/repair-connect-tally.sh`).

**4. The card path gets a v2 route.** `app/api/votes/paid/verify/route.ts` is
protected, so `app/api/v2/votes/paid/verify/route.ts` calls the same protected
service unchanged and adds the mirror. Mobile now calls v2. It reads the
transaction row back rather than trusting the request body — the caller never
sends the contestant, the quantity or the buyer.

## Consequences

- The buyer sees the votes they paid for. Verified end to end: the reported
  purchase now returns `votes=50, rank=1` from `ListRoster`.
- Bonus votes count in the tally (`total_votes_to_credit`), while `amount_kobo`
  records money actually paid.
- A contestant that is not on the contest is refused, mirroring Go's
  `checkRosterTarget`, so a mispassed id cannot accumulate a phantom tally.

## Known limitations, deliberately not solved here

- **No reversal path.** `vote_totals` models reversals (`reversed_votes`);
  `connect_votes` has no equivalent. A refunded purchase keeps its connect votes.
  This predates the bridge — the connect plane never had a reversal concept — but
  the mirror now makes refunded paid votes visible where before they were absent
  from that plane entirely. Needs its own design.
- **Anonymous card purchases cannot be mirrored.** `connect_votes.voter_id` is
  NOT NULL and FKs `auth.users`. Those buyers still see no movement; the route
  logs a warning rather than dropping it silently.
- **The two engines remain two engines.** This projects one direction for one
  event. Consolidating them is a much larger piece of work.
