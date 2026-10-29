# Crypto Module — Phase 0 Summary & Immediate Actions

**Date:** 2026-10-28  
**Source:** `Crypto_Quidax_Brownfield_Implementation_Workplan.md` (v1.0)  
**Phase 0 Status:** Discovery complete; awaiting CR-006 & CR-007 gates  
**Next Gate:** Technical design review (CR-002–CR-005)

---

## Executive Summary

The crypto trading module (Quidax Instant Swap integration) is **40–50% built**. The backend has substantial scaffolding (handler routes, service layer, database schema, tests), but **critical execution paths are incomplete or unverified:**

### ✅ What Works
- Backend API routes defined (assets, quotes, swaps, withdrawals)
- Database schema in place (~8 migrations)
- Ledger integration (double-entry, clearing accounts)
- Comprehensive test infrastructure (invariants, atomicity, concurrency)
- Error handling & tier-limit gates wired

### ❌ What's Broken / Missing
- **Quidax adapter** — Unclear if live or still mocked (CR-006)
- **Quote TTL enforcement** — 15-second expiry location unknown (CR-011)
- **Webhook signature verification** — Implementation unverified vs Quidax docs (CR-013)
- **Mobile screens** — Inventory not done; likely 50% missing (CR-003)
- **Admin dashboards** — Reporting UI unknown; data layer exists (CR-004)
- **Feature flags** — Roll-out control not found in code (CR-017)
- **Legal/compliance approval** — Custody model not signed off (CR-005, CR-007)

### 🔴 R1 Release Blockers (Must Resolve First)
1. **Quidax merchant credentials** (CR-006) — not yet secured
2. **Custody topology approval** (CR-005) — not documented/signed
3. **Legal/compliance gates** (CR-007) — deposits/withdrawals/KYC approval needed
4. **Mobile UI completion** (CR-003) — scope unknown
5. **Finance sign-off** on ledger reconciliation (CR-032)

---

## Immediate Actions (Next 3–5 Days)

### Today/Tomorrow — Information Gathering (Blocking Work)

| Action | Owner | Deadline | Blocker? | Impact |
|--------|-------|----------|----------|--------|
| **CR-006:** Contact Quidax partner → get sandbox creds + docs | Backend | EOD Wed | YES | Cannot test provider calls |
| **CR-002:** Read `service_ext.go` + search "quidax" in all files → find adapter | Backend | EOD Wed | YES | Don't know if live or mock |
| **CR-005:** Finance review custody topology + ledger mapping → document + sign | Finance + TL | EOD Wed | YES | Cannot finalize schema |
| **CR-003:** Mobile lead audit → screenshot all crypto screens, mark state | Mobile | EOD Wed | YES | Don't know build scope |
| **CR-007:** Product + Legal → scope approval meeting + feature flag sign-off | Product + Legal | Thu/Fri | YES | Cannot merge code |

### By Friday — Design Review (Gates CR-001–CR-007)

Once the above five actions complete:

- [ ] Run `go test ./... -race` + `npm run test:regression` → baseline green
- [ ] Update `02-feature-gap-register.md` with findings from CR-002, CR-003, CR-005
- [ ] Hold technical design review: backend leads + mobile lead + finance + TL
- [ ] Record: Quidax creds secured, custody ADR signed, scope/flags approved
- [ ] **Gate G0 sign-off:** No feature marked "Not Assessed"; all P0 gaps assigned & estimated

---

## Critical Path to R1 Release (7–10 weeks)

```
Week 1: CR-001–CR-007 (discovery + design gates)
  ↓
Week 2–3: CR-009–CR-015 (Quidax adapter + core money path) [Backend]
Week 2–3: CR-019–CR-023 (mobile screens) [Mobile, parallel]
          CR-024–CR-029 (admin UI) [Admin, parallel]
  ↓
Week 4–5: CR-030–CR-034 (testing + hardening)
  ↓
Week 6: CR-035–CR-037 (staging pilot + production launch)
```

**No phase can start until the previous phase's gate passes. E.g., no CR-009 (Quidax adapter) code until CR-006 (credentials) is unblocked.**

---

## Work Estimates by Track

