# ADR-PR745: Connect admin underage and media-review queues are masked, metadata-only projections

Status: accepted

## Context
The console's underage-flag and media-review pages called routes that did not exist. Both queues hold the most sensitive Connect
data: suspected minors' dates of birth and users' uploaded media.

## Decision
- **Never return the sensitive value.** Underage: the date of birth is reduced to century and day (`20••-••-14`), which identifies
  nothing on its own; a live test asserts neither the date nor the year appears. Media: only metadata (kind, state, owner, time);
  the storage URL is never selected into a response, and a live test asserts it appears nowhere.
- **Do not invent data.** AI reason codes and confidence are not stored, so they are `[]` and `0`; underage flags are not linked to
  cases, so `case_id` is null; any reason other than the age-gate one is shown as a generic `report`, not guessed.
- **Permissions.** Media review uses `connect.moderation.view`. Underage has no `.view` permission, so it uses
  `connect.underage.review` (the only underage permission); if read-only access is needed separately, add a `connect.underage.view`
  permission and role grant in a migration rather than widening this route.
- **Queue order and bounds.** Open/pending items first, then newest; filters are allowlisted (400); limit defaults to 100, max 200;
  `has_more` signals truncation (no cursor yet).

## Consequences
- A reviewer cannot see the media itself from this endpoint; viewing media needs its own signed-URL route with an access audit.
- The underage queue shows the age-gate signal only until other signals exist.
- Reads are not audited yet; add an access-audit event with the first admin write action.
