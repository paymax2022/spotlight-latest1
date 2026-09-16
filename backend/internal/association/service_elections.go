package association

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Association elections — integrity-critical service (TS-13 / §4 invariants).
// Ballot secrecy is structural: casting a vote writes the voter into
// assoc_election_ballots_cast (turnout + one-vote) and the choice into
// assoc_election_votes (anonymous, no voter/time) in one transaction; no query
// can join a member to their choice.

var (
	// ErrIneligible — voter is not an active, good-standing member of the org.
	ErrIneligible = errors.New("association: not eligible to vote")
	// ErrVotingClosed — election is not open for voting (status/window).
	ErrVotingClosed = errors.New("association: voting is not open")
	// ErrInvalidBallot — candidate/position does not belong to the election.
	ErrInvalidBallot = errors.New("association: invalid ballot")
	// ErrElectionState — operation not allowed from the election's current state.
	ErrElectionState = errors.New("association: invalid election state")
)

// ─── inputs / view models ─────────────────────────────────────────────────────

type CreatePositionInput struct {
	Title string `json:"title" binding:"required"`
	Seats int    `json:"seats"`
	// Role, when set, is the admin role the position's winner receives at handover
	// (EL-015). Must be one of CHAPTER_ADMIN / FINANCE_ADMIN / SECRETARY /
	// NATIONAL_ADMIN; empty = a ceremonial position with no role handover.
	Role string `json:"role"`
}

// electionRoles are the admin roles a position may confer on its winner.
// SUPER_ADMIN is intentionally not electable; NONE is not grantable.
var electionRoles = map[string]bool{"CHAPTER_ADMIN": true, "FINANCE_ADMIN": true, "SECRETARY": true, "NATIONAL_ADMIN": true}

type CreateElectionInput struct {
	Title               string                `json:"title" binding:"required"`
	Description         string                `json:"description"`
	VotingOpensAt       *string               `json:"votingOpensAt"`  // RFC3339
	VotingClosesAt      *string               `json:"votingClosesAt"` // RFC3339
	RequireGoodStanding *bool                 `json:"requireGoodStanding"`
	Positions           []CreatePositionInput `json:"positions" binding:"required"`
}

type AddCandidateInput struct {
	PositionID   string `json:"positionId" binding:"required"`
	MembershipID string `json:"membershipId" binding:"required"`
	Manifesto    string `json:"manifesto"`
}

type CastVoteInput struct {
	PositionID  string `json:"positionId" binding:"required"`
	CandidateID string `json:"candidateId" binding:"required"`
}

type VoteReceipt struct {
	Receipt     string `json:"receipt"`
	PositionID  string `json:"positionId"`
	ConfirmedAt string `json:"confirmedAt"`
	AlreadyCast bool   `json:"alreadyCast"` // true when this voter had already voted (idempotent)
}

type ElectionSummary struct {
	ID             string  `json:"id"`
	Title          string  `json:"title"`
	Status         string  `json:"status"`
	VotingOpensAt  *string `json:"votingOpensAt"`
	VotingClosesAt *string `json:"votingClosesAt"`
	PositionCount  int     `json:"positionCount"`
}

type ElectionCandidate struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Manifesto string `json:"manifesto"`
	Status    string `json:"status"`
}

type ElectionPosition struct {
	ID         string              `json:"id"`
	Title      string              `json:"title"`
	Seats      int                 `json:"seats"`
	Candidates []ElectionCandidate `json:"candidates"`
	HasVoted   bool                `json:"hasVoted"` // has the viewer voted this position?
}

type CandidateResult struct {
	CandidateID string `json:"candidateId"`
	Name        string `json:"name"`
	Votes       int    `json:"votes"`
	IsWinner    bool   `json:"isWinner"`
}

type PositionResult struct {
	PositionID  string            `json:"positionId"`
	Title       string            `json:"title"`
	Seats       int               `json:"seats"`
	BallotsCast int               `json:"ballotsCast"`
	Results     []CandidateResult `json:"results"`
	Checksum    string            `json:"checksum,omitempty"`
}

