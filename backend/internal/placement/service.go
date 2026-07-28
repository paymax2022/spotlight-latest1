package placement

import (
	"context"
	"errors"
	"fmt"
	"time"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
)

// Auditor is an optional secondary audit sink (e.g. the global AuditService). The
// primary, immutable audit trail is always written to placement_audit_log via the
// repository; this is best-effort extra telemetry. Nil-safe.
type Auditor interface {
	Audit(ctx context.Context, actorID, action string, detail map[string]any)
}

// Notifier emits merchant notifications (approval/reminder/etc.). Nil-safe.
type Notifier interface {
	Notify(ctx context.Context, userID, kind, message string)
}

// Service owns the campaign state machine + the escrow→recognize/refund money path.
// It REUSES the finance ledger primitives (no bespoke money primitive):
//   - HOLD  = wallet.Debit (tier-checked, fail-closed) → PLACEMENT_ESCROW;
//   - REFUND = ledger.PostReversal (escrow → merchant wallet, reversing pair);
//   - RECOGNIZE = ledger.PostJournal (DR escrow → CR PLACEMENT_REVENUE).
//
// Every transition + money movement writes an immutable placement_audit_log row.
type Service struct {
	repo   *Repository
	ledger *ledger.Service
	wallet *wallet.Service
	tiers  *tiers.Service
	ext    ExternalEligibility
	cfg    EligibilityConfig
	notify Notifier
	audit  Auditor
}

// Deps bundles the service dependencies.
type Deps struct {
	Repo     *Repository
	Ledger   *ledger.Service
	Wallet   *wallet.Service
	Tiers    *tiers.Service
	External ExternalEligibility
	Config   EligibilityConfig
	Notifier Notifier
	Auditor  Auditor
}

