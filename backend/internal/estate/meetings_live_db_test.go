package estate

// ---------------------------------------------------------------------------
// LIVE-DB UAT for the Estate module's meeting FSM (meetings.go — transitionMeeting,
// CancelMeeting, RescheduleMeeting) and the election concurrent-vote path
// (service.go — CastVote). Closes docs/qa/modules/estate.md ESTATE-FSM-009..013
// and ESTATE-CONC-002 — the last two remaining P0/P1 cases in the Estate UAT
// plan; everything else (money-path, authz, admin console, resident mobile
// journey) was live-tested and fixed in prior batches this session.
//
// Follows the exact conventions of service_dues_live_db_test.go /
// vendor_payout_live_db_test.go: TEST_DATABASE_URL-gated pgxpool via
// t.Cleanup, real seed data (estate + estate_admin + resident rows), package
// `estate` (not `estate_test`) so unexported helpers are reachable if needed.
//
// Run:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/estate/... -run TestLiveDB_Meeting -v
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/estate/... -run TestLiveDB_Vote -v
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ── pool / service wiring ─────────────────────────────────────────────────

func estateMeetingsTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB estate meetings/election tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func newMeetingsTestService(pool *pgxpool.Pool) *Service {
	return NewService(pool, nil)
}

// seedMeeting inserts a meeting directly at a given status, bypassing
// CreateMeeting (whose own validation/authz is exercised elsewhere; here we
// need a known, deterministic starting FSM state).
func seedMeeting(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID, adminID, status string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO estate_meetings (id, estate_id, title, mode, starts_at, status, created_by)
		 VALUES ($1,$2,'FSM Test Meeting','physical', NOW()+interval '1 day', $3, $4)`,
		id, estateID, status, adminID); err != nil {
		t.Fatalf("seed meeting: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM estate_meetings WHERE id=$1`, id) })
	return id
}

func meetingStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, meetingID string) string {
	t.Helper()
	var s string
	if err := pool.QueryRow(ctx, `SELECT status FROM estate_meetings WHERE id=$1`, meetingID).Scan(&s); err != nil {
		t.Fatalf("meeting status: %v", err)
	}
	return s
}

// ── ESTATE-FSM-009 ───────────────────────────────────────────────────────────

func TestLiveDB_Meeting_StartMeeting_ScheduledToLive(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	meetingID := seedMeeting(t, ctx, pool, estateID, admin, "scheduled")

	if err := svc.StartMeeting(ctx, estateID, admin, meetingID); err != nil {
		t.Fatalf("StartMeeting: %v", err)
	}
	if got := meetingStatus(t, ctx, pool, meetingID); got != "live" {
		t.Errorf("meeting status = %q, want live", got)
	}
	if n := auditCount(t, ctx, pool, estateID, meetingID, "MEETING_START"); n != 1 {
		t.Errorf("MEETING_START audit rows = %d, want 1", n)
	}
}

// ── ESTATE-FSM-010 ───────────────────────────────────────────────────────────

func TestLiveDB_Meeting_EndMeeting_LiveToEnded(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	meetingID := seedMeeting(t, ctx, pool, estateID, admin, "live")

	if err := svc.EndMeeting(ctx, estateID, admin, meetingID); err != nil {
		t.Fatalf("EndMeeting: %v", err)
	}
	if got := meetingStatus(t, ctx, pool, meetingID); got != "ended" {
		t.Errorf("meeting status = %q, want ended", got)
	}
	if n := auditCount(t, ctx, pool, estateID, meetingID, "MEETING_END"); n != 1 {
		t.Errorf("MEETING_END audit rows = %d, want 1", n)
	}
}

// ── ESTATE-FSM-011 ───────────────────────────────────────────────────────────

func TestLiveDB_Meeting_CancelMeeting_FromScheduledOrLive(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)

	for _, from := range []string{"scheduled", "live"} {
		t.Run(from, func(t *testing.T) {
			meetingID := seedMeeting(t, ctx, pool, estateID, admin, from)
			if err := svc.CancelMeeting(ctx, estateID, admin, meetingID); err != nil {
				t.Fatalf("CancelMeeting from %s: %v", from, err)
			}
			if got := meetingStatus(t, ctx, pool, meetingID); got != "cancelled" {
				t.Errorf("meeting status = %q, want cancelled", got)
			}
			if n := auditCount(t, ctx, pool, estateID, meetingID, "MEETING_CANCEL"); n != 1 {
				t.Errorf("MEETING_CANCEL audit rows = %d, want 1", n)
			}
		})
	}
}

