# PAYMAX MARKETPLACE — MASTER PRD v4.0
## A world-class, SaaS-grade P2P marketplace module for the Paymax super-app
**This is the canonical, consolidated PRD. It supersedes the narrative sections of v1–v3 (which remain valid as detailed backlog/research appendices) and adds: benchmarking against nine global marketplace brands, SaaS/multi-tenant scalability framing, the complete mobile UI/UX screen inventory with workflows, and the full Super Admin Console specification. Redis and Elasticsearch are load-bearing infrastructure throughout, not add-ons.**

---

# 1. VISION & POSITIONING

**One sentence:** Paymax Marketplace is a peer-to-peer classifieds and commerce module — built on an already-licensed wallet, already-verified identity system, and already-live logistics rail — that ships, on day one, the trust infrastructure it took the global market's best marketplaces a decade of iteration, acquisitions, and fee-model failures to arrive at.

**Why this can be world-class, not just "good for Nigeria":** every structural advantage below is proven, individually, by a named global brand — Vinted proved escrow-with-timed-auto-release works at 75M-user scale; OfferUp proved local-meetup identity verification (TruYou) reduces in-person risk; Mercari proved category-specific authentication add-ons monetize trust; eBay proved structured attributes and buyer-protection claims scale globally. **No one of Jiji's actual competitors has combined all of these with a licensed wallet underneath.** That combination is Paymax's product.

---

# 2. GLOBAL BENCHMARK MATRIX

| Platform | Core model | Trust/verification | Payment & escrow | Fee model | Standout feature | What Paymax adopts |
|---|---|---|---|---|---|---|
| **Jiji.ng** (Africa) | Free P2P classifieds | "Verified ID" badge — **but gated behind an active paid boost** | None — meet in person, pay on delivery | Seller-paid boosts/CPC only | 16-category taxonomy; Jobs vs. Seeking-Work split; property price reports | Taxonomy structure, Jobs/CV split, tenure badges — **fix the pay-gated badge** |
| **OLX** (global/Poland-Brazil-India) | Free P2P classifieds | Basic profile, no verification tier system | None natively; regional escrow add-ons in some markets | Featured-ad boosts | Massive category breadth, 20+ country brand portfolio under one group | Multi-market single-taxonomy pattern (relevant if Paymax expands beyond Nigeria) |
| **Craigslist** (US) | Free P2P classifieds, no app-native trust layer at all | None | None — cash, meet in person | Paid only in a few categories (jobs, some cities) | Radical simplicity, hyper-local | Nothing structurally — cited as the *floor* this category must rise above |
| **Facebook Marketplace** (global) | Free P2P classifieds inside a social graph | Social-graph trust (mutual friends, profile age) only | Checkout/shipping in US only, absent in most of Africa | Free; no native monetization for most listings | Zero-friction reach via existing social graph | Social-proof signals (mutual connections) as a *secondary* trust signal alongside KYC |
| **eBay** (global) | Auction + fixed-price marketplace | Seller ratings, feedback score, eBay Money Back Guarantee | Managed payments, buyer protection claims process | ~13% final value fee (varies by category) | Global Shipping Program; structured item specifics per category; auction pricing | Structured category attributes; buyer-protection claims workflow as a model for the dispute wizard |
| **Mercari** (US/Japan) | Fixed-price C2C, shipped | Seller rating + **Mercari Authenticate** (paid 3rd-party authentication for luxury/high-value items) | Escrow-style: funds held, **released upon buyer rating/confirmation** | 10% seller fee **+** 3.6% buyer protection fee (both sides pay, reinstated 2025 after a failed zero-fee experiment) | Authentication-as-a-service for high-value categories; Smart Pricing auto-drop | **Direct precedent for category trust add-ons (BL-10, VIN-check)** — Mercari proved buyers will pay extra for verified high-value items |
| **Vinted** (Europe/US) | Fixed-price/negotiated C2C, shipped | Seller rating, item-condition disclosure | **Escrow held ~2 days post-delivery, auto-released if no dispute raised, buyer-funded "Buyer Protection Fee"** | **Zero seller fee** — 100% of sale price to seller; buyer pays ~5% + fixed fee | Seller-side zero-fee growth engine; scaled to 75M users | **Direct precedent for Paymax's own T+48h auto-release escrow design** — nearly identical window and dispute-freeze mechanic, independently validated at massive scale |
| **OfferUp** (US) | Local-first P2P, meet or ship | **"TruYou" identity verification** for safer local meetups | Optional shipped-item protection; local meetups are unprotected | Seller-paid boosts + shipping fees | Purpose-built for the exact "meet a stranger locally" use case Jiji and Paymax both serve | **Direct precedent for verified-meetup safety UX** — name-check this pattern in the Meetup Mode screen |
| **Carousell** (SE Asia) | Chat-first P2P classifieds | Verified badges, seller ratings | Optional in-app checkout ("Carousell Protection") in some markets | Seller-paid boosts + take-rate on protected checkout | Chat-first negotiation UX, extremely low listing friction | Deal-room-first interaction pattern already in Paymax's v1 design |

