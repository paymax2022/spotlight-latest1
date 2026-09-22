package provider

import (
	"context"
	"encoding/json"
	"errors"
)

// ErrProviderRefused marks an error that is a DEFINITE negative: either the
// provider answered and refused, or the adapter refused pre-flight and never sent
// anything at all (missing credentials, unsupported operation). Either way NOTHING
// was created upstream, so a retry — or a failover to the next provider — is safe.
//
// This exists because the opposite case is the dangerous one. A transport failure
// (timeout, reset connection, context deadline) does NOT say whether the request
// was processed: the provider may still be completing it after our socket gave up.
// Callers on a money path classify with errors.Is(err, ErrProviderRefused) and
// treat everything UNRECOGNISED as an unknown outcome to be reconciled, never as a
// failure to retry. Silence is never read as success or as failure.
//
// Adapters must wrap this ONLY around errors they can positively vouch for.
var ErrProviderRefused = errors.New("provider: request refused, nothing was created upstream")

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

// BillValidationRequest asks a provider to confirm that a customer reference (a
// meter number, a smartcard number, a customer id) actually exists at the biller
// before any money moves.
//
// Params uses the SAME key names as BillRequest.Params so a caller can build one
// map and use it for both calls — see the vtpass adapter's Params contract.
type BillValidationRequest struct {
	Type              string // category, e.g. "electricity"
	CustomerReference string // the meter / smartcard / customer id being verified
	Params            map[string]string
}

// BillValidation is a normalised customer-verification result.
type BillValidation struct {
	// Valid is the ONLY field a money path may branch on. A provider that cannot
	// verify (unsupported category, missing credentials) reports Valid=true with a
	// Message explaining that verification was skipped — refusing a purchase
	// because a provider has no verification endpoint would be wrong.
	Valid bool
	// CustomerName is the biller's name for the account, shown back to the member
	// as a "paying: <name>" confirmation. Empty when the provider returns none.
	CustomerName string
	// Message is a human-readable explanation, surfaced on a failed validation.
	Message string
	// Raw is the provider's raw response, kept for audit/debugging. Never parsed
	// by callers.
	Raw json.RawMessage
}

// BillsValidator is the OPTIONAL customer-verification half of a bills provider.
// It is deliberately a separate interface from BillsProvider rather than extra
// methods on it: not every bills provider can verify a customer (Maplerad's bills
// API has no equivalent), and widening BillsProvider would force every
// implementer to carry a method it cannot honour. Callers type-assert for it and
// skip verification when a provider does not implement it.
type BillsValidator interface {
	ValidateCustomer(ctx context.Context, req BillValidationRequest) (*BillValidation, error)
	Name() string
}

// HealthCheckResult is a provider's self-reported liveness, normalised across
// adapters. Status is one of "healthy" | "degraded" | "down", matching the
// contract in frontend-web/src/server/utility/adapters/types.ts
// (`healthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'down'; message?: string }>`)
// and the utility_providers_health_status_check CHECK constraint, which also
// permits 'unknown' — the value a provider carries BEFORE it has ever been
// checked, and therefore one no adapter ever returns.
//
// The three values are deliberately not a Go enum type: they are persisted
// verbatim into utility_providers.health_status, and routing.go already branches
// on that column's string values (`health_status != 'down'`).
type HealthCheckResult struct {
	// Status is the only field a caller may branch on.
	Status string
	// Message is human-readable detail for the admin console — a balance on a
	// healthy check, the provider's own response_description on a degraded one,
	// the transport error on a down one. Never machine-parsed.
	Message string
}

// HealthChecker is the OPTIONAL liveness half of a bills provider, split out for
// exactly the same reason as BillsValidator: not every adapter has an endpoint
// that can report its own health, and widening BillsProvider would force every
// implementer to carry a method it cannot honour. Callers type-assert for it.
//
// An implementation must NOT return an error for a provider that answered
// badly — a refused or unparseable answer is a "degraded"/"down" RESULT, not a
// Go error. An error is reserved for the adapter being unable to ask at all
// (missing credentials, a malformed request it refused to send).
type HealthChecker interface {
	HealthCheck(ctx context.Context) (*HealthCheckResult, error)
	Name() string
}
