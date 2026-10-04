package reconciliation

import (
	"context"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"net/http"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/ledger"
	"strconv"
	"time"
)

// Service is the premium↔provider-statement matcher + commission confirm/reverse
// workbench. It REUSES the finance ledger: a commission reversal posts a balanced
// reversing entry on the SEPARATE commission account IB0 used
// (ledger.AccountCommission), never an UPDATE to a balance.
type Service struct {
	repo   *Repository
	ledger *ledger.Service
}

// NewService constructs the reconciliation service.
func NewService(repo *Repository, ledgerSvc *ledger.Service) *Service {
	return &Service{repo: repo, ledger: ledgerSvc}
}

// Sentinel errors.
var (
	ErrAlreadyReversed = errors.New("reconciliation: commission already reversed")
)

// MatchStatement reconciles a batch of provider statement lines against the net
// posted premium per policy. Each line yields a ReconciliationRecord: MATCHED
// when amounts agree, BREAK otherwise. Returns the records (breaks are worked in
// the admin workbench).
func (s *Service) MatchStatement(ctx context.Context, provider string, lines []StatementLine) ([]ReconciliationRecord, error) {
	out := make([]ReconciliationRecord, 0, len(lines))
	for _, line := range lines {
		expected, err := s.repo.PremiumForPolicy(ctx, line.PolicyID)
		if err != nil {
			return out, fmt.Errorf("reconciliation: premium lookup for policy %s: %w", line.PolicyID, err)
		}
		status := StatusMatched
		breakReason := ""
		if expected != line.AmountKobo {
			status = StatusBreak
			breakReason = fmt.Sprintf("amount mismatch: expected %d, statement %d", expected, line.AmountKobo)
		}
		pid := line.PolicyID
		rec, err := s.repo.InsertRecord(ctx, &ReconciliationRecord{
			Provider:            provider,
			PolicyID:            &pid,
			StatementRef:        line.StatementRef,
			ExpectedAmountKobo:  expected,
			StatementAmountKobo: line.AmountKobo,
			Status:              status,
			BreakReason:         breakReason,
		})
		if err != nil {
			return out, err
		}
		out = append(out, *rec)
	}
	return out, nil
}

// ListBreaks returns reconciliation records (workbench), filtered by status +
// provider.
func (s *Service) ListRecords(ctx context.Context, status, provider string, limit, offset int) ([]ReconciliationRecord, error) {
	return s.repo.ListRecords(ctx, status, provider, limit, offset)
}

// ResolveBreak records an operator resolution for a BREAK record.
func (s *Service) ResolveBreak(ctx context.Context, id, note string) error {
	return s.repo.ResolveBreak(ctx, id, note)
}

// ConfirmCommission marks a policy's commission entry CONFIRMED (reconciled
// against the provider statement). The ledger entry posted at bind is unchanged;
// only the domain status moves PENDING → CONFIRMED.
func (s *Service) ConfirmCommission(ctx context.Context, policyID string) (*CommissionEntry, error) {
	ce, err := s.repo.GetCommissionByPolicy(ctx, policyID)
	if err != nil {
		return nil, err
	}
	if ce.Status == CommissionConfirmed {
		return ce, nil
	}
	if ce.Status == CommissionReversed {
		return nil, ErrAlreadyReversed
	}
	if err := s.repo.SetCommissionStatus(ctx, ce.ID, CommissionConfirmed); err != nil {
		return nil, err
	}
	ce.Status = CommissionConfirmed
	return ce, nil
}

