package settlement

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/ledger"
)

const keyError = "error"

// Service owns the stays money-back-office: Naira hotel payouts (direct rail),
// supplier remittance reconciliation (Rail A), and the commission ledger. It REUSES
// the finance ledger primitives — commission posts to the SEPARATE AccountCommission
// account; payouts credit the hotelier wallet from AccountProviderClearing (where the
// confirm-time settle parked the net rate). No balance column is ever written.
// Invariants:
//   - Payout HELD until the property has a first confirmed+completed stay (fraud).
//   - Payouts + commission entries are idempotent (idempotency_key UNIQUE).
//   - Commission lives on its own ledger account; a refund reverses it.
//   - Reconciliation breaks are recorded + surfaced to the admin workbench.
type Service struct {
	repo   *Repository
	ledger *ledger.Service
}

// NewService constructs the stays settlement service.
func NewService(repo *Repository, ledgerSvc *ledger.Service) *Service {
	return &Service{repo: repo, ledger: ledgerSvc}
}

// AccrueCommission posts a commission ACCRUAL to AccountCommission (separate from
// the net-rate/hotel-payable) and records the domain entry. Idempotent on the key.
// The double-entry is: DEBIT AccountProviderClearing (commission slice of the gross
// already escrow-settled there) → CREDIT AccountCommission.
// Runs under the reservation advisory lock so the journal can't shift the
// parked residual under an in-flight refund saga.
func (s *Service) AccrueCommission(ctx context.Context, reservationID string, amountKobo int64, idempotencyKey string) (string, error) {
	if amountKobo <= 0 {
		return "", ErrBadAmount
	}
	lockTx, lErr := s.repo.LockReservation(ctx, reservationID)
	if lErr != nil {
		return "", fmt.Errorf("settlement: accrue commission lock: %w", lErr)
	}
	defer func() { _ = lockTx.Rollback(ctx) }()
	propertyID, _ := s.repo.PropertyOfReservation(ctx, reservationID)
	ref := "stays:commission:" + reservationID
	if err := s.postCommissionJournal(ctx, amountKobo, ref, idempotencyKey, false); err != nil {
		return "", err
	}
	return s.repo.CreateCommission(ctx, CommissionEntry{
		ReservationID:  reservationID,
		PropertyID:     propertyID,
		AmountKobo:     amountKobo,
		Kind:           "ACCRUAL",
		LedgerRef:      ref,
		IdempotencyKey: idempotencyKey,
	})
}

// ReverseCommission posts a commission REVERSAL when a reservation is refunded: it
// reverses the net commission accrued for the reservation (CREDIT back
// AccountProviderClearing ← DEBIT AccountCommission) and records a negative domain
// entry. Idempotent on the key. A no-op when nothing was accrued.
// Same advisory lock as AccrueCommission.
func (s *Service) ReverseCommission(ctx context.Context, reservationID, idempotencyKey string) (string, error) {
	lockTx, lErr := s.repo.LockReservation(ctx, reservationID)
	if lErr != nil {
		return "", fmt.Errorf("settlement: reverse commission lock: %w", lErr)
	}
	defer func() { _ = lockTx.Rollback(ctx) }()
	net, err := s.repo.CommissionNetForReservation(ctx, reservationID)
	if err != nil {
		return "", err
	}
	if net <= 0 {
		return "", nil // nothing to reverse
	}
	propertyID, _ := s.repo.PropertyOfReservation(ctx, reservationID)
	ref := "stays:commission:reversal:" + reservationID
	if err := s.postCommissionJournal(ctx, net, ref, idempotencyKey, true); err != nil {
		return "", err
	}
	return s.repo.CreateCommission(ctx, CommissionEntry{
		ReservationID:  reservationID,
		PropertyID:     propertyID,
		AmountKobo:     -net,
		Kind:           "REVERSAL",
		LedgerRef:      ref,
		IdempotencyKey: idempotencyKey,
	})
}

