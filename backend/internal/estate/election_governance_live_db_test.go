package estate

// LIVE-DB UAT for election governance (election_governance.go) — Phase 2.2 of the estate-b
// close-out: rule approval and locking (EST-UAT-0203), electoral roll build / freeze /
// challenge (0204, 0208), mid-poll revocation and exceptions (0219), per-unit weighted
// ballots (0205), the nomination → accept → vet → certify chain (0209/0210/0211),
// abstention ballots (0221), quorum and tie-break verdicts (0223/0225), complaint and
// recount with a certification gate (0227), cancellation (0229) and informal polls (0230).
//
// Each test drives the real service against the schema created by
// supabase/migrations/20271099000020_estate_election_governance.sql, and each one finishes
// by re-checking the Phase 2.1 invariant governance must not disturb: no participation row
// may carry a choice, and the anonymous ballot table may gain no column that could name a
// voter.
//
// Run:
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/estate/... -run TestLiveDB_Governance -v

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// govSeed describes a seeded election in one place, so a test states the governance
// configuration it cares about instead of re-listing nine columns. Zero values take the
// conservative defaults: a binding, one-person-one-vote election with no quorum and no
// tie-break — exactly the shape elections had before Phase 2.2.
type govSeed struct {
	status      string // default 'draft'
	kind        string
	weighting   string
	quorumType  string
	quorumValue int
	tieBreak    string
}

func seedGovElection(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID, adminID string, cfg govSeed) string {
	t.Helper()
	set := func(v, def string) string {
		if v == "" {
			return def
		}
		return v
	}
	id := uuid.New().String()
	_, err := pool.Exec(ctx, `
		INSERT INTO elections (id, estate_id, title, starts_at, ends_at, status, created_by,
		                       kind, weighting, quorum_type, quorum_value, tie_break)
		VALUES ($1,$2,'Governance Test Election', NOW()-interval '1 hour', NOW()+interval '2 day', $3,$4,$5,$6,$7,$8,$9)`,
		id, estateID, set(cfg.status, "draft"), adminID,
		set(cfg.kind, ElectionKindBinding), set(cfg.weighting, WeightingOnePersonOneVote),
		set(cfg.quorumType, QuorumTypeNone), cfg.quorumValue, set(cfg.tieBreak, TieBreakNone))
	if err != nil {
		t.Fatalf("seed governance election: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM elections WHERE id=$1`, id)
	})
	return id
}

// seedGovCandidates inserts ballot lines in name order. Created order is what the
// earliest-candidate tie-break reads, so the inserts stay sequential and explicit.
func seedGovCandidates(t *testing.T, ctx context.Context, pool *pgxpool.Pool, electionID string, names ...string) []string {
	t.Helper()
	var ids []string
	for _, n := range names {
		id := uuid.New().String()
		if _, err := pool.Exec(context.WithoutCancel(ctx),
			`INSERT INTO election_candidates (id, election_id, name, bio) VALUES ($1,$2,$3,'Bio')`,
			id, electionID, n); err != nil {
			t.Fatalf("seed candidate %s: %v", n, err)
		}
		ids = append(ids, id)
	}
	return ids
}

// seedGovUnit gives a user a holding, which is what estate_cast_vote checks before it
// accepts a one_vote_per_unit ballot (EST-UAT-0205).
func seedGovUnit(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID, label, holder string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO estate_properties (id, estate_id, unit_label, landlord_id, tenant_id, occupancy_status)
		VALUES ($1,$2,$3,$4,$4,'occupied')`, id, estateID, label, holder); err != nil {
		t.Fatalf("seed unit %s: %v", label, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM estate_properties WHERE id=$1`, id)
	})
	return id
}

// seedGovResident adds a plain member and returns its user id.
func seedGovResident(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID string) string {
	t.Helper()
	userID := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, userID, "resident")
	return userID
}

// seedGovNamedResident is a member that also has the platform directory row every real
// account carries. Certification reads a candidate's name from public.platform_users, so
// this is the only way to exercise the nomination → ballot-line naming chain for what it
// is in production.
func seedGovNamedResident(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID, firstName, lastName string) string {
	t.Helper()
	userID := seedGovResident(t, ctx, pool, estateID)
	email := userID + "@seed.test"
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.platform_users (id, first_name, last_name, email, status)
		VALUES ($1,$2,$3,$4,'active')
		ON CONFLICT (id) DO UPDATE SET first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name`,
		userID, firstName, lastName, email); err != nil {
		t.Fatalf("seed platform_users: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM public.platform_users WHERE id=$1`, userID)
	})
	return userID
}

// govRollAndOpen is the governance path a post-Phase-2.2 election takes: build the roll,
// freeze (publish) it, then open through the service, which is itself EST-UAT-0202/0212.
func govRollAndOpen(t *testing.T, ctx context.Context, svc *Service, estateID, adminID, electionID string) *ElectionRoll {
	t.Helper()
	roll, err := svc.BuildElectionRoll(ctx, estateID, adminID, electionID)
	if err != nil {
		t.Fatalf("build roll: %v", err)
	}
	if _, err := svc.FreezeElectionRoll(ctx, estateID, adminID, electionID, roll.ID); err != nil {
		t.Fatalf("freeze roll: %v", err)
	}
	if _, err := svc.OpenElection(ctx, estateID, adminID, electionID); err != nil {
		t.Fatalf("open election: %v", err)
	}
	return roll
}

func mustGovVote(t *testing.T, svc *Service, ctx context.Context, estateID, electionID, voterID string, req CastVoteRequest) *Vote {
	t.Helper()
	v, err := svc.CastVote(ctx, estateID, electionID, voterID, req)
	if err != nil {
		t.Fatalf("CastVote(voter=%s, candidate=%q, unit=%q): %v", voterID, req.CandidateID, req.UnitID, err)
	}
	return v
}

// govVoteErr is the refusal form of the same call, so a test can assert WHY a ballot was
// rejected rather than only that it was.
func govVoteErr(svc *Service, ctx context.Context, estateID, electionID, voterID, candidateID, unitID string) error {
	_, err := svc.CastVote(ctx, estateID, electionID, voterID, CastVoteRequest{CandidateID: candidateID, UnitID: unitID})
	return err
}

// mustErr asserts a refusal happened and mentions want, so a test cannot pass on an
// unrelated error.
func mustErr(t *testing.T, err error, want, what string) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s: expected refusal, got success", what)
	}
	if !strings.Contains(err.Error(), want) {
		t.Fatalf("%s: error %q does not mention %q", what, err.Error(), want)
	}
}

func govStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, electionID string) string {
	t.Helper()
	var status string
	if err := pool.QueryRow(context.WithoutCancel(ctx), `SELECT status FROM elections WHERE id=$1`, electionID).Scan(&status); err != nil {
		t.Fatalf("read election status: %v", err)
	}
	return status
}

// assertNoVoterChoiceLink re-checks the Phase 2.1 secrecy invariant after governance has
// written through the new paths. Two independent checks: participation rows never carry a
// choice, and the ballot table has no column that could name a voter — the second is what
// makes the unlinkability structural rather than a habit the next feature can break.
func assertNoVoterChoiceLink(t *testing.T, ctx context.Context, pool *pgxpool.Pool, electionID string) {
	t.Helper()
	var linked int
	if err := pool.QueryRow(context.WithoutCancel(ctx),
		`SELECT COUNT(*) FROM election_votes WHERE election_id=$1 AND candidate_id IS NOT NULL`, electionID).
		Scan(&linked); err != nil {
		t.Fatalf("count linked participation rows: %v", err)
	}
	if linked != 0 {
		t.Errorf("%d participation rows carry a candidate_id; the ballot is no longer secret", linked)
	}
	var identifiable int
	if err := pool.QueryRow(context.WithoutCancel(ctx), `
		SELECT COUNT(*) FROM information_schema.columns
		WHERE table_schema='public' AND table_name='election_ballots'
		  AND (column_name LIKE '%voter%' OR column_name LIKE '%user%' OR column_name LIKE '%identity%')`).
		Scan(&identifiable); err != nil {
		t.Fatalf("inspect ballot table columns: %v", err)
	}
	if identifiable != 0 {
		t.Errorf("election_ballots has %d column(s) that could name a voter", identifiable)
	}
}

func govBallots(t *testing.T, ctx context.Context, pool *pgxpool.Pool, electionID string) (cast, abstained int) {
	t.Helper()
	if err := pool.QueryRow(context.WithoutCancel(ctx), `
		SELECT COUNT(*)::int, COUNT(*) FILTER (WHERE candidate_id IS NULL)::int
		FROM election_ballots WHERE election_id=$1`, electionID).Scan(&cast, &abstained); err != nil {
		t.Fatalf("ballot counts: %v", err)
	}
	return cast, abstained
}

// ---------------------------------------------------------------- 0203 rule approval

