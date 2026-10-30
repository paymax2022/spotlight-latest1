package estate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// election_governance.go — Block 31/Phase 2.2: the workflow that surrounds a ballot.
// The election domain previously had a ballot plus an eligibility switch: an estate could
// gate *who* may vote, but could not publish a roll, vet candidates, require a quorum,
// break a tie, entertain a complaint, cancel a poll or run a non-binding vote. Each of
// those is a governance act, so each is its own entity here rather than a flag on
// elections.
//
// Ballot secrecy (Phase 2.1) constrains everything below: no method in this file may
// read, return or derive a voter→choice pair. Turnout and recount surfaces aggregate;
// the roll lists names (a published roll is not a ballot); the ballot table is only ever
// counted, never joined to election_votes.

// Election configuration enumerations.
const (
	ElectionKindBinding = "binding"
	ElectionKindPoll    = "poll"

	WeightingOnePersonOneVote = "one_person_one_vote"
	WeightingOneVotePerUnit   = "one_vote_per_unit"

	QuorumTypeNone    = "none"
	QuorumTypePercent = "percent"
	QuorumTypeCount   = "count"

	TieBreakNone              = "none"
	TieBreakEarliestCandidate = "earliest_candidate"
	TieBreakRunoff            = "runoff"
)

// ReasonNotOnRoll is the block reason a frozen roll produces: the configured rules said
// yes, the published roll says no (EST-UAT-0219).
const ReasonNotOnRoll = "not_on_roll"

// ElectionConfigRequest is the body for POST /estate/:id/elections/:electionId/config.
// Empty strings and nil times mean "leave as is": the endpoint patches, so a client can
// change one rule without re-sending (and possibly mistyping) the others.
type ElectionConfigRequest struct {
	Kind               string     `json:"kind"`
	Weighting          string     `json:"weighting"`
	QuorumType         string     `json:"quorum_type"`
	QuorumValue        *int       `json:"quorum_value"`
	TieBreak           string     `json:"tie_break"`
	NominationOpensAt  *time.Time `json:"nomination_opens_at"`
	NominationClosesAt *time.Time `json:"nomination_closes_at"`
}

// RuleProposal is a pending (or decided) change to an election's eligibility rules.
type RuleProposal struct {
	ID             string     `json:"id"`
	ElectionID     string     `json:"election_id"`
	RequireKYC     bool       `json:"require_kyc"`
	RequirePayment bool       `json:"require_payment"`
	ResidentTypes  []string   `json:"resident_types"`
	ProposedBy     string     `json:"proposed_by"`
	ProposedAt     time.Time  `json:"proposed_at"`
	State          string     `json:"state"`
	DecidedBy      string     `json:"decided_by,omitempty"`
	DecidedAt      *time.Time `json:"decided_at,omitempty"`
	DecisionNote   string     `json:"decision_note,omitempty"`
}

// ElectionRoll is one version of an election's voter list.
type ElectionRoll struct {
	ID            string     `json:"id"`
	ElectionID    string     `json:"election_id"`
	Version       int        `json:"version"`
	Status        string     `json:"status"`
	BuiltBy       string     `json:"built_by,omitempty"`
	BuiltAt       time.Time  `json:"built_at"`
	FrozenBy      string     `json:"frozen_by,omitempty"`
	FrozenAt      *time.Time `json:"frozen_at,omitempty"`
	EligibleCount int        `json:"eligible_count"`
	// TotalBallots is the sum of entry weights: the denominator a one_vote_per_unit
	// election measures turnout against (EST-UAT-0205/0223).
	TotalBallots int `json:"total_ballots"`
}

// ElectionRollEntry is one voter on one roll version.
type ElectionRollEntry struct {
	RollID        string `json:"roll_id"`
	UserID        string `json:"user_id"`
	FullName      string `json:"full_name"`
	Unit          string `json:"unit"`
	OccupancyType string `json:"occupancy_type"`
	Weight        int    `json:"weight"`
	Source        string `json:"source"` // built | exception
	Status        string `json:"status"` // active | removed
	RemovalReason string `json:"removal_reason,omitempty"`
}

// RollChallenge is a member's objection to an entry on a published roll (EST-UAT-0208).
type RollChallenge struct {
	ID            string     `json:"id"`
	ElectionID    string     `json:"election_id"`
	RollID        string     `json:"roll_id"`
	SubjectUserID string     `json:"subject_user_id"`
	SubjectName   string     `json:"subject_name"`
	RaisedBy      string     `json:"raised_by"`
	Reason        string     `json:"reason"`
	State         string     `json:"state"`
	ResolvedBy    string     `json:"resolved_by,omitempty"`
	ResolvedAt    *time.Time `json:"resolved_at,omitempty"`
	Resolution    string     `json:"resolution,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

// Nomination is a proposed candidacy with its own accept/vet/certify lifecycle
// (EST-UAT-0209/0210/0211).
type Nomination struct {
	ID            string     `json:"id"`
	ElectionID    string     `json:"election_id"`
	NomineeUserID string     `json:"nominee_user_id"`
	NomineeName   string     `json:"nominee_name"`
	NominatedBy   string     `json:"nominated_by,omitempty"`
	NominatedName string     `json:"nominated_name,omitempty"`
	Seat          string     `json:"seat,omitempty"`
	Statement     string     `json:"statement,omitempty"`
	State         string     `json:"state"`
	VettingState  string     `json:"vetting_state"`
	Reason        string     `json:"reason,omitempty"`
	CandidateID   string     `json:"candidate_id,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	DecidedAt     *time.Time `json:"decided_at,omitempty"`
}

// NominationRequest is the body for POST /estate/:id/elections/:electionId/nominations.
type NominationRequest struct {
	NomineeUserID string `json:"nominee_user_id" binding:"required"`
	Seat          string `json:"seat"`
	Statement     string `json:"statement"`
}

