package transfers

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
)

// AdminTransferFilter narrows the admin transfer list.
type AdminTransferFilter struct {
	Status     string
	Provider   string
	SourceType string
	Limit      int
	Offset     int
}

// AdminTransferDetail is a transfer plus its associated ledger entry IDs.
type AdminTransferDetail struct {
	Transfer       *BankTransfer `json:"transfer"`
	LedgerEntryIDs []string      `json:"ledger_entry_ids"`
}

// ProviderHealth reports a provider's configured + reachability status.
type ProviderHealth struct {
	Provider  string `json:"provider"`
	Default   bool   `json:"default"`
	Healthy   bool   `json:"healthy"`
	BankCount int    `json:"bank_count"`
	Detail    string `json:"detail,omitempty"`
}

// AdminListTransfers lists bank transfers with optional status/provider/type filters.
func (s *Service) AdminListTransfers(ctx context.Context, f AdminTransferFilter) ([]BankTransfer, error) {
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `SELECT ` + bankTransferCols + ` FROM bank_transfers WHERE 1=1`
	args := []any{}
	i := 1
	if f.Status != "" {
		q += fmt.Sprintf(" AND status=$%d", i)
		args = append(args, f.Status)
		i++
	}
	if f.Provider != "" {
		q += fmt.Sprintf(" AND provider=$%d", i)
		args = append(args, f.Provider)
		i++
	}
	if f.SourceType != "" {
		q += fmt.Sprintf(" AND source_type=$%d", i)
		args = append(args, f.SourceType)
		i++
	}
	q += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", i, i+1)
	args = append(args, limit, f.Offset)

	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BankTransfer
	for rows.Next() {
		bt, err := s.scanBankTransfer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *bt)
	}
	return out, rows.Err()
}

// AdminGetTransfer returns a transfer with the IDs of its ledger entries.
func (s *Service) AdminGetTransfer(ctx context.Context, id string) (*AdminTransferDetail, error) {
	bt, err := s.getBankTransfer(ctx, id)
	if err != nil {
		return nil, ErrRecipientNotFound
	}
	var ids []string
	rows, err := s.db.Query(ctx, `SELECT id FROM ledger_entries WHERE reference=$1 ORDER BY created_at`, bt.Reference)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var lid string
			if rows.Scan(&lid) == nil {
				ids = append(ids, lid)
			}
		}
	}
	return &AdminTransferDetail{Transfer: bt, LedgerEntryIDs: ids}, nil
}

// AdminRetry re-attempts a stuck transfer's payout leg (allowing provider
// failover). Only valid from a held state (funds_reserved / funded /
// provider_initiated) — never from a terminal state, so no double-spend.
//
// The retry is claim-then-act: initiatePayoutLeg takes a per-transfer advisory
// lock before touching the provider, so two concurrent retries (or a retry vs
// a funding webhook's auto-leg) can no longer both fire InitiatePayoutFailover
// on the same reference — the loser gets ErrPayoutLegInFlight (409). The
// status gate is ALSO re-checked under the lock on a fresh read, closing the
// gap where a webhook settles the transfer between our read and the claim.
//
// RESIDUAL: a retry on funds_reserved/funded re-fires the provider call. That
// is safe in the normal case (no payout was ever initiated — those statuses
// are only set BEFORE the provider leg runs), but a provider call that
// timed-out-yet-succeeded leaves the row at its hold status with no
// provider_transfer_ref to reconcile against. Re-firing then relies on the
// provider deduping our reference — Paystack does not — so a double payout is
// possible. Operators should check the provider dashboard before retrying a
// transfer whose prior attempt timed out mid-call.
func (s *Service) AdminRetry(ctx context.Context, id, actorID string) (*BankTransfer, error) {
	bt, err := s.getBankTransfer(ctx, id)
	if err != nil {
		return nil, ErrRecipientNotFound
	}
	retryable := func(fresh *BankTransfer) error {
		switch fresh.Status {
		case BankTransferFundsReserved, BankTransferFunded, BankTransferProviderInitiated:
			return nil
		default:
			return fmt.Errorf("transfers admin: cannot retry from status %q", fresh.Status)
		}
	}
	if err := retryable(bt); err != nil {
		return nil, err
	}
	s.audit(ctx, actorID, "transfer.admin.retry", bt.ID, string(bt.Status))
	// Re-run the disburse leg; failover allowed (preferred="" → registry default
	// chain). A provider_initiated row does NOT re-fire — the leg reconciles the
	// already-fired payout via provider_transfer_ref instead (MED-3).
	if err := s.initiatePayoutLeg(ctx, bt, false, "", "", requirePayoutableStatus); err != nil {
		return nil, err
	}
	return s.getBankTransfer(ctx, id)
}