// postCommissionJournal posts the balanced commission journal. reverse=false accrues
// (clearing → commission); reverse=true reverses (commission → clearing). Uses
// PostJournal so both legs are between standing accounts (no user wallet involved).
// A duplicate idempotency key is a safe no-op.
func (s *Service) postCommissionJournal(ctx context.Context, amountKobo int64, ref, idempotencyKey string, reverse bool) error {
	commissionAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
	if err != nil {
		return err
	}
	clearingAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return err
	}
	j := ledger.JournalEntry{
		Reference:       ref,
		IdempotencyKey:  idempotencyKey,
		AmountKobo:      amountKobo,
		DebitAccountID:  clearingAcc.ID,
		CreditAccountID: commissionAcc.ID,
	}
	if reverse {
		j.DebitAccountID = commissionAcc.ID
		j.CreditAccountID = clearingAcc.ID
	}
	if err := s.ledger.PostJournal(ctx, j); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return fmt.Errorf("settlement: post commission journal: %w", err)
	}
	return nil
}

// ListCommission returns commission entries (admin).
func (s *Service) ListCommission(ctx context.Context, limit int) ([]CommissionEntry, error) {
	return s.repo.ListCommission(ctx, limit)
}

// QueuePayout records a Naira payout in HELD status (fraud control: held until the
// property has a first confirmed+completed stay). Idempotent on the key. The actual
// money leg only moves on ReleasePayout.
func (s *Service) QueuePayout(ctx context.Context, propertyID, hotelierUserID, reservationID string, amountKobo int64, idempotencyKey string) (string, error) {
	if amountKobo <= 0 {
		return "", ErrBadAmount
	}
	return s.repo.CreatePayout(ctx, Payout{
		PropertyID:     propertyID,
		HotelierUserID: hotelierUserID,
		ReservationID:  reservationID,
		AmountKobo:     amountKobo,
		Status:         "HELD",
		HoldReason:     "awaiting first confirmed+completed stay",
		IdempotencyKey: idempotencyKey,
	})
}