// Complaint is a member grievance about an election, optionally a recount demand.
type Complaint struct {
	ID         string     `json:"id"`
	ElectionID string     `json:"election_id"`
	RaisedBy   string     `json:"raised_by"`
	Kind       string     `json:"kind"`
	Detail     string     `json:"detail"`
	State      string     `json:"state"`
	ResolvedBy string     `json:"resolved_by,omitempty"`
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
	Resolution string     `json:"resolution,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// ComplaintRequest is the body for POST /estate/:id/elections/:electionId/complaints.
type ComplaintRequest struct {
	Kind   string `json:"kind"` // complaint | recount (default complaint)
	Detail string `json:"detail" binding:"required,min=5,max=4000"`
}

// Recount is a re-tabulated aggregate snapshot (EST-UAT-0227). Totals are derived from
// election_ballots counts, so a recount cannot reintroduce a voter→choice link.
type Recount struct {
	ID          string      `json:"id"`
	ElectionID  string      `json:"election_id"`
	RequestedBy string      `json:"requested_by,omitempty"`
	ComplaintID string      `json:"complaint_id,omitempty"`
	TalliedAt   time.Time   `json:"tallied_at"`
	BallotsCast int         `json:"ballots_cast"`
	Abstentions int         `json:"abstentions"`
	Totals      []Candidate `json:"totals"`
	Note        string      `json:"note,omitempty"`
}

// Outcome is the governance verdict of a finished election: the tally plus the quorum
// and tie-break reasoning that turns a tally into a result (EST-UAT-0223/0225/0230).
type Outcome struct {
	ElectionID     string      `json:"election_id"`
	Title          string      `json:"title"`
	Kind           string      `json:"kind"`
	Status         string      `json:"status"`
	Weighting      string      `json:"weighting"`
	Binding        bool        `json:"binding"`
	EligibleVoters int         `json:"eligible_voters"`
	BallotsAvail   int         `json:"ballots_available"`
	VotersCast     int         `json:"voters_cast"`
	BallotsCast    int         `json:"ballots_cast"`
	Abstentions    int         `json:"abstentions"`
	TurnoutPercent float64     `json:"turnout_percent"`
	QuorumType     string      `json:"quorum_type"`
	QuorumValue    int         `json:"quorum_value"`
	QuorumRequired int         `json:"quorum_required"`
	QuorumMet      bool        `json:"quorum_met"`
	Results        []Candidate `json:"results"`
	TopVotes       int         `json:"top_votes"`
	WinnerIDs      []string    `json:"winner_ids,omitempty"`
	TieBreak       string      `json:"tie_break"`
	Verdict        string      `json:"verdict"` // decided | tie | runoff_required | no_quorum | cancelled | no_ballots
	TieBreakNote   string      `json:"tie_break_note,omitempty"`
	Cancellation   string      `json:"cancellation_reason,omitempty"`
	OpenComplaints int         `json:"open_complaints"`
}

// Turnout is the mid-poll participation view (admin only): how close the election is to
// its quorum, with no candidate-level figures — a live per-candidate tally is exactly
// what ESTB-D006 sealed.
type Turnout struct {
	ElectionID     string  `json:"election_id"`
	Status         string  `json:"status"`
	Weighting      string  `json:"weighting"`
	EligibleVoters int     `json:"eligible_voters"`
	BallotsAvail   int     `json:"ballots_available"`
	VotersCast     int     `json:"voters_cast"`
	BallotsCast    int     `json:"ballots_cast"`
	TurnoutPercent float64 `json:"turnout_percent"`
	QuorumType     string  `json:"quorum_type"`
	QuorumValue    int     `json:"quorum_value"`
	QuorumRequired int     `json:"quorum_required"`
	QuorumMet      bool    `json:"quorum_met"`
}

// electionCols is the single projection every election read in this file uses, so the
// governance columns cannot be forgotten on one path and present on another.
const electionCols = `id, estate_id, title, COALESCE(description,'') AS description, starts_at, ends_at, status, created_by, created_at,
	kind, weighting, quorum_type, quorum_value, tie_break, nomination_opens_at, nomination_closes_at,
	roll_frozen_at, rules_locked_at, cancelled_at, COALESCE(cancellation_reason,'') AS cancellation_reason`

func (s *Service) loadElection(ctx context.Context, estateID, electionID string) (*Election, error) {
	e := &Election{}
	err := s.db.QueryRow(ctx, `SELECT `+electionCols+` FROM elections WHERE id=$1 AND estate_id=$2`, electionID, estateID).Scan(
		&e.ID, &e.EstateID, &e.Title, &e.Description, &e.StartsAt, &e.EndsAt, &e.Status,
		&e.CreatedBy, &e.CreatedAt, &e.Kind, &e.Weighting, &e.QuorumType, &e.QuorumValue,
		&e.TieBreak, &e.NominationOpensAt, &e.NominationClosesAt, &e.RollFrozenAt,
		&e.RulesLockedAt, &e.CancelledAt, &e.CancellationReason,
	)
	if err != nil {
		return nil, errors.New("estate: election not found")
	}
	return e, nil
}

func validKind(s string) bool { return s == ElectionKindBinding || s == ElectionKindPoll }
func validWeighting(s string) bool {
	return s == WeightingOnePersonOneVote || s == WeightingOneVotePerUnit
}
func validQuorumType(s string) bool {
	return s == QuorumTypeNone || s == QuorumTypePercent || s == QuorumTypeCount
}
func validTieBreak(s string) bool {
	return s == TieBreakNone || s == TieBreakEarliestCandidate || s == TieBreakRunoff
}

// ------------------------------------------------------------------ configuration

// UpdateElectionConfig sets the governance rules of a draft election (admin only):
// binding vs informal poll, per-unit weighting, quorum, tie-break and the nomination
// window. Configuration closes when the election opens, and weighting closes as soon as
// a roll is frozen, because both decide how ballots are counted.
func (s *Service) UpdateElectionConfig(ctx context.Context, estateID, adminID, electionID string, req ElectionConfigRequest) (*Election, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if req.Kind != "" && !validKind(req.Kind) {
		return nil, fmt.Errorf("estate: invalid kind %q", req.Kind)
	}
	if req.Weighting != "" && !validWeighting(req.Weighting) {
		return nil, fmt.Errorf("estate: invalid weighting %q", req.Weighting)
	}
	if req.QuorumType != "" && !validQuorumType(req.QuorumType) {
		return nil, fmt.Errorf("estate: invalid quorum_type %q", req.QuorumType)
	}
	if req.TieBreak != "" && !validTieBreak(req.TieBreak) {
		return nil, fmt.Errorf("estate: invalid tie_break %q", req.TieBreak)
	}
	if req.QuorumValue != nil && *req.QuorumValue < 0 {
		return nil, errors.New("estate: quorum_value must be zero or greater")
	}
	if req.NominationOpensAt != nil && req.NominationClosesAt != nil && !req.NominationClosesAt.After(*req.NominationOpensAt) {
		return nil, errors.New("estate: nomination_closes_at must be after nomination_opens_at")
	}

	el, err := s.loadElection(ctx, estateID, electionID)
	if err != nil {
		return nil, err
	}
	if el.Status != "draft" {
		return nil, fmt.Errorf("estate: election configuration cannot change once the election is %s", el.Status)
	}
	if el.RulesLockedAt != nil {
		return nil, errors.New("estate: election rules are locked — approve an amendment to change them")
	}
	if req.Weighting != "" && req.Weighting != el.Weighting {
		if _, err := s.currentRoll(ctx, electionID); err == nil {
			return nil, errors.New("estate: an electoral roll already exists — rebuild it after changing the weighting")
		}
	}

	quorum := -1
	if req.QuorumValue != nil {
		quorum = *req.QuorumValue
	}
	const q = `
		UPDATE elections SET
			kind               = COALESCE(NULLIF($2,''), kind),
			weighting          = COALESCE(NULLIF($3,''), weighting),
			quorum_type        = COALESCE(NULLIF($4,''), quorum_type),
			quorum_value       = CASE WHEN $5::int < 0 THEN quorum_value ELSE $5::int END,
			tie_break          = COALESCE(NULLIF($6,''), tie_break),
			nomination_opens_at  = COALESCE($7, nomination_opens_at),
			nomination_closes_at = COALESCE($8, nomination_closes_at)
		WHERE id=$1 AND estate_id=$9 AND status='draft'
		RETURNING ` + electionCols
	e := &Election{}
	err = s.db.QueryRow(ctx, q, electionID, req.Kind, req.Weighting, req.QuorumType, quorum, req.TieBreak,
		req.NominationOpensAt, req.NominationClosesAt, estateID).Scan(
		&e.ID, &e.EstateID, &e.Title, &e.Description, &e.StartsAt, &e.EndsAt, &e.Status,
		&e.CreatedBy, &e.CreatedAt, &e.Kind, &e.Weighting, &e.QuorumType, &e.QuorumValue,
		&e.TieBreak, &e.NominationOpensAt, &e.NominationClosesAt, &e.RollFrozenAt,
		&e.RulesLockedAt, &e.CancelledAt, &e.CancellationReason,
	)
	if err != nil {
		return nil, errors.New("estate: election not found")
	}
	if e.QuorumType == QuorumTypePercent && (e.QuorumValue < 1 || e.QuorumValue > 100) {
		return nil, errors.New("estate: a percent quorum must be between 1 and 100")
	}
	if e.QuorumType == QuorumTypeCount && e.QuorumValue < 1 {
		return nil, errors.New("estate: a count quorum must be at least 1 ballot")
	}
	_ = s.audit(ctx, estateID, adminID, "ELECTION_CONFIG", "election", electionID, map[string]any{
		"kind": e.Kind, "weighting": e.Weighting, "quorum_type": e.QuorumType,
		"quorum_value": e.QuorumValue, "tie_break": e.TieBreak,
	})
	return e, nil
}

// ------------------------------------------------------------------ rule approval

// ProposeElectionRules files the eligibility rules for approval instead of applying them
// (EST-UAT-0203). Re-proposing while a draft is still pending replaces that draft rather
// than stacking versions.
func (s *Service) ProposeElectionRules(ctx context.Context, estateID, adminID, electionID string, req SetEligibilityRulesRequest) (*RuleProposal, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	el, err := s.loadElection(ctx, estateID, electionID)
	if err != nil {
		return nil, err
	}
	if el.Status != "draft" {
		return nil, fmt.Errorf("estate: eligibility rules cannot be proposed once the election is %s", el.Status)
	}
	if el.RulesLockedAt != nil {
		return nil, errors.New("estate: election rules are locked — a proposal would have no effect until the lock is lifted")
	}
	types := req.ResidentTypes
	if types == nil {
		types = []string{}
	}
	// The pending draft is unique per election (partial index), so update-then-insert
	// keeps "edit before approval" a single live proposal.
	var replaced string
	_ = s.db.QueryRow(ctx, `
		UPDATE election_rule_proposals
		SET require_kyc=$2, require_payment=$3, resident_types=$4
		WHERE election_id=$1 AND state='pending' AND proposed_by=$5
		RETURNING id`, electionID, req.RequireKYC, req.RequirePayment, types, adminID).Scan(&replaced)
	if replaced == "" {
		if err := s.db.QueryRow(ctx, `SELECT id FROM election_rule_proposals WHERE election_id=$1 AND state='pending'`, electionID).Scan(&replaced); err == nil {
			return nil, errors.New("estate: another admin already has a pending proposal for this election")
		}
		p := &RuleProposal{}
		const ins = `
			INSERT INTO election_rule_proposals (id, election_id, require_kyc, require_payment, resident_types, proposed_by)
			VALUES ($1,$2,$3,$4,$5,$6)
			RETURNING id, election_id, require_kyc, require_payment, resident_types, proposed_by, proposed_at, state`
		if err := s.db.QueryRow(ctx, ins, uuid.New().String(), electionID, req.RequireKYC, req.RequirePayment, types, adminID).
			Scan(&p.ID, &p.ElectionID, &p.RequireKYC, &p.RequirePayment, &p.ResidentTypes, &p.ProposedBy, &p.ProposedAt, &p.State); err != nil {
			return nil, fmt.Errorf("estate: propose rules: %w", err)
		}
		replaced = p.ID
	}
	var prop RuleProposal
	const sel = `SELECT id, election_id, require_kyc, require_payment, resident_types, proposed_by, proposed_at, state FROM election_rule_proposals WHERE id=$1`
	if err := s.db.QueryRow(ctx, sel, replaced).Scan(
		&prop.ID, &prop.ElectionID, &prop.RequireKYC, &prop.RequirePayment,
		&prop.ResidentTypes, &prop.ProposedBy, &prop.ProposedAt, &prop.State); err != nil {
		return nil, errors.New("estate: proposal not found")
	}
	_ = s.audit(ctx, estateID, adminID, "ELECTION_RULES_PROPOSED", "election", electionID, map[string]any{
		"proposal_id": prop.ID, "require_kyc": prop.RequireKYC, "require_payment": prop.RequirePayment,
		"resident_types": prop.ResidentTypes,
	})
	return &prop, nil
}

// DecideElectionRules approves or rejects a pending proposal. Approval is the lock: the
// rules land in election_eligibility_rules with a bumped version, approved_by/at are
// recorded, and elections.rules_locked_at is set, which closes both the direct setter and
// further proposals for this election (EST-UAT-0203).
func (s *Service) DecideElectionRules(ctx context.Context, estateID, adminID, electionID, proposalID string, approve bool, note string) (*EligibilityRules, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	var (
		prop RuleProposal
	)
	const sel = `SELECT id, election_id, require_kyc, require_payment, resident_types, state FROM election_rule_proposals WHERE id=$1 AND election_id=$2`
	if err := s.db.QueryRow(ctx, sel, proposalID, electionID).Scan(
		&prop.ID, &prop.ElectionID, &prop.RequireKYC, &prop.RequirePayment, &prop.ResidentTypes, &prop.State); err != nil {
		return nil, errors.New("estate: proposal not found for this election")
	}
	if prop.State != "pending" {
		return nil, fmt.Errorf("estate: proposal is already %s", prop.State)
	}
	el, err := s.loadElection(ctx, estateID, electionID)
	if err != nil {
		return nil, err
	}
	if el.Status != "draft" && approve {
		return nil, fmt.Errorf("estate: cannot approve rules for a %s election", el.Status)
	}

	state := "rejected"
	if approve {
		state = "approved"
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("estate: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		UPDATE election_rule_proposals
		SET state=$2, decided_by=$3, decided_at=NOW(), decision_note=NULLIF($4,'')
		WHERE id=$1 AND state='pending'`, proposalID, state, adminID, note); err != nil {
		return nil, fmt.Errorf("estate: decide proposal: %w", err)
	}
	if approve {
		types := prop.ResidentTypes
		if types == nil {
			types = []string{}
		}
		const apply = `
			INSERT INTO election_eligibility_rules (election_id, require_kyc, require_payment, resident_types, updated_by, updated_at, rule_version, approved_by, approved_at)
			VALUES ($1,$2,$3,$4,$5,NOW(),1,$5,NOW())
			ON CONFLICT (election_id) DO UPDATE SET
				require_kyc=EXCLUDED.require_kyc,
				require_payment=EXCLUDED.require_payment,
				resident_types=EXCLUDED.resident_types,
				updated_by=EXCLUDED.updated_by,
				updated_at=NOW(),
				rule_version=election_eligibility_rules.rule_version + 1,
				approved_by=EXCLUDED.approved_by,
				approved_at=NOW()`
		if _, err := tx.Exec(ctx, apply, electionID, prop.RequireKYC, prop.RequirePayment, types, adminID); err != nil {
			return nil, fmt.Errorf("estate: apply approved rules: %w", err)
		}
		if _, err := tx.Exec(ctx, `UPDATE elections SET rules_locked_at=NOW() WHERE id=$1 AND estate_id=$2 AND rules_locked_at IS NULL`, electionID, estateID); err != nil {
			return nil, fmt.Errorf("estate: lock rules: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("estate: commit: %w", err)
	}
	_ = s.audit(ctx, estateID, adminID, "ELECTION_RULES_"+strings.ToUpper(state), "election", electionID, map[string]any{
		"proposal_id": proposalID, "note": note,
	})
	rules := EligibilityRules{ElectionID: electionID, RequireKYC: prop.RequireKYC, RequirePayment: prop.RequirePayment, ResidentTypes: prop.ResidentTypes}
	return &rules, nil
}

// ListElectionRuleProposals returns an election's proposals, newest first (admin only).
func (s *Service) ListElectionRuleProposals(ctx context.Context, estateID, adminID, electionID string) ([]RuleProposal, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if _, err := s.loadElection(ctx, estateID, electionID); err != nil {
		return nil, err
	}
	const q = `SELECT id, election_id, require_kyc, require_payment, resident_types, proposed_by, proposed_at,
		COALESCE(decided_by::text,''), decided_at, COALESCE(decision_note,''), state
		FROM election_rule_proposals WHERE election_id=$1 ORDER BY proposed_at DESC`
	rows, err := s.db.Query(ctx, q, electionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RuleProposal
	for rows.Next() {
		var p RuleProposal
		if err := rows.Scan(&p.ID, &p.ElectionID, &p.RequireKYC, &p.RequirePayment, &p.ResidentTypes,
			&p.ProposedBy, &p.ProposedAt, &p.DecidedBy, &p.DecidedAt, &p.DecisionNote, &p.State); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ------------------------------------------------------------------ electoral roll

func (s *Service) currentRoll(ctx context.Context, electionID string) (*ElectionRoll, error) {
	const q = `SELECT id, election_id, version, status, COALESCE(built_by::text,''), built_at,
		COALESCE(frozen_by::text,''), frozen_at, eligible_count
		FROM election_rolls WHERE election_id=$1
		ORDER BY (status='frozen') DESC, version DESC LIMIT 1`
	r := &ElectionRoll{}
	if err := s.db.QueryRow(ctx, q, electionID).Scan(
		&r.ID, &r.ElectionID, &r.Version, &r.Status, &r.BuiltBy, &r.BuiltAt,
		&r.FrozenBy, &r.FrozenAt, &r.EligibleCount); err != nil {
		return nil, errors.New("estate: this election has no electoral roll yet")
	}
	r.TotalBallots = s.rollBallotWeight(ctx, r.ID)
	return r, nil
}

func (s *Service) rollBallotWeight(ctx context.Context, rollID string) int {
	var sum int
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(SUM(weight),0)::int FROM election_roll_entries WHERE roll_id=$1 AND status='active'`, rollID).Scan(&sum)
	return sum
}

// BuildElectionRoll snapshots the estate's eligible residents into a new draft roll
// version (EST-UAT-0204). It is re-buildable while the election is still draft; once
// frozen, the only ways to change the franchise are a resolved challenge (0208) or an
// audited exception/removal (0219) — which is exactly what makes a published roll mean
// something.
func (s *Service) BuildElectionRoll(ctx context.Context, estateID, adminID, electionID string) (*ElectionRoll, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	el, err := s.loadElection(ctx, estateID, electionID)
	if err != nil {
		return nil, err
	}
	if el.Status != "draft" {
		return nil, fmt.Errorf("estate: the roll cannot be rebuilt once the election is %s", el.Status)
	}
	rules, err := s.loadEligibilityRules(ctx, electionID)
	if err != nil {
		return nil, err
	}
	types := rules.ResidentTypes
	if types == nil {
		types = []string{}
	}

	roll := &ElectionRoll{ID: uuid.New().String(), ElectionID: electionID, Status: "draft", BuiltBy: adminID, BuiltAt: time.Now()}
	const insRoll = `
		INSERT INTO election_rolls (id, election_id, version, status, built_by, built_at)
		VALUES ($1,$2,(SELECT COALESCE(MAX(version),0)+1 FROM election_rolls WHERE election_id=$2),'draft',$3,NOW())
		RETURNING id, election_id, version, status, COALESCE(built_by::text,''), built_at, eligible_count`
	if err := s.db.QueryRow(ctx, insRoll, roll.ID, electionID, adminID).Scan(
		&roll.ID, &roll.ElectionID, &roll.Version, &roll.Status, &roll.BuiltBy, &roll.BuiltAt, &roll.EligibleCount); err != nil {
		return nil, fmt.Errorf("estate: create roll: %w", err)
	}

	// Resident type and dues are estate facts, so they filter here. KYC lives behind the
	// KYCVerifier interface (a per-user remote check), so it stays a vote-time gate in
	// CheckVoterEligibility rather than pretending to be a roll query.
	const insEntries = `
		INSERT INTO election_roll_entries (id, roll_id, user_id, weight, source)
		SELECT gen_random_uuid(), $2, r.user_id,
		       CASE WHEN $5 = 'one_vote_per_unit' THEN GREATEST(1, (
		            SELECT COUNT(*) FROM estate_properties p
		            WHERE p.estate_id=$1 AND p.archived=FALSE
		              AND (p.landlord_id = r.user_id OR p.tenant_id = r.user_id))) ELSE 1 END,
		       'built'
		FROM estate_residents r
		LEFT JOIN resident_profiles rp ON rp.resident_id = r.id
		WHERE r.estate_id=$1 AND r.deleted_at IS NULL AND r.banned_at IS NULL
		  AND ($3::text[] = '{}'::text[] OR COALESCE(rp.occupancy_type,'') = ANY($3))
		  AND (NOT $4 OR NOT EXISTS (
		        SELECT 1 FROM estate_dues_invoices d
		        WHERE d.estate_id=$1 AND d.resident_id=r.user_id
		          AND (d.status='overdue' OR (d.status='pending' AND d.due_date < NOW()))))
		ON CONFLICT (roll_id, user_id) DO NOTHING`
	tag, err := s.db.Exec(ctx, insEntries, estateID, roll.ID, types, rules.RequirePayment, el.Weighting)
	if err != nil {
		return nil, fmt.Errorf("estate: build roll entries: %w", err)
	}
	roll.EligibleCount = int(tag.RowsAffected())
	if _, err := s.db.Exec(ctx, `UPDATE election_rolls SET eligible_count=$2 WHERE id=$1`, roll.ID, roll.EligibleCount); err != nil {
		return nil, fmt.Errorf("estate: record roll size: %w", err)
	}
	roll.TotalBallots = s.rollBallotWeight(ctx, roll.ID)
	_ = s.audit(ctx, estateID, adminID, "ELECTION_ROLL_BUILT", "election", electionID, map[string]any{
		"roll_id": roll.ID, "version": roll.Version, "eligible": roll.EligibleCount, "ballots": roll.TotalBallots,
	})
	return roll, nil
}

// FreezeElectionRoll publishes a draft roll and makes it the ballot's source of truth:
// estate_cast_vote refuses any voter who is not an active entry on the newest frozen roll
// (EST-UAT-0204/0219).
func (s *Service) FreezeElectionRoll(ctx context.Context, estateID, adminID, electionID, rollID string) (*ElectionRoll, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	el, err := s.loadElection(ctx, estateID, electionID)
	if err != nil {
		return nil, err
	}
	if el.Status == "cancelled" {
		return nil, errors.New("estate: cannot freeze a roll for a cancelled election")
	}
	const q = `
		UPDATE election_rolls SET status='frozen', frozen_by=$3, frozen_at=NOW()
		WHERE id=$1 AND election_id=$2 AND status='draft'
		RETURNING id, election_id, version, status, COALESCE(built_by::text,''), built_at,
		          COALESCE(frozen_by::text,''), frozen_at, eligible_count`
	r := &ElectionRoll{}
	if err := s.db.QueryRow(ctx, q, rollID, electionID, adminID).Scan(
		&r.ID, &r.ElectionID, &r.Version, &r.Status, &r.BuiltBy, &r.BuiltAt,
		&r.FrozenBy, &r.FrozenAt, &r.EligibleCount); err != nil {
		return nil, errors.New("estate: roll not found, or it is already frozen")
	}
	if _, err := s.db.Exec(ctx, `UPDATE elections SET roll_frozen_at=NOW() WHERE id=$1 AND estate_id=$2`, electionID, estateID); err != nil {
		return nil, fmt.Errorf("estate: record roll freeze: %w", err)
	}
	r.TotalBallots = s.rollBallotWeight(ctx, r.ID)
	_ = s.audit(ctx, estateID, adminID, "ELECTION_ROLL_FROZEN", "election", electionID, map[string]any{
		"roll_id": r.ID, "version": r.Version, "eligible": r.EligibleCount,
	})
	return r, nil
}

// ListElectionRoll returns one roll version for review (admin only). A roll is a list of
// names, not a ballot: it is published precisely so members can challenge it (0208).
func (s *Service) ListElectionRoll(ctx context.Context, estateID, adminID, electionID string, version int) ([]ElectionRollEntry, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	roll, err := s.currentRoll(ctx, electionID)
	if err != nil {
		return nil, err
	}
	if version > 0 {
		if err := s.db.QueryRow(ctx, `SELECT id FROM election_rolls WHERE election_id=$1 AND version=$2`, electionID, version).Scan(&roll.ID); err != nil {
			return nil, errors.New("estate: no such roll version")
		}
		roll.Version = version
	}
	const q = `
		SELECT en.roll_id, en.user_id,
		       COALESCE(NULLIF(btrim(u.first_name || ' ' || u.last_name), ''), u.email, en.user_id::text),
		       COALESCE(NULLIF(r.unit,''), (SELECT p.unit_label FROM estate_properties p
		           WHERE p.estate_id=$1 AND (p.landlord_id=en.user_id OR p.tenant_id=en.user_id) AND p.archived=FALSE
		           ORDER BY p.unit_label LIMIT 1), ''),
		       COALESCE(rp.occupancy_type,''), en.weight, en.source, en.status, COALESCE(en.removal_reason,'')
		FROM election_roll_entries en
		LEFT JOIN estate_residents r ON r.estate_id=$1 AND r.user_id=en.user_id
		LEFT JOIN resident_profiles rp ON rp.resident_id = r.id
		LEFT JOIN public.platform_users u ON u.id = en.user_id
		WHERE en.roll_id=$2
		ORDER BY en.status, COALESCE(NULLIF(btrim(u.first_name || ' ' || u.last_name), ''), u.email, en.user_id::text)`
	rows, err := s.db.Query(ctx, q, estateID, roll.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ElectionRollEntry
	for rows.Next() {
		var e ElectionRollEntry
		if err := rows.Scan(&e.RollID, &e.UserID, &e.FullName, &e.Unit, &e.OccupancyType,
			&e.Weight, &e.Source, &e.Status, &e.RemovalReason); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ChallengeRollEntry lets a member object to someone else's presence on the roll, or to
// their own omission of a disqualification (EST-UAT-0208). Anyone who can vote can
// challenge: an unpublished, unchallengeable roll is not a published roll.
func (s *Service) ChallengeRollEntry(ctx context.Context, estateID, userID, electionID, subjectUserID, reason string) (*RollChallenge, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	reason = strings.TrimSpace(reason)
	if len(reason) < 5 {
		return nil, errors.New("estate: a roll challenge needs a reason of at least 5 characters")
	}
	el, err := s.loadElection(ctx, estateID, electionID)
	if err != nil {
		return nil, err
	}
	if el.Status == "cancelled" {
		return nil, errors.New("estate: this election has been cancelled")
	}
	roll, err := s.currentRoll(ctx, electionID)
	if err != nil {
		return nil, err
	}
	var onRoll bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM election_roll_entries WHERE roll_id=$1 AND user_id=$2)`, roll.ID, subjectUserID).Scan(&onRoll); err != nil {
		return nil, err
	}
	if !onRoll {
		return nil, errors.New("estate: that voter is not on this roll — a challenge targets a listed entry")
	}
	var duplicate bool
	if err := s.db.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM election_roll_challenges
			WHERE roll_id=$1 AND subject_user_id=$2 AND raised_by=$3 AND state='open')`,
		roll.ID, subjectUserID, userID).Scan(&duplicate); err != nil {
		return nil, err
	}
	if duplicate {
		return nil, errors.New("estate: you have an open challenge against this entry already")
	}
	c := &RollChallenge{ID: uuid.New().String(), ElectionID: electionID, RollID: roll.ID,
		SubjectUserID: subjectUserID, RaisedBy: userID, Reason: reason, State: "open", CreatedAt: time.Now()}
	const ins = `INSERT INTO election_roll_challenges (id, election_id, roll_id, subject_user_id, raised_by, reason)
		VALUES ($1,$2,$3,$4,$5,$6)`
	if _, err := s.db.Exec(ctx, ins, c.ID, c.ElectionID, c.RollID, c.SubjectUserID, c.RaisedBy, c.Reason); err != nil {
		return nil, fmt.Errorf("estate: file challenge: %w", err)
	}
	_ = s.audit(ctx, estateID, userID, "ELECTION_ROLL_CHALLENGE", "election", electionID, map[string]any{
		"challenge_id": c.ID, "roll_version": roll.Version,
	})
	return c, nil
}

// ListRollChallenges returns an election's challenges, open first (admin only).
func (s *Service) ListRollChallenges(ctx context.Context, estateID, adminID, electionID string) ([]RollChallenge, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if _, err := s.loadElection(ctx, estateID, electionID); err != nil {
		return nil, err
	}
	const q = `
		SELECT ch.id, ch.election_id, ch.roll_id, ch.subject_user_id, ch.raised_by, ch.reason, ch.state,
		       COALESCE(ch.resolved_by::text,''), ch.resolved_at, COALESCE(ch.resolution,''), ch.created_at,
		       COALESCE(NULLIF(btrim(u.first_name || ' ' || u.last_name), ''), u.email, '')
		FROM election_roll_challenges ch
		LEFT JOIN public.platform_users u ON u.id = ch.subject_user_id
		WHERE ch.election_id=$1
		ORDER BY (ch.state='open') DESC, ch.created_at DESC`
	rows, err := s.db.Query(ctx, q, electionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RollChallenge
	for rows.Next() {
		var c RollChallenge
		if err := rows.Scan(&c.ID, &c.ElectionID, &c.RollID, &c.SubjectUserID, &c.RaisedBy, &c.Reason,
			&c.State, &c.ResolvedBy, &c.ResolvedAt, &c.Resolution, &c.CreatedAt, &c.SubjectName); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ResolveRollChallenge decides a challenge. Upholding it removes the entry from that
// roll, which is how the franchise is taken away after publication — including mid-poll,
// because estate_cast_vote re-reads the entry on every ballot (EST-UAT-0208/0219).
// A ballot already cast is never touched: retracting it would require knowing whose it
// was, and the choice is deliberately unguessable by design (Phase 2.1).
func (s *Service) ResolveRollChallenge(ctx context.Context, estateID, adminID, challengeID string, uphold bool, resolution string) (*RollChallenge, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	resolution = strings.TrimSpace(resolution)
	if len(resolution) < 5 {
		return nil, errors.New("estate: a challenge resolution needs at least 5 characters")
	}
	var c RollChallenge
	const sel = `
		SELECT ch.id, ch.election_id, ch.roll_id, ch.subject_user_id, ch.raised_by, ch.reason, ch.state, ch.created_at
		FROM election_roll_challenges ch JOIN elections e ON e.id = ch.election_id
		WHERE ch.id=$1 AND e.estate_id=$2`
	if err := s.db.QueryRow(ctx, sel, challengeID, estateID).Scan(&c.ID, &c.ElectionID, &c.RollID,
		&c.SubjectUserID, &c.RaisedBy, &c.Reason, &c.State, &c.CreatedAt); err != nil {
		return nil, errors.New("estate: challenge not found in this estate")
	}
	if c.State != "open" {
		return nil, fmt.Errorf("estate: challenge is already %s", c.State)
	}
	state := "rejected"
	if uphold {
		state = "upheld"
		if _, err := s.db.Exec(ctx, `
			UPDATE election_roll_entries
			SET status='removed', removed_by=$2, removed_at=NOW(), removal_reason=$3
			WHERE roll_id=$1 AND user_id=$4`, c.RollID, adminID, resolution, c.SubjectUserID); err != nil {
			return nil, fmt.Errorf("estate: remove roll entry: %w", err)
		}
	}
	const upd = `UPDATE election_roll_challenges SET state=$2, resolved_by=$3, resolved_at=NOW(), resolution=$4 WHERE id=$1 AND state='open'`
	if _, err := s.db.Exec(ctx, upd, c.ID, state, adminID, resolution); err != nil {
		return nil, fmt.Errorf("estate: resolve challenge: %w", err)
	}
	now := time.Now()
	c.State, c.ResolvedBy, c.ResolvedAt, c.Resolution = state, adminID, &now, resolution
	_ = s.audit(ctx, estateID, adminID, "ELECTION_ROLL_CHALLENGE_"+state, "election", c.ElectionID, map[string]any{
		"challenge_id": c.ID, "roll_id": c.RollID,
	})
	return &c, nil
}

// RemoveRollEntry is the admin-side revocation that does not wait for a challenge: an
// estate can discover a disqualification mid-poll (EST-UAT-0219).
func (s *Service) RemoveRollEntry(ctx context.Context, estateID, adminID, electionID, subjectUserID, reason string) (*ElectionRollEntry, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	reason = strings.TrimSpace(reason)
	if len(reason) < 5 {
		return nil, errors.New("estate: removing a voter from the roll needs a reason of at least 5 characters")
	}
	if _, err := s.loadElection(ctx, estateID, electionID); err != nil {
		return nil, err
	}
	roll, err := s.currentRoll(ctx, electionID)
	if err != nil {
		return nil, err
	}
	e := &ElectionRollEntry{RollID: roll.ID, UserID: subjectUserID, Status: "removed", Source: "built", RemovalReason: reason}
	const q = `
		UPDATE election_roll_entries SET status='removed', removed_by=$3, removed_at=NOW(), removal_reason=$4
		WHERE roll_id=$1 AND user_id=$2 AND status='active'
		RETURNING weight`
	if err := s.db.QueryRow(ctx, q, roll.ID, subjectUserID, adminID, reason).Scan(&e.Weight); err != nil {
		return nil, errors.New("estate: that voter is not an active entry on the current roll")
	}
	_ = s.audit(ctx, estateID, adminID, "ELECTION_ROLL_REMOVED", "election", electionID, map[string]any{
		"roll_id": roll.ID, "version": roll.Version, "reason": reason,
	})
	return e, nil
}

// AddRollException adds a voter who is not on the built roll — a member the snapshot
// missed, or a holder of a right the rules do not express (EST-UAT-0219). Exceptions are
// marked as such so a published roll stays honest about how it was assembled.
func (s *Service) AddRollException(ctx context.Context, estateID, adminID, electionID, userID, reason string) (*ElectionRollEntry, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	reason = strings.TrimSpace(reason)
	if len(reason) < 5 {
		return nil, errors.New("estate: a roll exception needs a reason of at least 5 characters")
	}
	el, err := s.loadElection(ctx, estateID, electionID)
	if err != nil {
		return nil, err
	}
	if el.Status == "cancelled" {
		return nil, errors.New("estate: this election has been cancelled")
	}
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, errors.New("estate: an exception must be a member of this estate")
	}
	roll, err := s.currentRoll(ctx, electionID)
	if err != nil {
		return nil, err
	}
	weight := 1
	if el.Weighting == WeightingOneVotePerUnit {
		var units int
		if err := s.db.QueryRow(ctx, `
			SELECT COUNT(*) FROM estate_properties
			WHERE estate_id=$1 AND archived=FALSE AND (landlord_id=$2 OR tenant_id=$2)`, estateID, userID).Scan(&units); err != nil {
			return nil, err
		}
		weight = max(1, units)
	}
	e := &ElectionRollEntry{RollID: roll.ID, UserID: userID, Weight: weight, Source: "exception", Status: "active"}
	const q = `
		INSERT INTO election_roll_entries (roll_id, user_id, weight, source, status)
		VALUES ($1,$2,$3,'exception','active')
		ON CONFLICT (roll_id, user_id) DO UPDATE SET source='exception', status='active', weight=EXCLUDED.weight`
	if _, err := s.db.Exec(ctx, q, roll.ID, userID, weight); err != nil {
		return nil, fmt.Errorf("estate: add roll exception: %w", err)
	}
	if roll.Status == "frozen" {
		_, _ = s.db.Exec(ctx, `UPDATE election_rolls SET eligible_count=(
			SELECT COUNT(*) FROM election_roll_entries WHERE roll_id=$1 AND status='active') WHERE id=$1`, roll.ID)
	}
	_ = s.audit(ctx, estateID, adminID, "ELECTION_ROLL_EXCEPTION", "election", electionID, map[string]any{
		"roll_id": roll.ID, "version": roll.Version, "reason": reason, "weight": weight,
	})
	return e, nil
}

// ------------------------------------------------------------------ nominations

// Nominate proposes a candidate (EST-UAT-0209). The nomination is refused here, not
// merely flagged, when the nominee cannot hold the ballot line — that is the invalid
// nomination case (EST-UAT-0210).
func (s *Service) Nominate(ctx context.Context, estateID, actorID string, electionID string, req NominationRequest) (*Nomination, error) {
	if err := s.assertResident(ctx, estateID, actorID); err != nil {
		return nil, err
	}
	el, err := s.loadElection(ctx, estateID, electionID)
	if err != nil {
		return nil, err
	}
	if el.Status != "draft" {
		return nil, fmt.Errorf("estate: nominations close when the election is %s", el.Status)
	}
	if el.NominationOpensAt != nil || el.NominationClosesAt != nil {
		now := time.Now()
		if el.NominationOpensAt != nil && now.Before(*el.NominationOpensAt) {
			return nil, errors.New("estate: nominations are not open yet")
		}
		if el.NominationClosesAt != nil && now.After(*el.NominationClosesAt) {
			return nil, errors.New("estate: nominations have closed")
		}
	}
	nominee := strings.TrimSpace(req.NomineeUserID)
	if nominee == "" {
		return nil, errors.New("estate: nominee_user_id is required")
	}
	// Invalid nomination: not a member of this estate (banned and deleted members fail
	// closed inside assertResident).
	if err := s.assertResident(ctx, estateID, nominee); err != nil {
		return nil, errors.New("estate: that nominee is not an eligible member of this estate")
	}
	// UNIQUE (election_id, nominee_user_id) rejects a second nomination of the same person
	// in any state, so nobody can be re-nominated after being declined or withdrawing.
	n := &Nomination{ID: uuid.New().String(), ElectionID: electionID, NomineeUserID: nominee,
		NominatedBy: actorID, Seat: strings.TrimSpace(req.Seat), Statement: strings.TrimSpace(req.Statement),
		State: "nominated", VettingState: "pending", CreatedAt: time.Now()}
	const ins = `
		INSERT INTO election_nominations (id, election_id, nominee_user_id, nominated_by, seat, statement)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''))
		RETURNING id, election_id, nominee_user_id, COALESCE(nominated_by::text,''), COALESCE(seat,''),
		          COALESCE(statement,''), state, vetting_state, created_at`
	if err := s.db.QueryRow(ctx, ins, n.ID, n.ElectionID, n.NomineeUserID, n.NominatedBy, n.Seat, n.Statement).
		Scan(&n.ID, &n.ElectionID, &n.NomineeUserID, &n.NominatedBy, &n.Seat, &n.Statement,
			&n.State, &n.VettingState, &n.CreatedAt); err != nil {
		if isUniqueViolation(err) {
			return nil, errors.New("estate: that nominee has already been nominated for this election")
		}
		return nil, fmt.Errorf("estate: nominate: %w", err)
	}
	_ = s.audit(ctx, estateID, actorID, "ELECTION_NOMINATED", "election", electionID, map[string]any{
		"nomination_id": n.ID,
	})
	return n, nil
}

// DecideNomination is the nominee's own answer (accept / decline) or the proposer's
// withdrawal (EST-UAT-0211). Only those two parties may act, and only before the
// nomination is certified onto the ballot.
func (s *Service) DecideNomination(ctx context.Context, estateID, actorID, nominationID, decision, reason string) (*Nomination, error) {
	if err := s.assertResident(ctx, estateID, actorID); err != nil {
		return nil, err
	}
	reason = strings.TrimSpace(reason)
	n, err := s.loadNomination(ctx, estateID, nominationID)
	if err != nil {
		return nil, err
	}
	if n.State == "certified" {
		return nil, errors.New("estate: this nomination is already on the ballot")
	}
	// A decision is not a draft: once the nominee has answered, the nomination is settled,
	// and the only way back onto the ballot is a fresh nomination — which the unique key
	// refuses. Without this guard a "decline" could be silently un-declined.
	if n.State != "nominated" {
		return nil, fmt.Errorf("estate: this nomination is already %s", n.State)
	}
	switch decision {
	case "accept", "decline":
		if n.NomineeUserID != actorID {
			return nil, errors.New("estate: only the nominee can accept or decline")
		}
	case "withdraw":
		if n.NominatedBy != actorID && n.NomineeUserID != actorID {
			return nil, errors.New("estate: only the nominee or the proposer can withdraw a nomination")
		}
	default:
		return nil, fmt.Errorf("estate: unknown nomination decision %q", decision)
	}
	state := map[string]string{"accept": "accepted", "decline": "declined", "withdraw": "withdrawn"}[decision]
	var updated string
	const q = `
		UPDATE election_nominations SET state=$2, decided_by=$3, decided_at=NOW(), reason=NULLIF($4,'')
		WHERE id=$1 AND state<>'certified'
		RETURNING id`
	if err := s.db.QueryRow(ctx, q, nominationID, state, actorID, reason).Scan(&updated); err != nil {
		return nil, errors.New("estate: nomination not found")
	}
	_ = s.audit(ctx, estateID, actorID, "ELECTION_NOMINATION_"+state, "election", n.ElectionID, map[string]any{
		"nomination_id": nominationID, "reason": reason,
	})
	return s.loadNomination(ctx, estateID, updated)
}

// VetNomination records the admin's vetting outcome. A flagged nomination cannot be
// certified, which is the difference between "nominated" and "on the ballot"
// (EST-UAT-0211).
func (s *Service) VetNomination(ctx context.Context, estateID, adminID, nominationID string, cleared bool, reason string) (*Nomination, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	state := "flagged"
	if cleared {
		state = "cleared"
	}
	var electionID string
	const q = `
		UPDATE election_nominations SET vetting_state=$2, reason=NULLIF($3,'')
		WHERE id=$1 AND state<>'certified'
		RETURNING election_id`
	if err := s.db.QueryRow(ctx, q, nominationID, state, strings.TrimSpace(reason)).Scan(&electionID); err != nil {
		return nil, errors.New("estate: nomination not found")
	}
	_ = s.audit(ctx, estateID, adminID, "ELECTION_NOMINATION_VETTED", "election", electionID, map[string]any{
		"nomination_id": nominationID, "vetting_state": state,
	})
	n, err := s.loadNominationByElection(ctx, estateID, electionID, nominationID)
	if err != nil {
		return nil, err
	}
	return n, nil
}

// CertifyNomination puts an accepted, cleared nomination on the ballot (EST-UAT-0211).
// Certification is the only path from a nomination to an election_candidates row, so a
// ballot line always has a person who agreed to stand behind it.
func (s *Service) CertifyNomination(ctx context.Context, estateID, adminID, nominationID string) (*Candidate, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	n, err := s.loadNomination(ctx, estateID, nominationID)
	if err != nil {
		return nil, err
	}
	el, err := s.loadElection(ctx, estateID, n.ElectionID)
	if err != nil {
		return nil, err
	}
	if el.Status != "draft" {
		return nil, fmt.Errorf("estate: the ballot is closed to new candidates once the election is %s", el.Status)
	}
	if n.State == "certified" {
		return nil, errors.New("estate: this nomination is already on the ballot")
	}
	if n.State != "accepted" {
		return nil, fmt.Errorf("estate: the nominee must accept before certification (state is %s)", n.State)
	}
	if n.VettingState != "cleared" {
		return nil, fmt.Errorf("estate: vetting must clear the nominee before certification (vetting is %s)", n.VettingState)
	}
	var name string
	if err := s.db.QueryRow(ctx, `
		SELECT COALESCE(NULLIF(btrim(u.first_name || ' ' || u.last_name), ''), u.email, 'Candidate')
		FROM public.platform_users u WHERE u.id=$1`, n.NomineeUserID).Scan(&name); err != nil {
		return nil, errors.New("estate: nominee account not found")
	}
	c := &Candidate{ID: uuid.New().String(), ElectionID: n.ElectionID, Name: name, Bio: n.Statement}
	if _, err := s.db.Exec(ctx, `INSERT INTO election_candidates (id, election_id, name, bio) VALUES ($1,$2,$3,$4)`,
		c.ID, c.ElectionID, c.Name, c.Bio); err != nil {
		return nil, fmt.Errorf("estate: certify candidate: %w", err)
	}
	var ok bool
	if err := s.db.QueryRow(ctx, `
		UPDATE election_nominations SET state='certified', candidate_id=$2 WHERE id=$1
		RETURNING (state='certified')`, nominationID, c.ID).Scan(&ok); err != nil {
		return nil, errors.New("estate: nomination not found")
	}
	_ = s.audit(ctx, estateID, adminID, "ELECTION_NOMINATION_CERTIFIED", "election", n.ElectionID, map[string]any{
		"nomination_id": nominationID, "candidate_id": c.ID,
	})
	return c, nil
}

// ListNominations returns an election's nominations. Admins see the whole workflow;
// members see only what is public: certified candidates plus their own nominations.
func (s *Service) ListNominations(ctx context.Context, estateID, userID, electionID string) ([]Nomination, error) {
	isAdmin := s.assertEstateAdmin(ctx, estateID, userID) == nil
	if !isAdmin {
		if err := s.assertResident(ctx, estateID, userID); err != nil {
			return nil, err
		}
	}
	const q = `
		SELECT n.id, n.election_id, n.nominee_user_id, COALESCE(n.nominated_by::text,''), COALESCE(n.seat,''),
		       COALESCE(n.statement,''), n.state, n.vetting_state, COALESCE(n.reason,''),
		       COALESCE(n.candidate_id::text,''), n.created_at, n.decided_at,
		       COALESCE(NULLIF(btrim(nu.first_name || ' ' || nu.last_name), ''), nu.email, ''),
		       COALESCE(NULLIF(btrim(pu.first_name || ' ' || pu.last_name), ''), pu.email, '')
		FROM election_nominations n
		LEFT JOIN public.platform_users nu ON nu.id = n.nominee_user_id
		LEFT JOIN public.platform_users pu ON pu.id = n.nominated_by
		WHERE n.election_id=$1 AND ($2 OR n.state='certified' OR n.nominee_user_id=$3 OR n.nominated_by=$3)
		ORDER BY n.created_at`
	rows, err := s.db.Query(ctx, q, electionID, isAdmin, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Nomination
	for rows.Next() {
		var n Nomination
		if err := rows.Scan(&n.ID, &n.ElectionID, &n.NomineeUserID, &n.NominatedBy, &n.Seat, &n.Statement,
			&n.State, &n.VettingState, &n.Reason, &n.CandidateID, &n.CreatedAt, &n.DecidedAt,
			&n.NomineeName, &n.NominatedName); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *Service) loadNomination(ctx context.Context, estateID, nominationID string) (*Nomination, error) {
	var electionID string
	if err := s.db.QueryRow(ctx, `
		SELECT n.election_id FROM election_nominations n JOIN elections e ON e.id=n.election_id
		WHERE n.id=$1 AND e.estate_id=$2`, nominationID, estateID).Scan(&electionID); err != nil {
		return nil, errors.New("estate: nomination not found in this estate")
	}
	return s.loadNominationByElection(ctx, estateID, electionID, nominationID)
}

func (s *Service) loadNominationByElection(ctx context.Context, estateID, electionID, nominationID string) (*Nomination, error) {
	const q = `
		SELECT n.id, n.election_id, n.nominee_user_id, COALESCE(n.nominated_by::text,''), COALESCE(n.seat,''),
		       COALESCE(n.statement,''), n.state, n.vetting_state, COALESCE(n.reason,''),
		       COALESCE(n.candidate_id::text,''), n.created_at, n.decided_at,
		       COALESCE(NULLIF(btrim(nu.first_name || ' ' || nu.last_name), ''), nu.email, ''),
		       COALESCE(NULLIF(btrim(pu.first_name || ' ' || pu.last_name), ''), pu.email, '')
		FROM election_nominations n
		JOIN elections e ON e.id = n.election_id
		LEFT JOIN public.platform_users nu ON nu.id = n.nominee_user_id
		LEFT JOIN public.platform_users pu ON pu.id = n.nominated_by
		WHERE n.id=$1 AND n.election_id=$2 AND e.estate_id=$3`
	var n Nomination
	err := s.db.QueryRow(ctx, q, nominationID, electionID, estateID).Scan(&n.ID, &n.ElectionID, &n.NomineeUserID,
		&n.NominatedBy, &n.Seat, &n.Statement, &n.State, &n.VettingState, &n.Reason, &n.CandidateID,
		&n.CreatedAt, &n.DecidedAt, &n.NomineeName, &n.NominatedName)
	if err != nil {
		return nil, errors.New("estate: nomination not found")
	}
	return &n, nil
}

// ------------------------------------------------------------------ lifecycle

// OpenElection moves a draft to open once its governance is in order: at least two
// candidates on the ballot, and — where a roll has been assembled — a frozen one
// (EST-UAT-0202/0203/0204). Refusing to open an unprepared election is what makes the
// approval steps load-bearing rather than decorative.
func (s *Service) OpenElection(ctx context.Context, estateID, adminID, electionID string) (*Election, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	el, err := s.loadElection(ctx, estateID, electionID)
	if err != nil {
		return nil, err
	}
	if el.Status != "draft" {
		return nil, fmt.Errorf("estate: cannot open a %s election", el.Status)
	}
	var candidates int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM election_candidates WHERE election_id=$1`, electionID).Scan(&candidates); err != nil {
		return nil, err
	}
	if candidates < 2 {
		return nil, fmt.Errorf("estate: an election needs at least 2 candidates on the ballot, it has %d", candidates)
	}
	if roll, rerr := s.currentRoll(ctx, electionID); rerr == nil && roll.Status != "frozen" {
		return nil, errors.New("estate: freeze the electoral roll before opening the election")
	}
	if el.NominationClosesAt != nil && el.StartsAt.Before(*el.NominationClosesAt) {
		return nil, errors.New("estate: voting cannot start before nominations close")
	}
	const q = `UPDATE elections SET status='open' WHERE id=$1 AND estate_id=$2 AND status='draft' RETURNING ` + electionCols
	opened, err := s.scanElectionUpdate(ctx, q, electionID, estateID)
	if err != nil {
		return nil, err
	}
	_ = s.audit(ctx, estateID, adminID, "ELECTION_OPEN", "election", electionID, map[string]any{"candidates": candidates})
	return opened, nil
}

