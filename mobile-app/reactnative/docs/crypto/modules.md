# Feature Modules

## Invest Home
Surfaces: total investment balance · today's movement · portfolio value · stock/crypto/cash balances · pending settlement · watchlist carousel · trending · learn card · "Start with ₦1,000" · risk-profile + KYC + market status · quick actions (buy stock, buy crypto, sell, deposit, withdraw, learn, set alert).
Rules: prices per market-data entitlement · show delayed-data labels · show market-closed states · show eligibility warnings · **hide** assets outside user jurisdiction/tier · show risk banners for crypto/volatile assets.

---

## Stock Trading
**Products:** NGN equities · public offers · rights issues · ETFs · US stocks/ETFs (partner) · fractional (where supported) · dividend-tracking · watch-only.
**Discovery filters:** name/ticker · exchange · sector · popularity · dividend history · top gainers/losers · most watched · new listings · public offers · rights issues.
**Detail page must show:** name · ticker · exchange · price + movement · chart · market status · 52-wk range · market cap · volume · bid/ask · sector · summary · risk label · news · dividends · corporate actions · neutral educational summary · fees · settlement cycle · buy/sell · watchlist · alert.
**Order types (MVP):** market (where supported) · limit · buy · sell · cancel pending · view status. *(Post-MVP: stop, stop-limit, recurring, DRIP, basket, thematic.)*
**Order flow:** select → Buy → enter amount/qty → eligibility check → show est. price/fees/FX/settlement/disclosure → confirm → PIN/biometric → submit to broker → status → portfolio updates.
**Statuses:** see `data-model.md`.
**Corporate actions:** dividends, bonus, splits, rights, tender, delisting, suspensions, name changes, mergers, spin-offs. Admin uploads/syncs + triggers user notifications.

---

## Crypto Trading
**MVP:** buy · sell · price tracking · stablecoin buy/sell (where approved) · portfolio · history · education · custody-balance display via provider · withdrawals only after enhanced risk controls. *(Post-MVP: swaps, on-chain deposit/withdraw, network selection, address book, travel rule, recurring, baskets, proof-of-reserves.)*
**Every crypto asset is admin-whitelisted** with the full control set in `data-model.md`.
**Detail page:** name · symbol · price · 24h change · market cap · volume · chart · risk rating · description · network info · supported networks · buy/sell/deposit/withdraw/convert · watchlist · alert · risk-education card · volatility warning.
**Order flow:** select → Buy → enter fiat or qty → get quote → show expiry timer + fees + spread → confirm → PIN/biometric → submit → execute quote → portfolio updates → receipt.
**Quote contents + statuses:** see `data-model.md`.

---

## Wallet & Funding
Ledger-based (see `data-model.md`). Balances: cash · available-to-invest · pending settlement · locked · withdrawable · NGN/USD/stablecoin.
**Funding sources:** Paymax wallet · bank transfer · virtual account · card (where allowed) · USSD · open banking · internal transfer · group wallet (approved) · diaspora (licensed).
**Withdrawal destinations:** verified bank account · Paymax wallet · crypto address (approved) · partner custody wallet · internal transfer.

---

## Portfolio
Surfaces: total value · total + day + all-time gain/loss · stock/crypto/cash allocation · asset list with performance · average cost · qty held · market value · unrealized/realized G/L · dividends received · crypto deposits/withdrawals · pending orders/settlement · portfolio + allocation charts · export statement.
Views: simple (beginner) · advanced · asset-class · currency · performance · tax/reporting.

---

## Watchlist & Alerts
Watchlists: add stock/crypto · multiple lists · rename · remove · sort · share as educational content · performance · news · alerts.
**Alert types:** price above/below · % movement · volume spike · market open/close · order filled/rejected · settlement completed · crypto withdrawal confirmed · corporate action · dividend received · KYC required · risk-profile expired · terms update.

---

## Learn Center
Converts beginners into responsible investors before trading. Content: short/video lessons · quizzes · "explain like I'm new" cards · glossary · risk simulations · demo trading · Spotlight creator finance shows · weekly literacy · crypto safety · scam prevention · investing-vs-gambling.
**Paths:** Beginner (what is investing/stock/crypto/risk/diversification/fees, avoiding scams, first order) · Stock (NGN market, public offers, rights, dividends, corporate actions, order types, settlement) · Crypto (Bitcoin, stablecoins, wallets, keys, volatility, scams, on-chain txns, network fees, custody) · Spotlight Wealth (creator wealth, talent income, royalties, saving from performance income, fan economy, discipline).

---

## AI Investment Education Assistant
Educates and explains. **Does not give personalized financial advice unless Paymax holds the license + approved advisory framework.**

**Allowed:** explain terms · explain app usage · explain risk disclosures · summarize portfolio in neutral language · explain order status · explain volatility · explain public asset info · educational comparisons · find learning content · discipline tips · warn against emotional trading · explain diversification/fees/settlement conceptually.

**Prohibited:** "buy/sell X now" · "this will pump" · "guaranteed profit" · personalized portfolio advice without license · price predictions as certainty · encouraging leverage/high-risk trading · bypassing suitability · recommending ineligible assets.

**Guardrails:** system-level compliance policy · attach disclaimers · educational tone · refuse illegal/unsafe requests · route advice requests to licensed-adviser workflow (if available) · log interactions for compliance · admin can disable AI by region/product.
