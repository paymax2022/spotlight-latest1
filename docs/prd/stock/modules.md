# Feature Modules

## Investment Home
Command center for the user's stock portfolio. Components: total portfolio value · today's + total gain/loss · available cash · pending settlement · invested amount · watchlist · trending · top gainers/losers · public offers · rights issues · dividend updates · learn card · Spotlight Wealth card · market status · quick actions (buy, sell, deposit, withdraw, portfolio, learn).
**States:** new user · KYC pending · suitability pending · no portfolio yet · active investor · market closed · restricted · suspended.

---

## Stock Discovery
**Search:** company name · ticker · sector · exchange · market board.
**Browse:** top gainers · top losers · most traded · most watched · dividend stocks · public offers · rights issues · ETFs · beginner-friendly · Spotlight education picks.
**Filters:** exchange · sector · price range · dividend history · market cap · risk rating · popularity · watchlist status · eligibility · trading enabled · public offer available · rights issue available.
**Sort:** name · ticker · price · daily change · volume · market cap · dividend yield · most watched · most bought on Paymax · recently listed.

---

## Stock Detail
**Must show:** name · ticker · exchange · sector · price + movement · chart · market status · 52-wk high/low · volume · market cap · bid/ask (where available) · description · risk rating · news · dividend history · corporate actions · fees · settlement period · minimum buy · buy/sell · watchlist · price alert · learn-about-this-stock · disclosure label.
**Beginner mode:** "what does this company do?" · "why does price move?" · "what are the risks?" · "what happens after I buy?" · "when can I sell?" · "how dividends work."
**Advanced mode:** chart + time ranges · order book (where supported) · financial metrics · corporate actions · historical data · news · neutral facts · advanced order options.

---

## Order Management
**Types — MVP:** buy · sell · market (where supported) · limit (where supported) · cancel pending (where supported). **Post-MVP:** stop · stop-limit · recurring buy · basket buy · dividend reinvestment · thematic plan · conditional alert-to-order.

**Buy flow:** select stock → Buy → enter amount/qty → server pre-check (KYC, suitability, wallet balance, eligibility, asset status, market status, limits, risk) → order review (est. units, est. price, fees, total debit, settlement timeline, risk disclosure) → PIN/biometric → **server locks cash** → submit to broker → status returned → portfolio updates on fill → ledger posts final entries → settlement tracked → receipt generated.

**Sell flow:** open holding → Sell → enter units/amount → check available quantity + market status + restrictions → review (fees, est. proceeds, settlement) → confirm → submit → **shares locked** → status updates → cash becomes pending settlement → available after settlement.

**Statuses + failed-order rules:** see `data-model.md`.

---

## Wallet & Funding
Investment cash wallet, logically separate from main Paymax wallet. Balances, ledger rules, funding sources, withdrawal destinations, transaction types: see `data-model.md`.

---

## Portfolio
Features: total value · total cash · total invested · today's + all-time gain/loss · realized + unrealized G/L · dividends received + pending · asset + sector allocation · holding list · performance chart · transaction history · statement export.
**Holding detail:** company · ticker · quantity · average buy price · current price · market value · unrealized G/L · today's movement · total dividends received · pending settlement · buy more · sell · set alert · view transactions.
**Beginner explanations:** average price · unrealized gain · pending settlement · dividends-not-guaranteed.

---

## Watchlists & Alerts
Watchlists: default + multiple · add/remove/rename/sort · performance · news · share for education · Spotlight campaigns.
**Alert types:** price above/below · % gain/loss · market open/close · stock suspended · public offer opened · rights issue opened · dividend announced/paid · corporate action · order filled/rejected · settlement completed · cash available · KYC required · terms update required.

---

## Public Offers
Discover + subscribe via approved channels. Features: list · detail · prospectus link · issuer profile · offer price · minimum subscription · opening/closing date · oversubscription note · risk disclosure · application + payment flow · application receipt · application/allotment/refund status.
**Statuses:** see `data-model.md`. Every offer must show **official offer details**.

---

## Rights Issues
For eligible existing shareholders. Features: list · eligibility check · entitlement · acceptance · partial acceptance · renunciation (where supported) · additional-shares application (where supported) · payment · receipt · status tracking · reminders.
**Statuses:** see `data-model.md`.

---

## Dividends
Make dividends visible + understandable. Features: history · received · expected · announcement · ex-dividend/record/payment dates · mandate status · registrar details · unclaimed/e-dividend education · dividend statement.
**Educate on:** what a dividend is · why not guaranteed · ex-dividend vs record date · why payment takes time · mandate · unclaimed dividends.

---

## Corporate Actions
**Types:** dividend · bonus issue · stock split · reverse split · rights issue · public offer · merger · acquisition · delisting · suspension · name change · share reconstruction · tender offer.
**Requirements:** display to affected users · notify · admin upload or provider sync · store source reference + affected asset + effective dates + user impact · track acknowledgement where needed. Every action traceable to a source.

---

## Learn Center (education-first)
**Categories:** stock basics · how to buy/sell shares · risk + volatility · dividends · public offers · rights issues · ETFs · corporate actions · portfolio management · avoiding scams · emotional discipline · long-term investing · investing-vs-gambling · Spotlight creator wealth academy.
**Formats:** short/video/audio lessons · quizzes · glossary · infographics · demo investing · risk simulator · creator stories · TV-show snippets · event-based lessons · learn-and-earn.
**Learn-and-earn rewards:** wallet credits · fee discounts · badge · certificate · Spotlight points · event perks. **Never:** guaranteed return · reward for risky trades · reward by profit ranking · encouraging reckless trading.

---

## AI Stock Education Assistant
Explains stocks, fees, risk, orders, dividends, portfolio language — **no unlicensed financial advice.**
**Allowed:** explain terms/order status/portfolio metrics/dividends/public offers/rights issues/risks/fees/settlement · explain market vs limit order · help find lessons · summarize official company info in neutral language · warn against reckless trading.
**Not allowed:** "buy/sell this stock now" · "this stock will go up" · "guaranteed profit" · personalized advice without license · pump language · celebrity-driven instructions · bypassing suitability/KYC · promoting manipulation.
**Mandatory disclaimer on every response:** *"This is educational information, not financial advice. Stock prices can rise or fall. Please review the risks before investing."*

---

## Spotlight Wealth Integration
Features: Wealth Academy · creator wealth stories · "From Talent to Shareholder" campaigns · stock basics for entertainers · royalties-to-investing education · fan literacy challenges · monthly wealth livestream · TV/radio segments · public-offer awareness · sponsored education · learn-and-earn badges · creator income planning.
**Strict controls:** see `product.md`.
