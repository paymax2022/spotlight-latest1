# ADR-031 — One FX markup table for both FX surfaces

**Date:** 2026-08-13
**Status:** Accepted
**Deciders:** FX
**Scope:** `backend/internal/orchestration` (`spread.go`, new `spread_source.go`, `service.go`), `backend/internal/finance/fx` (tier-aware resolution), the orchestration wiring in `finance_routes.go`, and the `fx_markup_rates` schema. Extends **ADR-030**, which introduced the table.

## Context

ADR-030 moved the legacy wallet FX markup out of a Go constant into
`public.fx_markup_rates`, admin-tunable at runtime. It deliberately left the
**orchestration** module (`/api/v1/fx/*`) alone, and that left the platform with
**two FX surfaces pricing independently**:

| | legacy `/api/finance/fx` | orchestration `/api/v1/fx/*` |
|---|---|---|
| Rate source | `fx_markup_rates` (DB) | `SpreadEngine` rule table hardcoded in `finance_routes.go` |
| Default | 100 bps (1%) | 105 bps |
| USD-NGN | 100 bps (via DEFAULT) | 120 bps retail / 75 bps business |
| Admin-changeable | yes | **no — needed a deploy** |
| Per-tier pricing | no | yes |

The same corridor could therefore be charged two different markups depending on
which endpoint the client hit, and only one of the two could be corrected without
shipping code. That is a bad property for a customer-facing fee.

## Decision

**`public.fx_markup_rates` is the single source of truth for FX markup across
both surfaces.** Orchestration reads the same rows the legacy service does.

### Schema: the key becomes `(corridor, tier)`

Orchestration prices per customer tier and the legacy service does not, so the
table gained a `tier` column (`''` = any tier) and the unique index widened to
`(corridor, tier)`. `min_bps`/`max_bps` were added to preserve `SpreadRule`'s
per-corridor guard band. This was folded into the **unmerged**
`20261204000000_fx_markup_rates.sql` rather than shipped as a follow-up ALTER —
the migration had not left this PR branch, so amending it avoids introducing a
schema and immediately altering it (and avoids dropping a unique index, which the
additive-only rule forbids).

### Resolution is identical on both sides

`SpreadEngine.resolve` scores specificity as corridor(+2) + tier(+1), so
`corridor+tier > corridor > tier > default`. The SQL reproduces that exactly:

```sql
WHERE active
  AND (corridor = $1 OR corridor = 'DEFAULT')
  AND (tier = $3 OR tier = '')
ORDER BY ((corridor <> 'DEFAULT')::int * 2 + (tier <> '')::int) DESC
LIMIT 1
```

The legacy service passes `tier = ''` and therefore only ever matches the
tier-agnostic rows — which is exactly its pre-existing behaviour.

### Orchestration reloads once per operation

`SpreadEngine` gained an optional `SpreadSource` and a `Refresh(ctx)`.
`CreateQuote` calls it **once per quote** — not once per routing candidate — so
an admin change is live on the next quote with no restart, at the cost of one
query per quote. The engine is mutex-guarded because `Refresh` mutates the rule
card while a concurrent quote's candidate loop is reading it.

- `CreateQuote` **fails closed** on a refresh error (`spread_unavailable`).
  Pricing a real charge from a rule card we could not confirm is worse than
  not quoting.
- `Rates` (the *indicative* board) refreshes **best-effort** and logs on failure,
  serving the last-known card. It charges nothing, and blanking every pair over a
  transient config read is worse UX than a briefly stale display number.
- A missing `DEFAULT` row is an **error, not a zero** on both sides.

Orchestration queries the table directly rather than importing `finance/fx`:
this is a shared platform config table, and coupling the new module to the one it
supersedes purely to read a rate would be the wrong dependency direction. The one
duplicated constant (`"DEFAULT"`) is noted at both sites.

### Nothing was repriced

The seed lifts the existing orchestration rules verbatim — USD-NGN 120/75
business, USD-XAF 150, with their min/max bands — so pointing orchestration at
the table is a pure refactor. `TestSpreadUnification_SeedReproducesLegacyPricing`
compares the live card against a copy of the old in-code engine across the full
corridor × tier matrix and fails on any divergence.

**One deliberate exception:** the fallback for corridors with no explicit row
moves **105 bps → 100 bps** (1.05% → 1.00%), converging on the product-set rate
from ADR-030. That is asserted explicitly in the same test rather than left to be
discovered.

## Consequences

- One admin write at `PUT /api/finance/admin/fx/markup` now moves **both**
  surfaces. Adding `"tier": "business"` targets the orchestration tier rows; the
  legacy service is unaffected by tier rows, as before.
- Orchestration takes **one extra query per quote** (and per indicative-rates
  call). Both already do far more DB and provider work per request.
- The in-code rule table in `finance_routes.go` is now only a **bootstrap** value
  used before the first refresh. It is kept deliberately identical to the seed so
  the two agree even in that window; the DB is authoritative from the first quote.
- `fx_markup_rate_audit` records `tier` alongside corridor, so tier-specific rate
  changes are as attributable as any other.

## Alternatives rejected

- **Point `SpreadEngine` at the table but drop tier/min/max.** Simplest, and
  wrong: business-tier USD-NGN would silently move 75 → 120 bps. Unification must
  not reprice.
- **Have orchestration call `finance/fx` to resolve the rate.** Correct results,
  wrong dependency direction — the superseding module would depend on the
  superseded one, and pull its pgx store and provider client along with it.
- **Per-call DB resolution inside `EffectiveBPS`.** Exactly consistent, but the
  engine is consulted once per routing candidate and once per pair on the rates
  board, turning one quote into a dozen queries. Refreshing once per operation
  gives the same immediacy for one query.
- **A background ticker refresh (e.g. every 30s).** Fewer queries, but an admin
  correcting a wrong rate would watch it keep charging for up to 30s, and the
  staleness window would be invisible in the console.

## Follow-up

`SpreadEngine.FixedMinor` and `SpreadRule.FixedMinor` are dead code — defined,
never called anywhere in the backend — so the table models no fixed-fee
component. If a fixed component is ever wanted, it needs a column, a UI, and its
own decision; it should not be quietly revived from the struct field.
