package ledger

import "context"

// ModuleTransactionDetail is the REAL, per-module view of a ledger_entries
// row — the concrete "what was this money for" answer that the generic
// ledger fields (amount, reference, account type) cannot give on their own.
// It is produced by a TransactionDetailResolver (see below) that knows how
// to look up ONE module's domain tables from the entry's reference string.
type ModuleTransactionDetail struct {
	Module        string  `json:"module"`         // e.g. "marketplace_boost", "insurance_premium", "fx_conversion", "utility_bill"
	ServiceLabel  string  `json:"service_label"`  // human label, e.g. "Marketplace — Listing Boost"
	Category      *string `json:"category"`
	ServiceBought string  `json:"service_bought"` // specific description of what was bought
	PaymentMethod string  `json:"payment_method"` // real value if the module tracks it, else honestly "wallet" (never invent "card" etc. without a real column backing it)
	Status        string  `json:"status"`         // the REAL per-module status, not the generic ledger Posted/Reversed
	Provider      *string `json:"provider"`       // aggregator/underwriter/provider name, when applicable
	Merchant      *string `json:"merchant"`       // a real peer merchant/seller, ONLY when the module genuinely has one
}

// TransactionDetailResolver knows how to resolve ONE module's real
// transaction detail from a ledger_entries reference string. Multiple
// resolvers are tried in order by AdminGetTransaction; each resolver decides
// for itself (cheaply, before running any query) whether the reference
// matches its module's naming pattern.
type TransactionDetailResolver interface {
	// Resolve returns (detail, true, nil) on a match, (nil, false, nil) when
	// this resolver's reference pattern doesn't match (not an error — try
	// the next resolver), or (nil, false, err) on a real query failure.
	Resolve(ctx context.Context, reference string) (*ModuleTransactionDetail, bool, error)
}