// CloseElection ends voting (admin only). It is deliberately separate from tabulation:
// closing freezes the ballot, tallying computes a verdict, publishing certifies it.
func (s *Service) CloseElection(ctx context.Context, estateID, adminID, electionID string) (*Election, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	el, err := s.loadElection(ctx, estateID, electionID)
	if err != nil {
		return nil, err
	}
	if el.Status != "open" {
		return nil, fmt.Errorf("estate: cannot close a %s election", el.Status)
	}
	closed, err := s.scanElectionUpdate(ctx,
		`UPDATE elections SET status='closed' WHERE id=$1 AND estate_id=$2 AND status='open' RETURNING `+electionCols,
		electionID, estateID)
	if err != nil {
		return nil, err
	}
	_ = s.audit(ctx, estateID, adminID, "ELECTION_CLOSE", "election", electionID, map[string]any{"ends_at": el.EndsAt})
	return closed, nil
}

// CancelElection voids an election and seals it against further ballots (EST-UAT-0229).
// Cast votes are kept: they are anonymous, and deleting them would destroy participation
// evidence without revealing a choice. The DB refuses both a cancel without a reason and
// any vote in a cancelled election.
func (s *Service) CancelElection(ctx context.Context, estateID, adminID, electionID, reason string) (*Election, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	reason = strings.TrimSpace(reason)
	if len(reason) < 5 {
		return nil, errors.New("estate: cancelling an election needs a reason of at least 5 characters")
	}
	el, err := s.loadElection(ctx, estateID, electionID)
	if err != nil {
		return nil, err
	}
	if el.Status == "cancelled" {
		return nil, errors.New("estate: this election is already cancelled")
	}
	if el.Status == "tallied" {
		return nil, errors.New("estate: a certified result cannot be cancelled — file a complaint instead")
	}
	const q = `
		UPDATE elections
		SET status='cancelled', cancelled_at=NOW(), cancelled_by=$3, cancellation_reason=$4
		WHERE id=$1 AND estate_id=$2 AND status IN ('draft','open','closed')
		RETURNING ` + electionCols
	cancelled, err := s.scanElectionUpdate(ctx, q, electionID, estateID, adminID, reason)
	if err != nil {
		return nil, err
	}
	_ = s.audit(ctx, estateID, adminID, "ELECTION_CANCEL", "election", electionID, map[string]any{"reason": reason})
	return cancelled, nil
}

