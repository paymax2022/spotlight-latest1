# ADR-PR747: Connect admin Voting tab shows Connect contests, derived from the window, with honest nulls

Status: accepted

## Context
The last 404ing console tab, Voting, expects a contest list and detail with a status, vote counts, paid volume, an integrity score and
flags, and entrant tallies. The repo has two voting worlds: the legacy Spotlight contestants/voting module (protected) and the Connect
contest tables (`connect_contests`, `connect_votes`). The owner chose **Connect contests**.

## Decision
- **Read-only projection, no migration.** Contests come from `connect_contests`, votes from `connect_votes`; the roster is read from the
  legacy `contestants` table by `connect_contest_id` (a read-only join; no legacy code is touched).
- **Status is derived from the window**, in SQL, once, used for both the filter and the value: draft -> scheduled; closed, or past
  `closes_at` -> closed; open and started -> live; open with a future `opens_at` -> scheduled. `finalized` has no stored equivalent and
  never matches.
- **Entrants:** every roster contestant (even with zero votes) plus any voted option not on the roster (a plain-poll label, named by its
  label), ordered by total votes then name.
- **Null over fiction:** `integrity_score` and `flags_open` are null and `flags` is `[]`, because nothing scores integrity or stores flags;
  dates stay null when unset. The console shows a dash / "integrity not scored yet".
- **Money needs the money permission.** Vote counts are visible with `connect.moderation.view`; `paid_vote_volume_kobo` and each entrant's
  `tally_kobo` are null unless the caller also holds `connect.gifting.view` (a missing checker or an error withholds them).
- **Bounded and safe:** `status` allowlisted (400), ids must be UUIDs (404), limit default 100 max 200, `has_more`.

## Review follow-ups (no blockers)
- **Entrants are capped at 500** (with `entrants_truncated`): a poll contest accepts free-form labels, so distinct options are unbounded;
  totals still count every vote. The roster query is capped the same way. A live test seeds 525 labels.
- **Close boundary matches the vote service:** a contest is closed only strictly after `closes_at`, exactly like `votingOpen`, so the
  console never says "live" for a contest that rejects votes (or the reverse) at the boundary.
- **Known and deferred:** the per-contest vote aggregation is not covered by an index (fine at current volumes; add a rollup/counter
  table if contests reach millions of votes); the detail reads are three queries without a shared snapshot, so totals and entrant rows can
  differ by in-flight votes; vote counts are visible without the money permission, so a holder of `connect.moderation.view` who knows the
  public unit price can derive revenue (accepted); an `opens_at` after `closes_at` shows as scheduled/closed, never live.

## Consequences
- A contest whose votes include free-form labels shows them as entrants; a phantom option that a roster contest should have rejected
  (see `checkRosterTarget`) would show up here, which is useful for audit.
- Integrity scoring/flags need their own design (signals, storage, review actions); until then the tab is a tally view, not an integrity view.
- Reads are not audited and there is no cursor; both follow the other console views.
