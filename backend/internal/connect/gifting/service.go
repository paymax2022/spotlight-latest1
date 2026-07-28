package connectgifting

import (
	"context"
	"errors"
)

// WalletTransfer moves real Naira from one user's wallet to another's via the
// finance ledger: a single balanced double-entry (DR sender user_wallet, CR
// recipient user_wallet) keyed by idempotencyKey. The implementation enforces
// the sender's available balance and posts immutable ledger entries — it NEVER
// touches a balance column. A retried key is a safe no-op (ledger unique
// constraint). Implemented by an adapter over internal/finance/ledger in the
// route wiring.
type WalletTransfer interface {
	Transfer(ctx context.Context, fromUserID, toUserID, reference, idempotencyKey string, amountKobo int64) error
}

// TierGuard enforces the sender's KYC tier daily-debit limit, fail-closed, BEFORE
// any money moves. Implemented by internal/finance/tiers.Service.
type TierGuard interface {
	EnforceWalletDebitLimit(ctx context.Context, userID string, amountKobo int64) error
}

// Auditor writes an immutable audit entry (connect_audit_log). Every gift emits
// one. Implemented by an adapter over connect/safety.Service.
type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

// SolicitationFlagger is the financial-solicitation / AML hook. Every gift is
// reported so AML monitoring (velocity / structuring / threshold rules + NFIU
// scaffold) can score it. Best-effort: a flag error never blocks a settled
// gift, but it is logged. Implemented by connect/aml.Service.
type SolicitationFlagger interface {
	FlagGift(ctx context.Context, senderID, recipientID string, amountKobo int64, ref string) error
}

// Sentinel errors.
var (
	ErrMissingIdem     = errors.New("connect: Idempotency-Key required")
	ErrInvalidAmount   = errors.New("connect: gift amount must be positive kobo")
	ErrGiftNotFound    = errors.New("connect: gift catalogue item not found or inactive")
	ErrSelfGift        = errors.New("connect: cannot gift yourself")
	ErrAmbiguousAmount = errors.New("connect: provide either giftId or amountKobo, not both")
)

// Service orchestrates wallet-to-wallet gifts. It owns NO balance state — money
// movement is delegated to the ledger via WalletTransfer; the connect_gifts row
// is a projection recorded after a successful, idempotent transfer.
type Service struct {
	repo         *Repository
	transfer     WalletTransfer
	tiers        TierGuard
	audit        Auditor
	solicitation SolicitationFlagger
}

// NewService builds the gifting service. solicitation may be nil (the
// financial-solicitation hook is then a no-op), but transfer/tiers/audit are
// required for the money path.
func NewService(repo *Repository, transfer WalletTransfer, tiers TierGuard, audit Auditor, solicitation SolicitationFlagger) *Service {
	return &Service{
		repo:         repo,
		transfer:     transfer,
		tiers:        tiers,
		audit:        audit,
		solicitation: solicitation,
	}
}

// Catalog returns the active backend-owned gift catalogue.
func (s *Service) Catalog(ctx context.Context) ([]CatalogItem, error) {
	return s.repo.ListCatalog(ctx)
}

// Send is the core money path for a real-Naira gift.
//
// Ordering (correctness > convenience):
//  1. validate input; resolve the amount server-side (catalogue price when a
//     giftId is given — NEVER trust a client amount for a catalogue gift);
//  2. require an Idempotency-Key;
//  3. enforce the sender's tier daily-debit limit, fail-closed;
//  4. transfer wallet→wallet (balanced double-entry, idempotent, ledger-only);
//  5. record the immutable connect_gifts row;
//  6. emit an audit event AND fire the financial-solicitation / AML hook.
func (s *Service) Send(ctx context.Context, senderID, idemKey string, req SendGiftRequest) (*Gift, error) {
	if idemKey == "" {
		return nil, ErrMissingIdem
	}
	if req.RecipientID == "" {
		return nil, ErrInvalidAmount
	}
	if req.RecipientID == senderID {
		return nil, ErrSelfGift
	}
	if req.GiftID != "" && req.AmountKobo > 0 {
		return nil, ErrAmbiguousAmount
	}

	var (
		amountKobo int64
		giftCode   *string
	)
	if req.GiftID != "" {
		item, err := s.repo.GetCatalogItem(ctx, req.GiftID)
		if err != nil {
			return nil, err
		}
		amountKobo = item.AmountKobo
		code := item.Code
		giftCode = &code
	} else {
		amountKobo = req.AmountKobo
	}
	if amountKobo <= 0 {
		return nil, ErrInvalidAmount
	}

	// Tier limit, fail-closed, BEFORE any money moves.
	if err := s.tiers.EnforceWalletDebitLimit(ctx, senderID, amountKobo); err != nil {
		return nil, err
	}

	ref := "connect:gift:" + senderID + "->" + req.RecipientID
	// Money mutation — single balanced double-entry, idempotent, ledger-only.
	if err := s.transfer.Transfer(ctx, senderID, req.RecipientID, ref, idemKey, amountKobo); err != nil {
		return nil, err // ErrInsufficientFunds / ErrDuplicate bubble up
	}

	var msg *string
	if req.Message != "" {
		m := req.Message
		msg = &m
	}
	g, err := s.repo.InsertGift(ctx, &Gift{
		SenderID:       senderID,
		RecipientID:    req.RecipientID,
		GiftCode:       giftCode,
		AmountKobo:     amountKobo,
		Message:        msg,
		IdempotencyKey: idemKey,
		LedgerRef:      ref,
	})
	if err != nil {
		// The transfer succeeded but the projection failed: surface loudly so
		// reconciliation can detect a posted ledger entry with no gift row.
		return nil, err
	}

	// Immutable audit event (never logs raw PII — ids + amount + ref only).
	_ = s.audit.WriteAudit(ctx, "connect.gift.send", senderID, "connect_gift", g.ID, map[string]any{
		"recipient_id": req.RecipientID, "amount_kobo": amountKobo,
		"idempotency_key": idemKey, "ledger_ref": ref,
	})
	// Financial-solicitation / AML hook (best-effort; never blocks a settled gift).
	if s.solicitation != nil {
		_ = s.solicitation.FlagGift(ctx, senderID, req.RecipientID, amountKobo, ref)
	}
	return g, nil
}

// ListSent returns gifts the user has sent.
func (s *Service) ListSent(ctx context.Context, userID string, limit int) ([]Gift, error) {
	return s.repo.ListSent(ctx, userID, limit)
}

// ListReceived returns gifts the user has received.
func (s *Service) ListReceived(ctx context.Context, userID string, limit int) ([]Gift, error) {
	return s.repo.ListReceived(ctx, userID, limit)
}