type ElectionDetail struct {
	ID                string             `json:"id"`
	Title             string             `json:"title"`
	Description       string             `json:"description"`
	Status            string             `json:"status"`
	VotingOpensAt     *string            `json:"votingOpensAt"`
	VotingClosesAt    *string            `json:"votingClosesAt"`
	Eligible          bool               `json:"eligible"`
	EligibilityReason string             `json:"eligibilityReason,omitempty"`
	SealedResults     bool               `json:"sealedResults"`
	Positions         []ElectionPosition `json:"positions"`
	Results           []PositionResult   `json:"results,omitempty"` // only when PUBLISHED
}

// ─── authz / helpers ──────────────────────────────────────────────────────────

// requireElectionOfficer requires the caller to hold an admin role in the given
// organisation (election administration is an officer action). Fail-closed.
func (s *Service) requireElectionOfficer(ctx context.Context, userID, orgID string) error {
	if orgID == "" {
		return ErrForbidden
	}
	if s.isPlatformSuperAdmin(ctx, userID) {
		return nil
	}
	var n int
	if err := s.db.QueryRow(ctx, `
		SELECT count(*) FROM assoc_member_roles r
		JOIN assoc_memberships m ON m.id = r.membership_id
		WHERE m.user_id = $1 AND m.organisation_id = $2 AND r.role <> 'NONE'`, userID, orgID).Scan(&n); err != nil || n == 0 {
		return ErrForbidden
	}
	return nil
}

func (s *Service) electionOrg(ctx context.Context, electionID string) (string, error) {
	var org string
	if err := s.db.QueryRow(ctx, `SELECT organisation_id FROM assoc_elections WHERE id=$1`, electionID).Scan(&org); err != nil {
		return "", ErrForbidden
	}
	return org, nil
}

func newReceipt() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return "VR-" + hex.EncodeToString(b)
}

func parseTimePtr(iso *string) *time.Time {
	if iso == nil || *iso == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, *iso)
	if err != nil {
		return nil
	}
	return &t
}

// ─── officer: create / candidates / lifecycle ─────────────────────────────────

// CreateElection creates a DRAFT election with its positions in the resolved
// org (see resolveOrgID — orgIDOverride is the admin console's org picker;
// empty falls back to the caller's own primary membership, unchanged for a
// real officer using the mobile in-app admin surface).
func (s *Service) CreateElection(ctx context.Context, userID, orgIDOverride string, in CreateElectionInput) (string, error) {
	orgID, err := s.resolveOrgID(ctx, userID, orgIDOverride)
	if err != nil {
		return "", err
	}
	if err := s.requireElectionOfficer(ctx, userID, orgID); err != nil {
		return "", err
	}
	if len(in.Positions) == 0 {
		return "", fmt.Errorf("association: election needs at least one position")
	}
	requireGood := true
	if in.RequireGoodStanding != nil {
		requireGood = *in.RequireGoodStanding
	}
	electionID := uuid.New().String()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		INSERT INTO assoc_elections (id, organisation_id, title, description, status, voting_opens_at, voting_closes_at, require_good_standing, created_by)
		VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8)`,
		electionID, orgID, in.Title, in.Description, parseTimePtr(in.VotingOpensAt), parseTimePtr(in.VotingClosesAt), requireGood, userID); err != nil {
		return "", fmt.Errorf("association: create election: %w", err)
	}
	for i, p := range in.Positions {
		seats := p.Seats
		if seats < 1 {
			seats = 1
		}
		var role any
		if p.Role != "" {
			if !electionRoles[p.Role] {
				return "", fmt.Errorf("association: invalid position role %q", p.Role)
			}
			role = p.Role
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO assoc_election_positions (id, election_id, title, seats, sort_order, role)
			VALUES ($1,$2,$3,$4,$5,$6)`, uuid.New().String(), electionID, p.Title, seats, i, role); err != nil {
			return "", fmt.Errorf("association: create position: %w", err)
		}
	}
	if err := s.audit(ctx, tx, orgID, userID, "ELECTION_CREATE", "election", electionID, map[string]any{"title": in.Title}); err != nil {
		return "", err
	}
	return electionID, tx.Commit(ctx)
}

