package estate

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// election_eligibility.go — Block 31 extended elections: KYC + payment voter gating.
//
// An estate admin configures per-election rules (require_kyc, require_payment,
// resident_types). CastVote consults these before accepting a ballot, and the
// GET …/eligibility endpoint lets the client show the voter why they can/can't
// vote up front. Absence of a rules row = no extra requirements (open vote).

// KYCVerifier reports whether a user has completed KYC. Kept as a narrow
// interface so the estate package stays decoupled from the finance/kyc package;
// the wiring layer adapts *kyc.Service to it.
type KYCVerifier interface {
	IsKYCVerified(ctx context.Context, userID string) (bool, error)
}

// KYCVerifierFunc adapts a plain function to the KYCVerifier interface.
type KYCVerifierFunc func(ctx context.Context, userID string) (bool, error)

func (f KYCVerifierFunc) IsKYCVerified(ctx context.Context, userID string) (bool, error) {
	return f(ctx, userID)
}

// WithKYC wires the KYC verifier used for KYC-gated elections. When unset, an
// election that requires KYC fails closed (no one is eligible) rather than
// silently letting unverified residents vote.
func (s *Service) WithKYC(k KYCVerifier) *Service {
	s.kyc = k
	return s
}

// EligibilityRules is the per-election voter gating config.
type EligibilityRules struct {
	ElectionID     string   `json:"election_id"`
	RequireKYC     bool     `json:"require_kyc"`
	RequirePayment bool     `json:"require_payment"`
	ResidentTypes  []string `json:"resident_types"`
}

// SetEligibilityRulesRequest is the body for setting an election's rules (admin).
type SetEligibilityRulesRequest struct {
	RequireKYC     bool     `json:"require_kyc"`
	RequirePayment bool     `json:"require_payment"`
	ResidentTypes  []string `json:"resident_types"`
}

// Eligibility is the result of evaluating a voter against an election's rules.
type Eligibility struct {
	Eligible bool     `json:"eligible"`
	Reasons  []string `json:"reasons,omitempty"` // machine-readable block reasons
}

// Block-reason codes.
const (
	ReasonKYCRequired       = "kyc_required"
	ReasonKYCUnavailable    = "kyc_unavailable"
	ReasonOutstandingDues   = "outstanding_dues"
	ReasonResidentTypeError = "resident_type_ineligible"
)

// evaluateEligibility is the pure decision: given an election's rules and the
// voter's verified state, which (if any) requirements block them. Pure (no DB)
// so the policy is exhaustively unit-testable.
func evaluateEligibility(rules EligibilityRules, kycVerified, kycAvailable, hasOutstandingDues bool, voterType string) Eligibility {
	var reasons []string
	if rules.RequireKYC {
		if !kycAvailable {
			reasons = append(reasons, ReasonKYCUnavailable) // fail closed
		} else if !kycVerified {
			reasons = append(reasons, ReasonKYCRequired)
		}
	}
	if rules.RequirePayment && hasOutstandingDues {
		reasons = append(reasons, ReasonOutstandingDues)
	}
	if len(rules.ResidentTypes) > 0 && !containsString(rules.ResidentTypes, voterType) {
		reasons = append(reasons, ReasonResidentTypeError)
	}
	return Eligibility{Eligible: len(reasons) == 0, Reasons: reasons}
}

func containsString(xs []string, target string) bool {
	for _, x := range xs {
		if x == target {
			return true
		}
	}
	return false
}

// loadEligibilityRules returns the rules for an election; a missing row means no
// extra requirements (zero-value rules → everyone eligible).
func (s *Service) loadEligibilityRules(ctx context.Context, electionID string) (EligibilityRules, error) {
	r := EligibilityRules{ElectionID: electionID}
	const q = `SELECT require_kyc, require_payment, resident_types FROM election_eligibility_rules WHERE election_id=$1`
	err := s.db.QueryRow(ctx, q, electionID).Scan(&r.RequireKYC, &r.RequirePayment, &r.ResidentTypes)
	if err == pgx.ErrNoRows {
		return r, nil
	}
	return r, err
}

