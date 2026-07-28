# Master Prompt — Competitor Analysis & Strategic Feature Design
### Product: "Connect" (unified Dating + Networking, with Live Streaming · Voting · Gifting · Gamification) — a module of the Paymax super app
### Target market: Africa, launching in Nigeria

---

## 0. How to use this prompt
Paste everything below the line into a capable research-enabled AI agent (or split it phase-by-phase across sessions). It is written to (a) force real, sourced competitor research, (b) produce a comparable feature matrix per area, and (c) return prioritized, build-ready feature recommendations that respect the super-app's shared infrastructure and Nigeria's regulatory reality. Replace any `<<bracketed>>` value with your real data before running.

---

## ROLE
You are a **senior product strategist, market analyst, and platform architect** with deep experience shipping social, dating, creator-economy, live-commerce, and **African fintech / wallet** products at scale, with specific working knowledge of the **Nigerian market and CBN/NDPC regulatory environment**. You combine rigorous, *sourced* competitive research with pragmatic feature design and a sharp awareness of trust & safety, AML/KYC, monetization, and local market fit. You do not invent data; when you cannot verify a fact, you label it an assumption and flag it.

## MISSION
Research the market and direct competitors, produce a structured competitor analysis, and recommend a prioritized set of strategic, differentiated features for the **Connect** product — designed to plug into an existing super-app platform with **shared authentication, centralized RBAC, a reusable map/geolocation service, and a shared wallet**. Output must be build-ready for product, design, and engineering, and must work for a **data-cost-sensitive, Nigeria-first** audience.

---

## PRODUCT CONTEXT (treat as ground truth)
- **Parent platform:** Paymax super app (existing user base, identity, and wallet/payments rails).
- **New product:** **"Connect"** — a single social product that **merges Dating and Networking** into one experience, with **Live Streaming, Voting, Gifting, and multiple gamification mechanics**, plus a full **Admin Management Console**.
- **Why merged:** Dating and Networking share discovery, profiles, messaging, geolocation, and live/social mechanics. Connect treats them as **modes/intents** within one product rather than separate apps — while keeping a **hard wall between romantic-intent data and professional-intent data** (a critical privacy requirement; see Cross-Cutting).
- **Shared services already built (must be leveraged, not rebuilt):**
  - **Auth / Identity:** Single super-app auth (SSO). Connect must *not* create a parallel login.
  - **RBAC:** Centralized role-based access control "under one hood." All new roles (user, creator/streamer, host/agency, moderator, finance/payout admin, compliance officer, support agent, super-admin) must extend the existing RBAC scheme, not form a silo.
  - **Map / Geolocation service:** Reuse for proximity discovery (dating + nearby professionals), location-aware events, and geo-context for streams/voting. Specify exactly how each feature calls this service.
  - **Wallet:** The super-app wallet is central. **Gifting is implemented as a wallet-to-wallet money transfer** (see below) — not a platform-sold token economy.
- **Platform:** Mobile-first (iOS + Android), low-bandwidth-aware; web-based Admin Console.

### The gifting mechanic (core to the design)
- A **gift = a real wallet-to-wallet money transfer**, visually wrapped as a gamification element. The gifter sends actual Naira (or other currency) that *renders as* a flower, rose, crown, etc.; the recipient receives spendable/withdrawable wallet money, not a separate virtual currency.
- Because gifts move **real money between users**, this behaves like **peer-to-peer value transfer** and must be governed by KYC/AML controls, transaction monitoring, and limits — **not** treated as a cosmetic in-app purchase.
- **Voting** may be **free or paid**; paid votes are themselves gift-style wallet transfers and inherit the same controls.

### The Tier system (AML compliance backbone)
- A **tiered KYC/limits model** gates how much money a user can **send and receive** via gifts/paid votes, and how much they can **withdraw**, based on verification level.
- Align the tiers with **CBN's tiered KYC framework** (Tier 1 / Tier 2 / Tier 3), keyed to Nigerian identity rails (**BVN, NIN**) and escalating transaction/balance limits. *(Research must verify current CBN limit thresholds — they change.)*
- Higher tiers unlock higher gifting/withdrawal ceilings, creator payouts, and "go-live"/monetization privileges. Tier status is an RBAC/identity attribute consumed across Connect.

---

## AREAS IN SCOPE
1. **Connect** — unified discovery/matching + networking, live streaming, voting, gifting, in-product gamification.
2. **Gamification (cross-cutting)** — progression, status, rewards, and engagement loops spanning the product.
3. **Wallet, Gifting & Tier/AML layer** — the money-movement and compliance core.
4. **Admin Management Console** — operations, moderation, finance, compliance, analytics, RBAC.

