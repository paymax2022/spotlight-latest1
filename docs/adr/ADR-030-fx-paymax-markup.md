# ADR-030 — Legacy FX fee is an explicit Paymax markup, not a provider field

**Date:** 2026-08-13
**Status:** Proposed — **the bps table needs product sign-off before merge** (see Open question)
**Deciders:** FX
**Scope:** `backend/internal/finance/fx` (new `spread.go`, `GetQuote`) and the live-DB convert test. No migration, no API contract change, no new columns — `fx_quotes.fee_kobo` / `fx_conversions.fee_kobo` already exist.

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

- The rule table **mirrors the already-reviewed orchestration `SpreadEngine`** — default **105 bps**, **USD-NGN 120 bps**, **USD-XAF 150 bps** — so the legacy `/api/finance/fx` path and the orchestration path price a corridor identically.
- It is **duplicated rather than imported**. Pulling the whole `orchestration` package (providers, treasury, redis, quotebook) into `finance/fx` for one pure-arithmetic type is the wrong coupling for a service being superseded. The duplication is ~40 lines of pure function with a test pinning both tables to the same numbers.
- The fee is computed **once, at quote time, and persisted** on `fx_quotes`. `Convert` reads it from the stored quote, so a markup-table change between quote and execution cannot alter what the customer was shown.
- Arithmetic is exact `big.Rat` with **half-even rounding** — never float multiplication — so fractional kobo resolve deterministically and do not drift in Paymax's favour over a run of conversions.
- `NewMarkup` clamps a negative default to zero and drops negative overrides: a markup may be zero (no margin) but never negative, which would pay the customer to convert.
- `Service.SetMarkup` is the wiring seam; `NewService` installs `DefaultMarkup()` so the field is never nil.

### Why this is safe for the ledger

No ledger change is needed. `Convert` already posts `totalDebitKobo` as a **balanced** double-entry (`ledger.Debit`: user wallet → `fx_spread_income`). A non-zero fee simply increases that debit, and `fx_spread_income` is exactly the right counter-account for a Paymax FX margin. `recordCommissionSafe` then fires with the exact fee via `RecordExact`.

## Consequences

- **Customers are charged more than they are today** (today: nothing above principal). That is the point of the change, but it is a pricing change and is called out as such.
- FX realized profit starts being recorded again, under `Finance / Currency Exchange`.
- The provider's own margin stays where it is — inside the rate. We do **not** try to derive it from the board-vs-quote rate difference and book it as Paymax revenue; it is Maplerad's, not ours.
- The live-DB convert test pins the markup explicitly (`SetMarkup(NewMarkup(10))`, 10 bps of 500,000 = 500) so it asserts *our* behaviour rather than production pricing, and keeps its original expected values.

## Open question — needs product sign-off

**The bps figures above were inherited from orchestration's table, not chosen by product for this path.** They are the most defensible default available in-repo (same corridors, same platform, already reviewed), but nobody has signed off on charging them here. Before merge, confirm either:

- these rates are correct for `/api/finance/fx`; or
- a different table; or
- that this path is being retired in favour of orchestration, in which case the markup should be `NewMarkup(0)` and the revenue question moves wholesale to the orchestration `SpreadEngine`.

Changing the numbers is a one-line edit to `DefaultMarkup()` plus the table in `TestDefaultMarkup_ProductionTable`.

## Alternatives rejected

- **Leave `fee_kobo` at 0 and assert that in the test.** Honest, and the smallest change, but it silently accepts zero FX revenue on a live money path and hides the decision inside a test expectation.
- **Derive the fee from the rate difference** between the `/fx/rates` board mid and the firm `/fx/quote` rate. That difference is the *provider's* spread; booking it as Paymax revenue would misattribute Maplerad's margin to us.
- **Import `orchestration.SpreadEngine` directly.** Correct on numbers, wrong on dependency direction — see above.
