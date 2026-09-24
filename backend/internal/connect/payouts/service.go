package connectpayouts

import (
	"context"
	"errors"
)

// WalletDebiter debits the creator's wallet and credits the given standing
// account (settlement) — a balanced double-entry, tier-checked fail-closed,
// keyed by idempotencyKey. Implemented by internal/finance/wallet.Service.Debit.
type WalletDebiter interface {
	Debit(ctx context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error
}

// SettlementAccountResolver returns the standing settlement account id that
// payout debits are parked in pending bank settlement. Implemented by the ledger
// service (ledger.AccountSettlement).
type SettlementAccountResolver interface {
	SettlementAccountID(ctx context.Context) (string, error)
}

// TierGate enforces the Tier-2+/KYC requirement, fail-closed. GetUserTier
// returns the creator's KYC tier; the service requires >= Tier 2.
type TierGate interface {
	GetUserTier(ctx context.Context, userID string) (int, error)
}

// Settler initiates the actual bank settlement (provider hook). It returns a
// provider settlement reference. The ledger debit has already parked the funds
// in the settlement account; this hook moves them to the bank out-of-band. A
// stub implementation may return a synthetic reference.
type Settler interface {
	Settle(ctx context.Context, payoutID, creatorID, destinationRef string, amountKobo int64) (settlementRef string, err error)
}

// Auditor writes an immutable audit entry (connect_audit_log).
type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

// SolicitationFlagger reports payouts to AML monitoring (best-effort).
type SolicitationFlagger interface {
	FlagPayout(ctx context.Context, creatorID string, amountKobo int64, ref string) error
}

// PayoutReverser reverses a payout's parked settlement debit when an admin
// rejects it: a balanced reversal pair (money restored to the creator's
// wallet, released from the settlement account) — the mirror of the debit
// Request() posted, keyed by a deterministic idempotency key so a retry (or a
// double-click in the admin console) is a safe no-op, never a double-refund.
// Implemented by internal/finance/ledger.Service.PostReversal via an adapter
// in connect_money_routes.go (same pattern as connectSettlementAdapter).
type PayoutReverser interface {
	ReversePayout(ctx context.Context, creatorID, payoutID string, amountKobo int64) error
}

// MinTier is the minimum KYC tier required to request a payout (CBN: cash-out
// requires verified identity). Tier 2 = ID-verified.
const MinTier = 2

// Sentinel errors.
var (
	ErrMissingIdem   = errors.New("connect: Idempotency-Key required")
	ErrInvalidAmount = errors.New("connect: payout amount must be positive kobo")
	ErrTierTooLow    = errors.New("connect: payout requires KYC tier 2 or higher")
	// ErrAlreadyTerminal is returned by the admin settle/reject actions when the
	// payout is already in the OTHER terminal state (settling a failed payout,
	// or rejecting a settled one) — a real conflict, not a safe retry.
	ErrAlreadyTerminal = errors.New("connect: payout already in a terminal state")
)

// Service orchestrates creator payouts. It owns NO balance state — the debit is
// delegated to the wallet (ledger); the connect_payouts row is a projection
// recorded after a successful, idempotent debit; settlement is an out-of-band
// hook stamped back onto the row.
type Service struct {
	repo         *Repository
	wallet       WalletDebiter
	settlement   SettlementAccountResolver
	tiers        TierGate
	settler      Settler
	audit        Auditor
	solicitation SolicitationFlagger
	reverser     PayoutReverser
}

// NewService builds the payouts service. settler/solicitation/reverser may be
// nil — reverser being nil only disables the admin reject action (AdminReject
// returns an error rather than silently skipping the reversal).
func NewService(repo *Repository, wallet WalletDebiter, settlement SettlementAccountResolver, tiers TierGate, settler Settler, audit Auditor, solicitation SolicitationFlagger, reverser PayoutReverser) *Service {
	return &Service{
		repo:         repo,
		wallet:       wallet,
		settlement:   settlement,
		tiers:        tiers,
		settler:      settler,
		audit:        audit,
		solicitation: solicitation,
		reverser:     reverser,
	}
}

// Request is the money path for a creator gift-revenue payout.
//
// Ordering (correctness > convenience):
//  1. require an Idempotency-Key + positive amount;
//  2. enforce the Tier-2+/KYC gate, fail-closed;
//  3. debit the creator wallet → settlement account (tier-checked, balanced
//     double-entry, idempotent — a retry is a safe no-op);
//  4. record the immutable payout row;
//  5. invoke the settlement hook (best-effort) and stamp the reference;
//  6. emit an audit event + fire the AML hook.
func (s *Service) Request(ctx context.Context, creatorID, idemKey string, req RequestPayoutRequest) (*Payout, error) {
	if idemKey == "" {
		return nil, ErrMissingIdem
	}
	if req.AmountKobo <= 0 {
		return nil, ErrInvalidAmount
	}

	// Tier/KYC gate, fail-closed.
	tier, err := s.tiers.GetUserTier(ctx, creatorID)
	if err != nil {
		return nil, ErrTierTooLow // fail closed: unknown tier blocks payout
	}
	if tier < MinTier {
		return nil, ErrTierTooLow
	}

	settleAcc, err := s.settlement.SettlementAccountID(ctx)
	if err != nil {
		return nil, err
	}
	ref := "connect:payout:" + creatorID
	// Money mutation — tier-checked, balanced double-entry, idempotent.
	if err := s.wallet.Debit(ctx, creatorID, ref, idemKey, settleAcc, req.AmountKobo); err != nil {
		return nil, err
	}

	var dest *string
	if req.DestinationRef != "" {
		d := req.DestinationRef
		dest = &d
	}
	p, err := s.repo.Insert(ctx, &Payout{
		CreatorID:      creatorID,
		AmountKobo:     req.AmountKobo,
		DestinationRef: dest,
		IdempotencyKey: idemKey,
		LedgerRef:      ref,
	})
	if err != nil {
		return nil, err
	}

	// Settlement hook (best-effort): initiate the bank transfer + stamp ref.
	if s.settler != nil {
		if settlementRef, serr := s.settler.Settle(ctx, p.ID, creatorID, req.DestinationRef, req.AmountKobo); serr == nil {
			_ = s.repo.MarkProcessing(ctx, p.ID, settlementRef)
			p.Status = "processing"
			p.SettlementRef = &settlementRef
		}
	}

	_ = s.audit.WriteAudit(ctx, "connect.payout.request", creatorID, "connect_payout", p.ID, map[string]any{
		"amount_kobo": req.AmountKobo, "idempotency_key": idemKey, "ledger_ref": ref,
	})
	if s.solicitation != nil {
		_ = s.solicitation.FlagPayout(ctx, creatorID, req.AmountKobo, ref)
	}
	return p, nil
}

// List returns a creator's payouts.
func (s *Service) List(ctx context.Context, creatorID string, limit int) ([]Payout, error) {
	return s.repo.List(ctx, creatorID, limit)
}

// AdminList returns the cross-creator payout queue for the admin console,
// enriching each row with the creator's CURRENT KYC tier (read live — a
// creator's tier can change after the payout was requested, and the queue
// should reflect that, not a stale snapshot).
func (s *Service) AdminList(ctx context.Context, f AdminListFilter) ([]AdminPayout, error) {
	rows, err := s.repo.AdminList(ctx, f)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		tier, terr := s.tiers.GetUserTier(ctx, rows[i].CreatorID)
		if terr == nil {
			rows[i].CreatorTier = tier
		}
		// A tier lookup failure here is display-only (unlike the fail-closed gate
		// in Request()) — the row still renders with tier 0 rather than the whole
		// admin queue failing to load over one bad row.
	}
	return rows, nil
}

