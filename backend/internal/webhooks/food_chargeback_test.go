package webhooks

import (
	"context"
	"encoding/json"
	"testing"
)

type recChargeback struct{ evs []FoodChargebackEvent }

func (r *recChargeback) HandleFoodChargeback(_ context.Context, ev FoodChargebackEvent) error {
	r.evs = append(r.evs, ev)
	return nil
}

func TestHandleDisputeOrRefund_RoutesFoodOnly(t *testing.T) {
	rec := &recChargeback{}
	h := &PaystackHandler{}
	h.SetFoodChargebackHandler(rec)
	ctx := context.Background()

	dispute := json.RawMessage(`{"id":987,"transaction":{"reference":"foodorder-abc","amount":250000}}`)
	if err := h.handleDisputeOrRefund(ctx, "charge.dispute.create", dispute); err != nil {
		t.Fatal(err)
	}
	if err := h.handleDisputeOrRefund(ctx, "charge.dispute.resolve", json.RawMessage(`{"id":987,"resolution":"declined","transaction":{"reference":"foodorder-abc"}}`)); err != nil {
		t.Fatal(err)
	}
	if err := h.handleDisputeOrRefund(ctx, "refund.processed", json.RawMessage(`{"id":55,"amount":1000,"transaction_reference":"foodorder-xyz"}`)); err != nil {
		t.Fatal(err)
	}
	// Non-food references must be ignored without error.
	if err := h.handleDisputeOrRefund(ctx, "charge.dispute.create", json.RawMessage(`{"id":1,"transaction":{"reference":"vote-1"}}`)); err != nil {
		t.Fatal(err)
	}
	if len(rec.evs) != 3 {
		t.Fatalf("want 3 food events, got %d: %+v", len(rec.evs), rec.evs)
	}
	if e := rec.evs[0]; e.Kind != "dispute" || e.ProviderEventID != "987" || e.AmountKobo != 250000 || e.Resolved {
		t.Errorf("create: %+v", e)
	}
	if e := rec.evs[1]; !e.Resolved || e.Resolution != "declined" {
		t.Errorf("resolve: %+v", e)
	}
	if e := rec.evs[2]; e.Kind != "refund" || e.Reference != "foodorder-xyz" || e.AmountKobo != 1000 {
		t.Errorf("refund: %+v", e)
	}
}

func TestHandleDisputeOrRefund_NilHandlerDoesNotPanicOrError(t *testing.T) {
	h := &PaystackHandler{}
	if err := h.handleDisputeOrRefund(context.Background(), "charge.dispute.create",
		json.RawMessage(`{"id":1,"transaction":{"reference":"foodorder-a"}}`)); err != nil {
		t.Fatal(err)
	}
}