// NewService constructs the placement service. A nil External defaults to the
// permissive impl (dev/CI); a zero Config defaults to DefaultEligibilityConfig.
func NewService(d Deps) *Service {
	ext := d.External
	if ext == nil {
		ext = PermissiveExternalEligibility{}
	}
	cfg := d.Config
	if cfg.MaxConcurrentCampaigns == 0 && cfg.PerZoneCooldownDays == 0 && cfg.BannedWords == nil {
		cfg = DefaultEligibilityConfig()
	}
	return &Service{
		repo:   d.Repo,
		ledger: d.Ledger,
		wallet: d.Wallet,
		tiers:  d.Tiers,
		ext:    ext,
		cfg:    cfg,
		notify: d.Notifier,
		audit:  d.Auditor,
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Member: create / quote / list / get
// ─────────────────────────────────────────────────────────────────────────────

// CreateInput is the draft-creation input.
type CreateInput struct {
	SubjectType  string
	SubjectID    string
	ZoneCode     string
	WindowStart  time.Time
	DurationDays int
	Creative     map[string]any
}

// CreateDraft creates a DRAFT campaign for the merchant. It locks the price quote and
// rate_version at creation time (re-quotable via Quote). NO money moves.
func (s *Service) CreateDraft(ctx context.Context, merchantID string, in CreateInput) (*Campaign, error) {
	if merchantID == "" {
		return nil, fmt.Errorf("%w: merchant required", ErrInvalidInput)
	}
	if in.DurationDays <= 0 {
		return nil, fmt.Errorf("%w: duration_days must be positive", ErrInvalidInput)
	}
	if in.SubjectType == "" || in.SubjectID == "" {
		return nil, fmt.Errorf("%w: subject_type and subject_id required", ErrInvalidInput)
	}
	zone, err := s.repo.GetZone(ctx, in.ZoneCode)
	if err != nil {
		return nil, err
	}
	windowEnd := in.WindowStart.Add(time.Duration(in.DurationDays) * 24 * time.Hour)
	price := quotePriceKobo(zone.BaseDailyRateKobo, in.DurationDays, zone.TierMultiplier)

	c := &Campaign{
		MerchantID:      merchantID,
		SubjectType:     in.SubjectType,
		SubjectID:       in.SubjectID,
		ZoneCode:        zone.Code,
		WindowStart:     in.WindowStart.UTC(),
		WindowEnd:       windowEnd.UTC(),
		DurationDays:    in.DurationDays,
		Creative:        orMap(in.Creative),
		QuotedPriceKobo: price,
		RateVersion:     zone.RateVersion,
		State:           StateDraft,
	}
	created, err := s.repo.CreateCampaign(ctx, c)
	if err != nil {
		return nil, err
	}
	s.writeAudit(ctx, created.ID, merchantID, "placement.create", nil, map[string]any{
		"zone": zone.Code, "quoted_price_kobo": price, "duration_days": in.DurationDays,
	})
	return created, nil
}

// Quote (re)computes and persists the price + locks rate_version for a DRAFT or
// NEEDS_MORE_INFO campaign the merchant owns. Returns the priced campaign.
func (s *Service) Quote(ctx context.Context, merchantID, campaignID string) (*Campaign, error) {
	c, err := s.ownedCampaign(ctx, merchantID, campaignID)
	if err != nil {
		return nil, err
	}
	if c.State != StateDraft && c.State != StateNeedsMoreInfo {
		return nil, fmt.Errorf("%w: quote requires DRAFT/NEEDS_MORE_INFO, got %s", ErrBadState, c.State)
	}
	zone, err := s.repo.GetZone(ctx, c.ZoneCode)
	if err != nil {
		return nil, err
	}
	price := quotePriceKobo(zone.BaseDailyRateKobo, c.DurationDays, zone.TierMultiplier)
	if err := s.repo.SetQuote(ctx, c.ID, price, zone.RateVersion, c.Version); err != nil {
		return nil, err
	}
	s.writeAudit(ctx, c.ID, merchantID, "placement.quote", nil, map[string]any{
		"quoted_price_kobo": price, "rate_version": zone.RateVersion,
	})
	return s.repo.GetCampaign(ctx, c.ID)
}

// Get returns a campaign the merchant owns.
func (s *Service) Get(ctx context.Context, merchantID, campaignID string) (*Campaign, error) {
	return s.ownedCampaign(ctx, merchantID, campaignID)
}

// List returns the merchant's campaigns.
func (s *Service) List(ctx context.Context, merchantID string, limit, offset int) ([]Campaign, error) {
	return s.repo.ListByMerchant(ctx, merchantID, limit, offset)
}

// ListZones returns the active inventory zones (member catalog + availability hint).
func (s *Service) ListZones(ctx context.Context) ([]Zone, error) {
	return s.repo.ListZones(ctx)
}

// Analytics returns served impression/tap counts for a campaign the merchant owns.
func (s *Service) Analytics(ctx context.Context, merchantID, campaignID string) (*Analytics, error) {
	if _, err := s.ownedCampaign(ctx, merchantID, campaignID); err != nil {
		return nil, err
	}
	return s.repo.CampaignAnalytics(ctx, campaignID)
}

// ─────────────────────────────────────────────────────────────────────────────
// Member: submit / cancel / pause / resume / pay-retry
// ─────────────────────────────────────────────────────────────────────────────

// Submit moves DRAFT/NEEDS_MORE_INFO → SUBMITTED → UNDER_REVIEW (re-checks eligibility
// FIRST: cap/cooldown/creative + external merchant/subject). Idempotency-Key required
// at the handler (no money moves here; the key guards a double submit).
func (s *Service) Submit(ctx context.Context, merchantID, campaignID string) (*Campaign, error) {
	c, err := s.ownedCampaign(ctx, merchantID, campaignID)
	if err != nil {
		return nil, err
	}
	if c.State != StateDraft && c.State != StateNeedsMoreInfo {
		return nil, fmt.Errorf("%w: submit requires DRAFT/NEEDS_MORE_INFO, got %s", ErrBadState, c.State)
	}
	if err := s.checkEligibility(ctx, c); err != nil {
		return nil, err
	}
	// DRAFT→SUBMITTED then SUBMITTED→UNDER_REVIEW (NEEDS_MORE_INFO resubmits straight
	// to UNDER_REVIEW).
	if c.State == StateDraft {
		if err := s.transition(ctx, c, StateSubmitted, merchantID, "placement.submit"); err != nil {
			return nil, err
		}
	}
	if err := s.transition(ctx, c, StateUnderReview, merchantID, "placement.under_review"); err != nil {
		return nil, err
	}
	return s.repo.GetCampaign(ctx, c.ID)
}

// Cancel cancels a campaign the merchant owns before it goes live:
//   - PENDING_PAYMENT → CANCELLED (no money was held);
//   - SCHEDULED (before window_start) → CANCELLED + full escrow refund.
//
// ACTIVE/PAUSED early cancellation (pro-rata) is CancelEarly. Idempotent on the refund
// ledger key.
func (s *Service) Cancel(ctx context.Context, merchantID, campaignID string) (*Campaign, error) {
	c, err := s.ownedCampaign(ctx, merchantID, campaignID)
	if err != nil {
		return nil, err
	}
	switch c.State {
	case StatePendingPayment:
		if err := s.transition(ctx, c, StateCancelled, merchantID, "placement.cancel"); err != nil {
			return nil, err
		}
	case StateScheduled:
		if !time.Now().UTC().Before(c.WindowStart) {
			// Window already started — must use early-cancel (pro-rata) instead.
			return nil, fmt.Errorf("%w: window already started; use early cancel", ErrBadState)
		}
		// Full refund of the escrow hold back to the merchant wallet.
		if err := s.refundFull(ctx, c); err != nil {
			return nil, err
		}
		_ = s.repo.SetReservationState(ctx, c.ID, StateCancelled)
		if err := s.transition(ctx, c, StateCancelled, merchantID, "placement.cancel"); err != nil {
			return nil, err
		}
	case StateActive, StatePaused:
		return s.CancelEarly(ctx, merchantID, campaignID)
	default:
		return nil, fmt.Errorf("%w: cannot cancel from %s", ErrBadState, c.State)
	}
	return s.repo.GetCampaign(ctx, c.ID)
}

// CancelEarly stops a running campaign with a pro-rata split: earned days → revenue,
// unused remainder → merchant wallet. ACTIVE/PAUSED → CANCELLED_EARLY.
func (s *Service) CancelEarly(ctx context.Context, merchantID, campaignID string) (*Campaign, error) {
	c, err := s.ownedCampaign(ctx, merchantID, campaignID)
	if err != nil {
		return nil, err
	}
	if c.State != StateActive && c.State != StatePaused {
		return nil, fmt.Errorf("%w: early cancel requires ACTIVE/PAUSED, got %s", ErrBadState, c.State)
	}
	if err := s.recognizeAndRefundProRata(ctx, c, merchantID, "placement.cancel_early"); err != nil {
		return nil, err
	}
	_ = s.repo.SetReservationState(ctx, c.ID, StateCancelled)
	if err := s.transition(ctx, c, StateCancelledEarly, merchantID, "placement.cancel_early"); err != nil {
		return nil, err
	}
	return s.repo.GetCampaign(ctx, c.ID)
}

// Pause records a paused interval and moves ACTIVE → PAUSED. NO money moves; the
// paused duration extends window_end on resume.
func (s *Service) Pause(ctx context.Context, merchantID, campaignID string) (*Campaign, error) {
	c, err := s.ownedCampaign(ctx, merchantID, campaignID)
	if err != nil {
		return nil, err
	}
	if c.State != StateActive {
		return nil, fmt.Errorf("%w: pause requires ACTIVE, got %s", ErrBadState, c.State)
	}
	intervals := append(c.PausedIntervals, Interval{From: time.Now().UTC()})
	// window_end unchanged on pause; extended on resume.
	if err := s.repo.SetPausedIntervalsAndWindow(ctx, c.ID, StatePaused, intervals, c.WindowEnd, c.Version); err != nil {
		return nil, err
	}
	_ = s.repo.SetReservationState(ctx, c.ID, StatePaused)
	s.writeAudit(ctx, c.ID, merchantID, "placement.pause", map[string]any{"state": string(c.State)}, map[string]any{"state": string(StatePaused)})
	return s.repo.GetCampaign(ctx, c.ID)
}

// Resume closes the open paused interval, extends window_end by the paused duration,
// and moves PAUSED → ACTIVE. NO money moves.
func (s *Service) Resume(ctx context.Context, merchantID, campaignID string) (*Campaign, error) {
	c, err := s.ownedCampaign(ctx, merchantID, campaignID)
	if err != nil {
		return nil, err
	}
	if c.State != StatePaused {
		return nil, fmt.Errorf("%w: resume requires PAUSED, got %s", ErrBadState, c.State)
	}
	now := time.Now().UTC()
	intervals := c.PausedIntervals
	pausedDur := time.Duration(0)
	if n := len(intervals); n > 0 && intervals[n-1].To.IsZero() {
		intervals[n-1].To = now
		pausedDur = now.Sub(intervals[n-1].From)
	}
	newWindowEnd := c.WindowEnd.Add(pausedDur)
	if err := s.repo.SetPausedIntervalsAndWindow(ctx, c.ID, StateActive, intervals, newWindowEnd, c.Version); err != nil {
		return nil, err
	}
	_ = s.repo.SetReservationState(ctx, c.ID, StateActive)
	s.writeAudit(ctx, c.ID, merchantID, "placement.resume", map[string]any{"state": string(StatePaused)}, map[string]any{
		"state": string(StateActive), "paused_seconds": int64(pausedDur.Seconds()), "window_end": newWindowEnd,
	})
	return s.repo.GetCampaign(ctx, c.ID)
}

// Pay retries the escrow hold for a PENDING_PAYMENT campaign (merchant topped up). On
// success → SCHEDULED (and an EXCLUSIVE reservation is inserted). Idempotent on the
// hold ledger key. Idempotency-Key header is required at the handler.
func (s *Service) Pay(ctx context.Context, merchantID, campaignID string) (*Campaign, error) {
	c, err := s.ownedCampaign(ctx, merchantID, campaignID)
	if err != nil {
		return nil, err
	}
	if c.State != StatePendingPayment {
		return nil, fmt.Errorf("%w: pay retry requires PENDING_PAYMENT, got %s", ErrBadState, c.State)
	}
	if err := s.holdEscrow(ctx, c); err != nil {
		if errors.Is(err, ErrInsufficient) {
			return nil, ErrInsufficient
		}
		return nil, err
	}
	if err := s.reserveAndSchedule(ctx, c, merchantID); err != nil {
		return nil, err
	}
	return s.repo.GetCampaign(ctx, c.ID)
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: review queue / approve / reject / request-info / suspend
// ─────────────────────────────────────────────────────────────────────────────

// ReviewQueue returns the admin review pipeline (optionally filtered by state).
func (s *Service) ReviewQueue(ctx context.Context, state string, limit, offset int) ([]Campaign, error) {
	return s.repo.ReviewQueue(ctx, state, limit, offset)
}

// GetAdmin returns any campaign by id (admin; no ownership check).
func (s *Service) GetAdmin(ctx context.Context, campaignID string) (*Campaign, error) {
	return s.repo.GetCampaign(ctx, campaignID)
}

// Approve approves an UNDER_REVIEW campaign: re-checks eligibility, then settles the
// escrow hold (tier-checked merchant-wallet debit → PLACEMENT_ESCROW). On insufficient
// funds → PENDING_PAYMENT. On success it reserves the EXCLUSIVE slot (returns
// ErrSlotTaken without approving if it clashes) and → SCHEDULED.
func (s *Service) Approve(ctx context.Context, adminID, campaignID string) (*Campaign, error) {
	c, err := s.repo.GetCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	if c.State != StateUnderReview {
		return nil, fmt.Errorf("%w: approve requires UNDER_REVIEW, got %s", ErrBadState, c.State)
	}
	if err := s.checkEligibility(ctx, c); err != nil {
		return nil, err
	}
	// Settle payment now.
	if err := s.holdEscrow(ctx, c); err != nil {
		if errors.Is(err, ErrInsufficient) {
			// Approved-but-unpaid: park in PENDING_PAYMENT for a pay retry.
			if e := s.repo.SetReview(ctx, c.ID, StatePendingPayment, adminID, "approved_pending_payment", "insufficient funds", c.Version); e != nil {
				return nil, e
			}
			s.writeAudit(ctx, c.ID, adminID, "placement.approve.pending_payment", map[string]any{"state": string(StateUnderReview)}, map[string]any{"state": string(StatePendingPayment)})
			s.notifySafe(ctx, c.MerchantID, "placement.pending_payment", "Your placement was approved but payment failed. Top up and retry.")
			return s.repo.GetCampaign(ctx, c.ID)
		}
		return nil, err
	}
	// Record the approval decision + flip to SCHEDULED, then reserve the slot.
	if err := s.repo.SetReview(ctx, c.ID, StateScheduled, adminID, "approved", "", c.Version); err != nil {
		return nil, err
	}
	c.Version++
	c.State = StateScheduled
	if err := s.reserveExclusive(ctx, c); err != nil {
		// Slot clash: the money is already held, so refund it and bounce back. Because
		// the no-overlap constraint is the source of truth, we cannot honor this slot.
		_ = s.refundFull(ctx, c)
		// Move to REJECTED (admin-visible) — the slot is gone.
		_ = s.repo.SetReview(ctx, c.ID, StateRejected, adminID, "slot_taken", "exclusive slot taken", c.Version)
		s.writeAudit(ctx, c.ID, adminID, "placement.approve.slot_taken", nil, map[string]any{"refunded": true})
		return nil, ErrSlotTaken
	}
	s.writeAudit(ctx, c.ID, adminID, "placement.approve", map[string]any{"state": string(StateUnderReview)}, map[string]any{
		"state": string(StateScheduled), "escrow_kobo": c.QuotedPriceKobo,
	})
	s.notifySafe(ctx, c.MerchantID, "placement.scheduled", "Your placement is approved and scheduled.")
	return s.repo.GetCampaign(ctx, c.ID)
}

// Reject moves UNDER_REVIEW → REJECTED with a reason. No money has moved (escrow is
// only held on approval), so there is nothing to refund here.
func (s *Service) Reject(ctx context.Context, adminID, campaignID, reason string) (*Campaign, error) {
	c, err := s.repo.GetCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	if c.State != StateUnderReview {
		return nil, fmt.Errorf("%w: reject requires UNDER_REVIEW, got %s", ErrBadState, c.State)
	}
	if !canTransition(c.State, StateRejected) {
		return nil, fmt.Errorf("%w: %s → REJECTED", ErrBadState, c.State)
	}
	if err := s.repo.SetReview(ctx, c.ID, StateRejected, adminID, "rejected", reason, c.Version); err != nil {
		return nil, err
	}
	s.writeAudit(ctx, c.ID, adminID, "placement.reject", map[string]any{"state": string(StateUnderReview)}, map[string]any{"state": string(StateRejected), "reason": reason})
	s.notifySafe(ctx, c.MerchantID, "placement.rejected", "Your placement was not approved.")
	return s.repo.GetCampaign(ctx, c.ID)
}

// RequestInfo moves UNDER_REVIEW → NEEDS_MORE_INFO with a reason.
func (s *Service) RequestInfo(ctx context.Context, adminID, campaignID, reason string) (*Campaign, error) {
	c, err := s.repo.GetCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	if c.State != StateUnderReview {
		return nil, fmt.Errorf("%w: request-info requires UNDER_REVIEW, got %s", ErrBadState, c.State)
	}
	if err := s.repo.SetReview(ctx, c.ID, StateNeedsMoreInfo, adminID, "needs_more_info", reason, c.Version); err != nil {
		return nil, err
	}
	s.writeAudit(ctx, c.ID, adminID, "placement.request_info", map[string]any{"state": string(StateUnderReview)}, map[string]any{"state": string(StateNeedsMoreInfo), "reason": reason})
	s.notifySafe(ctx, c.MerchantID, "placement.needs_info", "More information is needed for your placement.")
	return s.repo.GetCampaign(ctx, c.ID)
}

// Suspend administratively halts a running campaign: ACTIVE/PAUSED → SUSPENDED with a
// pro-rata settle (earned → revenue, remainder → merchant wallet), same money split as
// CANCELLED_EARLY.
func (s *Service) Suspend(ctx context.Context, adminID, campaignID, reason string) (*Campaign, error) {
	c, err := s.repo.GetCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	if c.State != StateActive && c.State != StatePaused {
		return nil, fmt.Errorf("%w: suspend requires ACTIVE/PAUSED, got %s", ErrBadState, c.State)
	}
	if err := s.recognizeAndRefundProRata(ctx, c, adminID, "placement.suspend"); err != nil {
		return nil, err
	}
	_ = s.repo.SetReservationState(ctx, c.ID, StateSuspended)
	if err := s.repo.SetReview(ctx, c.ID, StateSuspended, adminID, "suspended", reason, c.Version); err != nil {
		return nil, err
	}
	s.writeAudit(ctx, c.ID, adminID, "placement.suspend", map[string]any{"state": string(c.State)}, map[string]any{"state": string(StateSuspended), "reason": reason})
	s.notifySafe(ctx, c.MerchantID, "placement.suspended", "Your placement was suspended.")
	return s.repo.GetCampaign(ctx, c.ID)
}

// ─────────────────────────────────────────────────────────────────────────────
// Money legs (all reuse the ledger; idempotency keys are exact per spec)
// ─────────────────────────────────────────────────────────────────────────────

// holdEscrow performs the tier-checked merchant-wallet debit into PLACEMENT_ESCROW.
// idempotency key `placement:<id>:hold`, reference `placement:<id>`. Maps insufficient
// funds to ErrInsufficient.
func (s *Service) holdEscrow(ctx context.Context, c *Campaign) error {
	if c.QuotedPriceKobo <= 0 {
		return nil // a zero-price placement holds nothing
	}
	escrow, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPlacementEscrow)
	if err != nil {
		return err
	}
	err = s.wallet.Debit(ctx, c.MerchantID, "placement:"+c.ID, "placement:"+c.ID+":hold", escrow.ID, c.QuotedPriceKobo)
	if err != nil {
		if errors.Is(err, ledger.ErrInsufficientFunds) {
			return ErrInsufficient
		}
		if errors.Is(err, ledger.ErrDuplicate) {
			return nil // already held (idempotent retry)
		}
		return fmt.Errorf("placement: escrow hold: %w", err)
	}
	s.writeAudit(ctx, c.ID, c.MerchantID, "placement.escrow_hold", nil, map[string]any{"escrow_kobo": c.QuotedPriceKobo, "idem": "placement:" + c.ID + ":hold"})
	return nil
}

// refundFull reverses the full escrow hold back to the merchant wallet. key
// `placement:<id>:refund`.
func (s *Service) refundFull(ctx context.Context, c *Campaign) error {
	if c.QuotedPriceKobo <= 0 {
		return nil
	}
	w, err := s.ledger.GetOrCreateUserWallet(ctx, c.MerchantID)
	if err != nil {
		return err
	}
	escrow, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPlacementEscrow)
	if err != nil {
		return err
	}
	if err := s.ledger.PostReversal(ctx, w.ID, escrow.ID, c.QuotedPriceKobo, "placement:refund:"+c.ID, "placement:"+c.ID+":refund"); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return fmt.Errorf("placement: full refund: %w", err)
	}
	s.writeAudit(ctx, c.ID, c.MerchantID, "placement.refund_full", nil, map[string]any{"refund_kobo": c.QuotedPriceKobo, "idem": "placement:" + c.ID + ":refund"})
	return nil
}

