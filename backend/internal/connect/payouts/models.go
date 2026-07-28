// Package connectpayouts implements creator gift-revenue payout requests. A
// creator who has accrued gift revenue in their Paymax wallet requests a payout
// to their settled bank account: the request is KYC/Tier-2+ gated, idempotency-
// keyed, and posts a balanced ledger entry (DR creator wallet, CR settlement)
// before a settlement hook initiates the bank transfer.
//
// Iron rules honoured (root CLAUDE.md "Money handling"):
//   - amounts are integer kobo (BIGINT) — never float/string math;
//   - every payout requires an Idempotency-Key and posts a balanced ledger entry;
//   - tier/KYC gate is enforced server-side, fail-closed, before any debit;
//   - every mutation emits an immutable audit event and is reported to AML.
package connectpayouts

import "time"

// Payout mirrors a row of public.connect_payouts.
type Payout struct {
	ID             string    `json:"id"`
	CreatorID      string    `json:"creator_id"`
	AmountKobo     int64     `json:"amount_kobo"`
	Status         string    `json:"status"`
	DestinationRef *string   `json:"destination_ref,omitempty"`
	IdempotencyKey string    `json:"-"`
	LedgerRef      string    `json:"ledger_ref"`
	SettlementRef  *string   `json:"settlement_ref,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

// RequestPayoutRequest is the body for POST /payouts. The amount is in kobo; the
// destination is a tokenised reference to a previously-verified bank account
// (never raw account details in this request).
type RequestPayoutRequest struct {
	AmountKobo     int64  `json:"amountKobo" binding:"required"`
	DestinationRef string `json:"destinationRef"`
}
