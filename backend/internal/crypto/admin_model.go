package crypto

import "time"

// This file defines the admin-oversight view models that back the crypto admin
// console (frontend-admin/app/admin/crypto/{withdrawals,swaps,addresses,
// reconciliation}). They are thin projections over the existing crypto tables —
// no new persisted state. Fields the schema does not yet back (review_status,
// screening_result, aml_flags, value_kobo, drift) are DERIVED here from columns
// that DO exist, so the console renders truthfully off real rows. Money is always
// integer minor units (kobo for cash; asset minor units for holdings).

// AdminWithdrawal is a withdrawal enriched for the AML review queue: it adds the
// server-computed fiat value (units × price_kobo / minor_unit_scale) that the
// console shows, plus a lightweight AML flag set derived from the row itself. The
// authoritative state machine lives on the member path; the admin queue only drives
// the requested→pending (approve) / requested→failed (reject) transitions.
type AdminWithdrawal struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	AssetID         string    `json:"asset_id"`
	Symbol          string    `json:"symbol"`
	AddressID       string    `json:"address_id"`
	Address         string    `json:"address,omitempty"`
	Network         string    `json:"network,omitempty"`
	Status          string    `json:"status"`
	Units           int64     `json:"units"`
	NetworkFeeUnits int64     `json:"network_fee_units"`
	FeeKobo         int64     `json:"fee_kobo"`
	PriceKobo       int64     `json:"price_kobo"`
	ValueKobo       int64     `json:"value_kobo"` // units × price_kobo / minor_unit_scale
	Provider        string    `json:"provider"`
	ProviderRef     string    `json:"provider_ref,omitempty"`
	TxHash          string    `json:"tx_hash,omitempty"`
	FailureReason   string    `json:"failure_reason,omitempty"`
	Reference       string    `json:"reference,omitempty"`
	AmlFlags        []string  `json:"aml_flags"`
	AmlScore        int       `json:"aml_score"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// AdminAddress is an allow-list entry enriched with a derived review verdict. The
// crypto_addresses table has no dedicated review column yet, so review_status is
// derived from (is_active, verified_at):
//
//	is_active=true                      → approved (usable as a withdrawal target)
//	is_active=false AND verified_at NULL → pending  (awaiting compliance review)
//	is_active=false AND verified_at set  → rejected (reviewed and blocked)
//
// TODO(crypto-admin): if the product needs a first-class address review workflow
// (distinct "pending" vs "auto-active on add"), add a review_status column in an
// additive migration and stop deriving. Today AddAddress activates on insert, so
// most rows read as "approved"; the derivation keeps the console honest without
// schema change.
type AdminAddress struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	AssetID         string     `json:"asset_id"`
	Symbol          string     `json:"symbol,omitempty"`
	Label           string     `json:"label"`
	Network         string     `json:"network"`
	Address         string     `json:"address"`
	IsActive        bool       `json:"is_active"`
	ReviewStatus    string     `json:"review_status"`
	ScreeningResult string     `json:"screening_result,omitempty"`
	VerifiedAt      *time.Time `json:"verified_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

// Admin address review verdicts (derived; mirror the frontend union).
const (
	AddressReviewPending  = "pending"
	AddressReviewApproved = "approved"
	AddressReviewRejected = "rejected"
)

// deriveAddressReview maps (is_active, verified_at) → a review verdict.
func deriveAddressReview(isActive bool, verifiedAt *time.Time) string {
	if isActive {
		return AddressReviewApproved
	}
	if verifiedAt != nil {
		return AddressReviewRejected
	}
	return AddressReviewPending
}

// Reconciliation per-asset statuses.
//   - ok      : a custody feed exists AND onchain_units == ledger_units.
//   - drift   : a custody feed exists AND onchain_units != ledger_units (a break).
//   - no_feed : no custody row stored for this asset yet — reported distinctly so a
//     missing feed is never mistaken for a healthy "ok", and NOT counted
//     as a break.
const (
	ReconStatusOK     = "ok"
	ReconStatusDrift  = "drift"
	ReconStatusNoFeed = "no_feed"
)

// ReconRow is one asset's on-chain-vs-ledger drift line. ledger_units is the sum
// of the holding projections PLUS units parked in non-terminal withdrawals (both
// are "owed" on-chain). onchain_units is the STORED custodian-reported balance from
// crypto_onchain_balances (fed by the custody-webhook seam). When no custody row
// exists the status is "no_feed" (onchain_units 0, drift 0, not a break); when it
// exists, drift = onchain_units − ledger_units and any non-zero drift is a break.
// onchain_source / onchain_as_of carry the custody provenance for the console.
type ReconRow struct {
	AssetID        string     `json:"asset_id"`
	Symbol         string     `json:"symbol"`
	MinorUnitScale int64      `json:"minor_unit_scale"`
	LedgerUnits    int64      `json:"ledger_units"`
	OnchainUnits   int64      `json:"onchain_units"`
	DriftUnits     int64      `json:"drift_units"`
	PriceKobo      int64      `json:"price_kobo"`
	Status         string     `json:"status"` // ok|drift|no_feed
	OnchainSource  string     `json:"onchain_source,omitempty"`
	OnchainAsOf    *time.Time `json:"onchain_as_of,omitempty"`
	LastCheckedAt  time.Time  `json:"last_checked_at"`
}

// ReconSummary is the reconciliation response envelope (matches the frontend
// CryptoReconSummary: {rows, breaks, as_of}).
type ReconSummary struct {
	Rows   []ReconRow `json:"rows"`
	Breaks int        `json:"breaks"`
	AsOf   time.Time  `json:"as_of"`
}