---

## PHASE 1 — MARKET & COMPETITOR RESEARCH
Research and document, with **sources and dates**:

**1a. Competitor sets** (verify, expand, and replace with current/region-relevant players):
- *Dating + Networking (merged-social):* Tinder, Bumble (incl. Bizz), Hinge, Badoo, plus **Africa/Nigeria-relevant** dating & social-discovery apps and any local matchmaking or community products serving `<<Nigeria + target African markets>>`.
- *Live streaming + gifting:* Bigo Live, TikTok Live, Likee, Tango, plus live-gifting apps with strong **African / Nigerian** traction; note which already use wallet-style or cash-out gifting.
- *Voting / fan-engagement culture:* study paid/free voting mechanics in entertainment (e.g., **Big Brother Naija**-style voting, talent-show voting, sports fan voting) and in live PK-battle apps — this is a strong cultural hook in Nigeria.
- *Super-app & wallet comparators:* WeChat, Grab, Gojek; and **African** money/wallet & social-commerce players (e.g., OPay, PalmPay, Moniepoint, Paga; Paystack/Flutterwave as rails) — for identity, wallet, KYC tiers, and P2P transfer UX.
- *Gamification benchmarks:* Duolingo, Discord (levels/roles), and gifting/leaderboard loops from live-commerce apps.

**1b. For each competitor capture:** value proposition & audience; signature features; **monetization model** (esp. how gifting/voting money flows and whether recipients cash out); engagement/retention mechanics; **trust & safety + KYC/AML** approach; data-cost/low-bandwidth handling; known weaknesses & unmet needs (reviews, press, forums); and scale/momentum where verifiable (label estimates).

**1c. Nigeria/Africa market signals:** dominant **payment methods** (bank transfer/NIBSS, cards, USSD, mobile money where relevant, agent networks); **data cost sensitivity** and device/network constraints; **regulatory pressure points** (CBN KYC tiers & money-transmission rules, NDPA/NDPC data protection, EFCC/AML expectations, gambling/lottery regulation as it touches **paid voting and prize mechanics**); language & content norms (English, Pidgin, Hausa, Yoruba, Igbo); and creator-economy maturity.

---

## PHASE 2 — COMPETITOR ANALYSIS OUTPUT
Produce **feature comparison matrices** (rows = capabilities; columns = competitors + "Connect (proposed)"; mark ✅ strong / 🟡 basic / ❌ absent / 💡 opportunity) for: (i) merged dating+networking discovery, (ii) live streaming + voting, (iii) gifting & money-movement / cash-out, (iv) gamification, (v) KYC/AML & tiering.

For each, write a synthesis covering **table stakes**, **differentiators** (especially super-app advantages: shared identity, real-money wallet gifting, map, cross-product gamification, and Nigeria-tuned KYC tiers), **white space**, and **traps** (features that look attractive but damage trust, unit economics, or trigger regulatory/gambling exposure).

---

## PHASE 3 — STRATEGIC FEATURE RECOMMENDATIONS
For **every feature** provide:
`Name · Problem it solves · How it works (1–3 sentences) · Shared services used (Auth/RBAC/Map/Wallet) · New capability owned by Connect · Tier/AML implications · Competitive rationale · Tier (MVP / Fast-Follow / Differentiator) · Effort (S/M/L) · Key risk`.

### 3.1 Connect — Discovery, Matching & Networking (unified)
- Single product with **intent modes** (date / network / discover) and how the UI keeps them distinct while sharing infrastructure.
- Discovery & matching: algorithmic + intent-based + **proximity via the Map service**; compatibility for dating, skill/industry/interest for networking.
- Profiles & **verification** (selfie/ID, BVN/NIN-backed where appropriate via shared identity) and authenticity signals (anti-catfish, verified badges) — tie verification to **Tier** level.
- Messaging (icebreakers, safety gating, media, voice/video), connection/match management, communities/groups, and **events** (nearby/in-person via Map service).
- **Hard privacy wall:** prevent romantic-intent data/visibility from leaking into the professional context and vice versa; per-mode visibility & consent controls.
- Reputation/endorsements (networking) vs. trust signals (dating); recruiter/creator/B2B angles where they fit Nigeria.

