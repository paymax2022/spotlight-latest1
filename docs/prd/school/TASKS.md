# TASKS.md
### Live claimable task board — School Fees, Payments & Cross-School Competition Module
**Protocol:** see `SWARM-BUILD-PLAN.md` §2. An agent claims a task by editing its `status` to `in_progress` and adding its agent ID, committing that change before writing any code. Only tasks with `status: todo` AND all `depends_on` at `status: done` may be claimed. Do not touch files outside `file_scope`.

**Status values:** `blocked` (dependency not yet done) · `todo` (ready to claim) · `in_progress` · `in_review` (PR open) · `done`

---

## T0 — Foundation (serialized, blocks everything)

| ID | Title | Depends on | File scope | Tags | Pts | Status |
|---|---|---|---|---|---|---|
| T0.1 | Brownfield audit — document actual wallet/ledger, KYC, payment-gateway, quiz-engine, admin-console interfaces | — | `REUSE-MAP.md` (new, root) | `[S]` | 6 | todo |
| T0.2 | Schema migrations for all entities in build spec §2 | T0.1 | `/services/edtech-fees/internal/*/migrations/` | `[S][BE]` | 10 | blocked |
| T0.3 | State-machine library — Invoice, FeesVault, Promotion, Competition guarded transitions + full test suite | T0.1 | `/services/edtech-fees/internal/statemachine/` | `[S][BE][T]` | 8 | blocked |

---

## E1 — School onboarding & fee schedules (unlocks after T0)

| ID | Title | Depends on | File scope | Tags | Pts | Status |
|---|---|---|---|---|---|---|
| T1.1 | School CRUD + verification-tier workflow | T0.2, T0.3 | `/services/edtech-fees/internal/school/` | `[BE]` | 6 | blocked |
| T1.2 | AcademicSession + Class CRUD | T0.2, T0.3 | `/services/edtech-fees/internal/session/`, `/internal/class/` | `[BE]` | 5 | blocked |
| T1.3 | FeeSchedule builder API (immutable-on-reference, SF-1) | T1.1, T1.2 | `/services/edtech-fees/internal/fee-schedule/` | `[BE][T]` | 6 | blocked |
| T1.4 | School Admin: Setup Wizard screen (SC-29) | T1.1, T1.2 | `/apps/admin-school/modules/fees/setup-wizard/` | `[ADM-S]` | 5 | blocked |

---

## E2 — Guardian/student onboarding & invoicing (after E1)

| ID | Title | Depends on | File scope | Tags | Pts | Status |
|---|---|---|---|---|---|---|
| T2.1 | Student + Guardian linking (reuses existing identity service) | T1.1–T1.3 | `/services/edtech-fees/internal/student/`, `/internal/guardian/` | `[BE]` | 6 | blocked |
| T2.2 | Bulk CSV import + self-registration approval queue | T2.1 | `/services/edtech-fees/internal/student/import/` | `[BE][T]` | 5 | blocked |
| T2.3 | Invoice issuance service (against immutable FeeSchedule, SF-1/SF-2) | T1.3, T2.1 | `/services/edtech-fees/internal/invoice/` | `[BE][T]` | 6 | blocked |
| T2.4 | Mobile Parent: Onboarding, Link Child, Family Dashboard, Fee Detail (PA-01–PA-04) | T2.1, T2.3 | `/apps/mobile/parent/screens/fees/onboarding/`, `/dashboard/` | `[FE-M]` | 8 | blocked |
| T2.5 | School Admin: Bulk Onboarding module (SC-32) | T2.2 | `/apps/admin-school/modules/fees/onboarding/` | `[ADM-S]` | 4 | blocked |

---

## E3 — Payments & installments (after E2)

| ID | Title | Depends on | File scope | Tags | Pts | Status |
|---|---|---|---|---|---|---|
| T3.1 | Payment intent service — thin adapter to existing gateway, idempotent (SF-2, SF-6) | T2.3 | `/services/edtech-fees/internal/payment/` | `[BE][T]` | 8 | blocked |
| T3.2 | Nightly reconciliation job (SF-8) | T3.1 | `/services/edtech-fees/internal/payment/reconcile/` | `[BE][T]` | 5 | blocked |
| T3.3 | Mobile Parent: Pay Now, Installment Setup, Payment History (PA-05, PA-06, PA-09) | T3.1 | `/apps/mobile/parent/screens/fees/payment/` | `[FE-M]` | 8 | blocked |
| T3.4 | School Admin: Collections Dashboard (SC-33) | T3.1 | `/apps/admin-school/modules/fees/collections/` | `[ADM-S]` | 5 | blocked |

