# Compliance & Access Control

> This is the gate in front of all trading. No trade proceeds unless the user clears: KYC tier + suitability + active agreements + product/asset/country eligibility.

## Regulatory model (must be configurable)
The system supports a flexible, jurisdiction-aware compliance model. Required controls: country-level availability · state-level availability (where required) · residency check · citizenship check · KYC-tier check · sanctions screening · PEP screening · AML transaction monitoring · suspicious-activity alerts · asset eligibility · risk disclosures · investor suitability · product restrictions · audit logs · record retention · regulatory reports · admin approvals · provider licensing docs · agreement versioning · risk-disclosure acceptance logs.

---

## Product Access Tiers

| Tier | Identity | Can do | Cannot do |
|---|---|---|---|
| **0 — Guest/Explore** | None | View education, delayed market previews, demo portfolio, quizzes, watchlists (if logged in) | Fund, trade, withdraw, receive recommendations |
| **1 — Verified Identity** | Basic verified | Fund wallet, view eligible markets, complete suitability, buy low-risk approved assets (if partner allows). Low limits. | Crypto withdrawals, high-risk assets |
| **2 — Full KYC** | Full KYC | Stocks, crypto buy/sell, higher limits, bank withdrawals, statements, recurring investments | — |
| **3 — Enhanced Due Diligence** | EDD (for high-volume, high-risk crypto, large withdrawals, business accounts, PEPs, AML-triggered users) | Higher limits, priority support, advanced products where approved | — |

---

## Suitability inputs (required before live trading)
Investment experience · income band · employment status · source of funds · investment objective · risk tolerance · time horizon · loss tolerance · crypto knowledge check · stock knowledge check · volatility understanding · no-guaranteed-return understanding · risk-disclosure agreement.

Suitability produces a `riskCategory` and `eligibleProducts`; profiles **expire** and can be force-retaken/expired by admin. Override requires approval + audit.

---

## Required user agreements (accept before access; versioned + re-acceptance logged)
Paymax general terms · wallet terms · investment terms · stock partner terms · crypto partner terms · market-data terms · risk disclosure · no-investment-advice disclosure · crypto volatility disclosure · order-execution disclosure · custody disclosure · data-processing consent · electronic-communications consent · privacy policy · fees schedule · complaint-resolution policy.

---

## Pre-Trade Checks (run server-side before EVERY order)
user active · KYC approved · suitability complete · product eligible · asset enabled · country allowed · market open (where applicable) · wallet balance sufficient · order within limits · risk score acceptable · no compliance hold · no suspicious velocity · agreement accepted · quote valid (crypto) · provider available.

## Post-Trade Checks (after EVERY trade)
provider confirmation received · ledger updated · portfolio updated · fees posted · receipt generated · notification sent · reconciliation queued · compliance monitoring updated.

---

## Crypto Withdrawal Controls (all must pass)
KYC Tier 2+ · device-age check · address whitelist · address risk screening · cooling period · daily limit · manual-review threshold · high-risk-network restriction · sanctions screening · suspicious-pattern detection · admin approval for high-value.

---

## AML monitoring surface (admin)
Suspicious-transaction alerts · structuring · rapid in-and-out · crypto-withdrawal risk · high-risk asset activity · high-risk geography · PEP alerts · sanctions hits · adverse-media review · case management/notes/escalation · SAR/STR export template (where applicable).
