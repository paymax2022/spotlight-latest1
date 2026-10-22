package deposit

import "context"

// Owner is the platform-side resolution of a provider sub-account + asset: which user
// gets credited, which crypto_assets row holds the balance, how many confirmations the
// network requires before the transfer is final, and the asset's minor-unit scale.
type Owner struct {
	UserID        string
	AssetID       string
	MinorUnitScale int64
	RequiredConfs int
}

// OwnerResolver maps a Credit's provider sub-account + symbol + network to its owner.
//
// It returns ok=false when the sub-account is unknown/orphaned — the Settler then parks
// the deposit as Unmapped and credits nobody. It must return an error only for a genuine
// dependency failure (DB/registry down), never for "not found" (that is ok=false):
// a resolver error must not be silently treated as a rejection of a real deposit, and a
// not-found must not be treated as a transient outage.
type OwnerResolver interface {
	Resolve(ctx context.Context, c Credit) (Owner, bool, error)
}
