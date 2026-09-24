package ledger

import "fmt"

// AdminTransactionModule describes one module tab on the centralized admin
// Transactions console. Keys match ModuleTransactionDetail.Module — the same
// value a TransactionDetailResolver returns — so a row's resolved module and
// the tab it belongs to are always the same classification, never two
// separate guesses that can drift apart.
//
// This list is DELIBERATELY the same four modules wired in
// backend/internal/app/admin_transaction_resolvers.go. Adding a resolver for
// a fifth module means adding its entry here too — moduleReferenceFilter
// below is what makes a tab's table/chart actually SQL-filter to just that
// module, ahead of running any resolver.
var AdminTransactionModules = []struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}{
	{"marketplace_boost", "Marketplace"},
	{"insurance_premium", "Insurance"},
	{"fx_conversion", "FX"},
	{"utility_bill", "Utility Bills"},
}

// moduleReferenceFilter returns the WHERE clause fragment (using placeholders
// starting at startIndex) and its own bind arguments for narrowing
// ledger_entries to ONE module's reference-naming convention — the exact same
// patterns each TransactionDetailResolver checks before running its query
// (see admin_transaction_resolvers.go). Returns ("", nil) for an unknown or
// empty module key, meaning "no module filter" (the caller must treat that as
// "match everything", not as an error).
func moduleReferenceFilter(module string, startIndex int) (clause string, args []any) {
	switch module {
	case "marketplace_boost":
		return fmt.Sprintf("le.reference LIKE $%d", startIndex), []any{"mkt:boost:%"}
	case "insurance_premium":
		return fmt.Sprintf("le.reference LIKE $%d", startIndex), []any{"insurance:premium:%"}
	case "fx_conversion":
		// Excludes fx:reversal:* — a different posting shape, same as FXConversionResolver.
		return fmt.Sprintf("(le.reference LIKE $%d AND le.reference NOT LIKE $%d)", startIndex, startIndex+1),
			[]any{"fx:%", "fx:reversal:%"}
	case "utility_bill":
		return fmt.Sprintf("le.reference LIKE $%d", startIndex), []any{"UTL-%"}
	default:
		return "", nil
	}
}
