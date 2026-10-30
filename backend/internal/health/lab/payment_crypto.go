package healthlab

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"
)

// Crypto payment for a lab order (Phase 2, Task 5.1).
//
// A lab order is PAID at creation: CreateOrder HELDs the patient's NGN in escrow
// (HL-9) and the row is born in CREATED with escrow_id bound. There is no
// separate unpaid "booking" to later flip to paid, so crypto payment is a
// FUNDING step in front of the unchanged order path:
//
//	quote order (server NGN total) -> price asset -> size units (+buffer)
//	  -> crypto.Sell(units) credits the patient's NGN wallet
//	  -> CreateOrder -> escrow.Hold debits that wallet (balanced ledger legs)
//
// The lab is still paid exactly as for a fiat order — escrow release on result
// sign-off — so settlement, commission and refund-on-cancel are untouched. Every
// money leg is idempotent on a key derived from the caller's Idempotency-Key.

// CryptoQuoteTTL is how long a crypto quote is advisory. Execution always
// re-prices; the TTL only bounds how stale a figure the client may confirm.
const CryptoQuoteTTL = 30 * time.Second

// cryptoBufferBps pads the units sold above the exact requirement so a small
// adverse price tick between the sizing read and the Sell fill cannot leave the
// wallet a few kobo short of the escrow hold. Any excess stays in the patient's
// NGN wallet — it is never retained.
const cryptoBufferBps = 50

var (
	// ErrCryptoUnavailable — crypto payment is not wired (flag off / no provider).
	ErrCryptoUnavailable = errors.New("lab: crypto payment is not available")
	// ErrCryptoAsset — the asset is missing, inactive or has no live price.
	ErrCryptoAsset = errors.New("lab: asset cannot be used for payment")
	// ErrCryptoQuoteMoved — the live price now needs more units than the patient
	// agreed to spend (max_units). Raised BEFORE any money moves.
	ErrCryptoQuoteMoved = errors.New("lab: the crypto price moved — please request a new quote")
	// ErrCryptoShortfall — the sell filled below the order total. The proceeds
	// remain in the patient's NGN wallet; no order was created.
	ErrCryptoShortfall = errors.New("lab: crypto proceeds were below the order total; funds were credited to your wallet")
)

// CryptoAssetPrice is the minimal priced view of a tradable asset.
type CryptoAssetPrice struct {
	AssetID        string
	Symbol         string
	PriceKobo      int64 // NGN kobo per one whole unit
	MinorUnitScale int64 // minor units per whole unit
}

// CryptoPayer is the crypto rail the lab consumes. Satisfied by an adapter over
// internal/crypto.Service (health_lab_routes.go); modeled locally so the lab never
// imports the crypto package.
type CryptoPayer interface {
	// AssetPrice returns the live price of an active asset (ErrCryptoAsset-like
	// failures may be returned as any error; the service folds them).
	AssetPrice(ctx context.Context, assetID string) (*CryptoAssetPrice, error)
	// SellToWallet liquidates `units` minor units of the patient's holding into
	// their NGN wallet, idempotent on idemKey. Returns the NGN kobo credited.
	SellToWallet(ctx context.Context, userID, assetID string, units int64, idemKey string) (int64, error)
}

// SetCryptoPayer wires the crypto rail. nil leaves crypto payment unavailable.
func (s *Service) SetCryptoPayer(p CryptoPayer) { s.crypto = p }

// CryptoPaymentQuote is the advisory price of paying an order in an asset.
type CryptoPaymentQuote struct {
	AssetID       string    `json:"asset_id"`
	Symbol        string    `json:"symbol"`
	TotalKobo     int64     `json:"total_kobo"`     // server NGN price of the order
	PriceKobo     int64     `json:"price_kobo"`     // NGN kobo per whole unit
	UnitsRequired int64     `json:"units_required"` // minor units, buffer included
	QuotedAt      time.Time `json:"quoted_at"`
	ExpiresAt     time.Time `json:"expires_at"`
}

// CryptoPaymentResult is the outcome of a completed crypto payment.
type CryptoPaymentResult struct {
	Order      *Order              `json:"order"`
	Quote      *CryptoPaymentQuote `json:"quote"`
	UnitsSold  int64               `json:"units_sold"`
	ProceedsKb int64               `json:"proceeds_kobo"` // NGN credited by the sell
	Replayed   bool                `json:"replayed"`
}

// unitsForKoboCeil is the minor units needed to raise at least `kobo` at
// priceKobo per whole unit (rounds UP — the patient must never under-fund).
func unitsForKoboCeil(kobo, priceKobo, scale int64) (int64, error) {
	if kobo <= 0 || priceKobo <= 0 || scale <= 0 {
		return 0, ErrCryptoAsset
	}
	n := new(big.Int).Mul(big.NewInt(kobo), big.NewInt(scale))
	d := big.NewInt(priceKobo)
	n.Add(n, new(big.Int).Sub(d, big.NewInt(1)))
	n.Quo(n, d)
	if !n.IsInt64() {
		return 0, ErrCryptoAsset
	}
	return n.Int64(), nil
}

// withBufferBps adds bps/10000 (rounded up) to units.
func withBufferBps(units int64, bps int64) (int64, error) {
	b := new(big.Int).Mul(big.NewInt(units), big.NewInt(bps))
	b.Add(b, big.NewInt(9_999))
	b.Quo(b, big.NewInt(10_000))
	b.Add(b, big.NewInt(units))
	if !b.IsInt64() {
		return 0, ErrCryptoAsset
	}
	return b.Int64(), nil
}