func (s *Service) scanElectionUpdate(ctx context.Context, q string, args ...any) (*Election, error) {
	e := &Election{}
	err := s.db.QueryRow(ctx, q, args...).Scan(
		&e.ID, &e.EstateID, &e.Title, &e.Description, &e.StartsAt, &e.EndsAt, &e.Status,
		&e.CreatedBy, &e.CreatedAt, &e.Kind, &e.Weighting, &e.QuorumType, &e.QuorumValue,
		&e.TieBreak, &e.NominationOpensAt, &e.NominationClosesAt, &e.RollFrozenAt,
		&e.RulesLockedAt, &e.CancelledAt, &e.CancellationReason,
	)
	if err != nil {
		return nil, errors.New("estate: election not found, or its state changed under the request")
	}
	return e, nil
}

// ------------------------------------------------------------------ participation

// participationCounts reads the participation registry plus the anonymous ballot count.
// It never joins the two: ballots are counted in their own table, voters in theirs.
func (s *Service) participationCounts(ctx context.Context, electionID string) (voters, ballots, abstentions int, err error) {
	if err = s.db.QueryRow(ctx, `SELECT COUNT(DISTINCT voter_id)::int FROM election_votes WHERE election_id=$1`, electionID).Scan(&voters); err != nil {
		return
	}
	if err = s.db.QueryRow(ctx, `SELECT COUNT(*)::int, COUNT(*) FILTER (WHERE candidate_id IS NULL)::int
		FROM election_ballots WHERE election_id=$1`, electionID).Scan(&ballots, &abstentions); err != nil {
		return
	}
	return
}