// An eligibility rule is a decision about who may vote, so it needs a second signature: a
// proposal changes nothing until it is approved, and approval is what locks the election.
func TestLiveDB_Governance_RuleApprovalAppliesAndLocks(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	voter := seedGovResident(t, ctx, pool, estateID)
	electionID := seedGovElection(t, ctx, pool, estateID, admin, govSeed{})

	if _, err := svc.ProposeElectionRules(ctx, estateID, admin, electionID, SetEligibilityRulesRequest{
		ResidentTypes: []string{"homeowner"},
	}); err != nil {
		t.Fatalf("propose rules: %v", err)
	}

	// A proposal alone changes nothing: until approval the rules in force are the old ones.
	if elig, err := svc.CheckVoterEligibility(ctx, estateID, electionID, voter); err != nil {
		t.Fatalf("eligibility before approval: %v", err)
	} else if !elig.Eligible {
		t.Errorf("a pending proposal already gated the voter: %v", elig.Reasons)
	}

	props, err := svc.ListElectionRuleProposals(ctx, estateID, admin, electionID)
	if err != nil || len(props) != 1 {
		t.Fatalf("list proposals: %v / %d rows", err, len(props))
	}
	if props[0].State != "pending" {
		t.Errorf("new proposal state = %q, want pending", props[0].State)
	}
	if _, err := svc.DecideElectionRules(ctx, estateID, admin, electionID, uuid.New().String(), true, "not this one"); err == nil {
		t.Error("a proposal that does not exist was approved")
	}

	rules, err := svc.DecideElectionRules(ctx, estateID, admin, electionID, props[0].ID, true, "AGM committee rules")
	if err != nil {
		t.Fatalf("approve rules: %v", err)
	}
	if len(rules.ResidentTypes) != 1 || rules.ResidentTypes[0] != "homeowner" {
		t.Errorf("approved rules came back %+v", rules)
	}

	// Approval is the lock: the election records it, and the in-force row is versioned.
	var locked bool
	var version int
	if err := pool.QueryRow(ctx, `
		SELECT e.rules_locked_at IS NOT NULL, COALESCE(r.rule_version,0)
		FROM elections e LEFT JOIN election_eligibility_rules r ON r.election_id = e.id
		WHERE e.id=$1`, electionID).Scan(&locked, &version); err != nil {
		t.Fatalf("read lock state: %v", err)
	}
	if !locked {
		t.Error("approving rules did not lock the election")
	}
	if version != 1 {
		t.Errorf("rule_version = %d after the first approval, want 1", version)
	}

	_, err = svc.SetEligibilityRules(ctx, estateID, admin, electionID, SetEligibilityRulesRequest{
		ResidentTypes: []string{"tenant"},
	})
	mustErr(t, err, "locked", "the direct setter overwrote approved rules")
	_, err = svc.ProposeElectionRules(ctx, estateID, admin, electionID, SetEligibilityRulesRequest{})
	mustErr(t, err, "locked", "a second proposal after the rules were locked")
	_, err = svc.DecideElectionRules(ctx, estateID, admin, electionID, props[0].ID, true, "approved twice")
	mustErr(t, err, "already", "re-approving one proposal")

	// And the approved rules now bite: a member with no homeowner profile is blocked, and
	// the block reaches the ballot rather than only the eligibility read.
	if elig, err := svc.CheckVoterEligibility(ctx, estateID, electionID, voter); err != nil {
		t.Fatalf("eligibility after approval: %v", err)
	} else if elig.Eligible || !slices.Contains(elig.Reasons, ReasonResidentTypeError) {
		t.Errorf("approved rules were not enforced at eligibility time: %+v", elig)
	}

	// A rejected proposal applies nothing and locks nothing.
	other := seedGovElection(t, ctx, pool, estateID, admin, govSeed{})
	p2, err := svc.ProposeElectionRules(ctx, estateID, admin, other, SetEligibilityRulesRequest{RequirePayment: true})
	if err != nil {
		t.Fatalf("propose on a second election: %v", err)
	}
	if _, err := svc.DecideElectionRules(ctx, estateID, admin, other, p2.ID, false, "too harsh for a first poll"); err != nil {
		t.Fatalf("reject proposal: %v", err)
	}
	var stillUnlocked bool
	var ruleRows int
	if err := pool.QueryRow(ctx, `SELECT rules_locked_at IS NULL FROM elections WHERE id=$1`, other).Scan(&stillUnlocked); err != nil {
		t.Fatalf("read lock flag: %v", err)
	}
	if !stillUnlocked {
		t.Error("rejecting a proposal locked the election")
	}
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM election_eligibility_rules WHERE election_id=$1`, other).Scan(&ruleRows); err != nil {
		t.Fatalf("count rule rows: %v", err)
	}
	if ruleRows != 0 {
		t.Errorf("a rejected proposal wrote %d rule row(s)", ruleRows)
	}
	// Rejection is final for that proposal, but it does not lock the franchise away: the
	// admin can propose again on the same unlocked election.
	if _, err := svc.ProposeElectionRules(ctx, estateID, admin, other, SetEligibilityRulesRequest{RequireKYC: true}); err != nil {
		t.Errorf("a rejected proposal left the election unable to propose again: %v", err)
	}
	assertNoVoterChoiceLink(t, ctx, pool, electionID)
}

// ---------------------------------------------------------------- 0204/0208/0219 roll

// A published roll is only worth publishing if it binds the ballot — including after the
// ballot is already under way.
func TestLiveDB_Governance_RollBuildFreezeChallengeRevokesMidPoll(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	voter := seedGovResident(t, ctx, pool, estateID)
	challenger := seedGovResident(t, ctx, pool, estateID)
	revoked := seedGovResident(t, ctx, pool, estateID)
	outsider := seedDuesUser(t, ctx, pool)
	electionID := seedGovElection(t, ctx, pool, estateID, admin, govSeed{})
	cands := seedGovCandidates(t, ctx, pool, electionID, "Ada", "Bola")

	roll := govRollAndOpen(t, ctx, svc, estateID, admin, electionID)
	// The roll is the estate's membership at the moment of publication, admin included.
	if roll.EligibleCount != 4 {
		t.Errorf("roll eligible = %d, want 4 (admin + 3 members)", roll.EligibleCount)
	}
	entries, err := svc.ListElectionRoll(ctx, estateID, admin, electionID, 0)
	if err != nil || len(entries) != 4 {
		t.Fatalf("list roll: %v / %d entries", err, len(entries))
	}
	for _, e := range entries {
		if e.Source != "built" || e.Status != "active" || e.Weight != 1 {
			t.Errorf("built roll entry came back %+v", e)
		}
	}
	if _, err := svc.ListElectionRoll(ctx, estateID, voter, electionID, 0); err == nil {
		t.Error("a non-admin read the published roll")
	}
	// A frozen roll cannot be frozen twice, and the election cannot be opened again.
	if _, err := svc.FreezeElectionRoll(ctx, estateID, admin, electionID, roll.ID); err == nil {
		t.Error("a frozen roll was frozen again")
	}
	if _, err := svc.OpenElection(ctx, estateID, admin, electionID); err == nil {
		t.Error("an open election was opened again")
	}
	// Rebuilding is a draft-only act once a version exists.
	if _, err := svc.BuildElectionRoll(ctx, estateID, admin, electionID); err == nil {
		t.Error("the roll was rebuilt after the election opened")
	}

	mustGovVote(t, svc, ctx, estateID, electionID, voter, CastVoteRequest{CandidateID: cands[0]})

	ch, err := svc.ChallengeRollEntry(ctx, estateID, challenger, electionID, revoked, "this member has left the estate")
	if err != nil {
		t.Fatalf("challenge roll entry: %v", err)
	}
	if ch.State != "open" || ch.SubjectUserID != revoked || ch.RollID != roll.ID {
		t.Errorf("new challenge came back %+v", ch)
	}
	_, err = svc.ChallengeRollEntry(ctx, estateID, challenger, electionID, revoked, "a repeated objection")
	mustErr(t, err, "already", "a duplicate open challenge")
	_, err = svc.ChallengeRollEntry(ctx, estateID, challenger, electionID, uuid.New().String(), "not a listed voter")
	mustErr(t, err, "not on this roll", "a challenge against a user who is not listed")
	_, err = svc.ChallengeRollEntry(ctx, estateID, challenger, electionID, revoked, "nope")
	mustErr(t, err, "5 characters", "a challenge without a usable reason")
	_, err = svc.ChallengeRollEntry(ctx, estateID, outsider, electionID, revoked, "an outsider objects")
	mustErr(t, err, "not a member", "a challenge by a non-member")
	list, err := svc.ListRollChallenges(ctx, estateID, admin, electionID)
	if err != nil || len(list) != 1 {
		t.Fatalf("list challenges: %v / %d", err, len(list))
	}
	if _, err := svc.ListRollChallenges(ctx, estateID, voter, electionID); err == nil {
		t.Error("a non-admin listed the roll challenges")
	}

	// Rejected: the objection fails, so the challenged member keeps the franchise they
	// already used, and the decision is not re-litigable.
	if _, err := svc.ResolveRollChallenge(ctx, estateID, admin, ch.ID, false, "membership confirmed"); err != nil {
		t.Fatalf("reject challenge: %v", err)
	}
	_, err = svc.ResolveRollChallenge(ctx, estateID, admin, ch.ID, true, "a second decision")
	mustErr(t, err, "already", "re-resolving a decided challenge")
	if got := govStatus(t, ctx, pool, electionID); got != "open" {
		t.Errorf("a rejected challenge changed the election status to %q", got)
	}
	mustGovVote(t, svc, ctx, estateID, electionID, revoked, CastVoteRequest{CandidateID: cands[1]})

	// Upheld: revocation takes effect on the very next ballot, because estate_cast_vote
	// re-reads the frozen roll every time (0219). The ballot revoked member already cast is
	// untouched — retracting it would require knowing whose it was.
	ch2, err := svc.ChallengeRollEntry(ctx, estateID, challenger, electionID, revoked, "lease ended last month")
	if err != nil {
		t.Fatalf("second challenge: %v", err)
	}
	if _, err := svc.ResolveRollChallenge(ctx, estateID, admin, ch2.ID, true, "upheld: lease ended"); err != nil {
		t.Fatalf("uphold challenge: %v", err)
	}
	if elig, err := svc.EligibilityOnRoll(ctx, estateID, electionID, revoked); err != nil {
		t.Fatalf("eligibility after revocation: %v", err)
	} else if elig.Eligible || !slices.Contains(elig.Reasons, ReasonNotOnRoll) {
		t.Errorf("a revoked member still reports eligible: %+v", elig)
	}
	mustErr(t, govVoteErr(svc, ctx, estateID, electionID, revoked, cands[0], ""), ReasonNotOnRoll,
		"a revoked member's ballot")

	// The same predicate the DB applies: someone who joined after publication has no right
	// to this ballot either, until the roll says otherwise.
	latecomer := seedGovResident(t, ctx, pool, estateID)
	mustErr(t, govVoteErr(svc, ctx, estateID, electionID, latecomer, cands[0], ""), ReasonNotOnRoll,
		"a member added after the roll was frozen")

	var removed int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM election_roll_entries WHERE roll_id=$1 AND status='removed'`, roll.ID).Scan(&removed); err != nil {
		t.Fatalf("count removed entries: %v", err)
	}
	if removed != 1 {
		t.Errorf("removed roll entries = %d, want 1", removed)
	}
	assertNoVoterChoiceLink(t, ctx, pool, electionID)
}

