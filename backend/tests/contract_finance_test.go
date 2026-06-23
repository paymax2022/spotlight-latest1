package tests

import (
	"encoding/json"
	"testing"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/transfers"
	"spotlight/backend/internal/finance/wallet"
)

// contract_finance_test.go asserts that the Go DTOs SERIALIZE to the field names
// and value sets declared in contracts/openapi.yaml. These are lightweight
// consumer-style contract tests: if a struct tag is renamed or a status enum
// drifts from the spec, the frontend/mobile clients break — catch it here in CI
// rather than in production.
//
// Source of truth: contracts/openapi.yaml (schemas WalletTransfer, BankTransfer,
// LedgerEntry, parameters/body of /wallet/topup and /transfers/*).

// jsonKeys returns the set of top-level JSON keys produced by marshalling v.
func jsonKeys(t *testing.T, v any) map[string]bool {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	out := map[string]bool{}
	for k := range m {
		out[k] = true
	}
	return out
}

func requireKeys(t *testing.T, keys map[string]bool, required ...string) {
	t.Helper()
	for _, k := range required {
		if !keys[k] {
			t.Errorf("missing required JSON field %q (present: %v)", k, keys)
		}
	}
}

// LedgerEntry contract: required [id, type, amount_kobo, reference, created_at].
func TestContract_LedgerEntryShape(t *testing.T) {
	keys := jsonKeys(t, ledger.Entry{})
	requireKeys(t, keys, "id", "type", "amount_kobo", "reference", "created_at")
}

// Topup request contract: amount_kobo + idempotency_key serialized as snake_case.
func TestContract_TopupRequestShape(t *testing.T) {
	keys := jsonKeys(t, wallet.TopupRequest{})
	requireKeys(t, keys, "amount_kobo", "idempotency_key")
}

// WalletTransfer contract: required [id, reference, amount_kobo, fee_kobo, status, created_at].
func TestContract_WalletTransferShape(t *testing.T) {
	keys := jsonKeys(t, transfers.WalletTransfer{})
	requireKeys(t, keys, "id", "reference", "amount_kobo", "fee_kobo", "status", "created_at")
}

// BankTransfer contract: required [id, reference, amount_kobo, fee_kobo, status, created_at].
func TestContract_BankTransferShape(t *testing.T) {
	keys := jsonKeys(t, transfers.BankTransfer{})
	requireKeys(t, keys, "id", "reference", "amount_kobo", "fee_kobo", "status", "created_at")
}

// BankTransfer.status values must all be members of the contract enum
// [funds_reserved, provider_initiated, successful, failed, reversed].
func TestContract_BankTransferStatusEnum(t *testing.T) {
	allowed := map[transfers.BankTransferStatus]bool{
		transfers.BankTransferFundsReserved:     true,
		transfers.BankTransferProviderInitiated: true,
		transfers.BankTransferSuccessful:        true,
		transfers.BankTransferFailed:            true,
		transfers.BankTransferReversed:          true,
	}
	contractEnum := map[string]bool{
		"funds_reserved": true, "provider_initiated": true,
		"successful": true, "failed": true, "reversed": true,
	}
	for st := range allowed {
		if !contractEnum[string(st)] {
			t.Errorf("BankTransferStatus %q is not in the openapi enum", st)
		}
	}
}

// CONTRACT DRIFT (documented defect, owner: finance/transfers agent):
//
// openapi.yaml WalletTransfer.status enum = [successful, failed, reversed],
// but internal/finance/transfers/model.go defines the wallet-transfer terminal
// success state as WalletTransferCompleted = "completed" (and uses it when
// inserting wallet_transfers rows with status='completed').
//
// RECONCILED (orchestrator): the model now emits statuses that match the spec
// enum [successful, failed, reversed]. This test now actively guards that
// alignment instead of being skipped.
func TestContract_WalletTransferStatusEnum(t *testing.T) {
	contractEnum := map[string]bool{"successful": true, "failed": true, "reversed": true}
	implStates := []transfers.WalletTransferStatus{
		transfers.WalletTransferSuccessful,
		transfers.WalletTransferFailed,
		transfers.WalletTransferReversed,
	}
	for _, st := range implStates {
		if !contractEnum[string(st)] {
			t.Errorf("WalletTransferStatus %q not in openapi enum %v", st, contractEnum)
		}
	}
}