// GetTurnout reports participation and quorum progress without any candidate-level
// figure (admin only, EST-UAT-0223).
func (s *Service) GetTurnout(ctx context.Context, estateID, adminID, electionID string) (*Turnout, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	el, err := s.loadElection(ctx, estateID, electionID)
	if err != nil {
		return nil, err
	}
	t := &Turnout{ElectionID: electionID, Status: el.Status, Weighting: el.Weighting,
		QuorumType: el.QuorumType, QuorumValue: el.QuorumValue}
	if roll, rerr := s.currentRoll(ctx, electionID); rerr == nil && roll.Status == "frozen" {
		t.EligibleVoters, t.BallotsAvail = roll.EligibleCount, roll.TotalBallots
	}
	voters, ballots, _, cerr := s.participationCounts(ctx, electionID)
	if cerr != nil {
		return nil, cerr
	}
	t.VotersCast, t.BallotsCast = voters, ballots
	t.QuorumRequired = quorumRequired(el.QuorumType, el.QuorumValue, t.denominator())
	t.TurnoutPercent = percent(ballots, t.denominator())
	t.QuorumMet = el.QuorumType == QuorumTypeNone || ballots >= t.QuorumRequired
	return t, nil
}

func (t *Turnout) denominator() int {
	if t.Weighting == WeightingOneVotePerUnit && t.BallotsAvail > 0 {
		return t.BallotsAvail
	}
	if t.EligibleVoters > 0 {
		return t.EligibleVoters
	}
	return t.VotersCast
}

