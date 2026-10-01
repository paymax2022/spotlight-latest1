package network

import (
	"context"
	"fmt"
	"time"

	referralevents "spotlight/backend/internal/referral/events"
	referralledger "spotlight/backend/internal/referral/ledger"
)

// Service implements ambassador onboarding and the activity-based, capped,
// house-excluded override engine.
type Service struct {
	repo   *Repository
	reward *referralledger.Service // RB0 reward ledger (Accrue)
	events *referralevents.Service
}

func NewService(repo *Repository, reward *referralledger.Service, events *referralevents.Service) *Service {
	return &Service{repo: repo, reward: reward, events: events}
}

// Apply records an ambassador application. The disclosure MUST be accepted and
// stored (compliance: paid-ambassador disclosure).
func (s *Service) Apply(ctx context.Context, userID string, in ApplyInput) (*Ambassador, error) {
	if !in.DisclosureAccepted || in.DisclosureText == "" {
		return nil, fmt.Errorf("network: ambassador disclosure must be accepted and stored")
	}
	return s.repo.Apply(ctx, userID, in.Tier, in.DisclosureText)
}

// MyAmbassador returns the caller's ambassador profile (dashboard).
func (s *Service) MyAmbassador(ctx context.Context, userID string) (*Ambassador, error) {
	return s.repo.GetAmbassadorByUser(ctx, userID)
}

// Directory lists ambassadors (admin), optional status filter.
func (s *Service) Directory(ctx context.Context, status string) ([]Ambassador, error) {
	return s.repo.ListAmbassadors(ctx, status)
}

// Approve / Suspend / Reject set ambassador status (admin).
func (s *Service) SetStatus(ctx context.Context, ambID, status, approvedBy string) error {
	switch status {
	case AmbApproved, AmbSuspended, AmbRejected:
	default:
		return fmt.Errorf("network: invalid ambassador status %q", status)
	}
	return s.repo.SetAmbassadorStatus(ctx, ambID, status, approvedBy)
}

// MyNetworks returns networks led by the caller (team dashboard).
func (s *Service) MyNetworks(ctx context.Context, leadUserID string) ([]Network, error) {
	return s.repo.NetworksByLead(ctx, leadUserID)
}

// NetworkMembers returns a network's members, but only to its lead or an admin.
func (s *Service) NetworkMembers(ctx context.Context, networkID, callerUserID string, isAdmin bool) ([]Member, error) {
	n, err := s.repo.GetNetwork(ctx, networkID)
	if err != nil {
		return nil, err
	}
	if !isAdmin && n.LeadUserID != callerUserID {
		return nil, fmt.Errorf("network: forbidden")
	}
	return s.repo.ListMembers(ctx, networkID)
}

// MyOverrides returns the caller's override ledger.
func (s *Service) MyOverrides(ctx context.Context, beneficiaryID string) ([]Override, error) {
	return s.repo.OverridesByBeneficiary(ctx, beneficiaryID, 200)
}

func (s *Service) ListPolicies(ctx context.Context) ([]OverridePolicy, error) {
	return s.repo.ListPolicies(ctx)
}

func (s *Service) SetPolicy(ctx context.Context, in PolicyInput) (*OverridePolicy, error) {
	if in.Tier == "" {
		return nil, fmt.Errorf("network: policy tier required")
	}
	if in.OverrideBps < 0 || in.PerMemberCapKobo < 0 || in.MonthlyCapKobo < 0 {
		return nil, fmt.Errorf("network: policy values must be non-negative")
	}
	return s.repo.UpsertPolicy(ctx, in)
}

