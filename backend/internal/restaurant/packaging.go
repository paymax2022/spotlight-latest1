package restaurant

// ── Takeaway packaging pricing ───────────────────────────────────────────────
//
// The cart is built on a "takeaway package" model: the customer adds a pack,
// then puts food into it, and pays a mandatory fee per pack so the restaurant
// can package the order. `restaurants.packaging_fee_kobo` is the per-pack price
// the owner sets (₦200 by default).
//
// The pack COUNT is a customer choice — the packing rules set a floor (one main
// per pack, at most two portions of it) but the customer may add more packs than
// that — so the server cannot derive it and has to take it from the client. It is
// therefore bounded here before it can reach the escrow debit, for the same
// reason TipKobo is clamped: a client-supplied number must never price money
// without a ceiling the server owns.
//
// The fee settles 100% to the restaurant (settlement.Split.ProviderFeeKobo): the
// restaurant buys the packs, so it is a pass-through cost and neither the
// platform nor the rider takes a cut of it.

// maxPackagingKobo caps the packaging charge at ₦1,000,000 — far above any real
// order, low enough that packs × fee cannot overflow int64 or quietly become the
// dominant term of a total.
const maxPackagingKobo int64 = 100_000_000

// maxPackagingFeePerPackKobo bounds what an owner may charge for a single pack at
// ₦10,000. Well above any real takeaway pack, and low enough to catch the obvious
// data-entry slip — an owner typing a naira figure into a kobo field — before it
// is billed to customers.
const maxPackagingFeePerPackKobo int64 = 1_000_000

// PackagingKobo returns the number of packs actually charged and what they cost.
//
//   - requestedPacks is the customer's choice, clamped to [1, totalPortions]:
//     packaging is mandatory so it never falls below one, and a pack has to hold
//     something so it never exceeds one pack per portion. That upper bound is what
//     stops a hostile client inflating the escrow debit with empty packs.
//   - feePerPackKobo of 0 (or a negative, which the DB check already forbids)
//     costs the customer nothing.
//   - With no portions there is nothing to pack and nothing to charge.
func PackagingKobo(requestedPacks, totalPortions int, feePerPackKobo int64) (packs int, kobo int64) {
	if totalPortions <= 0 {
		return 0, 0
	}

	packs = requestedPacks
	if packs < 1 {
		packs = 1
	}
	if packs > totalPortions {
		packs = totalPortions
	}

	if feePerPackKobo <= 0 {
		return packs, 0
	}

	kobo = int64(packs) * feePerPackKobo
	// Guard the multiplication itself: a wrapped product would land in the order
	// total as a negative and break settlement conservation.
	if kobo < 0 || kobo > maxPackagingKobo {
		kobo = maxPackagingKobo
	}
	return packs, kobo
}
