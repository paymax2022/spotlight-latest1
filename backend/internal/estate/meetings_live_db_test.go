package estate

// LIVE-DB UAT for the Estate module's meeting FSM (meetings.go — transitionMeeting,
// CancelMeeting, RescheduleMeeting) and the election concurrent-vote path
// (service.go — CastVote). Closes docs/qa/modules/estate.md ESTATE-FSM-009..013
// and ESTATE-CONC-002 — the last two remaining P0/P1 cases in the Estate UAT
// plan; everything else (money-path, authz, admin console, resident mobile
// journey) was live-tested and fixed in prior batches this session.
// Follows the exact conventions of service_dues_live_db_test.go /
// vendor_payout_live_db_test.go: TEST_DATABASE_URL-gated pgxpool via
// t.Cleanup, real seed data (estate + estate_admin + resident rows), package
// `estate` (not `estate_test`) so unexported helpers are reachable if needed.
// Run:
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/estate/... -run TestLiveDB_Meeting -v
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/estate/... -run TestLiveDB_Vote -v

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

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
	t.Cleanup(func() { _, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM estate_meetings WHERE id=$1`, id) })
	return id
}

func meetingStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, meetingID string) string {
	t.Helper()
	var s string
	if err := pool.QueryRow(context.WithoutCancel(ctx), `SELECT status FROM estate_meetings WHERE id=$1`, meetingID).Scan(&s); err != nil {
		t.Fatalf("meeting status: %v", err)
	}
	return s
}

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
	t.Cleanup(func() { _, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM elections WHERE id=$1`, electionID) })

	candidateID = uuid.New().String()
	if _, err := pool.Exec(context.WithoutCancel(ctx),
		`INSERT INTO election_candidates (id, election_id, name) VALUES ($1,$2,'Candidate A')`,
		candidateID, electionID); err != nil {
		t.Fatalf("seed candidate A: %v", err)
	}
	otherCandidateID := uuid.New().String()
	if _, err := pool.Exec(context.WithoutCancel(ctx),
		`INSERT INTO election_candidates (id, election_id, name) VALUES ($1,$2,'Candidate B')`,
		otherCandidateID, electionID); err != nil {
		t.Fatalf("seed candidate B: %v", err)
	}
	return electionID, candidateID
}

func voteCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, electionID, voterID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.WithoutCancel(ctx), `SELECT count(*) FROM election_votes WHERE election_id=$1 AND voter_id=$2`, electionID, voterID).Scan(&n); err != nil {
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
// UNIQUE(election_id, voter_id) constraint inside estate_cast_vote, which raises
// 23505 for the loser — so the DB constraint is the ONLY safety net actually
// exercised here, proving it alone is sufficient. Since ESTB-D003 the same run
// also proves the split holds under concurrency: one participation row with no
// choice column value, and one anonymous ballot carrying the choice.
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
	for i := range n {
		go func(i int) {
			defer wg.Done()
			votes[i], errs[i] = svc.CastVote(ctx, estateID, electionID, voter, CastVoteRequest{CandidateID: candidateID})
		}(i)
	}
	wg.Wait()

	var successes, failures int
	for i := range n {
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
	for i := range n {
		if errs[i] == nil {
			successVote = votes[i]
		}
	}
	if successVote == nil {
		t.Fatal("no successful vote returned")
	}

	// ESTB-D003: CastVote returns the anonymous ballot id, and the participation
	// row must carry no choice at all. Asserting candidate_id IS NULL here is the
	// executed proof that the voter→choice link is gone from the schema, not just
	// hidden by the API.
	var dbVoteID string
	var persistedCandidate *string
	if err := pool.QueryRow(ctx,
		`SELECT id, candidate_id FROM election_votes WHERE election_id=$1 AND voter_id=$2`, electionID, voter).
		Scan(&dbVoteID, &persistedCandidate); err != nil {
		t.Fatalf("read persisted participation row: %v", err)
	}
	if persistedCandidate != nil {
		t.Errorf("election_votes.candidate_id = %q, want NULL — the registry must not link a voter to a choice", *persistedCandidate)
	}
	if successVote.ID == dbVoteID {
		t.Errorf("returned ballot id %s equals the participation row id; CastVote must return the election_ballots id", successVote.ID)
	}
	var ballotCount int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM election_ballots WHERE id=$1 AND election_id=$2 AND candidate_id=$3`,
		successVote.ID, electionID, candidateID).Scan(&ballotCount); err != nil {
		t.Fatalf("read persisted ballot: %v", err)
	}
	if ballotCount != 1 {
		t.Fatalf("election_ballots row for the returned receipt = %d, want 1 (ballot must be stored, choice recorded anonymously)", ballotCount)
	}
	var ballotsForVoter int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM election_ballots WHERE election_id=$1`, electionID).Scan(&ballotsForVoter); err != nil {
		t.Fatalf("count ballots: %v", err)
	}
	if ballotsForVoter != 1 {
		t.Errorf("ballots cast = %d, want 1 (one participant produced exactly one ballot)", ballotsForVoter)
	}
}