// isRollVoter reports whether a user has an active entry on the newest frozen roll — the
// same test estate_cast_vote applies, so the client's answer and the ballot's answer
// cannot diverge.
func (s *Service) isRollVoter(ctx context.Context, electionID, userID string) bool {
	var ok bool
	_ = s.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM election_rolls r
			JOIN election_roll_entries en ON en.roll_id = r.id
			WHERE r.election_id=$1 AND r.status='frozen' AND en.user_id=$2 AND en.status='active'
			  AND r.version = (SELECT MAX(version) FROM election_rolls
			                   WHERE election_id=$1 AND status='frozen'))`,
		electionID, userID).Scan(&ok)
	return ok
}

func quorumRequired(quorumType string, value, denominator int) int {
	switch quorumType {
	case QuorumTypePercent:
		if denominator <= 0 {
			return 0
		}
		need := denominator * value
		return (need + 99) / 100 // round up: a percent quorum is never satisfied by a fraction
	case QuorumTypeCount:
		return value
	default:
		return 0
	}
}

func percent(part, whole int) float64 {
	if whole <= 0 || part <= 0 {
		return 0
	}
	return float64(int(float64(part)/float64(whole)*10000+0.5)) / 100
}

// ------------------------------------------------------------------ outcome

// GetOutcome is the verdict of a finished election: the tally plus the quorum test and
// the configured tie-break (EST-UAT-0223/0225). Candidate figures appear only after
// voting closes — the same withholding rule GetResults enforces, so a second read path
// cannot leak a live tally (ESTB-D006).
func (s *Service) GetOutcome(ctx context.Context, estateID, electionID, userID string) (*Outcome, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	el, err := s.loadElection(ctx, estateID, electionID)
	if err != nil {
		return nil, err
	}
	if el.Status != "closed" && el.Status != "tallied" && el.Status != "cancelled" {
		return nil, errors.New("estate: the outcome is only available after the election closes")
	}
	o := &Outcome{ElectionID: electionID, Title: el.Title, Kind: el.Kind, Status: el.Status,
		Weighting: el.Weighting, Binding: el.Kind == ElectionKindBinding,
		QuorumType: el.QuorumType, QuorumValue: el.QuorumValue, TieBreak: el.TieBreak}
	if roll, rerr := s.currentRoll(ctx, electionID); rerr == nil && roll.Status == "frozen" {
		o.EligibleVoters, o.BallotsAvail = roll.EligibleCount, roll.TotalBallots
	}
	voters, ballots, abstentions, err := s.participationCounts(ctx, electionID)
	if err != nil {
		return nil, err
	}
	o.VotersCast, o.BallotsCast, o.Abstentions = voters, ballots, abstentions
	denom := o.BallotsAvail
	if el.Weighting != WeightingOneVotePerUnit || denom <= 0 {
		denom = o.EligibleVoters
	}
	if denom <= 0 {
		denom = voters
	}
	o.TurnoutPercent = percent(ballots, denom)
	o.QuorumRequired = quorumRequired(el.QuorumType, el.QuorumValue, denom)
	o.QuorumMet = el.QuorumType == QuorumTypeNone || ballots >= o.QuorumRequired
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*)::int FROM election_complaints WHERE election_id=$1 AND state='open'`, electionID).Scan(&o.OpenComplaints); err != nil {
		return nil, err
	}
	if el.Status == "cancelled" {
		o.Verdict = "cancelled"
		o.Cancellation = el.CancellationReason
		return o, nil
	}
	results, err := s.tally(ctx, electionID)
	if err != nil {
		return nil, err
	}
	o.Results = results
	if ballots == 0 {
		o.Verdict = "no_ballots"
		return o, nil
	}
	if !o.QuorumMet {
		o.Verdict = "no_quorum"
		return o, nil
	}
	// An election where every ballot was an abstention has no support for anyone: it is
	// undecided rather than a tie between candidates who all sit on zero (EST-UAT-0221).
	supported := 0
	for _, c := range results {
		supported += c.Votes
	}
	if supported == 0 {
		o.Verdict = "no_ballots"
		o.TieBreakNote = "every ballot was an abstention, so no candidate holds any support"
		return o, nil
	}
	top := -1
	for _, c := range results {
		if c.Votes > top {
			top = c.Votes
		}
	}
	o.TopVotes = top
	var leaders []Candidate
	for _, c := range results {
		if c.Votes == top {
			leaders = append(leaders, c)
		}
	}
	switch len(leaders) {
	case 0:
		o.Verdict = "no_ballots"
	case 1:
		o.Verdict = "decided"
		o.WinnerIDs = []string{leaders[0].ID}
	default:
		o.Verdict = s.resolveTie(ctx, o, el, leaders)
	}
	return o, nil
}

