package escrow

import (
	"context"
	"errors"
	"fmt"
	"spotlight/backend/go-common/fsm"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Auditor is the minimal slice of services.AuditService the escrow core needs.
// It is satisfied by the existing immutable audit service (NL-12); nil is safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// walletDebitLimiter is the minimal seam the Hold money path depends on for
// the fail-closed KYC-tier / daily-debit gate. *tiers.Service satisfies it in
// production; unit tests inject a fake via WithTiers. Modeled as a local
// interface — mirrors social's walletDebitLimiter. A hold debits the payer's
// wallet, so the STRICT gate is used: it is not a checkout purchase, so the
// Tier-0 checkout allowance (ADR-043) does NOT apply here.
type walletDebitLimiter interface {
	EnforceWalletDebitLimit(ctx context.Context, userID string, amountKobo int64) error
}

// ErrTierGateUnwired is returned when a Service has no tier gate — a nil gate
// must fail CLOSED, never debit ungated (mirrors social.ErrTierGateUnwired).
var ErrTierGateUnwired = errors.New("escrow: money path requires a tier gate (not wired)")

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
	tiers walletDebitLimiter
}

// NewService builds the escrow service. The tier-limit gate is constructed
// from the same pool (tiers.NewService needs only the DB), so no extra wiring
// is required at the call site — same convention as social.NewService. A nil
// pool leaves the gate nil, and Hold then fails closed via ErrTierGateUnwired.
func NewService(db *pgxpool.Pool, led *ledger.Service, audit Auditor) *Service {
	s := &Service{db: db, led: led, audit: audit}
	if db != nil {
		s.tiers = tiers.NewService(db)
	}
	return s
}

// WithTiers injects a pre-configured tier gate (app-wiring / tests). A nil
// argument is ignored so an unwired injection can never strip the gate.
func (s *Service) WithTiers(t walletDebitLimiter) *Service {
	if t != nil {
		s.tiers = t
	}
	return s
}

// enforceDebitLimit is the fail-closed guard applied before the Hold wallet
// debit (E2E-FIN-046): the same EnforceWalletDebitLimit the canonical transfer
// rail (finance/transfers) runs. Tier 0 → ErrWalletDisabled, over daily cap →
// ErrDailyLimitExceeded, gate/db errors refuse, and a missing gate refuses via
// ErrTierGateUnwired. The error is propagated UNWRAPPED so callers can map the
// tier sentinels to 403 via errors.Is.
func (s *Service) enforceDebitLimit(ctx context.Context, userID string, amountKobo int64) error {
	if s.tiers == nil {
		return ErrTierGateUnwired
	}
	return s.tiers.EnforceWalletDebitLimit(ctx, userID, amountKobo)
}

