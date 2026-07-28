package campaigns

import (
	"context"
	"fmt"

	referralevents "spotlight/backend/internal/referral/events"
)

// Auto-pause reason strings recorded by the budget governor.
const (
	ReasonBudgetExhausted = "budget_exhausted"
	ReasonBurnSpike       = "burn_spike"
	ReasonFraudSpike      = "fraud_spike"
	ReasonCACBreached     = "cac_breached"
)

// Service is the campaign builder + budget governor.
type Service struct {
	repo   *Repository
	events *referralevents.Service
}

func NewService(repo *Repository, events *referralevents.Service) *Service {
	return &Service{repo: repo, events: events}
}

// ListActive returns active campaigns (member view).
func (s *Service) ListActive(ctx context.Context) ([]Campaign, error) {
	return s.repo.ListActive(ctx)
}

// ListAll returns all campaigns (admin view).
func (s *Service) ListAll(ctx context.Context) ([]Campaign, error) {
	return s.repo.ListAll(ctx)
}

// Get returns one campaign.
func (s *Service) Get(ctx context.Context, id string) (*Campaign, error) {
	return s.repo.Get(ctx, id)
}

// Create validates and creates a campaign (admin).
func (s *Service) Create(ctx context.Context, in CreateInput, createdBy string) (*Campaign, error) {
	if in.Name == "" || in.Slug == "" {
		return nil, fmt.Errorf("campaigns: name and slug are required")
	}
	switch in.RewardModel {
	case RewardFlat, RewardDynamic, RewardLTV:
	case "":
		in.RewardModel = RewardFlat
	default:
		return nil, fmt.Errorf("campaigns: invalid reward_model %q", in.RewardModel)
	}
	return s.repo.Create(ctx, in, createdBy)
}

// Update patches a campaign.
func (s *Service) Update(ctx context.Context, id string, in UpdateInput) (*Campaign, error) {
	if in.RewardModel != nil {
		switch *in.RewardModel {
		case RewardFlat, RewardDynamic, RewardLTV:
		default:
			return nil, fmt.Errorf("campaigns: invalid reward_model %q", *in.RewardModel)
		}
	}
	return s.repo.Update(ctx, id, in)
}

// Activate / Pause / Throttle / End are the lifecycle controls.
func (s *Service) Activate(ctx context.Context, id string) error {
	return s.repo.SetStatus(ctx, id, StatusActive)
}

func (s *Service) Pause(ctx context.Context, id string) error {
	return s.repo.SetStatus(ctx, id, StatusPaused)
}

func (s *Service) End(ctx context.Context, id string) error {
	return s.repo.SetStatus(ctx, id, StatusEnded)
}

// Throttle sets a 0-100 percentage and flips status to 'throttled' when < 100.
func (s *Service) Throttle(ctx context.Context, id string, pct int) error {
	if pct < 0 || pct > 100 {
		return fmt.Errorf("campaigns: throttle pct must be 0-100")
	}
	if err := s.repo.SetThrottle(ctx, id, pct); err != nil {
		return err
	}
	if pct < 100 {
		return s.repo.SetStatus(ctx, id, StatusThrottled)
	}
	return s.repo.SetStatus(ctx, id, StatusActive)
}

// SetBudget configures the budget governor for a campaign.
func (s *Service) SetBudget(ctx context.Context, id string, in BudgetInput) (*Budget, error) {
	if in.TotalBudgetKobo < 0 || in.PerUserCapKobo < 0 || in.DailyCapKobo < 0 || in.MaxCACKobo < 0 {
		return nil, fmt.Errorf("campaigns: budget amounts must be non-negative")
	}
	return s.repo.SetBudget(ctx, id, in)
}

