package provider

import (
	"context"
	"encoding/json"
)

// Additive gateway ports for the Maplerad WaaS integration (ADR-012). These sit
// alongside PaymentProvider / DisbursementProvider / VirtualAccountProvider
// (interfaces.go) — domain code depends ONLY on these ports; all Maplerad HTTP/SDK
// code lives in internal/provider/maplerad and never leaks its types outward.
//
// NGN v1 scope: Identity (customer mapping), Wallet (provision + reconciliation
// balance), Bills. USD wallets / cards / FX are Phase 2 and intentionally absent.

// ─────────────────────────────────────────────────────────────────────────────
// Identity — 1 Paymax user ↔ 1 provider customer, created at the required KYC tier.
// ─────────────────────────────────────────────────────────────────────────────

// CustomerRequest forwards the already-KYC-verified identity to the provider.
// BVN/NIN are PII — never log them; the adapter sends them to Identity only.
type CustomerRequest struct {
	UserID    string
	FirstName string
	LastName  string
	Email     string
	Phone     string
	BVN       string
	NIN       string
	Country   string // ISO-2, "NG" in v1
}

// Customer is the provider-side customer record (domain model, not a provider DTO).
type Customer struct {
	ID        string // provider customer id (persist as provider_customers.customer_id)
	FirstName string
	LastName  string
	Email     string
	Status    string
}

// IdentityProvider maps a Paymax user to a provider customer. Capability is gated
// by the existing KYC tier BEFORE this is called — this is downstream of the gate.
type IdentityProvider interface {
	CreateCustomer(ctx context.Context, req CustomerRequest) (*Customer, error)
	GetCustomer(ctx context.Context, customerID string) (*Customer, error)
	Name() string
}

// ─────────────────────────────────────────────────────────────────────────────
// Wallet — provider custody wallet. GetProviderBalance is for RECONCILIATION ONLY;
// the hot path always reads the internal ledger, never the provider balance.
// ─────────────────────────────────────────────────────────────────────────────

// ProviderBalance is a custody balance snapshot used only by reconciliation.
type ProviderBalance struct {
	WalletID   string
	Currency   string
	AmountKobo int64 // integer minor units (kobo); never float
}

// WalletProvider provisions and reads the provider custody wallet.
type WalletProvider interface {
	ProvisionWallet(ctx context.Context, customerID, currency string) (walletID string, err error)
	GetProviderBalance(ctx context.Context, walletID string) (*ProviderBalance, error)
	Name() string
}

// ─────────────────────────────────────────────────────────────────────────────
// Bills — async-authoritative: reconcile the sync result with the webhook,
// idempotent on the client reference.
// ─────────────────────────────────────────────────────────────────────────────

// BillRequest is a bill purchase keyed by a client reference (idempotency key).
type BillRequest struct {
	Ref        string // client reference = ledger posting reference
	Type       string // e.g. "airtime", "electricity"
	AmountKobo int64
	Params     map[string]string
}

// Bill is the resolved bill purchase (domain model).
type Bill struct {
	Ref         string
	ProviderRef string
	Type        string
	Status      string // PENDING | SUCCESS | FAILED
	AmountKobo  int64
	// Token is the provider-issued delivery artifact, when the bill type
	// produces one (a prepaid electricity token is the actual deliverable —
	// dropping it here would silently strand the customer with a paid-for,
	// undeliverable purchase). Empty for bill types with no token (airtime,
	// data, cable TV subscriptions).
	Token string
	// Message is a human-readable status/result message from the provider,
	// surfaced to support tooling and customer-facing status text.
	Message string
	// Raw is the provider's raw response payload, kept for audit/debugging.
	// Never parsed by callers — if a field matters, it belongs above.
	Raw json.RawMessage
}

// BillsProvider purchases bills and re-queries them (orphan reconciliation).
//
// GetBill's ref MUST be the value returned as the prior Bill.ProviderRef (the
// reference the provider itself echoed back at purchase time), never the
// caller's own BillRequest.Ref. This is the one identifier every provider is
// guaranteed to accept a lookup by — some providers (e.g. VTpass) have no
// "look up by an arbitrary client reference" capability at all, since their
// requery endpoint only recognizes the exact request identifier it was given
// at purchase time.
type BillsProvider interface {
	PurchaseBill(ctx context.Context, req BillRequest) (*Bill, error)
	GetBill(ctx context.Context, ref string) (*Bill, error)
	Name() string
}
