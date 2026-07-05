# NAIJA-DRIVER.md

> **Anchor doc.** Read this first, then `docs/ARENA-PRD.md` for the full spec and `docs/UX-FLOWS.md` for the mobile UI/UX flow + admin console workflows.
> This file states the mission, the non-negotiable invariants, and the module map. It does not repeat Paymax house conventions — those are assumed and referenced.

---

## 1. What this is

**The Nigerian Drivers Challenge ("Naija Driver")** is Nigeria's first national drivers' competition, peaking **28 November 2026** with a live grand finale in Lagos. Applicants register, get trained, sit proctored theory exams (online, in three batches on **7 / 14 / 21 Nov**), are evaluated on practical driving and crash-site/first-aid competence, and one is crowned **Naija Driver**. Screening starts **October 2026**.

**Architecturally, this is not a bespoke build.** It is **flagship instance #1 of `Arena`** — a generalized, reusable competition module that is the mature evolution of the Paymax contest-voting module. Naija Driver is a **configuration** of Arena, not a fork of it. Every future contest (talent shows, edutainment competitions, sponsor activations) reuses the same engine.

**The business case, stated plainly:** the crown is the marketing; the **Certified Naija Driver credential registry is the product.** The competition is a customer-acquisition, driver-education, and behavioral-data engine for the entire Paymax mobility stack (transport, micro-insurance, logistics), wearing a game-show costume. Design every decision to serve that, not just the November event.

---

## 2. Non-negotiable invariants (NDC-*)

These are enforced **structurally** (schema constraints + guarded transitions), not by policy or code review. If a change would violate one, it is rejected at the data layer.

- **NDC-1 — Merit firewall.** No purchasable or engagement rail (Support, Sponsor, Play-Along) may **ever** write to the Merit ledger. The crown is a pure function of signed Merit entries. Money ledger and Merit ledger are **physically separate stores**, reconciled only for reporting, never for scoring.
- **NDC-2 — Signed merit only.** Every Merit entry is cryptographically signed by an authorized evaluating source (proctor, practical judge, first-aid assessor, or opt-in telematics adapter). Unsigned or unauthenticated score writes are unreachable.
- **NDC-3 — Identity-gated participation.** Every contestant, backer, and voter is a KYC-verified real identity (BVN/NIN, tiered). One human → one contestant entry and one Play-Along identity. Verification identifiers are unique across accounts (no duplicate-identity abuse).
- **NDC-4 — Money is ledgered.** Every "Support" contribution, prize-pot movement, and payout is an append-only wallet-ledger entry (reuse Connect gifting rails). Balances and pot totals are **derived**, never mutated. Every movement is idempotent and reversible.
- **NDC-5 — Guarded lifecycle.** A contestant's status only changes through explicitly allowed transitions (see `docs/ARENA-PRD.md §8`). Illegal states are unreachable. Every transition records actor + timestamp + reason and writes an audit entry.
- **NDC-6 — Auditable outcome.** The scoring rubric is published in advance, and the Merit ledger's integrity proofs are publicly verifiable. Anyone can confirm the crown follows from signed scores. Anti-rigging is a *provable* property, not a claim.
- **NDC-7 — Credential integrity.** The Certified Safe Driver / Naija Driver credential is issued only from Merit-ledger state, is verifiable, and is independently revocable without affecting a user's unrelated Paymax capabilities.

---

## 3. House conventions (assumed — do not re-litigate)

Standing Paymax conventions apply verbatim: single-identity multi-capability user model; append-only ledgers with derived balances; guarded state machines with illegal states structurally unreachable; idempotency on all financial and grant operations; immutable audit trails; **provider-agnostic gateways with per-provider adapters**; offline-first mobile patterns; config/schema-driven variants (a new rail or award is a data change, not a deploy). See the `backend-engineering` conventions for the enforcement baseline.

---

## 4. Module map

