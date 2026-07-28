package orchestration

// Contract guard: the FX wire format is camelCase (the mobile app is the sole
// consumer of /api/v1/fx and codes against camelCase — see mobile fx.types.ts).
// These tests fail if anyone reintroduces snake_case json tags on a response type.

import (
	"encoding/json"
	"strings"
	"testing"
)

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

func assertKeys(t *testing.T, js string, want []string, forbid []string) {
	t.Helper()
	for _, k := range want {
		if !strings.Contains(js, `"`+k+`"`) {
			t.Errorf("missing camelCase key %q in %s", k, js)
		}
	}
	for _, k := range forbid {
		if strings.Contains(js, `"`+k+`"`) {
			t.Errorf("forbidden snake_case key %q present in %s", k, js)
		}
	}
}

func TestQuoteJSONIsCamelCase(t *testing.T) {
	assertKeys(t, mustJSON(t, Quote{}),
		[]string{"amountType", "allInRate", "expiresAt"},
		[]string{"amount_type", "all_in_rate", "expires_at"})
}

func TestConversionJSONIsCamelCase(t *testing.T) {
	assertKeys(t, mustJSON(t, Conversion{}),
		[]string{"allInRate", "providerRef", "transactionId", "createdAt"},
		[]string{"all_in_rate", "provider_ref", "transaction_id", "created_at"})
}

func TestTransferJSONIsCamelCase(t *testing.T) {
	assertKeys(t, mustJSON(t, Transfer{}),
		[]string{"quotedRate", "executedRate", "statusHistory", "providerRef", "transactionId", "createdAt"},
		[]string{"quoted_rate", "executed_rate", "status_history", "provider_ref", "transaction_id", "created_at"})
}

func TestVirtualAccountJSONIsCamelCase(t *testing.T) {
	assertKeys(t, mustJSON(t, VirtualAccount{}),
		[]string{"createdAt"},
		[]string{"created_at"})
}

func TestTxViewJSONIsCamelCase(t *testing.T) {
	assertKeys(t, mustJSON(t, TxView{}),
		[]string{"quotedRate", "executedRate", "providerRef", "createdAt"},
		[]string{"quoted_rate", "executed_rate", "provider_ref", "created_at"})
}

func TestAPIErrorJSONIsCamelCase(t *testing.T) {
	ref := "prov_123"
	e := APIError{Code: "x", Message: "y", ProviderRef: &ref, RequestID: "req_1"}
	assertKeys(t, mustJSON(t, e),
		[]string{"providerRef", "requestId"},
		[]string{"provider_ref", "request_id"})
}
