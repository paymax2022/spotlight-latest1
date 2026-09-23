package connectvoting

// Live-DB tests for the contest promotion (parent/child hierarchy)
// maker-checker flow: RequestPromotion, ApprovePromotion, RejectPromotion, the
// parent_contest_id cycle-rejection trigger, and the connect_contests mirror
// carrying the 5 new hierarchy/partner/geography columns both directions.
//
// ⚠️ GATED ON TEST_DATABASE_URL, DELIBERATELY WITH NO FALLBACK TO DATABASE_URL
// (same convention as backend/internal/savings/list_balance_live_db_test.go —
// the root .env DATABASE_URL points at the production Supabase pooler).
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/connect/voting/ -run TestLiveDB_Promotion -v

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func newPromotionTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB contest promotion test")
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

// newPromotionTestAdmin creates a throwaway auth.users row (an "admin" for
// this test's purposes — RBAC is not exercised at this layer, only the
// service/repo maker-checker logic).
func newPromotionTestAdmin(t *testing.T, pool *pgxpool.Pool, tag string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
		id, "promotion-test-"+tag+"-"+id+"@example.invalid"); err != nil {
		t.Fatalf("seed auth.users %s: %v", tag, err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

// seedContest inserts a minimal public.contests row and registers cleanup.
// The forward bridge trigger (sync_connect_contest) mirrors it into
// connect_contests automatically.
func seedContest(t *testing.T, pool *pgxpool.Pool, name string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO contests (name, status) VALUES ($1, 'active'::contest_status) RETURNING id`,
		name).Scan(&id); err != nil {
		t.Fatalf("seed contest %q: %v", name, err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM contests WHERE id = $1`, id)
	})
	return id
}

// seedContestant inserts a contestants row under the given legacy contest id.
func seedContestant(t *testing.T, pool *pgxpool.Pool, contestID, name string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO contestants (name, category, bio, photo_url, contest_link, contest_id, status, is_active)
		 VALUES ($1, 'Music', 'bio', 'https://example.invalid/p.jpg', 'https://example.invalid', $2, 'approved'::contestant_status, true)
		 RETURNING id`,
		name, contestID).Scan(&id); err != nil {
		t.Fatalf("seed contestant %q: %v", name, err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM contestants WHERE id = $1`, id)
	})
	return id
}

