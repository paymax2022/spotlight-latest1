package transport

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
)

// Ops queue for bus tickets whose refund could not go through the wallet path
// (refund_status='manual_required': the fare was already settled to the operator).
// Resolution methods:
//   - wallet_refund: reverses the frozen settlement legs into the passenger's wallet
//     (operator wallet -> passenger for provider_kobo, revenue -> passenger for
//     fee_kobo). Amounts come from the settlements row, never the request.
//   - offline: ops refunded out-of-band; records the external reference only.
// A method is claimed on the ticket before any money moves and is sticky, so an
// offline resolve can never race an in-flight wallet refund into a double refund.

const (
	manualRefundClaimStale = 5 * time.Minute
	methodWalletRefund     = "wallet_refund"
	methodOffline          = "offline"
	legProvider            = "provider"
	legPlatform            = "platform"
	fundingWallet          = "wallet"
)

// BusManualRefundRequest is POST /admin/transport/bus/tickets/:id/resolve-refund.
type BusManualRefundRequest struct {
	Method    string `json:"method"`
	Reference string `json:"reference"`
	Reason    string `json:"reason"`
}

type manualRefundState struct {
	RefundStatus, SettlementStatus, FundingSource string
	TotalKobo, ProviderKobo, FeeKobo              int64
	ClaimedMethod                                 string
	ClaimedAt                                     *time.Time
	AnyLegPosted                                  bool
}

type manualRefundVerdict int

const (
	manualRefundReject manualRefundVerdict = iota
	manualRefundProceed
	manualRefundReplay // already resolved: return the stored outcome
)

// decideManualRefund is the pure gate for a resolve attempt.
func decideManualRefund(st manualRefundState, req BusManualRefundRequest, now time.Time) (manualRefundVerdict, *CodedError) {
	if st.RefundStatus == RefundRefunded {
		return manualRefundReplay, nil
	}
	if strings.TrimSpace(req.Reason) == "" {
		return manualRefundReject, codedErr(http.StatusBadRequest, "REASON_REQUIRED", "a reason is required")
	}
	switch req.Method {
	case methodWalletRefund:
	case methodOffline:
		if strings.TrimSpace(req.Reference) == "" {
			return manualRefundReject, codedErr(http.StatusBadRequest, "REFERENCE_REQUIRED", "an external refund reference is required for an offline refund")
		}
	default:
		return manualRefundReject, codedErr(http.StatusBadRequest, "INVALID_METHOD", "method must be wallet_refund or offline")
	}
	if st.RefundStatus != RefundManualRequired {
		return manualRefundReject, codedErr(http.StatusConflict, CodeInvalidState, "ticket is not awaiting a manual refund")
	}
	if st.ClaimedMethod != "" && st.ClaimedMethod != req.Method {
		staleClaim := st.ClaimedAt == nil || now.Sub(*st.ClaimedAt) >= manualRefundClaimStale
		if st.ClaimedMethod != methodWalletRefund || st.AnyLegPosted || !staleClaim {
			return manualRefundReject, codedErr(http.StatusConflict, "METHOD_LOCKED",
				"this refund is already being resolved via "+st.ClaimedMethod)
		}
	}
	if req.Method == methodWalletRefund {
		if st.SettlementStatus != string(settlement.StatusSettled) || st.FundingSource != fundingWallet {
			return manualRefundReject, codedErr(http.StatusConflict, CodeInvalidState,
				"wallet refund needs a settled wallet-funded payment; use offline")
		}
		if st.ProviderKobo < 0 || st.FeeKobo < 0 || st.ProviderKobo+st.FeeKobo != st.TotalKobo {
			return manualRefundReject, codedErr(http.StatusConflict, "SETTLEMENT_LEGS_MISMATCH",
				"settlement legs do not sum to the fare; reconcile before refunding")
		}
	}
	return manualRefundProceed, nil
}

// manualRefundAudit is the audit payload for manual refund transitions (kobo).
type manualRefundAudit struct {
	RefundStatus string `json:"refund_status,omitempty"`
	Method       string `json:"method,omitempty"`
	Reference    string `json:"reference,omitempty"`
	RefundedKobo int64  `json:"refunded_kobo,omitempty"`
	ProviderKobo int64  `json:"provider_kobo,omitempty"`
	FeeKobo      int64  `json:"fee_kobo,omitempty"`
	Error        string `json:"error,omitempty"`
}

