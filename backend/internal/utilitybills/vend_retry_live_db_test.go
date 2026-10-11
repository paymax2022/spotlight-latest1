package utilitybills

// LIVE-DB: opening the vend-retry window merges INTO the row's metadata. It
// must keep the captured payment_reference — that reference is the PROOF a card
// charge exists, and the admin approval path refuses to credit a paystack row
// without it, so a clobbering write would strand the customer's refund.
//
// Gated on TEST_DATABASE_URL (see livePoolUtilitybills).

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	ptrx "spotlight/backend/go-common/ptr"
)

func TestLiveDB_UpdateTransaction_VendRetryMergeKeepsPaymentReference(t *testing.T) {
	ctx := context.Background()
	pool := livePoolUtilitybills(t)
	repo := NewRepository(pool)

	userID := uuid.NewString()
	billerID := uuid.NewString()
	key := "ub-refund-req-" + uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, userID, "ub-refund-"+userID+"@test.local"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.utility_billers (id, category, name, code)
		VALUES ($1, 'airtime', 'Refund Req Biller', $2)`, billerID, "ub-rr-"+billerID[:8]); err != nil {
		t.Fatalf("seed biller: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM public.utility_transactions WHERE idempotency_key = $1`, key)
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM public.utility_billers WHERE id = $1`, billerID)
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM auth.users WHERE id = $1`, userID)
	})

	receipt := "RCP-RR-" + key[len(key)-8:]
	row, _, err := repo.InsertTransaction(ctx, &TransactionRow{
		UserID:            userID,
		Category:          "airtime",
		BillerID:          billerID,
		CustomerReference: "08030000000",
		AmountKobo:        100_000,
		RetailAmountKobo:  100_000,
		ProviderCostKobo:  95_000,
		Status:            "failed",
		ReceiptNumber:     &receipt,
		IdempotencyKey:    key,
		PaymentSource:     "paystack",
		Metadata:          json.RawMessage(`{"payment_reference":"PAYREF-123","note":"keep"}`),
	})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}

	updated, err := repo.UpdateTransaction(ctx, row.ID, TransactionPatch{
		FailureReason: ptrx.Of("stuck"),
		MetadataMerge: vendRetryMetadata("stuck_recovery", "stuck"),
	})
	if err != nil {
		t.Fatalf("update with metadata merge: %v", err)
	}

	var md map[string]json.RawMessage
	if err := json.Unmarshal(updated.Metadata, &md); err != nil {
		t.Fatalf("metadata is not JSON: %v (%s)", err, updated.Metadata)
	}
	if string(md["payment_reference"]) != `"PAYREF-123"` {
		t.Fatalf("payment_reference was lost or changed: %s", updated.Metadata)
	}
	if string(md["note"]) != `"keep"` {
		t.Fatalf("existing metadata keys must survive the merge: %s", updated.Metadata)
	}
	var vr struct {
		State string `json:"state"`
		Basis string `json:"basis"`
	}
	if err := json.Unmarshal(md["vend_retry"], &vr); err != nil {
		t.Fatalf("vend_retry missing: %v (%s)", err, updated.Metadata)
	}
	if vr.State != "retrying" || vr.Basis != "stuck_recovery" {
		t.Fatalf("vend_retry = %+v", vr)
	}

	// A patch WITHOUT a merge leaves metadata exactly as it was.
	again, err := repo.UpdateTransaction(ctx, row.ID, TransactionPatch{FailureReason: ptrx.Of("again")})
	if err != nil {
		t.Fatalf("plain update: %v", err)
	}
	if string(again.Metadata) != string(updated.Metadata) {
		t.Fatalf("a patch with no merge must not touch metadata: %s vs %s", again.Metadata, updated.Metadata)
	}
}
