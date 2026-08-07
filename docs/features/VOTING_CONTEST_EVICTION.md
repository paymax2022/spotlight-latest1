# Voting Contest Multi-Stage Eviction Feature

## Overview
This document describes the implementation of multi-stage voting contests with contestant eviction mechanics. Contestants in the bottom 20% by vote count are marked for eviction, with a grace period during which judges/admins can save them.

## Architecture

### Database Schema
New tables added via migration `20260807000000_voting_contest_stages_eviction.sql`:

- **contest_stages**: Defines stages within a contest
  - `stage_number`: 1, 2, 3, etc.
  - `eviction_percentage`: Bottom % to evict (default 20)
  - `voting_starts_at`, `voting_ends_at`: Optional stage timing
  
- **contestant_stage_assignments**: Tracks which stage each contestant is in
  - Links contestant to contest + stage number
  - Status: active, evicted, saved, advanced
  
- **contestant_evictions**: Immutable audit log of evictions
  - Records when eviction was triggered, by whom
  - Tracks grace period and resolution
  
- **judge_save_records**: Audit log of save actions
  - One judge can save one contestant per stage
  - Admins can save unlimited
  
- **contestant_eviction_visibility**: Template styling for evicted contestants
  - Tracks visual appearance: `normal`, `evicted`, `saved`

### RPC Functions
Four main RPC functions for atomic operations:

1. **evict_bottom_percentage()**
   - Marks bottom 20% (configurable) for eviction
   - Creates grace period window
   - Returns evicted contestants with vote counts

2. **save_contestant_from_eviction()**
   - Saves a contestant during grace period
   - Checks judge limits (one per stage)
   - Updates visibility template

3. **extend_eviction_grace_period()**
   - Admin-only action
   - Extends grace period by N hours
   - Tracks original end time

4. **finalize_stage_evictions()**
   - Called after grace period ends
   - Removes unsaved contestants from stage
   - Updates contestant assignments

### Backend (Go) Implementation

**File: backend/internal/connect/voting/**

1. **eviction_handlers.go** - HTTP handlers
   - `TriggerEvictions()` - POST /contests/{id}/stages/{stageNum}/evict
   - `SaveContestant()` - POST /contests/{id}/save
   - `ExtendGracePeriod()` - POST /contests/{id}/extend-grace-period
   - `FinalizeEvictions()` - POST /contests/{id}/stages/{stageNum}/finalize-evictions
   - `GetContestantsByStage()` - GET /contests/{id}/stages/{stageNum}/contestants
   - `GetEvictions()` - GET /contests/{id}/evictions
   - `AdminVote()` - POST /contests/{id}/admin-vote

2. **eviction_service.go** - Business logic
   - Orchestrates RPC calls
   - Handles audit logging
   - Validates permissions

3. **eviction_repo.go** - Database queries
   - Wraps RPC calls
   - Scans results into Go structs
   - Handles database errors

## Admin UI Implementation

### Pages to Create

**frontend-web/app/admin/voting/[contestId]/stages/**
- `page.tsx` - Main stages dashboard
  - List all stages
  - Configure eviction rules
  - View stage progression timeline

**frontend-web/app/admin/voting/[contestId]/stages/[stageNum]/eviction/**
- `page.tsx` - Eviction management
  - List pending evictions
  - Save/override buttons
  - Extend grace period
  - Finalize evictions when ready

**frontend-web/app/admin/voting/[contestId]/admin-voting/**
- `page.tsx` - Admin voting interface
  - Search contestants
  - Cast unlimited votes for any contestant
  - Vote summary and audit trail

### Key Features

1. **Stage Configuration**
   - Set eviction percentage per stage
   - Configure grace period duration
   - Set voting windows per stage

2. **Eviction Dashboard**
   - Real-time list of evicted contestants
   - Vote counts and rankings
   - Grace period countdown timer
   - Save buttons (with judge limitations)

3. **Grace Period Management**
   - Show current grace period end time
   - Admin button to extend period
   - Manual finalization option

## Mobile Implementation

### Updates to Voting Pages

**mobile-app/reactnative/app/(protected)/contest/[id]/contestants.tsx**
- Filter by stage
- Show eviction status in contestant cards
- Display different background template for evicted/saved contestants

**mobile-app/reactnative/app/(protected)/contest/[id]/vote-modal.tsx**
- Prevent votes on evicted contestants
- Show save status message
- Display grace period remaining

## Frontend Web Implementation

### Voting Page Updates

**frontend-web/app/voting/page.tsx** (or relevant voting component)
- Show stage information
- Display contestant cards with eviction status
- Apply CSS class based on template: `evicted`, `saved`, `normal`

### Styling

Add to CSS/Tailwind:
```css
/* Evicted contestant styling */
.contestant-card.evicted {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(75, 85, 99, 0.15));
  border: 2px dashed rgba(239, 68, 68, 0.5);
  opacity: 0.8;
}

