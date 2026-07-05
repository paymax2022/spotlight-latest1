# Arena — Competition Engine PRD

**Instance #1: Naija Driver (Nigerian Drivers Challenge, Nov 2026)**
Status: build-ready. LOCKED decisions are marked. Everything unmarked defers to `../NAIJA-DRIVER.md §7` open decisions.

---

## 1. Overview

`Arena` is a generalized, config-driven competition module — the mature evolution of the Paymax contest-voting module. A single engine runs any competition; each competition is a **declarative configuration**, not code. Naija Driver is the first instance.

The central design move: **"vote" is polymorphic.** It shatters into four firewalled **rails**, each with a different purpose and a different write target. The paid and engagement rails drive virality and revenue while being *structurally incapable* of touching the merit outcome (NDC-1). This is what keeps a national, money-touching contest legitimate in the Nigerian market where "it was rigged" is the default failure mode.

---

## 2. Glossary

- **Competition** — a configured Arena instance (e.g. Naija Driver 2026).
- **Contestant** — a KYC-verified applicant progressing through the lifecycle.
- **Spectator** — any Paymax user engaging via Play-Along / Support, not competing.
- **Rail** — a scoring/engagement channel. Four types: Merit, Support, Play-Along, Sponsor.
- **Merit entry** — a signed, append-only score record; the *only* input to the crown.
- **Award** — a computed outcome (e.g. Naija Driver crown, People's Champion, State Pride winner). Each award declares which rail(s) feed it.
- **Credential** — a persistent, verifiable competence attestation issued from Merit state.

---

## 3. The four-rail scoring model  `[LOCKED]`

Each rail is a first-class, independently-configured channel. A competition config declares which rails are active, their parameters, and which awards each rail feeds.

### Rail 1 — Merit (the real judging; non-purchasable)  `[LOCKED]`
- **Write target:** `MeritLedger` (append-only, signed). No other rail may write here (NDC-1).
- **Sources:** proctored theory exam (three batches), practical driving evaluation (finale), crash-site/first-aid competence assessment, and — Phase 2 — opt-in telematics.
- **Feeds award:** `NAIJA_DRIVER_CROWN` (and per-batch/qualification cutoffs).
- **Rule:** advancement and the crown are a **pure function** of Merit entries. Published rubric (NDC-6).

### Rail 2 — Support (the monetizable "vote" twist; real Naira)  `[LOCKED as mechanism; amounts/splits OPEN]`
- **Write target:** wallet ledger (reuse Connect wallet-to-wallet Naira gifting). **Never** the Merit ledger.
- **Two firewalled effects:**
  1. Contributions flow to a **transparent, ledgered prize/scholarship pot** (derived total, publicly visible).
  2. A separate, clearly-labeled **`PEOPLES_CHAMPION`** tally (aggregated support per contestant).
- **Variants (config flags):**
  - *Back-a-Driver / "Fuel My Journey"* — direct backing into the pot.
  - *State Pride* — 36 states + FCT compete on aggregate support; regional identity as participation fuel; ties to the government-partnership angle.
- **Feeds awards:** `PEOPLES_CHAMPION`, `STATE_PRIDE_WINNER`. **Never** `NAIJA_DRIVER_CROWN`.

### Rail 3 — Play-Along (free engagement; the social-impact payload)  `[LOCKED]`
- **Write target:** spectator engagement ledger + `CredentialService`. Never Merit.
- **Mechanism:** the **exact theory, hazard-perception, and first-aid content contestants take** is opened to the public as a gamified quiz — *"Are You a Naija Driver?"* Every spectator who plays gets road-safety trained. This makes the event a **national driver-literacy campaign disguised as a game show.**
- **Rewards:** badges, wallet cashback (small, ledgered), and a persistent **Certified Safe Driver** credential on passing thresholds.
- **Sub-layer — *Predict-the-Champion*:** fantasy picks; spectators earn engagement points as their picks advance. Keeps the audience locked across all four Saturdays.
- **Feeds award:** `CERTIFIED_SAFE_DRIVER` credential; engagement leaderboards. Never the crown.

### Rail 4 — Sponsor (weighted, branded)  `[LOCKED as mechanism]`
- **Write target:** engagement ledger + Featured Placement (reuse paid-promotion mechanics). Never Merit.
- **Mechanism:** sponsored challenges, branded badges, sponsor visibility slots. Insurers (MyCover/Octamile), fuel/auto brands, telcos, FRSC.
- **Rule:** may weight *engagement* rewards; walled off from Merit (NDC-1).

**Firewall enforcement:** Merit and money/engagement are separate stores with separate write paths. The `MeritLedger` write API accepts **only** signed entries from authorized `ScoringGateway` adapters (NDC-2); it has no code path reachable from Support/Play-Along/Sponsor handlers.

---

## 4. Merit ledger  `[LOCKED]`

Append-only. Balances/leaderboard **derived**, never mutated. Mirrors the wallet-ledger discipline.

```
merit_entry
  id                 uuid pk
  competition_id     uuid fk        not null
  contestant_id      uuid fk        not null
  source_type        enum(THEORY_EXAM, PRACTICAL, FIRST_AID, TELEMATICS)  not null
  source_adapter_id  text           not null      -- which authorized adapter emitted this
  stage              enum(SCREENING, THEORY_B1, THEORY_B2, THEORY_B3, FINALE_PRACTICAL, FINALE_FIRSTAID)
  rubric_version     text           not null      -- exact scored rubric version (NDC-6)
  raw_score          numeric        not null
  normalized_score   numeric        not null
  signature          bytea          not null      -- adapter signature over canonical payload (NDC-2)
  signed_at          timestamptz    not null
  recorded_at        timestamptz    not null default now()
  -- no update/delete; corrections are compensating append-only entries with reason
  constraint uq_no_replay unique (source_adapter_id, competition_id, contestant_id, stage, signed_at)
```

- **Derived leaderboard:** materialized view keyed by `(competition_id, stage)`, ordered by summed `normalized_score`, tie-break by earliest `signed_at`.
- **Corrections:** never edit; append a compensating entry with `reason` and re-sign. Full history preserved for audit (NDC-6).
- **Integrity proof:** each entry chained (hash of prior entry per contestant) so the ledger is tamper-evident and publicly verifiable.

---

## 5. ScoringGateway + adapter contract  `[LOCKED]`

Provider-agnostic, per-source adapters. Same pattern as your FX / Broker / Streaming gateways. Adds a signing requirement.

**Adapter interface (every source implements):**
```
interface ScoringAdapter {
  id: string                              // registered, authorized adapter identity
  supports(stage): boolean
  submitScore(payload: ScorePayload): SignedMeritEntry
  //   - validates payload against rubric_version schema
  //   - computes normalized_score deterministically
  //   - signs canonical(payload) with the adapter's key
  verify(entry: SignedMeritEntry): boolean // signature + rubric-version check
}
```

- **TheoryExamAdapter** — consumes proctored exam results (item responses + proctor attestation) → signed entry. Anti-cheat: per-batch item randomization, time-boxing, webcam/proctor attestation as a signed field, one attempt per (contestant, batch).
- **PracticalJudgeAdapter** — Lagos finale; multiple judges submit rubric scores; adapter aggregates (e.g. trimmed mean) and signs. Records each judge identity for audit.
- **FirstAidAdapter** — crash-site/golden-seconds competence assessment (the brief's explicit mandate) → signed entry.
- **TelematicsAdapter** `[Phase 2]` — opt-in phone telematics over a qualifying window (harsh braking, speeding, phone-use) → normalized signed entry. Doubles as insurance-underwriting signal. Consent/liability heavy.

**Authorization:** only adapters in the `authorized_adapter` registry (per competition) may call the Merit write API. Adapter keys are rotated and access-controlled. Compromised adapter → revoke key, its entries flagged, re-score from remaining sources.

---

## 6. Money rails (reuse)  `[LOCKED as mechanism]`

- **Support contributions** = wallet-to-wallet gifting entries (Connect), tagged `competition_id` + `contestant_id` + `rail=SUPPORT`. Idempotent (NDC-4).
- **Prize pot** = derived sum of pot-tagged entries; publicly displayed; disbursed via existing payout rails through a guarded `PotDisbursement` transition (multi-sig / admin-approved, audited).
- **People's Champion tally** = derived aggregate of support per contestant; **display-only**, isolated from Merit.
- **Cashback / rewards** (Play-Along) = small ledgered credits; rate-limited; abuse-monitored.

---

## 7. Data model (core entities)

```
competition            id, name, status(DRAFT|OPEN|SCREENING|RUNNING|FINALE|CLOSED),
                       config_version, timezone, created_by
competition_config     competition_id, rails[] (typed params), awards[] (rail bindings),
                       eligibility_schema_version, rubric_versions{}, screening_schema_version
contestant             id, competition_id, user_id (fk → paymax user), state (see §8),
                       state_hconvered? , kyc_tier, home_state (36+FCT), created_at
                       unique(competition_id, user_id)        -- NDC-3 one entry per human
application            id, contestant_id, review_state, submitted_schema_version, payload,
                       reviewer_id, decided_at, decision_reason
merit_entry            (see §4)
support_txn            wallet-ledger entry (reuse), tagged competition/contestant/rail
engagement_event       spectator_id, competition_id, type(QUIZ_PASS|PREDICTION|...), points, at
award_result           competition_id, award_type, subject_id(contestant|state|spectator),
                       computed_from_rail[], value, finalized_at, signature
credential             id, user_id, competition_id, type, tier, issued_from_merit_ref,
                       status(ACTIVE|REVOKED), verifiable_hash
audit_log              actor, entity, action, before, after, at   -- immutable (NDC-5,6)
```

Constraints encode rules at the DB level: unique `(competition_id, user_id)` (NDC-3); FK integrity; check constraints on state enums; no update/delete triggers on `merit_entry` and `audit_log`.

---

## 8. Contestant lifecycle state machine  `[LOCKED]`

```
APPLIED
  → SCREENED           (screening rubric pass; else → REJECTED)
  → TRAINED            (training completion recorded)
  → THEORY_ASSIGNED    (assigned to batch B1|B2|B3)
  → THEORY_TAKEN       (exam submitted; signed Merit written)
  → QUALIFIED          (Merit ≥ theory cutoff; else → ELIMINATED)
  → FINALIST           (top-N by Merit advance to Lagos finale)
  → CROWNED | ELIMINATED   (finale practical + first-aid Merit resolves)

Terminal: REJECTED, ELIMINATED, CROWNED, WITHDRAWN
Reversible admin path: any → WITHDRAWN (with reason, audited)
```

Rules (per `backend-engineering` conventions):
- **Reject any transition not explicitly listed.** No ad-hoc status mutation (NDC-5).
- **Side effects are atomic with the transition.** e.g. on `SCREENED→TRAINED`: unlock training content, notify, audit. On `→QUALIFIED`: compute from Merit leaderboard cutoff (idempotent). On `→CROWNED`: issue `NAIJA_DRIVER` credential, finalize `award_result` with signature, disburse crown prize via guarded `PotDisbursement`, audit — all in one transaction.
- **Every transition records** actor + timestamp + reason → `audit_log`.
- Advancement transitions (`→QUALIFIED`, `→FINALIST`, `→CROWNED`) read **only** the Merit leaderboard — never any engagement/money tally (NDC-1).

---

## 9. RBAC (object-level)  `[LOCKED]`

Effective permissions computed from durable grants; checked on every route; object-level enforced.

| Role | May |
|---|---|
| Applicant/Contestant | manage own application, take assigned exam, view own Merit + public leaderboards |
| Spectator | Play-Along, Support (gift), Predict; view public data only |
| Proctor | submit theory attestations for assigned batch only |
| Judge | submit practical/first-aid scores for finale only |
| Reviewer | screen applications in their queue only |
| Competition Admin | manage config, run guarded transitions, approve disbursements |
| Auditor | read-only access to Merit ledger + audit log + integrity proofs |

- Never trust a client-supplied role. No cross-competition data leakage — default query is "only what this caller may see."
- A judge cannot score a contestant outside their assignment; a reviewer cannot see another queue; a contestant cannot read another's raw scores.

---

## 10. Config-driven variants  `[LOCKED]`

Adding a rail, award, or eligibility variant is a **data change**, not a deploy. Form/exam/screening schemas are versioned; every submission is validated server-side against the **exact version** it was submitted under (NDC-2, NDC-6). Each contestant type (if future competitions add classes — e.g. commercial vs private drivers) maps in config to its grant, reviewer group, and required KYC tier.

---

## 11. Anti-abuse / anti-rigging

- **Identity gating (NDC-3):** BVN/NIN-tiered KYC for contestants, backers, voters. Kills bot voting and duplicate entries at the source.
- **Firewall (NDC-1):** structurally no money→merit path. This is the headline anti-rigging property — publish it.
- **Idempotency (NDC-4):** all support/reward/grant writes keyed; retries never double-apply.
- **Signed merit (NDC-2)** + **chained ledger (NDC-6):** tamper-evident, publicly verifiable outcome.
- **Rate limits** on Play-Along cashback and Support endpoints; anomaly monitoring on support spikes.
- **Immutable audit** for every decision and sensitive change; exportable for FRSC/regulator scrutiny.
- **Published rubric + public integrity proofs** before results — pre-commit to the scoring, then prove adherence.

---

## 12. API surface (representative)

```
POST /competitions/{id}/applications           # applicant submits (KYC-gated)
POST /competitions/{id}/screening/{cid}/decide  # reviewer (guarded transition)
POST /scoring/{competition}/entries             # ScoringGateway adapters ONLY (signed)  [NDC-2]
GET  /competitions/{id}/leaderboard/merit        # public, derived, read-only
POST /competitions/{id}/support                  # spectator gift → pot + People's Champion  [NDC-4]
GET  /competitions/{id}/pot                       # public derived total
POST /competitions/{id}/playalong/attempt         # spectator quiz → engagement + credential
POST /competitions/{id}/predictions               # fantasy picks
POST /competitions/{id}/transitions/{cid}         # admin guarded lifecycle transition  [NDC-5]
POST /competitions/{id}/awards/finalize           # admin; computes from bound rails; signs
GET  /credentials/{userId}/verify                 # public credential verification  [NDC-7]
```

Every state-changing route: authN + object-level authZ + idempotency + audit write.

---

## 13. Screen inventory & UX flows

Full screen-by-screen UI/UX flow, navigation map, cross-cutting flows (KYC gate, gifting, notifications, offline), and end-to-end admin console workflows/runbooks live in **`docs/UX-FLOWS.md`**. Summary of the canonical screen set (codes are stable references for design/eng tickets):

**Mobile — Contestant (`C0–C9`):** Enter the Challenge · Register/KYC · Application form · Screening status · Training hub · Exam-batch assignment + countdown · Proctored exam runner · My Merit/progress · Finalist/finale logistics · Credential wallet. *(Each gated by the §8 lifecycle state; Compete tab renders the screen matching current state.)*

**Mobile — Spectator (`S1–S9`):** Competition home/live leaderboard · "Are You a Naija Driver?" quiz · Quiz results + Certified Safe Driver badge · Driver profile · Back-a-Driver (Support) · State Pride · Predict-the-Champion · Live finale stream + live gifting · Prize-pot transparency.

**Admin / operations console (`A1–A9`):** Competition config · Screening review queue · Proctor console · Judge console · Lifecycle transition console · Merit ledger + integrity/audit viewer · Pot & disbursement approvals · Sponsor/Featured Placement manager · Credential issuance/revocation. *(Operational runbooks R1–R5 in `UX-FLOWS.md` span multiple consoles: run a theory batch, screen the pool, execute the finale & crown, disburse the pot, activate the registry.)*

---

## 14. Credential + cross-vertical hooks  `[Phase 4 activation; issuance LOCKED]`

`CredentialService` issues **Certified Safe Driver** (from Play-Along thresholds) and **Naija Driver** (from crown) as verifiable, revocable attestations in the Paymax identity graph (NDC-7). Post-event value:
- **Transport onboarding** — vetted driver-competence signal for the 10-vertical transport module.
- **Micro-insurance pricing** — certified drivers get discounts (MyCover/Octamile); closes the loop: drive safely → prove it → pay less.
- **B2B haulage/fleet** — trust primitive for logistics partners.
- **Golden-seconds responder network** `[Phase 4, opt-in]` — certified drivers become a geolocated bystander-responder layer (reuse MapService + dispatch patterns); pinged near reported incidents before formal responders arrive. Institutional-partnership headline (FRSC/ONSA).

The competition thereby seeds a **national driver-competence registry** — the real asset.

---

## 15. Reuse vs net-new (per component)

| Component | Disposition |
|---|---|
| SSO + tiered KYC (BVN/NIN) | **Reuse** |
| Wallet ledger + Naira gifting (Support rail) | **Reuse** (Connect) |
| Guarded state machines / idempotency / audit | **Reuse** (house conventions) |
| LiveKit + LL-HLS + Streaming Gateway (finale) | **Reuse** (Connect) |
| Featured Placement / paid promotion (Sponsor rail) | **Reuse** |
| MapService / geocoding (finale + responder net) | **Reuse** |
| Micro-insurance + transport onboarding hooks | **Reuse** (integration) |
| Referral system | **Reuse** |
| `Arena` config layer | **Net-new** |
| `MeritLedger` + signed scoring | **Net-new** |
| `ScoringGateway` + adapters | **Net-new** (follows existing gateway pattern) |
| Exam/quiz engine (shared contestant + Play-Along) | **Net-new** |
| Prize-pot ledger + People's Champion tally | **Net-new** (on wallet-ledger primitives) |
| `CredentialService` | **Net-new** |

---

## 16. Build plan → 28 Nov 2026

See `../NAIJA-DRIVER.md §6`. Critical path: Arena core + Merit ledger + ScoringGateway (Phase 0) → screening + Play-Along soft launch (Oct) → theory batches + engagement rails (7/14/21 Nov) → live finale (28 Nov) → registry/credential activation (Phase 4).

## 17. Open decisions

See `../NAIJA-DRIVER.md §7`. Not locked: prize-pot funding model + split formula; People's Champion cash vs prestige; telematics/responder scope; monetization mix; FRSC/ONSA partner-of-record posture.
