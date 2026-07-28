# Architecture

## Core Services (Go)
auth · user-profile · kyc · suitability · investment-account · wallet-ledger · stock-broker-adapter · crypto-liquidity-adapter · crypto-custody-adapter · market-data · pricing · order-management · portfolio · corporate-actions · risk-engine · limit-engine · fee-engine · notification · learn-content · ai-education · admin · audit-log · reconciliation · compliance-reporting · webhook · feature-flag.

---

## Provider Adapter Pattern (the spine)
Every provider integration implements an adapter interface. Business logic depends on the interface, never the provider SDK. Providers are swappable via config + failover priority. Mock implementations first; real ones after sandbox validation.

### Broker Adapter
`createAccount` · `getAccountStatus` · `getBuyingPower` · `submitOrder` · `cancelOrder` · `getOrderStatus` · `getPositions` · `getTransactions` · `getCorporateActions` · `getStatements` · `webhookHandler`

### Crypto Liquidity Adapter
`getSupportedAssets` · `getQuote` · `executeQuote` · `buy` · `sell` · `swap` · `getTransactionStatus` · `getLiquidityStatus` · `webhookHandler`

### Crypto Custody Adapter
`createWallet` · `getDepositAddress` · `getBalance` · `getTransactionStatus` · `initiateWithdrawal` · `estimateNetworkFee` · `addressScreening` · `webhookHandler`

### Market Data Adapter
`searchAssets` · `getQuote` · `getHistoricalCandles` · `getMarketStatus` · `getTopMovers` · `getNews` · `getCorporateActions` · `getFxRates`

Provider config (admin-managed): health, failover priority, credentials-vault reference, timeout, retry policy, circuit-breaker, maintenance mode.

---

## Repo Structure
```
/apps/mobile/src/modules/{invest,wallet,auth,profile,learn}
  invest/{screens,components,hooks,services,state,types,utils}
/apps/admin/src/modules/{invest,compliance,orders,providers,risk,reconciliation}
/services/<service>-service   (see Core Services above)
/packages/{shared-types,api-client,ui,config,logger,errors,feature-flags}
```

---

## Mandatory Engineering Rules (full)
- Never hard-code provider logic in UI · fees in app · market schedules · asset availability.
- Never trust client-calculated fees.
- Never execute orders without server-side pre-check.
- Never update balances without ledger entries.
- Never expose provider secrets to frontend.
- Every financial op uses idempotency keys.
- Every webhook verifies signature (+ replay prevention).
- Every admin action is logged.
- Every risky action is feature-flagged.
- Every order is traceable (provider reference).
- Every failed provider call is safely retryable **or** marked final.

## Security (cross-cutting)
**User:** PIN for all trade confirmations · biometrics after PIN · OTP for new device · withdrawal lock · crypto-withdrawal cooling period (new devices) · address whitelist · session/device mgmt · login alerts · failed-login lockout · self-freeze.
**Admin:** mandatory 2FA · RBAC · IP allowlist for sensitive roles · maker-checker · session timeout · device binding · audit logs · reason-required for privileged actions · no direct DB balance edits.
**Platform:** encryption at rest + in transit · secrets manager · idempotency · webhook signatures · replay prevention · rate limiting · circuit breakers · fraud monitoring · pen testing · vuln scanning · secure SDLC · audit trails · DR + backup/restore testing.

---

## Admin Roles (RBAC)
| Role | Scope |
|---|---|
| Super Admin | Full access, approve high-risk changes, create admins, audit logs |
| Compliance Admin | KYC/AML review, restrict users, approve withdrawals, reports, disclosures, agreements, regulatory exports |
| Trading Ops Admin | Monitor orders, retry failed provider calls, reconcile trades, provider status, market schedules |
| Product Admin | Fees, asset display, education content, campaigns, notifications |
| Finance Admin | Wallet/provider reconciliation, fee revenue, settlement reports, accounting exports |
| Customer Support Admin | View profiles/orders, tickets, escalate, trigger re-KYC. **Cannot** alter balances or approve withdrawals (unless granted) |
| Risk Admin | Configure limits, fraud rules, suspicious-activity review, freeze accounts, release holds (maker-checker) |
| Content Admin | Learn Center, Spotlight Wealth videos, quizzes, banners, FAQs |

---

## Claude Code Build Prompt (canonical)
Build the Paymax Invest module inside the existing Paymax super app using the current design system, navigation, auth flow, wallet architecture, and admin dashboard structure. Implement as a **feature-flagged** product covering: onboarding, KYC gating, suitability, asset discovery, watchlists, stock order flow, crypto quote flow, portfolio, transaction history, Learn Center, AI education entry point, and admin (asset mgmt, order mgmt, risk settings, provider settings, audit logs).

Clean modular architecture. Do not hard-code fees, assets, markets, providers, risk rules, or availability in the mobile app — all from backend config. Create **mock** provider adapters first (stock, crypto liquidity, crypto custody, market data, KYC). All order placement uses server-side pre-trade checks, idempotency keys, wallet balance locking, provider-reference tracking, ledger entries, and order state transitions.

Add TypeScript types (mobile/admin) and Go structs (backend). Implement API clients and all UI states: loading, empty, error, restricted, KYC-pending, market-closed, product-unavailable. Every financial confirmation screen shows fees, risk disclosure, order summary, and requires PIN/biometric.

For admin: RBAC, maker-checker on sensitive settings, full audit logs, asset enable/disable, fee config, limits config, provider health, failed-order queue, reconciliation exception queue, user restriction controls.

Prioritize safety, compliance, resilience, and clean handoff over speed. Reuse existing Paymax UI components; create new reusable components only when needed.