// AdminGet returns a single payout for the admin detail view, tier-enriched
// the same way as AdminList.
func (s *Service) AdminGet(ctx context.Context, id string) (*AdminPayout, error) {
	p, err := s.repo.AdminGet(ctx, id)
	if err != nil {
		return nil, err
	}
	if tier, terr := s.tiers.GetUserTier(ctx, p.CreatorID); terr == nil {
		p.CreatorTier = tier
	}
	return p, nil
}

// AdminSettle confirms a payout's bank settlement completed out-of-band (the
// Settler hook is a stub in production today — see connect_money_routes.go —
// so this is how an operator reconciles a real bank transfer against the
// payout row). Forward-only: requested/processing → settled. It does NOT move
// any money — the debit already happened in Request(); this only stamps the
// row that confirms the money that was already parked in settlement left the
// building. Idempotent: settling an already-settled payout with the same ref
// is a no-op success; a DIFFERENT settlementRef on an already-settled payout
// is refused (ErrAlreadyTerminal) rather than silently overwritten.
func (s *Service) AdminSettle(ctx context.Context, adminID, payoutID, settlementRef string) (*Payout, error) {
	p, err := s.repo.Get(ctx, payoutID)
	if err != nil {
		return nil, err
	}
	if p.Status == "settled" {
		if p.SettlementRef != nil && *p.SettlementRef == settlementRef {
			return p, nil // idempotent no-op
		}
		return nil, ErrAlreadyTerminal
	}
	if p.Status == "failed" {
		return nil, ErrAlreadyTerminal
	}
	if err := s.repo.MarkSettled(ctx, payoutID, settlementRef); err != nil {
		return nil, err
	}
	p.Status = "settled"
	if settlementRef != "" {
		ref := settlementRef
		p.SettlementRef = &ref
	}
	_ = s.audit.WriteAudit(ctx, "connect.payout.admin_settle", adminID, "connect_payout", p.ID, map[string]any{
		"settlement_ref": settlementRef, "amount_kobo": p.AmountKobo, "creator_id": p.CreatorID,
	})
	return p, nil
}

