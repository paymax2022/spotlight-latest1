package utilitybills

// Pure port of frontend-web/src/server/commission/config.ts's mapping half —
// utilityCategoryToService + deriveUtilitySubtype and their normalisation
// helpers. Zero I/O, so it is unit-tested directly; the actual commission_config
// LOOKUP is the Go commission module's job (commission.Service.Calculate already
// does the exact-subtype → service-level fallback the TS helper hand-rolled).
//
// Getting the (service, subtype) pair right is not cosmetic: it selects which
// commission_config row prices the transaction, which decides both the
// convenience fee the CUSTOMER pays and the revenue Paymax books. A subtype that
// silently fails to match falls back to the service-level row, which is the
// intended behaviour — but a subtype that matches the WRONG row (e.g. 'Aba'
// matching 'Abuja') would mis-price. That is why the TS source does exact-match
// first and this port keeps that ordering exactly.

import (
	"sort"
	"strings"
)

// CommissionCategory is the service_category every utility earning is filed
// under. Mirrors config.ts's UTILITY_COMMISSION_CATEGORY.
const CommissionCategory = "Utility_Bills"

// categoryToCommissionService mirrors config.ts's CATEGORY_TO_SERVICE. Note
// 'internet' is deliberately ABSENT: it has no seeded commission service, and the
// TS source lets it resolve to null so the caller keeps the legacy
// utility_products-only pricing. Adding it here would silently start pricing
// internet bills off a config row that does not exist.
var categoryToCommissionService = map[Category]string{
	CategoryElectricity: "Electricity",
	CategoryCableTV:     "CableTv",
	CategoryAirtime:     "Airtime",
	CategoryData:        "Data",
	CategoryEducation:   "Education",
}

// commissionSubtypes mirrors config.ts's SERVICE_SUBTYPES (the seeded rows).
var commissionSubtypes = map[string][]string{
	"Airtime": {"9mobile", "MTN", "GLO", "Airtel"},
	"Data":    {"9mobile", "MTN", "GLO", "Airtel", "Smile", "Spectranet"},
	"Electricity": {
		"Abuja", "Aba", "Ikeja", "Eko", "Ibadan", "Yola", "Kano", "Kaduna", "Jos",
		"Enugu", "Benin", "PortHarcourt",
	},
	"CableTv":   {"DSTV", "GoTV", "Startime", "Showmax"},
	"Education": {"WAEC", "NECO", "JAMB"},
}

// CategoryToCommissionService maps a utility category onto its commission
// service name, or "" when the category has none (mirrors the TS `?? null`).
func CategoryToCommissionService(category Category) string {
	return categoryToCommissionService[category]
}

// normalizeToken mirrors config.ts's normalize(): lowercase, then strip every
// character that is not a-z0-9.
func normalizeToken(value string) string {
	var b strings.Builder
	b.Grow(len(value))
	for _, r := range strings.ToLower(value) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// billerCodeToken mirrors config.ts's billerCodeToken(): drop a leading
// "vtpass-" and one trailing category suffix, then normalise. E.g.
// "vtpass-portharcourt-electric" → "portharcourt", "vtpass-dstv" → "dstv".
func billerCodeToken(code string) string {
	trimmed := code
	// TS: .replace(/^vtpass-/i, '')
	if len(trimmed) >= 7 && strings.EqualFold(trimmed[:7], "vtpass-") {
		trimmed = trimmed[7:]
	}
	// TS: .replace(/-(electric|electricity|airtime|data|internet|cabletv|tv|variable)$/i, '')
	for _, suffix := range []string{
		"-electricity", "-electric", "-airtime", "-internet", "-cabletv",
		"-variable", "-data", "-tv",
	} {
		if len(trimmed) > len(suffix) && strings.EqualFold(trimmed[len(trimmed)-len(suffix):], suffix) {
			trimmed = trimmed[:len(trimmed)-len(suffix)]
			break
		}
	}
	return normalizeToken(trimmed)
}

// DeriveCommissionSubtype mirrors config.ts's deriveUtilitySubtype: best-effort
// match of a biller onto one of its service's known subtypes. Returns "" when
// nothing matches, so the caller falls back to the service-level (”) config row.
//
// Two passes, in this order and for this reason:
//
//	Pass 1 — exact normalised equality. Most specific and collision-free.
//	Pass 2 — loose substring either way, longest subtypes first, so a longer and
//	         more specific subtype wins ('Startime' before shorter neighbours).
//
// Inverting those passes would let 'aba' match 'abuja' by substring before the
// exact 'Aba' row was ever considered — the exact case the TS comment calls out.
func DeriveCommissionSubtype(service, billerCode, billerName string) string {
	subtypes := commissionSubtypes[service]
	if len(subtypes) == 0 {
		return ""
	}

	tokens := make([]string, 0, 2)
	for _, t := range []string{billerCodeToken(billerCode), normalizeToken(billerName)} {
		if t != "" {
			tokens = append(tokens, t)
		}
	}

	// Pass 1: exact normalised equality.
	for _, token := range tokens {
		for _, subtype := range subtypes {
			if normalizeToken(subtype) == token {
				return subtype
			}
		}
	}

	// Pass 2: loose contains, longest subtypes first.
	byLengthDesc := append([]string(nil), subtypes...)
	sort.SliceStable(byLengthDesc, func(i, j int) bool {
		return len(normalizeToken(byLengthDesc[i])) > len(normalizeToken(byLengthDesc[j]))
	})
	for _, token := range tokens {
		for _, subtype := range byLengthDesc {
			sub := normalizeToken(subtype)
			if sub == "" {
				continue
			}
			if strings.Contains(token, sub) || strings.Contains(sub, token) {
				return subtype
			}
		}
	}

	return ""
}

// ApplyCommissionConvenienceFee ports service.ts's applyCommissionConvenienceFee.
//
// When an active commission_config row prices this (service, subtype) with a
// DIFFERENT convenience fee from the one on utility_products, the config wins and
// the pricing is re-derived around it. When the fee is unchanged — the current
// seeded case for every category — the pricing is returned byte-identical, so
// amounts do not move unless a config row deliberately differs.
//
// Only the three fields that actually depend on the fee move: retail, gross
// profit, and the margin recomputed from them. AmountKobo / MarkupKobo /
// ProviderCostKobo are upstream of the fee and are left exactly as priced.
func ApplyCommissionConvenienceFee(pricing Pricing, configConvenienceFeeKobo int64, hasConfig bool) Pricing {
	if !hasConfig {
		return pricing
	}
	if configConvenienceFeeKobo == pricing.ConvenienceFeeKobo {
		return pricing
	}

	delta := configConvenienceFeeKobo - pricing.ConvenienceFeeKobo
	out := pricing
	out.ConvenienceFeeKobo = configConvenienceFeeKobo
	out.RetailAmountKobo = pricing.RetailAmountKobo + delta
	out.GrossProfitKobo = pricing.GrossProfitKobo + delta
	out.GrossMarginBps = 0
	if out.RetailAmountKobo > 0 {
		// Same floor-division helper the original pricing used, so a negative gross
		// profit truncates in the same direction here as it does there.
		out.GrossMarginBps = floorDivInt64(out.GrossProfitKobo*10_000, out.RetailAmountKobo)
	}
	return out
}