// AdminReverse manually reverses a held transfer back to its source. Only valid
// before settlement (never from successful/failed/reversed). Posts the same
// REVERSAL_DEBIT/CREDIT pair as a failed webhook (idempotent).
func (s *Service) AdminReverse(ctx context.Context, id, actorID string) (*BankTransfer, error) {
	bt, err := s.getBankTransfer(ctx, id)
	if err != nil {
		return nil, ErrRecipientNotFound
	}
	if bt.Status == BankTransferSuccessful || bt.Status == BankTransferFailed || bt.Status == BankTransferReversed {
		return nil, fmt.Errorf("transfers admin: cannot reverse from terminal status %q", bt.Status)
	}
	s.audit(ctx, actorID, "transfer.admin.reverse", bt.ID, string(bt.Status))
	if err := s.settleTransfer(ctx, bt, BankTransferReversed); err != nil {
		return nil, err
	}
	return s.getBankTransfer(ctx, id)
}

// AdminProviderHealth probes each configured provider's ListBanks reachability.
func (s *Service) AdminProviderHealth(ctx context.Context) ([]ProviderHealth, error) {
	if s.registry == nil {
		return nil, ErrProviderUnavailable
	}
	out := []ProviderHealth{}
	def := s.registry.Default()
	for _, name := range s.registry.Names() {
		h := ProviderHealth{Provider: name, Default: name == def}
		if p, ok := s.registry.ByName(name); ok {
			pctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			banks, err := p.ListBanks(pctx)
			cancel()
			if err != nil {
				h.Healthy = false
				h.Detail = err.Error()
			} else {
				h.Healthy = true
				h.BankCount = len(banks)
			}
		}
		out = append(out, h)
	}
	return out, nil
}

// AdminHandler exposes the finance-admin transfer console endpoints. RBAC is
// applied at the route layer (middleware.RequirePermission "finance.admin.transfers").
type AdminHandler struct {
	svc *Service
}

// NewAdminHandler builds the admin transfers handler.
func NewAdminHandler(svc *Service) *AdminHandler { return &AdminHandler{svc: svc} }

// List handles GET /api/finance/admin/transfers.
func (h *AdminHandler) List(c *gin.Context) {
	limit, offset := ginutil.LimitOffset(c)
	f := AdminTransferFilter{
		Status:     c.Query("status"),
		Provider:   c.Query("provider"),
		SourceType: c.Query("source_type"),
		Limit:      limit,
		Offset:     offset,
	}
	rows, err := h.svc.AdminListTransfers(c.Request.Context(), f)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"transfers": rows})
}

// Get handles GET /api/finance/admin/transfers/:id.
func (h *AdminHandler) Get(c *gin.Context) {
	detail, err := h.svc.AdminGetTransfer(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, detail)
}

// Retry handles POST /api/finance/admin/transfers/:id/retry.
func (h *AdminHandler) Retry(c *gin.Context) {
	bt, err := h.svc.AdminRetry(c.Request.Context(), c.Param("id"), ginutil.UserID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, bt)
}

// Reverse handles POST /api/finance/admin/transfers/:id/reverse.
func (h *AdminHandler) Reverse(c *gin.Context) {
	bt, err := h.svc.AdminReverse(c.Request.Context(), c.Param("id"), ginutil.UserID(c))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, bt)
}

// ProviderHealth handles GET /api/finance/admin/transfers/provider-health.
func (h *AdminHandler) ProviderHealth(c *gin.Context) {
	health, err := h.svc.AdminProviderHealth(c.Request.Context())
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"providers": health})
}
