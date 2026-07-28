package orchestration

import "strings"

// CurrencyInfo is one row of the currency master (spec TS-1): ISO-4217 identity
// plus the minor-unit precision the platform must respect on every amount.
type CurrencyInfo struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	Symbol   string `json:"symbol"`
	Exponent int    `json:"exponent"` // minor-unit decimal places (USD=2, JPY=0, KWD=3, BTC=8)
	Kind     string `json:"kind"`     // fiat | stablecoin | crypto
}

// currencyRegistry is the authoritative currency master. Exponents follow
// ISO-4217 for fiat; stablecoins/crypto use their native precision. This is the
// single source of truth for per-currency precision (CU-002) — money math reads
// its exponent here rather than assuming 2dp everywhere.
var currencyRegistry = map[string]CurrencyInfo{
	"USD":  {"USD", "US Dollar", "$", 2, "fiat"},
	"EUR":  {"EUR", "Euro", "€", 2, "fiat"},
	"GBP":  {"GBP", "Pound Sterling", "£", 2, "fiat"},
	"NGN":  {"NGN", "Nigerian Naira", "₦", 2, "fiat"},
	"GHS":  {"GHS", "Ghanaian Cedi", "₵", 2, "fiat"},
	"KES":  {"KES", "Kenyan Shilling", "KSh", 2, "fiat"},
	"ZAR":  {"ZAR", "South African Rand", "R", 2, "fiat"},
	"XAF":  {"XAF", "Central African CFA Franc", "FCFA", 0, "fiat"}, // ISO-4217: 0 minor units
	"JPY":  {"JPY", "Japanese Yen", "¥", 0, "fiat"},
	"KWD":  {"KWD", "Kuwaiti Dinar", "KD", 3, "fiat"},
	"BHD":  {"BHD", "Bahraini Dinar", "BD", 3, "fiat"},
	"USDC": {"USDC", "USD Coin", "USDC", 2, "stablecoin"}, // display-normalized to 2
	"USDT": {"USDT", "Tether", "USDT", 2, "stablecoin"},
	"BTC":  {"BTC", "Bitcoin", "₿", 8, "crypto"},
	"ETH":  {"ETH", "Ether", "Ξ", 8, "crypto"},
}

// CurrencyMeta returns the registry entry for a currency (and whether it exists).
func CurrencyMeta(code string) (CurrencyInfo, bool) {
	c, ok := currencyRegistry[strings.ToUpper(code)]
	return c, ok
}

// SupportedCurrencies returns the currency master as a stable-order-free slice for
// the currency-list endpoint (CU-001). Callers that need order should sort.
func SupportedCurrencies() []CurrencyInfo {
	out := make([]CurrencyInfo, 0, len(currencyRegistry))
	for _, c := range currencyRegistry {
		out = append(out, c)
	}
	return out
}
