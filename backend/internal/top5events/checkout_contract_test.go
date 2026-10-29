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

// The door reads the names captured at checkout (UAT EVT-218), so the HTTP layer
// must bind attendee_names and pass them through instead of dropping them.
func TestPurchaseRequest_BindsAttendeeNames(t *testing.T) {
	var named purchaseRequest
	if err := json.Unmarshal([]byte(`{"tier_id":"t1","quantity":2,"attendee_names":[" Ada ","Obi"]}`), &named); err != nil {
		t.Fatal(err)
	}
	if got := named.attendeeValues(); len(got) != 2 || got[0] != "Ada" || got[1] != "Obi" {
		t.Fatalf("attendee names not bound/trimmed: %#v", got)
	}

	var anonymous purchaseRequest
	_ = json.Unmarshal([]byte(`{"tier_id":"t1","quantity":2}`), &anonymous)
	if anonymous.attendeeValues() != nil {
		t.Fatal("omitted attendee_names must stay nil (seats issued unnamed)")
	}

	// An app renders one optional input per seat; leaving them all blank is the
	// same request as not showing the field, not a validation failure.
	var blanks purchaseRequest
	_ = json.Unmarshal([]byte(`{"tier_id":"t1","quantity":2,"attendee_names":["","  "]}`), &blanks)
	if blanks.attendeeValues() != nil {
		t.Fatalf("all-blank attendee_names must collapse to unnamed, got %#v", blanks.attendeeValues())
	}

	// A partly-filled list reaches the service, which refuses it: silent
	// mis-attribution of seats is the failure this API exists to prevent.
	var part purchaseRequest
	_ = json.Unmarshal([]byte(`{"tier_id":"t1","quantity":3,"attendee_names":["Ada","",""]}`), &part)
	if got := part.attendeeValues(); len(got) != 3 || got[0] != "Ada" {
		t.Fatalf("partial list must survive to the service: %#v", got)
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
	// A seat list that does not match the quantity is refused before any order is
	// reserved, so a mistyped checkout can never half-name a booking. (A pool-less
	// service is the proof: the mismatch returns validation-clean while a
	// correctly-sized list would have reached the database.)
	for _, names := range [][]string{{"Ada"}, {"Ada", "Obi", "Shola"}} {
		if _, err := s.PurchaseTicketsWithAttendees(t.Context(), "u1", "e1", "t1", "", 2, "idem", names); !errors.Is(err, ErrValidation) {
			t.Fatalf("attendee list of %d against qty 2: want ErrValidation, got %v", len(names), err)
		}
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
