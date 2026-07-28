# PAYMAX PHARMACY — SYMPTOM-BASED MEDICATION SEARCH
## Addon PRD v1.0 · Spotlight × Paymax · July 2026

---

## 0. POSITIONING & PRIME CONSTRAINT

**What this is:** A symptom-first discovery layer on top of the existing Paymax Pharmacy catalog. The user types or taps what they feel ("headache and fever," "body dey pain me," "catarrh") and the system resolves it to **safe, NAFDAC-registered product options** with pharmacist-in-the-loop gating.

**What this is NOT (non-negotiable):** This is **not a diagnosis engine and not a prescribing engine.** The system never tells a user what condition they have and never recommends a prescription-only medicine (POM) without a valid prescription or completed pharmacist/telehealth consult. Legally and in every line of UX copy, this feature is "symptom-guided product discovery with professional review" — the same suggest-approve posture as the Nutrition Resolution Engine.

**Why this framing wins commercially:** Nigeria's biggest pharmacy UX gap is that users don't know drug names — they know symptoms. Chemists solve this informally today (and often dangerously). Paymax formalizes it with a compliance moat competitors can't cheaply copy: PCN-aligned pharmacist review baked into the order flow.

---

## 1. REUSE vs NET-NEW (house convention — run first)

| Capability | Verdict | Detail |
|---|---|---|
| AI suggest-approve architecture | **REUSE** | Clone the Nutrition Resolution Engine pattern: AI proposes symptom→class mappings; a licensed pharmacist approves before anything reaches production. Same admin approval console skeleton. |
| Pre-consultation health intake | **REUSE** | Red-flag symptom escalations route directly into the existing intake flow (mobile screens + admin queue already specced). No new consult flow is built. |
| Marketplace catalog & SKU model | **REUSE + EXTEND** | Pharmacy SKUs already exist. Extend with therapeutic-class taxonomy, POM/OTC/pharmacy-only classification, NAFDAC registration number, and safety-flag fields. |
| Wallet / append-only ledger / checkout | **REUSE** | Zero changes. Payment is standard marketplace checkout with idempotency keys. |
| KYC gateway (Dojah/Smile ID/Youverify adapter) | **REUSE** | Age verification for age-gated products rides the existing tiered KYC. |
| Guarded state machines | **REUSE PATTERN** | Order review flow implemented as an explicit state machine per house convention. |
| Immutable audit trail | **REUSE** | Every AI suggestion, pharmacist decision, and gating event writes to the standard audit log. |
| Symptom taxonomy + resolution engine | **NET-NEW** | The core of this addon. Detailed in §4. |
| Pharmacist review console (pharmacy-specific) | **NET-NEW (thin)** | New queue views on the existing admin console framework. |
| Drug interaction / safety-flag service | **NET-NEW (v1 rules-based)** | Rules engine in v1; licensed drug-database API behind a provider-agnostic adapter in v2. |

---

## 2. GOALS & NON-GOALS

**Goals**
1. Let users find appropriate OTC products from symptoms in ≤3 taps, in English, Pidgin, Hausa, Yoruba, and Igbo terms.
2. Route every non-self-care case to the right professional channel (pharmacist chat, telehealth consult, or emergency guidance) instead of dead-ending.
3. Make the flow fully defensible to PCN and NAFDAC: every recommendation traceable to a pharmacist-approved mapping; every POM sale gated.
4. Lift pharmacy vertical conversion and basket size without lifting regulatory risk.

**Non-goals (v1)**
- No dosing calculators or personalized dosage advice beyond the NAFDAC-approved label ("use as directed on pack / by your pharmacist").
- No controlled substances (NDLEA schedule) sold or surfaced online, ever.
- No antibiotics surfaced via symptom search, even though they are technically purchasable with prescription — antimicrobial stewardship is a hard product stance and a reputational asset. Antibiotics are reachable only via prescription upload.
- No chronic-condition management (hypertension, diabetes) via symptom search — those route to the health vertical's consult flow.

---

## 3. USER JOURNEYS

### Journey A — Simple OTC (the 80% path)
1. User opens Pharmacy tab → prominent "What are you feeling?" search bar with symptom chips (Headache, Fever, Cough, Catarrh, Body Pain, Stomach upset, Allergy, Menstrual pain…).
2. User selects "Headache" + "Fever." Quick refiners (one screen, optional): Who is it for? (Adult / Child 6–12 / Child under 6 / Pregnant or breastfeeding) · How long? (Today / 2–3 days / More than 3 days).
3. Engine returns **therapeutic-class groups**, not a single "best drug": *Pain & fever relief (Paracetamol-based)* / *Pain & fever relief (Ibuprofen-based, not on empty stomach)* — each group listing in-stock, NAFDAC-registered SKUs with price, brand, and pack size.
4. Standard cart → checkout → delivery. A persistent, non-dismissable info line: "These are general options for your symptoms, not a diagnosis. Speak to a pharmacist free — tap here."

