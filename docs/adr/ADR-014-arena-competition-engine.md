# ADR-014 — Arena competition engine (Merit firewall)

**Status:** Accepted · **Date:** 2026-07-01 · **Scope:** brownfield, additive
**Instance #1:** Naija Driver (Nigerian Drivers Challenge, Nov 2026)

## Context
We need a national, money-touching driver competition that is *provably* un-riggable
in a market where "it was rigged" is the default failure mode. Arena generalizes
the legacy Spotlight contest/voting concept into a config-driven engine. The
legacy voting/contest modules are protected (must not be edited), so Arena is
entirely net-new packages reusing existing rails.

## Decision

1. **"Vote" is polymorphic — four firewalled rails (NDC-1).** Merit (signed
   judging → Merit ledger), Support (real-Naira gifting → wallet ledger + pot),
   Play-Along (free quiz → engagement ledger + credential), Sponsor (branded →
   Featured Placement). Only Merit can produce the crown.

2. **Merit firewall is a compile-time + data-layer property, not a policy.**
   - The Merit ledger appends only `arena.SignedMeritEntry`, and the only
     constructor (`SignScore`) requires a `*crypto.Signer`. The Support/Play-Along/
     Sponsor rails never receive a signer, so no code path can forge a merit write.
   - `arena_merit_entry` is a physically separate table with **no FK** to any
     money/engagement table, is **append-only** (UPDATE/DELETE blocked by trigger),
     signed (Ed25519, NDC-2) and hash-chained per contestant (NDC-6). Verification
     uses public keys only, so the ledger is publicly auditable.
   - `railTargets`/`awardRails` fix the crown to Merit only; not reconfigurable.

3. **Reuse everything else.** KYC tiers (NDC-3 identity gate), finance ledger
   (Support pot + guarded `PotDisbursement`, NDC-4), Connect gifting (Support rail
   attribution), Featured Placement (Sponsor rail), connect/live (finale), RBAC
   (object-level scoped roles: proctor/judge/reviewer per batch/queue), audit.

4. **Config-driven variants.** A rail/award/eligibility change is a data change:
   `arena_competition_config` is an immutable versioned publish; every submission
   is validated against the exact schema version it was submitted under (NDC-6).

5. **ScoringGateway + signed adapters (NDC-2).** TheoryExam, PracticalJudge,
   FirstAid (+ Phase-2 Telematics) each hold a server-side Ed25519 seed and sign
   canonical score payloads. Only adapters in `arena_authorized_adapter` (public
   key registered) may be verified — a revoked/compromised adapter's entries are
   flagged and re-scored from remaining sources.

6. **Guarded lifecycle (NDC-5).** APPLIED→SCREENED→TRAINED→THEORY_ASSIGNED→
   THEORY_TAKEN→QUALIFIED→FINALIST→CROWNED|ELIMINATED (+ admin WITHDRAWN). Illegal
   transitions unreachable; advancement (→QUALIFIED/FINALIST/CROWNED) reads the
   Merit leaderboard ONLY (NDC-1). Side effects atomic with the transition.

7. **CredentialService (NDC-7).** Certified Safe Driver (Play-Along threshold) and
   Naija Driver (crown) issue from Merit state as verifiable-by-hash, independently
   revocable attestations.

8. **Feature-flagged (`FEATURE_ARENA_ENABLED`, default OFF).** Signing seeds are
   server-side only; `Config.Validate()` requires ≥1 valid Ed25519 seed in prod.

## Open (commercial, per NAIJA-DRIVER §7 — configured, not locked)
Prize-pot funding model + split; People's Champion cash vs prestige; telematics/
responder scope (default fast-follow); monetization mix; FRSC/ONSA posture. All
expressed as config; defaults keep the merit prize dominant and take-rates at 0.

## Consequences
- Anti-rigging is a provable, publishable property (signed + chained + public verify).
- Additive migrations only; legacy voting untouched; new competitions are data.
- Money is ledgered/idempotent/reversible; merit is unreachable from money.
