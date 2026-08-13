# ADR-030 — Legacy FX fee is an explicit Paymax markup, not a provider field

**Date:** 2026-08-13
**Status:** Accepted — rate set by product at **1%**, operator-tunable at runtime
**Deciders:** FX
**Scope:** `backend/internal/finance/fx` (`spread.go`, `markup_store.go`, `markup_handler.go`, `GetQuote`), the admin route wiring, one additive migration (`20261204000000_fx_markup_rates.sql`), and the live-DB tests. No API contract change for the customer-facing FX endpoints — `fx_quotes.fee_kobo` / `fx_conversions.fee_kobo` already exist.

> Numbering note: ADR-029 is taken by the orchestration ledger fix on `fix/orch-ledger-double-entry` (PR #95), which is not yet merged.

## Context

`fx.Service.GetQuote` set `FeeKobo: providerResp.Fee` — a field decoded from a Maplerad response shape that **does not exist**. Probing the sandbox for this PR established the real contract:

- `GET /fx/rates` is a rate *board*: no quote id, no fee, no expiry.
- `POST /fx/quote` returns `{reference, source{currency,amount}, target{…}, rate}` — no fee.
- `POST /fx` (the exchange) returns `{source, target, rate, created_at, updated_at}` — no fee, no transaction id, no status.

Maplerad prices its margin **into the rate**; it never itemises a fee. `maplerad.ConvertFXResponse` now says so explicitly ("FeeKobo is always zero").

So `fee_kobo` was structurally `0` on every live conversion, with three consequences:

1. `totalDebitKobo := q.SourceAmountKobo + q.FeeKobo` debited the **principal only**.
2. `recordCommissionSafe` early-returns on `feeKobo <= 0`, so **no realized profit was ever recorded** for FX.
3. The one test that would have caught it asserted a fee of 500 supplied by a stub that fabricated a `"fee"` field the provider never sends — so it passed while production earned nothing.

To be precise about blame: this is not a regression introduced by the board fix. Before it, the client could not decode the real board response at all, so the live path was broken outright. The board fix simply made the missing fee visible.

## Decision

**Paymax charges its own explicit markup, computed by us, disclosed at quote time.** A new `fx.Markup` (`spread.go`) resolves a per-corridor rate in basis points and returns the fee in the source currency's minor units.

- **The rate is 1% by default and lives in the database, not in code.** `public.fx_markup_rates` holds one row per corridor plus a seeded `DEFAULT` row at 100 bps (1%). An operator changes it at runtime through `PUT /api/finance/admin/fx/markup` (RBAC `finance.admin.fx_markup`); the change takes effect on the **very next quote** — resolved per quote, so there is no restart and no cache to invalidate.
- **Operators work in percent, storage is integer basis points.** 1% ⇔ 100 bps, matching `commission_config.commission_bps` and every other rate in the schema. `PercentToBPS` parses the submitted literal with `big.Rat` so `1.15%` becomes exactly `115` bps, not the `114.999…` a `float64` round-trip yields; anything finer than one basis point is rejected rather than silently rounded. Responses carry both `rateBps` and `ratePercent` so a client never has to divide by 100 and get it wrong.
- **Every change is audited.** `fx_markup_rate_audit` records before/after (bps and percent), active flag, actor, and a free-text reason. The read-modify-write runs in one transaction with the row locked `FOR UPDATE`, so concurrent admin edits cannot write an audit row whose "before" never existed.
- **A fat-finger ceiling of 10%** (1000 bps) is enforced in `PercentToBPS`, again in `MarkupStore.SetRate`, and again by a `CHECK` on the table. It is not a pricing decision — it exists so a mistyped `100` (meaning 1%) cannot charge 100% of the principal. A rejected write leaves no rate row and no audit row.
- **Resolution order** is corridor-specific rate → `DEFAULT` row. A *deactivated* corridor rate falls back to `DEFAULT`, never silently to zero. A missing `DEFAULT` row is an **error, not a zero**: the seed guarantees one, so its absence means the schema is not what this code expects and we must not guess what to charge.
- The fee is computed **once, at quote time, and persisted** on `fx_quotes`. `Convert` reads it from the stored quote, so an admin changing the rate between quote and execution cannot alter what the customer was already shown.
- `GetQuote` **fails closed** if the rate cannot be resolved. Charging a fee we cannot confirm is worse than not quoting.
- Arithmetic is exact `big.Rat` with **half-even rounding** — never float multiplication — so fractional kobo resolve deterministically and do not drift in Paymax's favour over a run of conversions.
- A markup may be zero (no margin) but **never negative**, which would pay the customer to convert — clamped in `NewMarkup`, rejected in `PercentToBPS`, and bounded by the table `CHECK`.
- `Service.SetMarkup` takes a `MarkupResolver`: app-wiring injects the DB-backed `MarkupStore`; tests pin a static `Markup` so they assert behaviour rather than production pricing. `NewService` installs a flat 1% fallback so the field is never nil.

### Why this is safe for the ledger

No ledger change is needed. `Convert` already posts `totalDebitKobo` as a **balanced** double-entry (`ledger.Debit`: user wallet → `fx_spread_income`). A non-zero fee simply increases that debit, and `fx_spread_income` is exactly the right counter-account for a Paymax FX margin. `recordCommissionSafe` then fires with the exact fee via `RecordExact`.

## Consequences

- **Customers are charged more than they are today** (today: nothing above principal). That is the point of the change, but it is a pricing change and is called out as such.
- FX realized profit starts being recorded again, under `Finance / Currency Exchange`.
- The provider's own margin stays where it is — inside the rate. We do **not** try to derive it from the board-vs-quote rate difference and book it as Paymax revenue; it is Maplerad's, not ours.
- The live-DB convert test pins the markup explicitly (`SetMarkup(NewMarkup(10))`, 10 bps of 500,000 = 500) so it asserts *our* behaviour rather than production pricing, and keeps its original expected values.

## Rate decision

**1%**, set by product, seeded as the `DEFAULT` row. Superseded the earlier proposal to inherit orchestration's table (105 bps default / USD-NGN 120 / USD-XAF 150), which was only ever a placeholder pending sign-off. No corridor overrides ship; operators can add them at runtime if a corridor warrants one.

Changing the rate no longer needs a deploy — it is an admin action, audited.

### Resolved: the orchestration path now shares this table

At the time this ADR was written the orchestration module (`/api/v1/fx/*`) still priced from its own in-code `SpreadEngine`, so two live FX surfaces could charge different markups and only one was admin-tunable. **[ADR-031](ADR-031-fx-markup-single-source-of-truth.md) closed that**: orchestration now reads `fx_markup_rates` too, the key widened to `(corridor, tier)`, and one admin write moves both surfaces. The existing orchestration rates were seeded verbatim so nothing repriced, apart from the default fallback converging 105 bps → 100 bps on the 1% decided here.

## Alternatives rejected

- **Leave `fee_kobo` at 0 and assert that in the test.** Honest, and the smallest change, but it silently accepts zero FX revenue on a live money path and hides the decision inside a test expectation.
- **Keep the rate as a Go constant.** Every rate change would need a deploy, and there would be no record of who changed what or when — unacceptable for a customer-facing charge.
- **Store the percentage as `numeric`/float.** Operators think in percent, but a float percent makes the charged fee non-reproducible and invites drift. Integer bps with exact conversion at the edge keeps the money path deterministic while still showing operators a percentage.
- **Derive the fee from the rate difference** between the `/fx/rates` board mid and the firm `/fx/quote` rate. That difference is the *provider's* spread; booking it as Paymax revenue would misattribute Maplerad's margin to us.
- **Import `orchestration.SpreadEngine` directly.** Correct on numbers, wrong on dependency direction — see above.
