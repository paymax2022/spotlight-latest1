package utilitybills

import "fmt"

// This file ports frontend-web/src/server/utility/pricing.ts (54 lines)
// exactly: resolveUtilityAmount, calculateUtilityPricing and their bps-math
// helpers, including truncation direction.

// floorDivInt64 replicates JS's `Math.floor(numerator / denominator)` for
// integer inputs. Go's native `/` truncates toward zero, which only matches
// Math.floor when both operands are non-negative (or both negative) — a
// direct `numerator / denominator` diverges the moment numerator is negative
// and denominator is positive (e.g. Go: -1/3 == 0; JS: Math.floor(-1/3) ==
// -1). That case is real here: grossProfitKobo (retailAmountKobo -
// providerCostKobo) CAN be negative — a misconfigured/underpriced product
// can legitimately price at a loss — and grossMarginBps divides it by a
// always-positive retailAmountKobo, so a negative-numerator, positive-
// denominator division is reachable in normal operation, not just a
// theoretical edge case. denominator is never zero at either call site
// (10_000 in applyBasisPoints; guarded `retailAmountKobo > 0` in
// CalculateUtilityPricing).
func floorDivInt64(numerator, denominator int64) int64 {
	q := numerator / denominator
	r := numerator % denominator
	if r != 0 && ((r < 0) != (denominator < 0)) {
		q--
	}
	return q
}

// applyBasisPoints mirrors pricing.ts's applyBasisPoints:
//
//	Math.floor((amountKobo * bps) / 10_000)
func applyBasisPoints(amountKobo, bps int64) int64 {
	return floorDivInt64(amountKobo*bps, 10_000)
}

// resolveUtilityAmount mirrors pricing.ts's resolveUtilityAmount: picks the
// product's fixed price, or a caller-supplied amount for a variable
// product; validates it is a positive integer; then clamps it to
// [MinAmountKobo, MaxAmountKobo] when those are set.
func resolveUtilityAmount(product Product, requestedAmountKobo *int64) (int64, error) {
	var amountKobo *int64
	if product.AmountType == AmountTypeFixed {
		amountKobo = product.AmountKobo
	} else {
		amountKobo = requestedAmountKobo
	}
	if amountKobo == nil {
		return 0, ErrAmountRequired
	}
	resolved := *amountKobo

	if resolved <= 0 {
		return 0, fmt.Errorf("%w: got %d", ErrInvalidAmount, resolved)
	}

	if product.MinAmountKobo != nil && resolved < *product.MinAmountKobo {
		return 0, fmt.Errorf("%w: minimum is %d kobo, got %d", ErrAmountBelowMinimum, *product.MinAmountKobo, resolved)
	}

	if product.MaxAmountKobo != nil && resolved > *product.MaxAmountKobo {
		return 0, fmt.Errorf("%w: maximum is %d kobo, got %d", ErrAmountAboveMaximum, *product.MaxAmountKobo, resolved)
	}

	return resolved, nil
}

// CalculateUtilityPricing mirrors pricing.ts's calculateUtilityPricing
// exactly, field for field and in the same order (including computing
// grossMarginBps BEFORE the providerCostKobo<=0 check, matching the TS
// source's statement order — the check does not short-circuit anything
// upstream of it since all fields are pure computations of already-resolved
// values).
func CalculateUtilityPricing(product Product, mapping ProviderMapping, requestedAmountKobo *int64) (Pricing, error) {
	amountKobo, err := resolveUtilityAmount(product, requestedAmountKobo)
	if err != nil {
		return Pricing{}, err
	}

	markupKobo := applyBasisPoints(amountKobo, product.MarkupBps)
	convenienceFeeKobo := product.ConvenienceFeeKobo
	retailAmountKobo := amountKobo + markupKobo + convenienceFeeKobo

	// TS: `mapping.provider_discount_bps || product.provider_discount_bps`.
	// JS `||` treats 0 as falsy, so a mapping-level 0 bps falls back to the
	// product default — this is NOT the same rule as ProviderCostKobo below.
	discountBps := mapping.ProviderDiscountBps
	if discountBps == 0 {
		discountBps = product.ProviderDiscountBps
	}

	// TS: `mapping.provider_cost_kobo ?? amountKobo - applyBasisPoints(...)`.
	// JS `??` (nullish coalescing) only falls back on null/undefined — a
	// mapping-level cost of exactly 0 (or negative) is used VERBATIM, unlike
	// the `||` above. A non-nil pointer, even to 0, must not fall back.
	var providerCostKobo int64
	if mapping.ProviderCostKobo != nil {
		providerCostKobo = *mapping.ProviderCostKobo
	} else {
		providerCostKobo = amountKobo - applyBasisPoints(amountKobo, discountBps)
	}

	grossProfitKobo := retailAmountKobo - providerCostKobo

	var grossMarginBps int64
	if retailAmountKobo > 0 {
		grossMarginBps = floorDivInt64(grossProfitKobo*10_000, retailAmountKobo)
	}

	if providerCostKobo <= 0 {
		return Pricing{}, fmt.Errorf("%w: got %d", ErrProviderCostNotPositive, providerCostKobo)
	}

	return Pricing{
		AmountKobo:         amountKobo,
		MarkupKobo:         markupKobo,
		ConvenienceFeeKobo: convenienceFeeKobo,
		RetailAmountKobo:   retailAmountKobo,
		ProviderCostKobo:   providerCostKobo,
		GrossProfitKobo:    grossProfitKobo,
		GrossMarginBps:     grossMarginBps,
	}, nil
}
