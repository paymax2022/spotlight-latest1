# ADR-PR139: Wire the atomic free-vote claim into the voting bridge

- Status: Proposed
- Date: 2026-08-29

## Context

`castFreeVoteAtomic` and its `claim_free_vote` RPC (migration
`20260730120000_vote_bridge_free_vote.sql`) were built to fix three defects in the
free-vote path:

- **D-001** — the daily bucket is computed in the contest's timezone.
- **D-002** — the per-contestant cap is row-locked (`SELECT … FOR UPDATE`), so
  exactly one over-cap vote wins.
- **D-003** — `vote_totals` is upserted atomically and NULL-round-correct.

They were never called. `castFreeVoteAtomic`'s only occurrence on **either**
`develop` or `main` is its own definition. `bridgedCastFreeVote` — reached from
`/api/v2/votes/free`, which `components/voting/VoteModal.tsx` calls — instead did a
bare `INSERT` into `votes`, enforcing no cap, no timezone bucket and no totals
upsert. `free-vote-atomic.spec.ts` passes because it exercises the function in
isolation, so nothing surfaced the gap.

The client was already written for the finished design: `VoteModal` sends
`voteQuantity` and reads `json.freeVotesRemaining`. The route returned neither, so
every successful vote rendered "You have **undefined** free votes remaining today",
and `voteQuantity` was silently discarded.

## Decision

Call `castFreeVoteAtomic` from `bridgedCastFreeVote` step 3, and return its
allowance fields from the route.

- `voteQuantity` and `voterIdentifier` are forwarded from the route.
- The response drops `voteId`/`totalVotes` and carries `votesAdded`,
  `totalFreeVotesUsed`, `freeVotesRemaining`, `fraudStatus`, `resetAt`. The claim
  returns no vote id, and no caller in the tree reads either dropped field.
- `newTotalVotes` is not forwarded: the claim hardcodes it to `0` ("caller can
  fetch from totals"), and echoing a known-zero running total is worse than
  omitting it.
- `deviceFingerprint` is passed through rather than defaulted. A contest whose
  `freeVoteLimitScope` is `device` must refuse a vote it cannot attribute (the
  claim answers 400); defaulting to a placeholder would pool every
  fingerprint-less voter into one shared daily cap.

## Consequences

**Login enforcement becomes real, and this is a live behaviour change.**
`castFreeVoteAtomic` honours `requireLoginForFreeVote` (401) and
`resolveVoterIdentifier` throws 401/400 when the configured scope has no
identifier. The v2 route passes `user?.id` and today accepts anonymous voters
unconditionally. Any contest configured with those settings starts rejecting
anonymous votes the moment this lands. That is the intended design, but it is not
a no-op and should ship deliberately.

Cap exhaustion now surfaces as **429** rather than an unbounded silent success,
which depends on the status-code plumbing added alongside this work.

`v1 /api/votes/free` remains on the pre-atomic path. Leaving both is how the two
diverged; retiring or migrating it is follow-up.

## Testing

`bridge-saga.spec.ts` and `free-vote-concurrency.spec.ts` instrument the write path
through their Supabase stubs (`voteInsertCalled` flags, `callCount` sequencing) and
assert on `voteId`/`totalVotes`. Wiring the claim invalidates that harness: the vote
no longer flows through the stub, and the two fields are gone. Those 11 tests need a
considered re-base onto the claim boundary — authored, not patched — which is why it
is not bundled here.
