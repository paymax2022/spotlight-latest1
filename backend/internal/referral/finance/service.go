package finance

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/go-common/timeutil"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/middleware"
	referralevents "spotlight/backend/internal/referral/events"
	"spotlight/backend/internal/services"
)

const keyInvalidBody = "invalid body"

const keyError = "error"

// minPayoutTier is the KYC tier required to receive a referral payout (Tier/KYC
// gated). Tier 1 (basic verified) is the floor; admins can raise this in policy.
const minPayoutTier = 1

// Service is the referral finance service: payout queue + approvals,
// reconciliation, budget/burn monitoring, float, and reward-to-LTV.
type Service struct {
	repo    *Repository
	finance *financeledger.Service  // posts the real wallet credit (double-entry, idempotent)
	events  *referralevents.Service // audit
}

func NewService(repo *Repository, finance *financeledger.Service, events *referralevents.Service) *Service {
	return &Service{repo: repo, finance: finance, events: events}
}

// QueuePayout enqueues a payout request. Tier/KYC is checked at queue time and
// re-checked at approval (fail-closed). Idempotent on idempotency_key.
func (s *Service) QueuePayout(ctx context.Context, in PayoutRequest, requestedBy string) (*Payout, error) {
	if in.BeneficiaryID == "" {
		return nil, errors.New("finance: payout requires beneficiary_id")
	}
	if in.AmountKobo <= 0 {
		return nil, errors.New("finance: payout amount must be positive (kobo)")
	}
	if in.IdempotencyKey == "" {
		return nil, errors.New("finance: payout requires an idempotency key")
	}
	tier, err := s.repo.KYCTier(ctx, in.BeneficiaryID)
	if err != nil {
		return nil, err
	}
	if tier < minPayoutTier {
		return nil, fmt.Errorf("finance: beneficiary KYC tier %d below required %d", tier, minPayoutTier)
	}
	p, created, err := s.repo.QueuePayout(ctx, in, requestedBy)
	if err != nil {
		return nil, err
	}
	if created {
		s.audit(ctx, "payout_queued", in.BeneficiaryID, in.RewardID,
			map[string]any{"amount_kobo": in.AmountKobo}, "payout_queued:"+in.IdempotencyKey)
	}
	return p, nil
}

func (s *Service) ListPayouts(ctx context.Context, status string) ([]Payout, error) {
	return s.repo.ListPayouts(ctx, status, 200)
}

// ApprovePayout approves and executes a queued payout: it re-checks Tier/KYC, then
// posts a balanced wallet credit through the finance ledger (DR referral-reward
// expense → CR beneficiary wallet) with a unique idempotency key, and marks the
// payout paid. Idempotent — a duplicate ledger key is a safe no-op.
func (s *Service) ApprovePayout(ctx context.Context, payoutID, approvedBy string) (*Payout, error) {
	p, err := s.repo.GetPayout(ctx, payoutID)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, errors.New("finance: payout not found")
	}
	if p.Status == PayoutPaid {
		return p, nil // idempotent
	}
	if p.Status != PayoutQueued && p.Status != PayoutApproved {
		return nil, fmt.Errorf("finance: payout in state %q cannot be approved", p.Status)
	}

	tier, err := s.repo.KYCTier(ctx, p.BeneficiaryID)
	if err != nil {
		return nil, err
	}
	if tier < minPayoutTier {
		return nil, fmt.Errorf("finance: beneficiary KYC tier %d below required %d", tier, minPayoutTier)
	}

	if s.finance == nil {
		return nil, errors.New("finance: ledger unavailable")
	}
	acc, err := s.finance.GetOrCreateStandingAccount(ctx, financeledger.AccountReferralReward)
	if err != nil {
		return nil, fmt.Errorf("finance: standing account: %w", err)
	}
	idemKey := "referral_payout:" + payoutID
	ref := "referral:payout:" + payoutID
	if err := s.finance.Credit(ctx, p.BeneficiaryID, ref, idemKey, acc.ID, p.AmountKobo); err != nil {
		if !errors.Is(err, financeledger.ErrDuplicate) {
			_ = s.repo.MarkPayoutFailed(ctx, payoutID, "ledger_post_failed")
			return nil, fmt.Errorf("finance: post payout credit: %w", err)
		}
	}
	if err := s.repo.MarkPayoutPaid(ctx, payoutID, approvedBy, idemKey); err != nil {
		return nil, err
	}
	// Track program burn (best-effort, against the global program budget).
	_ = s.repo.AddSpend(ctx, "program", "global", p.AmountKobo)

	s.audit(ctx, "payout_paid", p.BeneficiaryID, p.RewardID,
		map[string]any{"amount_kobo": p.AmountKobo, "approved_by": approvedBy}, "payout_paid:"+payoutID)
	return s.repo.GetPayout(ctx, payoutID)
}