// ReleasePayout moves a HELD/PENDING payout to PAID, crediting the hotelier wallet in
// Naira from AccountProviderClearing (where the net rate was parked at confirm). It
// FAILS CLOSED with ErrPayoutHeld unless the property has at least one COMPLETED
// stay. Idempotent: a re-release of a PAID payout is a no-op.
func (s *Service) ReleasePayout(ctx context.Context, payoutID string) (Payout, error) {
	p, err := s.repo.GetPayout(ctx, payoutID)
	if err != nil {
		return Payout{}, ErrNotFound
	}
	if p.Status == "PAID" {
		return p, nil // idempotent
	}
	// Serialize with the reservation's cancel/modify sagas: the release credit
	// and the status flip must interleave atomically with refund allocation —
	// without this lock a payout credit can land between a cancel's residual
	// read and its leg posts, transiently over-drawing provider_clearing
	// (ledger audit M-1). Advisory lock, released at function exit.
	if p.ReservationID != "" {
		lockTx, lErr := s.repo.LockReservation(ctx, p.ReservationID)
		if lErr != nil {
			return p, fmt.Errorf("settlement: payout %s — reservation lock: %w", payoutID, lErr)
		}
		defer func() { _ = lockTx.Rollback(ctx) }()
	}
	if p.Status == "CANCELLED" || p.Status == "FAILED" {
		// Already resolved — reverse any orphaned credit a crashed release left.
		if err := s.clawbackOrphanedCredit(ctx, &p); err != nil {
			return p, err
		}
		return p, fmt.Errorf("settlement: payout %s is %s", payoutID, p.Status)
	}
	// Reservation-state gate: a payout bound to a cancelled/refunded reservation
	// must never release — the guest refund already unwound the legs it would
	// draw a second time. NO_SHOW pays like COMPLETED (the guest forfeits the
	// gross). Lookup failures refuse.
	if p.ReservationID != "" {
		state, sErr := s.repo.ReservationState(ctx, p.ReservationID)
		if sErr != nil {
			return p, fmt.Errorf("settlement: payout %s — reservation %s state lookup failed, refusing: %w",
				payoutID, p.ReservationID, sErr)
		}
		if state != "CONFIRMED" && state != "COMPLETED" && state != "NO_SHOW" {
			return p, fmt.Errorf("%w: payout %s — reservation %s is %s",
				ErrPayoutBlocked, payoutID, p.ReservationID, state)
		}
		// Refunded-but-payable wedge: a cancel saga that posted guest legs but
		// lost the terminal-flip race leaves a payable-looking row — releasing
		// would pay the hotelier money the guest already got back.
		drawn, dErr := s.repo.CancelRefundDrawKobo(ctx, p.ReservationID)
		if dErr != nil {
			return p, fmt.Errorf("settlement: payout %s — reservation %s refund-draw probe failed, refusing: %w",
				payoutID, p.ReservationID, dErr)
		}
		if drawn > 0 {
			return p, fmt.Errorf("%w: payout %s — reservation %s has %d kobo of posted cancel-refund legs (payable-looking wedge)",
				ErrPayoutBlocked, payoutID, p.ReservationID, drawn)
		}
	}
	// Fraud gate — release only after a confirmed+completed stay.
	ok, err := s.repo.HasCompletedStay(ctx, p.PropertyID)
	if err != nil {
		return p, err
	}
	if !ok {
		_ = s.repo.SetPayoutStatus(ctx, payoutID, "HELD", "", "", false)
		return p, ErrPayoutHeld
	}
	if p.HotelierUserID == "" {
		return p, fmt.Errorf("settlement: payout %s has no hotelier wallet target", payoutID)
	}
	// Credit the hotelier wallet in Naira from provider-clearing. Idempotency key
	// threads the ledger posting so a retried release does not double-credit.
	clearingAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return p, err
	}
	ref := "stays:payout:" + payoutID
	if err := s.ledger.Credit(ctx, p.HotelierUserID, ref, "stays:payout:"+payoutID, clearingAcc.ID, p.AmountKobo); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		_ = s.repo.SetPayoutStatus(ctx, payoutID, "FAILED", "", "", false)
		return p, fmt.Errorf("settlement: payout credit: %w", err)
	}
	if err := s.repo.SetPayoutStatus(ctx, payoutID, "PAID", ref, "", true); err != nil {
		if errors.Is(err, ErrPayoutNotPayable) {
			// The row resolved between read and flip. A racing release paying it
			// is an idempotent replay; a cancel flipping it mid-release leaves an
			// orphaned credit to claw back.
			if cur, gErr := s.repo.GetPayout(ctx, payoutID); gErr == nil && cur.Status == "PAID" {
				return cur, nil
			}
			if cErr := s.clawbackOrphanedCredit(ctx, &p); cErr != nil {
				return p, fmt.Errorf("settlement: payout %s resolved during release AND clawback failed: %w", payoutID, cErr)
			}
			return p, fmt.Errorf("%w: payout %s resolved during release — any posted credit was reversed", ErrPayoutBlocked, payoutID)
		}
		return p, err
	}
	return s.repo.GetPayout(ctx, payoutID)
}

// clawbackOrphanedCredit reverses a payout credit that posted but whose row
// resolved before it could pay out. No-op when the credit never posted.
func (s *Service) clawbackOrphanedCredit(ctx context.Context, p *Payout) error {
	posted, err := s.ledger.Posted(ctx, "stays:payout:"+p.ID)
	if err != nil {
		return fmt.Errorf("settlement: payout %s credit probe failed: %w", p.ID, err)
	}
	if !posted {
		return nil
	}
	clearingAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return err
	}
	wallet, err := s.ledger.GetOrCreateUserWallet(ctx, p.HotelierUserID)
	if err != nil {
		return err
	}
	if err := s.ledger.PostReversal(ctx, clearingAcc.ID, wallet.ID, p.AmountKobo,
		"stays:payout:clawback:"+p.ID, "stays:payout:clawback:"+p.ID); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return fmt.Errorf("settlement: payout %s clawback: %w", p.ID, err)
	}
	return nil
}