**The synthesis this table proves:** Paymax's planned architecture — free listings, wallet-native escrow, timed auto-release, KYC-tiered verification, category-specific paid authentication add-ons — is not a novel bet. **It is the assembled best practice of the entire global industry**, applied to a market (Nigerian P2P classifieds) where zero competitors have assembled it. Vinted validates the escrow timing. Mercari validates the authentication add-on monetization. OfferUp validates the identity-for-meetup pattern. eBay validates structured attributes at scale. Paymax's edge is starting from a licensed wallet instead of bolting payments onto a classifieds site after the fact — which is the one thing none of the above did from day one.

---

# 3. PRODUCT PILLARS (consolidated)

1. **P1 — Escrow, PSP-framework compliant.** Wallet-held funds, dual-entry ledger postings, **auto-release at T+48h** (Vinted-validated window), dispute-freeze. Built on Paymax's existing wallet rail — not a bespoke license claim (see regulatory note, §8).
2. **P2 — Verified Everything, badge decoupled from payment.** KYC tiers via existing SmileID/Dojah/Youverify adapters. **Badges are permanent once earned — never tied to an active subscription** (direct fix of Jiji's core flaw).
3. **P3 — In-app deal rooms with a "continue safely" WhatsApp bridge.** Chat-first (Carousell-validated pattern), scam-language detection, and — because WhatsApp is measurably the #1 external referral channel in this category — a deep-link that invites users back to fund in escrow if they do leave the app, rather than only trying to block the exit.
4. **P4 — Structured, trusted listings.** Category-specific attribute schemas (eBay-validated pattern), duplicate/stolen-photo detection, AI price-band guidance, condition grading.
5. **P5 — Transaction-gated, structurally non-hideable reviews.** No admin can silently disable a seller's feedback section (fixes a documented Jiji gap worse than review deletion).
6. **P6 — Fair monetization: free listings forever, wallet-native boost spend.** No separate ad-balance top-up (a genuine Jiji/Mercari-style friction point Paymax avoids by construction).
7. **P7 — Delivery rail with photo/OTP proof-of-delivery**, feeding the escrow auto-release clock.
8. **P8 — Category-specific trust products, built natively.** VIN/condition-report for vehicles, document-check for property, milestone-escrow for services/jobs — **shipped inside one app**, unlike Jiji (which had to acquire Cars45 as a separate product) or Vinted (which still lacks luxury authentication and cedes that ground to Vestiaire Collective).
9. **P9 — SaaS/multi-market readiness** (new pillar, see §4).

---

# 4. SAAS, SCALABILITY & MULTI-TENANT ARCHITECTURE

Jiji's own playbook — identical 16-category taxonomy deployed unmodified across Nigeria, Kenya, Ghana, Uganda, Tanzania, and even Bangladesh — proves the category taxonomy and core transaction model are portable. Paymax should build for that from day one, even if Nigeria is the only live market at launch, because it costs almost nothing extra to do correctly and a great deal to retrofit later.

**Design decisions for SaaS-readiness:**
- **Tenant/region as a first-class dimension**, not an afterthought: every `mkt_*` table carries a `market_id` (e.g., `NG`, future `KE`, `GH`); Elasticsearch indices are **per-market** (`mkt_listings_ng_v1`, aliasable), not a single global index with a filter — this keeps reindexing, currency, and language changes isolated per market and avoids noisy-neighbor query load across regions.
- **Config-driven category schemas**, not hardcoded: the category tree and attribute JSON-schemas (already speced in v1's `mkt_categories` table) are the *only* thing that needs to change to localize for a new market or vertical — no code changes.
- **Currency and locale as configuration**, propagated from Paymax's existing multi-currency wallet primitives (already built for the fintech core) rather than re-implemented in the marketplace module.
- **Horizontal scalability targets:** stateless API pods behind the existing Chi/Go service mesh, autoscaled on request latency and queue depth; Elasticsearch data nodes scaled per-market shard count as GMV grows; Redis deployed as a clustered, multi-AZ cache tier (not a single instance) so cache-layer failure never becomes a single point of failure for search availability.
- **Multi-tenant admin:** the Super Admin Console (§10) supports **market-scoped admin roles** — a Kenya moderator sees only Kenya's queue — from the first release, even though only Nigeria is live, so expansion never requires an access-control rebuild.

This is what makes the module genuinely "SaaS": it is built so that standing up a second market is a **configuration and content exercise, not an engineering project.**

---

# 5. DOMAIN MODEL & STATE MACHINES (carried and tightened from v1)

**Listing FSM:** `draft → pending_review → active → (paused | expired | sold | removed_policy | removed_user)`. Guards: new-seller and high-risk-category listings always route to human review; auto-expire at 60 days with one-tap renew; `sold` only fires via completed escrow or an explicitly weighted seller attestation.

**Escrow order FSM:** `initiated → funded → seller_accepted → in_delivery → delivered → inspection_window(T+48h) → released`, branching to `cancelled` (pre-acceptance, auto-refund) or `disputed → (refund_buyer | release_seller | split)`. Every money-touching transition requires an `Idempotency-Key`; every dispute decision posts as a dual-entry ledger transaction with **dual approval above ₦500k**.

**Boost FSM:** `purchased → active → (completed | rejected_with_reason → auto_refunded)` — rejection is always reason-coded (never "prohibited content" with no detail — direct Jiji-gap fix).

**Review integrity rule (structural, not policy):** any order reaching `released` with no dispute **must** produce a reviewable state on the seller's profile; there is no admin action capable of hiding this fact, only actions that can annotate a specific review's *content* under logged, dual-visible moderation.

**Core tables:** unchanged from v1 (`mkt_listings`, `mkt_listing_media`, `mkt_categories`, `mkt_offers`, `mkt_orders`, `mkt_disputes`, `mkt_dispute_evidence`, `mkt_reviews`, `mkt_boosts`, `mkt_saved_searches`, `mkt_trust_scores`, `mkt_flags`, `mkt_price_bands`), each now carrying `market_id` per §4. All money references point into the existing wallet ledger; the marketplace module never stores a balance itself.

---

# 6. ELASTICSEARCH ARCHITECTURE (detailed)

**Indices:** one per market (`mkt_listings_{market}_v{n}`), alias-swapped for zero-downtime reindexing. CDC via an outbox table on `mkt_listings`, consumed by a dedicated indexer worker — at-least-once delivery, version-stamped upserts to guarantee idempotent re-application.

**Mapping strategy:**
- `title` / `description`: custom analyzer combining standard tokenization, **edge-ngram** (search-as-you-type), and a maintained **local-language synonym set** per market (Nigerian Pidgin/English terms: okrika/tokunbo/fairly-used ≈ used; keke ≈ tricycle; and so on) — admin-editable, not hardcoded.
- `attrs`: flattened field type for the category-specific JSON-schema attributes (eBay-pattern structured item specifics).
- `geo_point` for radius search; `state`/`lga` as keyword facets for the location-browse pattern Jiji's own SEO strategy validates.
- `price_kobo`, `condition`, `seller_trust_score`, `quality_score`, `boost_weight`, `freshness_ts`.

**Query & ranking:** `multi_match` (title cubed weight, description, attrs) with `fuzziness: AUTO` for typo tolerance ("ifone 13" finds iPhone 13); filtered by category/price/geo/condition facets; ranked by a function score combining BM25 relevance, quality_score, trust_factor, a gaussian geo-decay within 25km, a freshness decay with a 30-day half-life, plus a capped transparent boost_weight added on top. Boosts **add, never dominate** — a direct, publicly documented answer to the industry-wide "does paying for a boost actually work" skepticism validated by the independent Kenya Top-Ad test that returned almost no conversion in the research phase. Aggregations return facet counts in the same round trip. `/suggest` uses a completion suggester trained on successful search phrases; **zero-result queries are logged and surfaced in the admin synonym-candidate queue** (§10, M6).

**Budgets:** search p95 < 250ms end-to-end; index refresh interval tuned to 1s for freshly-posted listings to appear near-instantly (a real, felt quality difference vs. "a couple of hours" moderation-then-index lag reported on Jiji).

---

# 7. REDIS ARCHITECTURE (detailed)

Nine concurrent roles, all in a clustered, multi-AZ deployment:
1. **Search-result cache** — `srch:{hash(query+filters+page+market)}`, 60s TTL, protects Elasticsearch from hot-query load.
2. **Listing-detail cache** — `lst:{id}`, write-through, invalidated on update, serves the highest-traffic read path in <30ms.
3. **Home-feed cache** — `feed:{market}:{segment}`, 120s TTL.
4. **View/impression counters** — HyperLogLog, batched to Postgres every 60s (avoids write-amplification on every single view).
5. **Rate limiting** — token-bucket: listing-create (tiered by KYC level), first-message-per-conversation, report-abuse throttles.
6. **Idempotency-key store** — 24h TTL, guarding every money-touching endpoint against duplicate submission (network retries, double-taps).
7. **Price-band hash cache** — hot category+attribute combinations for the fair-price chip and the Property Price Insights screen (§9).
8. **Fraud/session fingerprint cache** — device and behavioral signals for the ban-evasion detection feed into Super Admin M3.
9. **Pub/Sub fan-out** — chat presence indicators and **instant saved-search match alerts**, published the moment the ES indexer completes a matching upsert — the single fastest "new listing matching your search" notification path available in this architecture.

---

# 8. NON-FUNCTIONAL REQUIREMENTS

**Performance:** search p95 <250ms; listing-detail p95 <120ms; app cold-start unaffected (module lazy-loaded); image pipeline produces WebP thumb/card/full variants with BlurHash placeholders through the existing CDN.
**Scalability:** stateless services scale horizontally on request latency/queue depth; ES scales per-market shard count; Redis cluster scales by role-partitioned logical databases.
**Security & compliance:** OLA (object-level authorization) on every endpoint; idempotency on every money-touching call; escrow sub-accounts operate under Paymax's existing **PSP-framework** posture (no bespoke "escrow license" claim — none exists in Nigeria; see the research dossier for the regulatory detail); NDPR-aligned, single-toggle ad-personalization consent (a genuine improvement over the broad default-on third-party ad-sharing found in incumbent privacy policies); every admin action append-only audited.
**Availability target:** 99.9% for search and browse; escrow state transitions are the one path that must never silently fail — always resolve to a terminal, auditable state (funded/refunded/released/disputed), never an ambiguous one.

---

# 9. MOBILE UI/UX — COMPREHENSIVE SCREEN INVENTORY & WORKFLOWS

## 9.1 Screen inventory (34 screens, React Native, existing design system; ~14 are thin skins over existing Paymax components)

**Discovery (9):** 1. Marketplace Home (category grid, near-you rail, price-drop rail, escrow-eligible badge rail) · 2. Search (instant suggest, recent, trending) · 3. Results (list/grid toggle, facet bar, map toggle, "trusted first" sort) · 4. Map view (clustered pins) · 5. Category landing (attribute quick-filters) · 6. Listing Detail (gallery + BlurHash, fair-price chip, seller trust card, escrow CTA primary / chat secondary / call tertiary-delayed, similar-items rail, safety strip) · 7. Seller Profile (badges — permanent, never payment-gated — gated reviews, response stats, active listings) · 8. Saved items · 9. Saved searches + instant-alert manager.

**Sell (8):** 10. Sell entry (camera-first) · 11. Smart Composer (photo leads to AI-prefilled category/title/attrs; **client-side real-time validation** for word-count, photo-count, duplicate-photo warning — fixes Jiji's async-only rejection) · 12. Attribute form (schema-driven per category) · 13. Price screen (fair-price band + escrow-ready toggle + delivery options) · 14. Preview & publish · 15. My Listings dashboard (status chips, views/saves/chats, renew/pause/mark-sold) · 16. Boost purchase (transparent tiers, wallet-native spend — no separate ad balance) · 17. Boost status (+ reason-coded rejection & instant refund state).

**Transact (10):** 18. Chat inbox · 19. Deal Room (offer bubbles, counter-offer sheet, escrow CTA pinned, scam-language warning banner, "continue safely" WhatsApp bridge) · 20. Make Offer sheet · 21. Escrow checkout (wallet/card/transfer, fee breakdown, hold explainer) · 22. Order Tracker (FSM timeline: funded, accepted, rider assigned with live map, delivered, inspection countdown, released) · 23. Inspect & Confirm (release / open dispute, photo capture) · 24. Dispute Wizard (reason then evidence then timeline expectations) · 25. Dispute Status · 26. Review Composer (post-release only, structurally guaranteed to exist for every completed order) · 27. Meetup Mode (for non-escrow deals: OfferUp-pattern verified-meetup safe-spot suggestions, trip-share, check-in timer).

**Trust & account (7):** 28. Verification Center (tier progress, reused KYC flows) · 29. My Orders (buying/selling tabs) · 30. Wallet hand-off (existing Paymax screen) · 31. Report flow · 32. Blocked users · 33. Notification Preferences (granular, per-category toggles: new offer, price-drop, order status, boost expiry, promotional) · 34. Property Price Insights (new — trend line by LGA and property type, extending the price-band engine beyond a single fair-price chip; directly exceeds Jiji's static report feature).

## 9.2 Core workflows (step-by-step, screen-to-screen)

**Onboarding & KYC escalation:**
Home (browse-only, Tier 0) leads to an attempt to message or offer, which routes to the Verification Center, where phone plus BVN-lite verification (Tier 1) unlocks buying; sellers continue to ID plus liveness verification via the existing SmileID or Dojah adapter (Tier 2); businesses continue further to CAC upload (Tier 3), which unlocks storefront and bulk import. The resulting badge appears permanently on the profile, independent of any future subscription state.

**Seller — list an item:**
Sell entry opens the Smart Composer, where the camera captures photos and AI prefills title, category, and attributes; real-time validation checks word count, photo count, and duplicate images with no waiting for moderation to find out. The flow continues through the Attribute form, then the Price screen, where the seller sees a fair-price band pulled from the price-bands table and toggles escrow-ready status plus delivery options. Preview and Publish follows; high-risk categories or new sellers route to the async human review queue, while everything else goes live in Elasticsearch within roughly one second of the outbox indexer's next tick. My Listings then shows the resulting status.

**Buyer — discover and purchase with escrow:**
Home, Search, or Results (ranked by the function-score formula in §6) lead to the Listing Detail screen, showing the fair-price chip and seller trust card. From there the buyer enters the Deal Room to chat, negotiate, or make an offer, then proceeds to Escrow Checkout, where funds move from the Paymax wallet into the order's escrow sub-account under an enforced idempotency key. The Order Tracker then shows delivery-rider assignment via the existing logistics vertical with a live map. Once the item is delivered, a proof-of-delivery photo and OTP are captured, and the Inspect and Confirm screen opens a thirty-minute reject-at-door window followed by the forty-eight-hour Vinted-validated inspection countdown. The buyer either confirms or the auto-release fires; funds then move to the seller's wallet, the escrow order closes, and the Review Composer opens automatically, since review existence is structurally guaranteed rather than optional.

**Dispute path:**
From Inspect and Confirm, selecting "Something's wrong" opens the Dispute Wizard, where a reason code is chosen and evidence such as photos or chat excerpts is uploaded. The order's state machine freezes at disputed, which stops the auto-release clock, and both parties receive a seventy-two-hour evidence window. The Super Admin dispute workbench (§10, M4) then decides the outcome, which executes as a ledger transaction for refund, release, or split. The Dispute Status screen shows the reasoned, timestamped outcome to both parties simultaneously, never as a silent resolution; if a review appeal was also filed, its outcome is logged and displayed identically on both sides.

**Meetup path (buyer and seller choose not to use escrow):**
From the Deal Room, selecting "Meet in person instead" opens Meetup Mode, which surfaces verified public safe-spot suggestions, a trip-share link, and a check-in timer that notifies an emergency contact if not cleared in time — applying the OfferUp-style safety layer even when money never touches the platform.

---

# 10. SUPER ADMIN CONSOLE — FULL SPECIFICATION

**Role hierarchy (market-scoped from day one, per §4):** Super Admin (global) oversees Market Admin (per-country), who oversees Category Admin, Moderator, Fraud/Trust Ops, Finance Ops, and Support Agent. Every role is object-level-authorized; every action is append-only audited — who, what, when, and why, with the "why" being a mandatory reason code on any state-changing action.

**M1 — Moderation Queue.** Risk-scored review stream, where new-seller listings, high-risk-category listings, and duplicate-photo-hash hits float to the top; approve or reject with mandatory structured reason codes, so the code the moderator selects *is* the message the seller receives — closing Jiji's "prohibited content, no detail" gap by schema, not policy. Bulk operations, SLA timers visible on every queue card, and per-moderator QA sampling catch inconsistent moderation.

**M2 — Category & Attribute Manager.** Full category-tree CRUD, a versioned JSON-schema attribute editor (the config-driven mechanism that makes new-market launches a content task per §4), risk-tier assignment per category, commission and fee overrides per category, a synonym-dictionary editor feeding the Elasticsearch analyzer directly, and a price-band monitor with anomaly flags.

**M3 — Trust & Fraud Desk.** A device and BVN cluster graph for ban-evasion detection, a scam-phrase classifier with a flagged-chat review queue, a stolen-image perceptual-hash corpus, a velocity-rule editor governing listing creation, messaging, and offer rates, plus shadow-ban and hard-ban tooling with a formal appeal track and watchlists.

**M4 — Escrow & Dispute Operations.** The dispute workbench presents evidence side-by-side — chat transcript, delivery proof, photos — with decision buttons that execute directly as ledger transactions, enforcing dual approval above ₦500k, with a full audit trail. Aging dashboards escalate any dispute open beyond forty-eight hours; an auto-release monitor tracks the escrow clock; review-appeal outcomes are logged and surfaced identically to both parties, never actioned silently.

**M5 — Monetization Console.** Boost inventory and optional auction-style pricing configuration, rejection-reason analytics feeding back into seller education, refund-automation monitoring targeting same-day resolution above 95%, escrow-fee configuration by category that is versioned and guarded, and revenue dashboards covering take-rate, ARPU by seller cohort, and boost-conversion-versus-organic-conversion — the internal metric that lets Paymax prove, not just claim, that quality-ranked organic search converts better than paid boosts, building on the Kenya Top-Ad benchmark from the research phase.

**M6 — Search Operations.** A zero-result query miner feeding synonym candidates into M2 for approval, a ranking-function weight-tuning console with staged rollout from shadow to five percent to full deployment with CTR and conversion guardrails that auto-halt a bad weight change, and manual reindex controls per market.

**M7 — Marketplace Analytics.** A liquidity funnel tracking listing through view, chat, escrow, and release, sliced by category, geography, and market; supply-demand heatmaps; time-to-sell distributions; trust-score population health; and the escrow-adoption-rate north-star metric tracked per market, category, and seller tier.

**M8 — Content & CMS.** Category banners, safety-education cards, featured collections, and announcement pushes via the existing notification service — including education content that explains, in-app, exactly why a review can never simply vanish, turning the trust architecture itself into a marketing surface.

---

# 11. ROLLOUT & METRICS

**Phase 1 (8 weeks):** Core listings and search, with Elasticsearch and Redis live from day one rather than retrofitted, plus chat and the Electronics, Fashion, and Home categories, Lagos-first liquidity seeding, and permanent unpaid-gated verification badges live at launch.
**Phase 2 (6 weeks):** Escrow, delivery, reviews, and disputes; the Property Price Insights screen; single-toggle privacy consent.
**Phase 3 (6 weeks):** Boosts and monetization with wallet-native spend; Vehicles and Property categories with native trust add-ons such as VIN-check and document-check, built with no spin-out product; CSV bulk-import and an API for Tier-3 dealers; Super Admin modules M5 through M7 completed.
**Phase 4:** Jobs and Services milestone escrow, plus a second-market configuration exercise that proves the SaaS thesis in §4 by actually standing up a second country using configuration alone.

**North-star metric:** the percentage of completed transactions that went through escrow, targeting 35 percent by month six — every point is simultaneously revenue and safety. **Guardrails:** dispute rate under 2.5 percent of escrow orders; dispute resolution at the ninetieth percentile under 72 hours; search at the ninety-fifth percentile under 250 milliseconds; listing-to-live latency under 5 minutes for auto-approved categories, compared to Jiji's stated "couple of hours"; boost-refund automation above 95 percent same-day; and zero incidents of a review section being hidden without a logged, dual-visible reason — a hard compliance metric, not just a UX goal, given how directly it answers a documented incumbent failure.

**Build note for Claude Code:** scaffold as `modules/marketplace/` with `market_id` as a first-class column and index-suffix from the first migration; FSM guards table-driven; Elasticsearch index templates with per-market aliasing baked in from day one, not retrofitted at Phase 4; a centrally documented Redis key registry; a seed script for the 16-category taxonomy adopted from the validated Jiji structure, plus the Nigerian synonym set v1; and a k6 load profile validating the search and escrow-checkout budgets in §8 before Phase 1 ships.
