package orchestration

import "strings"

// baseUSDRates expresses 1 USD = N units of the currency (indicative mid-market).
// In production these are sourced live from provider quote aggregation; the table
// is the deterministic fallback used for indicative display and tests.
var baseUSDRates = map[string]float64{
	"USD":  1,
	"NGN":  1598.20,
	"EUR":  0.92,
	"GBP":  0.79,
	"GHS":  14.80,
	"KES":  129.50,
	"XAF":  602.50,
	"ZAR":  18.40,
	"USDC": 1,
	"USDT": 1,
}

// MidRate returns the indicative mid-market rate: units of `to` per 1 unit of
// `from`, triangulated via USD. Returns 0 if either currency is unknown.
func MidRate(from, to string) float64 {
	from, to = strings.ToUpper(from), strings.ToUpper(to)
	if from == to {
		return 1
	}
	f, okF := baseUSDRates[from]
	t, okT := baseUSDRates[to]
	if !okF || !okT || f == 0 {
		return 0
	}
	return t / f
}

// Corridor renders the canonical corridor label, e.g. "USD-NGN".
func Corridor(from, to string) string {
	return strings.ToUpper(from) + "-" + strings.ToUpper(to)
}

// SupportedCurrency reports whether a currency is in the rate table.
func SupportedCurrency(c string) bool {
	_, ok := baseUSDRates[strings.ToUpper(c)]
	return ok
}