// publishRoundResults creates a voting_rounds row for contestID already in
// status='results_published' plus voting_round_results ranking the given
// contestant ids in order (rank 1 = contestantIDs[0]).
func publishRoundResults(t *testing.T, pool *pgxpool.Pool, contestID string, contestantIDs []string) string {
	t.Helper()
	ctx := context.Background()
	var roundID string
	slug := "final-" + uuid.NewString()[:8]
	if err := pool.QueryRow(ctx,
		`INSERT INTO voting_rounds (contest_id, name, slug, status)
		 VALUES ($1, 'Final Round', $2, 'results_published') RETURNING id`,
		contestID, slug).Scan(&roundID); err != nil {
		t.Fatalf("seed voting_rounds: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM voting_rounds WHERE id = $1`, roundID)
	})

	for i, cid := range contestantIDs {
		rank := i + 1
		if _, err := pool.Exec(ctx,
			`INSERT INTO voting_round_results (round_id, contest_id, contestant_id, rank, total_confirmed_votes, paid_votes)
			 VALUES ($1, $2, $3, $4, $5, 0)`,
			roundID, contestID, cid, rank, (len(contestantIDs)-i)*10); err != nil {
			t.Fatalf("seed voting_round_results rank %d: %v", rank, err)
		}
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM voting_round_results WHERE round_id = $1`, roundID)
	})
	return roundID
}

func newPromotionTestService(pool *pgxpool.Pool) *Service {
	return NewService(NewRepository(pool), nil, nil, nil, nil)
}

// ─── Scenario 1: RequestPromotion ranks/selects top N from real results ──────

func TestLiveDB_Promotion_RequestPromotionSelectsTopN(t *testing.T) {
	pool := newPromotionTestPool(t)
	svc := newPromotionTestService(pool)
	ctx := context.Background()

	admin := newPromotionTestAdmin(t, pool, "requester")
	child := seedContest(t, pool, "Golibe Lagos Local "+uuid.NewString()[:8])
	parent := seedContest(t, pool, "Golibe National "+uuid.NewString()[:8])

	var contestantIDs []string
	for i := 0; i < 5; i++ {
		contestantIDs = append(contestantIDs, seedContestant(t, pool, child, fmt.Sprintf("Contestant %d %s", i+1, uuid.NewString()[:6])))
	}
	publishRoundResults(t, pool, child, contestantIDs)

	promos, err := svc.RequestPromotion(ctx, child, RequestPromotionRequest{ParentContestID: parent, TopN: 3}, admin)
	if err != nil {
		t.Fatalf("RequestPromotion: %v", err)
	}
	if len(promos) != 3 {
		t.Fatalf("expected 3 promotion rows for topN=3, got %d", len(promos))
	}
	for i, p := range promos {
		wantRank := i + 1
		if p.RankInChild != wantRank {
			t.Errorf("promotion[%d].RankInChild = %d, want %d", i, p.RankInChild, wantRank)
		}
		if p.ContestantID != contestantIDs[i] {
			t.Errorf("promotion[%d].ContestantID = %s, want %s (rank %d contestant)", i, p.ContestantID, contestantIDs[i], wantRank)
		}
		if p.Status != "pending" {
			t.Errorf("promotion[%d].Status = %s, want pending", i, p.Status)
		}
		if p.ChildContestID != child || p.ParentContestID != parent {
			t.Errorf("promotion[%d] child/parent mismatch: got (%s,%s) want (%s,%s)", i, p.ChildContestID, p.ParentContestID, child, parent)
		}
	}

	// The 4th/5th-ranked contestants must NOT have been selected.
	for _, p := range promos {
		if p.ContestantID == contestantIDs[3] || p.ContestantID == contestantIDs[4] {
			t.Errorf("rank-4/5 contestant %s was unexpectedly promoted", p.ContestantID)
		}
	}

	// A companion contest_admin_approvals row must exist for maker-checker
	// surfacing (task requirement: "check if an existing approvals UI/list
	// reads that table and if so make sure this surfaces there").
	var approvalCount int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM contest_admin_approvals WHERE action_type = 'contest_promotion' AND contest_id = $1`,
		child).Scan(&approvalCount); err != nil {
		t.Fatalf("query contest_admin_approvals: %v", err)
	}
	if approvalCount != 1 {
		t.Errorf("expected exactly 1 contest_admin_approvals row for this request, got %d", approvalCount)
	}

	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM contest_promotions WHERE child_contest_id = $1`, child)
		pool.Exec(ctx, `DELETE FROM contest_admin_approvals WHERE contest_id = $1`, child)
	})
}

// ─── Scenario 2: self-approval by the same admin is rejected ─────────────────

func TestLiveDB_Promotion_SelfApprovalRejected(t *testing.T) {
	pool := newPromotionTestPool(t)
	svc := newPromotionTestService(pool)
	ctx := context.Background()

	admin := newPromotionTestAdmin(t, pool, "self")
	child := seedContest(t, pool, "Golibe Self "+uuid.NewString()[:8])
	parent := seedContest(t, pool, "Golibe Self Parent "+uuid.NewString()[:8])
	c1 := seedContestant(t, pool, child, "Solo Contestant "+uuid.NewString()[:6])
	publishRoundResults(t, pool, child, []string{c1})
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM contest_promotions WHERE child_contest_id = $1`, child)
		pool.Exec(ctx, `DELETE FROM contest_admin_approvals WHERE contest_id = $1`, child)
	})

	promos, err := svc.RequestPromotion(ctx, child, RequestPromotionRequest{ParentContestID: parent, TopN: 1}, admin)
	if err != nil {
		t.Fatalf("RequestPromotion: %v", err)
	}
	if len(promos) != 1 {
		t.Fatalf("expected 1 promotion row, got %d", len(promos))
	}

	if _, err := svc.ApprovePromotion(ctx, promos[0].ID, admin); err == nil {
		t.Fatal("ApprovePromotion by the SAME admin who requested it should have been rejected, got nil error")
	} else if !isSelfApprovalErr(err) {
		t.Fatalf("ApprovePromotion self-approval: expected ErrPromotionSelfApproval, got: %v", err)
	}

	// Row must still be pending — a rejected approval attempt must not have
	// mutated it.
	got, err := svc.GetPromotion(ctx, promos[0].ID)
	if err != nil {
		t.Fatalf("GetPromotion after rejected self-approval: %v", err)
	}
	if got.Status != "pending" {
		t.Errorf("promotion status after rejected self-approval = %s, want pending", got.Status)
	}
}

