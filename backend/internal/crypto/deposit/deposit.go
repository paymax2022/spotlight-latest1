// Package deposit settles inbound crypto transfers into customer balances.
//
// It is the money-IN path that the trading surface (buy/sell/swap/withdrawal) has
// never had: a provider-observed on-chain transfer must become a customer crypto-unit
// credit exactly once, only after enough network confirmations, only to the account
// that actually owns the receiving subaccount, and recorded as an immutable
// double-entry leg.
//
// Design (Option A, approved 2026-10-21): the balance is held in ONE authoritative
// plane — the existing crypto_holdings projection — and every credit is backed by an
// append-only journal keyed on the provider's deposit operation id. We do NOT create a
// second balance table (that would fork the source of truth and split-brain the
// portfolio) and we do NOT touch the fiat finance/ledger plane (its currency column is
// kobo/3-char and has no per-asset scale). The journal + holdings upsert happen in one
// transaction, mirroring crypto.Repository.RecordFill.
package deposit

// Status is the provider-reported state of an inbound transfer.
type Status string

const (
	StatusPending   Status = "pending"   // seen, not yet final
	StatusConfirmed Status = "confirmed" // reached the network's finality
	StatusReorged   Status = "reorged"   // was credited, then orphaned by a chain reorg
	StatusFailed    Status = "failed"    // terminal failure, funds did not land
)

// Credit is one inbound transfer as reported by the provider. It carries no
// caller-trusted recipient: the owner is resolved server-side from the provider
// sub-account, so a spoofed recipient cannot redirect funds (cross-tenant isolation by
// construction). Units are integer asset minor units (never a float).
type Credit struct {
	Provider          string // provider name, e.g. "quidax"
	ProviderAccountID string // the custodial sub-account that received the transfer
	ProviderOpID      string // provider's unique deposit operation id — the idempotency anchor
	Symbol            string // asset symbol, e.g. "BTC", "USDT"
	Network           string // chain/network, e.g. "bitcoin", "tron"
	Address           string // receiving address on that network
	Units             int64  // amount in asset minor units, must be > 0 to credit
	Confirmations     int    // blocks confirmed so far
	Status            Status // terminal state reported by the provider
	TxHash            string // on-chain reference, stored for audit/receipt
}

// Outcome classifies what settlement decided for a Credit.
type Outcome string

const (
	OutcomeSettled   Outcome = "settled"    // first time: balance credited, journal written
	OutcomeDuplicate Outcome = "duplicate"  // this ProviderOpID was already settled; no change
	OutcomeAwaiting  Outcome = "awaiting"   // below the confirmation threshold; not credited yet
	OutcomeUnmapped  Outcome = "unmapped"   // no owner for that sub-account — parked for review
	OutcomeRejected  Outcome = "rejected"   // bad amount / non-final status — never credited
)

// Result is the decision plus the account credited (empty unless Settled/Duplicate).
type Result struct {
	Outcome Outcome
	UserID  string // resolved owner of ProviderAccountID
	AssetID string // resolved crypto_assets.id
	Reason  string // human-readable detail for Awaiting/Unmapped/Rejected and audit
}