// Hold debits the payer's wallet into the escrow account and records a HELD hold.
// idemKey makes the whole operation replay-safe: the ledger debit is suffixed
// per-leg and the hold row carries a UNIQUE idempotency_key.
func (s *Service) Hold(ctx context.Context, payerID, reference, moduleType, idemKey string, amountKobo int64) (*Hold, error) {
	if amountKobo <= 0 {
		return nil, fmt.Errorf("escrow: amount must be positive kobo, got %d", amountKobo)
	}
	if payerID == "" || idemKey == "" {
		return nil, errors.New("escrow: payer and idempotency key required")
	}

	// Replay: if a hold already exists for this key, return it (no double-debit).
	if existing, err := s.getByIdem(ctx, idemKey); err == nil && existing != nil {
		return existing, nil
	}

	// Tier gate (fail-closed, E2E-FIN-046): a hold is a wallet debit, so the
	// same EnforceWalletDebitLimit the transfer rail applies runs BEFORE money
	// moves — a refused attempt posts zero ledger legs and no hold row. Replays
	// already returned the existing hold above, so a completed key never
	// reaches this gate.
	if err := s.enforceDebitLimit(ctx, payerID, amountKobo); err != nil {
		return nil, err
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

// resolve performs the guarded transition + the matching ledger credit. The row
// state flips FOR UPDATE first (rejecting illegal / repeated transitions), then —
// after the commit — the ledger credit posts under a per-state idempotency key.
//
// The ledger API opens its own transaction (no pgx.Tx posting seam), so the two
// writes cannot share one DB tx. What makes the gap safe is that the idempotent
// early-return does NOT skip the money leg: a replay on an already-terminal hold
// runs ensureResolutionCredit, which verifies the credit against the ledger of
// record (ledger.Posted) and posts it if it is missing — so a process that dies
// between the state commit and the credit leaves the beneficiary unpaid only
// until the next resolve call, which heals it (never a permanently unpaid
// RELEASED/REFUNDED state, and never a double-pay: the per-leg key dedups a
// racing poster, and a committed terminal state means the OPPOSITE leg can no
// longer be attempted — the FSM rejects it before any money moves).
func (s *Service) resolve(ctx context.Context, escrowID string, to State, payeeID, action string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("escrow: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var h Hold
	var state string
	const sel = `SELECT id, reference, payer_id, payee_id, amount_kobo, state, idempotency_key
	             FROM escrow_holds WHERE id=$1 FOR UPDATE`
	if err := tx.QueryRow(ctx, sel, escrowID).Scan(
		&h.ID, &h.Reference, &h.PayerID, &h.PayeeID, &h.AmountKobo, &state, &h.IdempotencyKey,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("escrow: hold not found")
		}
		return fmt.Errorf("escrow: fetch hold: %w", err)
	}
	from := State(state)
	if from == to {
		// Idempotent re-resolve: already in the target terminal state — but the
		// credit posts AFTER the commit, so a crashed prior attempt may have left
		// the beneficiary unpaid. Verify (and heal) the money leg before
		// reporting success; the beneficiary is taken from the STORED row, never
		// the replay's payee argument, so a re-resolve cannot redirect funds.
		posted, err := s.ensureResolutionCredit(ctx, &h, to)
		if err != nil {
			return err
		}
		if posted {
			// A healed credit is still a money mutation — audit it (distinct
			// action so recon can tell a heal from a first-pass resolve).
			hh := h
			hh.State = to
			s.logTransition(string(from), &hh, to, action+".credit_heal")
		}
		return nil
	}
	if !canTransition(from, to) {
		return fmt.Errorf("escrow: illegal transition %s -> %s", from, to)
	}

	const upd = `UPDATE escrow_holds SET state=$2, payee_id=$3, resolved_at=now() WHERE id=$1`
	var payeeArg any
	if to == StateReleased {
		if payeeID == "" {
			return errors.New("escrow: payee required to release")
		}
		payeeArg = payeeID
		h.PayeeID = &payeeID
	}
	if _, err := tx.Exec(ctx, upd, escrowID, string(to), payeeArg); err != nil {
		return fmt.Errorf("escrow: update state: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("escrow: commit transition: %w", err)
	}

	// Money leg: credit escrow -> payee (release) or escrow -> payer (refund).
	if _, err := s.ensureResolutionCredit(ctx, &h, to); err != nil {
		return err
	}

	hh := h
	hh.State = to
	s.logTransition(string(from), &hh, to, action)
	return nil
}

// ensureResolutionCredit makes the beneficiary's credit leg for a resolved hold
// durable: if the balanced entry for this hold's per-state key is not posted, it
// posts it. Called both on the fresh path (right after the state commit) and on
// the from==to replay path (to heal a hold that committed its terminal state but
// died before the credit). Idempotent via the "<hold idemKey>:release|refund"
// key — a retry or a racing poster dedups to ledger.ErrDuplicate. Returns
// posted=true only when this call wrote a NEW credit (callers use it to emit
// the audit event on the heal path; the fresh path audits regardless).
func (s *Service) ensureResolutionCredit(ctx context.Context, h *Hold, to State) (bool, error) {
	leg := "refund"
	beneficiary := h.PayerID
	if to == StateReleased {
		leg = "release"
		if h.PayeeID == nil || *h.PayeeID == "" {
			return false, errors.New("escrow: released hold has no recorded payee — refusing to guess the beneficiary")
		}
		beneficiary = *h.PayeeID
	}
	key := h.IdempotencyKey + ":" + leg
	posted, err := s.led.Posted(ctx, key)
	if err != nil {
		return false, fmt.Errorf("escrow: verify %s credit: %w", leg, err)
	}
	if posted {
		return false, nil
	}
	escrowAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return false, err
	}
	if err := s.led.Credit(ctx, beneficiary, leg+":"+h.Reference, key, escrowAcc.ID, h.AmountKobo); err != nil {
		if errors.Is(err, ledger.ErrDuplicate) {
			// ErrDuplicate can also surface from the Redis idem-lock TTL window,
			// not only a durable journal row — recheck the ledger of record
			// before reporting the credit as applied.
			posted, perr := s.led.Posted(ctx, key)
			if perr != nil {
				return false, fmt.Errorf("escrow: verify %s credit after duplicate: %w", leg, perr)
			}
			if !posted {
				return false, fmt.Errorf("escrow: %s credit claimed duplicate but is not posted", leg)
			}
			return false, nil
		}
		return false, fmt.Errorf("escrow: %s credit: %w", leg, err)
	}
	return true, nil
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

// State is the funds-hold lifecycle. DISPUTED is reserved for Phase 3; the
// allowed-transition table here already tolerates it so P3 only adds the entry
// path, never a schema change.
type State string

const (
	StateHeld     State = "HELD"
	StateReleased State = "RELEASED"
	StateRefunded State = "REFUNDED"
	StateDisputed State = "DISPUTED" // P3
)

// allowedTransitions encodes the guarded state machine. Any transition not
// listed is rejected (NL-12 / "state machines, not status fields").
var allowedTransitions = fsm.Table[State]{
	StateHeld:     {StateReleased: true, StateRefunded: true, StateDisputed: true},
	StateDisputed: {StateReleased: true, StateRefunded: true}, // P3 arbitration
	StateReleased: {},
	StateRefunded: {},
}

func canTransition(from, to State) bool { return allowedTransitions.Can(from, to) }

// Hold is a single funds-hold. The held amount lives in the shared ledger escrow
// standing account (NL-6/NL-8) — there is no balance column. PayerID funds it on
// Hold; on Release it credits PayeeID; on Refund it credits PayerID back. Paymax
// never advances principal (NL-1) and never pays yield on the float (NL-2).
type Hold struct {
	ID             string     `json:"id"`
	Reference      string     `json:"reference"`   // domain ref (split id, pool id, order id…)
	ModuleType     string     `json:"module_type"` // social | events | creators …
	PayerID        string     `json:"payer_id"`    // FK auth.users(id)
	PayeeID        *string    `json:"payee_id,omitempty"`
	AmountKobo     int64      `json:"amount_kobo"`
	State          State      `json:"state"`
	IdempotencyKey string     `json:"idempotency_key"`
	HeldAt         time.Time  `json:"held_at"`
	ResolvedAt     *time.Time `json:"resolved_at,omitempty"`
}
