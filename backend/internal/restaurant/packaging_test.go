package restaurant

import "testing"

// ---------------------------------------------------------------------------
// Takeaway packaging pricing.
//
// The cart is built on a "takeaway package" model: the customer adds a pack,
// then puts food in it, and pays a fee per pack so the restaurant can package
// the order. The pack COUNT is therefore a customer choice — they may add more
// packs than the packing rules strictly require — so it has to come from the
// client. That makes it the one packaging input the server cannot derive, and
// client-supplied numbers never price money unbounded (the same reason TipKobo
// is clamped before it reaches the escrow debit).
// ---------------------------------------------------------------------------

const feePerPack = 20000 // ₦200

func TestPackagingPricesEachPack(t *testing.T) {
	packs, kobo := PackagingKobo(3, 4, feePerPack)
	if packs != 3 {
		t.Errorf("packs = %d, want 3", packs)
	}
	if kobo != 60000 {
		t.Errorf("kobo = %d, want 60000 (3 × ₦200)", kobo)
	}
}

func TestPackagingNeverExceedsOnePackPerPortion(t *testing.T) {
	// A hostile or buggy client asking for 500 packs on a 2-portion order would
	// otherwise add ₦100,000 to the escrow debit. A pack must hold something.
	packs, kobo := PackagingKobo(500, 2, feePerPack)
	if packs != 2 {
		t.Errorf("packs = %d, want 2 (capped at one pack per portion)", packs)
	}
	if kobo != 40000 {
		t.Errorf("kobo = %d, want 40000", kobo)
	}
}

func TestPackagingAlwaysChargesAtLeastOnePack(t *testing.T) {
	// Packaging is mandatory — the food has to leave the kitchen in something.
	// A client that omits the field (0) or sends nonsense must not get it free.
	for _, requested := range []int{0, -1, -999} {
		packs, kobo := PackagingKobo(requested, 3, feePerPack)
		if packs != 1 {
			t.Errorf("requested %d: packs = %d, want 1", requested, packs)
		}
		if kobo != feePerPack {
			t.Errorf("requested %d: kobo = %d, want %d", requested, kobo, feePerPack)
		}
	}
}

func TestPackagingIsFreeWhenTheRestaurantChargesNothing(t *testing.T) {
	// Every restaurant sat at 0 before the ₦200 default, and an owner may still
	// choose 0. That must cost the customer nothing, not a phantom minimum.
	packs, kobo := PackagingKobo(3, 4, 0)
	if kobo != 0 {
		t.Errorf("kobo = %d, want 0 when the restaurant charges no packaging", kobo)
	}
	if packs != 3 {
		t.Errorf("packs = %d, want the count still reported for the receipt", packs)
	}
}

func TestPackagingRejectsANegativeFee(t *testing.T) {
	// restaurants_packaging_fee_kobo_check forbids this in the database; belt and
	// braces here, because a negative fee would subtract from the escrowed total
	// and break settlement conservation.
	_, kobo := PackagingKobo(3, 4, -5000)
	if kobo != 0 {
		t.Errorf("kobo = %d, want 0 — a negative fee must never reduce the total", kobo)
	}
}

func TestPackagingWithNoPortions(t *testing.T) {
	// PlaceOrder requires at least one item, so this is defensive: no food means
	// nothing to pack and nothing to charge.
	packs, kobo := PackagingKobo(3, 0, feePerPack)
	if packs != 0 || kobo != 0 {
		t.Errorf("packs = %d kobo = %d, want 0 and 0", packs, kobo)
	}
}

func TestPackagingCannotOverflow(t *testing.T) {
	// packs × fee is integer kobo; a huge portion count paired with a huge fee
	// must not wrap around into a negative total.
	_, kobo := PackagingKobo(1<<30, 1<<30, 1<<40)
	if kobo < 0 {
		t.Errorf("kobo = %d overflowed", kobo)
	}
}