// ListPayouts returns payouts by status (admin workbench).
func (s *Service) ListPayouts(ctx context.Context, status string, limit int) ([]Payout, error) {
	return s.repo.ListPayoutsByStatus(ctx, status, limit)
}

// reconToleranceKobo is the absolute kobo tolerance below which expected vs remitted
// is treated as MATCHED (rounding noise). Above it → BREAK.
const reconToleranceKobo = 100

// IngestRemittance records a supplier remittance line and matches it against the
// expected net-rate for the reservation. A mismatch beyond tolerance is recorded as
// a BREAK (surfaced to the admin workbench). Idempotent on the key.
func (s *Service) IngestRemittance(ctx context.Context, supplierCode, reservationID, externalRef string, remittedKobo int64, idempotencyKey string) (string, string, error) {
	expected := int64(0)
	supplierRef := ""
	if reservationID != "" {
		e, sr, err := s.repo.ExpectedNetForReservation(ctx, reservationID)
		if err == nil {
			expected = e
			supplierRef = sr
		}
	}
	status := "MATCHED"
	reason := ""
	if reservationID == "" {
		status = "UNMATCHED"
		reason = "no reservation reference"
	} else if abs64(expected-remittedKobo) > reconToleranceKobo {
		status = "BREAK"
		reason = fmt.Sprintf("expected %d, remitted %d (delta %d)", expected, remittedKobo, remittedKobo-expected)
	}
	id, err := s.repo.UpsertRemittance(ctx, Remittance{
		SupplierCode:   supplierCode,
		ReservationID:  reservationID,
		SupplierRef:    supplierRef,
		ExpectedKobo:   expected,
		RemittedKobo:   remittedKobo,
		Status:         status,
		BreakReason:    reason,
		ExternalRef:    externalRef,
		IdempotencyKey: idempotencyKey,
	})
	return id, status, err
}

// ResolveRemittance marks a remittance break RESOLVED (admin).
func (s *Service) ResolveRemittance(ctx context.Context, id, reason string) error {
	return s.repo.SetRemittanceStatus(ctx, id, "RESOLVED", reason)
}

// ListRemittances returns remittance lines by status (admin workbench / breaks feed).
func (s *Service) ListRemittances(ctx context.Context, status string, limit int) ([]Remittance, error) {
	return s.repo.ListRemittances(ctx, status, limit)
}

func abs64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

// Handler exposes the stays admin settlement/reconciliation/commission control
// plane (complements SA1's admin pages). Every route is RBAC-gated at the router
// (stays.admin.*); this handler performs the parameterized ops.
type Handler struct {
	svc *Service
}

// NewHandler constructs the settlement admin handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func mapErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrPayoutHeld):
		c.JSON(http.StatusConflict, gin.H{keyError: httperr.Msg(c, http.StatusConflict, err), "code": "PAYOUT_HELD"})
	case errors.Is(err, ErrPayoutBlocked):
		c.JSON(http.StatusConflict, gin.H{keyError: httperr.Msg(c, http.StatusConflict, err), "code": "PAYOUT_BLOCKED"})
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{keyError: "not found"})
	case errors.Is(err, ErrBadAmount):
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

func limitParam(c *gin.Context) int {
	n, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	return n
}