### Journey B — Refinement changes the answer
Same as A, but user selects "Pregnant or breastfeeding" → ibuprofen group is suppressed entirely (not shown-but-disabled; **suppressed**), paracetamol group carries a "confirm with pharmacist" nudge, and a one-tap pharmacist chat is offered before checkout.

### Journey C — Red flag → escalation (the flow that keeps the license)
1. User enters "chest pain" or selects "Fever" + "More than 3 days" + "Child under 6."
2. Engine does **not** return products. It returns a triage card: what was flagged and why, then two actions: **Start free pharmacist chat now** (routes into existing pre-consult intake) or **Book telehealth consult**. Genuine emergency phrasing (chest pain + breathlessness, convulsions, unconsciousness, severe bleeding) shows emergency guidance and nearest-facility info via MapService first.
3. If a consult results in a prescription, the POM order is created from the consult, not from search.

### Journey D — POM demand capture
User searches a symptom whose proper treatment is prescription-only. Engine shows any safe OTC adjuncts (e.g., saline spray) plus: "Effective treatment for this needs a prescription. Upload one, or consult a doctor in-app." Prescription upload → pharmacist verification queue → order unlocked on approval.

---

## 4. THE SYMPTOM RESOLUTION ENGINE (net-new core)

Three-layer mapping, all data-driven (config/schema, not code branches):

```
SYMPTOM TERM  →  SYMPTOM CONCEPT  →  CONDITION CLUSTER  →  THERAPEUTIC CLASS  →  SKUs
("body dey        ("myalgia")         ("minor aches,        ("analgesic —         (in-stock,
 pain me")                             non-specific")         paracetamol")         NAFDAC-reg)
```

- **Term layer:** many-to-one synonym table covering English, Pidgin, and major-language terms plus common misspellings. Continuously grown from failed-search logs (AI-suggested, pharmacist-approved).
- **Concept layer:** the canonical internal vocabulary (~150 concepts at launch). Each concept carries structured attributes: severity modifiers, duration modifiers, cohort modifiers (adult/child/pregnancy).
- **Cluster layer:** concept combinations resolve to a cluster with a **triage tier** (below). Combination rules are explicit and versioned — e.g., `fever + duration>3d → escalate`, `fever + child<6 → escalate`, `headache + sudden/severe → emergency`.
- **Class→SKU layer:** each cluster maps to 1–3 pharmacist-approved therapeutic classes; classes resolve to live SKUs at query time (stock, region, price).

**Triage tiers (every resolution lands in exactly one):**

| Tier | Meaning | System behavior |
|---|---|---|
| T1 — Self-care | Minor, self-limiting | Show OTC class groups + optional pharmacist chat |
| T2 — Pharmacist-guided | OTC possible but judgment needed (pregnancy, infant, interactions, pharmacy-only meds) | Show options behind a mandatory pharmacist confirmation step |
| T3 — Consult required | Needs diagnosis / POM territory | No products; route to intake/telehealth; capture POM demand |
| T4 — Emergency | Red-flag presentation | Emergency guidance + nearest facility; no commerce UI on this screen |

**AI's role (suggest-approve, never autonomous):** AI drafts new term synonyms, proposes cluster mappings for unresolved searches, and flags mapping inconsistencies. **Nothing AI-drafted is user-visible until a licensed pharmacist approves it in the console.** Every approval records approver, timestamp, and version — the audit answer to any future PCN query is a database export, not a scramble.

---

## 5. REGULATORY & SAFETY ARCHITECTURE (Nigeria-specific)

1. **PCN alignment:** Operate under a superintendent pharmacist of record; the pharmacist review console is designed so PCN can be shown a human-accountable decision chain for every gated sale. Fulfillment only through PCN-licensed premises (Paymax-operated or partner pharmacies via the marketplace).
2. **NAFDAC:** Only SKUs with valid NAFDAC registration numbers are indexable by the engine — enforced by a NOT NULL + validation constraint at the catalog level, not by process.
3. **Product classification is schema, not vibes:** every SKU carries `classification ∈ {OTC, PHARMACY_ONLY, POM, BLOCKED_ONLINE}` with hard server-side gates. Illegal states unreachable: a POM SKU physically cannot enter a cart without an approved prescription/consult reference on the order.
4. **NDPR:** symptom queries + refiners are sensitive health data. Encrypted at rest, access-scoped, excluded from general analytics events (aggregate-only reporting), retention-limited, and never used for ad targeting.
5. **Quantity & abuse limits:** per-user rolling-window quantity caps on abuse-prone OTC categories (e.g., codeine-free cough syrups still capped; anything codeine-containing is BLOCKED_ONLINE). Velocity checks ride existing fraud rails.
6. **Copy discipline:** all user-facing language reviewed once, stored as versioned content: "options for your symptoms," never "treatment for your condition."

---

## 6. DATA MODEL (delta only)