// ── ESTATE-FSM-012 ───────────────────────────────────────────────────────────

func TestLiveDB_Meeting_RescheduleMeeting_BackToScheduled(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)

	// "not ended/cancelled" covers scheduled and live starting states.
	for _, from := range []string{"scheduled", "live"} {
		t.Run(from, func(t *testing.T) {
			meetingID := seedMeeting(t, ctx, pool, estateID, admin, from)
			newStart := time.Now().Add(72 * time.Hour)
			m, err := svc.RescheduleMeeting(ctx, estateID, admin, meetingID, RescheduleMeetingRequest{
				StartsAt: newStart,
			})
			if err != nil {
				t.Fatalf("RescheduleMeeting from %s: %v", from, err)
			}
			if m.Status != "scheduled" {
				t.Errorf("returned meeting status = %q, want scheduled", m.Status)
			}
			if got := meetingStatus(t, ctx, pool, meetingID); got != "scheduled" {
				t.Errorf("meeting status = %q, want scheduled", got)
			}
			if n := auditCount(t, ctx, pool, estateID, meetingID, "MEETING_RESCHEDULE"); n != 1 {
				t.Errorf("MEETING_RESCHEDULE audit rows = %d, want 1", n)
			}
		})
	}
}

// ── ESTATE-FSM-013 ───────────────────────────────────────────────────────────

func TestLiveDB_Meeting_TerminalStates_RejectAllTransitions(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)

	for _, from := range []string{"ended", "cancelled"} {
		t.Run(from+"/StartMeeting", func(t *testing.T) {
			meetingID := seedMeeting(t, ctx, pool, estateID, admin, from)
			if err := svc.StartMeeting(ctx, estateID, admin, meetingID); err == nil {
				t.Fatal("expected StartMeeting to be rejected from a terminal state")
			}
			if got := meetingStatus(t, ctx, pool, meetingID); got != from {
				t.Errorf("meeting status changed to %q after rejected StartMeeting, want unchanged %q", got, from)
			}
		})
		t.Run(from+"/EndMeeting", func(t *testing.T) {
			meetingID := seedMeeting(t, ctx, pool, estateID, admin, from)
			if err := svc.EndMeeting(ctx, estateID, admin, meetingID); err == nil {
				t.Fatal("expected EndMeeting to be rejected from a terminal state")
			}
			if got := meetingStatus(t, ctx, pool, meetingID); got != from {
				t.Errorf("meeting status changed to %q after rejected EndMeeting, want unchanged %q", got, from)
			}
		})
		t.Run(from+"/RescheduleMeeting", func(t *testing.T) {
			meetingID := seedMeeting(t, ctx, pool, estateID, admin, from)
			_, err := svc.RescheduleMeeting(ctx, estateID, admin, meetingID, RescheduleMeetingRequest{
				StartsAt: time.Now().Add(48 * time.Hour),
			})
			if err == nil {
				t.Fatal("expected RescheduleMeeting to be rejected from a terminal state")
			}
			if got := meetingStatus(t, ctx, pool, meetingID); got != from {
				t.Errorf("meeting status changed to %q after rejected RescheduleMeeting, want unchanged %q", got, from)
			}
		})
	}

	// CancelMeeting from a terminal state is its own guard (status IN
	// ('scheduled','live')), tested separately since it shares no helper with
	// transitionMeeting.
	for _, from := range []string{"ended", "cancelled"} {
		t.Run(from+"/CancelMeeting", func(t *testing.T) {
			meetingID := seedMeeting(t, ctx, pool, estateID, admin, from)
			if err := svc.CancelMeeting(ctx, estateID, admin, meetingID); err == nil {
				t.Fatal("expected CancelMeeting to be rejected from a terminal state")
			}
			if got := meetingStatus(t, ctx, pool, meetingID); got != from {
				t.Errorf("meeting status changed to %q after rejected CancelMeeting, want unchanged %q", got, from)
			}
		})
	}
}

// ── ESTATE-CONC-002 ──────────────────────────────────────────────────────────

