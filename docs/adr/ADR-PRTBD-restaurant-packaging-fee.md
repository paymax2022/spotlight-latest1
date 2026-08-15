# ADR-PRTBD — Takeaway packaging is charged server-side and paid whole to the restaurant

**Status:** Accepted
**Date:** 2026-08-15

> **Number not yet assigned.** CLAUDE.md requires `ADR-PR<pr-number>` with the real
> number stamped on merge by `.github/workflows/adr-assign.yml`. This change was
> pushed directly to `develop`, so no PR number exists and that workflow — which is
> `on: pull_request` — never runs. The file is deliberately named `PRTBD` rather
> than given an invented sequence number: hand-picking is what produced six
> duplicate ADRs in one day, including a duplicate ADR-040 earlier in this same
> session. Rename to the assigned number if this is ever routed through a PR.

## Context

The mobile food cart is built on a "takeaway package" model: the customer adds a
pack, puts food into it, and pays a mandatory fee per pack so the restaurant can
package the order. Checkout has always displayed a **Takeaway packaging** line and
added it to the total it shows.

Nothing server-side ever charged it.

Migration `20261113000000` gave the per-pack price a column
(`restaurants.packaging_fee_kobo`) precisely to close that gap, but `PlaceOrder`
never grew a packaging term — so the column was configuration the order pipeline
did not read. It also defaulted to `0` and said so explicitly ("a restaurant only
starts charging packaging once an operator sets a non-zero value"). No operator
ever did: all 697 restaurants sat at 0, and checkout rendered
`Takeaway packaging (3 packs) ₦0.00`.

So there were two defects stacked on each other: a price of zero, and no mechanism
to charge it even if it were not zero.

## Decision

**1. The server prices packaging, and it is part of the escrowed total.**

`PlaceOrder` reads `restaurants.packaging_fee_kobo` alongside the rest of the
pricing config — at order time, so a later price change never reprices a placed
order — and adds `packs × fee` to the total it escrows. The charge and the pack
count are recorded on the order (`orders.packaging_fee_kobo`, `package_count`).

The pack **count** comes from the client. It has to: the packing rules set a floor,
but adding extra packs is a customer choice the server cannot derive from the
items. It is therefore clamped to `[1, total portions]` before it prices anything —
a pack must hold something, which is what stops a client inflating the escrow debit
with empty packs, and the floor of 1 keeps packaging mandatory rather than free by
silence. This mirrors how `TipKobo` — the other client-supplied amount on the
order — is bounded before it reaches the escrow debit.

**2. The fee passes 100% to the restaurant, not through the 80/10/10 split.**

The restaurant buys the packs. Packaging is a pass-through cost, so the platform
and the rider take no cut of it — the same reason the restaurant takes no cut of a
rider's tip.

This required a new fixed leg on the shared `settlement.Split`:
`ProviderFeeKobo`, the provider-side mirror of `ServiceFeeKobo` (100% platform) and
`TipKobo` (100% rider). It is excluded from the base the percentages price, and the
provider leg — computed as the remainder `total − platform − rider` — absorbs it
without a separate term.

**3. The platform default is ₦200 per pack; the price is the owner's.**

Migration `20261211000100` sets the column default to 20,000 kobo and backfills
every restaurant still at 0. `UpdateRestaurant` now accepts `packaging_fee_kobo`
(owner-authorized via `assertOwner`, also reachable by operators through
`AdminUpdateRestaurant`), bounded to `[0, ₦10,000]` per pack. Zero remains a
legitimate choice, which is why the field is a pointer — `0` must be
distinguishable from "field omitted".

## Alternatives considered

**Fold packaging into the item gross (split 80/10/10).** No change to shared
settlement code, and the smaller diff. Rejected: the platform and rider would each
earn 10% of a cost the restaurant actually paid. On a ₦600 packaging charge the
restaurant would keep ₦480 of money it spent in full.

**Derive the pack count server-side from the packing rules.** Removes the
client-supplied number entirely. Rejected: it would duplicate the client's packing
algorithm and, worse, disagree with the arrangement the customer actually made —
they may deliberately add packs beyond the minimum. Clamping the client's number
gets the server-owned ceiling without overriding a real choice.

**Leave existing restaurants at 0 and default only new ones.** Matches the original
migration's stance that it alone changes no live price. Rejected on instruction:
the intent is that packaging is charged, and 697 stores opting in individually was
never going to happen.

## Consequences

- **This raises prices.** Every restaurant that had not set a packaging price
  begins charging ₦200 per pack on the next order after the migration runs. That is
  intended and explicitly requested, and it is the line a reviewer should stop at.
- Checkout's displayed packaging and the charged packaging now agree: the client
  computes `non-empty packs × the same column`, and non-empty packs never exceed
  total portions, so the server's clamp is a no-op in normal use.
- `settlement.Split` gained a field used by one caller. It defaults to 0, and a
  regression test asserts a zero `ProviderFeeKobo` reproduces the previous split
  exactly, so telemedicine, mobility and the doctor split are unaffected.
- Settlement's split arithmetic moved out of `Service.Settle` into
  `settlement.ComputeLegs`. The invariant tests previously re-implemented the
  formula locally and so could not fail when production changed; they now call the
  same function that moves the money.
- Live-DB fixtures for surge/modifiers/tips/promos/tier limits now pin
  `packaging_fee_kobo = 0` explicitly, so tests about other pricing are not
  perturbed by the platform packaging default.
