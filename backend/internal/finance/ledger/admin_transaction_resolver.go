package ledger

import "context"

// ModuleTransactionDetail is the REAL, per-module view of a ledger_entries
// row — the concrete "what was this money for" answer that the generic
// ledger fields (amount, reference, account type) cannot give on their own.
// It is produced by a TransactionDetailResolver (see below) that knows how
// to look up ONE module's domain tables from the entry's reference string.
//
// Field taxonomy (module hierarchy, agreed 2026-09-18): ServicePurchased is
// the MODULE ("Utility Bills", "Insurance", "FX", "Marketplace").
// SubService is the category WITHIN that module ("Airtime", "Premium
// Payment", "Currency Conversion", "Listing Boost"). Category is the
// biller/provider/brand the customer transacted with ("MTN", "AXA
// Mansard") — nil when the module has no such concept. SubCategory is the
// specific product/variant bought ("MTN Airtime ₦500", a specific insurance
// product) — nil when no finer-grained real column backs it. Never fabricate
// any of these four beyond what the module's own tables actually record.
type ModuleTransactionDetail struct {
	Module           string  `json:"module"`            // e.g. "marketplace_boost", "insurance_premium", "fx_conversion", "utility_bill"
	ServicePurchased string  `json:"service_purchased"` // human label for the MODULE, e.g. "Utility Bills"
	SubService       string  `json:"sub_service"`       // the category within the module, e.g. "Airtime"
	Category         *string `json:"category"`          // biller/provider/brand, e.g. "MTN" — nil if the module has none
	SubCategory      *string `json:"sub_category"`      // the specific product/variant, e.g. "MTN Airtime ₦500" — nil if not resolvable
	ServiceBought    string  `json:"service_bought"`    // full description of what was bought (customer reference, name, etc.)
	PaymentMethod    string  `json:"payment_method"`    // real value if the module tracks it, else honestly "wallet" (never invent "card" etc. without a real column backing it)
	Status           string  `json:"status"`            // the REAL per-module status, not the generic ledger Posted/Reversed
	Provider         *string `json:"provider"`          // aggregator/underwriter/provider name, when applicable
	Merchant         *string `json:"merchant"`          // a real peer merchant/seller, ONLY when the module genuinely has one
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