---

## E4 — Fees Vault (parallel to E2/E3, after E1)

| ID | Title | Depends on | File scope | Tags | Pts | Status |
|---|---|---|---|---|---|---|
| T4.1 | FeesVault service — segregated ledger sub-account (SF-5) | T1.1, T0.3 | `/services/edtech-fees/internal/fees-vault/` | `[BE][T]` | 7 | blocked |
| T4.2 | Apply-to-invoice single-action transfer | T4.1, T2.3 | `/services/edtech-fees/internal/fees-vault/apply/` | `[BE][T]` | 4 | blocked |
| T4.3 | Mobile Parent: Vault Home, Auto-Save Rules (PA-07, PA-08) | T4.1 | `/apps/mobile/parent/screens/fees/vault/` | `[FE-M]` | 7 | blocked |

---

## E5 — Hardship & defaulters (after E3)

| ID | Title | Depends on | File scope | Tags | Pts | Status |
|---|---|---|---|---|---|---|
| T5.1 | Hardship/freeze request workflow — human review queue only (SF-9) | T3.1 | `/services/edtech-fees/internal/invoice/hardship/` | `[BE][T]` | 6 | blocked |
| T5.2 | Mobile Parent: Hardship Request screen (PA-10) | T5.1 | `/apps/mobile/parent/screens/fees/hardship/` | `[FE-M]` | 4 | blocked |
| T5.3 | School Admin: Defaulters & Hardship Review Queue (SC-34) | T5.1 | `/apps/admin-school/modules/fees/hardship-queue/` | `[ADM-S]` | 4 | blocked |

---

## E6 — Promotion engine (after E1, independent of payment track)

| ID | Title | Depends on | File scope | Tags | Pts | Status |
|---|---|---|---|---|---|---|
| T6.1 | Score import + promotion-computation engine (proposal only, per §3.3) | T1.2, T0.3 | `/services/edtech-fees/internal/promotion/` | `[BE][T]` | 8 | blocked |
| T6.2 | Two-step approval workflow enforcement (SF-3 — release blocker, extra test rigor) | T6.1 | `/services/edtech-fees/internal/promotion/approval/` | `[BE][T]` | 6 | blocked |
| T6.3 | Class/session rollover executor (fee schedule reassignment on promotion) | T6.2, T1.3 | `/services/edtech-fees/internal/promotion/rollover/` | `[BE][T]` | 5 | blocked |
| T6.4 | School Admin: Promotion Console, Class & Session Rollover (SC-35, SC-36) | T6.2, T6.3 | `/apps/admin-school/modules/fees/promotion/` | `[ADM-S]` | 6 | blocked |

---

## E7 — Cross-school competition (after E1, requires existing Academy quiz engine)

| ID | Title | Depends on | File scope | Tags | Pts | Status |
|---|---|---|---|---|---|---|
| T7.1 | LeaderboardEntry scope extension (class/school/city/state/national) atop existing Academy table | T1.1, T0.1 | `/services/edtech-fees/internal/competition/leaderboard/` | `[BE][T]` | 6 | blocked |
| T7.2 | Competition/tournament service + state machine (§3.4) | T7.1, T0.3 | `/services/edtech-fees/internal/competition/` | `[BE][T]` | 7 | blocked |
| T7.3 | Minor-safe public leaderboard serializer (SF-7 — release blocker) | T7.1 | `/services/edtech-fees/internal/competition/serializer/` | `[BE][T]` | 4 | blocked |
| T7.4 | Mobile Student: Cross-School Leaderboard, Tournament Hub, Challenge, Badges (SA-121–SA-126) | T7.2, T7.3 | `/apps/mobile/student/screens/competition/` | `[FE-M]` | 9 | blocked |
| T7.5 | School Admin: Competition Registration (SC-37) | T7.2 | `/apps/admin-school/modules/fees/competition/` | `[ADM-S]` | 4 | blocked |

---

## E8 — Government/regulator reporting (after E1, E6)

| ID | Title | Depends on | File scope | Tags | Pts | Status |
|---|---|---|---|---|---|---|
| T8.1 | Opt-in ComplianceExport service, per school per data category (SF-11) | T1.1, T6.3 | `/services/edtech-fees/internal/export/` | `[BE][T]` | 8 | blocked |
| T8.2 | School Admin: Government Export Center (SC-38) | T8.1 | `/apps/admin-school/modules/fees/gov-export/` | `[ADM-S]` | 5 | blocked |