func isSelfApprovalErr(err error) bool {
	return err == ErrPromotionSelfApproval
}

// ─── Scenario 3: approval creates a real new contestant row under the parent
// contest, with the audit trail correctly linked ─────────────────────────────

func TestLiveDB_Promotion_ApprovalCreatesParentContestant(t *testing.T) {
	pool := newPromotionTestPool(t)
	svc := newPromotionTestService(pool)
	ctx := context.Background()

	requester := newPromotionTestAdmin(t, pool, "approve-req")
	approver := newPromotionTestAdmin(t, pool, "approve-app")
	child := seedContest(t, pool, "Golibe Approve Child "+uuid.NewString()[:8])
	parent := seedContest(t, pool, "Golibe Approve Parent "+uuid.NewString()[:8])
	contestantName := "Winner " + uuid.NewString()[:8]
	c1 := seedContestant(t, pool, child, contestantName)
	publishRoundResults(t, pool, child, []string{c1})
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM contest_promotions WHERE child_contest_id = $1`, child)
		pool.Exec(ctx, `DELETE FROM contest_admin_approvals WHERE contest_id = $1`, child)
	})

	promos, err := svc.RequestPromotion(ctx, child, RequestPromotionRequest{ParentContestID: parent, TopN: 1}, requester)
	if err != nil {
		t.Fatalf("RequestPromotion: %v", err)
	}

	approved, err := svc.ApprovePromotion(ctx, promos[0].ID, approver)
	if err != nil {
		t.Fatalf("ApprovePromotion: %v", err)
	}
	if approved.Status != "executed" {
		t.Fatalf("approved promotion status = %s, want executed", approved.Status)
	}
	if approved.NewContestantID == nil {
		t.Fatal("approved promotion has no new_contestant_id")
	}
	if approved.ApprovedBy == nil || *approved.ApprovedBy != approver {
		t.Errorf("approved.ApprovedBy = %v, want %s", approved.ApprovedBy, approver)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM contestants WHERE id = $1`, *approved.NewContestantID)
	})

	// The real new contestant row must exist under the PARENT contest with
	// the child contestant's registration data copied across.
	var gotName, gotContestID string
	if err := pool.QueryRow(ctx,
		`SELECT name, contest_id::text FROM contestants WHERE id = $1`,
		*approved.NewContestantID).Scan(&gotName, &gotContestID); err != nil {
		t.Fatalf("query new parent contestant: %v", err)
	}
	if gotName != contestantName {
		t.Errorf("new contestant name = %q, want %q (copied from child registration)", gotName, contestantName)
	}
	if gotContestID != parent {
		t.Errorf("new contestant contest_id = %s, want parent contest %s", gotContestID, parent)
	}

	// Audit trail: the promotion row itself links child contestant -> new
	// parent contestant, and stays queryable end to end.
	fetched, err := svc.GetPromotion(ctx, promos[0].ID)
	if err != nil {
		t.Fatalf("GetPromotion after approval: %v", err)
	}
	if fetched.ContestantID != c1 {
		t.Errorf("fetched.ContestantID = %s, want original child contestant %s", fetched.ContestantID, c1)
	}
	if fetched.NewContestantID == nil || *fetched.NewContestantID != *approved.NewContestantID {
		t.Errorf("fetched.NewContestantID mismatch: %v vs %v", fetched.NewContestantID, approved.NewContestantID)
	}
}

