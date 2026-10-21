package restaurant

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// FOOD-UAT-H-004: a dispute on an escrowed Paystack-funded order reverses the
// escrow exactly once (replay-safe) and flips the order to chargebacked.
func TestLiveDB_HandleChargeback_ReversesEscrowOnce(t *testing.T) {
	pool := tierPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	svc, _, restID, item, customer := tierGateFixture(t, ctx, pool, "Chargeback Kitchen", 200_000, 10_000_000)
	req := PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "cb-" + uuid.New().String(),
	}
	quoted, err := svc.QuoteOrder(ctx, restID, customer, req)
	if err != nil {
		t.Fatal(err)
	}
	order, err := svc.PlaceOrderPaystackFunded(ctx, restID, customer, req, quoted)
	if err != nil {
		t.Fatal(err)
	}
	ref := "foodorder-" + req.IdempotencyKey
	if _, err := pool.Exec(ctx, `INSERT INTO restaurant_order_paystack_intents
	  (reference, restaurant_id, customer_id, request_json, amount_kobo, idempotency_key, status, order_id)
	  VALUES ($1,$2,$3,'{}'::jsonb,$4,$5,'confirmed',$6)`, ref, restID, customer, quoted, req.IdempotencyKey, order.ID); err != nil {
		t.Fatal(err)
	}
	disputeID := uuid.New().String()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM restaurant_order_chargebacks WHERE reference=$1`, ref)
		_, _ = pool.Exec(context.Background(), `DELETE FROM restaurant_order_paystack_intents WHERE reference=$1`, ref)
	})

	ev := ChargebackEvent{Kind: ChargebackKindDispute, ProviderEventID: disputeID, Reference: ref, AmountKobo: quoted}
	for i := 0; i < 2; i++ { // second call = webhook replay
		if err := svc.HandleChargeback(ctx, ev); err != nil {
			t.Fatalf("delivery %d: %v", i+1, err)
		}
	}

	var ostatus, sstatus string
	if err := pool.QueryRow(ctx, `SELECT o.status, s.status FROM orders o JOIN settlements s ON s.id=o.settlement_id WHERE o.id=$1`, order.ID).Scan(&ostatus, &sstatus); err != nil {
		t.Fatal(err)
	}
	if ostatus != string(OrderChargebacked) || sstatus != "refunded" {
		t.Errorf("order=%s settlement=%s, want chargebacked/refunded", ostatus, sstatus)
	}
	var rows, legs int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_order_chargebacks WHERE idempotency_key=$1 AND outcome='reversed'`, "chargeback:"+disputeID).Scan(&rows)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries WHERE reference LIKE 'refund:%' AND idempotency_key LIKE 'refund:'||$1||'%'`, order.SettlementID).Scan(&legs)
	if rows != 1 {
		t.Errorf("chargeback rows = %d, want 1", rows)
	}
	if legs != 2 {
		t.Errorf("reversal ledger legs = %d, want exactly 2 (one balanced pair)", legs)
	}

	// resolve stamps the row, never re-credits.
	if err := svc.HandleChargeback(ctx, ChargebackEvent{Kind: ChargebackKindDispute, ProviderEventID: disputeID, Reference: ref, Resolved: true, Resolution: "declined"}); err != nil {
		t.Fatal(err)
	}
	var res string
	_ = pool.QueryRow(ctx, `SELECT COALESCE(resolution,'') FROM restaurant_order_chargebacks WHERE idempotency_key=$1`, "chargeback:"+disputeID).Scan(&res)
	if res != "declined" {
		t.Errorf("resolution = %q", res)
	}
}
