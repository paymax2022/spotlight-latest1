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

// MinTier is the minimum KYC tier required to request a payout (CBN: cash-out
// requires verified identity). Tier 2 = ID-verified.
const MinTier = 2

// Sentinel errors.
var (
	ErrMissingIdem   = errors.New("connect: Idempotency-Key required")
	ErrInvalidAmount = errors.New("connect: payout amount must be positive kobo")
	ErrTierTooLow    = errors.New("connect: payout requires KYC tier 2 or higher")
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
}

// NewService builds the payouts service. settler/solicitation may be nil.
func NewService(repo *Repository, wallet WalletDebiter, settlement SettlementAccountResolver, tiers TierGate, settler Settler, audit Auditor, solicitation SolicitationFlagger) *Service {
	return &Service{
		repo:         repo,
		wallet:       wallet,
		settlement:   settlement,
		tiers:        tiers,
		settler:      settler,
		audit:        audit,
		solicitation: solicitation,
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