// AdminReject reverses a payout an operator has determined will never settle
// (provider rejected the bank transfer, fraud hold, etc.). Ordering mirrors
// Request()'s correctness-first discipline:
//  1. re-read the row and refuse if it is already terminal (settled/failed —
//     see the same-state idempotent-no-op / ErrAlreadyTerminal split below);
//  2. reverse the parked settlement debit BACK to the creator's wallet — a
//     balanced double-entry, the mirror of the original debit, via the SAME
//     ledger the money path already uses (no new money-movement code);
//  3. only after the reversal succeeds, mark the payout row 'failed' —
//     ordering the ledger write before the row write means a crash between
//     the two leaves the row inconsistent with the ledger in the SAFE
//     direction (money already reversed; a retry of MarkFailed is a cheap,
//     idempotent repo update) rather than the unsafe one;
//  4. emit an audit event.
func (s *Service) AdminReject(ctx context.Context, adminID, payoutID, reason string) (*Payout, error) {
	if s.reverser == nil {
		return nil, errors.New("connect: payout reversal not wired")
	}
	p, err := s.repo.Get(ctx, payoutID)
	if err != nil {
		return nil, err
	}
	if p.Status == "failed" {
		return p, nil // idempotent no-op
	}
	if p.Status == "settled" {
		return nil, ErrAlreadyTerminal // money already left settlement — not reversible here
	}
	if err := s.reverser.ReversePayout(ctx, p.CreatorID, p.ID, p.AmountKobo); err != nil {
		return nil, err
	}
	if err := s.repo.MarkFailed(ctx, payoutID); err != nil {
		return nil, err
	}
	p.Status = "failed"
	_ = s.audit.WriteAudit(ctx, "connect.payout.admin_reject", adminID, "connect_payout", p.ID, map[string]any{
		"reason": reason, "amount_kobo": p.AmountKobo, "creator_id": p.CreatorID,
	})
	return p, nil
}