// RejectPayout rejects a queued/approved payout.
func (s *Service) RejectPayout(ctx context.Context, payoutID, approvedBy, reason string) error {
	if err := s.repo.RejectPayout(ctx, payoutID, approvedBy, reason); err != nil {
		return err
	}
	s.audit(ctx, "payout_rejected", "", "",
		map[string]any{"payout_id": payoutID, "reason": reason}, "payout_rejected:"+payoutID)
	return nil
}

// Reconcile compares the RB0 reward ledger 'paid' total against wallet payout
// postings for a period and records a snapshot (balanced or variance).
func (s *Service) Reconcile(ctx context.Context, since, until, createdBy string) (*Reconciliation, error) {
	if since == "" || until == "" {
		return nil, errors.New("finance: reconcile requires since and until")
	}
	ledgerPaid, err := s.repo.LedgerPaidInPeriod(ctx, since, until)
	if err != nil {
		return nil, err
	}
	walletPaid, err := s.repo.WalletPaidInPeriod(ctx, since, until)
	if err != nil {
		return nil, err
	}
	variance := ledgerPaid - walletPaid
	status := ReconBalanced
	if variance != 0 {
		status = ReconVariance
	}
	ps, _ := timeutil.ParseTime(since)
	pe, _ := timeutil.ParseTime(until)
	rc := Reconciliation{
		PeriodStart:    ps,
		PeriodEnd:      pe,
		LedgerPaidKobo: ledgerPaid,
		WalletPaidKobo: walletPaid,
		VarianceKobo:   variance,
		Status:         status,
	}
	return s.repo.InsertReconciliation(ctx, rc, createdBy)
}

func (s *Service) ListReconciliations(ctx context.Context) ([]Reconciliation, error) {
	return s.repo.ListReconciliations(ctx)
}

func (s *Service) UpsertBudget(ctx context.Context, in BudgetInput) (*Budget, error) {
	if in.BudgetKobo < 0 {
		return nil, errors.New("finance: budget must be non-negative")
	}
	if in.AlertThresholdPct != nil && (*in.AlertThresholdPct < 0 || *in.AlertThresholdPct > 100) {
		return nil, errors.New("finance: alert threshold must be 0..100")
	}
	return s.repo.UpsertBudget(ctx, in)
}

// ListBudgets returns budgets with burn % computed; flags any over threshold.
func (s *Service) ListBudgets(ctx context.Context) ([]Budget, error) {
	budgets, err := s.repo.ListBudgets(ctx)
	if err != nil {
		return nil, err
	}
	for _, b := range budgets {
		if b.AlertTriggered {
			s.audit(ctx, "budget_burn_alert", "", "",
				map[string]any{"scope": b.Scope, "scope_ref": b.ScopeRef, "burn_pct": b.BurnPct},
				fmt.Sprintf("budget_alert:%s:%s:%d", b.Scope, b.ScopeRef, b.BurnPct))
		}
	}
	return budgets, nil
}

func (s *Service) SnapshotFloat(ctx context.Context, fundedKobo int64, note string) (*Float, error) {
	if fundedKobo < 0 {
		return nil, errors.New("finance: funded amount must be non-negative")
	}
	return s.repo.SnapshotFloat(ctx, fundedKobo, note)
}

func (s *Service) LatestFloat(ctx context.Context) (*Float, error) { return s.repo.LatestFloat(ctx) }

func (s *Service) RewardToLTV(ctx context.Context) (*RewardToLTV, error) {
	return s.repo.RewardToLTV(ctx)
}