// resolveTie applies the configured tie-break. 'none' leaves a tie declared — a result
// nobody signed up to break silently (EST-UAT-0225).
func (s *Service) resolveTie(ctx context.Context, o *Outcome, el *Election, leaders []Candidate) string {
	tied := make([]string, 0, len(leaders))
	for _, c := range leaders {
		tied = append(tied, c.ID)
	}
	o.WinnerIDs = tied
	o.Verdict = "tie"
	switch el.TieBreak {
	case TieBreakNone:
		o.TieBreakNote = fmt.Sprintf("%d candidates are level on %d votes; no tie-break is configured", len(leaders), leaders[0].Votes)
		return "tie"
	case TieBreakRunoff:
		o.TieBreakNote = "a runoff between the level candidates is required before a result can be certified"
		return "runoff_required"
	case TieBreakEarliestCandidate:
		// Ordered by the ballot line's own creation, not by the count: the candidate who was
		// named first holds the earlier claim on the seat.
		var winnerID string
		if err := s.db.QueryRow(ctx, `
			SELECT id FROM election_candidates
			WHERE id = ANY($1::uuid[]) ORDER BY created_at, id LIMIT 1`, tied).Scan(&winnerID); err != nil {
			o.TieBreakNote = "the configured tie-break could not be resolved"
			return "tie"
		}
		o.WinnerIDs = []string{winnerID}
		o.TieBreakNote = "broken in favour of the earliest-named candidate on the ballot"
		return "decided"
	}
	o.TieBreakNote = "no valid tie-break is configured"
	return "tie"
}