// A removal without a challenge is the admin-side half of the same franchise right, and
// the exception path is how a member the snapshot missed is restored — audited, because a
// roll that can be edited silently is not a published roll.
func TestLiveDB_Governance_RollRemovalAndException(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	member := seedGovResident(t, ctx, pool, estateID)
	removedUser := seedGovResident(t, ctx, pool, estateID)
	electionID := seedGovElection(t, ctx, pool, estateID, admin, govSeed{})
	cands := seedGovCandidates(t, ctx, pool, electionID, "Ada", "Bola")
	roll := govRollAndOpen(t, ctx, svc, estateID, admin, electionID)

	mustGovVote(t, svc, ctx, estateID, electionID, member, CastVoteRequest{CandidateID: cands[0]})

	_, err := svc.RemoveRollEntry(ctx, estateID, admin, electionID, removedUser, "why")
	mustErr(t, err, "5 characters", "a removal without a reason")
	if _, err := svc.RemoveRollEntry(ctx, estateID, member, electionID, removedUser, "a member cannot revoke"); err == nil {
		t.Error("a non-admin removed a voter from the roll")
	}
	if _, err := svc.RemoveRollEntry(ctx, estateID, admin, electionID, removedUser, "dual membership detected"); err != nil {
		t.Fatalf("remove roll entry: %v", err)
	}
	_, err = svc.RemoveRollEntry(ctx, estateID, admin, electionID, removedUser, "removed twice")
	mustErr(t, err, "not an active entry", "a double removal")
	mustErr(t, govVoteErr(svc, ctx, estateID, electionID, removedUser, cands[1], ""), ReasonNotOnRoll,
		"a removed member's ballot")
	if got := govStatus(t, ctx, pool, electionID); got != "open" {
		t.Errorf("the election left %q mid-poll after a removal", got)
	}

	// The exception path re-admits someone the snapshot never had.
	outsider := seedGovResident(t, ctx, pool, estateID)
	mustErr(t, govVoteErr(svc, ctx, estateID, electionID, outsider, cands[0], ""), ReasonNotOnRoll,
		"an unlisted member's ballot")
	_, err = svc.AddRollException(ctx, estateID, admin, electionID, outsider, "co")
	mustErr(t, err, "5 characters", "an exception without a reason")
	if _, err := svc.AddRollException(ctx, estateID, admin, electionID, uuid.New().String(), "an outsider cannot be co-opted"); err == nil {
		t.Error("an exception admitted someone who is not a member of this estate")
	}
	if _, err := svc.AddRollException(ctx, estateID, admin, electionID, outsider, "committee seat by co-option"); err != nil {
		t.Fatalf("add roll exception: %v", err)
	}
	mustGovVote(t, svc, ctx, estateID, electionID, outsider, CastVoteRequest{CandidateID: cands[0]})

	var exceptions int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM election_roll_entries WHERE roll_id=$1 AND source='exception'`, roll.ID).Scan(&exceptions); err != nil {
		t.Fatalf("count exception entries: %v", err)
	}
	if exceptions != 1 {
		t.Errorf("exception entries = %d, want 1", exceptions)
	}
	// A published roll that gains and loses voters must still publish the right denominator.
	after, err := svc.currentRoll(ctx, electionID)
	if err != nil {
		t.Fatalf("current roll: %v", err)
	}
	if after.EligibleCount != 3 {
		t.Errorf("frozen roll eligible_count = %d after one removal and one exception, want 3 (admin, member, co-opted)", after.EligibleCount)
	}
	assertNoVoterChoiceLink(t, ctx, pool, electionID)
}

// An election with no frozen roll constrains nothing — the shape every election created
// before Phase 2.2 keeps, so the governance build cannot retroactively lock anyone out.
func TestLiveDB_Governance_UnfrozenRollDoesNotGate(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	voter := seedGovResident(t, ctx, pool, estateID)
	electionID := seedGovElection(t, ctx, pool, estateID, admin, govSeed{})
	cands := seedGovCandidates(t, ctx, pool, electionID, "Ada", "Bola")

	if _, err := svc.BuildElectionRoll(ctx, estateID, admin, electionID); err != nil {
		t.Fatalf("build draft roll: %v", err)
	}
	// A draft roll is a working document. Open the election the way the pre-governance path
	// did (a direct status write) and show the ballot is still unconstrained.
	if _, err := pool.Exec(ctx, `UPDATE elections SET status='open' WHERE id=$1`, electionID); err != nil {
		t.Fatalf("open the legacy way: %v", err)
	}
	mustGovVote(t, svc, ctx, estateID, electionID, voter, CastVoteRequest{CandidateID: cands[0]})
	if elig, err := svc.EligibilityOnRoll(ctx, estateID, electionID, voter); err != nil || !elig.Eligible {
		t.Fatalf("eligibility with only a draft roll: %+v err=%v", elig, err)
	}
	// The draft is not the published version yet, so it lists nothing as frozen.
	if _, err := svc.currentRoll(ctx, electionID); err != nil {
		t.Fatalf("current roll: %v", err)
	}
	// Freezing it now makes the roll authoritative for the next ballot.
	roll, err := svc.currentRoll(ctx, electionID)
	if err != nil {
		t.Fatalf("current roll after build: %v", err)
	}
	if roll.Status != "draft" {
		t.Fatalf("built roll status = %q, want draft", roll.Status)
	}
	if _, err := svc.FreezeElectionRoll(ctx, estateID, admin, electionID, roll.ID); err != nil {
		t.Fatalf("freeze roll: %v", err)
	}
	stranger := seedGovResident(t, ctx, pool, estateID)
	mustErr(t, govVoteErr(svc, ctx, estateID, electionID, stranger, cands[1], ""), ReasonNotOnRoll,
		"an unlisted voter after the freeze")
	// The freeze does not undo the ballot already cast.
	if cast, _ := govBallots(t, ctx, pool, electionID); cast != 1 {
		t.Errorf("ballots after the freeze = %d, want the 1 already cast", cast)
	}
	assertNoVoterChoiceLink(t, ctx, pool, electionID)
}

// ---------------------------------------------------------------- 0205 weighting

// One person one vote is the default; a landlord election counts a ballot for each holding.
// The unit is not a hint — it is what authorises the ballot, and it is checked in the
// statement that writes.
func TestLiveDB_Governance_PerUnitWeighting(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	owner := seedGovResident(t, ctx, pool, estateID)
	flatA := seedGovUnit(t, ctx, pool, estateID, "A-01", owner)
	flatB := seedGovUnit(t, ctx, pool, estateID, "A-02", owner)
	foreign := seedGovUnit(t, ctx, pool, estateID, "Z-99", admin)

	electionID := seedGovElection(t, ctx, pool, estateID, admin, govSeed{weighting: WeightingOneVotePerUnit})
	cands := seedGovCandidates(t, ctx, pool, electionID, "Ada", "Bola")
	roll, err := svc.BuildElectionRoll(ctx, estateID, admin, electionID)
	if err != nil {
		t.Fatalf("build roll: %v", err)
	}
	// The denominator a weighted election measures turnout against is ballots, not people.
	if roll.TotalBallots != 3 || roll.EligibleCount != 2 {
		t.Errorf("roll came back %d ballots across %d voters, want 3 across 2", roll.TotalBallots, roll.EligibleCount)
	}
	// Weighting is a constitutional choice, not a mid-poll knob: once a roll exists it must
	// be rebuilt, which is impossible after publication.
	_, err = svc.UpdateElectionConfig(ctx, estateID, admin, electionID, ElectionConfigRequest{
		Weighting: WeightingOnePersonOneVote,
	})
	mustErr(t, err, "rebuild it", "a weighting change with a roll present")

	if _, err := svc.FreezeElectionRoll(ctx, estateID, admin, electionID, roll.ID); err != nil {
		t.Fatalf("freeze roll: %v", err)
	}
	if _, err := svc.OpenElection(ctx, estateID, admin, electionID); err != nil {
		t.Fatalf("open election: %v", err)
	}

	mustErr(t, govVoteErr(svc, ctx, estateID, electionID, owner, cands[0], ""), "does not match",
		"a weighted ballot with no unit")
	mustErr(t, govVoteErr(svc, ctx, estateID, electionID, owner, cands[0], foreign), "does not match",
		"a ballot for a unit the voter does not hold")
	// A foreign candidate is still refused in a weighted election, on its own code.
	other := seedGovElection(t, ctx, pool, estateID, admin, govSeed{weighting: WeightingOneVotePerUnit, status: "open"})
	seedGovCandidates(t, ctx, pool, other, "Cand A")
	mustErr(t, govVoteErr(svc, ctx, estateID, other, owner, cands[0], ""), "invalid candidate",
		"a ballot carrying another election's candidate")

	mustGovVote(t, svc, ctx, estateID, electionID, owner, CastVoteRequest{CandidateID: cands[0], UnitID: flatA})
	mustGovVote(t, svc, ctx, estateID, electionID, owner, CastVoteRequest{CandidateID: cands[1], UnitID: flatB})
	mustErr(t, govVoteErr(svc, ctx, estateID, electionID, owner, cands[0], flatA), "already voted",
		"a second ballot for one unit")

	var parts int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM election_votes WHERE election_id=$1 AND voter_id=$2`, electionID, owner).Scan(&parts); err != nil {
		t.Fatalf("participation count: %v", err)
	}
	if parts != 2 {
		t.Errorf("the multi-unit holder has %d participation rows, want 2 (one per held unit)", parts)
	}
	if cast, abstained := govBallots(t, ctx, pool, electionID); cast != 2 || abstained != 0 {
		t.Errorf("ballots = %d (abstentions %d), want 2 (0)", cast, abstained)
	}
	// Every participation row carries its unit, and no participation row carries a choice.
	var unitless int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM election_votes WHERE election_id=$1 AND unit_id IS NULL`, electionID).Scan(&unitless); err != nil {
		t.Fatalf("count unitless participation rows: %v", err)
	}
	if unitless != 0 {
		t.Errorf("%d weighted participation row(s) have no authorising unit", unitless)
	}

	// The plain shape still refuses a unit-bearing ballot outright, and accepts a plain one.
	single := seedGovElection(t, ctx, pool, estateID, admin, govSeed{status: "open"})
	singleCands := seedGovCandidates(t, ctx, pool, single, "Ada", "Bola")
	mustErr(t, govVoteErr(svc, ctx, estateID, single, owner, singleCands[0], flatA), "does not match",
		"a unit-bearing ballot in a one-person-one-vote election")
	mustGovVote(t, svc, ctx, estateID, single, owner, CastVoteRequest{CandidateID: singleCands[0]})
	// A second unit for the same voter is a second ballot, but never a second vote for the
	// same person in an unweighted election.
	mustErr(t, govVoteErr(svc, ctx, estateID, single, owner, singleCands[1], ""), "already voted",
		"a second ballot in a one-person-one-vote election")
	assertNoVoterChoiceLink(t, ctx, pool, electionID)
	assertNoVoterChoiceLink(t, ctx, pool, single)
}

// ---------------------------------------------------------------- 0221 abstention

// "None of the above" is a ballot, not a non-vote: it consumes the voter's one ballot and
// it counts towards turnout, but it credits nobody.
func TestLiveDB_Governance_AbstentionCountsInTurnoutOnly(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	voter := seedGovResident(t, ctx, pool, estateID)
	supporter := seedGovResident(t, ctx, pool, estateID)
	electionID := seedGovElection(t, ctx, pool, estateID, admin, govSeed{status: "open"})
	cands := seedGovCandidates(t, ctx, pool, electionID, "Ada", "Bola")

	v := mustGovVote(t, svc, ctx, estateID, electionID, voter, CastVoteRequest{})
	if !v.Abstained || v.CandidateID != "" {
		t.Errorf("abstention receipt came back %+v", v)
	}
	mustGovVote(t, svc, ctx, estateID, electionID, supporter, CastVoteRequest{CandidateID: cands[0]})
	cast, abstained := govBallots(t, ctx, pool, electionID)
	if cast != 2 || abstained != 1 {
		t.Errorf("ballots = %d (abstentions %d), want 2 (1)", cast, abstained)
	}
	// The abstention is a participation row, so it consumes the voter's one ballot.
	mustErr(t, govVoteErr(svc, ctx, estateID, electionID, voter, cands[0], ""), "already voted",
		"a replay after abstaining")

	if _, err := svc.CloseElection(ctx, estateID, admin, electionID); err != nil {
		t.Fatalf("close: %v", err)
	}
	results, err := svc.GetResults(ctx, estateID, electionID, admin)
	if err != nil {
		t.Fatalf("results after abstention: %v", err)
	}
	for _, c := range results {
		if c.Name == "Bola" && c.Votes != 0 {
			t.Errorf("an abstention was credited to %s (%d votes)", c.Name, c.Votes)
		}
	}
	out, err := svc.GetOutcome(ctx, estateID, electionID, voter)
	if err != nil {
		t.Fatalf("outcome: %v", err)
	}
	if out.BallotsCast != 2 || out.Abstentions != 1 || out.VotersCast != 2 {
		t.Errorf("outcome participation came back %+v", out)
	}
	// A single abstention in an otherwise empty ballot decides nothing and credits nobody.
	if out.Results[0].Votes+out.Results[1].Votes != 1 {
		t.Errorf("the only chosen candidate shows %d votes, want 1 (%+v)", out.Results[0].Votes+out.Results[1].Votes, out.Results)
	}
	if _, err := svc.TallyElection(ctx, estateID, admin, electionID); err != nil {
		t.Fatalf("certify a ballot with real support: %v", err)
	}

	// An all-abstention ballot is not a tie between zero-support candidates either.
	empty := seedGovElection(t, ctx, pool, estateID, admin, govSeed{status: "open"})
	seedGovCandidates(t, ctx, pool, empty, "Ada", "Bola")
	abstainer := seedGovResident(t, ctx, pool, estateID)
	mustGovVote(t, svc, ctx, estateID, empty, abstainer, CastVoteRequest{})
	if _, err := svc.CloseElection(ctx, estateID, admin, empty); err != nil {
		t.Fatalf("close the all-abstention ballot: %v", err)
	}
	emptyOut, err := svc.GetOutcome(ctx, estateID, empty, abstainer)
	if err != nil {
		t.Fatalf("all-abstention outcome: %v", err)
	}
	if emptyOut.Verdict != "no_ballots" || len(emptyOut.WinnerIDs) != 0 || emptyOut.TopVotes != 0 {
		t.Errorf("an all-abstention ballot came back %+v", emptyOut)
	}
	if emptyOut.BallotsCast != 1 || emptyOut.Abstentions != 1 {
		t.Errorf("the abstention did not register as a ballot: %+v", emptyOut)
	}
	_, err = svc.TallyElection(ctx, estateID, admin, empty)
	mustErr(t, err, "no vote was cast", "certifying a ballot nobody chose anything in")
	assertNoVoterChoiceLink(t, ctx, pool, electionID)
	assertNoVoterChoiceLink(t, ctx, pool, empty)
}

// ---------------------------------------------------------------- 0209/0210/0211

// A candidacy is a chain of consents: someone proposes, the nominee accepts, the estate
// vets, the admin certifies. Skipping any link must be impossible, not merely discouraged.
func TestLiveDB_Governance_NominationAcceptVetCertify(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	nominee := seedGovNamedResident(t, ctx, pool, estateID, "Ada", "Nominee")
	proposer := seedGovResident(t, ctx, pool, estateID)
	watcher := seedGovNamedResident(t, ctx, pool, estateID, "Wale", "Watcher")
	voter := seedGovResident(t, ctx, pool, estateID)
	outsider := seedDuesUser(t, ctx, pool)

	electionID := seedGovElection(t, ctx, pool, estateID, admin, govSeed{})

	// 0210: an invalid nomination is refused, not recorded — a non-member cannot be put
	// forward for this estate's ballot.
	_, err := svc.Nominate(ctx, estateID, proposer, electionID, NominationRequest{NomineeUserID: outsider})
	mustErr(t, err, "not an eligible member", "a non-member nomination")
	var rows int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM election_nominations WHERE election_id=$1`, electionID).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("a refused nomination was stored (%d rows, err %v)", rows, err)
	}
	// A non-member cannot nominate either.
	_, err = svc.Nominate(ctx, estateID, outsider, electionID, NominationRequest{NomineeUserID: nominee})
	mustErr(t, err, "not a member", "a nomination by a non-member")
	selfNom, err := svc.Nominate(ctx, estateID, watcher, electionID, NominationRequest{NomineeUserID: watcher})
	if err != nil {
		t.Fatalf("self-nomination should be allowed until vetting: %v", err)
	}
	// The decision verb is an enum: nothing outside accept / decline / withdraw is a
	// nomination decision at all.
	_, err = svc.DecideNomination(ctx, estateID, watcher, selfNom.ID, "shout", "")
	mustErr(t, err, "unknown nomination decision", "an unsupported decision verb")
	_, err = svc.DecideNomination(ctx, estateID, watcher, uuid.New().String(), "accept", "")
	if err == nil {
		t.Error("a nomination that does not exist was accepted")
	}

	n, err := svc.Nominate(ctx, estateID, proposer, electionID, NominationRequest{
		NomineeUserID: nominee, Seat: "Treasurer", Statement: "Ten years of accounts",
	})
	if err != nil {
		t.Fatalf("nominate: %v", err)
	}
	if n.State != "nominated" || n.VettingState != "pending" || n.NomineeUserID != nominee {
		t.Errorf("new nomination came back %+v", n)
	}
	_, err = svc.Nominate(ctx, estateID, proposer, electionID, NominationRequest{NomineeUserID: nominee})
	mustErr(t, err, "already been nominated", "a duplicate nomination")
	// Vetting is an admin act: a member cannot clear their own way onto the ballot.
	if _, err := svc.VetNomination(ctx, estateID, proposer, n.ID, true, "a member cannot vet"); err == nil {
		t.Error("a non-admin vetted a nomination")
	}

	// Nominations need a window when one is configured: an election that set dates is closed
	// to new names outside them.
	windowed := seedGovElection(t, ctx, pool, estateID, admin, govSeed{})
	opens, closes := time.Now().Add(time.Hour), time.Now().Add(2*time.Hour)
	if _, err := svc.UpdateElectionConfig(ctx, estateID, admin, windowed, ElectionConfigRequest{
		NominationOpensAt: &opens, NominationClosesAt: &closes,
	}); err != nil {
		t.Fatalf("set nomination window: %v", err)
	}
	_, err = svc.Nominate(ctx, estateID, proposer, windowed, NominationRequest{NomineeUserID: nominee})
	mustErr(t, err, "not open yet", "a nomination before the window opens")
	closedOpens, closedCloses := time.Now().Add(-2*time.Hour), time.Now().Add(-time.Hour)
	if _, err := svc.UpdateElectionConfig(ctx, estateID, admin, windowed, ElectionConfigRequest{
		NominationOpensAt: &closedOpens, NominationClosesAt: &closedCloses,
	}); err != nil {
		t.Fatalf("move the window into the past: %v", err)
	}
	_, err = svc.Nominate(ctx, estateID, proposer, windowed, NominationRequest{NomineeUserID: nominee})
	mustErr(t, err, "nominations have closed", "a nomination after the window closes")

	// 0211: only the nominee can accept, and neither acceptance nor vetting alone reaches
	// the ballot.
	_, err = svc.DecideNomination(ctx, estateID, proposer, n.ID, "accept", "")
	mustErr(t, err, "only the nominee", "the proposer accepting for the nominee")
	_, err = svc.CertifyNomination(ctx, estateID, admin, n.ID)
	mustErr(t, err, "must accept", "certifying an unaccepted nomination")
	if _, err := svc.DecideNomination(ctx, estateID, nominee, n.ID, "accept", ""); err != nil {
		t.Fatalf("accept nomination: %v", err)
	}
	_, err = svc.DecideNomination(ctx, estateID, nominee, n.ID, "decline", "changed my mind")
	mustErr(t, err, "already accepted", "re-deciding a nomination the nominee already answered")
	_, err = svc.CertifyNomination(ctx, estateID, admin, n.ID)
	mustErr(t, err, "vetting must clear", "certifying an uncleared nomination")
	if _, err := svc.VetNomination(ctx, estateID, admin, n.ID, false, "shareholding conflict to check"); err != nil {
		t.Fatalf("flag nomination: %v", err)
	}
	_, err = svc.CertifyNomination(ctx, estateID, admin, n.ID)
	mustErr(t, err, "vetting must clear", "certifying a flagged nomination")
	if _, err := svc.VetNomination(ctx, estateID, admin, n.ID, true, "conflict resolved"); err != nil {
		t.Fatalf("clear nomination: %v", err)
	}
	cand, err := svc.CertifyNomination(ctx, estateID, admin, n.ID)
	if err != nil {
		t.Fatalf("certify nomination: %v", err)
	}
	// The ballot line is named from the platform directory, not invented by the proposer.
	if cand.Name != "Ada Nominee" || cand.ElectionID != electionID || cand.Bio != "Ten years of accounts" {
		t.Errorf("certified ballot line came back %+v", cand)
	}
	_, err = svc.CertifyNomination(ctx, estateID, admin, n.ID)
	mustErr(t, err, "already on the ballot", "a second certification of one nomination")
	_, err = svc.DecideNomination(ctx, estateID, nominee, n.ID, "withdraw", "changed my mind")
	mustErr(t, err, "already on the ballot", "withdrawing after certification")

	// The self-nomination walks the identical chain: no acceptance, no ballot line; no
	// cleared vetting, no ballot line — even for the member who nominated themselves.
	if _, err := svc.DecideNomination(ctx, estateID, watcher, selfNom.ID, "accept", ""); err != nil {
		t.Fatalf("the self-nominee accepts: %v", err)
	}
	if _, err := svc.VetNomination(ctx, estateID, admin, selfNom.ID, true, "no conflict found"); err != nil {
		t.Fatalf("clear the self-nomination: %v", err)
	}
	selfCand, err := svc.CertifyNomination(ctx, estateID, admin, selfNom.ID)
	if err != nil {
		t.Fatalf("certify the self-nomination: %v", err)
	}
	if selfCand.Name != "Wale Watcher" || selfCand.ID == cand.ID {
		t.Errorf("second certified ballot line came back %+v (first was %s)", selfCand, cand.Name)
	}
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM election_candidates WHERE election_id=$1`, electionID).Scan(&rows); err != nil || rows != 2 {
		t.Fatalf("ballot lines = %d (err %v), want 2 (one per certified nomination)", rows, err)
	}

	// A member sees certified lines and their own nominations; the workflow stays with the
	// admins who run it.
	asWatcher, err := svc.ListNominations(ctx, estateID, watcher, electionID)
	if err != nil {
		t.Fatalf("watcher nomination list: %v", err)
	}
	for _, m := range asWatcher {
		if m.State != "certified" && m.NomineeUserID != watcher && m.NominatedBy != watcher {
			t.Errorf("a member was shown a %q nomination that is neither certified nor theirs", m.State)
		}
	}
	asAdmin, err := svc.ListNominations(ctx, estateID, admin, electionID)
	if err != nil || len(asAdmin) != 2 {
		t.Fatalf("admin nomination list: %v / %d rows, want 2", err, len(asAdmin))
	}

	// Declining and withdrawing are both final: a declined name cannot be re-nominated,
	// un-declined, or certified.
	decliner := seedGovResident(t, ctx, pool, estateID)
	declined, err := svc.Nominate(ctx, estateID, proposer, electionID, NominationRequest{NomineeUserID: decliner})
	if err != nil {
		t.Fatalf("nominate a second person: %v", err)
	}
	if _, err := svc.DecideNomination(ctx, estateID, decliner, declined.ID, "decline", "not standing"); err != nil {
		t.Fatalf("decline: %v", err)
	}
	_, err = svc.Nominate(ctx, estateID, proposer, electionID, NominationRequest{NomineeUserID: decliner})
	mustErr(t, err, "already been nominated", "re-nominating a declined member")
	_, err = svc.DecideNomination(ctx, estateID, decliner, declined.ID, "accept", "")
	mustErr(t, err, "already declined", "un-declining a nomination")
	_, err = svc.CertifyNomination(ctx, estateID, admin, declined.ID)
	mustErr(t, err, "must accept", "certifying a declined nomination")
	withdrawable := seedGovResident(t, ctx, pool, estateID)
	withdrew, err := svc.Nominate(ctx, estateID, proposer, electionID, NominationRequest{NomineeUserID: withdrawable})
	if err != nil {
		t.Fatalf("nominate a third person: %v", err)
	}
	if _, err := svc.DecideNomination(ctx, estateID, proposer, withdrew.ID, "withdraw", "nominated in error"); err != nil {
		t.Fatalf("withdraw: %v", err)
	}
	n2, err := svc.loadNomination(ctx, estateID, withdrew.ID)
	if err != nil || n2.State != "withdrawn" {
		t.Fatalf("withdrawn nomination reads back %+v (err %v)", n2, err)
	}
	_, err = svc.DecideNomination(ctx, estateID, withdrawable, withdrew.ID, "accept", "")
	mustErr(t, err, "already withdrawn", "re-accepting a withdrawn nomination")
	if all, err := svc.ListNominations(ctx, estateID, admin, electionID); err != nil || len(all) != 4 {
		t.Fatalf("admin nomination list after the workflow: %v / %d rows, want 4", err, len(all))
	}
	uninvolved, err := svc.ListNominations(ctx, estateID, voter, electionID)
	if err != nil {
		t.Fatalf("an uninvolved member's nomination list: %v", err)
	}
	for _, m := range uninvolved {
		if m.State != "certified" {
			t.Errorf("an uninvolved member was shown a %q nomination", m.State)
		}
	}

	// The election can now open on two certified lines, and each link of the chain was
	// load-bearing to get there.
	if _, err := svc.OpenElection(ctx, estateID, admin, electionID); err != nil {
		t.Fatalf("open after certification: %v", err)
	}
	if got := govStatus(t, ctx, pool, electionID); got != "open" {
		t.Errorf("election status = %q after OpenElection", got)
	}
	_, err = svc.OpenElection(ctx, estateID, admin, electionID)
	mustErr(t, err, "cannot open", "reopening")
	_, err = svc.Nominate(ctx, estateID, proposer, electionID, NominationRequest{NomineeUserID: decliner})
	mustErr(t, err, "nominations close", "nominating after the election opened")
	// A pending nomination cannot be certified onto a live ballot either.
	_, err = svc.CertifyNomination(ctx, estateID, admin, withdrew.ID)
	mustErr(t, err, "closed to new candidates", "certifying onto an open ballot")

	// A one-candidate ballot cannot open at all.
	solo := seedGovElection(t, ctx, pool, estateID, admin, govSeed{})
	seedGovCandidates(t, ctx, pool, solo, "Alone")
	_, err = svc.OpenElection(ctx, estateID, admin, solo)
	mustErr(t, err, "at least 2 candidates", "opening a one-candidate ballot")

	// A ballot line can only be named from a real platform account. Deleting the directory
	// row simulates the legacy account that predates the auth trigger, which is exactly the
	// state this guard exists to refuse.
	noAccount := seedGovResident(t, ctx, pool, estateID)
	nomineeless, err := svc.Nominate(ctx, estateID, proposer, solo, NominationRequest{NomineeUserID: noAccount})
	if err != nil {
		t.Fatalf("nominate a member with no directory row: %v", err)
	}
	if _, err := svc.DecideNomination(ctx, estateID, noAccount, nomineeless.ID, "accept", ""); err != nil {
		t.Fatalf("accept: %v", err)
	}
	if _, err := svc.VetNomination(ctx, estateID, admin, nomineeless.ID, true, "cleared"); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM public.platform_users WHERE id=$1`, noAccount); err != nil {
		t.Fatalf("remove the directory row: %v", err)
	}
	_, err = svc.CertifyNomination(ctx, estateID, admin, nomineeless.ID)
	mustErr(t, err, "account not found", "certifying a nominee with no platform account")

	// An account that exists but carries no names still certifies, and is named on the ballot
	// by its email — the line is never blank and never invented by the proposer.
	unnamed := seedGovResident(t, ctx, pool, estateID)
	nameless, err := svc.Nominate(ctx, estateID, proposer, solo, NominationRequest{NomineeUserID: unnamed})
	if err != nil {
		t.Fatalf("nominate a member with no names: %v", err)
	}
	if _, err := svc.DecideNomination(ctx, estateID, unnamed, nameless.ID, "accept", ""); err != nil {
		t.Fatalf("accept: %v", err)
	}
	if _, err := svc.VetNomination(ctx, estateID, admin, nameless.ID, true, "cleared"); err != nil {
		t.Fatalf("clear: %v", err)
	}
	byEmail, err := svc.CertifyNomination(ctx, estateID, admin, nameless.ID)
	if err != nil {
		t.Fatalf("certify a member whose directory row has no names: %v", err)
	}
	if byEmail.Name != unnamed+"@seed.test" {
		t.Errorf("ballot line for an unnamed account = %q, want the account email", byEmail.Name)
	}
}

