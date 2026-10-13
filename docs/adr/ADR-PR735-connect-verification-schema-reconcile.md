# ADR-PR735: Reconcile connect_verification with a union CHECK and a guarded unique index

Status: accepted

## Context
`20260627000300_connect_verification.sql` and `20260702000000_connect_phase1_core.sql` both create
`public.connect_verification` with `CREATE TABLE IF NOT EXISTS` and different shapes. The first applies;
the second is silently skipped. The verification service is written against the second shape, so it
could not work on a database built from the chain (missing columns, a status CHECK that rejects its
states, no unique(user_id) for its upsert). Nothing caught it because the service had no live-DB test.

## Decision
- **Fix forward, additively.** Never edit the applied migrations. A new migration adds the three missing
  columns, widens the status CHECK to the **union** of both vocabularies, and conditionally creates
  `unique(user_id)`.
- **Union, not replacement.** Existing rows hold the first vocabulary (`approved`, `expired`); the service
  writes the second (`none`, `l0_passed`, `l1_passed`, `failed`). Both stay valid; mapping them to one
  vocabulary is a product decision for later, not a schema accident.
- **Unique index only when safe.** The first design allowed several rows per user, so the index is created
  only when no user has duplicates (NOTICE otherwise). The service's initial insert uses `WHERE NOT EXISTS`
  so it does not depend on the index; with the index a concurrent first submit still cannot create two rows.
- **A live-DB test on the chain-built schema** is the regression guard (3 specs, red before, green after).

## Consequences
- Two status vocabularies coexist until reconciled; the admin review queue must map both.
- If production has duplicate rows per user, the unique index is skipped until they are deduplicated.
