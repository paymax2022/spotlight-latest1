# ADR-002: Vote Engine Deprecation & Production Status

**Date**: 2026-08-11  
**Status**: ACCEPTED  
**Decision Makers**: Engineering Team, Product  
**Scope**: Voting system data consistency, migration planning

## Context

Two vote engines exist in the codebase:

### Legacy Engine (Spotlight Original)
- **Tables**: `contestant_votes`, `vote_allocations`
- **Functions**: SQL RPCs `cast_free_vote()`, `cast_paid_votes()`, `cast_referral_vote()`
- **Migrations**: `supabase/migrations/20260404240000_voting_engine.sql`
- **Status**: Inactive for web; may still be used by mobile/admin legacy code
- **Data**: Contains original Open Mic Q3 + Reality TV voting data

### Universal Engine (Web Fintech)
- **Tables**: `votes`, `vote_totals`, `vote_transactions`, `voter_daily_limits`, `bridge_idempotency_keys`, `bridge_outbox`
- **Services**: TypeScript in `frontend-web/src/server/voting/`
- **Bridge**: `frontend-web/src/server/voting-bridge/` (NEW)
- **Status**: Active for web frontend, being extended to mobile
- **Data**: New vote records as of Phase 2 (2026-08-11)

## Current Production State

**Query Production DB Status** (to be run before shipping bridge):

```sql
-- Count rows by engine
SELECT
  (SELECT COUNT(*) FROM public.contestant_votes) as legacy_rows,
  (SELECT COUNT(*) FROM public.votes) as universal_rows;

-- Sample legacy votes (last 10 days)
SELECT created_at, COUNT(*) as votes
  FROM public.contestant_votes
  WHERE created_at > now() - interval '10 days'
  GROUP BY DATE(created_at)
  ORDER BY created_at DESC;

-- Confirm universal engine receiving votes
SELECT created_at, COUNT(*) as votes
  FROM public.votes
  WHERE created_at > now() - interval '10 days'
  GROUP BY DATE(created_at)
  ORDER BY created_at DESC;
```

### Expected Finding

**Web Frontend**:  
`contestant_votes` = 0 new rows (all votes to `votes` table)  
`votes` = incrementing with each vote via bridge

**Mobile/Admin** (if still using legacy):  
`contestant_votes` = incrementing rows  
Indicates legacy code path still active; needs migration

## Decision

### 1. Keep Both Engines During Bridge Rollout (Phase 1)

**Rationale:**
- Web frontend migrates to bridge → writes to `votes` table
- Mobile/admin may still use legacy → writes to `contestant_votes` table
- Both engines coexist for ~2 weeks, no schema changes
- Leaderboard and voting UIs query both engines (union query)

**Implementation:**
```sql
-- Unified leaderboard query (bridges legacy + universal)
SELECT
  contestant_id,
  SUM(vote_count) as total_votes  -- aggregates both tables
FROM (
  SELECT contestant_id, COUNT(*) as vote_count FROM contestant_votes
  UNION ALL
  SELECT contestant_id, COUNT(*) as vote_count FROM votes
) combined
GROUP BY contestant_id
ORDER BY total_votes DESC;
```

### 2. Stop Legacy Engine Writes After Bridge Stabilizes (Phase 2, ~2 weeks later)

After bridge runs stable in production and metrics show:
- ✅ Vote bridge idempotency working (cache hit > 5%)
- ✅ KYC gate rejecting appropriately (< 1% of votes)
- ✅ No doubled votes, no orphaned records
- ✅ Mobile/admin migrated to bridge (or explicitly deprecated)

**Action:**
1. Confirm query results above show zero new `contestant_votes` rows
2. Disable SQL RPC functions:
   ```sql
   REVOKE EXECUTE ON FUNCTION public.cast_free_vote FROM authenticated;
   REVOKE EXECUTE ON FUNCTION public.cast_paid_votes FROM authenticated;
   REVOKE EXECUTE ON FUNCTION public.cast_referral_vote FROM authenticated;
   ```
3. Add note to `docs/DEPRECATED.md`: "Legacy vote engine disabled 2026-08-25"

### 3. Archive Legacy Tables After 30-Day Retention (Phase 3, ~30 days later)

To preserve audit trail and enable rollback:
1. Create archive table:
   ```sql
   CREATE TABLE public.contestant_votes_archive AS
     SELECT * FROM public.contestant_votes;
   ```
2. Truncate live tables (optional):
   ```sql
   TRUNCATE public.contestant_votes, public.vote_allocations;
   ```
3. Drop RPCs (optional, only if no references remain)

## Monitoring & Metrics

Add dashboard to track engine usage:

| Metric | Target | Alert Threshold |
|--------|--------|---|
| Legacy writes/day | 0 | > 10 |
| Universal writes/day | increasing | flat for 24h |
| Bridge cache hit rate | > 5% | < 1% (indicates low concurrency) |
| Vote count discrepancy | 0 | > 100 |

## Rollback Plan

If universal engine has bugs:
1. Revert to legacy by reversing SQL REVOKE commands
2. Disable bridge (`VOTES_BRIDGE_ENABLED=false`)
3. Add migration to re-enable RPCs
4. No data loss; `votes` table remains as audit trail

## Related ADRs

- [[ADR-001-vote-bridge-idempotency]] — How bridge prevents TOCTOU races
- [[ADR-003-vote-leaderboard-unification]] (future) — How to merge leaderboard data from both engines

## Timeline

| Phase | Date | Action |
|-------|------|--------|
| Phase 1 (Current) | 2026-08-11 | Bridge deployed, both engines active |
| Phase 1b | 2026-08-13 | Monitor metrics, confirm no regression |
| Phase 2 | 2026-08-25 | Disable legacy RPC functions |
| Phase 3 | 2026-09-25 | Archive legacy tables (optional) |

## Decision

**ACCEPTED**. Strategy:
✓ Coexist both engines during bridge validation  
✓ Query production to confirm legacy writes have stopped  
✓ Disable legacy RPCs after 2 weeks of stability  
✓ Archive historical data for audit compliance  
✓ Full switchover by end of Phase 2  

Approved by: Engineering Lead, Product Manager  
Verification Query: [Link to monitoring dashboard]  
Deprecation Announced: 2026-08-11  
Sunsetting Date: 2026-09-25
