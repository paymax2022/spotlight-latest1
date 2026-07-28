package escrow

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

// Auditor is the minimal slice of services.AuditService the escrow core needs.
// It is satisfied by the existing immutable audit service (NL-12); nil is safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// Service is a generic, ledger-backed funds-hold state machine reusable by
// social / events / creators. It extends the finance ledger directly: a HELD
// hold debits the payer's wallet into the shared escrow standing account; RELEASE
// credits the payee from escrow; REFUND credits the payer back. Every money leg
// is idempotent (NL-9) and every transition is audited (NL-12). Paymax never
// lends (NL-1/NL-6) and never pays yield on the held float (NL-2).
type Service struct {
	db    *pgxpool.Pool
	led   *ledger.Service
	audit Auditor
}

func NewService(db *pgxpool.Pool, led *ledger.Service, audit Auditor) *Service {
	return &Service{db: db, led: led, audit: audit}
}

// Hold debits the payer's wallet into the escrow account and records a HELD hold.
// idemKey makes the whole operation replay-safe: the ledger debit is suffixed
// per-leg and the hold row carries a UNIQUE idempotency_key.
func (s *Service) Hold(ctx context.Context, payerID, reference, moduleType, idemKey string, amountKobo int64) (*Hold, error) {
	if amountKobo <= 0 {
		return nil, fmt.Errorf("escrow: amount must be positive kobo, got %d", amountKobo)
	}
	if payerID == "" || idemKey == "" {
		return nil, fmt.Errorf("escrow: payer and idempotency key required")
	}

	// Replay: if a hold already exists for this key, return it (no double-debit).
	if existing, err := s.getByIdem(ctx, idemKey); err == nil && existing != nil {
		return existing, nil
	}

	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, err
	}
	// NL-1: ledger.Debit fails closed on insufficient funds — no negative balance.
	if err := s.led.Debit(ctx, payerID, "escrow:"+reference, idemKey+":hold", escrowAcc.ID, amountKobo); err != nil {
		return nil, fmt.Errorf("escrow: hold debit: %w", err)
	}

	h := &Hold{
		ID:             uuid.New().String(),
		Reference:      reference,
		ModuleType:     moduleType,
		PayerID:        payerID,
		AmountKobo:     amountKobo,
		State:          StateHeld,
		IdempotencyKey: idemKey,
		HeldAt:         time.Now(),
	}
	const ins = `
		INSERT INTO escrow_holds (id, reference, module_type, payer_id, amount_kobo, state, idempotency_key, held_at)
		VALUES ($1,$2,$3,$4,$5,'HELD',$6,$7)`
	if _, err := s.db.Exec(ctx, ins, h.ID, h.Reference, h.ModuleType, h.PayerID, h.AmountKobo, h.IdempotencyKey, h.HeldAt); err != nil {
		return nil, fmt.Errorf("escrow: insert hold: %w", err)
	}
	s.logTransition("", h, StateHeld, "escrow.hold")
	return h, nil
}

// Release moves the held amount from escrow to the payee (HELD|DISPUTED → RELEASED).
func (s *Service) Release(ctx context.Context, escrowID, payeeID string) error {
	return s.resolve(ctx, escrowID, StateReleased, payeeID, "escrow.release")
}

// Refund returns the held amount to the original payer (HELD|DISPUTED → REFUNDED).
func (s *Service) Refund(ctx context.Context, escrowID string) error {
	return s.resolve(ctx, escrowID, StateRefunded, "", "escrow.refund")
}

// resolve performs the guarded transition + the matching ledger credit atomically
// at the domain layer: the row state flips FOR UPDATE first (rejecting illegal /
// repeated transitions) then the ledger credit posts with a per-state idem key.
func (s *Service) resolve(ctx context.Context, escrowID string, to State, payeeID, action string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("escrow: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var h Hold
	var state string
	const sel = `SELECT id, reference, payer_id, amount_kobo, state, idempotency_key
	             FROM escrow_holds WHERE id=$1 FOR UPDATE`
	if err := tx.QueryRow(ctx, sel, escrowID).Scan(
		&h.ID, &h.Reference, &h.PayerID, &h.AmountKobo, &state, &h.IdempotencyKey,
	); err != nil {
		if err == pgx.ErrNoRows {
			return fmt.Errorf("escrow: hold not found")
		}
		return fmt.Errorf("escrow: fetch hold: %w", err)
	}
	from := State(state)
	if from == to {
		return nil // idempotent re-resolve: already in target terminal state
	}
	if !canTransition(from, to) {
		return fmt.Errorf("escrow: illegal transition %s -> %s", from, to)
	}

	const upd = `UPDATE escrow_holds SET state=$2, payee_id=$3, resolved_at=now() WHERE id=$1`
	var payeeArg any
	if to == StateReleased {
		if payeeID == "" {
			return fmt.Errorf("escrow: payee required to release")
		}
		payeeArg = payeeID
	}
	if _, err := tx.Exec(ctx, upd, escrowID, string(to), payeeArg); err != nil {
		return fmt.Errorf("escrow: update state: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("escrow: commit transition: %w", err)
	}

	// Money leg: credit escrow -> payee (release) or escrow -> payer (refund).
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	beneficiary := h.PayerID
	leg := "refund"
	if to == StateReleased {
		beneficiary = payeeID
		leg = "release"
	}
	if err := s.led.Credit(ctx, beneficiary, leg+":"+h.Reference, h.IdempotencyKey+":"+leg, escrowAcc.ID, h.AmountKobo); err != nil {
		return fmt.Errorf("escrow: %s credit: %w", leg, err)
	}

	hh := h
	hh.State = to
	if to == StateReleased {
		hh.PayeeID = &payeeID
	}
	s.logTransition(string(from), &hh, to, action)
	return nil
}

// Get returns a hold by id (object-level authZ enforced by callers/RLS).
func (s *Service) Get(ctx context.Context, escrowID string) (*Hold, error) {
	var h Hold
	var state string
	const q = `SELECT id, reference, module_type, payer_id, payee_id, amount_kobo, state, idempotency_key, held_at, resolved_at
	           FROM escrow_holds WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, escrowID).Scan(
		&h.ID, &h.Reference, &h.ModuleType, &h.PayerID, &h.PayeeID, &h.AmountKobo,
		&state, &h.IdempotencyKey, &h.HeldAt, &h.ResolvedAt,
	); err != nil {
		return nil, err
	}
	h.State = State(state)
	return &h, nil
}

func (s *Service) getByIdem(ctx context.Context, idemKey string) (*Hold, error) {
	var h Hold
	var state string
	const q = `SELECT id, reference, module_type, payer_id, payee_id, amount_kobo, state, idempotency_key, held_at, resolved_at
	           FROM escrow_holds WHERE idempotency_key=$1`
	if err := s.db.QueryRow(ctx, q, idemKey).Scan(
		&h.ID, &h.Reference, &h.ModuleType, &h.PayerID, &h.PayeeID, &h.AmountKobo,
		&state, &h.IdempotencyKey, &h.HeldAt, &h.ResolvedAt,
	); err != nil {
		return nil, err
	}
	h.State = State(state)
	return &h, nil
}

func (s *Service) logTransition(from string, h *Hold, to State, action string) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(h.PayerID, "", action, "escrow", "escrow_hold", h.ID,
		map[string]any{"state": from},
		map[string]any{"state": string(to), "amount_kobo": h.AmountKobo},
		"", "", "info")
}