// TestLiveDB_Vote_BallotCannotBeJoinedToVoter is the executed proof for
// EST-UAT-0213 / EST-UAT-0216 (ESTB-D003): after estate_cast_vote writes, no
// query available to the schema can recover which participant made which choice.
// It checks the three ways the link could survive — a voter column on the ballot
// table, a choice column left on the participation registry, and the timing
// channel (a cast_at on the ballot that matches a participation row exactly).
func TestLiveDB_Vote_BallotCannotBeJoinedToVoter(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	voter := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	seedResident(t, ctx, pool, estateID, voter, "resident")
	electionID, candidateID := seedOpenElection(t, ctx, pool, estateID, admin)

	if _, err := svc.CastVote(ctx, estateID, electionID, voter, CastVoteRequest{CandidateID: candidateID}); err != nil {
		t.Fatalf("CastVote: %v", err)
	}

	var voterCols int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM information_schema.columns
		WHERE table_schema='public' AND table_name='election_ballots'
		  AND (column_name ILIKE '%voter%' OR column_name ILIKE '%user%'
		       OR column_name ILIKE '%member%' OR column_name ILIKE '%identity%'
		       OR column_name ILIKE '%cast%' OR column_name ILIKE '%time%'
		       OR column_name ILIKE '%_at')`).
		Scan(&voterCols); err != nil {
		t.Fatalf("inspect ballot columns: %v", err)
	}
	if voterCols != 0 {
		t.Errorf("election_ballots exposes %d voter/timestamp-linking column(s); a secret ballot table may hold none", voterCols)
	}

	var linkedRows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM election_votes WHERE candidate_id IS NOT NULL`).Scan(&linkedRows); err != nil {
		t.Fatalf("inspect registry: %v", err)
	}
	if linkedRows != 0 {
		t.Errorf("election_votes rows still carrying a choice = %d, want 0 across the whole registry", linkedRows)
	}

	// The join that used to be trivially available: participation row -> ballot.
	var rejoinable int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM election_votes v
		JOIN election_ballots b ON b.election_id = v.election_id AND b.candidate_id = v.candidate_id
		WHERE v.election_id=$1`, electionID).Scan(&rejoinable); err != nil {
		t.Fatalf("attempt voter→choice rejoin: %v", err)
	}
	if rejoinable != 0 {
		t.Errorf("voter→choice rejoin returned %d rows; the split must make it return none", rejoinable)
	}

	// The choice is still counted — secrecy must not cost accuracy.
	results, err := svc.GetResults(ctx, estateID, electionID, voter)
	if err != nil {
		// GetResults gates on the election being closed/tallied; close it directly.
		if _, cerr := pool.Exec(ctx, `UPDATE elections SET status='closed' WHERE id=$1`, electionID); cerr != nil {
			t.Fatalf("close election: %v", cerr)
		}
		results, err = svc.GetResults(ctx, estateID, electionID, voter)
		if err != nil {
			t.Fatalf("GetResults: %v", err)
		}
	}
	var total int
	for _, c := range results {
		if c.ID == candidateID && c.Votes != 1 {
			t.Errorf("chosen candidate has %d votes, want 1", c.Votes)
		}
		total += c.Votes
	}
	if total != 1 {
		t.Errorf("tally total = %d, want 1 (one ballot cast, counted once)", total)
	}
}
