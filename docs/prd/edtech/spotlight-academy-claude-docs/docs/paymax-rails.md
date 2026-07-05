# Paymax Rail Integration

These are **existing services**. Integrate via their contracts; never fork a second implementation.
Each rail is accessed behind a provider-agnostic adapter in this module.

| Rail | This module uses it for | Integration notes |
|---|---|---|
| **Identity / KYC / SSO** | Account, role upgrades, guardian consent, credential subject | One identity; capabilities additive; minors gated by consent + tier. Wrap in `identity-bridge`. |
| **Wallet & ledger** | Reward credits, points, redemptions, refunds | Append-only; balances derived; all credits idempotent. Rewards write here. |
| **BNPL** | Premium tracks, exam bundles, school-fee instalments | Eligibility + schedule owned by BNPL; this module flips entitlement on `bnpl_active`. |
| **Virtual accounts / bill-pay** | EduPay collections, save-for-school pots | School accounts + collection; pots are goal-savings on this rail. |
| **Payouts** | Tutor earnings, disbursements | Idempotent disbursement; reconcile + audit. |
| **Agent network** | Offline bundle + access-card distribution | Card inventory/activation; commissions on the agent rail. |
| **Loyalty** | Streak/engagement rewards, cross-module retention | Coordinate so EdTech rewards and Paymax loyalty don't double-count. |
| **Creator monetisation** | Graduation path for trade/creator credentials | Earning bridge routes here. |
| **Streaming (LiveKit, self-hosted)** | Live classes/events (C1–C3, T6) | Reuse Connect's streaming infra; provider-agnostic adapter. |
| **MapService / PostGIS** | School/agent geo features | Only where geo is needed. |

## Integration rules
1. **Adapter, not SDK leak.** Domain code calls an interface; the vendor/rail client lives in an adapter.
2. **Idempotency end-to-end.** Pass idempotency keys through to rail calls; persist the mapping.
3. **No shadow ledgers.** Value lives on the Paymax wallet ledger; this module reads/writes entries,
   never keeps a parallel balance.
4. **Entitlement is local; money is rail.** Purchases charge via the rail; access/entitlement state
   machines live here.
5. **Consent & KYC are preconditions**, evaluated via the identity rail before capability unlock.
6. **Reconcile + audit** every disbursement/collection; expose in the admin finance modules.

## Earning bridge (special case)
`credentials.evaluate_bridge` → eligible `EarningOpportunity` set → **route apply into the existing
Paymax role-upgrade/KYC flow**. This module surfaces opportunities and eligibility; Paymax owns the
actual role onboarding.