// RegisterAdmin wires the admin settlement routes onto the admin group. guard is the
// per-route RBAC middleware factory the aggregator supplies.
func (h *Handler) RegisterAdmin(g *gin.RouterGroup, guard func(permission string) gin.HandlerFunc) {
	g.GET("/payouts", guard("stays.admin.settlement"), h.ListPayouts)
	g.POST("/payouts/queue", guard("stays.admin.settlement"), h.QueuePayout)
	g.POST("/payouts/:id/release", guard("stays.admin.settlement"), h.ReleasePayout)
	g.GET("/commission", guard("stays.admin.commission"), h.ListCommission)
	g.POST("/commission/accrue", guard("stays.admin.settlement"), h.AccrueCommission)
	g.POST("/commission/reverse", guard("stays.admin.settlement"), h.ReverseCommission)
	g.GET("/remittances", guard("stays.admin.settlement"), h.ListRemittances)
	g.POST("/remittances/ingest", guard("stays.admin.settlement"), h.IngestRemittance)
	g.POST("/remittances/:id/resolve", guard("stays.admin.settlement"), h.ResolveRemittance)
}

// ListPayouts: GET /payouts?status&limit
func (h *Handler) ListPayouts(c *gin.Context) {
	out, err := h.svc.ListPayouts(c.Request.Context(), c.Query("status"), limitParam(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) QueuePayout(c *gin.Context) {
	var b struct {
		PropertyID     string `json:"property_id" binding:"required"`
		HotelierUserID string `json:"hotelier_user_id"`
		ReservationID  string `json:"reservation_id"`
		AmountKobo     int64  `json:"amount_kobo" binding:"required"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	key := b.IdempotencyKey
	if key == "" {
		key = ginutil.IdempotencyKey(c)
	}
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "Idempotency-Key required"})
		return
	}
	id, err := h.svc.QueuePayout(c.Request.Context(), b.PropertyID, b.HotelierUserID, b.ReservationID, b.AmountKobo, key)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": id, "status": "HELD"}})
}

// ReleasePayout: POST /payouts/:id/release
func (h *Handler) ReleasePayout(c *gin.Context) {
	p, err := h.svc.ReleasePayout(c.Request.Context(), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// ListCommission: GET /commission?limit
func (h *Handler) ListCommission(c *gin.Context) {
	out, err := h.svc.ListCommission(c.Request.Context(), limitParam(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AccrueCommission(c *gin.Context) {
	var b struct {
		ReservationID  string `json:"reservation_id" binding:"required"`
		AmountKobo     int64  `json:"amount_kobo" binding:"required"`
		IdempotencyKey string `json:"idempotency_key" binding:"required"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	id, err := h.svc.AccrueCommission(c.Request.Context(), b.ReservationID, b.AmountKobo, b.IdempotencyKey)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": id}})
}

func (h *Handler) ReverseCommission(c *gin.Context) {
	var b struct {
		ReservationID  string `json:"reservation_id" binding:"required"`
		IdempotencyKey string `json:"idempotency_key" binding:"required"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	id, err := h.svc.ReverseCommission(c.Request.Context(), b.ReservationID, b.IdempotencyKey)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": id}})
}

// ListRemittances: GET /remittances?status&limit
func (h *Handler) ListRemittances(c *gin.Context) {
	out, err := h.svc.ListRemittances(c.Request.Context(), c.Query("status"), limitParam(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) IngestRemittance(c *gin.Context) {
	var b struct {
		SupplierCode   string `json:"supplier_code" binding:"required"`
		ReservationID  string `json:"reservation_id"`
		ExternalRef    string `json:"external_ref"`
		RemittedKobo   int64  `json:"remitted_kobo"`
		IdempotencyKey string `json:"idempotency_key" binding:"required"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	id, status, err := h.svc.IngestRemittance(c.Request.Context(), b.SupplierCode, b.ReservationID, b.ExternalRef, b.RemittedKobo, b.IdempotencyKey)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": id, "status": status}})
}

// ResolveRemittance: POST /remittances/:id/resolve {reason}
func (h *Handler) ResolveRemittance(c *gin.Context) {
	var b struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&b)
	if err := h.svc.ResolveRemittance(c.Request.Context(), c.Param("id"), b.Reason); err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}