// ManualRefundResult is the resolve-refund response.
type ManualRefundResult struct {
	OK           bool       `json:"ok"`
	TicketID     string     `json:"ticketId"`
	RefundStatus string     `json:"refundStatus"`
	Method       *string    `json:"method"`
	Reference    *string    `json:"reference"`
	ResolvedAt   *time.Time `json:"resolvedAt"`
	RefundedKobo int64      `json:"refundedKobo"`
	Replayed     bool       `json:"replayed"`
}

func manualRefundKey(ticketID, leg string) string { return "bus-manual-refund:" + ticketID + ":" + leg }

type manualRefundTicket struct {
	ID, UserID, SettlementID, SettleUserID string
	FareKobo                               int64
	State                                  manualRefundState
	Reference                              *string
}

func (s *Service) loadManualRefundTicket(ctx context.Context, ticketID string) (*manualRefundTicket, error) {
	var t manualRefundTicket
	var settID, settleUser, settStatus, funding, method *string
	var total, prov, fee *int64
	err := s.db.QueryRow(ctx, `
		SELECT t.id, t.user_id::text, t.fare_kobo, t.refund_status, t.settlement_id::text, t.settle_user_id::text,
		       st.status, st.funding_source, st.total_kobo, st.provider_kobo, st.fee_kobo,
		       t.manual_refund_method, t.manual_refund_claimed_at, t.manual_refund_reference
		FROM bus_tickets t LEFT JOIN settlements st ON st.id = t.settlement_id
		WHERE t.id=$1`, ticketID).Scan(&t.ID, &t.UserID, &t.FareKobo, &t.State.RefundStatus, &settID, &settleUser,
		&settStatus, &funding, &total, &prov, &fee, &method, &t.State.ClaimedAt, &t.Reference)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "ticket not found")
	}
	if err != nil {
		return nil, err
	}
	deref := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	t.SettlementID, t.SettleUserID = deref(settID), deref(settleUser)
	t.State.SettlementStatus, t.State.FundingSource, t.State.ClaimedMethod = deref(settStatus), deref(funding), deref(method)
	if total != nil && prov != nil && fee != nil {
		t.State.TotalKobo, t.State.ProviderKobo, t.State.FeeKobo = *total, *prov, *fee
	}
	return &t, nil
}

func (s *Service) ledgerSvc() *ledger.Service {
	if s.ledger != nil {
		return s.ledger
	}
	return s.settlement.Ledger()
}