```
Arena (generic competition engine)
├── CompetitionConfig        declarative: rails, awards, eligibility, schema versions
├── ScoringGateway           provider-agnostic; per-source signed adapters
│   ├── TheoryExamAdapter     proctored online exam → signed Merit entries
│   ├── PracticalJudgeAdapter Lagos finale scoring → signed Merit entries
│   ├── FirstAidAdapter       crash-site/golden-seconds assessment → signed Merit
│   └── TelematicsAdapter     (Phase 2) opt-in real-world driving → signed Merit
├── MeritLedger              append-only, signed, derived leaderboard  [NDC-1,2,6]
├── EngagementRails
│   ├── SupportRail          real-Naira backing → prize pot + People's Champion  [reuse Connect]
│   ├── PlayAlongRail        public quiz "Are You a Naija Driver?" → badges/credential
│   └── SponsorRail          branded challenges + Featured Placement  [reuse promo]
├── ContestantLifecycle      guarded state machine  [NDC-5]
├── CredentialService        issues/verifies/revokes Certified Safe Driver  [NDC-7]
└── LiveFinale               streaming + live gifting  [reuse LiveKit/LL-HLS + Streaming Gateway]
```

---

## 5. Reuse vs net-new (summary)

**Reuse (near-zero net-new):** SSO + tiered KYC (BVN/NIN); wallet ledger + wallet-to-wallet Naira gifting (Connect); guarded state machines; idempotency; immutable audit; LiveKit (WebRTC) + LL-HLS + Streaming Gateway; MapService/geocoding (finale + Phase 2 responder network); Featured Placement/paid-promotion (Sponsor rail); micro-insurance hooks (MyCover/Octamile); transport module onboarding hooks; referral system.

**Net-new:** `Arena` config layer; `MeritLedger` + signed-scoring service; `ScoringGateway` + adapters; the exam/quiz engine (shared content across contestants *and* Play-Along spectators); transparent prize-pot ledger; `CredentialService`.

Full per-component tagging in `docs/ARENA-PRD.md §15`.

---

## 6. Build phases (to 28 Nov 2026)

- **Phase 0 — Now → Sept:** Arena core (config, Merit ledger, ScoringGateway skeleton, contestant lifecycle, KYC gating). No rails wired yet.
- **Phase 1 — October — Screening + Play-Along soft launch:** registration, KYC, applicant screening state machine; open the public "Are You a Naija Driver?" quiz early to build the audience and top-of-funnel *before* contestants compete.
- **Phase 2 — 7 / 14 / 21 Nov — Theory batches + engagement rails live:** proctored exams write signed Merit; Support / State-Pride / Prediction rails run in parallel; weekly Spotlight content drops.
- **Phase 3 — 28 Nov — Live finale (Lagos):** streamed; live gifting + People's Champion tallied on-screen; practical + first-aid scored to Merit; crown reveal from the verifiable ledger; credential issuance to all certified spectators.
- **Phase 4 — Post-event (fast-follow):** credential registry activation across transport/insurance/logistics; optional telematics qualification; optional golden-seconds bystander-responder network.

---

## 7. Open commercial decisions (flag separately — not locked)

1. **Prize-pot model:** sponsor-funded vs. audience-funded (Support rail) vs. hybrid — and the *published* split formula.
2. **People's Champion:** cash-bearing or prestige-only. Recommendation: keep cash modest, keep the merit prize dominant, to protect the crown's meaning.
3. **Telematics & responder network:** launch scope vs. fast-follow (consent/liability heavy — default fast-follow).
4. **Monetization mix:** gifting take-rate, PPV vs. sponsor-funded free stream, sponsor tiers/Featured Placement, certified-driver insurance rev-share.
5. **Institutional posture:** FRSC / ONSA as partner-of-record for the safety curriculum and official recognition of the credential (major legitimacy lever; aligns with the MTV-Shuga-style edutainment model).

---

*Locked architecture decisions are in `docs/ARENA-PRD.md`. Anything not marked LOCKED there is an open decision above.*
