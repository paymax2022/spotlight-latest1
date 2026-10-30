package healthvet

// Admin payout decisions (POST /api/health/vet/admin/payouts/:id/decision).
// :id is the provider id — the payout view is one accrual per vet derived from
// RELEASED escrow legs. Escrow release has already credited the vet (HL-9), so a
// decision posts no ledger entries: it is an append-only, idempotent attestation
// of the reviewed accrual snapshot (vet_payout_decisions), audited (HL-12) and
// fail-closed on the HL-10 KYC gate for approvals.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
)

const (
	payoutApproved = "APPROVED"
	payoutRejected = "REJECTED"
	payoutKYCHold  = "KYC_HOLD"

	payoutStatusApproved = "approved"
)

var (
	ErrPayoutNotFound      = errors.New("vet: no released accrual for this provider")
	ErrPayoutDecided       = errors.New("vet: this accrual has already been decided")
	ErrPayoutBadDecision   = errors.New("vet: decision must be approve or reject")
	ErrPayoutIdemConflict  = errors.New("vet: idempotency key already used for a different payout decision")
	payoutDecisionToStored = map[string]string{"approve": payoutApproved, "reject": payoutRejected}
)

// PayoutDecisionResult is VetPayoutDecisionResult in the console's types.
type PayoutDecisionResult struct {
	ID             string    `json:"id"`
	DecisionID     string    `json:"audit_id"`
	PayoutStatus   string    `json:"payout_status"`
	ReleasedKobo   int64     `json:"released_kobo"`
	FeesKobo       int64     `json:"fees_kobo"`
	NetPayableKobo int64     `json:"net_payable_kobo"`
	Replayed       bool      `json:"replayed"`
	Message        string    `json:"message"`
	DecidedAt      time.Time `json:"decided_at"`
}

func storedToPayoutStatus(d string) string {
	switch d {
	case payoutApproved:
		return payoutStatusApproved
	case payoutRejected:
		return "rejected"
	case payoutKYCHold:
		return "kyc_hold"
	}
	return "pending"
}

type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// payoutAccrual is the same derivation AdminConsolePayouts uses, for one provider.
func payoutAccrual(ctx context.Context, q queryRower, providerID string) (int64, int64, error) {
	var released, fees int64
	err := q.QueryRow(ctx, `
		SELECT COALESCE(SUM(vp.total_kobo),0),
		       COALESCE((SELECT SUM(ce.spotlight_revenue_kobo) FROM commission_earnings ce
		                 WHERE ce.source_module='health.vet' AND ce.source_ref = ANY(array_agg(vp.appointment_id::text))),0)
		FROM vet_appointment_payments vp
		WHERE vp.provider_id = $1 AND vp.pay_state = 'RELEASED'`, providerID).Scan(&released, &fees)
	return released, fees, err
}

// payoutDecisionByKey returns (provider id, stored decision, result) for a key.
func (s *Service) payoutDecisionByKey(ctx context.Context, q queryRower, key string) (string, string, *PayoutDecisionResult, error) {
	var provider, decision string
	r := &PayoutDecisionResult{}
	err := q.QueryRow(ctx, `
		SELECT id::text, provider_id::text, decision, released_kobo, fees_kobo, net_payable_kobo, created_at
		FROM vet_payout_decisions WHERE idempotency_key=$1`, key).
		Scan(&r.DecisionID, &provider, &decision, &r.ReleasedKobo, &r.FeesKobo, &r.NetPayableKobo, &r.DecidedAt)
	if err != nil {
		return "", "", nil, err
	}
	r.ID, r.PayoutStatus = provider, storedToPayoutStatus(decision)
	return provider, decision, r, nil
}