// tally counts ballots per candidate. It reads election_ballots only — never
// election_votes — so no path in the outcome can reconstruct a voter→choice pair.
func (s *Service) tally(ctx context.Context, electionID string) ([]Candidate, error) {
	const q = `
		SELECT ec.id, ec.election_id, ec.name, COALESCE(ec.bio,'') AS bio, COUNT(b.id)::int AS votes
		FROM election_candidates ec
		LEFT JOIN election_ballots b ON b.candidate_id = ec.id
		WHERE ec.election_id = $1
		GROUP BY ec.id, ec.election_id, ec.name, ec.bio ORDER BY votes DESC, ec.name`
	rows, err := s.db.Query(ctx, q, electionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Candidate
	for rows.Next() {
		var c Candidate
		if err := rows.Scan(&c.ID, &c.ElectionID, &c.Name, &c.Bio, &c.Votes); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ------------------------------------------------------------------ complaints

// FileElectionComplaint records a grievance about an election; kind 'recount' is the same
// entity with a demand attached (EST-UAT-0227). Members only — a complaint is a franchise
// right, not an admin courtesy.
func (s *Service) FileElectionComplaint(ctx context.Context, estateID, userID, electionID string, req ComplaintRequest) (*Complaint, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	kind := strings.TrimSpace(req.Kind)
	if kind == "" {
		kind = "complaint"
	}
	if kind != "complaint" && kind != "recount" {
		return nil, fmt.Errorf("estate: invalid complaint kind %q", kind)
	}
	el, err := s.loadElection(ctx, estateID, electionID)
	if err != nil {
		return nil, err
	}
	if el.Status == "draft" {
		return nil, errors.New("estate: there is nothing to complain about until the election opens")
	}
	c := &Complaint{ID: uuid.New().String(), ElectionID: electionID, RaisedBy: userID,
		Kind: kind, Detail: strings.TrimSpace(req.Detail), State: "open", CreatedAt: time.Now()}
	const ins = `INSERT INTO election_complaints (id, election_id, raised_by, kind, detail)
		VALUES ($1,$2,$3,$4,$5)`
	if _, err := s.db.Exec(ctx, ins, c.ID, c.ElectionID, c.RaisedBy, c.Kind, c.Detail); err != nil {
		return nil, fmt.Errorf("estate: file complaint: %w", err)
	}
	_ = s.audit(ctx, estateID, userID, "ELECTION_COMPLAINT", "election", electionID, map[string]any{
		"complaint_id": c.ID, "kind": kind,
	})
	return c, nil
}

// ListElectionComplaints returns an election's complaints (admin only).
func (s *Service) ListElectionComplaints(ctx context.Context, estateID, adminID, electionID string) ([]Complaint, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if _, err := s.loadElection(ctx, estateID, electionID); err != nil {
		return nil, err
	}
	const q = `SELECT id, election_id, raised_by, kind, detail, state, COALESCE(resolved_by::text,''),
		resolved_at, COALESCE(resolution,''), created_at
		FROM election_complaints WHERE election_id=$1
		ORDER BY (state='open') DESC, created_at DESC`
	rows, err := s.db.Query(ctx, q, electionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Complaint
	for rows.Next() {
		var c Complaint
		if err := rows.Scan(&c.ID, &c.ElectionID, &c.RaisedBy, &c.Kind, &c.Detail, &c.State,
			&c.ResolvedBy, &c.ResolvedAt, &c.Resolution, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ResolveElectionComplaint decides a complaint; upholding a recount demand re-tabulates
// immediately so the decision is not just a note (EST-UAT-0227).
func (s *Service) ResolveElectionComplaint(ctx context.Context, estateID, adminID, complaintID string, uphold bool, resolution string) (*Complaint, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	resolution = strings.TrimSpace(resolution)
	if len(resolution) < 5 {
		return nil, errors.New("estate: a complaint resolution needs at least 5 characters")
	}
	var c Complaint
	const sel = `SELECT id, election_id, raised_by, kind, detail, state, created_at FROM election_complaints WHERE id=$1 AND election_id IN (SELECT id FROM elections WHERE estate_id=$2)`
	if err := s.db.QueryRow(ctx, sel, complaintID, estateID).Scan(&c.ID, &c.ElectionID, &c.RaisedBy, &c.Kind,
		&c.Detail, &c.State, &c.CreatedAt); err != nil {
		return nil, errors.New("estate: complaint not found in this estate")
	}
	if c.State != "open" {
		return nil, fmt.Errorf("estate: complaint is already %s", c.State)
	}
	state := "dismissed"
	if uphold {
		state = "upheld"
	}
	const upd = `UPDATE election_complaints SET state=$2, resolved_by=$3, resolved_at=NOW(), resolution=$4
		WHERE id=$1 AND state='open'`
	if _, err := s.db.Exec(ctx, upd, complaintID, state, adminID, resolution); err != nil {
		return nil, fmt.Errorf("estate: resolve complaint: %w", err)
	}
	now := time.Now()
	c.State, c.ResolvedBy, c.ResolvedAt, c.Resolution = state, adminID, &now, resolution
	if uphold && c.Kind == "recount" {
		if _, err := s.RunRecount(ctx, estateID, adminID, c.ElectionID, complaintID, "ordered by complaint resolution"); err != nil {
			return nil, err
		}
	}
	_ = s.audit(ctx, estateID, adminID, "ELECTION_COMPLAINT_"+state, "election", c.ElectionID, map[string]any{
		"complaint_id": complaintID, "kind": c.Kind,
	})
	return &c, nil
}

// RunRecount re-derives the aggregate totals from election_ballots and stores the
// snapshot (EST-UAT-0227). The snapshot is totals-only by construction: the query it runs
// is the same one GetResults uses, which has no voter column available to it.
func (s *Service) RunRecount(ctx context.Context, estateID, adminID, electionID, complaintID, note string) (*Recount, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	el, err := s.loadElection(ctx, estateID, electionID)
	if err != nil {
		return nil, err
	}
	if el.Status == "draft" || el.Status == "open" {
		return nil, errors.New("estate: a recount needs a closed ballot")
	}
	totals, err := s.tally(ctx, electionID)
	if err != nil {
		return nil, err
	}
	_, ballots, abstentions, err := s.participationCounts(ctx, electionID)
	if err != nil {
		return nil, err
	}
	note = strings.TrimSpace(note)
	rc := &Recount{ID: uuid.New().String(), ElectionID: electionID, RequestedBy: adminID,
		TalliedAt: time.Now(), BallotsCast: ballots, Abstentions: abstentions, Totals: totals, Note: note}
	if complaintID != "" {
		var linked string
		if err := s.db.QueryRow(ctx, `SELECT id FROM election_complaints WHERE id=$1 AND election_id=$2`, complaintID, electionID).Scan(&linked); err != nil {
			return nil, errors.New("estate: that complaint does not belong to this election")
		}
		rc.ComplaintID = linked
	}
	totalsJSON, err := json.Marshal(totals)
	if err != nil {
		return nil, fmt.Errorf("estate: recount totals: %w", err)
	}
	const ins = `INSERT INTO election_recounts (id, election_id, requested_by, complaint_id, totals, ballots_cast, abstentions, note)
		VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,NULLIF($8,''))`
	if _, err := s.db.Exec(ctx, ins, rc.ID, rc.ElectionID, rc.RequestedBy, nilIfEmpty(rc.ComplaintID),
		totalsJSON, rc.BallotsCast, rc.Abstentions, rc.Note); err != nil {
		return nil, fmt.Errorf("estate: store recount: %w", err)
	}
	_ = s.audit(ctx, estateID, adminID, "ELECTION_RECOUNT", "election", electionID, map[string]any{
		"recount_id": rc.ID, "ballots_cast": rc.BallotsCast, "abstentions": rc.Abstentions,
	})
	return rc, nil
}

// ListRecounts returns an election's recount snapshots (admin only).
func (s *Service) ListRecounts(ctx context.Context, estateID, adminID, electionID string) ([]Recount, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if _, err := s.loadElection(ctx, estateID, electionID); err != nil {
		return nil, err
	}
	const q = `SELECT id, election_id, COALESCE(requested_by::text,''), COALESCE(complaint_id::text,''),
		tallied_at, totals::text, ballots_cast, abstentions, COALESCE(note,'')
		FROM election_recounts WHERE election_id=$1 ORDER BY tallied_at DESC`
	rows, err := s.db.Query(ctx, q, electionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Recount
	for rows.Next() {
		var r Recount
		var totalsSQL string
		if err := rows.Scan(&r.ID, &r.ElectionID, &r.RequestedBy, &r.ComplaintID, &r.TalliedAt,
			&totalsSQL, &r.BallotsCast, &r.Abstentions, &r.Note); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(totalsSQL), &r.Totals); err != nil {
			return nil, fmt.Errorf("estate: recount snapshot unreadable: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// TallyElection marks a closed election tallied, refusing to certify while the quorum
// failed, a complaint is unresolved or — for a binding election — the tie-break has not
// produced a single winner (EST-UAT-0223/0225/0227).
func (s *Service) TallyElection(ctx context.Context, estateID, adminID, electionID string) (*Outcome, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	el, err := s.loadElection(ctx, estateID, electionID)
	if err != nil {
		return nil, err
	}
	if el.Status != "closed" && el.Status != "tallied" {
		return nil, fmt.Errorf("estate: cannot tally a %s election", el.Status)
	}
	outcome, err := s.GetOutcome(ctx, estateID, electionID, adminID)
	if err != nil {
		return nil, err
	}
	if outcome.Verdict == "no_ballots" {
		return outcome, errors.New("estate: no vote was cast for any candidate — there is no result to certify")
	}
	if el.Kind == ElectionKindBinding {
		if !outcome.QuorumMet {
			return outcome, errors.New("estate: quorum not met — the result cannot be certified")
		}
		if outcome.Verdict == "tie" || outcome.Verdict == "runoff_required" {
			return outcome, errors.New("estate: " + outcome.Verdict + " — the tie-break has not produced a winner")
		}
	}
	if outcome.OpenComplaints > 0 {
		return outcome, fmt.Errorf("estate: %d complaint(s) are still open — the result cannot be certified", outcome.OpenComplaints)
	}
	if el.Status == "closed" {
		if _, err := s.scanElectionUpdate(ctx,
			`UPDATE elections SET status='tallied' WHERE id=$1 AND estate_id=$2 AND status='closed' RETURNING `+electionCols,
			electionID, estateID); err != nil {
			return nil, err
		}
		outcome.Status = "tallied"
	}
	_ = s.audit(ctx, estateID, adminID, "ELECTION_TALLY", "election", electionID, map[string]any{
		"verdict": outcome.Verdict, "ballots_cast": outcome.BallotsCast,
	})
	return outcome, nil
}

// ------------------------------------------------------------------ helpers

// EligibilityOnRoll answers the voter's own "can I still vote" question after a roll
// action: the configured rules plus frozen-roll membership, without exposing anyone
// else's standing (EST-UAT-0219).
func (s *Service) EligibilityOnRoll(ctx context.Context, estateID, electionID, voterID string) (Eligibility, error) {
	base, err := s.CheckVoterEligibility(ctx, estateID, electionID, voterID)
	if err != nil {
		return base, err
	}
	roll, rerr := s.currentRoll(ctx, electionID)
	if rerr != nil || roll.Status != "frozen" {
		return base, nil
	}
	if !s.isRollVoter(ctx, electionID, voterID) {
		base.Eligible = false
		base.Reasons = append(base.Reasons, ReasonNotOnRoll)
	}
	return base, nil
}

func nilIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func isUniqueViolation(err error) bool {
	var pgErr interface{ SQLState() string }
	return errors.As(err, &pgErr) && pgErr.SQLState() == "23505"
}
