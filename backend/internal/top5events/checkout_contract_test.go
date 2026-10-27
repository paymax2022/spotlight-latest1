package top5events

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
)

// Contract tests for the member checkout request shapes. The mobile client
// (src/features/events/api.ts) ships {tier_id, quantity, promo_code} for
// purchase and {cashtag} for gift — these tests pin that the server binds and
// honours every one of those fields rather than silently dropping them.

func TestPurchaseRequest_BindsMobileClientShape(t *testing.T) {
	var req purchaseRequest
	if err := json.Unmarshal([]byte(`{"tier_id":"t1","quantity":3,"promo_code":"SAVE10"}`), &req); err != nil {
		t.Fatal(err)
	}
	if req.TierID != "t1" || req.Quantity == nil || *req.Quantity != 3 || req.promoValue() != "SAVE10" {
		t.Fatalf("mobile-shaped body not bound: %+v", req)
	}
	var noQty purchaseRequest
	_ = json.Unmarshal([]byte(`{"tier_id":"t1"}`), &noQty)
	if noQty.Quantity != nil {
		t.Fatal("absent quantity must stay nil (default 1 downstream)")
	}
	var zeroQty purchaseRequest
	_ = json.Unmarshal([]byte(`{"tier_id":"t1","quantity":0}`), &zeroQty)
	if zeroQty.Quantity == nil {
		t.Fatal("explicit quantity:0 must survive binding so the server can reject it")
	}
}

func TestPurchaseRequest_BindsLegacyPromoSpelling(t *testing.T) {
	var req purchaseRequest
	if err := json.Unmarshal([]byte(`{"tier_id":"t1","promo":"VIP"}`), &req); err != nil {
		t.Fatal(err)
	}
	if req.promoValue() != "VIP" {
		t.Fatalf("legacy promo field dropped: %+v", req)
	}
	// promo wins when both are sent — documented precedence.
	var both purchaseRequest
	_ = json.Unmarshal([]byte(`{"tier_id":"t1","promo":"A","promo_code":"B"}`), &both)
	if both.promoValue() != "A" {
		t.Fatalf("promo precedence broken: %+v", both)
	}
}

func TestGiftRequest_BindsCashtagAndRecipient(t *testing.T) {
	var c giftRequest
	if err := json.Unmarshal([]byte(`{"cashtag":"@ada"}`), &c); err != nil {
		t.Fatal(err)
	}
	if c.recipientValue() != "@ada" {
		t.Fatalf("cashtag field dropped: %+v", c)
	}
	var r giftRequest
	if err := json.Unmarshal([]byte(`{"recipient":"@obi"}`), &r); err != nil {
		t.Fatal(err)
	}
	if r.recipientValue() != "@obi" {
		t.Fatalf("recipient field dropped: %+v", r)
	}
	var empty giftRequest
	_ = json.Unmarshal([]byte(`{}`), &empty)
	if empty.recipientValue() != "" {
		t.Fatal("empty body must not resolve a recipient")
	}
}

func TestUnitIdemKey_SingleKeepsBase_BatchDerives(t *testing.T) {
	if got := unitIdemKey("K", 0, 1); got != "K" {
		t.Fatalf("single-unit key mutated: %q", got)
	}
	seen := map[string]bool{}
	for i := range 4 {
		k := unitIdemKey("K", i, 4)
		if seen[k] {
			t.Fatalf("duplicate unit key %q", k)
		}
		seen[k] = true
	}
	// Unit keys must not equal the bare base — a single-unit order keyed K must
	// never collide with a batch unit.
	if seen["K"] {
		t.Fatal("batch produced the bare base key")
	}
}

func TestPurchaseTickets_QuantityValidation(t *testing.T) {
	s := &Service{} // validation runs before any DB touch
	for _, q := range []int{-1, 0, MaxTicketsPerOrder + 1, 10_000} {
		if _, err := s.PurchaseTickets(t.Context(), "u1", "e1", "t1", "", q, "idem"); !errors.Is(err, ErrValidation) {
			t.Fatalf("qty=%d: want ErrValidation, got %v", q, err)
		}
	}
	if _, err := s.PurchaseTickets(t.Context(), "u1", "e1", "t1", "", 1, ""); err == nil {
		t.Fatal("empty idempotency key must be rejected")
	}
}

func TestHardTimePatch_VenueIsEntitlementAffecting(t *testing.T) {
	v := "New Venue"
	now := time.Now()
	if !hardTimePatch(EventPatch{Venue: &v}) {
		t.Fatal("venue patch must count as a hard-time (entitlement) edit")
	}
	if !hardTimePatch(EventPatch{StartsAt: &now}) || !hardTimePatch(EventPatch{EndsAt: &now}) {
		t.Fatal("schedule patches must count as hard-time edits")
	}
	title := "T"
	if hardTimePatch(EventPatch{Title: &title}) || hardTimePatch(EventPatch{}) {
		t.Fatal("soft/empty patches must not trigger the hard-time lock")
	}
}
