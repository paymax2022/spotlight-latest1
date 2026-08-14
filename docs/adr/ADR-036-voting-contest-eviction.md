# ADR-036: Voting Contest Eviction Mechanics

**Date**: 2026-08-07  
**Status**: ACCEPTED  
**Decision Makers**: [Paymax × Spotlight Team]

## Problem Statement

Voting contests need a mechanism to eliminate low-performing contestants during multi-stage competitions. Current voting system supports free/paid voting and leaderboards but lacks:

1. **Stage-based contestant grouping** — all contestants vote together
2. **Eviction criteria** — no automatic elimination based on vote count
3. **Judge override** — no mechanism for human judgment to save contestants
4. **Grace period** — no time for judges to review and act before finalization

This ADR describes the design of an eviction system that:
- Marks bottom 20% of contestants for eviction per stage
- Provides 24-hour grace period (configurable, extensible by admin)
- Allows judges to save one contestant per stage
- Allows admins to save unlimited contestants
- Tracks all actions immutably for audit

## Decision

Implement eviction as a **staged process**:

1. **Trigger Phase** (Admin)
   - Admin clicks "trigger evictions" for a stage
   - System marks bottom 20% by vote count
   - Grace period starts (e.g., 24 hours)
   - Evicted contestants become visible with "evicted" template

2. **Grace Period Phase** (Judge/Admin)
   - Judges can save one contestant per stage
   - Admins can save unlimited contestants
   - Admin can extend grace period if needed
   - Public still sees evicted contestants (allows continued voting to change ranks)

3. **Finalization Phase** (Admin)
   - After grace period ends, admin finalizes
   - Unsaved evicted contestants removed from stage
   - Saved contestants remain and advance

### Key Design Choices

#### 1. Immutable Audit Trail
**Decision**: Record all eviction/save actions as immutable rows, never delete or update.

**Rationale**: 
- Compliance with audit requirements
- Dispute resolution (show exactly who did what when)
- Database integrity (no hidden state changes)

**Implementation**:
```sql
-- Evictions are append-only
INSERT INTO contestant_evictions (...) -- never UPDATE this table directly
INSERT INTO judge_save_records (...) -- immutable record of saves
```

#### 2. Atomic Operations at DB Layer
**Decision**: Use Postgres RPC functions with row-level locking for all state changes.

**Rationale**:
- Prevents race conditions (multiple admins triggering evictions simultaneously)
- Ensures vote count totals are consistent with eviction rankings
- Leverages database ACID guarantees

**Example**:
```sql
-- Marks bottom 20% AND increments grace period AND updates visibility in one tx
SELECT * FROM evict_bottom_percentage(contest_id, stage, 20, 24, actor_id)
```

#### 3. Public Visibility During Grace Period
**Decision**: Evicted contestants remain visible to public; styling changes to indicate status.