| Phase | Component | Days | Parallel | Critical Path |
|-------|-----------|------|----------|--|
| 0 | Discovery + design | 5 | No | ✓ Gate G0 |
| 1 | Backend (adapter, TTL, state machine, webhook, ledger, reconciliation) | 12 | Yes | ✓ Blocks Phase 2 |
| 1 | Mobile (5–8 screens) | 12 | Yes (with Phase 1) | ✓ Blocks Phase 3 testing |
| 1 | Admin (dashboards, reports, controls) | 10 | Yes (with Phase 1) | ✓ Blocks Phase 3 testing |
| 2 | Testing (unit, E2E, VAPT, load, chaos) | 10 | No | ✓ Blocks release |
| 3 | Launch (canary, GA, hypercare) | 3 + stabilization | No | ✓ Final gate |
| **Total** | | **52 days (10.4 weeks)** | *Can run Phase 1 tracks in parallel* | G0 → G1 → G2 → Launch |

**If all three Phase 1 tracks (backend, mobile, admin) run in parallel:** timeline is ~8 weeks (G0 + Phase 1 sequential + Phase 2 sequential + Phase 3).

---

## What "Done" Means (Release Gates)

### G0 Architecture (By end of Week 1)
- [ ] No "Not Assessed" gaps
- [ ] Quidax merchant credentials secured in secret manager
- [ ] Custody topology ADR signed by Finance + Legal
- [ ] Feature flag list (6 flags) finalized in code
- [ ] Baseline tests passing (`go test ./... -race`, mobile regression)

### G1 Backend Money Path (By end of Week 3)
- [ ] CR-009: Quidax adapter quote/confirm/status live-tested in sandbox
- [ ] CR-011: Quote TTL 15-second enforcement + test CR-T026 passing
- [ ] CR-012: Idempotency + state machine + race tests CR-T038–T041 passing
- [ ] CR-013: Webhook HMAC-SHA256 verification + replay protection CR-T049–T053 passing
- [ ] CR-014: Ledger invariants (no overspend, balanced journals) CR-T061–T073 passing
- [ ] All P0 backend tests (subset of CR-T001–T140) passing

### G2 Mobile (By end of Week 3)
- [ ] All R1 screens coded + routed
- [ ] BUY/SELL/SWAP E2E flows tested
- [ ] Loading/empty/error/success states present on all screens
- [ ] No dead CTAs or unfinished forms

### G3 Admin (By end of Week 3)
- [ ] Transaction search/timeline working
- [ ] Reconciliation dashboard showing real data
- [ ] Financial reports reproducible from ledger
- [ ] RBAC role isolation verified

### G4 Security (By end of Week 4)
- [ ] VAPT: 0 critical/high findings
- [ ] Object-level authZ verified
- [ ] Transaction replay (idempotency) verified
- [ ] Webhook forgery (signature) verified
- [ ] Secrets scanning clean

### G5 Release (By end of Week 6)
- [ ] Feature flags tested (on/off/kill-switch)
- [ ] Canary cohort tested with real settlement
- [ ] Finance validates zero unexplained monetary discrepancies
- [ ] On-call engineer confirmed
- [ ] Runbooks tested

---

## Why This Matters (Context)

The crypto module is **load-bearing** for the super-app's fintech roadmap:

- **Revenue:** Transaction fees, FX spreads
- **UX:** Crypto wallets + trading are marquee features
- **Risk:** Money-path code requires iron-clad ledger integrity and provider verification
- **Compliance:** KYC, AML, transaction monitoring, and custody governance are regulatory gates

**Any shortcut (skipped tests, unverified provider calls, incomplete ledger reconciliation) will:**
- Burn customer funds or lock them permanently
- Create audit failures or regulatory sanctions
- Damage trust and revenue at launch

This workplan enforces high discipline: no feature is "done" until proven with evidence (code review, tests, reconciliation sign-off, security approval).

---

## What You Need to Do Now

### For Backend Leads
1. **CR-006 (today):** Email Quidax partner → confirm sandbox merchant account + API docs version
2. **CR-002 (today):** Grep for "quidax" + read `service_ext.go` + `provider.go` → report adapter status
3. **CR-011 (design meeting):** Locate quote TTL code + verify it enforces 15-second expiry
4. **By Friday:** Demo Quidax sandbox quote/confirm call with test creds

