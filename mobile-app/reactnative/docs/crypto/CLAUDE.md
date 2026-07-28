# Paymax Invest — Claude Code Working Memory

> Multi-asset (stocks + crypto) investing module inside the Paymax super app.
> Education-first, compliance-gated, partner-led execution. Codename: **Paymax Invest**.
> This file is always in context. Detailed specs live in `/docs` — read them on demand (see index below).

---

## Stack & Targets

| Layer | Choice |
|---|---|
| Mobile | React Native + TypeScript |
| Admin | Vue/Quasar (or existing Paymax admin console) |
| Backend | Go services, provider-adapter architecture |
| Data | PostgreSQL (ledger/financial) + MongoDB (content/flexible), Redis, Kafka/NATS |
| Integration | Module ships inside existing Paymax app — reuse current auth, wallet, design system, navigation |

---

## The 14 Non-Negotiable Engineering Rules

These apply to **every** change. If a task violates one, stop and flag it.

1. Never hard-code fees, assets, markets, providers, risk rules, or product availability in the client — all come from backend config.
2. Never trust client-calculated fees or eligibility. Server is authoritative.
3. Never execute an order without a server-side pre-trade check (see `docs/risk-controls.md`).
4. Never update a balance without a double-entry ledger record.
5. Never expose provider secrets to the frontend.
6. Every financial operation uses an **idempotency key**.
7. Every webhook **verifies its signature** and prevents replay.
8. Every admin action is **logged** (`AdminAuditLog`).
9. Every risky/regulated capability sits behind a **feature flag**.
10. Every order is **traceable** to a provider reference.
11. Every failed provider call is either safely retryable or marked final — never ambiguous.
12. Every provider integration goes through an **adapter interface** (never call a provider SDK directly from business logic).
13. Sensitive admin changes require **maker-checker** approval.
14. No direct DB balance edits — only the controlled manual-adjustment workflow.

---

## Architecture at a Glance

- **Provider-adapter pattern** is the spine. Four core adapters, each behind an interface so providers are swappable: Broker, Crypto Liquidity, Crypto Custody, Market Data. Full interface contracts in `docs/architecture.md`.
- **Ledger-first wallet.** The wallet never relies on provider balances alone; every movement is a double-entry `LedgerEntry`. See `docs/data-model.md`.
- **Order state machine** drives all trades. Stock and crypto have distinct status sets — `docs/data-model.md`.
- **Compliance gates everything.** A user passes KYC tier + suitability + agreements + eligibility before any trade. `docs/compliance.md`.

```
Client ──> API (server-side pre-check + idempotency) ──> Order Mgmt ──> Adapter ──> Provider
                                  │                            │
                              Risk/Limit/Fee engines     Wallet Ledger (double-entry)
                                  │                            │
                              Audit + Reconciliation <─────────┘
```

---

## Build Order (do not skip ahead)

1. Shared types (TS) + Go structs → `packages/shared-types`
2. Feature flags
3. Investment onboarding + KYC gating
4. Suitability questionnaire
5. Asset listing + watchlists
6. **Mock** provider adapters (stock, crypto liquidity, custody, market data, KYC)
7. Order state machine
8. Wallet ledger integration (balance locking)
9. Portfolio calculation
10. Admin: asset control → order monitoring → risk settings → provider settings → audit logs
11. Reconciliation
12. Real provider adapters (only after sandbox validation)
13. Compliance reports → production monitoring

Mock adapters first, real ones last. Trading stays feature-flagged off until compliance + provider readiness.

---

## Repo Structure

```
/apps/mobile/src/modules/{invest,wallet,auth,profile,learn}
  invest/{screens,components,hooks,services,state,types,utils}
/apps/admin/src/modules/{invest,compliance,orders,providers,risk,reconciliation}
/services/{auth,user,kyc,suitability,investment-account,wallet-ledger,order,
           portfolio,market-data,pricing,stock-broker-adapter,
           crypto-liquidity-adapter,crypto-custody-adapter,risk-engine,
           fee-engine,notification,compliance,reconciliation,admin,audit}-service
/packages/{shared-types,api-client,ui,config,logger,errors,feature-flags}
```

---

## Every Trade-Confirmation Screen Must Show

Fees · risk disclosure · order summary · and require **PIN/biometric** confirmation. No exceptions.

## Every Screen Must Handle These States

loading · empty · error · restricted · KYC-pending · market-closed · product-unavailable.

---

## Doc Index — read on demand

| File | Read it when… |
|---|---|
| `docs/product.md` | You need scope, segments, MVP boundaries, or release-phase gating |
| `docs/compliance.md` | Touching KYC, suitability, agreements, access tiers, or anything regulated |
| `docs/architecture.md` | Building services, adapters, or wiring providers |
| `docs/data-model.md` | Defining entities, statuses, enums, or ledger records |
| `docs/api.md` | Adding/changing endpoints |
| `docs/modules.md` | Implementing a feature (stock, crypto, wallet, portfolio, learn, AI, Spotlight) |
| `docs/screens.md` | Building/locating a specific mobile or admin screen |
| `docs/acceptance.md` | Writing tests or verifying a feature is "done" |

---

## Hard MVP Exclusions (do NOT build)

Margin · futures · options · derivatives · perpetuals · leverage · auto-copy trading · token launchpad · NFT marketplace · crypto lending · staking/yield · P2P crypto · guaranteed returns · unmoderated trade-signal chat · unlicensed investment advice · self-custody of customer crypto without licensing. Full list + rationale in `docs/product.md`.