// ReverseCommission posts a BALANCED reversing entry that drains the commission
// account back into the provider-clearing pass-through (DR commission → CR
// provider_clearing) and marks the entry REVERSED. Used on cancellation/clawback.
// Idempotent: a second reverse is a no-op (already REVERSED), and the ledger post
// is keyed on the entry's idempotency_key + ":reverse".
func (s *Service) ReverseCommission(ctx context.Context, policyID, reason string) (*CommissionEntry, error) {
	ce, err := s.repo.GetCommissionByPolicy(ctx, policyID)
	if err != nil {
		return nil, err
	}
	if ce.Status == CommissionReversed {
		return ce, nil
	}
	if ce.AmountKobo > 0 && s.ledger != nil {
		commAcc, cErr := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
		if cErr != nil {
			return nil, cErr
		}
		clearing, clErr := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
		if clErr != nil {
			return nil, clErr
		}
		// DR commission → CR provider_clearing: drains commission revenue back to the
		// pass-through (the inverse of the bind posting).
		postErr := s.ledger.PostJournal(ctx, ledger.JournalEntry{
			Reference:       "insurance:commission_reversal:" + ce.PolicyID,
			IdempotencyKey:  ce.IdempotencyKey + ":reverse",
			AmountKobo:      ce.AmountKobo,
			DebitAccountID:  commAcc.ID,
			CreditAccountID: clearing.ID,
		})
		if postErr != nil && !errors.Is(postErr, ledger.ErrDuplicate) {
			return nil, fmt.Errorf("reconciliation: commission reversal post: %w", postErr)
		}
	}
	if err := s.repo.SetCommissionStatus(ctx, ce.ID, CommissionReversed); err != nil {
		return nil, err
	}
	ce.Status = CommissionReversed
	return ce, nil
}

// ListCommission returns the commission ledger view (entries), filtered by status
// + provider.
func (s *Service) ListCommission(ctx context.Context, status, provider string, limit, offset int) ([]CommissionEntry, error) {
	return s.repo.ListCommission(ctx, status, provider, limit, offset)
}

// CommissionSummary returns the total commission (kobo) for a status + provider
// filter (the commission ledger view summary).
func (s *Service) CommissionSummary(ctx context.Context, status, provider string) (int64, error) {
	return s.repo.CommissionTotal(ctx, status, provider)
}

// Register wires the admin reconciliation workbench + commission ledger view.
//   - admin (per-route RBAC):
//     POST /reconciliation/:id/resolve      (insurance.reconciliation.resolve)
//     POST /commission/:policy_id/confirm   (insurance.reconciliation.resolve)
//     POST /commission/:policy_id/reverse   (insurance.reconciliation.resolve)
func Register(admin *gin.RouterGroup, h *Handler, guard func(permission string) gin.HandlerFunc) {
	rg := admin.Group("/reconciliation")
	rg.GET("", guard("insurance.reconciliation.view"), h.ListRecords)
	rg.POST("/match", guard("insurance.reconciliation.resolve"), h.MatchStatement)
	rg.POST("/:id/resolve", guard("insurance.reconciliation.resolve"), h.ResolveBreak)

	cg := admin.Group("/commission")
	cg.GET("", guard("insurance.commission.view"), h.ListCommission)
	cg.POST("/:policy_id/confirm", guard("insurance.reconciliation.resolve"), h.ConfirmCommission)
	cg.POST("/:policy_id/reverse", guard("insurance.reconciliation.resolve"), h.ReverseCommission)
}

// Handler exposes the admin reconciliation workbench + commission ledger view.
type Handler struct {
	svc *Service
}