**Rationale**:
- Allows continued voting (vote counts can change, affecting ranks)
- Keeps contest dynamic during grace period
- Transparent to participants (see who's at risk)
- Matches real-world competition formats (think sports relegation zones)

**Alternative Rejected**: Hide evicted contestants until finalization
- Reduces transparency
- Prevents "saves" from being earned back via votes
- Less engaging for audience

#### 4. Judge Limits (One Save Per Stage)
**Decision**: Judges can save exactly one contestant per stage; admins unlimited.

**Rationale**:
- Prevents judge favoritism (force them to choose carefully)
- Maintains admin authority (admins can override judge decisions)
- Encourages strategic judge voting during grace period

**Enforced By**:
```sql
UNIQUE(eviction_id, saved_by) -- one person can only save each eviction once
+ application-layer check: "SELECT COUNT(*) WHERE saved_by = $1 AND stage = $2"
```

#### 5. Grace Period is Extensible
**Decision**: Admin can extend grace period multiple times; track original vs. current end time.

**Rationale**:
- Flexibility for unexpected circumstances
- Judges may need more time to deliberate
- Prevents "accidental" early finalizations

**Tracked As**:
```sql
grace_period_ends_at         -- current deadline
original_grace_period_ends_at -- track first deadline
grace_period_extended_at      -- when extension happened
grace_period_extended_by      -- who extended it
```

#### 6. Admin Unlimited Votes
**Decision**: Admins cast unlimited votes without payment or idempotency key.

**Rationale**:
- Contest organizers need control levers
- Can correct for fraud/bot votes
- Can support promotion/marketing votes during live event
- Recorded separately (vote_type = 'admin_adjustment') for audit

**Not in Ledger**:
- Admin votes do NOT debit wallets
- Do NOT post to finance ledger
- Recorded in `votes` table with `vote_type = 'admin_adjustment'`

#### 7. RPC Functions Over Direct SQL
**Decision**: Expose all mutations through Postgres RPC functions, not raw SQL queries.

**Rationale**:
- Encapsulates complex logic (row locking, cascading updates)
- Easier to version and test
- Prevents N+1 queries from application code
- Database layer can optimize atomicity

## Consequences

### Positive
1. **Transparent & Fair**: Public sees evicted status, fair for contestants and judges
2. **Auditable**: Immutable audit trail for compliance/disputes
3. **Safe**: Atomic operations prevent race conditions
4. **Flexible**: Grace period is extensible; judges and admins have levers

### Negative
1. **Complexity**: Three-phase process (trigger/grace/finalize) adds operational steps
2. **Storage**: Immutable audit tables grow over time (requires retention policy)
3. **Query Performance**: Joining 5+ tables to get eviction status (mitigate with indexes)

## Alternatives Considered

### Alternative A: Automatic Finalization
"Evictions finalize automatically after grace period without admin action"

**Rejected Because**:
- Removes admin control (dangerous if grace period calculation is wrong)
- Requires background job (adds operational complexity)
- Current chosen design is safer: admin explicitly finalizes

### Alternative B: Binary Voting During Grace Period
"Allow binary yes/no judge voting, majority wins on saves"

**Rejected Because**:
- Overcomplicates judge workflow
- Requires consensus logic
- One-judge-one-save is simpler and still fair

### Alternative C: Evicted = Hidden from Voting
"Remove evicted contestants from voting leaderboard during grace period"

**Rejected Because**:
- Less transparent/engaging
- Prevents "comeback" narratives (saves earned via votes)
- Existing sports competitions keep relegated teams visible (e.g., soccer promotion zones)

## Testing Strategy

### Unit Tests
- RPC functions with mocked evictions (psql tests)
- Judge limit enforcement (second save should fail)
- Grace period extension logic

### Integration Tests
- Full end-to-end eviction flow (trigger → save → finalize)
- Concurrent evictions (race condition: who triggers first wins)
- Vote count consistency (eviction rank matches actual votes)

### E2E Tests (Admin UI)
- Trigger evictions button → verify list appears
- Save contestant → verify status changes
- Extend grace period → verify timer updates
- Finalize → verify contestant removed from stage

## Rollout Plan

1. **Phase 1**: Deploy migration + RPC functions to staging
2. **Phase 2**: Deploy Go handlers + admin UI to staging
3. **Phase 3**: Feature flag in .env: `CONTEST_STAGE_EVICTION_ENABLED=false` (default off)
4. **Phase 4**: QA full flow on staging
5. **Phase 5**: Enable flag in production (behind feature gate)
6. **Phase 6**: Monitor audit logs for first week

## Monitoring & Observability

Log every eviction action:
```json
{
  "action": "evict_contestants",
  "contest_id": "...",
  "stage_number": 1,
  "count": 45,
  "eviction_percentage": 20,
  "grace_period_hours": 24,
  "triggered_by": "admin_user_id"
}
```

Track metrics:
- Evictions per contest
- Saves per stage (judge vs admin)
- Grace period extensions (indicates borderline calls)
- Finalized evictions (when actually removed)

## References

- Feature Specification: `docs/features/VOTING_CONTEST_EVICTION.md`
- Migration: `supabase/migrations/20260807000000_voting_contest_stages_eviction.sql`
- Handlers: `backend/internal/connect/voting/eviction_handlers.go`
- OpenAPI: `contracts/voting.openapi.yaml`