// cryptoPayDeps are the seams the orchestration needs, so the money flow is
// unit-testable without a database.
type cryptoPayDeps struct {
	payer    CryptoPayer
	quote    func(context.Context, CreateOrderInput) (*OrderQuote, error)
	existing func(ctx context.Context, patientID, idemKey string) (*Order, error)
	create   func(context.Context, string, CreateOrderInput) (*Order, error)
	now      func() time.Time
	audit    func(actor, action, resourceID string, newV map[string]any)
}

func (s *Service) cryptoDeps() cryptoPayDeps {
	return cryptoPayDeps{
		payer:    s.crypto,
		quote:    s.QuoteOrder,
		existing: s.getByIdem,
		create:   s.CreateOrder,
		now:      time.Now,
		audit: func(actor, action, resourceID string, newV map[string]any) {
			s.audited(actor, "", action, resourceID, nil, newV)
		},
	}
}

func (d cryptoPayDeps) priceQuote(ctx context.Context, in CreateOrderInput, assetID string) (*CryptoPaymentQuote, error) {
	if d.payer == nil {
		return nil, ErrCryptoUnavailable
	}
	if assetID == "" {
		return nil, ErrCryptoAsset
	}
	oq, err := d.quote(ctx, in)
	if err != nil {
		return nil, err
	}
	p, err := d.payer.AssetPrice(ctx, assetID)
	if err != nil || p == nil {
		return nil, ErrCryptoAsset
	}
	exact, err := unitsForKoboCeil(oq.TotalKobo, p.PriceKobo, p.MinorUnitScale)
	if err != nil {
		return nil, err
	}
	units, err := withBufferBps(exact, cryptoBufferBps)
	if err != nil {
		return nil, err
	}
	now := d.now()
	return &CryptoPaymentQuote{
		AssetID: assetID, Symbol: p.Symbol, TotalKobo: oq.TotalKobo, PriceKobo: p.PriceKobo,
		UnitsRequired: units, QuotedAt: now, ExpiresAt: now.Add(CryptoQuoteTTL),
	}, nil
}

// QuoteCryptoPayment prices the order in the asset. Read-only: no money moves.
func (s *Service) QuoteCryptoPayment(ctx context.Context, patientID string, in CreateOrderInput, assetID string) (*CryptoPaymentQuote, error) {
	if patientID == "" {
		return nil, errors.New("lab: unauthenticated")
	}
	return s.cryptoDeps().priceQuote(ctx, in, assetID)
}

// PayWithCrypto funds and creates the order from the patient's crypto holding.
// maxUnits (> 0) is the patient's slippage cap from their quote: if the live
// price needs more, ErrCryptoQuoteMoved is returned before any money moves.
func (s *Service) PayWithCrypto(ctx context.Context, patientID string, in CreateOrderInput, assetID string, maxUnits int64) (*CryptoPaymentResult, error) {
	return s.cryptoDeps().pay(ctx, patientID, in, assetID, maxUnits)
}

func (d cryptoPayDeps) pay(ctx context.Context, patientID string, in CreateOrderInput, assetID string, maxUnits int64) (*CryptoPaymentResult, error) {
	if patientID == "" {
		return nil, errors.New("lab: unauthenticated")
	}
	if in.IdempotencyKey == "" {
		return nil, errors.New("lab: idempotency key required (HL-9)")
	}
	if maxUnits <= 0 {
		return nil, errors.New("lab: max_units required — request a crypto quote first")
	}
	// Replay: this key already produced the patient's order — return it without
	// selling again.
	if ex, err := d.existing(ctx, patientID, in.IdempotencyKey); err == nil && ex != nil {
		return &CryptoPaymentResult{Order: ex, Replayed: true}, nil
	}
	q, err := d.priceQuote(ctx, in, assetID)
	if err != nil {
		return nil, err
	}
	// Server-side confirmation of the NGN figure the patient saw, before any money moves.
	if in.ExpectedTotalKobo != nil && *in.ExpectedTotalKobo != q.TotalKobo {
		return nil, &QuoteChangedError{Quote: &OrderQuote{TotalKobo: q.TotalKobo}}
	}
	if q.UnitsRequired > maxUnits {
		return nil, ErrCryptoQuoteMoved
	}
	sellKey := "labcrypto:" + patientID + ":" + in.IdempotencyKey + ":sell"
	proceeds, err := d.payer.SellToWallet(ctx, patientID, assetID, q.UnitsRequired, sellKey)
	if err != nil {
		return nil, fmt.Errorf("lab: crypto sell: %w", err)
	}
	if proceeds < q.TotalKobo {
		d.audit(patientID, "health.lab.crypto.shortfall", sellKey,
			map[string]any{"asset_id": assetID, "units": q.UnitsRequired, "proceeds_kobo": proceeds, "total_kobo": q.TotalKobo})
		return nil, ErrCryptoShortfall
	}
	// Escrow HELD from the freshly credited wallet — same path as a fiat order,
	// including its tier-limit gate and compensating refund.
	o, err := d.create(ctx, patientID, in)
	if err != nil {
		return nil, err
	}
	d.audit(patientID, "health.lab.crypto.pay", o.ID,
		map[string]any{"asset_id": assetID, "units": q.UnitsRequired, "proceeds_kobo": proceeds,
			"total_kobo": q.TotalKobo, "price_kobo": q.PriceKobo, "escrow_id": o.EscrowID})
	return &CryptoPaymentResult{Order: o, Quote: q, UnitsSold: q.UnitsRequired, ProceedsKb: proceeds}, nil
}