// NewHandler constructs the reconciliation handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func mapErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
	case errors.Is(err, ErrAlreadyReversed):
		c.JSON(http.StatusConflict, gin.H{"error": "already_reversed"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

// MatchStatement (admin): POST /reconciliation/match
// body: {provider, lines:[{policy_id, statement_ref, amount_kobo}]}
func (h *Handler) MatchStatement(c *gin.Context) {
	var body struct {
		Provider string          `json:"provider" binding:"required"`
		Lines    []StatementLine `json:"lines" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	recs, err := h.svc.MatchStatement(c.Request.Context(), body.Provider, body.Lines)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": recs})
}

// ListRecords (admin): GET /reconciliation?status=&provider=
func (h *Handler) ListRecords(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	recs, err := h.svc.ListRecords(c.Request.Context(), c.Query("status"), c.Query("provider"), limit, offset)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": recs})
}

// ResolveBreak (admin): POST /reconciliation/:id/resolve {note}
func (h *Handler) ResolveBreak(c *gin.Context) {
	var body struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&body)
	if err := h.svc.ResolveBreak(c.Request.Context(), c.Param("id"), body.Note); err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"resolved": true}})
}

// ConfirmCommission (admin): POST /commission/:policy_id/confirm
func (h *Handler) ConfirmCommission(c *gin.Context) {
	ce, err := h.svc.ConfirmCommission(c.Request.Context(), c.Param("policy_id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ce})
}

// ReverseCommission (admin): POST /commission/:policy_id/reverse {reason}
func (h *Handler) ReverseCommission(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body)
	ce, err := h.svc.ReverseCommission(c.Request.Context(), c.Param("policy_id"), body.Reason)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ce})
}

// ListCommission (admin): GET /commission?status=&provider= — commission ledger view.
func (h *Handler) ListCommission(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	entries, err := h.svc.ListCommission(c.Request.Context(), c.Query("status"), c.Query("provider"), limit, offset)
	if err != nil {
		mapErr(c, err)
		return
	}
	total, _ := h.svc.CommissionSummary(c.Request.Context(), c.Query("status"), c.Query("provider"))
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"entries": entries, "total_kobo": total}})
}

// RecordStatus is the lifecycle of a reconciliation record (a match attempt
// between a Paymax premium/commission row and a provider statement line).
type RecordStatus string

const (
	// StatusMatched — premium amount + provider line agree; nothing to do.
	StatusMatched RecordStatus = "MATCHED"
	// StatusBreak — a discrepancy (amount mismatch / missing on one side).
	StatusBreak RecordStatus = "BREAK"
	// StatusResolved — an operator resolved a break (manual disposition recorded).
	StatusResolved RecordStatus = "RESOLVED"
)

// CommissionStatus is the lifecycle of a commission entry. Commission lives on
// the SEPARATE commission ledger account IB0 used (ledger.AccountCommission); a
// reversal posts a balanced correction, never an UPDATE.
type CommissionStatus string

const (
	CommissionPending   CommissionStatus = "PENDING"   // posted at bind, awaiting statement confirm
	CommissionConfirmed CommissionStatus = "CONFIRMED" // reconciled against provider statement
	CommissionReversed  CommissionStatus = "REVERSED"  // reversing entry posted (cancel/clawback)
)

// ReconciliationRecord is one premium↔statement match attempt. A BREAK is a
// discrepancy an operator works in the admin workbench.
type ReconciliationRecord struct {
	ID                  string       `json:"id"`
	Provider            string       `json:"provider"`
	PolicyID            *string      `json:"policy_id,omitempty"`
	PremiumTxID         *string      `json:"premium_tx_id,omitempty"`
	StatementRef        string       `json:"statement_ref"`
	ExpectedAmountKobo  int64        `json:"expected_amount_kobo"`
	StatementAmountKobo int64        `json:"statement_amount_kobo"`
	Status              RecordStatus `json:"status"`
	BreakReason         string       `json:"break_reason,omitempty"`
	ResolutionNote      string       `json:"resolution_note,omitempty"`
	CreatedAt           time.Time    `json:"created_at"`
	ResolvedAt          *time.Time   `json:"resolved_at,omitempty"`
}

// CommissionEntry is the insurance-domain record of a commission posting on the
// SEPARATE commission ledger account. It references the ledger entry by ref and
// carries the idempotency key (UNIQUE) so confirm/reverse are replay-safe.
type CommissionEntry struct {
	ID             string           `json:"id"`
	PolicyID       string           `json:"policy_id"`
	Provider       string           `json:"provider"`
	AmountKobo     int64            `json:"amount_kobo"`
	LedgerRef      string           `json:"ledger_ref"`
	IdempotencyKey string           `json:"idempotency_key"`
	Status         CommissionStatus `json:"status"`
	CreatedAt      time.Time        `json:"created_at"`
	UpdatedAt      time.Time        `json:"updated_at"`
}

// StatementLine is one line of a provider statement uploaded for reconciliation.
type StatementLine struct {
	PolicyID     string `json:"policy_id"`
	StatementRef string `json:"statement_ref"`
	AmountKobo   int64  `json:"amount_kobo"`
}