// AddCandidate registers a candidate (with manifesto) for a position, checking the
// candidate's own eligibility (active, good-standing member of the org).
func (s *Service) AddCandidate(ctx context.Context, userID, electionID string, in AddCandidateInput) (string, error) {
	orgID, err := s.electionOrg(ctx, electionID)
	if err != nil {
		return "", err
	}
	if err := s.requireElectionOfficer(ctx, userID, orgID); err != nil {
		return "", err
	}
	// Position must belong to this election.
	var okPos bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM assoc_election_positions WHERE id=$1 AND election_id=$2)`, in.PositionID, electionID).Scan(&okPos); err != nil || !okPos {
		return "", ErrInvalidBallot
	}
	// Candidate eligibility: an ACTIVE, good-standing member of THIS org.
	var status, standing string
	if err := s.db.QueryRow(ctx, `SELECT status, payment_standing FROM assoc_memberships WHERE id=$1 AND organisation_id=$2`, in.MembershipID, orgID).Scan(&status, &standing); err != nil {
		return "", ErrIneligible
	}
	if status != "ACTIVE" || standing == "OVERDUE" {
		return "", ErrIneligible
	}
	candidateID := uuid.New().String()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		INSERT INTO assoc_election_candidates (id, election_id, position_id, membership_id, manifesto, status)
		VALUES ($1,$2,$3,$4,$5,'APPROVED')`, candidateID, electionID, in.PositionID, in.MembershipID, in.Manifesto); err != nil {
		return "", fmt.Errorf("association: add candidate: %w", err)
	}
	if err := s.audit(ctx, tx, orgID, userID, "ELECTION_CANDIDATE_ADD", "election_position", in.PositionID, map[string]any{"membershipId": in.MembershipID}); err != nil {
		return "", err
	}
	return candidateID, tx.Commit(ctx)
}