// ---------------------------------------------------------------- 0223 quorum

// A quorum is only real if it can stop a result: the election with the support of a
// minority cannot be certified, and it is reported as unquorate rather than silent.
func TestLiveDB_Governance_QuorumBlocksCertification(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	a := seedGovResident(t, ctx, pool, estateID)
	b := seedGovResident(t, ctx, pool, estateID)
	c := seedGovResident(t, ctx, pool, estateID)
	electionID := seedGovElection(t, ctx, pool, estateID, admin, govSeed{quorumType: QuorumTypePercent, quorumValue: 60})
	cands := seedGovCandidates(t, ctx, pool, electionID, "Ada", "Bola")
	govRollAndOpen(t, ctx, svc, estateID, admin, electionID)

	mustGovVote(t, svc, ctx, estateID, electionID, a, CastVoteRequest{CandidateID: cands[0]})

	// Turnout is visible mid-poll to the admin, with no candidate-level figure at all — the
	// ESTB-D006 sealing must survive the new read path.
	t1, err := svc.GetTurnout(ctx, estateID, admin, electionID)
	if err != nil {
		t.Fatalf("turnout: %v", err)
	}
	if t1.VotersCast != 1 || t1.EligibleVoters != 4 || t1.QuorumRequired != 3 || t1.QuorumMet {
		t.Errorf("mid-poll turnout came back %+v", t1)
	}
	if _, err := svc.GetTurnout(ctx, estateID, a, electionID); err == nil {
		t.Error("a non-admin read the turnout surface")
	}
	if _, err := svc.GetOutcome(ctx, estateID, electionID, a); err == nil {
		t.Error("an outcome was published before the election closed")
	}
	if _, err := svc.GetResults(ctx, estateID, electionID, a); err == nil {
		t.Error("a live tally was readable before the election closed")
	}

	if _, err := svc.CloseElection(ctx, estateID, admin, electionID); err != nil {
		t.Fatalf("close: %v", err)
	}
	out, err := svc.GetOutcome(ctx, estateID, electionID, a)
	if err != nil {
		t.Fatalf("outcome: %v", err)
	}
	if out.Verdict != "no_quorum" || out.QuorumMet || out.QuorumRequired != 3 {
		t.Errorf("1 ballot of 4 eligible at a 60%% quorum came back %+v", out)
	}
	_, err = svc.TallyElection(ctx, estateID, admin, electionID)
	mustErr(t, err, "quorum not met", "certifying without quorum")
	if got := govStatus(t, ctx, pool, electionID); got != "closed" {
		t.Errorf("a failed certification moved the election to %q, want closed", got)
	}

	// Closing seals the ballot: the member who stayed away cannot make up the quorum after
	// the poll has ended (0228/0229).
	_, err = svc.CastVote(ctx, estateID, electionID, b, CastVoteRequest{CandidateID: cands[0]})
	mustErr(t, err, "not currently open for voting", "a ballot cast after the election closed")

	// The same configuration run with enough support is decided — and it has to be a second
	// election, because a closed poll cannot be reopened to gather the missing ballots.
	quorate := seedGovElection(t, ctx, pool, estateID, admin, govSeed{quorumType: QuorumTypePercent, quorumValue: 60})
	qcands := seedGovCandidates(t, ctx, pool, quorate, "Ada", "Bola")
	govRollAndOpen(t, ctx, svc, estateID, admin, quorate)
	mustGovVote(t, svc, ctx, estateID, quorate, a, CastVoteRequest{CandidateID: qcands[0]})
	mustGovVote(t, svc, ctx, estateID, quorate, b, CastVoteRequest{CandidateID: qcands[0]})
	mustGovVote(t, svc, ctx, estateID, quorate, c, CastVoteRequest{CandidateID: qcands[0]})
	if _, err := svc.CloseElection(ctx, estateID, admin, quorate); err != nil {
		t.Fatalf("close the quorate poll: %v", err)
	}
	out2, err := svc.GetOutcome(ctx, estateID, quorate, a)
	if err != nil {
		t.Fatalf("outcome after quorum: %v", err)
	}
	if !out2.QuorumMet || out2.Verdict != "decided" || len(out2.WinnerIDs) != 1 {
		t.Errorf("post-quorum outcome came back %+v", out2)
	}
	if out2.BallotsCast != 3 || out2.VotersCast != 3 || out2.TurnoutPercent != 75 {
		t.Errorf("post-quorum participation came back %+v", out2)
	}
	if out2.Results[0].Votes != 3 || out2.Results[0].ID != qcands[0] {
		t.Errorf("the leader shows %+v, want 3 votes for %s", out2.Results[0], qcands[0])
	}
	if _, err := svc.TallyElection(ctx, estateID, admin, quorate); err != nil {
		t.Fatalf("certify after quorum: %v", err)
	}
	if got := govStatus(t, ctx, pool, quorate); got != "tallied" {
		t.Errorf("status after certification = %q, want tallied", got)
	}
	assertNoVoterChoiceLink(t, ctx, pool, electionID)
	assertNoVoterChoiceLink(t, ctx, pool, quorate)
}