// CheckAndReserve is the budget governor's spend gate. It is fail-closed: a
// reward of amountKobo for a campaign is permitted ONLY if the campaign is live,
// not auto-paused, and the spend keeps total + per-user within configured caps.
// On success it records the spend and re-evaluates auto-pause guardrails.
//
// Callers (RB0 reward accrual paths) consult this before crediting a campaign
// reward. House accruals never carry a campaign_id, so they bypass this entirely.
func (s *Service) CheckAndReserve(ctx context.Context, campaignID string, amountKobo int64) error {
	if campaignID == "" {
		return nil // non-campaign reward — nothing to govern
	}
	if amountKobo < 0 {
		return fmt.Errorf("campaigns: negative reward amount")
	}
	c, err := s.repo.Get(ctx, campaignID)
	if err != nil {
		return err
	}
	if c.Status != StatusActive && c.Status != StatusThrottled {
		return fmt.Errorf("campaigns: campaign %s not live (status=%s)", campaignID, c.Status)
	}
	b, err := s.repo.GetBudget(ctx, campaignID)
	if err != nil {
		return err
	}
	if b.AutoPaused {
		return fmt.Errorf("campaigns: campaign %s auto-paused (%s)", campaignID, b.AutoPauseReason)
	}
	if b.TotalBudgetKobo > 0 && b.SpentKobo+amountKobo > b.TotalBudgetKobo {
		// Exhausted — auto-pause and reject this charge fail-closed.
		_ = s.repo.SetAutoPause(ctx, campaignID, true, ReasonBudgetExhausted)
		_ = s.repo.SetStatus(ctx, campaignID, StatusPaused)
		s.recordPause(ctx, campaignID, ReasonBudgetExhausted)
		return fmt.Errorf("campaigns: budget exhausted for %s", campaignID)
	}
	if b.PerUserCapKobo > 0 && amountKobo > b.PerUserCapKobo {
		return fmt.Errorf("campaigns: per-user cap exceeded for %s", campaignID)
	}
	spent, err := s.repo.AddSpend(ctx, campaignID, amountKobo)
	if err != nil {
		return err
	}
	// Burn-spike guardrail: if newly over 95% of budget, auto-pause proactively.
	if b.TotalBudgetKobo > 0 && spent*100 >= b.TotalBudgetKobo*95 {
		_ = s.repo.SetAutoPause(ctx, campaignID, true, ReasonBurnSpike)
		_ = s.repo.SetStatus(ctx, campaignID, StatusPaused)
		s.recordPause(ctx, campaignID, ReasonBurnSpike)
	}
	return nil
}

// EvaluateGuardrails recomputes ROI/fraud guardrails for a campaign and
// auto-pauses if a guardrail is breached. Intended for a periodic governor job
// or admin-triggered re-check. fraudBps is the externally-measured fraud rate
// (basis points) for this campaign's attributed signups (supplied by RB2 risk).
func (s *Service) EvaluateGuardrails(ctx context.Context, campaignID string, fraudBps int) (*Analytics, error) {
	b, err := s.repo.GetBudget(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	count, beneficiaries, sumKobo, err := s.repo.RewardStats(ctx, campaignID)
	if err != nil {
		return nil, err
	}

	// Fraud-spike guardrail.
	if b.FraudPauseBps > 0 && fraudBps >= b.FraudPauseBps && !b.AutoPaused {
		_ = s.repo.SetAutoPause(ctx, campaignID, true, ReasonFraudSpike)
		_ = s.repo.SetStatus(ctx, campaignID, StatusPaused)
		s.recordPause(ctx, campaignID, ReasonFraudSpike)
		b.AutoPaused = true
		b.AutoPauseReason = ReasonFraudSpike
	}

	// CAC guardrail: realised cost-per-acquired-beneficiary vs ceiling.
	if b.MaxCACKobo > 0 && beneficiaries > 0 && !b.AutoPaused {
		cac := sumKobo / beneficiaries
		if cac > b.MaxCACKobo {
			_ = s.repo.SetAutoPause(ctx, campaignID, true, ReasonCACBreached)
			_ = s.repo.SetStatus(ctx, campaignID, StatusPaused)
			s.recordPause(ctx, campaignID, ReasonCACBreached)
			b.AutoPaused = true
			b.AutoPauseReason = ReasonCACBreached
		}
	}

	return s.analytics(ctx, campaignID, b, count, beneficiaries, sumKobo)
}

// Analytics returns the burn/ROI summary for a campaign (admin A-CMP).
func (s *Service) Analytics(ctx context.Context, campaignID string) (*Analytics, error) {
	b, err := s.repo.GetBudget(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	count, beneficiaries, sumKobo, err := s.repo.RewardStats(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	return s.analytics(ctx, campaignID, b, count, beneficiaries, sumKobo)
}

func (s *Service) analytics(ctx context.Context, campaignID string, b *Budget, count, beneficiaries, sumKobo int64) (*Analytics, error) {
	c, err := s.repo.Get(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	remaining := b.TotalBudgetKobo - b.SpentKobo
	if remaining < 0 {
		remaining = 0
	}
	var burn float64
	if b.TotalBudgetKobo > 0 {
		burn = float64(b.SpentKobo) / float64(b.TotalBudgetKobo) * 100
	}
	return &Analytics{
		CampaignID:      campaignID,
		TotalBudgetKobo: b.TotalBudgetKobo,
		SpentKobo:       b.SpentKobo,
		RemainingKobo:   remaining,
		BurnPct:         burn,
		RewardCount:     count,
		BeneficiaryCnt:  beneficiaries,
		AutoPaused:      b.AutoPaused,
		AutoPauseReason: b.AutoPauseReason,
		Status:          c.Status,
	}, nil
}

func (s *Service) recordPause(ctx context.Context, campaignID, reason string) {
	if s.events == nil {
		return
	}
	_ = s.events.Record(ctx, referralevents.Input{
		EventType:      "campaign_auto_paused",
		CampaignID:     campaignID,
		Payload:        map[string]any{"reason": reason},
		IdempotencyKey: "campaign_auto_pause:" + campaignID + ":" + reason,
	})
}
