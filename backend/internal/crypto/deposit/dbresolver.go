package deposit

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ConfirmationPolicy decides how many network confirmations make a transfer final for a
// given asset+network. It is intentionally separate from the provider: required counts
// are a risk decision, not something to trust from the event.
type ConfirmationPolicy interface {
	Required(symbol, network string) int
}

// StaticPolicy is a network-keyed table with a safe default. High-value chains (bitcoin)
// want more confirmations than the default; anything unlisted uses it.
type StaticPolicy struct {
	ByNetwork map[string]int
	Default   int
}

func (p StaticPolicy) Required(_, network string) int {
	if n, ok := p.ByNetwork[network]; ok {
		return n
	}
	if p.Default > 0 {
		return p.Default
	}
	return 1
}

// DBResolver maps a provider sub-account to its owner via crypto_accounts, and the asset
// symbol to an active crypto_assets row. Unknown sub-account, inactive/unknown asset, or
// an ambiguous account row all resolve to ok=false so the Settler parks the deposit and
// credits NOBODY — the recipient is never taken from the (untrusted) event.
type DBResolver struct {
	pool *pgxpool.Pool
	conf ConfirmationPolicy
}

func NewDBResolver(pool *pgxpool.Pool, conf ConfirmationPolicy) *DBResolver {
	return &DBResolver{pool: pool, conf: conf}
}

func (r *DBResolver) Resolve(ctx context.Context, c Credit) (Owner, bool, error) {
	var userID string
	err := r.pool.QueryRow(ctx,
		`SELECT user_id FROM crypto_accounts WHERE provider=$1 AND provider_account_id=$2 LIMIT 1`,
		c.Provider, c.ProviderAccountID).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Owner{}, false, nil // orphan sub-account: credit nobody
	}
	if err != nil {
		return Owner{}, false, err // genuine dependency failure → caller retries
	}

	var assetID string
	var scale int64
	err = r.pool.QueryRow(ctx,
		`SELECT id, minor_unit_scale FROM crypto_assets WHERE symbol=$1 AND is_active LIMIT 1`,
		c.Symbol).Scan(&assetID, &scale)
	if errors.Is(err, pgx.ErrNoRows) {
		return Owner{}, false, nil // unknown/inactive asset: park, do not mint into nothing
	}
	if err != nil {
		return Owner{}, false, err
	}

	return Owner{
		UserID:         userID,
		AssetID:        assetID,
		MinorUnitScale: scale,
		RequiredConfs:  r.conf.Required(c.Symbol, c.Network),
	}, true, nil
}