// A count quorum is the other configured shape, and it is measured in ballots — which for
// a weighted election is not the same number as voters (0205 + 0223 together).
func TestLiveDB_Governance_CountQuorumWithWeighting(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	owner := seedGovResident(t, ctx, pool, estateID)
	flatA := seedGovUnit(t, ctx, pool, estateID, "W-01", owner)
	flatB := seedGovUnit(t, ctx, pool, estateID, "W-02", owner)
	adminUnit := seedGovUnit(t, ctx, pool, estateID, "W-03", admin)

	electionID := seedGovElection(t, ctx, pool, estateID, admin, govSeed{
		weighting: WeightingOneVotePerUnit, quorumType: QuorumTypeCount, quorumValue: 3,
	})
	cands := seedGovCandidates(t, ctx, pool, electionID, "Ada", "Bola")
	govRollAndOpen(t, ctx, svc, estateID, admin, electionID)

	mustGovVote(t, svc, ctx, estateID, electionID, owner, CastVoteRequest{CandidateID: cands[0], UnitID: flatA})
	mustGovVote(t, svc, ctx, estateID, electionID, owner, CastVoteRequest{CandidateID: cands[0], UnitID: flatB})
	if _, err := svc.CloseElection(ctx, estateID, admin, electionID); err != nil {
		t.Fatalf("close: %v", err)
	}
	out, err := svc.GetOutcome(ctx, estateID, electionID, owner)
	if err != nil {
		t.Fatalf("outcome: %v", err)
	}
	// Two voters, three ballots: only the ballot count can satisfy a count quorum here.
	if out.Verdict != "no_quorum" || out.BallotsCast != 2 || out.VotersCast != 1 ||
		out.EligibleVoters != 2 || out.BallotsAvail != 3 || out.QuorumRequired != 3 {
		t.Errorf("a 2-of-3 weighted ballot at a count quorum of 3 came back %+v", out)
	}
	_, err = svc.TallyElection(ctx, estateID, admin, electionID)
	mustErr(t, err, "quorum not met", "certifying 2 ballots against a count quorum of 3")

	// The admin's own holding is a ballot the closed poll cannot now gather.
	_, err = svc.CastVote(ctx, estateID, electionID, admin, CastVoteRequest{CandidateID: cands[1], UnitID: adminUnit})
	mustErr(t, err, "not currently open for voting", "a weighted ballot cast after the election closed")

	// The same estate, the same rules, with all three units voting before the close: the
	// count quorum clears on ballots, not voters, and the contested count still decides.
	live := seedGovElection(t, ctx, pool, estateID, admin, govSeed{
		weighting: WeightingOneVotePerUnit, quorumType: QuorumTypeCount, quorumValue: 3,
	})
	lcands := seedGovCandidates(t, ctx, pool, live, "Ada", "Bola")
	govRollAndOpen(t, ctx, svc, estateID, admin, live)
	mustGovVote(t, svc, ctx, estateID, live, owner, CastVoteRequest{CandidateID: lcands[0], UnitID: flatA})
	mustGovVote(t, svc, ctx, estateID, live, owner, CastVoteRequest{CandidateID: lcands[0], UnitID: flatB})
	mustGovVote(t, svc, ctx, estateID, live, admin, CastVoteRequest{CandidateID: lcands[1], UnitID: adminUnit})
	if _, err := svc.CloseElection(ctx, estateID, admin, live); err != nil {
		t.Fatalf("close the live poll: %v", err)
	}
	if cast, _ := govBallots(t, ctx, pool, live); cast != 3 {
		t.Errorf("ballots after the third unit voted = %d, want 3", cast)
	}
	out2, err := svc.GetOutcome(ctx, estateID, live, owner)
	if err != nil {
		t.Fatalf("outcome after the quorum: %v", err)
	}
	if !out2.QuorumMet || out2.Verdict != "decided" || len(out2.WinnerIDs) != 1 || out2.WinnerIDs[0] != lcands[0] {
		t.Errorf("post-quorum weighted outcome came back %+v", out2)
	}
	if _, err := svc.TallyElection(ctx, estateID, admin, live); err != nil {
		t.Fatalf("certify the weighted result: %v", err)
	}
	assertNoVoterChoiceLink(t, ctx, pool, electionID)
	assertNoVoterChoiceLink(t, ctx, pool, live)
}

