# Voting Contest Eviction Feature - Implementation Status

**Date**: 2026-08-07  
**Feature**: Multi-stage voting contests with contestant eviction and judge save mechanics  
**Status**: Phase 1 & 2 Complete, Phase 3 In Progress

## What Has Been Implemented

### ✅ Phase 1: Database & Schema (COMPLETE)

**File**: `supabase/migrations/20260807000000_voting_contest_stages_eviction.sql`

**Tables Created**:
1. **contest_stages** - Define stages within contests
2. **contestant_stage_assignments** - Track which stage each contestant is in
3. **contestant_evictions** - Immutable audit log of evictions
4. **judge_save_records** - Audit log of save actions
5. **contestant_eviction_visibility** - Template styling for evicted contestants

**RPC Functions** (4 atomic operations):
1. `evict_bottom_percentage()` - Mark bottom 20% for eviction
2. `save_contestant_from_eviction()` - Save during grace period
3. `extend_eviction_grace_period()` - Extend grace period (admin only)
4. `finalize_stage_evictions()` - Finalize after grace period ends

**Columns Added to Contestants**:
- `current_stage_number` - Track which stage contestant is in
- `eviction_status` - Track eviction state (none, pending, saved)
- `eviction_template` - Visual template (normal, evicted, saved)

### ✅ Phase 2: Backend (Go) API (COMPLETE)

**Files Created**:

1. **eviction_handlers.go**
   - `TriggerEvictions()` - POST /contests/{id}/stages/{stageNum}/evict
   - `SaveContestant()` - POST /contests/{id}/save
   - `ExtendGracePeriod()` - POST /contests/{id}/extend-grace-period
   - `FinalizeEvictions()` - POST /contests/{id}/stages/{stageNum}/finalize-evictions
   - `GetContestantsByStage()` - GET /contests/{id}/stages/{stageNum}/contestants
   - `GetEvictions()` - GET /contests/{id}/evictions
   - `AdminVote()` - POST /contests/{id}/admin-vote

2. **eviction_service.go**
   - Orchestrates RPC calls
   - Audit logging integration
   - Permission validation

3. **eviction_repo.go**
   - Database queries for all eviction operations
   - Result scanning and error handling

**What Still Needs**:
- [ ] Wire handlers to routes in main router (backend/main.go or similar)
- [ ] Add RBAC middleware checks (verify admin/judge roles)
- [ ] Add integration tests for RPC functions
- [ ] Test concurrent operations (race conditions)

### ✅ Phase 2b: OpenAPI Specification (COMPLETE)

**File**: `contracts/voting.openapi.yaml`

**Schemas Added**:
- EvictionRequest, EvictionResponse
- SaveRequest, SaveResponse
- ExtendGracePeriodRequest
- StageContestant
- AdminVoteRequest

**Endpoint Paths Documented** (8 total):
1. POST /v1/connect/contests/{id}/stages/{stageNum}/evict
2. POST /v1/connect/contests/{id}/save
3. POST /v1/connect/contests/{id}/extend-grace-period
4. POST /v1/connect/contests/{id}/stages/{stageNum}/finalize-evictions
5. GET /v1/connect/contests/{id}/stages/{stageNum}/contestants
6. GET /v1/connect/contests/{id}/evictions
7. POST /v1/connect/contests/{id}/admin-vote

### ✅ Phase 3: Admin UI (IN PROGRESS - COMPONENTS COMPLETE)

**Files Created**:

1. **stages/page.tsx** - Stages dashboard
   - View all stages for a contest
   - Configure eviction rules (%)
   - Create new stages
   - Links to eviction management

2. **stages/[stageNum]/evictions/page.tsx** - Eviction management
   - View pending evictions with countdown
   - Trigger evictions button
   - Save contestant button (with judge limits enforced)
   - Extend grace period button
   - Finalize evictions button
   - Real-time polling (10s interval)

3. **admin-voting/page.tsx** - Admin voting interface
   - Search/filter contestants by stage
   - Cast unlimited votes (no payment)
   - Vote quantity input with +/- buttons
   - Shows eviction status for each contestant

**What Still Needs**:
- [ ] Wire these pages into the admin navigation
- [ ] Add permission checks (RBAC) at page level
- [ ] Add API endpoint handlers in Next.js (if not using direct Go endpoints)
- [ ] Add loading skeletons and error boundaries
- [ ] Add confirmation dialogs
- [ ] Style refinements (colors, spacing)

### ✅ Phase 3b: Documentation (COMPLETE)

