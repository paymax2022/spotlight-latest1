package crypto

import (
	"fmt"
	"math/big"
	"time"
)

// RBAC permission slugs (seeded by migration 20260815001600_crypto.sql).
const (
	PermView  = "crypto.view"  // read catalogue / quotes / own portfolio
	PermTrade = "crypto.trade" // place buy/sell orders
	PermAdmin = "crypto.admin" // admin: catalogue + all-orders + config
)

// Units & money model (iron rule: integers in minor units, never floats):
//   - Cash legs are NGN kobo (int64).
//   - price_kobo is the NGN price in kobo per ONE WHOLE asset unit.
//   - Holdings are stored in integer asset minor units; MinorUnitScale is the
//     number of minor units per one whole asset unit (e.g. 1e8). A holding of
//     `units` minor units is worth: units * price_kobo / MinorUnitScale (kobo),
//     computed with integer arithmetic only.

// Asset is a tradable crypto asset in the admin-curated catalogue.
type Asset struct {
	ID             string    `json:"id"`
	Symbol         string    `json:"symbol"`
	Name           string    `json:"name"`
	MinorUnitScale int64     `json:"minor_unit_scale"`
	IsActive       bool      `json:"is_active"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// Quote is a point-in-time price for an asset.
type Quote struct {
	AssetID   string    `json:"asset_id"`
	Symbol    string    `json:"symbol"`
	PriceKobo int64     `json:"price_kobo"` // NGN kobo per 1 whole unit
	Source    string    `json:"source"`
	AsOf      time.Time `json:"as_of"`
}

// Order is an immutable money-path record of a filled buy/sell.
type Order struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	AssetID   string    `json:"asset_id"`
	Symbol    string    `json:"symbol,omitempty"`
	Side      string    `json:"side"` // buy|sell
	Status    string    `json:"status"`
	CashKobo  int64     `json:"cash_kobo"`
	Units     int64     `json:"units"` // asset minor units
	PriceKobo int64     `json:"price_kobo"`
	Reference string    `json:"reference,omitempty"`
	CreatedAt time.Time `json:"created_at"`

	idem string // idempotency key (not serialised; set by the service on a fill)
}

// IdempotencyKey returns the order's idempotency key (used by the repository to
// enforce the unique partial index and detect replays).
func (o Order) IdempotencyKey() string { return o.idem }

// Holding is a per-user, per-asset position projection (asset minor units).
type Holding struct {
	AssetID   string    `json:"asset_id"`
	Symbol    string    `json:"symbol"`
	Units     int64     `json:"units"`      // asset minor units
	ValueKobo int64     `json:"value_kobo"` // marked at latest quote (kobo)
	UpdatedAt time.Time `json:"updated_at"`
}

// unitsForCash converts a NGN cash amount (kobo) to asset minor units at the
// given price, using integer arithmetic only (truncates — never over-credits the
// buyer). priceKobo is per ONE WHOLE unit; scale is minor units per whole unit.
func unitsForCash(cashKobo, priceKobo, scale int64) int64 {
	if priceKobo <= 0 || scale <= 0 {
		return 0
	}
	// units = cashKobo * scale / priceKobo — big.Int intermediate so the
	// cashKobo*scale product cannot silently overflow int64. Fail closed
	// (return 0) on absurd magnitudes rather than wrapping to a wrong value.
	r := new(big.Int).Mul(big.NewInt(cashKobo), big.NewInt(scale))
	r.Quo(r, big.NewInt(priceKobo))
	if !r.IsInt64() {
		return 0
	}
	return r.Int64()
}

// cashForUnits converts asset minor units to a NGN cash amount (kobo) at the
// given price, using integer arithmetic only (truncates).
func cashForUnits(units, priceKobo, scale int64) int64 {
	if scale <= 0 {
		return 0
	}
	// cash = units * priceKobo / scale — big.Int intermediate so units*priceKobo
	// cannot silently overflow int64. Fail closed (return 0) on absurd magnitudes.
	r := new(big.Int).Mul(big.NewInt(units), big.NewInt(priceKobo))
	r.Quo(r, big.NewInt(scale))
	if !r.IsInt64() {
		return 0
	}
	return r.Int64()
}

// Sentinel errors.
var (
	ErrNotFound       = fmt.Errorf("crypto: not found")
	ErrForbidden      = fmt.Errorf("crypto: forbidden")
	ErrAssetInactive  = fmt.Errorf("crypto: asset is not tradable")
	ErrInsufficient   = fmt.Errorf("crypto: insufficient holdings")
	ErrAmountTooSmall = fmt.Errorf("crypto: amount too small for a whole minor unit")
	ErrBadRequest     = fmt.Errorf("crypto: invalid request")
)