### For Mobile Lead
1. **CR-003 (today):** Find all files in `mobile-app/reactnative/app/crypto/` (or `features/crypto/`)
2. **Take screenshots** of every screen (or note "missing" if route doesn't exist)
3. **Map against Workplan §7.1** (M01–M30) — mark Existing / Partial / Broken / Missing
4. **By Friday:** Present gap list with effort estimate for each missing screen

### For Admin Lead
1. **CR-004 (today):** Find all files in `frontend-admin/app/admin/crypto/` (or equivalent)
2. **Screenshot or note missing** — same as mobile
3. **Map against Workplan §8.1** (A01–A28)
4. **By Friday:** Present gap list + note any existing SQL/reporting code

### For Finance Lead
1. **CR-005 (today):** Review `supabase/migrations/` crypto files + `ledger_crypto_clearing_account_type`
2. **Understand:** Does the schema support 1:1 user:subaccount, or is it pooled?
3. **Document:** Custody topology + ledger account mapping in a short 1-page decision doc
4. **Sign off:** Agree that the schema supports the chosen model without breaking customer segregation

### For Product Lead
1. **CR-007 (today):** Draft scope document:
   - R1 (done): BUY, SELL, SWAP via Quidax Instant Swap
   - R1 Conditional: Deposits, withdrawals (require approval)
   - R2 (blocked): Exchange orders, limit orders, order book, partial fills
2. **Define feature flags:** `FEATURE_CRYPTO`, `FEATURE_DEPOSIT`, `FEATURE_WITHDRAW`, `FEATURE_EXCHANGE_ORDERS`
3. **Set defaults:** All default to `false` in production
4. **Obtain legal sign-off:** Schedule 1-hour call with Legal + Compliance to review KYC, AML, transaction monitoring requirements

### For Tech Lead
1. **Schedule gate meeting:** Friday 2 PM (90 min) with all leads + Finance + Legal
2. **Agenda:**
   - Report CR-006 status (Quidax creds + docs)
   - Report CR-002 (adapter status + TTL location)
   - Report CR-003 (mobile gaps + estimate)
   - Report CR-004 (admin gaps + estimate)
   - Report CR-005 (custody topology ADR + sign-off)
   - Review CR-007 (scope + feature flags + legal approval)
   - Gate G0 sign-off: "Ready for Phase 1" or "Blocked on [X]"
3. **Update roadmap** with actual estimates from team

---

## Reference Documents

All in `docs/crypto/`:

1. **01-current-state-audit.md** — What exists, baselines, file inventory
2. **02-feature-gap-register.md** — All gaps mapped to work IDs, impact, disposition
3. **IMPLEMENTATION_ROADMAP.md** — Timeline, sequencing, success criteria, risk register

**Master spec:** `Crypto_Quidax_Brownfield_Implementation_Workplan.md` (v1.0, 2026-10-27)

---

## Success Criteria for This Week

By **Friday EOD 2026-10-28**, you will know:

- ✅ Whether Quidax sandbox is accessible (or blocked by partner)
- ✅ Whether the adapter is live or still mocked (unblocks CR-009)
- ✅ Whether mobile screens are 80% built, 50% built, or 20% built (timeline impact)
- ✅ Whether admin dashboards have SQL backing (effort estimate)
- ✅ Whether custody topology is documented (schema finalized)
- ✅ Whether scope + legal approval is in hand (gates CR-007)

If any of these are "No" / "Unknown", you've identified the top blocker. Unblock it, then move to Phase 1.

---

## If This Is Too Big

If the estimate (8–10 weeks) is unacceptable, here are the **hard cuts** to consider:

| Cut | Impact | Risk |
|-----|--------|------|
| Skip mobile screens (ship as web-only) | Saves 2–3 weeks | High: mobile users see poor UX |
| Skip deposits/withdrawals entirely | Saves 1–2 weeks | Medium: BUY/SELL only, no onchain integration |
| Skip admin reporting UI (CLI/script export only) | Saves 1 week | Medium: Finance works from CSV dumps, not live dashboards |
| Reduce VAPT scope (skip chaos tests) | Saves 1 week | High: untested failure modes, incident response blind |
| Skip financial UAT (trust code review) | Saves 2–3 days | **CRITICAL**: Unrecovered customer balances are unrecoverable |

**Do not cut financial UAT, security testing, or provider verification.** Those gaps compound and explode at scale.

**Realistic fast-track:** 6 weeks if scope is cut to BUY/SELL/SWAP only + no deposits/withdrawals + mobile screens built in parallel + team is full-time. Even then, security + financial UAT cannot be skipped.

---

## Next Document: Phase 1 Execution Plan

Once G0 gates pass, the next document will be:

**`03-phase1-backend-execution.md`** (due ~Nov 1)
- CR-009 (Quidax adapter) detailed design + implementation sequence
- CR-011 (quote TTL) + CR-012 (idempotency) + CR-013 (webhook) + CR-014 (ledger) + CR-015 (reconciliation) detailed specs
- Test case assignments (who writes which test)
- Daily standup template (what to unblock / what's stuck)

---

**Status:** Phase 0 discovery complete. **Gate G0 pending** (CR-006, CR-005, CR-007). Ship it.

