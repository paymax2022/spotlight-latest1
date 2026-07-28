package crypto

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"
)

// WithdrawalProvider is the pluggable on-chain broadcast seam. It mirrors the
// PaymentProvider (Paystack adapter) pattern used elsewhere in the codebase: the
// crypto service depends only on this interface, and a concrete adapter (mock,
// manual-desk, or a real custody API such as Fireblocks/BitGo) is injected via
// Register. There is NO real on-chain broadcast in this build — the mock adapter
// returns a deterministic provider reference + tx hash so the withdrawal STATE
// MACHINE and LEDGER are real and exercisable end-to-end. Swap the adapter to go
// live; the service, state machine, ledger postings and audit trail are unchanged.
//
// Provider seam contract:
//   - Broadcast is the only outbound side effect. It is called exactly once per
//     withdrawal on the requested→pending→broadcast transition, and it must be
//     effectively idempotent on providerIdemKey (a duplicate returns the same ref).
//   - A provider MUST NOT mutate ledger or holdings — the service owns money moves.
//   - ConfirmationTarget lets a reconciliation worker decide when broadcast→confirmed.
type WithdrawalProvider interface {
	// Broadcast submits a withdrawal to the network/custodian. It returns a stable
	// provider reference and (optionally) a tx hash. providerIdemKey is the withdrawal
	// idempotency key so the adapter can dedupe retries. A returned error keeps the
	// withdrawal in `pending` (fail-open for retry) — the service does NOT burn units
	// until a broadcast succeeds.
	Broadcast(ctx context.Context, req BroadcastRequest) (BroadcastRequestResult, error)
	// Name identifies the provider for persistence/audit.
	Name() string
}

// BroadcastRequest is the provider-agnostic broadcast request.
type BroadcastRequest struct {
	WithdrawalID    string
	Symbol          string
	Network         string
	Address         string
	Units           int64 // asset minor units to send (net of network fee)
	MinorUnitScale  int64 // minor units per one whole asset (to format the amount); 0 = unknown
	ProviderIdemKey string
}

// BroadcastRequestResult is the provider's response.
type BroadcastRequestResult struct {
	ProviderRef string
	TxHash      string
	// Accepted=false means the provider explicitly rejected (e.g. address screening
	// failed on the custodian side) — the service moves the withdrawal to `failed`
	// and returns the parked units to the holding.
	Accepted bool
}

// mockWithdrawalProvider is the default no-network adapter. It deterministically
// derives a provider reference and tx hash from the withdrawal id so runs are
// reproducible and idempotent. It always accepts — malformed/allow-list failures
// are rejected upstream in the service before Broadcast is ever called.
type mockWithdrawalProvider struct{}

// NewMockWithdrawalProvider builds the default (no-network) broadcast adapter.
func NewMockWithdrawalProvider() WithdrawalProvider { return &mockWithdrawalProvider{} }

func (m *mockWithdrawalProvider) Name() string { return "mock" }

func (m *mockWithdrawalProvider) Broadcast(_ context.Context, req BroadcastRequest) (BroadcastRequestResult, error) {
	// Deterministic, idempotent pseudo-references (no network, no minting).
	seed := req.WithdrawalID + "|" + req.ProviderIdemKey
	sum := sha256.Sum256([]byte(seed))
	h := hex.EncodeToString(sum[:])
	return BroadcastRequestResult{
		ProviderRef: "MOCKWD-" + h[:12],
		TxHash:      "0x" + h[:40],
		Accepted:    true,
	}, nil
}

// deriveDepositAddress deterministically generates a persisted deposit address for
// a (user, asset, network) triple. This is the deposit-side of the same provider
// seam: a real custody adapter would allocate a real address here. Deterministic so
// the same user/asset always yields the same address before persistence.
func deriveDepositAddress(userID, symbol, network string) (address, memo string) {
	sum := sha256.Sum256([]byte(userID + "|" + symbol + "|" + network))
	h := hex.EncodeToString(sum[:])
	switch network {
	case "bitcoin", "btc":
		address = "bc1q" + h[:30]
	case "tron", "trc20":
		address = "T" + h[:33]
		memo = fmt.Sprintf("%06d", int(sum[0])<<8|int(sum[1])%900000+100000)
	default:
		address = "0x" + h[:40]
	}
	return address, memo
}

// nowUTC is a tiny indirection so the provider seam stays testable.
func nowUTC() time.Time { return time.Now().UTC() }
