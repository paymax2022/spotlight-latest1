# JIJI.NG FUNCTIONAL TEARDOWN → PAYMAX MARKETPLACE PRD ADDENDUM (v3)
## Feature-level gap analysis, scoped into build-ready backlog items
**This addendum sits on top of Paymax_Marketplace_PRD_v1.md (architecture, FSMs, ES/Redis, 33 screens, 8 admin modules) and Jiji_Research_Dossier_and_PRD_v2.md (business model, market, regulatory). This document does the PM job of taking Jiji's actual, live, shipped functionality apart feature by feature and turning every gap into a numbered backlog item with an owner module. Every claim below is sourced from Jiji's live product (app store listings, in-app FAQ pages, live site HTML, current version 6.1.1.0 / June 2026) — not from secondary commentary.**

---

## PART A — WHAT JIJI ACTUALLY SHIPS (functional inventory)

**A1. Taxonomy — confirmed identical across every Jiji country site (NG/GH/KE/UG/TZ/Bangladesh), 16 categories:** Vehicles, Property, Phones & Tablets, Electronics, Home/Furniture & Appliances, Fashion, Beauty & Personal Care, Services, Repair & Construction, Commercial Equipment & Tools, Leisure & Activities, Babies & Kids, Food/Agriculture & Farming, Animals & Pets, **Jobs**, **Seeking Work – CVs** (jobs and CVs are deliberately split into two listing types, not one). Location browsing exists down to state/city level (e.g., jiji.ng/kano, jiji.ng/rivers) with per-location category counts — this is their SEO backbone.

**A2. Posting flow:** camera → title → category → **minimum 8-word description enforced** → attributes → price (rejected if "unrealistic" vs. category norms) → photos (**minimum 3 required for cars and phones specifically**) → submit to moderation → **live in "a couple of hours"** → email/notification on approval. Hard rule: **"1 ad = 1 item"** — no bundling multiple items in one listing. Watermarked or downloaded (non-original) photos are grounds for rejection.

**A3. Identity/trust signals shown on listing cards:** "Verified ID" badge, "X+ years on Jiji" tenure badge, condition tags (Foreign Used / Local Used / New), transmission-type and other category attributes inline in search results.

**A4. Verified ID mechanics (critical finding — see Gap G1):** KYC is via **SmileID** (selfie + government ID document match) — **the same KYC vendor already in Paymax's own adapter stack.** But the badge is **gated behind an active paid Boost Package**: "The badge is currently available to sellers with active Boost Packages... if your Package becomes inactive, the same happens to your badge." The underlying verification persists, but its *display* is pay-to-show.

