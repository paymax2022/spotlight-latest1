package network

import (
	"context"
	"fmt"

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

// --- ambassador ---

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

// --- team / dashboards ---

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

// --- policies ---

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
//
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