// SetEligibilityRules upserts an election's voter eligibility rules (admin only).
func (s *Service) SetEligibilityRules(ctx context.Context, estateID, adminID, electionID string, req SetEligibilityRulesRequest) (*EligibilityRules, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	// Election must belong to this estate.
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM elections WHERE id=$1 AND estate_id=$2)`, electionID, estateID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, fmt.Errorf("estate: election not found in this estate")
	}
	types := req.ResidentTypes
	if types == nil {
		types = []string{}
	}
	const q = `
		INSERT INTO election_eligibility_rules (election_id, require_kyc, require_payment, resident_types, updated_by, updated_at)
		VALUES ($1,$2,$3,$4,$5,NOW())
		ON CONFLICT (election_id) DO UPDATE SET
			require_kyc=EXCLUDED.require_kyc,
			require_payment=EXCLUDED.require_payment,
			resident_types=EXCLUDED.resident_types,
			updated_by=EXCLUDED.updated_by,
			updated_at=NOW()`
	if _, err := s.db.Exec(ctx, q, electionID, req.RequireKYC, req.RequirePayment, types, adminID); err != nil {
		return nil, fmt.Errorf("estate: set eligibility rules: %w", err)
	}
	_ = s.audit(ctx, estateID, adminID, "ELECTION_ELIGIBILITY_SET", "election", electionID, map[string]any{
		"require_kyc": req.RequireKYC, "require_payment": req.RequirePayment, "resident_types": types,
	})
	r := EligibilityRules{ElectionID: electionID, RequireKYC: req.RequireKYC, RequirePayment: req.RequirePayment, ResidentTypes: types}
	return &r, nil
}

// hasOutstandingDues reports whether a resident has unpaid dues (overdue, or
// pending past its due date) in the estate.
func (s *Service) hasOutstandingDues(ctx context.Context, estateID, residentID string) (bool, error) {
	var n int
	const q = `SELECT COUNT(*) FROM estate_dues_invoices
		WHERE estate_id=$1 AND resident_id=$2
		  AND (status='overdue' OR (status='pending' AND due_date < $3))`
	if err := s.db.QueryRow(ctx, q, estateID, residentID, time.Now()).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

// voterType returns the resident's occupancy type (resident_profiles), or "" if
// none is recorded.
func (s *Service) voterType(ctx context.Context, estateID, residentID string) (string, error) {
	var t string
	const q = `SELECT COALESCE(rp.occupancy_type,'')
		FROM estate_residents er
		LEFT JOIN resident_profiles rp ON rp.resident_id = er.id
		WHERE er.estate_id=$1 AND er.user_id=$2 LIMIT 1`
	err := s.db.QueryRow(ctx, q, estateID, residentID).Scan(&t)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	return t, err
}

// CheckVoterEligibility evaluates a voter against an election's rules. The caller
// must be a resident of the estate. Used both by the standalone eligibility
// endpoint and as the gate inside CastVote.
func (s *Service) CheckVoterEligibility(ctx context.Context, estateID, electionID, voterID string) (Eligibility, error) {
	if err := s.assertResident(ctx, estateID, voterID); err != nil {
		return Eligibility{}, err
	}
	rules, err := s.loadEligibilityRules(ctx, electionID)
	if err != nil {
		return Eligibility{}, err
	}
	// Fast path: no extra requirements configured.
	if !rules.RequireKYC && !rules.RequirePayment && len(rules.ResidentTypes) == 0 {
		return Eligibility{Eligible: true}, nil
	}

	var (
		kycVerified bool
		kycAvail    = s.kyc != nil
		outstanding bool
		vtype       string
	)
	if rules.RequireKYC && kycAvail {
		if kycVerified, err = s.kyc.IsKYCVerified(ctx, voterID); err != nil {
			return Eligibility{}, fmt.Errorf("estate: kyc check failed: %w", err)
		}
	}
	if rules.RequirePayment {
		if outstanding, err = s.hasOutstandingDues(ctx, estateID, voterID); err != nil {
			return Eligibility{}, err
		}
	}
	if len(rules.ResidentTypes) > 0 {
		if vtype, err = s.voterType(ctx, estateID, voterID); err != nil {
			return Eligibility{}, err
		}
	}
	return evaluateEligibility(rules, kycVerified, kycAvail, outstanding, vtype), nil
}
