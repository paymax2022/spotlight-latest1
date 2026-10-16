# ADR-PR<pr-number> — VertoFX is the default FX provider via preferred-with-score-fallback routing

- **Status:** Proposed
- **Date:** 2026-10-16
- **Deciders:** money-path (FX / orchestration)
- **Supersedes:** nothing
- **Related:** ADR-029 (FX orchestration ledger), `backend/internal/finance/fx/orchestration`

## Context

FX orchestration selects a provider purely by best score across the registered
providers (Maplerad, Eversend). We are adding VertoFX (SP-1) and want it to be
the default provider where it can serve a corridor, without losing best-price
failover and without a hard dependency on a single vendor. The adapter ships
dark behind `FEATURE_VERTOFX`.

## Decision

Introduce a config-driven **preferred-with-score-fallback** mechanism:

- `FX_DEFAULT_PROVIDER` (env) names the preferred provider.
- `orchestration.NewService` accepts a `WithDefaultProvider` option.
- `applyDefaultProvider` promotes the default to Best only when it is a viable
  candidate AND `Supports(corridor, rail)`; otherwise selection is pure best-score.
- `executeWithFailover` still tries the remaining alternatives after the
  preferred provider fails.
- Collections try the default first via a same-currency corridor.
- When `FX_DEFAULT_PROVIDER` is unset, behaviour is unchanged (pure best-score).
- VertoFX is registered only when `FEATURE_VERTOFX` is on; with the flag off the
  default cannot be a viable candidate and routing falls back to score.

## Alternatives considered

1. **Hard-pin** the default provider: simple, but a provider outage or unsupported
   corridor fails the request, and removing it needs a code change.
2. **Score-bias weight** toward VertoFX: keeps one ranking path, but the effect is
   opaque, corridor-dependent, and can silently mask a genuinely better price.

Preferred-with-fallback was chosen because it is reversible via config alone,
causes no regression when unset, and preserves best-price failover.

## Consequences

- Operators can change or disable the default with an env change, no deploy of code.
- With empty credentials VertoFX runs in offline-mock mode and could win default
  routing in non-prod; `buildFXProviders` now logs a warning for this case.
- Deferred to SP-3: pricing items (`fxMarkup` unit and stacking behaviour).
- Follow-ups gated on sandbox verification: V3, V6, V7, V19.