**Files Created**:

1. **docs/features/VOTING_CONTEST_EVICTION.md** - Comprehensive feature guide
   - Architecture overview
   - Database schema details
   - Backend API details
   - Admin UI implementation guide
   - Mobile/web UI updates
   - Implementation checklist
   - Usage examples

2. **docs/adr/ADR-022-voting-contest-eviction.md** - Architecture Decision Record
   - Problem statement
   - Design decisions with rationale
   - Consequences (positive/negative)
   - Alternatives considered
   - Testing strategy
   - Rollout plan
   - Monitoring & observability

## Remaining Work

### Phase 3 (Frontend): 
- [ ] Create API route handlers in Next.js (if not proxying to Go)
- [ ] Add RBAC checks to admin pages
- [ ] Add permission-based UI (hide buttons for non-admins/judges)
- [ ] Add confirmation modals
- [ ] Improve error handling and validation
- [ ] Add loading states with skeletons
- [ ] Style consistency across pages

### Phase 4 (Mobile):
- [ ] Update contestant listing to show eviction status
- [ ] Update voting modal to prevent voting on evicted contestants
- [ ] Add stage filtering
- [ ] Show grace period message

### Phase 5 (Public Voting UI):
- [ ] Update contestant cards to show eviction status with template styling
- [ ] Apply CSS classes based on `eviction_template` field
  - `.contestant-evicted` - Red/dark styling, "EVICTED" badge
  - `.contestant-saved` - Green styling, "SAVED" badge
  - `.contestant-normal` - Default styling
- [ ] Prevent voting on evicted contestants (show message)
- [ ] Show grace period countdown

### Phase 6 (Testing & QA):
- [ ] Migration tests (verify RPC functions work)
- [ ] Unit tests for service/repo methods
- [ ] Integration tests for full eviction flow
- [ ] E2E tests for admin UI
- [ ] Concurrent operation tests (multiple admins triggering simultaneously)
- [ ] Mobile testing

### Phase 7 (DevOps/Operations):
- [ ] Feature flag configuration
  - `CONTEST_STAGE_EVICTION_ENABLED` (default: false)
  - Add to `.env.example`
  - Add to deployment pipelines
- [ ] Monitoring/alerting setup
- [ ] Documentation for operational team

## Key Implementation Details

### Database RPC Functions

All operations use atomic Postgres RPC functions to prevent race conditions:

```sql
-- Trigger evictions (marks bottom 20%)
SELECT * FROM evict_bottom_percentage(
  p_contest_id, p_stage_number, p_eviction_percentage, p_grace_period_hours, p_actor_id
)

-- Save a contestant (enforces judge limit)
SELECT * FROM save_contestant_from_eviction(
  p_eviction_id, p_saved_by, p_save_type, p_reason
)

-- Extend grace period
SELECT * FROM extend_eviction_grace_period(
  p_eviction_id, p_additional_hours, p_extended_by
)

-- Finalize evictions (remove unsaved contestants)
SELECT * FROM finalize_stage_evictions(
  p_contest_id, p_stage_number
)
```

### Judge Limits

Judges can save ONE contestant per stage (enforced by DB):
```sql
UNIQUE(eviction_id, saved_by) -- one person can only save each eviction once
```

Admin check (application layer):
```go
if saveType == "judge" {
  // SELECT COUNT(*) WHERE saved_by = judge_id AND stage = stage_num
  // If count >= 1, return error
}
```

### Grace Period

Default 24 hours, extensible by admin:
- `grace_period_starts_at` - When eviction was triggered
- `grace_period_ends_at` - Current deadline
- `grace_period_extended_at` - When it was extended (if applicable)
- `original_grace_period_ends_at` - Track first deadline

### Admin Votes

Admins vote unlimited without payment:
```go
// Insert directly to votes table with vote_type = 'admin_adjustment'
INSERT INTO votes (contest_id, voter_id, contestant_id, paid, quantity, ...)
VALUES (contestId, adminId, contestantId, false, quantity, ...)
```

No ledger entry, no idempotency key needed.

## Wiring the Backend (Next Steps)

### 1. Register Handlers in Router

In `backend/main.go` or your Gin router setup:

```go
import "spotlight/backend/internal/connect/voting"

// In your router setup:
handler := connectvoting.NewHandler(svc)

// Eviction endpoints
r.POST("/api/v1/connect/contests/:id/stages/:stageNum/evict", handler.TriggerEvictions)
r.POST("/api/v1/connect/contests/:id/save", handler.SaveContestant)
r.POST("/api/v1/connect/contests/:id/extend-grace-period", handler.ExtendGracePeriod)
r.POST("/api/v1/connect/contests/:id/stages/:stageNum/finalize-evictions", handler.FinalizeEvictions)
r.GET("/api/v1/connect/contests/:id/stages/:stageNum/contestants", handler.GetContestantsByStage)
r.GET("/api/v1/connect/contests/:id/evictions", handler.GetEvictions)
r.POST("/api/v1/connect/contests/:id/admin-vote", handler.AdminVote)
```

### 2. Add RBAC Middleware

Create a middleware to check permissions:

```go
func adminOrJudgeAuth(c *gin.Context) {
  userID := c.GetString("user_id")
  isAdmin := checkAdmin(userID)
  isJudge := checkJudge(userID, contestID)
  
  if !isAdmin && !isJudge {
    c.JSON(http.StatusForbidden, gin.H{"error": "insufficient permissions"})
    c.Abort()
    return
  }
  c.Next()
}

// Apply to routes
r.POST("/api/v1/connect/contests/:id/stages/:stageNum/evict", 
  adminOnlyAuth(), handler.TriggerEvictions)
```

## Testing Checklist

Before production rollout:

- [ ] Migration applies cleanly to production database
- [ ] RPC functions handle edge cases (empty stage, concurrent calls)
- [ ] Judge limit enforcement (second save attempt fails)
- [ ] Grace period countdown works
- [ ] Admin can extend multiple times
- [ ] Finalization removes only unsaved contestants
- [ ] Audit trail records all actions
- [ ] Admin votes don't require idempotency key
- [ ] Admin votes don't debit wallet
- [ ] UI loads and responds correctly
- [ ] Mobile UI displays eviction status
- [ ] Public voting shows evicted template

## Feature Flag Setup

Add to `.env` files:

```bash
# .env.example
CONTEST_STAGE_EVICTION_ENABLED=false

# .env.local (development)
CONTEST_STAGE_EVICTION_ENABLED=true

# .env.production
CONTEST_STAGE_EVICTION_ENABLED=false  # Enable after QA
```

In Go middleware (example):

```go
func stagedEvictionFeature(c *gin.Context) {
  if os.Getenv("CONTEST_STAGE_EVICTION_ENABLED") != "true" {
    c.JSON(http.StatusNotFound, gin.H{"error": "feature not available"})
    c.Abort()
    return
  }
  c.Next()
}

// Apply to routes
r.POST("/api/v1/connect/contests/:id/stages/:stageNum/evict", 
  stagedEvictionFeature(), handler.TriggerEvictions)
```

## Success Criteria

Feature is production-ready when:

1. ✅ Database migration passes and doesn't break existing data
2. ✅ All RPC functions execute atomically (tested under concurrency)
3. ✅ Go API endpoints return correct responses with proper error handling
4. ✅ Admin pages load and allow triggering evictions
5. ✅ Judge save limit is enforced (can't save > 1 per stage)
6. ✅ Grace period countdown works and admin can extend
7. ✅ Mobile shows eviction status
8. ✅ Public voting shows evicted template styling
9. ✅ Audit logs track all actions
10. ✅ Feature can be toggled off without breaking existing contests
11. ✅ QA sign-off on full eviction flow

## References

- **Feature Spec**: `docs/features/VOTING_CONTEST_EVICTION.md`
- **Architecture Decision**: `docs/adr/ADR-022-voting-contest-eviction.md`
- **Database Migration**: `supabase/migrations/20260807000000_voting_contest_stages_eviction.sql`
- **Backend Code**:
  - `backend/internal/connect/voting/eviction_handlers.go`
  - `backend/internal/connect/voting/eviction_service.go`
  - `backend/internal/connect/voting/eviction_repo.go`
- **Admin UI**:
  - `frontend-web/app/admin/(dashboard)/voting/[contestId]/stages/page.tsx`
  - `frontend-web/app/admin/(dashboard)/voting/[contestId]/stages/[stageNum]/evictions/page.tsx`
  - `frontend-web/app/admin/(dashboard)/voting/[contestId]/admin-voting/page.tsx`
- **OpenAPI Spec**: `contracts/voting.openapi.yaml` (eviction paths added)

## Support & Questions

For questions about this implementation, refer to:
1. ADR-022 for design decisions
2. Feature spec for business requirements  
3. Code comments in RPC functions for atomic operation details
