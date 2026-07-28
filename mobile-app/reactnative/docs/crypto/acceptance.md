# Acceptance & QA

## Acceptance Criteria

**Onboarding**
- User cannot trade before required KYC + suitability complete.
- User must accept all active agreements before trading.
- User sees only products available in their country + tier.
- User gets clear risk warning before first trade.

**Stock Trading**
- Search/view eligible stocks · place buy/sell · see fees before confirm · authorize with PIN/biometric · order status updates correctly · portfolio updates after execution · failed orders show clear reason · every order has provider reference + audit trail.

**Crypto Trading**
- View approved assets · request quote · quote expires after configured time · see spread/fees/estimate · confirm before execution · portfolio updates on success · withdrawals follow risk rules · admin can disable any asset instantly.

**Wallet**
- Balances reconcile with ledger · locked funds visible · failed trades release locked funds · withdrawals obey limits · receipts generated.

**Admin**
- Enable/disable products · manage asset whitelist · view all orders · configure fees + limits · review KYC + AML · all actions audited · sensitive changes require maker-checker.

---

## QA Test Matrix

**Unit:** fee calc · limit checks · suitability scoring · eligibility rules · order state transitions · quote expiry · ledger posting · portfolio calc · risk scoring · provider adapter mocks.

**Integration:** KYC→trading eligibility · funding→order placement · stock buy/sell flows · crypto buy/sell flows · failed provider response · webhook processing · reconciliation · admin asset disable · admin user restriction.

**Security:** unauthorized admin access · role-permission bypass · idempotency replay · webhook spoofing · balance manipulation · client fee tampering · withdrawal abuse · device-change withdrawal attempt · brute-force PIN.

**UAT:** beginner completes onboarding · user understands risk before trading · buys first stock · buys first crypto · views portfolio · downloads receipt · admin disables risky asset · compliance freezes suspicious account · finance reconciles provider balances.

---

## KPIs

**Activation:** onboarding starts · KYC completion · suitability completion · first-deposit · first-trade · learn-to-trade conversion · Spotlight campaign conversion · referral conversion.

**Engagement:** monthly active investors · watchlist usage · portfolio views · repeat trades · lessons completed · alerts created · AI sessions · statement downloads.

**Revenue:** stock revenue · crypto spread · FX · withdrawal fees · campaign · partner share · ARPI · LTV.

**Risk:** failed-order rate · reconciliation exceptions · AML alerts · fraud losses · chargebacks · suspicious withdrawals · ATO attempts · complaint rate · regulatory incidents.

**Product quality:** order success rate · quote success rate · provider uptime · crash rate · API latency · support resolution time · KYC review time · withdrawal processing time.