// setElectionStatus transitions an election, enforcing an allowed from-state.
func (s *Service) setElectionStatus(ctx context.Context, userID, electionID, from, to, action string) error {
	orgID, err := s.electionOrg(ctx, electionID)
	if err != nil {
		return err
	}
	if err := s.requireElectionOfficer(ctx, userID, orgID); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE assoc_elections SET status=$3 WHERE id=$1 AND status=$2`, electionID, from, to)
	if err != nil {
		return fmt.Errorf("association: election status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrElectionState
	}
	if err := s.audit(ctx, tx, orgID, userID, action, "election", electionID, map[string]any{"from": from, "to": to}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// OpenElection moves DRAFT/NOMINATION → VOTING.
func (s *Service) OpenElection(ctx context.Context, userID, electionID string) error {
	if err := s.setElectionStatus(ctx, userID, electionID, "DRAFT", "VOTING", "ELECTION_OPEN"); err == nil {
		return nil
	}
	return s.setElectionStatus(ctx, userID, electionID, "NOMINATION", "VOTING", "ELECTION_OPEN")
}

// CloseElection moves VOTING → CLOSED (voting ends; results not yet published).
func (s *Service) CloseElection(ctx context.Context, userID, electionID string) error {
	return s.setElectionStatus(ctx, userID, electionID, "VOTING", "CLOSED", "ELECTION_CLOSE")
}

// ─── voter: cast vote (the integrity crux) ────────────────────────────────────

// CastVote records one anonymous vote for a voter in a position. It is fail-closed
// on eligibility and the voting window, enforces one-member-one-vote via a DB unique
// constraint (concurrency/retry safe), and keeps the choice unlinkable to the voter.
// A repeat call by a voter who already voted is idempotent: it returns the original
// receipt and counts no second vote.
func (s *Service) CastVote(ctx context.Context, userID, electionID string, in CastVoteInput) (*VoteReceipt, error) {
	var org, status string
	var opensAt, closesAt *time.Time
	var requireGood bool
	if err := s.db.QueryRow(ctx, `
		SELECT organisation_id, status, voting_opens_at, voting_closes_at, require_good_standing
		FROM assoc_elections WHERE id=$1`, electionID).Scan(&org, &status, &opensAt, &closesAt, &requireGood); err != nil {
		return nil, ErrInvalidBallot
	}
	// Voting window — fail closed.
	now := time.Now()
	if status != "VOTING" {
		return nil, ErrVotingClosed
	}
	if (opensAt != nil && now.Before(*opensAt)) || (closesAt != nil && now.After(*closesAt)) {
		return nil, ErrVotingClosed
	}
	// Voter eligibility — active, good-standing member of THIS org. Fail closed.
	var voterMembership, memberStatus, standing string
	if err := s.db.QueryRow(ctx, `SELECT id, status, payment_standing FROM assoc_memberships WHERE user_id=$1 AND organisation_id=$2`, userID, org).Scan(&voterMembership, &memberStatus, &standing); err != nil {
		return nil, ErrIneligible
	}
	if memberStatus != "ACTIVE" || (requireGood && standing == "OVERDUE") {
		return nil, ErrIneligible
	}
	// Candidate must belong to this election+position and be APPROVED.
	var okCand bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM assoc_election_candidates WHERE id=$1 AND election_id=$2 AND position_id=$3 AND status='APPROVED')`,
		in.CandidateID, electionID, in.PositionID).Scan(&okCand); err != nil || !okCand {
		return nil, ErrInvalidBallot
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// One-member-one-vote: the unique (election,position,voter) key makes a second
	// vote impossible under retries/concurrency. ON CONFLICT DO NOTHING → 0 rows.
	receipt := newReceipt()
	tag, err := tx.Exec(ctx, `
		INSERT INTO assoc_election_ballots_cast (id, election_id, position_id, voter_membership_id, receipt)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (election_id, position_id, voter_membership_id) DO NOTHING`,
		uuid.New().String(), electionID, in.PositionID, voterMembership, receipt)
	if err != nil {
		return nil, fmt.Errorf("association: cast ballot: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Already voted — idempotent. Return the original receipt; count nothing new.
		var existing, castAt string
		if err := tx.QueryRow(ctx, `SELECT receipt, cast_at::text FROM assoc_election_ballots_cast WHERE election_id=$1 AND position_id=$2 AND voter_membership_id=$3`,
			electionID, in.PositionID, voterMembership).Scan(&existing, &castAt); err != nil {
			return nil, fmt.Errorf("association: read receipt: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return &VoteReceipt{Receipt: existing, PositionID: in.PositionID, ConfirmedAt: castAt, AlreadyCast: true}, nil
	}
	// Record the anonymous choice — no voter reference, no timestamp.
	if _, err := tx.Exec(ctx, `INSERT INTO assoc_election_votes (id, election_id, position_id, candidate_id) VALUES ($1,$2,$3,$4)`,
		uuid.New().String(), electionID, in.PositionID, in.CandidateID); err != nil {
		return nil, fmt.Errorf("association: record vote: %w", err)
	}
	// Audit records TURNOUT only (who voted in which position) — never the choice.
	if err := s.audit(ctx, tx, org, userID, "VOTE_CAST", "election_position", in.PositionID, map[string]any{"electionId": electionID}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &VoteReceipt{Receipt: receipt, PositionID: in.PositionID, ConfirmedAt: now.UTC().Format(time.RFC3339), AlreadyCast: false}, nil
}

// ─── tally / results ──────────────────────────────────────────────────────────

// tallyPosition returns the per-candidate counts and the ballots-cast total for a
// position. The tally is a live COUNT (reproducible) and the ballots-cast total
// enables a tamper-evidence reconciliation (sum(votes) must equal ballots cast).
func (s *Service) tallyPosition(ctx context.Context, q pgxQuerier, electionID, positionID string) ([]CandidateResult, int, error) {
	rows, err := q.Query(ctx, `
		SELECT c.id, COALESCE(mp.full_name, m.member_code, c.id::text), COUNT(v.id)
		FROM assoc_election_candidates c
		JOIN assoc_memberships m ON m.id = c.membership_id
		LEFT JOIN assoc_member_profiles mp ON mp.membership_id = m.id
		LEFT JOIN assoc_election_votes v ON v.candidate_id = c.id
		WHERE c.position_id = $1
		GROUP BY c.id, mp.full_name, m.member_code
		ORDER BY COUNT(v.id) DESC, c.id`, positionID)
	if err != nil {
		return nil, 0, fmt.Errorf("association: tally: %w", err)
	}
	defer rows.Close()
	out := []CandidateResult{}
	for rows.Next() {
		var r CandidateResult
		if err := rows.Scan(&r.CandidateID, &r.Name, &r.Votes); err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	var cast int
	if err := q.QueryRow(ctx, `SELECT count(*) FROM assoc_election_ballots_cast WHERE position_id=$1`, positionID).Scan(&cast); err != nil {
		return nil, 0, err
	}
	return out, cast, nil
}

// pgxQuerier lets tallyPosition run on either the pool or a tx.
type pgxQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// checksumFor produces a deterministic, reproducible hash over a position's tally
// (candidateId:votes, ordered) — the tamper-evidence anchor for published results.
func checksumFor(results []CandidateResult) string {
	rows := make([]string, 0, len(results))
	for _, r := range results {
		rows = append(rows, r.CandidateID+":"+fmt.Sprintf("%d", r.Votes))
	}
	sort.Strings(rows)
	h := sha256.New()
	for _, r := range rows {
		h.Write([]byte(r))
		h.Write([]byte("|"))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// Tally returns the live tally for every position (officer-only, for monitoring).
func (s *Service) Tally(ctx context.Context, userID, electionID string) ([]PositionResult, error) {
	orgID, err := s.electionOrg(ctx, electionID)
	if err != nil {
		return nil, err
	}
	if err := s.requireElectionOfficer(ctx, userID, orgID); err != nil {
		return nil, err
	}
	return s.collectResults(ctx, s.db, electionID, false)
}

// collectResults tallies all positions. When markWinners is true, the top `seats`
// candidates per position are flagged winners.
func (s *Service) collectResults(ctx context.Context, q pgxQuerier, electionID string, markWinners bool) ([]PositionResult, error) {
	prows, err := q.Query(ctx, `SELECT id, title, seats FROM assoc_election_positions WHERE election_id=$1 ORDER BY sort_order`, electionID)
	if err != nil {
		return nil, fmt.Errorf("association: positions: %w", err)
	}
	type pos struct {
		id, title string
		seats     int
	}
	var positions []pos
	for prows.Next() {
		var p pos
		if err := prows.Scan(&p.id, &p.title, &p.seats); err != nil {
			prows.Close()
			return nil, err
		}
		positions = append(positions, p)
	}
	prows.Close()
	if err := prows.Err(); err != nil {
		return nil, err
	}

	out := []PositionResult{}
	for _, p := range positions {
		res, cast, err := s.tallyPosition(ctx, q, electionID, p.id)
		if err != nil {
			return nil, err
		}
		if markWinners {
			for i := range res {
				if i < p.seats && res[i].Votes > 0 {
					res[i].IsWinner = true
				}
			}
		}
		out = append(out, PositionResult{
			PositionID:  p.id,
			Title:       p.title,
			Seats:       p.seats,
			BallotsCast: cast,
			Results:     res,
			Checksum:    checksumFor(res),
		})
	}
	return out, nil
}

// PublishResults snapshots the final tally into the immutable results table (with a
// per-position checksum), flags winners, and moves the election CLOSED → PUBLISHED.
// Re-publishing is blocked (append-only unique key + state guard).
func (s *Service) PublishResults(ctx context.Context, userID, electionID string) ([]PositionResult, error) {
	orgID, err := s.electionOrg(ctx, electionID)
	if err != nil {
		return nil, err
	}
	if err := s.requireElectionOfficer(ctx, userID, orgID); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Only publishable from CLOSED, and exactly once (immutability).
	tag, err := tx.Exec(ctx, `UPDATE assoc_elections SET status='PUBLISHED', published_at=now() WHERE id=$1 AND status='CLOSED'`, electionID)
	if err != nil {
		return nil, fmt.Errorf("association: publish state: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrElectionState
	}

	results, err := s.collectResults(ctx, tx, electionID, true)
	if err != nil {
		return nil, err
	}
	for _, p := range results {
		for _, r := range p.Results {
			if _, err := tx.Exec(ctx, `
				INSERT INTO assoc_election_results (id, election_id, position_id, candidate_id, votes, is_winner, checksum)
				VALUES ($1,$2,$3,$4,$5,$6,$7)`,
				uuid.New().String(), electionID, p.PositionID, r.CandidateID, r.Votes, r.IsWinner, p.Checksum); err != nil {
				return nil, fmt.Errorf("association: write result: %w", err)
			}
		}
	}
	if err := s.audit(ctx, tx, orgID, userID, "ELECTION_RESULTS_PUBLISH", "election", electionID, map[string]any{"positions": len(results)}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return results, nil
}

// ─── voter-facing reads ───────────────────────────────────────────────────────

// ListElections is voter-facing: any member (not just an officer) may list
// their own org's elections to vote in them. orgIDOverride is the admin
// console's org picker — authorized via resolveOrgID (platform super-admin,
// or a real admin role specifically IN that org). An empty override keeps
// the original primaryMembership fallback untouched: a real member with no
// admin role at all could always list their own org's elections, and
// resolveOrgID's fallback (assoc_member_roles, admin roles only) would
// wrongly exclude them.
func (s *Service) ListElections(ctx context.Context, userID, orgIDOverride string) ([]ElectionSummary, error) {
	var orgID string
	if orgIDOverride != "" {
		var err error
		orgID, err = s.resolveOrgID(ctx, userID, orgIDOverride)
		if err != nil {
			return nil, err
		}
	} else {
		var err error
		_, orgID, err = s.primaryMembership(ctx, userID)
		if err != nil {
			return nil, err
		}
	}
	rows, err := s.db.Query(ctx, `
		SELECT e.id, e.title, e.status, e.voting_opens_at::text, e.voting_closes_at::text,
		       (SELECT count(*) FROM assoc_election_positions p WHERE p.election_id=e.id)
		FROM assoc_elections e
		WHERE e.organisation_id=$1 AND e.status <> 'DRAFT'
		ORDER BY e.created_at DESC`, orgID)
	if err != nil {
		return nil, fmt.Errorf("association: list elections: %w", err)
	}
	defer rows.Close()
	out := []ElectionSummary{}
	for rows.Next() {
		var e ElectionSummary
		if err := rows.Scan(&e.ID, &e.Title, &e.Status, &e.VotingOpensAt, &e.VotingClosesAt, &e.PositionCount); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// GetElection returns the voter-facing detail: positions, candidates + manifestos,
// the viewer's eligibility, whether they've voted each position, and — only once
// PUBLISHED — the sealed results.
func (s *Service) GetElection(ctx context.Context, userID, electionID string) (*ElectionDetail, error) {
	d := &ElectionDetail{ID: electionID}
	var org string
	var requireGood bool
	if err := s.db.QueryRow(ctx, `
		SELECT organisation_id, title, COALESCE(description,''), status, voting_opens_at::text, voting_closes_at::text, require_good_standing, sealed_results
		FROM assoc_elections WHERE id=$1`, electionID).Scan(
		&org, &d.Title, &d.Description, &d.Status, &d.VotingOpensAt, &d.VotingClosesAt, &requireGood, &d.SealedResults); err != nil {
		return nil, fmt.Errorf("association: election not found: %w", err)
	}

	// Viewer must be a member of the election's org (scope); compute eligibility.
	var voterMembership, mStatus, standing string
	if err := s.db.QueryRow(ctx, `SELECT id, status, payment_standing FROM assoc_memberships WHERE user_id=$1 AND organisation_id=$2`, userID, org).Scan(&voterMembership, &mStatus, &standing); err != nil {
		return nil, ErrForbidden // not a member of this org
	}
	switch {
	case mStatus != "ACTIVE":
		d.Eligible, d.EligibilityReason = false, "Membership is not active."
	case requireGood && standing == "OVERDUE":
		d.Eligible, d.EligibilityReason = false, "Dues are in arrears."
	default:
		d.Eligible = true
	}

	// Positions + candidates + hasVoted for the viewer.
	prows, err := s.db.Query(ctx, `SELECT id, title, seats FROM assoc_election_positions WHERE election_id=$1 ORDER BY sort_order`, electionID)
	if err != nil {
		return nil, fmt.Errorf("association: positions: %w", err)
	}
	defer prows.Close()
	for prows.Next() {
		var p ElectionPosition
		if err := prows.Scan(&p.ID, &p.Title, &p.Seats); err != nil {
			return nil, err
		}
		p.Candidates = []ElectionCandidate{}
		d.Positions = append(d.Positions, p)
	}
	if err := prows.Err(); err != nil {
		return nil, err
	}
	for i := range d.Positions {
		p := &d.Positions[i]
		crows, err := s.db.Query(ctx, `
			SELECT c.id, COALESCE(mp.full_name, m.member_code, c.id::text), COALESCE(c.manifesto,''), c.status
			FROM assoc_election_candidates c
			JOIN assoc_memberships m ON m.id=c.membership_id
			LEFT JOIN assoc_member_profiles mp ON mp.membership_id=m.id
			WHERE c.position_id=$1 AND c.status='APPROVED'
			ORDER BY c.created_at`, p.ID)
		if err != nil {
			return nil, err
		}
		for crows.Next() {
			var c ElectionCandidate
			if err := crows.Scan(&c.ID, &c.Name, &c.Manifesto, &c.Status); err != nil {
				crows.Close()
				return nil, err
			}
			p.Candidates = append(p.Candidates, c)
		}
		crows.Close()
		if err := crows.Err(); err != nil {
			return nil, err
		}
		_ = s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM assoc_election_ballots_cast WHERE position_id=$1 AND voter_membership_id=$2)`, p.ID, voterMembership).Scan(&p.HasVoted)
	}

	// Sealed results: choices/tallies are only exposed once PUBLISHED.
	if d.Status == "PUBLISHED" {
		res, err := s.publishedResults(ctx, electionID)
		if err != nil {
			return nil, err
		}
		d.Results = res
	}
	return d, nil
}

// publishedResults reads the immutable snapshot for a PUBLISHED election.
func (s *Service) publishedResults(ctx context.Context, electionID string) ([]PositionResult, error) {
	rows, err := s.db.Query(ctx, `
		SELECT p.id, p.title, p.seats, r.candidate_id,
		       COALESCE(mp.full_name, m.member_code, r.candidate_id::text), r.votes, r.is_winner, r.checksum,
		       (SELECT count(*) FROM assoc_election_ballots_cast bc WHERE bc.position_id=p.id)
		FROM assoc_election_results r
		JOIN assoc_election_positions p ON p.id=r.position_id
		JOIN assoc_election_candidates c ON c.id=r.candidate_id
		JOIN assoc_memberships m ON m.id=c.membership_id
		LEFT JOIN assoc_member_profiles mp ON mp.membership_id=m.id
		WHERE r.election_id=$1
		ORDER BY p.sort_order, r.votes DESC, r.candidate_id`, electionID)
	if err != nil {
		return nil, fmt.Errorf("association: published results: %w", err)
	}
	defer rows.Close()
	byPos := map[string]*PositionResult{}
	order := []string{}
	for rows.Next() {
		var posID, title, candID, name, checksum string
		var seats, votes, cast int
		var winner bool
		if err := rows.Scan(&posID, &title, &seats, &candID, &name, &votes, &winner, &checksum, &cast); err != nil {
			return nil, err
		}
		pr, ok := byPos[posID]
		if !ok {
			pr = &PositionResult{PositionID: posID, Title: title, Seats: seats, BallotsCast: cast, Checksum: checksum, Results: []CandidateResult{}}
			byPos[posID] = pr
			order = append(order, posID)
		}
		pr.Results = append(pr.Results, CandidateResult{CandidateID: candID, Name: name, Votes: votes, IsWinner: winner})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]PositionResult, 0, len(order))
	for _, id := range order {
		out = append(out, *byPos[id])
	}
	return out, nil
}

// ─── winner -> role handover (EL-015 / EC-011) ────────────────────────────────

type PositionHandover struct {
	PositionID string   `json:"positionId"`
	Title      string   `json:"title"`
	Role       string   `json:"role"`
	Winners    []string `json:"winners"` // names granted the role
	Revoked    int      `json:"revoked"` // outgoing holders whose role was revoked
}

type HandoverResult struct {
	Positions []PositionHandover `json:"positions"`
}

// requireSeniorOfficer requires NATIONAL_ADMIN or SUPER_ADMIN in the org — handover
// grants/revokes admin roles, so it needs the highest governance authority.
func (s *Service) requireSeniorOfficer(ctx context.Context, userID, orgID string) error {
	if orgID == "" {
		return ErrForbidden
	}
	if s.isPlatformSuperAdmin(ctx, userID) {
		return nil
	}
	var n int
	if err := s.db.QueryRow(ctx, `
		SELECT count(*) FROM assoc_member_roles r
		JOIN assoc_memberships m ON m.id = r.membership_id
		WHERE m.user_id = $1 AND m.organisation_id = $2 AND r.role IN ('NATIONAL_ADMIN','SUPER_ADMIN')`,
		userID, orgID).Scan(&n); err != nil || n == 0 {
		return ErrForbidden
	}
	return nil
}

// HandoverElection applies the post-election role handover: for every position that
// confers a role, the winner(s) are granted that role in the org and the outgoing
// holders of the role are revoked (no lingering access — EC-011). Exactly-once via
// elections.handover_at; only from PUBLISHED. A position with no winner is skipped
// (no vacancy is created). Every change is audited.
func (s *Service) HandoverElection(ctx context.Context, userID, electionID string) (*HandoverResult, error) {
	orgID, err := s.electionOrg(ctx, electionID)
	if err != nil {
		return nil, err
	}
	if err := s.requireSeniorOfficer(ctx, userID, orgID); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Claim the handover exactly once: only from PUBLISHED and only if not already done.
	tag, err := tx.Exec(ctx, `UPDATE assoc_elections SET handover_at=now() WHERE id=$1 AND status='PUBLISHED' AND handover_at IS NULL`, electionID)
	if err != nil {
		return nil, fmt.Errorf("association: claim handover: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrElectionState // not published, or already handed over
	}

	// Positions that confer a role.
	prows, err := tx.Query(ctx, `SELECT id, title, role FROM assoc_election_positions WHERE election_id=$1 AND role IS NOT NULL ORDER BY sort_order`, electionID)
	if err != nil {
		return nil, fmt.Errorf("association: handover positions: %w", err)
	}
	type posRole struct{ id, title, role string }
	var positions []posRole
	for prows.Next() {
		var p posRole
		if err := prows.Scan(&p.id, &p.title, &p.role); err != nil {
			prows.Close()
			return nil, err
		}
		positions = append(positions, p)
	}
	prows.Close()
	if err := prows.Err(); err != nil {
		return nil, err
	}

	out := &HandoverResult{Positions: []PositionHandover{}}
	for _, p := range positions {
		// Winner(s) for this position, from the immutable results snapshot.
		wrows, err := tx.Query(ctx, `
			SELECT c.membership_id, COALESCE(mp.full_name, m.member_code, c.membership_id::text)
			FROM assoc_election_results r
			JOIN assoc_election_candidates c ON c.id = r.candidate_id
			JOIN assoc_memberships m ON m.id = c.membership_id
			LEFT JOIN assoc_member_profiles mp ON mp.membership_id = m.id
			WHERE r.election_id=$1 AND r.position_id=$2 AND r.is_winner=true`, electionID, p.id)
		if err != nil {
			return nil, fmt.Errorf("association: handover winners: %w", err)
		}
		type winner struct{ mid, name string }
		var winners []winner
		for wrows.Next() {
			var w winner
			if err := wrows.Scan(&w.mid, &w.name); err != nil {
				wrows.Close()
				return nil, err
			}
			winners = append(winners, w)
		}
		wrows.Close()
		if err := wrows.Err(); err != nil {
			return nil, err
		}

		// No winner (e.g. no votes / no candidates) → skip; never leave a vacancy.
		if len(winners) == 0 {
			out.Positions = append(out.Positions, PositionHandover{PositionID: p.id, Title: p.title, Role: p.role, Winners: []string{}, Revoked: 0})
			continue
		}

		// Revoke outgoing holders of this role in the org (delete-then-grant also
		// cleanly handles a re-elected incumbent).
		delTag, err := tx.Exec(ctx, `
			DELETE FROM assoc_member_roles r
			USING assoc_memberships m
			WHERE r.membership_id = m.id AND m.organisation_id = $1 AND r.role = $2`, orgID, p.role)
		if err != nil {
			return nil, fmt.Errorf("association: revoke role: %w", err)
		}
		revoked := int(delTag.RowsAffected())

		names := make([]string, 0, len(winners))
		for _, w := range winners {
			if _, err := tx.Exec(ctx, `
				INSERT INTO assoc_member_roles (id, membership_id, role, jurisdiction, granted_by)
				VALUES ($1,$2,$3,'NATIONAL',$4)`, uuid.New().String(), w.mid, p.role, userID); err != nil {
				return nil, fmt.Errorf("association: grant role: %w", err)
			}
			names = append(names, w.name)
		}
		if err := s.audit(ctx, tx, orgID, userID, "ROLE_HANDOVER", "election_position", p.id,
			map[string]any{"role": p.role, "revoked": revoked, "granted": len(winners)}); err != nil {
			return nil, err
		}
		out.Positions = append(out.Positions, PositionHandover{PositionID: p.id, Title: p.title, Role: p.role, Winners: names, Revoked: revoked})
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}