// ResolveManualBusRefund resolves one manual_required ticket. Idempotent: the
// ledger legs are ticket-scoped keys checked with Posted before posting, and a
// resolved ticket replays its stored outcome.
func (a *AdminService) ResolveManualBusRefund(ctx context.Context, adminID, ticketID, idemKey string, req BusManualRefundRequest) (*ManualRefundResult, error) {
	if strings.TrimSpace(idemKey) == "" {
		return nil, codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	s := a.svc
	t, err := s.loadManualRefundTicket(ctx, ticketID)
	if err != nil {
		return nil, err
	}
	led := s.ledgerSvc()
	if t.State.ClaimedMethod == methodWalletRefund && req.Method != methodWalletRefund {
		for _, leg := range []string{legProvider, legPlatform} {
			posted, perr := led.Posted(ctx, manualRefundKey(t.ID, leg))
			if perr != nil {
				return nil, perr
			}
			t.State.AnyLegPosted = t.State.AnyLegPosted || posted
		}
	}
	verdict, ce := decideManualRefund(t.State, req, time.Now())
	switch verdict {
	case manualRefundReplay:
		return s.manualRefundResult(ctx, t.ID, true)
	case manualRefundReject:
		return nil, ce
	case manualRefundProceed:
	}
	// Claim the method (sticky) before any money moves.
	tag, err := s.db.Exec(ctx, `
		UPDATE bus_tickets SET manual_refund_method=$2, manual_refund_claimed_at=NOW(), manual_refund_idempotency_key=$3
		WHERE id=$1 AND refund_status='manual_required'
		  AND (manual_refund_method IS NULL OR manual_refund_method=$2 OR manual_refund_method=$4)`,
		t.ID, req.Method, idemKey, t.State.ClaimedMethod)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, codedErr(http.StatusConflict, "METHOD_LOCKED", "the refund state changed; reload and retry")
	}
	if t.State.ClaimedMethod != req.Method {
		_ = writeAudit(ctx, s.db, adminID, "bus.manual_refund.claim", "bus_ticket", t.ID,
			manualRefundAudit{Method: t.State.ClaimedMethod}, manualRefundAudit{Method: req.Method}, req.Reason)
	}
	if req.Method == methodWalletRefund {
		if err := s.postManualRefundLegs(ctx, t); err != nil {
			_ = writeAudit(ctx, s.db, adminID, "bus.manual_refund.failed", "bus_ticket", t.ID,
				manualRefundAudit{RefundStatus: RefundManualRequired},
				manualRefundAudit{RefundStatus: RefundManualRequired, Method: req.Method, Error: err.Error()}, req.Reason)
			return nil, err
		}
	}
	tag, err = s.db.Exec(ctx, `
		UPDATE bus_tickets SET refund_status='refunded', payment_status='refunded', refunded_at=NOW(),
		       manual_refund_reference=$3, manual_refund_reason=$4, manual_refund_resolved_by=$5, manual_refund_resolved_at=NOW()
		WHERE id=$1 AND refund_status='manual_required' AND manual_refund_method=$2`,
		t.ID, req.Method, strings.TrimSpace(req.Reference), req.Reason, adminID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() > 0 {
		_ = writeAudit(ctx, s.db, adminID, "bus.manual_refund.resolve", "bus_ticket", t.ID,
			manualRefundAudit{RefundStatus: RefundManualRequired},
			manualRefundAudit{RefundStatus: RefundRefunded, Method: req.Method, Reference: req.Reference,
				RefundedKobo: t.FareKobo, ProviderKobo: t.State.ProviderKobo, FeeKobo: t.State.FeeKobo}, req.Reason)
	}
	return s.manualRefundResult(ctx, t.ID, tag.RowsAffected() == 0)
}

// postManualRefundLegs moves the frozen settlement legs back to the passenger.
// Provider leg first: if the operator cannot cover it nothing has moved.
func (s *Service) postManualRefundLegs(ctx context.Context, t *manualRefundTicket) error {
	led := s.ledgerSvc()
	if t.SettleUserID == "" {
		return codedErr(http.StatusConflict, CodeInvalidState, "ticket has no settlement recipient on record")
	}
	pax, err := led.GetOrCreateUserWallet(ctx, t.UserID)
	if err != nil {
		return err
	}
	ref := "bus-manual-refund:" + t.ID
	post := func(leg string, amount int64, do func(key string) error) error {
		if amount <= 0 {
			return nil
		}
		key := manualRefundKey(t.ID, leg)
		if posted, err := led.Posted(ctx, key); err != nil || posted {
			return err
		}
		err := do(key)
		if errors.Is(err, ledger.ErrDuplicate) {
			posted, perr := led.Posted(ctx, key)
			if perr != nil {
				return perr
			}
			if !posted {
				return codedErr(http.StatusConflict, "REFUND_IN_PROGRESS", "a refund leg is in flight; retry shortly")
			}
			return nil
		}
		return err
	}
	// Ungated system correction (same stance as restaurant tip clawback).
	err = post(legProvider, t.State.ProviderKobo, func(key string) error {
		return led.Debit(ctx, t.SettleUserID, ref, key, pax.ID, t.State.ProviderKobo)
	})
	if errors.Is(err, ledger.ErrInsufficientFunds) {
		return codedErr(http.StatusConflict, "OPERATOR_INSUFFICIENT_FUNDS",
			"the operator's wallet cannot cover the refund; retry later or refund offline")
	}
	if err != nil {
		return fmt.Errorf("transport: manual refund provider leg: %w", err)
	}
	rev, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return err
	}
	if err := post(legPlatform, t.State.FeeKobo, func(key string) error {
		return led.Credit(ctx, t.UserID, ref, key, rev.ID, t.State.FeeKobo)
	}); err != nil {
		return fmt.Errorf("transport: manual refund platform leg: %w", err)
	}
	return nil
}

func (s *Service) manualRefundResult(ctx context.Context, ticketID string, replayed bool) (*ManualRefundResult, error) {
	r := ManualRefundResult{TicketID: ticketID, Replayed: replayed}
	if err := s.db.QueryRow(ctx, `
		SELECT refund_status, manual_refund_method, manual_refund_reference, manual_refund_resolved_at, fare_kobo
		FROM bus_tickets WHERE id=$1`, ticketID).Scan(&r.RefundStatus, &r.Method, &r.Reference, &r.ResolvedAt, &r.RefundedKobo); err != nil {
		return nil, err
	}
	r.OK = r.RefundStatus == RefundRefunded
	return &r, nil
}
