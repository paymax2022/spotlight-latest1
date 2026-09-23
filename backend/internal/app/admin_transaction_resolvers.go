package app

// Concrete per-module admin transaction-detail resolvers, wired into
// ledgerSvc (see finance_routes.go) so the centralized admin Transactions
// console (GET /api/finance/admin/transactions/:id) can show REAL per-module
// detail — Service, Category, Service bought, Payment method, Status,
// Provider — instead of only the generic ledger_entries fields.
//
// Each resolver is scoped to exactly one module's reference-naming
// convention and checks that pattern (cheaply, no query) before running any
// SQL — so trying all of them in sequence on every reference is cheap for the
// ~3 modules per request that don't match.
//
// Read-only. None of these resolvers write anything.

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ── Marketplace — listing boost purchases ───────────────────────────────────
//
// The marketplace's sole live revenue posting after ADR-023 retired escrow
// settlement is the boost charge (mkt_orders/regular P2P escrow posts NO
// ledger_entries rows today — see service_boost.go comment — so it has NO
// resolver here, deliberately). postBoostCharge posts with
// reference == idempotency_key == "mkt:boost:<sellerID>:<listingID>:<tier>:charge",
// and mkt_boosts.ledger_charge_ref stores that same string.
type MarketplaceBoostResolver struct {
	pool *pgxpool.Pool
}

func NewMarketplaceBoostResolver(pool *pgxpool.Pool) *MarketplaceBoostResolver {
	return &MarketplaceBoostResolver{pool: pool}
}

func (r *MarketplaceBoostResolver) Resolve(ctx context.Context, reference string) (*ledger.ModuleTransactionDetail, bool, error) {
	if !strings.HasPrefix(reference, "mkt:boost:") {
		return nil, false, nil
	}
	var tier string
	var durationDays int
	var status string
	err := r.pool.QueryRow(ctx, `
		SELECT tier, duration_days, status::text
		FROM mkt_boosts
		WHERE ledger_charge_ref = $1
		LIMIT 1`, reference).Scan(&tier, &durationDays, &status)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("marketplace boost resolver: %w", err)
	}
	category := tier
	return &ledger.ModuleTransactionDetail{
		Module:        "marketplace_boost",
		ServiceLabel:  "Marketplace — Listing Boost",
		Category:      &category,
		ServiceBought: fmt.Sprintf("Listing boost — %s tier (%d days)", tier, durationDays),
		PaymentMethod: "wallet", // mkt_boosts has no payment_method column — wallet is the only rail
		Status:        status,
		Provider:      nil, // no aggregator/provider concept for a wallet-native boost charge
		Merchant:      nil, // the seller is paying the platform for promotion, not a third party — no merchant here
	}, true, nil
}

// ── Insurance — premium debits ───────────────────────────────────────────────
//
// BindFromQuote posts the premium debit with Reference: "insurance:premium:" + policy.ID.
// Joined via insurance_premium_transaction.wallet_ledger_ref = reference (more
// robust than string-splitting the reference), then to insurance_policy and
// insurance_products for the real display name.
type InsurancePremiumResolver struct {
	pool *pgxpool.Pool
}

func NewInsurancePremiumResolver(pool *pgxpool.Pool) *InsurancePremiumResolver {
	return &InsurancePremiumResolver{pool: pool}
}

func (r *InsurancePremiumResolver) Resolve(ctx context.Context, reference string) (*ledger.ModuleTransactionDetail, bool, error) {
	if !strings.HasPrefix(reference, "insurance:premium:") {
		return nil, false, nil
	}
	var productCode, provider, underwriter, state string
	var displayName *string
	err := r.pool.QueryRow(ctx, `
		SELECT ip.product_code, ip.provider, ip.underwriter, ip.state, prod.display_name
		FROM insurance_premium_transaction ipt
		JOIN insurance_policy ip ON ip.id = ipt.policy_id
		LEFT JOIN insurance_products prod ON prod.code = ip.product_code
		WHERE ipt.wallet_ledger_ref = $1
		LIMIT 1`, reference).Scan(&productCode, &provider, &underwriter, &state, &displayName)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("insurance premium resolver: %w", err)
	}
	serviceBought := productCode
	if displayName != nil && *displayName != "" {
		serviceBought = *displayName
	}
	providerStr := provider
	if underwriter != "" {
		providerStr = fmt.Sprintf("%s (underwriter: %s)", provider, underwriter)
	}
	category := productCode
	return &ledger.ModuleTransactionDetail{
		Module:        "insurance_premium",
		ServiceLabel:  "Insurance — Premium",
		Category:      &category,
		ServiceBought: serviceBought,
		PaymentMethod: "wallet", // no payment_method column on insurance tables — wallet-only
		Status:        state,   // real lifecycle state, not the generic ledger Posted/Reversed
		Provider:      strPtr(providerStr),
		Merchant:      nil, // no merchant concept — Provider/Underwriter cover this module
	}, true, nil
}