**A5. Monetization tools:** TOP Ads (7/30-day top placement); Boost Packages in tiers — **Start, VIP, VIP Gold, Diamond, Enterprise** — 1/3/6/12-month durations, auto-renewal at tier-dependent frequency; **Pro Sales** (CPC auto-bidding across search/category/similar-ads placements, requires an active VIP+ Boost Package and a minimum ₦1,000 top-up on a **separate ad-spend balance**, not the user's transaction funds).

**A6. Seller tools:** ad view-count analytics ("how many people viewed my ad"), Business/Company profile setup (a distinct "Verified" store badge separate from individual Verified ID), feedback/review section with a seller-side **"Appeal on feedback"** mechanism.

**A7. Communication:** in-app "Jiji Chat," phone-call reveal, SMS notifications for new messages, push notifications (opt-out only via OS settings, not granular in-app).

**A8. Buyer-side safety tooling:** none beyond static advice text (see prior dossier) — "Feedback" section is the sole structured trust signal buyers can consult before transacting.

**A9. Vertical-specific extras:** Property price reports ("check average prices for Houses & Apartments for Sale and Rent") — a real, useful data product; delivery-offer display for out-of-town sellers (a UI feature showing delivery options, not a fulfilled logistics rail); Cars45 as a separate, fuller-service acquisition for inspected/verified used-car transactions (i.e., Jiji itself chose NOT to build deep vehicle trust into the core app, but into a bought-in subsidiary).

**A10. Data/privacy posture:** broad ad-personalization data sharing by default (Meta remarketing, Google DoubleClick, Facebook Custom Audiences all confirmed in their tech stack); opt-out is manual and per-channel, not a single consent toggle.

---

## PART B — GAP ANALYSIS: FEATURE BY FEATURE

| # | Jiji's actual behavior (evidence) | The gap | Paymax scoped response |
|---|---|---|---|
| **G1** | Verified ID badge display is **tied to an active paid Boost**, not to verification status itself | Trust signal is monetized, not earned — a verified, safe seller who stops paying for boosts *loses their visible trust badge*, while a boosted-but-freshly-registered seller can look more trustworthy by spending money. This inverts the entire purpose of KYC. | **BL-01 (Trust service, P2):** Verified badges are **permanent and free once earned**, fully decoupled from any paid product. Tiering (Verified ID / Verified Business) persists regardless of boost or subscription status. Same SmileID vendor Jiji uses — Paymax already has this adapter; this is a policy fix, not a build. |
| **G2** | Trustpilot/user reports: reviews **selectively disabled for specific sellers with no disclosed reason**, and no visible feedback section at all for some long-tenured big sellers | Buyers cannot tell whether "no reviews visible" means "genuinely new" or "reviews hidden." Opacity here is worse than Jiji's already-documented review-deletion problem (see v1 audit D5) — it's not just *removing* bad reviews, it's *disabling the whole section*. | **BL-02 (Trust service, P5):** Review visibility is **binary and structural, never admin-togglable per seller**. Any seller with ≥1 completed escrow order shows a review count — this cannot be hidden. If reviews are removed for policy violation, the *removal event itself* is logged and a generic "reviews under review" state is shown (never a silent blank section). |
| **G3** | Pro Sales requires a **separate ad-spend balance top-up** (₦1,000 minimum), distinct from any wallet the seller might already use elsewhere | Double-wallet friction — sellers must maintain two balances (their money, and Jiji's ad credit) with no fungibility. | **BL-03 (Monetization, P6):** Boost/Pro-Sales spend draws **directly from the seller's existing Paymax wallet balance** — zero separate top-up flow. This is a structural advantage the brownfield wallet already provides; make it a headline seller-facing differentiator ("no separate ad wallet, ever"). |
| **G4** | "1 ad = 1 item" rule and min-8-word description are enforced only at **moderation time** (a couple hours after submission) — sellers find out their ad was rejected only after waiting | All quality gates are server-side and asynchronous. Sellers waste the wait. | **BL-04 (Sell flow, mobile screen "Smart composer"):** Move all deterministic checks (word-count minimum, min-photo-count per category, price-band sanity, duplicate-photo hash) to **client-side, pre-submit, real-time** validation. Only genuinely subjective/policy checks (prohibited content, fraud signals) go to the async human/AI review queue. Cuts seller-side rejection latency from hours to zero for the majority of rejection causes. |
| **G5** | Category taxonomy is flat-ish with generic attributes; **Jobs and Seeking-Work CVs are separate listing types**, which Jiji gets right, but neither has any transactional layer (a "hire" flow doesn't exist — it's still just contact-and-negotiate) | Services/Jobs categories in the original v1 PRD teardown were flagged as broker-fee/fake-job territory; Jiji's split-listing-type pattern is good but stops at classifieds | **BL-05 (Category manager, extends P8):** Adopt Jiji's Jobs/Seeking-Work split as-is (it's a good pattern — replicate exactly), but layer the existing milestone-escrow service-booking pattern from the original PRD's Services pillar on top, so "Jobs" can optionally convert to an escrowed short-gig contract, not just a classifieds listing. |
| **G6** | Property vertical has a genuinely good feature: **average price reports by area/type** | This is worth copying, not just competing with | **BL-06 (Search/ES, extends existing price-band feature):** The v1 PRD already specs nightly price-band aggregation (`mkt_price_bands`) for fair-price chips on listing detail. **Extend explicitly to a standalone Property Price Insights screen** (new mobile screen #34) — historical trend line by LGA + property type, not just a single fair-price chip, matching and exceeding Jiji's static report. |
| **G7** | Business/Company profile is a thin one-time setup form; no bulk tools found for high-volume sellers (car dealers, real-estate agencies) beyond the per-ad web form | No evidence of CSV bulk-upload or a lightweight API for Tier-3/dealer accounts — professional sellers with hundreds of SKUs are stuck posting one-by-one | **BL-07 (Admin M2 + new Seller capability):** Add **CSV bulk-import** and a minimal **REST endpoint** (`POST /v1/marketplace/listings/bulk`) gated to Tier-3 (CAC-verified business) sellers only. This is a genuine white-space feature Jiji has not shipped after a decade in market — worth shipping at Phase 3 as a dealer-acquisition wedge (auto dealers, real-estate agencies, electronics wholesalers). |
| **G8** | SMS + push notifications exist but are coarse — opt-out is OS-level or all-or-nothing, no granular in-app preference center found | Users can't choose "notify me on new messages but not on boost upsell nudges," a documented user complaint | **BL-08 (Mobile screen #33, already scoped as "Marketplace notification preferences"):** Explicit acceptance criteria — per-category toggles: new offer, price-drop on saved search, order status change, boost expiry, promotional. Confirmed as necessary, not speculative — this directly answers a real Jiji gap. |
| **G9** | Ad-personalization data sharing (Meta, Google DoubleClick/remarketing) is broad and default-on; opt-out is manual per-channel via device settings, not a single control | Below the Nigerian Data Protection Act's spirit of granular, revocable consent; also just bad UX | **BL-09 (Account & privacy, extends screen #6 "Marketplace notification preferences" into a fuller "Privacy & Data" screen):** Single in-app toggle for ad personalization, NDPR-aligned consent logging, no default-on third-party ad-network sharing without explicit opt-in. Positions Paymax as the trustworthy option on a second axis (data privacy, not just transaction safety) — genuinely differentiated, low engineering cost. |
| **G10** | Cars45 (Jiji's own acquired subsidiary) is where real vehicle inspection/verification lives — **not in the core Jiji app** | Confirms structurally that Jiji itself doesn't believe its core classifieds product can carry deep category trust — it had to buy a separate company and keep it separate | **BL-10 (Category manager, P8 — strategic note, not just a ticket):** Ship vehicle VIN-check and condition-report add-ons **natively inside the one Paymax app**, not as a spun-out product. This is the clearest structural argument for the whole PRD: do in one app, from day one, what took Jiji a $-figure acquisition and a second app to achieve. |
| **G11** | Feedback disputes are handled via a seller-initiated **"Appeal on feedback"** with no visible SLA or transparent outcome logic reported by users | Users report arbitrary-feeling review removal with no explanation, already covered under G2, but the *appeal* mechanism itself is opaque too | **BL-11 (Admin M4, Dispute & Review ops):** Any review appeal outcome (upheld / overturned / partially amended) is timestamped, reason-coded, and visible to **both parties** — not just actioned silently. Reuses the existing dispute-workbench audit pattern from v1 M4. |

---

## PART C — WHAT JIJI GETS RIGHT (adopt, don't just differentiate)

Four patterns are genuinely good product decisions and should be **replicated deliberately**, not reinvented differently out of contrarianism:
1. **The Jobs / Seeking-Work-CVs split** — two listing types instead of one generic "Jobs" category is a real UX insight (employer intent ≠ jobseeker intent). Keep it exactly.
2. **Tenure badges ("3+ years on Jiji")** — a free, ungameable trust signal that costs nothing and needs no verification vendor. Adopt as-is, and make it timestamp-anchored to account creation, immutable.
3. **Property price reports** — genuinely useful, already extensible from the v1 PRD's price-band infrastructure (BL-06 above).
4. **1-ad-1-item + minimum content bars (8 words, N photos)** — a correctly strict floor against low-effort listings. Adopt the *thresholds*, fix the *timing* (G4 — move client-side).

---

## PART D — BACKLOG SUMMARY (engineering-ready)

| ID | Title | Module (v1 PRD) | Phase |
|---|---|---|---|
| BL-01 | Decouple Verified badge from paid status | Trust service (P2) | 1 |
| BL-02 | Review visibility cannot be silently disabled | Trust service (P5) / Admin M1 | 1 |
| BL-03 | Boost/Pro-Sales spend from main wallet, no separate ad balance | Monetization (P6) | 1 |
| BL-04 | Move deterministic listing-quality checks client-side | Sell flow / Smart composer | 1 |
| BL-05 | Jobs/CVs split + optional milestone-escrow upgrade | Category manager / Services (P8) | 3–4 |
| BL-06 | Property Price Insights screen (trend, not single chip) | Search/ES + new mobile screen #34 | 2 |
| BL-07 | CSV bulk-import + bulk API for Tier-3 sellers | Admin M2 + new API endpoint | 3 |
| BL-08 | Granular notification preference center | Mobile screen #33 (acceptance criteria) | 1 |
| BL-09 | Single-toggle ad-personalization consent (NDPR-aligned) | New "Privacy & Data" screen | 2 |
| BL-10 | Native VIN/condition-report add-on (no spin-out product) | Category manager (P8) | 3 |
| BL-11 | Transparent, dual-visible review-appeal outcomes | Admin M4 | 1 |

**Net effect on the v1 PRD:** screen count moves from 33 to **34** (Property Price Insights added; Privacy & Data folded into the existing notification-preferences screen rather than adding a 35th). Admin modules stay at 8, with M1 (moderation), M2 (category manager), and M4 (dispute ops) each gaining explicit new acceptance criteria (G1, G2, G7, G11) rather than new modules. No architecture changes to the domain model, FSMs, or ES/Redis design in v1 — every item above is a policy, validation-timing, or UI-scope fix layered onto the existing build, which is exactly what a functional teardown of a decade-old incumbent should produce: sharper requirements, not a bigger system.