// AdminDecidePayout records an approve/reject decision on a vet's current accrual.
// An approval for a vet failing the HL-10 KYC gate is recorded as KYC_HOLD.
func (s *Service) AdminDecidePayout(ctx context.Context, adminID, providerID, decision, note, idemKey string) (*PayoutDecisionResult, error) {
	want, ok := payoutDecisionToStored[strings.ToLower(strings.TrimSpace(decision))]
	if !ok {
		return nil, ErrPayoutBadDecision
	}
	if idemKey == "" {
		return nil, errors.New("vet: Idempotency-Key required")
	}

	// Replay before any work: the same key answers the original row.
	if p, d, r, err := s.payoutDecisionByKey(ctx, s.db, idemKey); err == nil {
		sameDecision := d == want || (want == payoutApproved && d == payoutKYCHold)
		if p != providerID || !sameDecision {
			return nil, ErrPayoutIdemConflict
		}
		r.Replayed, r.Message = true, "Replayed — the original decision is returned; nothing was written."
		return r, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("vet: payout replay lookup: %w", err)
	}

	owner, err := s.providerOwner(ctx, providerID)
	if err != nil {
		return nil, ErrPayoutNotFound
	}
	stored := want
	if want == payoutApproved {
		eligible := false
		if s.payout != nil {
			eligible, _ = s.payout.PayoutEligible(ctx, owner)
		}
		if !eligible {
			stored = payoutKYCHold // HL-10 fail-closed
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("vet: payout begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// Serialise decisions per provider so two keys cannot both decide one snapshot.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('vet_payout:' || $1))`, providerID); err != nil {
		return nil, fmt.Errorf("vet: payout lock: %w", err)
	}
	if p, _, r, err := s.payoutDecisionByKey(ctx, tx, idemKey); err == nil {
		if p != providerID {
			return nil, ErrPayoutIdemConflict
		}
		r.Replayed = true
		return r, nil
	}
	released, fees, err := payoutAccrual(ctx, tx, providerID)
	if err != nil {
		return nil, fmt.Errorf("vet: payout accrual: %w", err)
	}
	if released == 0 {
		return nil, ErrPayoutNotFound
	}
	var prev string
	err = tx.QueryRow(ctx, `SELECT decision FROM vet_payout_decisions
		WHERE provider_id=$1 AND released_kobo=$2 ORDER BY created_at DESC LIMIT 1`, providerID, released).Scan(&prev)
	if err == nil && prev != payoutKYCHold {
		return nil, ErrPayoutDecided
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("vet: payout prior decision: %w", err)
	}

	r := &PayoutDecisionResult{ID: providerID, ReleasedKobo: released, FeesKobo: fees, NetPayableKobo: released - fees, PayoutStatus: storedToPayoutStatus(stored)}
	if err := tx.QueryRow(ctx, `
		INSERT INTO vet_payout_decisions
		  (provider_id, decision, released_kobo, fees_kobo, net_payable_kobo, note, decided_by, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text, created_at`,
		providerID, stored, released, fees, r.NetPayableKobo, note, adminID, idemKey).Scan(&r.DecisionID, &r.DecidedAt); err != nil {
		return nil, fmt.Errorf("vet: payout insert: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("vet: payout commit: %w", err)
	}

	s.audited(adminID, owner, "health.vet.payout.decision", r.DecisionID,
		map[string]any{"payout_status": storedToPayoutStatus(prev)},
		map[string]any{"payout_status": r.PayoutStatus, "provider_id": providerID,
			"released_kobo": released, "fees_kobo": fees, "net_payable_kobo": r.NetPayableKobo, "note": note})
	switch stored {
	case payoutKYCHold:
		r.Message = "Held — the vet does not meet the payout KYC tier (HL-10). Recorded as kyc_hold."
	case payoutApproved:
		r.Message = "Payout approved and recorded to the audit log."
	default:
		r.Message = "Payout rejected and recorded to the audit log."
	}
	return r, nil
}

// AdminDecidePayout — POST /admin/payouts/:id/decision  {decision, note}; Idempotency-Key required.
func (h *Handler) AdminDecidePayout(c *gin.Context) {
	providerID, ok := uuidPathID(c, "provider id")
	if !ok {
		return
	}
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
	if !ok {
		return
	}
	var body struct {
		Decision string `json:"decision"`
		Note     string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	r, err := h.svc.AdminDecidePayout(c.Request.Context(), ginutil.UserID(c), providerID, body.Decision, strings.TrimSpace(body.Note), key)
	switch {
	case err == nil:
		consoleOK(c, r, nil)
	case errors.Is(err, ErrPayoutBadDecision):
		failErr(c, http.StatusBadRequest, err)
	case errors.Is(err, ErrPayoutNotFound):
		failErr(c, http.StatusNotFound, err)
	case errors.Is(err, ErrPayoutDecided), errors.Is(err, ErrPayoutIdemConflict):
		failErr(c, http.StatusConflict, err)
	default:
		failErr(c, http.StatusInternalServerError, err)
	}
}