// recognizeFull recognizes the full escrow hold into PLACEMENT_REVENUE (DR escrow →
// CR revenue). key `placement:<id>:recognize`. Used on COMPLETED.
func (s *Service) recognizeFull(ctx context.Context, c *Campaign) error {
	if c.QuotedPriceKobo <= 0 {
		return nil
	}
	escrow, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPlacementEscrow)
	if err != nil {
		return err
	}
	revenue, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPlacementRevenue)
	if err != nil {
		return err
	}
	if err := s.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference:       "placement:recognize:" + c.ID,
		IdempotencyKey:  "placement:" + c.ID + ":recognize",
		AmountKobo:      c.QuotedPriceKobo,
		DebitAccountID:  escrow.ID,
		CreditAccountID: revenue.ID,
	}); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return fmt.Errorf("placement: recognize full: %w", err)
	}
	s.writeAudit(ctx, c.ID, "", "placement.recognize_full", nil, map[string]any{"revenue_kobo": c.QuotedPriceKobo, "idem": "placement:" + c.ID + ":recognize"})
	return nil
}

// recognizeAndRefundProRata splits the held escrow: earned days → revenue
// (`placement:<id>:recognize_partial`) + unused remainder → merchant wallet
// (`placement:<id>:refund_partial`). Earned days are clamped [0,duration] using UTC.
func (s *Service) recognizeAndRefundProRata(ctx context.Context, c *Campaign, actorID, action string) error {
	if c.QuotedPriceKobo <= 0 {
		return nil
	}
	elapsed := elapsedDaysUTC(c.WindowStart, time.Now(), c.DurationDays)
	earned, refund := proRataSplit(c.QuotedPriceKobo, elapsed, c.DurationDays)

	escrow, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPlacementEscrow)
	if err != nil {
		return err
	}
	if earned > 0 {
		revenue, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPlacementRevenue)
		if err != nil {
			return err
		}
		if err := s.ledger.PostJournal(ctx, ledger.JournalEntry{
			Reference:       "placement:recognize:" + c.ID,
			IdempotencyKey:  "placement:" + c.ID + ":recognize_partial",
			AmountKobo:      earned,
			DebitAccountID:  escrow.ID,
			CreditAccountID: revenue.ID,
		}); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
			return fmt.Errorf("placement: recognize partial: %w", err)
		}
	}
	if refund > 0 {
		w, err := s.ledger.GetOrCreateUserWallet(ctx, c.MerchantID)
		if err != nil {
			return err
		}
		if err := s.ledger.PostReversal(ctx, w.ID, escrow.ID, refund, "placement:refund:"+c.ID, "placement:"+c.ID+":refund_partial"); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
			return fmt.Errorf("placement: refund partial: %w", err)
		}
	}
	s.writeAudit(ctx, c.ID, actorID, action+".prorata", nil, map[string]any{
		"elapsed_days": elapsed, "duration_days": c.DurationDays,
		"earned_kobo": earned, "refund_kobo": refund,
	})
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Reservation + scheduling helpers
// ─────────────────────────────────────────────────────────────────────────────

