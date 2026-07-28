# Product — Scope, Segments, MVP, Phases

## What it is
A regulated, education-first, multi-asset (stocks + crypto) investing product inside the Paymax super app. Two acquisition engines: existing **Paymax** financial users, and the **Spotlight** entertainment audience (creators, fans, contestants, youth). North star: become the trusted financial-growth layer where young Africans learn → fund → invest → build long-term discipline — not a loud speculation app.

**Brand promise:** *Learn. Fund. Invest. Grow.*
**Core principle order:** Compliance before conversion · education before trading · suitability before risky assets · partner-first execution · never guarantee returns · never hide fees · never allow unapproved assets · every balance reconciles · every admin action audited.

---

## Target Segments

| Segment | Core need |
|---|---|
| First-time investors | Plain-language onboarding, low minimums (₦1,000 entry), risk warnings, trust markers |
| Spotlight youth | Financial literacy, gamified learning, creator-led campaigns, responsible crypto education |
| Existing crypto users | Fast buy/sell, stablecoins, local funding, transparent fees, security |
| Stock beginners | Watchlists, summaries, dividends, corporate actions, simple order flow |
| Diaspora / cross-border | FX funding, multi-currency, jurisdiction rules, geo-eligible assets, screening |
| SMEs / groups | Investment clubs, shared watchlists, admin approvals, contribution tracking (non-custodial goals) |

---

## In Scope (MVP surface)
Onboarding · KYC/KYB gating · suitability + risk profiling · wallet funding/withdrawal (ledger-based) · stock discovery/detail/orders · crypto discovery/detail/quote-buy-sell · watchlists · portfolio · order & txn history · receipts/statements · Learn Center · AI education assistant (guardrailed) · price/portfolio alerts · security · support · referrals/Spotlight campaigns. Full admin suite (see `screens.md`). Backend services (see `architecture.md`).

## Out of Scope for MVP (build only with legal + license + partner capability)
Margin · futures · options · leveraged/perpetual crypto derivatives · auto-execution copy trading · token launchpad · NFT marketplace · crypto lending · staking · yield · P2P crypto · unregulated advice · guaranteed returns · auto-managed portfolios without license · social trading construable as advice · internal crypto custody without approved licensing.

---

## Launch Model (phased licensing posture)
- **Phase 1 — Partner-led:** Paymax = frontend, wallet-funding gateway, education, acquisition, order-initiation, compliance orchestration, support. Execution/custody/clearing handled by **approved partners**.
- **Phase 2 — Licensed sub-broker / digital investment service provider:** Paymax takes on onboarding, order routing, reporting, education, distribution.
- **Phase 3 — Multi-jurisdiction platform:** NGN equities, US stocks/ETFs via partner, crypto via regulated VASP, public offers/rights, T-bills/fixed income, mutual funds, creator investment clubs, SME education.

Do **not** act as direct broker/dealer/exchange/custodian/adviser until licensed.

---

## MVP Definition

**Must-have:** onboarding · KYC integration · suitability · agreements · investment wallet · stock + crypto watchlists · stock buy/sell via partner · crypto buy/sell via partner · portfolio · order history · receipts · basic Learn Center · admin (user mgmt, KYC review, asset mgmt, order monitoring, provider mgmt, fee mgmt, risk limits, audit logs) · reconciliation dashboard · push notifications.

**Should-have:** price alerts · public offers display · AI education assistant · corporate actions display · crypto withdrawal with manual approval · referral tracking · Spotlight Wealth Academy.

**Could-have:** demo trading · learn-and-earn · recurring buys · basket investing · group investment education.

**Must-NOT-have:** margin · futures · derivatives · guaranteed returns · unmoderated trade chats · auto-copy trading · unapproved staking/yield · unlicensed advice.

---

## Release Phases

| Phase | Ships |
|---|---|
| 0 — Foundation | Legal review, partner selection, licensing path, eligibility matrix, adapter design, ledger architecture, risk rules, admin RBAC, data model, feature flags |
| 1 — Education + Watchlist | Invest home, asset discovery, watchlists, Learn Center, suitability, KYC gating, delayed data. **No trading.** |
| 2 — Stock Trading MVP | Partner account creation, stock buy/sell, order status, portfolio, receipts, reconciliation, admin order mgmt, settlement tracking |
| 3 — Crypto Buy/Sell MVP | Crypto whitelist, quote engine, buy/sell, crypto portfolio, custody balance display, **withdrawals disabled or manual-review only**, AML monitoring |
| 4 — Full Wallet + Withdrawals + Alerts | Wallet transfers, bank withdrawals, crypto withdrawals with controls, price alerts, corporate actions, advanced statements |
| 5 — Spotlight Wealth Growth | Learn-and-earn, creator finance content, campaigns, referrals, event integration, youth literacy programs |
| 6 — Advanced Products | ETFs, public offers, rights issues, recurring buys, thematic baskets, group education, diaspora access, fixed income (where licensed) |

---

## Spotlight Integration — strict rules
Use entertainment reach for **education and trust**, not hype. Never: let celebrities directly recommend securities (unless approved) · present investing as gambling/contest · rank users by profit · enable pump-and-dump · ship unmoderated trade-signal chat (MVP) · ship "buy what your favorite artist buys" automation (MVP). Allowed: Wealth Academy, creator finance videos, literacy challenges, learn-and-earn quizzes, contest rewards as **wallet credit** (never guaranteed investment return).

---

## Key Risks → Mitigations (one-liners)
- **Regulatory:** partner-led launch, legal signoff, feature flags, country/product gating.
- **Market (users lose money):** disclosures, education-first, suitability, no guaranteed returns, risk labels, no aggressive push.
- **Provider downtime:** adapter pattern, health monitoring, circuit breakers, failover, maintenance mode.
- **Fraud (account takeover → crypto withdrawal):** device checks, cooling period, address whitelist, monitoring, manual review, self-freeze.
- **Reconciliation drift:** double-entry ledger, daily recon, exception queue, provider refs, no manual balance edits.
- **Reputation (Spotlight = gambling):** education-first, no profit leaderboards, no celebrity pump signals, no high-risk contests.