---

## E9 — School Trust Score & Sponsor-a-Student (after E3, E7)

| ID | Title | Depends on | File scope | Tags | Pts | Status |
|---|---|---|---|---|---|---|
| T9.1 | School Trust Score computation service | T3.2, T7.2 | `/services/edtech-fees/internal/school/trust-score/` | `[BE][T]` | 6 | blocked |
| T9.2 | ScholarshipPledge service | T3.1 | `/services/edtech-fees/internal/scholarship/` | `[BE][T]` | 6 | blocked |
| T9.3 | Mobile Parent: Sponsor-a-Student, School Directory/Trust Score (PA-14, PA-16) | T9.1, T9.2 | `/apps/mobile/parent/screens/fees/sponsor/` | `[FE-M]` | 6 | blocked |

---

## E10 — Super Admin Console (school-directory slice unlocks right after E1)

| ID | Title | Depends on | File scope | Tags | Pts | Status |
|---|---|---|---|---|---|---|
| T10.1 | `platform_edtech_admin` RBAC capability + console shell registration | T1.1 | `/apps/admin-super/modules/edtech/_shell/` | `[BE][ADM-SU]` | 6 | blocked |
| T10.2 | Platform School Directory + Verification Queue (SU-01, SU-02) | T10.1 | `/apps/admin-super/modules/edtech/directory/` | `[ADM-SU]` | 6 | blocked |
| T10.3 | Platform-Wide Collections Dashboard (SU-03) | T10.1, T3.2 | `/apps/admin-super/modules/edtech/collections/` | `[ADM-SU]` | 5 | blocked |
| T10.4 | Fraud & Risk Queue (SU-04) | T10.1, T3.1 | `/apps/admin-super/modules/edtech/fraud/` | `[ADM-SU]` | 6 | blocked |
| T10.5 | Gov Sync Oversight, Platform Audit Log Viewer (SU-05, SU-11) | T10.1, T8.1 | `/apps/admin-super/modules/edtech/audit/` | `[ADM-SU]` | 5 | blocked |
| T10.6 | Feature Flag & Tenant Config, Compliance & Licensing Dashboard (SU-10, SU-12) | T10.1 | `/apps/admin-super/modules/edtech/config/` | `[ADM-SU]` | 6 | blocked |

---

## E11 — Staff & role management (after E1)

| ID | Title | Depends on | File scope | Tags | Pts | Status |
|---|---|---|---|---|---|---|
| T11.1 | Bursar/teacher/head-teacher role management service | T1.1 | `/services/edtech-fees/internal/school/roles/` | `[BE][T]` | 5 | blocked |
| T11.2 | School Admin: Staff & Bursar Role Management (SC-40) | T11.1 | `/apps/admin-school/modules/fees/roles/` | `[ADM-S]` | 5 | blocked |

---

## E12 — Spotlight Schools Cup production ops (after E7 stable)

| ID | Title | Depends on | File scope | Tags | Pts | Status |
|---|---|---|---|---|---|---|
| T12.1 | Competition & Tournament Ops console, Trust Score admin override, Sponsor oversight (SU-06, SU-07, SU-08) | T10.1, T7.2, T9.1 | `/apps/admin-super/modules/edtech/schools-cup/` | `[ADM-SU]` | 8 | blocked |
| T12.2 | Support Ticket Queue (SU-09) | T10.1 | `/apps/admin-super/modules/edtech/support/` | `[ADM-SU]` | 4 | blocked |
| T12.3 | Production-pipeline hooks for broadcast scheduling (bracket export, results feed) | T12.1 | `/services/edtech-fees/internal/competition/broadcast-export/` | `[BE]` | 4 | blocked |

---

## Board summary

- **Total tasks:** 45
- **Total points:** 258 (matches `SWARM-BUILD-PLAN.md` §4)
- **Immediately claimable at swarm start:** `T0.1` only — everything else is `blocked` until `T0.1`–`T0.3` are `done` and merged.
- **First wave after T0:** `T1.1`, `T1.2` can run in parallel (disjoint file scope). `T1.3`, `T1.4` follow once those two land.
- **Widest parallel wave:** after E1 completes, `T2.1`, `T4.1`, `T6.1`, and `T10.1` all become claimable simultaneously by four different agents with zero file-scope overlap.