// ── FX — currency conversions ────────────────────────────────────────────────
//
// fx.Service.Convert posts with reference := "fx:" + uuid.New().String() and
// stores that SAME reference on the fx_conversions row. Excludes
// "fx:reversal:" references, which are a different posting shape.
type FXConversionResolver struct {
	pool *pgxpool.Pool
}

func NewFXConversionResolver(pool *pgxpool.Pool) *FXConversionResolver {
	return &FXConversionResolver{pool: pool}
}

func (r *FXConversionResolver) Resolve(ctx context.Context, reference string) (*ledger.ModuleTransactionDetail, bool, error) {
	if !strings.HasPrefix(reference, "fx:") || strings.HasPrefix(reference, "fx:reversal:") {
		return nil, false, nil
	}
	var sourceCurrency, targetCurrency, status string
	err := r.pool.QueryRow(ctx, `
		SELECT source_currency, target_currency, status
		FROM fx_conversions
		WHERE reference = $1
		LIMIT 1`, reference).Scan(&sourceCurrency, &targetCurrency, &status)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("fx conversion resolver: %w", err)
	}
	category := fmt.Sprintf("%s→%s", sourceCurrency, targetCurrency)
	return &ledger.ModuleTransactionDetail{
		Module:        "fx_conversion",
		ServiceLabel:  "FX — Currency Conversion",
		Category:      &category,
		ServiceBought: "Currency conversion",
		PaymentMethod: "wallet", // fx_conversions has no payment_method column — wallet source-currency debit
		Status:        status,
		Provider:      nil, // fx_conversions carries no adapter/provider name column — omit rather than guess
		Merchant:      nil,
	}, true, nil
}

// ── Utility Bills — airtime/data/electricity/cable/internet/education ───────
//
// utilitybills service posts the debit with reference := receipt, where
// receipt is utility_transactions.receipt_number (format
// "UTL-YYYYMMDD-XXXXXXXX"). This is the ONE module of the four with a real
// payment_method column (payment_source: wallet | paystack).
type UtilityBillResolver struct {
	pool *pgxpool.Pool
}

func NewUtilityBillResolver(pool *pgxpool.Pool) *UtilityBillResolver {
	return &UtilityBillResolver{pool: pool}
}

func (r *UtilityBillResolver) Resolve(ctx context.Context, reference string) (*ledger.ModuleTransactionDetail, bool, error) {
	if !strings.HasPrefix(reference, "UTL-") {
		return nil, false, nil
	}
	var category, customerReference, paymentSource, status string
	var customerName, billerName, providerName *string
	err := r.pool.QueryRow(ctx, `
		SELECT ut.category, ut.customer_reference, ut.customer_name,
		       ut.payment_source, ut.status,
		       b.name AS biller_name, p.name AS provider_name
		FROM utility_transactions ut
		LEFT JOIN utility_billers b ON b.id = ut.biller_id
		LEFT JOIN utility_providers p ON p.id = ut.provider_id
		WHERE ut.receipt_number = $1
		LIMIT 1`, reference).Scan(&category, &customerReference, &customerName, &paymentSource, &status, &billerName, &providerName)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("utility bill resolver: %w", err)
	}
	serviceBought := customerReference
	if billerName != nil && *billerName != "" {
		serviceBought = fmt.Sprintf("%s — %s", *billerName, customerReference)
	}
	if customerName != nil && *customerName != "" {
		serviceBought = fmt.Sprintf("%s (%s)", serviceBought, *customerName)
	}
	category2 := category
	return &ledger.ModuleTransactionDetail{
		Module:        "utility_bill",
		ServiceLabel:  "Utility Bills",
		Category:      &category2,
		ServiceBought: serviceBought,
		PaymentMethod: paymentSource, // the ONE module with a real, non-wallet-only payment_source column
		Status:        status,
		Provider:      providerName,
		Merchant:      nil,
	}, true, nil
}