// ---------------------------------------------------------------- 0225 tie-break

// A tie is only a result if the rules said how to break it. The same level ballot under
// three configurations must produce three different verdicts, and only the configured
// resolution may be certified.
func TestLiveDB_Governance_TieBreak(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	v1 := seedGovResident(t, ctx, pool, estateID)
	v2 := seedGovResident(t, ctx, pool, estateID)

	for _, tc := range []struct {
		tieBreak string
		verdict  string
		certible bool
	}{
		{TieBreakNone, "tie", false},
		{TieBreakEarliestCandidate, "decided", true},
		{TieBreakRunoff, "runoff_required", false},
	} {
		t.Run(tc.tieBreak, func(t *testing.T) {
			electionID := seedGovElection(t, ctx, pool, estateID, admin, govSeed{tieBreak: tc.tieBreak})
			cands := seedGovCandidates(t, ctx, pool, electionID, "Ada", "Bola")
			govRollAndOpen(t, ctx, svc, estateID, admin, electionID)
			mustGovVote(t, svc, ctx, estateID, electionID, v1, CastVoteRequest{CandidateID: cands[0]})
			mustGovVote(t, svc, ctx, estateID, electionID, v2, CastVoteRequest{CandidateID: cands[1]})
			if _, err := svc.CloseElection(ctx, estateID, admin, electionID); err != nil {
				t.Fatalf("close: %v", err)
			}

			out, err := svc.GetOutcome(ctx, estateID, electionID, v1)
			if err != nil {
				t.Fatalf("outcome for tie_break=%s: %v", tc.tieBreak, err)
			}
			if out.Verdict != tc.verdict {
				t.Errorf("tie_break=%s verdict=%q, want %q (%s)", tc.tieBreak, out.Verdict, tc.verdict, out.TieBreakNote)
			}
			if out.TopVotes != 1 {
				t.Errorf("tie_break=%s top votes = %d, want 1", tc.tieBreak, out.TopVotes)
			}
			if tc.verdict == "decided" {
				// Earliest-named wins; "Ada" was inserted first.
				if len(out.WinnerIDs) != 1 || out.WinnerIDs[0] != cands[0] {
					t.Errorf("earliest_candidate returned %v, want just %s", out.WinnerIDs, cands[0])
				}
			} else if len(out.WinnerIDs) != 2 {
				t.Errorf("tie_break=%s named %v, want both level candidates", tc.tieBreak, out.WinnerIDs)
			}
			if out.TieBreakNote == "" {
				t.Errorf("tie_break=%s produced no explanation for its verdict", tc.tieBreak)
			}
			if tc.certible {
				if _, err := svc.TallyElection(ctx, estateID, admin, electionID); err != nil {
					t.Errorf("tie_break=%s could not certify its own resolution: %v", tc.tieBreak, err)
				}
			} else {
				_, err = svc.TallyElection(ctx, estateID, admin, electionID)
				mustErr(t, err, tc.verdict, "certifying an unresolved tie_break="+tc.tieBreak)
			}
			assertNoVoterChoiceLink(t, ctx, pool, electionID)
		})
	}
}

