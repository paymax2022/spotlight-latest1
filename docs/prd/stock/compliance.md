# Compliance & Access Control

> The gate in front of all trading. No trade proceeds unless: KYC tier + suitability + accepted active terms + product/asset/country eligibility.

## Core Product Rules (always true)
No trade without KYC · without accepted active terms · without completed suitability. No asset trades unless admin-enabled. No order from client-side calc only · without server-side pre-check · without idempotency key. No wallet change without ledger entries. No failed order permanently traps funds. No admin edits balances directly. Every admin action audited; sensitive changes support maker-checker. Every order has a provider reference; every settlement is reconcilable. Every fee visible before confirmation; every market-data status labeled; every user sees risk disclosure before trading; every public offer shows official details; every corporate action traceable to a source; every complaint has a ticket + SLA.

---

## Onboarding flow
Invest tab → intro → risk disclosure → confirm country/residency → product-availability check → KYC (verify existing or upgrade) → accept investment terms → suitability questionnaire → investor profile issued → eligible features unlocked. Reuse existing Paymax identity; upgrade KYC only when necessary. Record agreement-version acceptance + suitability answers; persist progress; resume if interrupted.

**Onboarding states:** not started · started · KYC required · KYC pending · KYC rejected · terms required · suitability required · approved · restricted · suspended.

---

## KYC Tiers

| Tier | Allowed | Restricted |
|---|---|---|
| **0 — Explore** | Educational content, sample market data, demo watchlist | Trade, fund, live portfolio |
| **1 — Basic Verified** | Create profile, watchlist, view market data, complete suitability, fund limited amount (if partner permits) | Low limits, no high-risk features, no large orders |
| **2 — Full Verified** | Buy/sell stocks, withdraw investment cash, statements, public offers (where eligible) | — |
| **3 — Enhanced Due Diligence** | Required for high-value/high-frequency users, PEPs, unusual activity, corporate accounts, cross-border profiles | — |

**KYC data captured:** full name · DOB · phone · email · address · nationality · country of residence · ID document · selfie/liveness · BVN/NIN (where applicable) · bank account · source of funds · employment status · tax residency · PEP declaration · sanctions screening result.

---

## Suitability & Risk Profile
Questions cover: prior stock experience · understanding prices can fall · investment objective · time horizon · reaction to a 20% drop · % of income investable · dividends-not-guaranteed understanding · public-offer oversubscription understanding · market-order price-variance understanding · no-guaranteed-returns acknowledgement.

**Risk categories → eligibility:**
| Category | Eligible products |
|---|---|
| Conservative | Blue-chip stocks, ETFs, education path, low limits |
| Balanced | Standard equities, ETFs, public offers |
| Growth | Wider equities universe |
| Aggressive | Advanced order types where permitted |
| Restricted / education-only | Learn-only until retake |

Profiles can be force-retaken/expired by admin; eligibility override requires approval + audit.

---

## Required agreements (versioned, re-acceptance logged)
Investment terms · partner (broker) terms · market-data terms · risk disclosure · no-investment-advice disclosure · privacy/data consent · fees schedule. User must accept active versions before access.

---

## Pre-Trade Checks (server-side, before EVERY order)
user active · KYC approved · suitability complete · terms accepted · asset enabled · product enabled · market open (where required) · wallet balance sufficient · order within limits · no account restriction · no compliance hold · no duplicate idempotency key · broker provider available.

## Post-Trade Controls (after EVERY order)
provider response stored · ledger updated · user notified · portfolio updated · settlement tracked · reconciliation queued · failed status handled · locked cash/shares released if needed.

---

## Risk Rules (admin-configurable)
new-account trading limit · daily order limit · single-order amount limit · failed-order velocity · suspicious deposit→trade→withdraw pattern · PEP monitoring · unusual-trading alert · account-takeover risk · manual-review threshold · auto-hold / manual-hold.

## AML / Compliance monitoring (admin)
AML alerts · unusual trading · rapid deposit+withdrawal · high-value trades · PEP activity · sanctions match · suspicious behavior · account-takeover signals · case creation/notes/escalation/closure · regulatory report export.
