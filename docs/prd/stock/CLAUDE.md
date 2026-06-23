# Paymax Invest (Stocks) — Claude Code Working Memory

> Stock-only investing module inside the Paymax super app. **No crypto, no forex, no derivatives.**
> NGN equities, ETFs, public offers, rights issues, dividends, corporate actions.
> Education-first, compliance-gated, **licensed-broker-led** execution.
> This file is always in context. Detailed specs live in `/docs` — read on demand (index below).

---

## Stack & Targets

| Layer | Choice |
|---|---|
| Mobile | React Native + TypeScript |
| Admin | TypeScript (existing Paymax admin structure) |
| Backend | Go services, provider-adapter architecture |
| Data | PostgreSQL (ledger/financial), Redis, queue |
| Integration | Ships inside existing Paymax app — reuse current auth, wallet, design system, navigation, notifications, admin |

**Operating model:** Phase-1 partner-led. Paymax = mobile experience + wallet funding + education + support + portfolio UX. A **licensed broker** executes orders; CSDC/clearing handles settlement; registrars handle dividends/corporate actions. Paymax reconciles user-facing balances against broker records. Do not act as a direct broker/dealer until licensed.

---

## The Non-Negotiable Engineering Rules

Apply to **every** change. If a task violates one, stop and flag it.

1. No trade without required KYC + suitability + accepted active terms.
2. No asset trades unless enabled by admin.
3. No order from client-side calculation only — server-side pre-check is mandatory.
4. Every order uses an **idempotency key** (prevents duplicate retry).
5. No wallet balance changes without **double-entry ledger** records.
6. No failed order traps user funds — failed buy releases locked cash, failed sell releases locked shares.
7. No admin edits balances directly — controlled adjustment + maker-checker only.
8. Every admin action is **audited**; sensitive changes need maker-checker.
9. Every order has a **provider reference** and is reconcilable.
10. Every fee is visible before confirmation.
11. Every market-data status is clearly labeled (delayed/real-time/closed).
12. Every risky/regulated capability sits behind a **feature flag**.
13. Never hard-code stocks, fees, limits, market hours, market data, or broker logic in the client — all from backend config.
14. Never expose provider secrets to frontend; verify every webhook signature.

---

## Architecture at a Glance

- **Provider-adapter pattern** is the spine. Three adapters behind interfaces so providers are swappable: **Broker**, **Market Data**, **Public Offer**. Full contracts in `docs/architecture.md`.
- **Ledger-first investment wallet**, logically separated from the main Paymax wallet. Every movement is double-entry. `docs/data-model.md`.
- **Order state machine** with cash/share locking and settlement tracking. `docs/data-model.md`.
- **Settlement + reconciliation** are first-class (T+N cycle, broker recon, exception queue). Don't treat "filled" as "settled."
- **Compliance gates everything**: KYC tier + suitability + agreements + eligibility before any trade. `docs/compliance.md`.

```
Client ─> API (server-side pre-check + idempotency) ─> Order Mgmt ─> Broker Adapter ─> Broker
                          │                               │                  │
                  Risk/Limit/Fee engines        Wallet Ledger          Settlement Service
                          │                       (double-entry)              │
                      Audit + Reconciliation <────────────────────────────────┘
```

---

## Build Order (do not skip ahead)

1. Shared types (TS) + Go structs → `packages/shared-types`
2. Feature flags
3. Investment onboarding + KYC gating
4. Suitability questionnaire
5. Stock discovery + watchlists
6. **Mock** provider adapters (broker, market data, public offer)
7. Order state machine (buy/sell, cash + share locking)
8. Investment wallet ledger integration
9. Portfolio + settlement tracking
10. Admin: stock asset control → order monitoring → fee/limit config → provider config → audit logs
11. Reconciliation
12. Dividends + corporate actions
13. Public offers + rights issues
14. Real broker/market-data adapters (only after sandbox validation)
15. Reports + production monitoring

Mock adapters first, real ones last. Trading stays feature-flagged off until compliance + broker readiness.

---

## Repo Structure

```
/apps/mobile/src/modules/invest/{screens,components,hooks,services,state,types,utils}
/apps/admin/src/modules/{invest,orders,compliance,risk,reconciliation,providers}
/services/{investment-account,suitability,order,portfolio,wallet-ledger,broker-adapter,
           market-data,public-offer,rights-issue,corporate-action,dividend,
           fee-engine,limit-engine,risk-engine,reconciliation,audit,notification}-service
/packages/{shared-types,api-client,ui,errors,logger,feature-flags}
```

---

## Every Trade-Confirmation Screen Must Show
Estimated units/price · fees · total debit/proceeds · settlement timeline · risk disclosure · and require **PIN/biometric**.

## Every Screen Must Handle These States
loading · empty · error · restricted · KYC-pending · suitability-pending · no-portfolio · market-closed · product-unavailable.

---

## Doc Index — read on demand

| File | Read it when… |
|---|---|
| `docs/product.md` | Scope, segments, MVP boundaries, release-phase gating |
| `docs/compliance.md` | KYC, suitability, agreements, access tiers, risk controls |
| `docs/architecture.md` | Services, adapters, RBAC, the Claude Code build prompt |
| `docs/data-model.md` | Entities, statuses, ledger, settlement |
| `docs/api.md` | Adding/changing endpoints |
| `docs/modules.md` | Implementing a feature (orders, wallet, portfolio, offers, rights, dividends, corp actions, learn, AI, Spotlight) |
| `docs/screens.md` | Building/locating a mobile or admin screen |
| `docs/acceptance.md` | Writing tests or verifying "done" |

---

## Hard MVP Exclusions (do NOT build)
Crypto · forex · options · futures · margin · securities lending · short selling · leverage · auto-copy trading · unlicensed advice · guaranteed returns · unmoderated stock-tip rooms · prediction trading games · profit leaderboards · pump-and-dump social rooms · robo-advisory without licensing · direct management of client assets without approval. Full list in `docs/product.md`.