func (s *Service) audit(ctx context.Context, eventType, userID, rewardID string, extra map[string]any, idemKey string) {
	if s.events == nil {
		return
	}
	payload := map[string]any{}
	maps.Copy(payload, extra)
	if rewardID != "" {
		payload["reward_id"] = rewardID
	}
	_ = s.events.Record(ctx, referralevents.Input{
		EventType:      eventType,
		UserID:         userID,
		Payload:        payload,
		IdempotencyKey: idemKey,
	})
}

// Handler exposes admin finance/payout endpoints (no member surface — payouts are
// admin-governed; members see their rewards via the RB0 ledger handler).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register wires finance routes onto the referral admin group.
//   - admin: /api/referral/admin/finance/*  (RBAC referral.payout.* / referral.finance.view)
func Register(admin *gin.RouterGroup, svc *Service, rbac services.RBACService) {
	h := NewHandler(svc)
	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }

	ag := admin.Group("/finance")
	// payout queue + approvals
	ag.GET("/payouts", guard("referral.payout.view"), h.ListPayouts)
	ag.POST("/payouts", guard("referral.payout.manage"), h.QueuePayout)
	ag.POST("/payouts/:id/approve", guard("referral.payout.manage"), h.ApprovePayout)
	ag.POST("/payouts/:id/reject", guard("referral.payout.manage"), h.RejectPayout)
	// reconciliation
	ag.GET("/reconciliation", guard("referral.finance.view"), h.ListReconciliations)
	ag.POST("/reconciliation", guard("referral.finance.view"), h.Reconcile)
	// budgets & burn
	ag.GET("/budgets", guard("referral.finance.view"), h.ListBudgets)
	ag.PUT("/budgets", guard("referral.payout.manage"), h.UpsertBudget)
	// float
	ag.GET("/float", guard("referral.finance.view"), h.LatestFloat)
	ag.POST("/float", guard("referral.payout.manage"), h.SnapshotFloat)
	ag.GET("/reward-to-ltv", guard("referral.finance.view"), h.RewardToLTV)
}

func uid(c *gin.Context) string {
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ginutil.UserID(c)
}

func (h *Handler) ListPayouts(c *gin.Context) {
	list, err := h.svc.ListPayouts(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"payouts": list})
}

func (h *Handler) QueuePayout(c *gin.Context) {
	var in PayoutRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidBody})
		return
	}
	if in.IdempotencyKey == "" {
		in.IdempotencyKey = ginutil.IdempotencyKey(c)
	}
	p, err := h.svc.QueuePayout(c.Request.Context(), in, uid(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"payout": p})
}

func (h *Handler) ApprovePayout(c *gin.Context) {
	p, err := h.svc.ApprovePayout(c.Request.Context(), c.Param("id"), uid(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"payout": p})
}

func (h *Handler) RejectPayout(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body)
	if err := h.svc.RejectPayout(c.Request.Context(), c.Param("id"), uid(c), body.Reason); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) ListReconciliations(c *gin.Context) {
	list, err := h.svc.ListReconciliations(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reconciliations": list})
}

func (h *Handler) Reconcile(c *gin.Context) {
	rc, err := h.svc.Reconcile(c.Request.Context(), c.Query("since"), c.Query("until"), uid(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reconciliation": rc})
}

func (h *Handler) ListBudgets(c *gin.Context) {
	list, err := h.svc.ListBudgets(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"budgets": list})
}

func (h *Handler) UpsertBudget(c *gin.Context) {
	var in BudgetInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidBody})
		return
	}
	b, err := h.svc.UpsertBudget(c.Request.Context(), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"budget": b})
}

func (h *Handler) LatestFloat(c *gin.Context) {
	f, err := h.svc.LatestFloat(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"float": f})
}

func (h *Handler) SnapshotFloat(c *gin.Context) {
	var body struct {
		FundedKobo int64  `json:"funded_kobo"`
		Note       string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidBody})
		return
	}
	f, err := h.svc.SnapshotFloat(c.Request.Context(), body.FundedKobo, body.Note)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"float": f})
}

func (h *Handler) RewardToLTV(c *gin.Context) {
	r, err := h.svc.RewardToLTV(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reward_to_ltv": r})
}