// AccrueOverride is the heart of the override engine. For one network member's
// VERIFIED activity it computes a capped override for the network lead and accrues
// it through the RB0 reward ledger (idempotent), enforcing every §7 invariant:
//  1. ACTIVITY-BASED: the base is the member's verified activity/revenue
//     (referral_engine_events qualifying-action/transaction value), NOT recruitment.
//     A member who only signed up (no value-bearing events) yields a zero base and
//     therefore zero override.
//  2. HOUSE-EXCLUDED: if the member's signup was house-attributed
//     (referral_attributions.is_house), they are excluded from the base — no override.
//  3. CAPPED: the lead's tier policy sets the rate (bps) and per-member + monthly
//     caps, all enforced server-side. The applied cap is recorded for audit.
//
// Returns the created Override (nil when nothing accrued, e.g. house-excluded or
// zero activity).
func (s *Service) AccrueOverride(ctx context.Context, in AccrueOverrideInput) (*Override, error) {
	if in.IdempotencyKey == "" {
		return nil, fmt.Errorf("network: idempotency key required for override accrual")
	}
	n, err := s.repo.GetNetwork(ctx, in.NetworkID)
	if err != nil {
		return nil, err
	}
	if n.Status != "active" {
		return nil, fmt.Errorf("network: network not active")
	}
	leadID := n.LeadUserID

	// The member must belong to the network.
	mem, err := s.repo.GetMember(ctx, in.NetworkID, in.SourceUserID)
	if err != nil {
		return nil, err
	}
	if mem == nil || mem.Status != "active" {
		return nil, fmt.Errorf("network: source user is not an active member")
	}

	// (2) HOUSE-EXCLUDED: house-attributed signups never form an override base.
	houseAttributed, err := s.repo.IsHouseAttributed(ctx, in.SourceUserID)
	if err != nil {
		return nil, err
	}
	if houseAttributed || mem.IsHouseAttributed {
		s.recordExcluded(ctx, leadID, in.SourceUserID, "house_attributed")
		return nil, nil // excluded from override base — no accrual
	}

	// (1) ACTIVITY-BASED: base = verified activity/revenue of the member.
	baseKobo, err := s.repo.VerifiedActivityKobo(ctx, in.SourceUserID)
	if err != nil {
		return nil, err
	}
	if baseKobo <= 0 {
		s.recordExcluded(ctx, leadID, in.SourceUserID, "no_verified_activity")
		return nil, nil // recruitment alone earns nothing
	}

	// (3) CAPPED: resolve the lead's tier policy for rate + caps.
	amb, err := s.repo.GetAmbassadorByUser(ctx, leadID)
	if err != nil {
		return nil, err
	}
	tier := "bronze"
	if amb != nil && amb.Status == AmbApproved {
		tier = amb.Tier
	}
	policy, err := s.repo.GetPolicy(ctx, tier)
	if err != nil {
		return nil, err
	}
	if policy == nil || !policy.IsActive || policy.OverrideBps <= 0 {
		return nil, nil // no active policy → no override
	}

	// amount = base * bps / 10000, then per-member + monthly caps applied server-side.
	amount := baseKobo * int64(policy.OverrideBps) / 10000
	capApplied := int64(0)
	if policy.PerMemberCapKobo > 0 && amount > policy.PerMemberCapKobo {
		amount = policy.PerMemberCapKobo
		capApplied = policy.PerMemberCapKobo
	}
	if policy.MonthlyCapKobo > 0 {
		used, err := s.repo.MonthlyOverrideTotal(ctx, leadID)
		if err != nil {
			return nil, err
		}
		remaining := policy.MonthlyCapKobo - used
		if remaining <= 0 {
			s.recordExcluded(ctx, leadID, in.SourceUserID, "monthly_cap_reached")
			return nil, nil
		}
		if amount > remaining {
			amount = remaining
			capApplied = policy.MonthlyCapKobo
		}
	}
	if amount <= 0 {
		return nil, nil
	}

	o := Override{
		BeneficiaryID:    leadID,
		NetworkID:        in.NetworkID,
		SourceUserID:     in.SourceUserID,
		CampaignID:       in.CampaignID,
		ActivityBaseKobo: baseKobo,
		OverrideBps:      policy.OverrideBps,
		AmountKobo:       amount,
		CapAppliedKobo:   capApplied,
	}
	overrideID, created, err := s.repo.RecordOverride(ctx, o, in.IdempotencyKey)
	if err != nil {
		return nil, err
	}
	o.ID = overrideID
	if !created {
		// Already accrued under this key — idempotent no-op.
		return &o, nil
	}

	// Accrue the override through RB0's reward ledger (idempotent, same key).
	if s.reward != nil {
		rewardID, err := s.reward.Accrue(ctx, referralledger.AccrueInput{
			BeneficiaryID:  leadID,
			ReferredUserID: in.SourceUserID,
			CampaignID:     in.CampaignID,
			Kind:           referralledger.KindOverride,
			AmountKobo:     amount,
			Currency:       "NGN",
			IdempotencyKey: "override:" + in.IdempotencyKey,
		})
		if err != nil {
			return nil, fmt.Errorf("network: accrue override reward: %w", err)
		}
		o.RewardLedgerID = rewardID
		_ = s.repo.SetOverrideLedgerID(ctx, overrideID, rewardID)
	}

	if s.events != nil {
		_ = s.events.Record(ctx, referralevents.Input{
			EventType:  "override_accrued",
			UserID:     leadID,
			ReferrerID: leadID,
			CampaignID: in.CampaignID,
			Payload: map[string]any{
				"source_user_id":     in.SourceUserID,
				"activity_base_kobo": baseKobo,
				"override_bps":       policy.OverrideBps,
				"amount_kobo":        amount,
				"cap_applied_kobo":   capApplied,
			},
			IdempotencyKey: "override_event:" + in.IdempotencyKey,
		})
	}
	return &o, nil
}