### 3.2 Connect — Live Streaming
- Broadcasting stack: 1:many, **multi-guest / co-host**, **PK battles**, audio rooms; **low-bandwidth & data-saver modes** for Nigerian networks (adaptive bitrate, audio-only fallback, data-cost transparency).
- Stream discovery by interest, **location (Map service)**, and social graph.
- Real-time moderation (automated + human), and creator tooling.
- Creator monetization via **gifts and paid votes** flowing through the wallet; **payouts/withdrawals gated by Tier** and KYC; RBAC roles for creator, host/agency, and finance/compliance review.
- Anti-fraud: bot viewers, fake gifting, **gift-laundering / money-laundering controls** (velocity, pattern detection, source-of-funds at high tiers).

### 3.3 Connect — Voting
- Voting formats: free polls, **paid voting** (PK battles, contests, talent/fan voting, leaderboards) and how votes map to engagement and to streamers/creators.
- **Paid votes = wallet money transfers** and inherit Tier limits + AML monitoring.
- **Gambling-adjacency safeguard:** if paid voting influences prizes/payouts, explicitly assess Nigerian lottery/gaming regulation exposure and design to stay clear (e.g., no chance-based payout to voters; transparent rules; recommend legal review).
- Anti-manipulation: bot/sybil defense, vote-buying detection, rate limits, and result integrity/audit.

### 3.4 Connect — Gifting (wallet-to-wallet, gamified)
- Gift catalog & visual tiers (flower → rose → crown, etc.) that are **skins over real Naira transfers**; animations, gift leaderboards, and gifting streaks.
- **Money flow spec:** sender wallet → recipient wallet, fees/revenue-share treatment, reversibility/dispute rules, and how the gamified element is recorded against a real ledger entry.
- **Tier-gated limits** on per-transaction, daily, and cumulative gifting **sent and received**; behavior when a user hits a limit (prompt to upgrade tier via KYC).
- Recipient experience: balance is **spendable/withdrawable wallet money**, withdrawal gated by Tier/KYC.
- Anti-abuse: structuring/smurfing detection, collusive gifting rings, refund/chargeback handling, and clear separation from any *non-cash* gamified currency (see 3.5).

### 3.5 Gamification (cross-cutting)
- Unified progression: XP, levels, streaks, badges, missions, daily check-ins, **seasons/events** across Connect.
- **Two-currency clarity:** keep **real-money wallet (gifts/votes)** strictly separate from any **non-cash engagement currency** (points/coins earned by activity). If they ever convert, specify rules and AML implications explicitly.
- Status & identity (tiers/flair/leaderboards) and how RBAC + KYC Tier govern perks (e.g., "go-live," higher gifting ceilings).
- Anti-abuse: prevent grinding/farming, fake engagement, reward exploits.
- Map mechanics to the funnel: which drive **acquisition, activation, retention, referral, revenue**.

### 3.6 Wallet, Gifting & Tier/AML layer (compliance core)
- Propose the **Tier model** in detail: Tier 0/1/2/3 → required verification (phone, BVN, NIN, address/ID) → send/receive/withdraw limits → unlocked privileges (go-live, payouts). Align to **CBN tiered KYC** (verify current thresholds).
- **AML/CTF controls:** transaction monitoring, velocity & pattern rules, sanctions/PEP screening, SAR/STR workflow, recordkeeping, and source-of-funds at high tiers.
- **Money-transmission framing:** assess whether wallet-to-wallet gifting/voting constitutes regulated money transmission in Nigeria and how Paymax's existing licensing/partnerships cover it (flag for legal review).
- Define the **API contract** Connect uses against the shared wallet (initiate gift, check tier/limits, ledger entry, payout request).

### 3.7 Admin Management Console (web)
- **User & identity:** search users, **Tier/KYC status (BVN/NIN)**, verification queue, suspend/ban, identity flags.
- **RBAC management:** create/assign granular roles & permissions, audit trails, least-privilege defaults (moderator/finance/**compliance officer**/support/super-admin).
- **Content & live moderation:** real-time stream monitoring, reported-content queue, automated + human workflows, strikes/bans, appeals.
- **Finance, gifting & AML ops:** gift/vote/transfer ledgers, **payout & withdrawal approvals gated by Tier**, refunds/chargebacks, **AML alert queue (velocity, structuring, rings), SAR/STR filing support**, revenue dashboards.
- **Voting integrity ops:** monitor contests, detect vote manipulation, manage prize rules.
- **Gamification ops:** configure missions, rewards, seasons, currency rules (config-driven, no redeploy), reward audit logs.
- **Analytics & growth:** funnels, cohort retention, LTV, gift GMV & economy health, safety/AML metrics; segment by region/language/network type.
- **Geo/Map ops:** geo-distribution, regional feature flags, location-based abuse detection.
- **Operational controls:** feature flags, A/B config, announcements/push, support tooling (consented impersonation, ticket linkage).