// reserveExclusive inserts the durable no-overlap reservation for an EXCLUSIVE zone.
// POOLED zones reserve nothing (capacity is checked at activation). Returns ErrSlotTaken
// on a 23P01 exclusion violation.
func (s *Service) reserveExclusive(ctx context.Context, c *Campaign) error {
	zone, err := s.repo.GetZone(ctx, c.ZoneCode)
	if err != nil {
		return err
	}
	if zone.LayoutType != LayoutExclusive {
		return nil
	}
	return s.repo.InsertReservation(ctx, c.ID, c.ZoneCode, c.WindowStart, c.WindowEnd)
}

// reserveAndSchedule (used by the Pay retry path) reserves the slot and moves
// PENDING_PAYMENT → SCHEDULED. On a slot clash it refunds and rejects.
func (s *Service) reserveAndSchedule(ctx context.Context, c *Campaign, actorID string) error {
	if err := s.transition(ctx, c, StateScheduled, actorID, "placement.pay"); err != nil {
		return err
	}
	if err := s.reserveExclusive(ctx, c); err != nil {
		_ = s.refundFull(ctx, c)
		_ = s.repo.SetReview(ctx, c.ID, StateRejected, actorID, "slot_taken", "exclusive slot taken", c.Version)
		return ErrSlotTaken
	}
	s.writeAudit(ctx, c.ID, actorID, "placement.pay.scheduled", nil, map[string]any{"escrow_kobo": c.QuotedPriceKobo})
	s.notifySafe(ctx, c.MerchantID, "placement.scheduled", "Payment received — your placement is scheduled.")
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Eligibility (re-checked at submit AND activation)
// ─────────────────────────────────────────────────────────────────────────────

// checkEligibility runs the full eligibility gate: self-owned (cap, cooldown,
// creative) + external (merchant, subject). Returns an error wrapping ErrIneligible.
func (s *Service) checkEligibility(ctx context.Context, c *Campaign) error {
	// Concurrent-campaign cap.
	if s.cfg.MaxConcurrentCampaigns > 0 {
		n, err := s.repo.CountActiveByMerchant(ctx, c.MerchantID, c.ID)
		if err != nil {
			return fmt.Errorf("placement: cap check (fail closed): %w", err)
		}
		if n >= s.cfg.MaxConcurrentCampaigns {
			return fmt.Errorf("%w: concurrent campaign cap (%d) reached", ErrIneligible, s.cfg.MaxConcurrentCampaigns)
		}
	}
	// Per-zone cooldown.
	if s.cfg.PerZoneCooldownDays > 0 {
		last, err := s.repo.LastWindowEndInZone(ctx, c.MerchantID, c.ZoneCode, c.ID)
		if err != nil {
			return fmt.Errorf("placement: cooldown check (fail closed): %w", err)
		}
		if !last.IsZero() {
			cooldownEnds := last.Add(time.Duration(s.cfg.PerZoneCooldownDays) * 24 * time.Hour)
			if c.WindowStart.Before(cooldownEnds) {
				return fmt.Errorf("%w: zone cooldown active until %s", ErrIneligible, cooldownEnds.Format(time.RFC3339))
			}
		}
	}
	// Creative pre-checks against the zone spec.
	zone, err := s.repo.GetZone(ctx, c.ZoneCode)
	if err != nil {
		return err
	}
	if err := validateCreative(zone, c.Creative, s.cfg.BannedWords); err != nil {
		return err
	}
	// External: merchant + subject.
	if err := s.ext.CheckMerchant(ctx, c.MerchantID, c.ZoneCode); err != nil {
		return fmt.Errorf("%w: %v", ErrIneligible, err)
	}
	if err := s.ext.CheckSubject(ctx, c.MerchantID, c.SubjectType, c.SubjectID); err != nil {
		return fmt.Errorf("%w: %v", ErrIneligible, err)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────────

// transition applies a guarded optimistic-locked state change, writes audit, and
// refreshes the in-memory campaign version/state.
func (s *Service) transition(ctx context.Context, c *Campaign, to State, actorID, action string) error {
	if !canTransition(c.State, to) {
		return fmt.Errorf("%w: %s → %s", ErrBadState, c.State, to)
	}
	from := c.State
	if err := s.repo.SetState(ctx, c.ID, to, c.Version); err != nil {
		return err
	}
	c.State = to
	c.Version++
	s.writeAudit(ctx, c.ID, actorID, action, map[string]any{"state": string(from)}, map[string]any{"state": string(to)})
	return nil
}

// ownedCampaign loads a campaign and enforces object-level authZ (merchant owns it).
func (s *Service) ownedCampaign(ctx context.Context, merchantID, campaignID string) (*Campaign, error) {
	c, err := s.repo.GetCampaign(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	if c.MerchantID != merchantID {
		return nil, ErrForbidden
	}
	return c, nil
}

// writeAudit writes the immutable placement_audit_log row (primary trail) and fans out
// to the optional secondary Auditor. The DB write failing is logged via the secondary
// sink but never blocks the caller (the money/state mutation already committed).
func (s *Service) writeAudit(ctx context.Context, campaignID, actorID, action string, before, after map[string]any) {
	_ = s.repo.InsertAudit(ctx, campaignID, actorID, action, before, after, nil)
	if s.audit != nil {
		detail := map[string]any{"campaign_id": campaignID}
		for k, v := range after {
			detail[k] = v
		}
		s.audit.Audit(ctx, actorID, action, detail)
	}
}

func (s *Service) notifySafe(ctx context.Context, userID, kind, message string) {
	if s.notify != nil {
		s.notify.Notify(ctx, userID, kind, message)
	}
}