// ─── Scenario 4: a cycle-forming parent_contest_id update is rejected by the
// DB trigger (arbitrary depth allowed, cycles rejected) ───────────────────────

func TestLiveDB_Promotion_CycleRejectedByTrigger(t *testing.T) {
	pool := newPromotionTestPool(t)
	ctx := context.Background()

	a := seedContest(t, pool, "Cycle A "+uuid.NewString()[:8])
	b := seedContest(t, pool, "Cycle B "+uuid.NewString()[:8])
	c := seedContest(t, pool, "Cycle C "+uuid.NewString()[:8])

	// Build a legitimate chain: C -> B -> A (arbitrary depth allowed).
	if _, err := pool.Exec(ctx, `UPDATE contests SET parent_contest_id = $1 WHERE id = $2`, a, b); err != nil {
		t.Fatalf("set B's parent to A: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE contests SET parent_contest_id = $1 WHERE id = $2`, b, c); err != nil {
		t.Fatalf("set C's parent to B: %v", err)
	}

	// Now try to close the loop: A's parent = C. A -> C -> B -> A is a cycle
	// and must be rejected by trg_contests_reject_parent_cycle.
	_, err := pool.Exec(ctx, `UPDATE contests SET parent_contest_id = $1 WHERE id = $2`, c, a)
	if err == nil {
		t.Fatal("expected the cycle-forming UPDATE (A's parent = C, closing A->C->B->A) to be rejected, got nil error")
	}
	t.Logf("cycle correctly rejected by DB trigger: %v", err)

	// Self-parenting is rejected too (the CHECK constraint).
	_, err = pool.Exec(ctx, `UPDATE contests SET parent_contest_id = $1 WHERE id = $2`, a, a)
	if err == nil {
		t.Fatal("expected self-parenting UPDATE to be rejected, got nil error")
	}
	t.Logf("self-parent correctly rejected by DB constraint: %v", err)
}

// ─── Scenario 5: connect_contests mirror carries the new columns BOTH
// directions (insert one side, read back other side) ──────────────────────────

func TestLiveDB_Promotion_ConnectContestsMirrorBothDirections(t *testing.T) {
	pool := newPromotionTestPool(t)
	ctx := context.Background()

	partnerID := ""
	if err := pool.QueryRow(ctx,
		`INSERT INTO contest_partners (name) VALUES ($1) RETURNING id`,
		"Golibe Partner "+uuid.NewString()[:8]).Scan(&partnerID); err != nil {
		t.Fatalf("seed contest_partners: %v", err)
	}
	t.Cleanup(func() {
		// Null out any stray references first (e.g. the mirrored
		// connect_contests row this test's legacy insert creates via the
		// forward bridge trigger, which this test does not separately track)
		// so the FK never blocks teardown regardless of insert order.
		pool.Exec(ctx, `UPDATE contests SET partner_id = NULL WHERE partner_id = $1`, partnerID)
		pool.Exec(ctx, `UPDATE connect_contests SET partner_id = NULL WHERE partner_id = $1`, partnerID)
		pool.Exec(ctx, `DELETE FROM contest_partners WHERE id = $1`, partnerID)
	})

	// Direction 1: legacy -> connect. Insert into public.contests with the
	// new columns set; sync_connect_contest() must carry them onto the
	// mirrored connect_contests row (forward, full-field, ongoing sync).
	parentLegacy := seedContest(t, pool, "Mirror Parent "+uuid.NewString()[:8])
	var childLegacyID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO contests (name, status, parent_contest_id, partner_id, state, lga, default_promote_top_n)
		 VALUES ($1, 'active'::contest_status, $2, $3, 'Lagos', 'Ikeja', 5)
		 RETURNING id`,
		"Mirror Child "+uuid.NewString()[:8], parentLegacy, partnerID).Scan(&childLegacyID); err != nil {
		t.Fatalf("seed legacy contest with hierarchy columns: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM contests WHERE id = $1`, childLegacyID) })

	var ccParentID, ccPartnerID, ccState, ccLGA string
	var ccTopN int
	if err := pool.QueryRow(ctx,
		`SELECT parent_contest_id::text, partner_id::text, state, lga, default_promote_top_n
		 FROM connect_contests WHERE id = $1`, childLegacyID).
		Scan(&ccParentID, &ccPartnerID, &ccState, &ccLGA, &ccTopN); err != nil {
		t.Fatalf("read back mirrored connect_contests row: %v", err)
	}
	if ccParentID != parentLegacy {
		t.Errorf("connect_contests.parent_contest_id = %s, want %s", ccParentID, parentLegacy)
	}
	if ccPartnerID != partnerID {
		t.Errorf("connect_contests.partner_id = %s, want %s", ccPartnerID, partnerID)
	}
	if ccState != "Lagos" || ccLGA != "Ikeja" {
		t.Errorf("connect_contests.state/lga = %s/%s, want Lagos/Ikeja", ccState, ccLGA)
	}
	if ccTopN != 5 {
		t.Errorf("connect_contests.default_promote_top_n = %d, want 5", ccTopN)
	}

	// Direction 2: connect -> legacy. Insert a BRAND NEW row directly into
	// connect_contests (simulating a connect-originated contest) with the new
	// columns set; mirror_connect_contest_to_legacy() (INSERT-ONLY, fires via
	// trg_mirror_connect_contest_to_legacy AFTER INSERT) must carry them into
	// the legacy row it creates. The parent must already have a connect twin
	// for the FK to resolve, which parentLegacy does (mirrored by direction 1
	// above, or by its own insert trigger).
	var parentConnectID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM connect_contests WHERE id = $1`, parentLegacy).Scan(&parentConnectID); err != nil {
		t.Fatalf("parent contest has no connect_contests twin: %v", err)
	}

	newConnectID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO connect_contests
		   (id, title, status, parent_contest_id, partner_id, state, lga, default_promote_top_n)
		 VALUES ($1, $2, 'open', $3, $4, 'Rivers', 'Port Harcourt', 3)`,
		newConnectID, "Connect-Origin Child "+uuid.NewString()[:8], parentConnectID, partnerID); err != nil {
		t.Fatalf("insert connect-originated connect_contests row: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM contests WHERE id = $1`, newConnectID)
		pool.Exec(ctx, `DELETE FROM connect_contests WHERE id = $1`, newConnectID)
	})

	// Give the AFTER INSERT trigger a moment (it runs synchronously within
	// the same statement/transaction in Postgres, so this is really just
	// reading the result — no real async wait is needed, but a tiny sleep
	// guards against any pooled-connection visibility surprise).
	time.Sleep(50 * time.Millisecond)

	var legacyParentID, legacyPartnerID, legacyState, legacyLGA string
	var legacyTopN int
	if err := pool.QueryRow(ctx,
		`SELECT parent_contest_id::text, partner_id::text, state, lga, default_promote_top_n
		 FROM contests WHERE id = $1`, newConnectID).
		Scan(&legacyParentID, &legacyPartnerID, &legacyState, &legacyLGA, &legacyTopN); err != nil {
		t.Fatalf("read back reverse-mirrored legacy contests row: %v", err)
	}
	if legacyParentID != parentLegacy {
		t.Errorf("legacy contests.parent_contest_id = %s, want %s", legacyParentID, parentLegacy)
	}
	if legacyPartnerID != partnerID {
		t.Errorf("legacy contests.partner_id = %s, want %s", legacyPartnerID, partnerID)
	}
	if legacyState != "Rivers" || legacyLGA != "Port Harcourt" {
		t.Errorf("legacy contests.state/lga = %s/%s, want Rivers/Port Harcourt", legacyState, legacyLGA)
	}
	if legacyTopN != 3 {
		t.Errorf("legacy contests.default_promote_top_n = %d, want 3", legacyTopN)
	}
}
