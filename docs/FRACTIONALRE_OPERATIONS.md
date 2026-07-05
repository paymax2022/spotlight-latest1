# Fractional Real Estate (FRE) — Operations Notes

Production-readiness clarifications for the fractionalre module (backend
`backend/internal/fractionalre/`, admin console `/admin/fractionalre`, mobile
`mobile-app/reactnative/src/features/fractionalre/`). Companion to
`docs/devops/GO-LIVE-FINAL.md`.

## How investor payouts settle — auto-credit, no manual claim

Distribution payouts are **pushed to the investor's wallet by the ledger** on checker
approval. There is no claim step and no claim endpoint anywhere in the route table
(`backend/internal/fractionalre/routes.go`); the investor-facing
`GET /portfolio/payouts` (routes.go:87) is read-only history.

Evidence (`backend/internal/fractionalre/service_distributions.go`):

- **:170** — approval resolves the escrow standing account:
  `s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)`.
- **:190–191** — each pending line is paid via
  `s.ledger.Credit(ctx, ln.UserID, ref, ln.IdempotencyKey, escrowAcc.ID, ln.NetKobo)`
  with `ref = "fre-distribution:<distributionID>:<userID>"` — a balanced double-entry
  posting that debits escrow and credits the investor wallet
  (`backend/internal/finance/ledger/service.go:45`).
- **:199** — investor is notified: "credited to your wallet".
- **:192–206** — idempotent + retryable: a duplicate key (`ledger.ErrDuplicate`) counts
  as already-paid; a failed line stays pending and a re-approve retries it; the run is
  marked `paid` (all lines) or `partial` (some failed).
- **:84–101** — per-line amounts are integer kobo, pro-rata by cap-table units, with the
  rounding remainder assigned to the last holder so Σ(net lines) == net pool exactly.
  Per-line idempotency key = `<run key>:<userID>` (:101).

## Maker-checker distribution flow

All admin distribution routes are RBAC-gated (`routes.go:144–148`); SoD is enforced in
the service, not just the UI.

1. **Maker** — `POST /admin/distributions` (PermFinance) → `ScheduleDistribution`
   (service_distributions.go:26): requires an `Idempotency-Key` (money path), validates
   gross/fee/withholding, computes net pool and per-investor lines. **No money moves.**
2. **Preview** — `GET /admin/distributions/:id/preview` (PermSupport): run + lines +
   exceptions. No money moves.
3. **Submit** — `POST /admin/distributions/:id/submit` (PermFinance): draft → submitted
   (idempotent; scheduling already submits).
4. **Checker** — `POST /admin/distributions/:id/approve` (PermDistributionApprove) →
   `ApproveDistribution`: **the approver MUST differ from the maker**
   (service_distributions.go:159–161, `ErrMakerChecker`), then pays each line
   escrow → wallet as above. Every step writes an audit event.

## Escrow reconciliation

- **Existing:** `GET /admin/finance/escrow` (routes.go:160, PermFinance) — escrow
  balance view per round.
- **Being added (backend pass in flight):** an admin **GET reconciliation** endpoint
  under the same finance group, comparing the escrow ledger balance against the sum of
  subscriptions − refunds − distributions. Ops should treat any non-zero variance as a
  release blocker for the affected round.

## Market halt switch

- **Global:** `PUT /admin/market/controls` (routes.go:153, PermFinance) — trading
  paused/enabled, secondary fee (bps), NAV price band. A **GET at the same path is
  being added**; the admin market page (`frontend-admin/app/admin/fractionalre/market/`)
  now reads it to show current state and degrades to an em-dash display if the GET 404s
  on a lagging backend.
- **Per-listing:** `POST /admin/market/listings/:id/halt` (routes.go:152, PermCompliance),
  reason required.

## Go-live env matrix

| Surface | Setting | Default | Go-live |
|---|---|---|---|
| Go backend | `FEATURE_FRACTIONAL_RE_ENABLED` (`config.go:525` → `cfg.FeatureFractionalREEnabled`, wired at `app/finance_routes.go:2238`) | `false` | `true` |
| Mobile (RN) | `EXPO_PUBLIC_FRACTIONALRE_USE_MOCK` | `true` | `false` |
| Admin | `NEXT_PUBLIC_FRACTIONALRE_ADMIN_USE_MOCK` (`src/services/fractionalreAdminService.ts:19`) | `true` | `false` |

Migrations (additive-only, apply locally with `supabase migration up` / `db reset`;
`db push` only at go-live):

- `supabase/migrations/20260705000000_fractionalre_module.sql`
- `supabase/migrations/20260705000100_fractionalre_rbac.sql`
- `supabase/migrations/20260831000000_fre_beneficiaries_hardening.sql` *(new — landing
  with the current backend pass)*

## Deferred scope (matches `mobile-app/reactnative/src/features/fractionalre/DEFERRED.ts`)

Intentionally NOT built in this MVP (PRD §8):

- Diaspora / USD-FX wallet (multi-currency funding & FX settlement)
- Syndicate / group investing (pooled SPVs)
- REIT wrapper / listed REIT units
- Sharia-compliant (non-riba) offerings & screening
- Blockchain-title overlay (on-chain title registry / tokenised units)

Reused, not rebuilt: KYC routes to the existing `/kyc` flow; wallet top-up uses the
existing add-money flow.