func (s *Service) recordExcluded(ctx context.Context, leadID, sourceUserID, reason string) {
	if s.events == nil {
		return
	}
	_ = s.events.Record(ctx, referralevents.Input{
		EventType:      "override_excluded",
		UserID:         leadID,
		ReferrerID:     leadID,
		Payload:        map[string]any{"source_user_id": sourceUserID, "reason": reason},
		IdempotencyKey: "override_excluded:" + leadID + ":" + sourceUserID + ":" + reason,
	})
}

// ListNetworks returns all agent networks with member counts (admin directory).
func (s *Service) ListNetworks(ctx context.Context, status string) ([]NetworkSummary, error) {
	return s.repo.ListNetworks(ctx, status)
}

// Ambassador statuses.
const (
	AmbApplied   = "applied"
	AmbApproved  = "approved"
	AmbSuspended = "suspended"
	AmbRejected  = "rejected"
)

// Ambassador is a member's ambassador profile + tier + disclosure record.
type Ambassador struct {
	ID                   string     `json:"id"`
	UserID               string     `json:"user_id"`
	Tier                 string     `json:"tier"`
	Status               string     `json:"status"`
	DisclosureText       string     `json:"disclosure_text,omitempty"`
	DisclosureAcceptedAt *time.Time `json:"disclosure_accepted_at,omitempty"`
	AppliedAt            time.Time  `json:"applied_at"`
	ApprovedBy           string     `json:"approved_by,omitempty"`
	ApprovedAt           *time.Time `json:"approved_at,omitempty"`
}

// Network is an agent/team/ambassador network led by one user.
type Network struct {
	ID          string    `json:"id"`
	LeadUserID  string    `json:"lead_user_id"`
	Name        string    `json:"name"`
	NetworkType string    `json:"network_type"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

// Member is a member of a network. IsHouseAttributed mirrors the member's
// referral_attributions.is_house and drives the override-base exclusion.
type Member struct {
	ID                string    `json:"id"`
	NetworkID         string    `json:"network_id"`
	MemberUserID      string    `json:"member_user_id"`
	IsHouseAttributed bool      `json:"is_house_attributed"`
	Status            string    `json:"status"`
	JoinedAt          time.Time `json:"joined_at"`
}

// Override is a recorded activity-based override accrual.
type Override struct {
	ID               string    `json:"id"`
	BeneficiaryID    string    `json:"beneficiary_id"`
	NetworkID        string    `json:"network_id,omitempty"`
	SourceUserID     string    `json:"source_user_id,omitempty"`
	CampaignID       string    `json:"campaign_id,omitempty"`
	ActivityBaseKobo int64     `json:"activity_base_kobo"`
	OverrideBps      int       `json:"override_bps"`
	AmountKobo       int64     `json:"amount_kobo"`
	CapAppliedKobo   int64     `json:"cap_applied_kobo"`
	RewardLedgerID   string    `json:"reward_ledger_id,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
}

// OverridePolicy is the per-tier override rate + caps.
type OverridePolicy struct {
	ID               string `json:"id"`
	Tier             string `json:"tier"`
	OverrideBps      int    `json:"override_bps"`
	PerMemberCapKobo int64  `json:"per_member_cap_kobo"`
	MonthlyCapKobo   int64  `json:"monthly_cap_kobo"`
	IsActive         bool   `json:"is_active"`
}

// ApplyInput is the ambassador application payload (disclosure mandatory).
type ApplyInput struct {
	Tier               string `json:"tier"`
	DisclosureText     string `json:"disclosure_text"`
	DisclosureAccepted bool   `json:"disclosure_accepted"`
}

// PolicyInput sets a per-tier override policy (admin).
type PolicyInput struct {
	Tier             string `json:"tier"`
	OverrideBps      int    `json:"override_bps"`
	PerMemberCapKobo int64  `json:"per_member_cap_kobo"`
	MonthlyCapKobo   int64  `json:"monthly_cap_kobo"`
	IsActive         bool   `json:"is_active"`
}

// AccrueOverrideInput requests an activity-based override accrual for a network
// lead, driven by ONE member's verified activity. The service excludes the member
// if they are house-attributed, applies the tier rate, and enforces the cap.
type AccrueOverrideInput struct {
	NetworkID      string // network the source member belongs to
	SourceUserID   string // member whose VERIFIED activity drives this override
	CampaignID     string // optional
	IdempotencyKey string // required; idempotent accrual
}