// seedOpenElection creates an election directly at status='open' with two
// candidates and no eligibility rules row (loadEligibilityRules' fast path:
// no rules configured -> everyone eligible), so CheckVoterEligibility never
// needs KYC/payment/resident-type wiring for this concurrency test.
func seedOpenElection(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID, adminID string) (electionID, candidateID string) {
	t.Helper()
	electionID = uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO elections (id, estate_id, title, starts_at, ends_at, status, created_by)
		 VALUES ($1,$2,'FSM Test Election', NOW()-interval '1 hour', NOW()+interval '1 hour', 'open', $3)`,
		electionID, estateID, adminID); err != nil {
		t.Fatalf("seed election: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM elections WHERE id=$1`, electionID) })

	candidateID = uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO election_candidates (id, election_id, name) VALUES ($1,$2,'Candidate A')`,
		candidateID, electionID); err != nil {
		t.Fatalf("seed candidate A: %v", err)
	}
	otherCandidateID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO election_candidates (id, election_id, name) VALUES ($1,$2,'Candidate B')`,
		otherCandidateID, electionID); err != nil {
		t.Fatalf("seed candidate B: %v", err)
	}
	return electionID, candidateID
}

func voteCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, electionID, voterID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM election_votes WHERE election_id=$1 AND voter_id=$2`, electionID, voterID).Scan(&n); err != nil {
		t.Fatalf("vote count: %v", err)
	}
	return n
}

// TestLiveDB_Vote_ConcurrentDuplicateVote_ResultsInOneBallot fires two
// GENUINELY concurrent CastVote calls (real goroutines + sync.WaitGroup) from
// the SAME eligible voter for an open election. Exactly one ballot must be
// recorded; the loser gets "already voted". This exercises both layers
// CastVote relies on: the Redlock (s.redis is nil in this test wiring, so the
// lock is a no-op per CastVote's own `if s.redis != nil` guard) and the
// UNIQUE(election_id, voter_id) DB constraint via
// `ON CONFLICT (election_id, voter_id) DO NOTHING ... RETURNING id` +
// pgx.ErrNoRows detection — which is therefore the ONLY safety net actually
// exercised here, proving the DB constraint alone is sufficient.
func TestLiveDB_Vote_ConcurrentDuplicateVote_ResultsInOneBallot(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	voter := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	seedResident(t, ctx, pool, estateID, voter, "resident")

	electionID, candidateID := seedOpenElection(t, ctx, pool, estateID, admin)

	const n = 2
	var wg sync.WaitGroup
	errs := make([]error, n)
	votes := make([]*Vote, n)
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			votes[i], errs[i] = svc.CastVote(ctx, estateID, electionID, voter, CastVoteRequest{CandidateID: candidateID})
		}(i)
	}
	wg.Wait()

	var successes, failures int
	for i := 0; i < n; i++ {
		if errs[i] == nil {
			successes++
		} else {
			failures++
			wantErr := "estate: you have already voted in this election"
			if errs[i].Error() != wantErr {
				t.Errorf("errs[%d] = %q, want %q", i, errs[i].Error(), wantErr)
			}
		}
	}
	if successes != 1 {
		t.Errorf("successful concurrent votes = %d, want exactly 1 (errs: %v)", successes, errs)
	}
	if failures != 1 {
		t.Errorf("failed concurrent votes = %d, want exactly 1", failures)
	}

	if got := voteCount(t, ctx, pool, electionID, voter); got != 1 {
		t.Fatalf("election_votes rows for voter = %d, want exactly 1 (UNIQUE(election_id,voter_id) must hold under real concurrency)", got)
	}

	var successVote *Vote
	for i := 0; i < n; i++ {
		if errs[i] == nil {
			successVote = votes[i]
		}
	}
	if successVote == nil {
		t.Fatal("no successful vote returned")
	}
	var dbVoteID string
	if err := pool.QueryRow(ctx, `SELECT id FROM election_votes WHERE election_id=$1 AND voter_id=$2`, electionID, voter).Scan(&dbVoteID); err != nil {
		t.Fatalf("read persisted vote: %v", err)
	}
	if successVote.ID != dbVoteID {
		t.Errorf("returned vote ID %s does not match persisted election_votes row id %s", successVote.ID, dbVoteID)
	}
}
