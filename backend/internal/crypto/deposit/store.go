package deposit

import "context"

// Apply is the once-only mutation the Store performs for a confirmed Credit. It carries
// the full inbound-transfer context so the crypto_deposits row is a complete, auditable
// record of the money-IN event, not just a delta.
type Apply struct {
	Provider          string
	ProviderAccountID string
	ProviderOpID      string // idempotency anchor; UNIQUE in the journal
	UserID            string // resolved owner
	AssetID           string // resolved crypto_assets.id
	Symbol            string
	Network           string
	Address           string
	Units             int64
	Confirmations     int
	RequiredConfs     int
	TxHash            string
}

// Store is the persistence seam. The real implementation posts the credit and an
// append-only journal row in a single transaction over crypto_holdings + a new
// crypto_deposits table (mirroring crypto.Repository.RecordFill's id-on-conflict-then-
// apply-holding pattern). It MUST be safe to call twice with the same ProviderOpID:
// the second call returns OutcomeDuplicate and changes no balance.
type Store interface {
	ApplyCredit(ctx context.Context, a Apply) (Outcome, error)
}