.contestant-card.evicted::before {
  content: "EVICTED";
  position: absolute;
  top: 10px;
  right: 10px;
  background: #ef4444;
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: bold;
}

/* Saved contestant styling */
.contestant-card.saved {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(75, 85, 99, 0.1));
  border: 2px solid rgba(34, 197, 94, 0.3);
}

.contestant-card.saved::after {
  content: "SAVED";
  position: absolute;
  top: 10px;
  right: 10px;
  background: #22c55e;
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: bold;
}
```

## Feature Flag

Controlled by environment variable:
```bash
CONTEST_STAGE_EVICTION_ENABLED=true
```

Must be set in:
- `.env.local` (development)
- `.env.production` (production)
- Backend Go environment

## Implementation Checklist

### Phase 1: Database & Backend API ✅
- [x] Migration: schema + RPC functions
- [x] Go handlers
- [x] Go service methods
- [x] Go repo methods
- [x] OpenAPI spec updates
- [ ] Wire handlers to routes in main.go / router setup
- [ ] Add RBAC checks to handlers
- [ ] Integration tests for RPC functions
- [ ] Test atomic operations under concurrency

### Phase 2: Admin UI
- [ ] Create stages dashboard
- [ ] Create eviction management page
- [ ] Create admin voting interface
- [ ] Add form validations
- [ ] Add loading states and error handling
- [ ] Add real-time countdown timers
- [ ] Component tests

### Phase 3: Public Voting UI
- [ ] Update contestant cards to show eviction status
- [ ] Apply CSS templates
- [ ] Prevent voting on evicted contestants
- [ ] Show grace period message
- [ ] E2E tests

### Phase 4: Mobile UI
- [ ] Update contestant listing
- [ ] Update voting modal
- [ ] Add stage filtering
- [ ] Mobile tests

### Phase 5: QA & Documentation
- [ ] Write migration tests
- [ ] Write API integration tests
- [ ] Write UI component tests
- [ ] Write E2E tests for eviction flow
- [ ] Admin guide documentation
- [ ] Judge guide documentation

## Usage Examples

### Trigger Evictions (Admin)
```bash
POST /api/v1/connect/contests/{contestId}/stages/1/evict
{
  "stage_number": 1,
  "eviction_percentage": 20,
  "grace_period_hours": 24
}
```

### Save a Contestant (Judge)
```bash
POST /api/v1/connect/contests/{contestId}/save
{
  "eviction_id": "uuid-of-eviction",
  "reason": "Outstanding performance despite low votes"
}
```

### Extend Grace Period (Admin)
```bash
POST /api/v1/connect/contests/{contestId}/extend-grace-period
{
  "eviction_id": "uuid-of-eviction",
  "additional_hours": 24
}
```

### Finalize Evictions (Admin)
```bash
POST /api/v1/connect/contests/{contestId}/stages/1/finalize-evictions
```

### Admin Vote (Admin)
```bash
POST /api/v1/connect/contests/{contestId}/admin-vote
{
  "contestant_id": "uuid-of-contestant",
  "vote_quantity": 100
}
```

## Important Notes

1. **Atomicity**: All eviction operations are atomic at the database level using Postgres row-level locking and transactions via RPC functions.

2. **Audit Trail**: Every eviction and save action is recorded immutably in the database and audit logs.

3. **Judge Limits**: Judges can only save ONE contestant per stage. This is enforced by a UNIQUE constraint on (eviction_id, saved_by).

4. **Admin Privileges**: Admins can:
   - Trigger evictions
   - Save unlimited contestants
   - Extend grace periods
   - Cast unlimited votes
   - Finalize evictions

5. **Grace Period**: After eviction, there's a configurable grace period (default 24 hours) during which judges/admins can save contestants. After the grace period ends, evictions are finalized and contestants are removed from the stage.

6. **Visibility**: Evicted contestants remain visible to the public with a changed background template, allowing voting to continue during the grace period.

## Related ADRs

- [ADR-022: Voting Contest Eviction Mechanics](../adr/ADR-022-voting-contest-eviction.md)

## Monitoring & Alerts

Recommended metrics to track:
- Number of evictions triggered per contest
- Number of contestants saved vs finalized
- Grace period extensions (indicates close calls)
- Admin vote usage (prevent abuse)

## Future Enhancements

1. **Auto-Finalization**: Automatically finalize evictions after grace period without manual admin action
2. **Appeals Process**: Allow contestants to appeal evictions
3. **Conditional Eviction**: Support custom rules beyond bottom percentage
4. **Multi-Judge Voting**: Require multiple judges to agree on a save
5. **Eviction Notifications**: Send email/push notifications to evicted contestants
