package queue_test

import (
	"encoding/json"
	"testing"

	"spotlight/backend/internal/platform/queue"
)

func TestNewClient_InvalidURL_Rejects(t *testing.T) {
	_, err := queue.NewClient("not-a-redis-url")
	if err == nil {
		t.Fatal("expected error for invalid redis URL, got nil")
	}
}

func TestTaskTypes_AreNonEmpty(t *testing.T) {
	types := []string{
		queue.TypeWalletCreditNotify,
		queue.TypeWalletDebitNotify,
		queue.TypeReferralOutboxProcess,
		queue.TypeBankTransferInitiate,
		queue.TypeBankTransferWebhook,
		queue.TypeKYCProvisioned,
		queue.TypeVAProvision,
		queue.TypeNotificationPush,
		queue.TypeNotificationEmail,
		queue.TypeNotificationSMS,
		queue.TypeReconciliationRun,
		queue.TypeOutboxSync,
	}
	seen := make(map[string]bool)
	for _, tt := range types {
		if tt == "" {
			t.Fatalf("task type constant is empty")
		}
		if seen[tt] {
			t.Fatalf("duplicate task type: %q", tt)
		}
		seen[tt] = true
	}
}

func TestPayload_MarshalRoundtrip(t *testing.T) {
	p := queue.Payload{
		"user_id":     "abc-123",
		"amount_kobo": float64(50000),
		"ref":         "TXN-XYZ",
	}
	b, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got queue.Payload
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got["user_id"] != "abc-123" {
		t.Fatalf("user_id mismatch: got %v", got["user_id"])
	}
}