```
symptom_term(id, term, language, concept_id FK, status, source{CURATED|AI_SUGGESTED}, approved_by, approved_at)
symptom_concept(id, canonical_name, attributes JSONB, version)
condition_cluster(id, name, triage_tier, rule_version)
cluster_rule(id, cluster_id FK, expression JSONB, priority)          -- versioned combination logic
cluster_class_map(id, cluster_id FK, therapeutic_class_id FK, rank, approved_by, approved_at)
therapeutic_class(id, name, cohort_exclusions JSONB)                 -- e.g. NSAID: exclude pregnancy
sku_extension(sku_id FK, nafdac_reg_no NOT NULL, classification ENUM, therapeutic_class_id FK,
              age_min, pregnancy_safe BOOL, max_qty_per_window)
prescription(id, user_id, file_ref, status: UPLOADED→UNDER_REVIEW→VERIFIED|REJECTED,
             reviewed_by, order_id nullable, expires_at)
review_case(id, order_id, tier, state, pharmacist_id, sla_deadline)  -- pharmacist queue
audit_log(...)                                                        -- standard immutable schema
```

**Order review state machine (guarded transitions only):**
`CART → SUBMITTED → AUTO_CLEARED (T1) | PHARMACIST_REVIEW (T2/POM) → (NEEDS_INFO ↔ PHARMACIST_REVIEW) → APPROVED → FULFILLMENT | REJECTED → REFUND(ledger reversal entry)`
Every transition atomic, idempotent, audit-logged with actor.

---

## 7. API SURFACE (delta only)

```
POST /pharmacy/symptom-search        {terms[], refiners{}}         → {tier, clusters[], class_groups[] | escalation_card}
GET  /pharmacy/classes/{id}/skus     ?region=…                     → in-stock SKUs
POST /pharmacy/prescriptions         (multipart)                    → prescription id + status
POST /pharmacy/orders                (idempotency-key required)     → order + review_case if gated
POST /admin/pharmacy/mappings/…      (pharmacist console CRUD; RBAC: PHARMACIST, SUPERINTENDENT)
POST /admin/pharmacy/reviews/{id}/decision  {APPROVE|REJECT|NEEDS_INFO, note}
```
Object-level authorization throughout (a pharmacist sees only cases assigned to their premises tenant). Rate-limit symptom-search per device to blunt scraping of the mapping IP.

---

## 8. SCREEN INVENTORY (delta only)

**Mobile (7):** Symptom search home (chips + free text) · Refiner sheet · Results (class groups) · Escalation/triage card · Pharmacist chat entry (reused intake) · Prescription upload · Order status w/ review state.
**Pharmacist console (5):** Review queue (SLA-sorted) · Case detail (symptoms, cart, cohort flags, history) · Prescription verification · Mapping approval workbench (AI suggestions diff view) · Audit search.
**Admin (2):** Taxonomy/rules versioning · Analytics dashboard.

---

## 9. KPIs & GUARDRAILS

**Growth:** symptom-search → add-to-cart rate; share of pharmacy orders originating from symptom search (target 35% by M6); failed-search rate (<8% by M3 via synonym growth loop); basket size delta vs name-search.
**Safety (dashboard-pinned, reviewed weekly with superintendent):** % T2/T3 correctly gated (target 100% — any leak is a Sev-1); pharmacist review SLA (median <10 min, 08:00–22:00 WAT); escalation completion rate (users who actually reach a pharmacist after a T3/T4 card); prescription verification rejection reasons.
**North-star framing for regulators & press:** "Paymax is the pharmacy that refuses to sell you the wrong drug."

---

## 10. ROLLOUT

- **Phase 1 (Weeks 1–6):** Taxonomy v1 (~150 concepts, ~600 terms), rules engine, T1/T4 tiers live, 200 top OTC SKUs classified, Lagos only, pharmacist console MVP. AI suggestion loop in shadow mode.
- **Phase 2 (Weeks 7–12):** T2/T3 gating + prescription upload + review state machine live; Pidgin/Hausa/Yoruba/Igbo term packs; interaction rules v1 (top 50 OTC pairs).
- **Phase 3 (M4–M6):** Licensed drug-database adapter (provider-agnostic, dual-candidate evaluation per house convention); partner-pharmacy marketplace fulfillment; abuse-cap tuning; national rollout.

**Top risks:** (1) Pharmacist review SLA becomes the bottleneck → mitigate with tiered staffing model + auto-clear expansion only via approved rule changes. (2) Users route around gating by name-searching POMs → same classification gates apply at SKU level regardless of entry path. (3) Mapping IP scraped by competitors → rate limits + the real moat is the approval workflow, not the table.

---

*Prepared in Paymax house conventions: reuse-first, provider-agnostic adapters, guarded state machines, append-only ledger untouched, suggest-approve AI, immutable audit. Superintendent pharmacist sign-off required on §4 taxonomy and §5 gating rules before build.*
