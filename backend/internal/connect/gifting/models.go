// Package connectgifting implements Paymax Connect wallet-to-wallet real-Naira
// gifts: a sender debits their Paymax wallet and the recipient's wallet is
// credited, via the finance ledger (balanced double-entry, idempotent,
// tier-checked, audited). Money is NEVER mutated here directly and no balance
// column is ever written — balances stay derived projections of the ledger.
//
// Iron rules honoured (root CLAUDE.md "Money handling"):
//   - amounts are integer kobo (BIGINT) — never float/string math;
//   - every gift requires an Idempotency-Key and posts a balanced ledger entry;
//   - tier limits are enforced server-side, fail-closed, before any debit;
//   - every mutation emits an immutable audit event;
//   - a financial-solicitation flag hook is invoked so AML monitoring sees gifts.
package connectgifting

import "time"

// Gift mirrors a row of public.connect_gifts (immutable transfer record).
type Gift struct {
	ID             string    `json:"id"`
	SenderID       string    `json:"sender_id"`
	RecipientID    string    `json:"recipient_id"`
	GiftCode       *string   `json:"gift_code,omitempty"` // catalogue code, when a catalogue gift
	AmountKobo     int64     `json:"amount_kobo"`
	Message        *string   `json:"message,omitempty"`
	Status         string    `json:"status"`
	IdempotencyKey string    `json:"-"` // never serialised to clients
	LedgerRef      string    `json:"ledger_ref"`
	CreatedAt      time.Time `json:"created_at"`
}

// CatalogItem mirrors a row of public.connect_gift_catalog (backend-owned).
// Prices come from the DB, never the client.
type CatalogItem struct {
	ID         string  `json:"id"`
	Code       string  `json:"code"`
	Name       string  `json:"name"`
	IconRef    *string `json:"icon_ref,omitempty"`
	AmountKobo int64   `json:"amount_kobo"`
	Active     bool    `json:"active"`
}

// SendGiftRequest is the body for POST /gifts. Exactly one of GiftID (catalogue
// code) or AmountKobo (custom amount) is used; the server resolves the price
// from the catalogue when a code is given — never trusting a client amount for a
// catalogue gift.
type SendGiftRequest struct {
	RecipientID string `json:"recipientId" binding:"required"`
	GiftID      string `json:"giftId"`     // catalogue code; empty for a custom amount
	AmountKobo  int64  `json:"amountKobo"` // custom kobo amount; 0 when giftId is set
	Message     string `json:"message"`
}
