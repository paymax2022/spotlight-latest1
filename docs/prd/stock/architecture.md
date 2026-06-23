# Architecture

## Core Services (Go)
auth · user · kyc · suitability · investment-account · wallet-ledger · broker-adapter · market-data · order-management · portfolio · settlement · corporate-action · dividend · public-offer · rights-issue · fee-engine · limit-engine · risk-engine · notification · learn-content · ai-education · admin · audit · reconciliation · support · reporting · feature-flag.

---

## Provider Adapter Pattern (the spine)
Every provider integration implements an adapter interface; business logic depends on the interface, never the provider SDK. Providers are swappable via config + failover priority. Mock implementations first; real ones after sandbox validation.

### Broker Adapter
`CreateInvestmentAccount` · `GetAccountStatus` · `SubmitBuyOrder` · `SubmitSellOrder` · `CancelOrder` · `GetOrderStatus` · `GetPositions` · `GetCashBalance` · `GetTradeHistory` · `GetSettlementStatus` · `GetCorporateActions` · `GetDividends` · `HandleWebhook`

### Market Data Adapter
`SearchSymbols` · `GetQuote` · `GetHistoricalPrices` · `GetTopGainers` · `GetTopLosers` · `GetMostTraded` · `GetMarketStatus` · `GetCompanyProfile` · `GetNews` · `GetCorporateActions`

### Public Offer Adapter
`ListOffers` · `GetOffer` · `SubmitApplication` · `GetApplicationStatus` · `GetAllotmentStatus` · `GetRefundStatus`

Provider config (admin-managed): credentials-vault reference · API status · supported order types/exchanges/settlement · timeout · retry policy · maintenance mode · failover priority · health.

---

## Repo Structure
```
/apps/mobile/src/modules/invest/{screens,components,hooks,services,state,types,utils}
/apps/admin/src/modules/{invest,orders,compliance,risk,reconciliation,providers}
/services/<service>-service   (see Core Services above)
/packages/{shared-types,api-client,ui,errors,logger,feature-flags}
```

---

## Engineering Rules (full)
TypeScript for mobile/admin · Go structs for backend · idempotency keys for order creation · double-entry ledger for wallet movements · provider adapters for broker + market data · RBAC for admin · maker-checker for sensitive changes · audit logs for every admin action · feature flags for rollout · mock providers before real integration · server-side validation for all financial actions · encrypted secrets · webhook signature verification · reconciliation jobs · clear error states. Never hard-code assets, fees, limits, market hours, market data, broker settings, settlement rules, or product availability in the mobile app.

## Security (cross-cutting)
**User:** PIN for order confirmation · biometrics where enabled · OTP for new device · session + device mgmt · account freeze · withdrawal lock · login alerts · suspicious-activity reporting · failed-PIN lockout · risk-based auth.
**Admin:** mandatory 2FA · RBAC · maker-checker · session timeout · reason-required for privileged actions · IP/device monitoring · audit logs · no direct balance editing · no silent asset enablement · no unaudited fee change.
**Platform:** encryption in transit + at rest · secrets manager · webhook signature verification · idempotency keys · rate limiting · API gateway · circuit breakers · secure logging · pen testing · vuln scanning · DR + backup testing.

---

## Admin Roles (RBAC)
| Role | Scope |
|---|---|
| Super Admin | Full access, roles, feature flags, approve sensitive changes, all reports, audit logs |
| Compliance Admin | KYC/suitability/AML review, restrict users, freeze accounts, high-risk review, regulatory exports, disclosures |
| Trading Ops Admin | Monitor orders + broker status, handle failed orders, track settlement, corporate actions, provider logs, resolve exceptions |
| Finance Admin | View ledger, reconcile balances, revenue, settlement exports, review fees, approve financial adjustments |
| Product Admin | Stocks, public offers, rights issues, content, banners, campaigns, app config |
| Customer Support Admin | View profile/orders/wallet txns, tickets, escalate, request KYC resubmission. **Cannot** edit balances or approve adjustments |
| Risk Admin | Configure limits + risk rules, monitor suspicious behavior, restriction queue, approve/reject high-risk actions |
| Content Admin | Learn Center, Spotlight Wealth content, quizzes, FAQs, glossary |

---

## Claude Code Build Prompt (canonical)
Build the Paymax Invest **stock-trading** module for the existing Paymax super app, reusing existing authentication, wallet, design system, navigation, notification, and admin structures. Create a feature-flagged module named `invest`.

**Mobile features:** investment onboarding, KYC gating, suitability questionnaire, stock discovery, stock detail, watchlist, buy order, sell order, order status, portfolio, investment wallet, transaction history, receipts, public offers, rights issues, dividends, corporate actions, Learn Center, AI stock-education entry point, Spotlight Wealth Academy, alerts, security, support.

**Admin features:** user management, KYC review, suitability management, stock asset management, ETF management, public-offer management, rights-issue management, order management, settlement tracking, reconciliation, fee management, limits, risk rules, broker provider management, market-data provider management, corporate actions, dividends, notifications, campaigns, support tickets, reports, audit logs, roles, permissions, feature flags.

Use a provider-adapter architecture. Create **mock** broker and market-data providers first. Do not hard-code assets, fees, limits, market hours, broker settings, settlement rules, or product availability in the mobile app — all from backend config controlled by admin.

Every order must: pass server-side pre-trade checks → lock cash or shares → use an idempotency key → submit to provider → store provider reference → update order status → post ledger entries → update portfolio → generate receipt → trigger notification → enter reconciliation queue.

Every sensitive admin action must be audited and support maker-checker. No admin directly edits user balances; manual changes go through controlled adjustment + approval workflows. Prioritize compliance, safety, resilience, reconciliation, and clean UX over speed.