### 3.8 Shared / Platform recommendations
- Full **RBAC role & permission model** spanning Connect (propose the role list + permission groups, including compliance officer).
- How **Auth, RBAC, Map, Wallet** are exposed to Connect (API contract sketches), and where a shared service must be **extended** (e.g., tier attributes, gift ledger).
- Unified, **mode-aware profile** that adapts context (date / network / creator) without leaking sensitive intent across contexts.

---

## PHASE 4 — PRIORITIZATION & ROADMAP
- Consolidate all features into one backlog; prioritize with **RICE** and **MoSCoW**, then reconcile.
- Phase delivery **MVP → V1 → Differentiators**, with dependencies (note which depend on extending shared services or completing KYC-tier integration before money can move).
- Flag the 3–5 highest-leverage **super-app + Nigeria-specific advantages** competitors structurally can't copy (e.g., native wallet-gifting with built-in KYC tiers, local identity rails, cross-product gamification).

---

## CROSS-CUTTING REQUIREMENTS (address in every phase)
- **AML/KYC & Tiering:** the tier system is the backbone — every money-moving feature must state its tier gating and monitoring.
- **Nigerian regulation:** CBN tiered KYC & money-transmission rules; **NDPA / NDPC** data protection; EFCC/AML expectations; **lottery/gaming law** exposure for paid voting & prizes. Recommend explicit legal review points.
- **Trust & Safety:** age/minor protection, anti-harassment, romance-scam/fraud defense, real-time live moderation, abuse/NCII handling, transparent reporting & appeals.
- **Privacy & intent separation:** keep dating-intent and networking-intent data/visibility walled; consent and data minimization.
- **Monetization architecture:** map every revenue stream (gift/vote take-rate, creator revenue share, subscriptions, boosts, premium discovery) with margin & risk; keep it coherent and locally affordable.
- **Localization & market fit (Nigeria-first, Africa-ready):** Naira & local payment methods; **data-cost-conscious** streaming; languages (English/Pidgin/Hausa/Yoruba/Igbo); content norms; offline/low-connectivity resilience; expansion notes for next African markets.

---

## OUTPUT FORMAT
1. **Executive summary** (1 page): strategic thesis, top differentiators, biggest risks (lead with AML/regulatory and data-cost realities).
2. **Per-area sections**: matrix → synthesis → prioritized features (per-feature template above).
3. **Tier/AML & Gifting specification**: tier table, limits, controls, money-flow & ledger design.
4. **Admin Console specification**: capabilities + RBAC model + key screens.
5. **Shared-platform integration notes**: Auth/RBAC/Map/Wallet contracts.
6. **Consolidated prioritized roadmap** (MVP/V1/Differentiators) with dependencies.
7. **Risk & compliance register** (risk · likelihood · mitigation · owner), AML & gaming-law front and center.
8. **Open questions & assumptions** (separated from verified findings).
9. **Sources** (linked, dated; mark estimates/unverified claims).

## RULES
- Cite sources for every competitive/regulatory claim; date them; never fabricate metrics or legal thresholds.
- Separate **verified fact** from **assumption/estimate** throughout; for CBN limits and gaming law, explicitly recommend confirmation with current regulation/legal counsel.
- Tie every recommendation to a user need and a competitive or super-app advantage.
- Treat **gifting/voting as real money movement**, never as cosmetic IAP.
- Prefer reusing shared services; call out any that must be extended.
- Be concrete and build-ready for a Nigeria-first launch.

---

## SUCCESS METRICS TO DESIGN TOWARD (reference set)
- **Acquisition/activation:** install→verified (Tier-up) rate, mode adoption (% using date *and* network), KYC completion rate.
- **Engagement:** DAU/MAU, sessions/user, streak retention, match/connection rate, stream watch-time, votes cast, data-saver adoption.
- **Monetization:** ARPU/ARPPU, payer conversion, **gift + paid-vote GMV**, take-rate revenue, creator earnings & withdrawal health, subscription retention.
- **Trust, safety & AML:** report rate & time-to-action, fraud/chargeback rate, **AML alert volume & SAR/STR turnaround**, ban accuracy/appeal-overturn rate, vote-integrity score.
- **Gamification health:** mission completion, reward redemption, and engagement *uplift* attributable to mechanics (not vanity inflation).

---
*Fill the `<<…>>` placeholders (next African target markets, regional competitors, exact shared-service API names) before running, append your real super-app role/permission inventory so RBAC maps onto what exists, and confirm current CBN tier limits and gaming-law treatment of paid voting with counsel.*