// ---------------------------------------------------------------- 0227 complaints

// A complaint is a member's right and a gate on certification; a recount is the same
// entity with a demand attached, and it can only ever re-publish aggregates.
func TestLiveDB_Governance_ComplaintGatesCertificationAndRecount(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	voter := seedGovResident(t, ctx, pool, estateID)
	outsider := seedDuesUser(t, ctx, pool)
	electionID := seedGovElection(t, ctx, pool, estateID, admin, govSeed{status: "open"})
	cands := seedGovCandidates(t, ctx, pool, electionID, "Ada", "Bola")
	mustGovVote(t, svc, ctx, estateID, electionID, voter, CastVoteRequest{CandidateID: cands[0]})

	if _, err := svc.FileElectionComplaint(ctx, estateID, outsider, electionID,
		ComplaintRequest{Kind: "complaint", Detail: "an outsider objects"}); err == nil {
		t.Error("a non-member filed an election complaint")
	}
	_, err := svc.FileElectionComplaint(ctx, estateID, voter, electionID,
		ComplaintRequest{Kind: "nonsense", Detail: "the roll was published late"})
	mustErr(t, err, "invalid complaint kind", "an unknown complaint kind")
	draft := seedGovElection(t, ctx, pool, estateID, admin, govSeed{})
	_, err = svc.FileElectionComplaint(ctx, estateID, voter, draft, ComplaintRequest{Detail: "premature objection"})
	mustErr(t, err, "nothing to complain", "a complaint against a draft election")

	complaint, err := svc.FileElectionComplaint(ctx, estateID, voter, electionID,
		ComplaintRequest{Kind: "recount", Detail: "two ballots were cast in my name"})
	if err != nil {
		t.Fatalf("file complaint: %v", err)
	}
	if complaint.State != "open" || complaint.Kind != "recount" || complaint.RaisedBy != voter {
		t.Errorf("new complaint came back %+v", complaint)
	}
	// A plain complaint too, so the gate is not a one-off.
	if _, err := svc.FileElectionComplaint(ctx, estateID, voter, electionID,
		ComplaintRequest{Detail: "the notices went out late"}); err != nil {
		t.Fatalf("file a plain complaint: %v", err)
	}

	if _, err := svc.CloseElection(ctx, estateID, admin, electionID); err != nil {
		t.Fatalf("close: %v", err)
	}
	_, err = svc.TallyElection(ctx, estateID, admin, electionID)
	mustErr(t, err, "complaint(s) are still open", "certifying over open complaints")

	list, err := svc.ListElectionComplaints(ctx, estateID, admin, electionID)
	if err != nil || len(list) != 2 {
		t.Fatalf("list complaints: %v / %d, want 2", err, len(list))
	}
	if _, err := svc.ListElectionComplaints(ctx, estateID, voter, electionID); err == nil {
		t.Error("a member listed the estate's complaints")
	}
	var plainID string
	for _, c := range list {
		if c.Kind == "complaint" {
			plainID = c.ID
		}
	}
	if plainID == "" {
		t.Fatal("the plain complaint is missing from the list")
	}

	rc, err := svc.RunRecount(ctx, estateID, admin, electionID, complaint.ID, "manual re-tabulation")
	if err != nil {
		t.Fatalf("recount: %v", err)
	}
	if rc.BallotsCast != 1 || rc.Abstentions != 0 || len(rc.Totals) != 2 {
		t.Errorf("recount snapshot came back %+v", rc)
	}
	if rc.Totals[0].Votes != 1 || rc.Totals[0].ID != cands[0] {
		t.Errorf("the recount leader shows %+v, want 1 vote for %s", rc.Totals[0], cands[0])
	}
	if rc.ComplaintID != complaint.ID {
		t.Errorf("recount complaint link = %q, want %q", rc.ComplaintID, complaint.ID)
	}
	_, err = svc.RunRecount(ctx, estateID, admin, electionID, uuid.New().String(), "")
	mustErr(t, err, "does not belong", "linking a foreign complaint")
	// A recount of a live ballot would be a way to read it early (ESTB-D006).
	live := seedGovElection(t, ctx, pool, estateID, admin, govSeed{status: "open"})
	seedGovCandidates(t, ctx, pool, live, "Ada", "Bola")
	if _, err := svc.RunRecount(ctx, estateID, admin, live, "", "premature"); err == nil {
		t.Error("a recount ran on an open ballot")
	}

	// The snapshot is aggregates only — a recount must not become a way to read ballots.
	var keyCount int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM (
			SELECT jsonb_object_keys(totals->0) AS k FROM election_recounts WHERE id=$1) x
		WHERE k LIKE '%voter%' OR k LIKE '%user%' OR k = 'cast_at' OR k LIKE '%time%'`, rc.ID).
		Scan(&keyCount); err != nil {
		t.Fatalf("inspect recount snapshot keys: %v", err)
	}
	if keyCount != 0 {
		t.Errorf("the recount snapshot carries %d identifying or timestamp key(s)", keyCount)
	}
	if all, err := svc.ListRecounts(ctx, estateID, admin, electionID); err != nil || len(all) != 1 {
		t.Fatalf("list recounts: %v / %d", err, len(all))
	}

	// Dismissing one complaint still leaves the other, so certification stays gated.
	if _, err := svc.ResolveElectionComplaint(ctx, estateID, admin, plainID, false, "no evidence of double voting"); err != nil {
		t.Fatalf("dismiss complaint: %v", err)
	}
	_, err = svc.TallyElection(ctx, estateID, admin, electionID)
	mustErr(t, err, "still open", "certifying with one complaint left open")

	// Upholding a recount demand re-tabulates as part of the decision, then clears the gate.
	if _, err := svc.ResolveElectionComplaint(ctx, estateID, admin, complaint.ID, true, "recount ordered and completed"); err != nil {
		t.Fatalf("uphold complaint: %v", err)
	}
	if all, err := svc.ListRecounts(ctx, estateID, admin, electionID); err != nil || len(all) != 2 {
		t.Fatalf("an upheld recount demand should tabulate again: %v / %d snapshots", err, len(all))
	}
	_, err = svc.ResolveElectionComplaint(ctx, estateID, admin, complaint.ID, true, "a second decision")
	mustErr(t, err, "already", "resolving a decided complaint")
	if _, err := svc.TallyElection(ctx, estateID, admin, electionID); err != nil {
		t.Fatalf("certify after resolution: %v", err)
	}
	if got := govStatus(t, ctx, pool, electionID); got != "tallied" {
		t.Errorf("status after clearing the complaints = %q, want tallied", got)
	}
	// A certified result is beyond cancellation: the route from here is a complaint.
	_, err = svc.CancelElection(ctx, estateID, admin, electionID, "too late now")
	mustErr(t, err, "file a complaint", "cancelling a certified result")
	assertNoVoterChoiceLink(t, ctx, pool, electionID)
}

// ---------------------------------------------------------------- 0229 cancellation

// Cancellation voids the poll without erasing it: the ballots stay (they are anonymous, so
// deleting them destroys evidence and reveals nothing), and every later act is refused.
func TestLiveDB_Governance_CancellationSealsTheBallot(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	voter := seedGovResident(t, ctx, pool, estateID)
	electionID := seedGovElection(t, ctx, pool, estateID, admin, govSeed{status: "open"})
	cands := seedGovCandidates(t, ctx, pool, electionID, "Ada", "Bola")
	mustGovVote(t, svc, ctx, estateID, electionID, voter, CastVoteRequest{CandidateID: cands[0]})

	_, err := svc.CancelElection(ctx, estateID, admin, electionID, "why")
	mustErr(t, err, "5 characters", "cancelling without a reason")
	if _, err := svc.CancelElection(ctx, estateID, voter, electionID, "a member has no such power"); err == nil {
		t.Error("a member cancelled an estate election")
	}
	el, err := svc.CancelElection(ctx, estateID, admin, electionID, "double election of the same seat")
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if el.Status != "cancelled" || el.CancelledAt == nil || el.CancellationReason != "double election of the same seat" {
		t.Errorf("cancelled election came back %+v", el)
	}
	_, err = svc.CancelElection(ctx, estateID, admin, electionID, "cancelled twice")
	mustErr(t, err, "already cancelled", "a second cancellation")
	mustErr(t, govVoteErr(svc, ctx, estateID, electionID, voter, cands[1], ""), "cancelled",
		"voting after cancellation")
	_, err = svc.Nominate(ctx, estateID, voter, electionID, NominationRequest{NomineeUserID: voter})
	mustErr(t, err, "nominations close", "nominating into a cancelled election")
	_, err = svc.UpdateElectionConfig(ctx, estateID, admin, electionID, ElectionConfigRequest{TieBreak: TieBreakRunoff})
	mustErr(t, err, "cannot change", "reconfiguring a cancelled election")
	_, err = svc.CloseElection(ctx, estateID, admin, electionID)
	mustErr(t, err, "cannot close", "closing a cancelled election")
	_, err = svc.TallyElection(ctx, estateID, admin, electionID)
	mustErr(t, err, "cannot tally", "tallying a cancelled election")
	_, err = svc.FreezeElectionRoll(ctx, estateID, admin, electionID, uuid.New().String())
	mustErr(t, err, "cancelled", "freezing a roll for a cancelled election")
	_, err = svc.ProposeElectionRules(ctx, estateID, admin, electionID, SetEligibilityRulesRequest{})
	mustErr(t, err, "once the election is cancelled", "proposing rules for a cancelled election")

	// Cancellation is an audit, not a delete: participation and its anonymous ballot both
	// survive, and the outcome reports the cancellation instead of a winner.
	var parts, ballots int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM election_votes WHERE election_id=$1`, electionID).Scan(&parts); err != nil || parts != 1 {
		t.Fatalf("participation rows after cancellation = %d (err %v), want 1", parts, err)
	}
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM election_ballots WHERE election_id=$1`, electionID).Scan(&ballots); err != nil || ballots != 1 {
		t.Fatalf("ballots after cancellation = %d (err %v), want 1", ballots, err)
	}
	out, err := svc.GetOutcome(ctx, estateID, electionID, voter)
	if err != nil {
		t.Fatalf("outcome of a cancelled election: %v", err)
	}
	if out.Verdict != "cancelled" || out.Cancellation != "double election of the same seat" || len(out.Results) != 0 {
		t.Errorf("cancelled outcome came back %+v", out)
	}
	if !out.QuorumMet && out.QuorumType == QuorumTypeNone {
		t.Errorf("a no-quorum election reported a quorum failure: %+v", out)
	}
	// A complaint still reaches a cancelled election: it is how the cancellation itself is
	// challenged.
	if _, err := svc.FileElectionComplaint(ctx, estateID, voter, electionID,
		ComplaintRequest{Detail: "the cancellation was not voted for"}); err != nil {
		t.Errorf("a member could not complain about a cancellation: %v", err)
	}

	// Drafts can be cancelled too — but a certified result is out of reach.
	draft := seedGovElection(t, ctx, pool, estateID, admin, govSeed{})
	if _, err := svc.CancelElection(ctx, estateID, admin, draft, "seat was never filled"); err != nil {
		t.Fatalf("cancel a draft: %v", err)
	}
	certified := seedGovElection(t, ctx, pool, estateID, admin, govSeed{status: "open"})
	certCands := seedGovCandidates(t, ctx, pool, certified, "Ada", "Bola")
	mustGovVote(t, svc, ctx, estateID, certified, voter, CastVoteRequest{CandidateID: certCands[0]})
	if _, err := svc.CloseElection(ctx, estateID, admin, certified); err != nil {
		t.Fatalf("close the certified election: %v", err)
	}
	if _, err := svc.TallyElection(ctx, estateID, admin, certified); err != nil {
		t.Fatalf("tally the certified election: %v", err)
	}
	_, err = svc.CancelElection(ctx, estateID, admin, certified, "too late now")
	mustErr(t, err, "file a complaint", "cancelling a certified result")
	assertNoVoterChoiceLink(t, ctx, pool, electionID)
	assertNoVoterChoiceLink(t, ctx, pool, certified)
}

// ---------------------------------------------------------------- 0230 informal poll

// An informal poll advises: it can be created before its candidates exist (as long as it
// opens a nomination window to gather them), it still reports its quorum, and a failed
// quorum does not stop an advisory result being recorded.
func TestLiveDB_Governance_InformalPollIsNonBinding(t *testing.T) {
	pool := estateMeetingsTestPool(t)
	ctx := context.Background()
	svc := newMeetingsTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	voter := seedGovResident(t, ctx, pool, estateID)

	if _, err := svc.CreateElection(ctx, estateID, admin, CreateElectionRequest{
		Title: "Which gate gets the new intercom?", StartsAt: time.Now().Add(time.Hour), EndsAt: time.Now().Add(48 * time.Hour),
		Kind: ElectionKindPoll,
	}); err == nil {
		t.Fatal("an election with no candidates and no nomination window was created")
	}
	_, err := svc.CreateElection(ctx, estateID, admin, CreateElectionRequest{
		Title: "A poll with a nonsense kind", StartsAt: time.Now().Add(time.Hour), EndsAt: time.Now().Add(48 * time.Hour),
		Kind: "vibes", Candidates: []Candidate{{Name: "Ada"}, {Name: "Bola"}},
	})
	mustErr(t, err, "invalid kind", "an election with a nonsense kind")

	opens, closes := time.Now().Add(-2*time.Hour), time.Now().Add(-time.Minute)
	el, err := svc.CreateElection(ctx, estateID, admin, CreateElectionRequest{
		Title: "Which gate gets the new intercom?", StartsAt: time.Now().Add(-time.Second), EndsAt: time.Now().Add(48 * time.Hour),
		Kind: ElectionKindPoll, QuorumType: QuorumTypePercent, QuorumValue: 90,
		NominationOpensAt: &opens, NominationClosesAt: &closes,
	})
	if err != nil {
		t.Fatalf("create poll: %v", err)
	}
	if el.Kind != ElectionKindPoll || el.Status != "draft" || el.QuorumValue != 90 || el.Weighting != WeightingOnePersonOneVote {
		t.Errorf("created poll came back %+v", el)
	}
	// A poll cannot be created already open, and a percent quorum has to be a percentage.
	if _, err := svc.CreateElection(ctx, estateID, admin, CreateElectionRequest{
		Title: "A poll with an impossible quorum", StartsAt: time.Now(), EndsAt: time.Now().Add(time.Hour),
		Kind: ElectionKindPoll, QuorumType: QuorumTypePercent, QuorumValue: 140,
		Candidates: []Candidate{{Name: "Ada"}, {Name: "Bola"}},
	}); err == nil {
		t.Error("a poll was created with a 140% quorum")
	}

	cands := seedGovCandidates(t, ctx, pool, el.ID, "Main gate", "Service gate")
	roll, err := svc.BuildElectionRoll(ctx, estateID, admin, el.ID)
	if err != nil {
		t.Fatalf("build the poll roll: %v", err)
	}
	if _, err := svc.FreezeElectionRoll(ctx, estateID, admin, el.ID, roll.ID); err != nil {
		t.Fatalf("freeze the poll roll: %v", err)
	}
	if _, err := svc.OpenElection(ctx, estateID, admin, el.ID); err != nil {
		t.Fatalf("open poll: %v", err)
	}
	mustGovVote(t, svc, ctx, estateID, el.ID, voter, CastVoteRequest{CandidateID: cands[0]})
	if _, err := svc.CloseElection(ctx, estateID, admin, el.ID); err != nil {
		t.Fatalf("close poll: %v", err)
	}
	out, err := svc.GetOutcome(ctx, estateID, el.ID, voter)
	if err != nil {
		t.Fatalf("poll outcome: %v", err)
	}
	if out.Binding {
		t.Error("an informal poll reported itself as binding")
	}
	// The 90% quorum is reported and missed — 1 ballot of 2 eligible — and unlike a binding
	// election that cannot stop an advisory result being recorded.
	if out.QuorumType != QuorumTypePercent || out.QuorumMet || out.Verdict != "no_quorum" {
		t.Errorf("poll quorum fields came back %+v", out)
	}
	if len(out.Results) != 2 || out.Results[0].Votes != 1 {
		t.Errorf("poll advisory result came back %+v", out.Results)
	}
	outcome, err := svc.TallyElection(ctx, estateID, admin, el.ID)
	if err != nil {
		t.Fatalf("record an advisory poll result despite the failed quorum: %v", err)
	}
	if outcome.Status != "tallied" || outcome.Binding {
		t.Errorf("recorded poll outcome came back %+v", outcome)
	}

	// Configuration closes when the ballot opens, for a poll exactly as for a binding
	// election.
	later := seedGovElection(t, ctx, pool, estateID, admin, govSeed{kind: ElectionKindPoll})
	seedGovCandidates(t, ctx, pool, later, "A", "B")
	if _, err := svc.UpdateElectionConfig(ctx, estateID, admin, later, ElectionConfigRequest{TieBreak: TieBreakRunoff}); err != nil {
		t.Fatalf("configure a draft poll: %v", err)
	}
	if _, err := svc.OpenElection(ctx, estateID, admin, later); err != nil {
		t.Fatalf("open the second poll: %v", err)
	}
	_, err = svc.UpdateElectionConfig(ctx, estateID, admin, later, ElectionConfigRequest{Weighting: WeightingOneVotePerUnit})
	mustErr(t, err, "cannot change", "reconfiguring an open election")
	assertNoVoterChoiceLink(t, ctx, pool, el.ID)
	assertNoVoterChoiceLink(t, ctx, pool, later)
}
