# Acceptance & KPIs

## Acceptance Criteria

**Onboarding**
- Cannot trade before KYC approval · before suitability completion · before accepting active agreements.
- User sees only eligible products. User can resume onboarding after leaving.

**Stock Discovery**
- Search by company name + ticker · filter stocks · view detail · add to watchlist · view market status.

**Buy Order**
- Enter amount or quantity · server-side pre-check runs · see estimated price + fees · confirm with PIN/biometric · **cash locked before submission** · order status visible · portfolio updates after fill · failed order releases locked cash.

**Sell Order**
- Sell available shares · system prevents selling locked/unavailable shares · see estimated proceeds + fees · **shares locked before submission** · cash → pending settlement after fill · cash available after settlement.

**Portfolio**
- View holdings · gain/loss · cash · pending settlement · export statement.

**Admin**
- Enable/disable stock · configure fees · configure limits · view orders · manage failed orders · view reconciliation exceptions · all actions audited · sensitive changes require approval.

---

## KPIs

**Activation:** invest-tab visits · onboarding start · KYC completion · suitability completion · first deposit · first trade · first watchlist · learn-completion-before-first-trade.

**Trading:** buy + sell volume · order success rate · failed-order rate · avg order value · repeat-trade rate · market-order vs limit-order usage.

**Portfolio:** active portfolios · avg portfolio value · holdings per user · dividend-tracking users · view frequency · statement downloads.

**Revenue:** commission · service fee · public-offer · withdrawal-fee revenue · referral campaign cost · revenue per active investor.

**Risk:** AML alerts · frozen accounts · reconciliation exceptions · support complaints · failed settlements · account-takeover attempts · refund/reversal rate.

**Learning:** lesson completion · quiz pass rate · learn-to-trade conversion · Spotlight campaign conversion · AI assistant sessions · scam-prevention completion.

---

## QA focus (derive tests from these)
- **Unit:** fee calc · limit checks · suitability scoring · eligibility rules · order state transitions · ledger posting · portfolio calc · settlement transitions · provider adapter mocks.
- **Integration:** KYC→trading eligibility · funding→order placement · buy/sell flows · failed provider response · webhook processing · settlement → cash/share release · reconciliation · admin asset disable · admin user restriction.
- **Security:** unauthorized admin access · role-permission bypass · idempotency replay · webhook spoofing · balance manipulation · client fee tampering · withdrawal abuse · brute-force PIN.
- **UAT:** beginner completes onboarding · understands risk before trading · buys first stock · sells a holding · views portfolio · downloads receipt/statement · admin disables a stock · compliance freezes a suspicious account · finance reconciles broker balances.
