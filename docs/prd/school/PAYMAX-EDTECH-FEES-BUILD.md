# PAYMAX-EDTECH-FEES-BUILD.md
### School Fees, Payments & Cross-School Competition Module — Brownfield Build Spec
**Extends:** root `CLAUDE.md` (base architecture, `NL-1…NL-12`) · Spotlight Academy (curriculum spine, quiz engine, ~120 mobile screens, 28-module school-admin console)
**Companion docs:** `Paymax_SchoolFees_Gamification_PRD.docx` (product rationale) · `SWARM-BUILD-PLAN.md` (execution order, DAG) · `TASKS.md` (live claimable task board)
**Status:** engineering-ready. This file is the contract every agent in the swarm reads before touching code.

---

## 0. Read this first — brownfield rules

This is not a greenfield build. The repo already contains a working wallet/ledger, KYC tiers, a provider-agnostic payment gateway, Spotlight Academy's quiz engine and NERDC curriculum spine, and an existing school-admin console shell. **No agent may write a single line of feature code before completing the audit step below.** Guessing at an interface that already exists — and building a second one — is the single most expensive failure mode in a multi-agent swarm, because it produces two sources of truth that silently diverge.

### 0.1 Mandatory audit (Task T0.1 — blocks everything else)

Before any other task is claimed, the agent assigned T0.1 must:

1. Locate and document the actual current interfaces for: wallet/ledger (`internal/ledger` or equivalent), KYC tiers, the payment gateway adapter interface, the quiz/question-bank engine, the NERDC curriculum data model, and the existing school-admin console's routing/module registration pattern.
2. Write findings to `REUSE-MAP.md` at the repo root — actual function signatures, actual table/collection names, actual event names, not assumed ones from this doc.
3. Flag any place where this spec's assumptions (below) don't match reality. **Reality wins.** This spec describes intent; `REUSE-MAP.md` becomes the corrected source of truth for every subsequent task.
4. Only after `REUSE-MAP.md` exists and is committed may any other task in `TASKS.md` move from `blocked` to `todo`.

### 0.2 Reuse map (intent — verify against 0.1 before trusting)

| Capability | Reuse from | Do NOT |
|---|---|---|
| Money movement, balances | Existing wallet/ledger service | Create a second ledger or shadow balance for Fees Vault or invoices |
| Card/transfer/USSD collection | Existing provider-agnostic payment gateway | Integrate Paystack/Flutterwave directly inside this module |
| Identity, auth, KYC tiers | Existing SSO/KYC service | Create a parallel guardian/student identity system |
| Quiz questions, scoring, NERDC curriculum mapping | Spotlight Academy quiz engine | Fork or duplicate the question bank or curriculum spine |
| School-admin console shell, nav, RBAC scaffold | Existing 28-module school-admin console | Build a second admin app — this module adds modules to the existing one |
| Notifications | Existing notification service | Build a parallel push/SMS pipeline |

---

## 1. Architecture inherited, not redefined

Single-identity multi-capability model · append-only wallet ledger · guarded state machines (illegal states structurally unreachable) · idempotency on all money and reward operations · provider-agnostic gateways · immutable audit trails · offline-first, low-data mobile design. These are load-bearing across all of Paymax and are not re-litigated per module — see root `CLAUDE.md`.

New identity capabilities this module adds to the single-identity model: `school_owner`, `bursar`, `class_teacher`, `head_teacher`, `guardian`, `student` (minor-safe capability — see SF-7), `platform_edtech_admin` (super admin scope, §5).

---

## 2. Data Model

All entities are additive — new tables/collections, no schema changes to existing wallet, KYC, or quiz-engine structures. Foreign keys reference existing identity and ledger primitives rather than duplicating them.

| Entity | Key fields | Notes |
|---|---|---|
| `School` | id, name, level, owner_identity_id, verification_tier, campuses[] | verification_tier gates escrow custody + gov-reporting + competition eligibility |
| `AcademicSession` | id, school_id, name, term_structure, start_date, end_date, status | e.g. "2026/2027", 3-term |
| `Class` | id, school_id, session_id, name, level, class_teacher_identity_id | Rolls over each session via PromotionRecord |
| `Student` | id, school_id, class_id, admission_number, guardian_ids[], status, minor_flag | status: active/promoted/repeated/graduated/withdrawn. minor_flag always true pre-18, drives SF-7 |
| `Guardian` | identity_id, linked_student_ids[], relationship_map | Reuses existing identity — one guardian identity spans all children, all schools |
| `FeeSchedule` | id, school_id, class_id, session_id, term_id, fee_items[], installment_policy | **Immutable once referenced by an issued Invoice** |
| `Invoice` | id, student_id, fee_schedule_id, total_amount, amount_paid, balance, due_date, status | status: draft/issued/partially_paid/paid/overdue/frozen/waived/written_off |
| `Payment` | id, invoice_id, guardian_identity_id, amount, gateway_ref, status, idempotency_key | Append-only; thin record referencing the real ledger transaction |
| `FeesVault` | id, guardian_identity_id, student_ids[], target_amount, current_balance, status | Ledger sub-account, purpose-tagged `edtech_fees_vault`; status: active/matured/withdrawn/locked |
| `PromotionRecord` | id, student_id, from_class_id, to_class_id, session_id, exam_score, decision, teacher_approved_by, admin_approved_by | decision: promoted/repeated/conditional. Two approvals required — see §3.3 |
| `LeaderboardEntry` | id, student_id, school_id, scope, subject, score, rank, period | scope: class/school/city/state/national. Extends Academy's existing leaderboard table with school/scope columns, does not replace it |
| `Competition` | id, name, scope, participating_school_ids[], start_date, end_date, status, sponsor | status: draft/open_registration/registration_closed/in_progress/results_pending/completed/archived |
| `ScholarshipPledge` | id, sponsor_identity_id, target_student_id, amount, status | Powers Sponsor-a-Student |
| `ComplianceExport` | id, school_id, report_type, period, data_categories[], generated_at | Immutable log of what was shared with which government body, when — SF-11 audit trail |

---

## 3. State Machines

Guarded transitions only — every transition function validates preconditions and is idempotent. No direct field mutation anywhere in this module; all state changes are events.

### 3.1 Invoice
```
draft → issued → partially_paid ⇄ (Payment events) → paid
issued/partially_paid → overdue (due_date passed, balance > 0)
overdue → frozen (human-approved hardship request only — see SF-9)
any pre-terminal state → waived (admin/scholarship override, audited)
Terminal: paid, waived, written_off
```
Balance is a derived value from the sum of Payment events against the invoice, never a directly-set field (mirrors ledger discipline).

### 3.2 FeesVault
```
created → active (accepting contributions)
active → target_reached
target_reached → applied_to_invoice (single ledger transfer event, one-tap)
active → withdrawn (early exit, per school-agnostic platform policy, no penalty by default)
```

### 3.3 Promotion (end of session)
```
session_active → results_finalized (all required scores entered for the class)
results_finalized → promotion_computed (engine proposes per school's own pass-mark policy)
promotion_computed → promotion_reviewed (class_teacher approval)
promotion_reviewed → promotion_approved (head_teacher/admin approval)
promotion_approved → applied (Class + FeeSchedule reassignment executes)
```
**Hard rule: no code path may skip from `promotion_computed` directly to `applied`.** Both approvals are structurally required — this is SF-3 and it is a release blocker if violated, not a style preference.

### 3.4 Competition
```
draft → open_registration → registration_closed → in_progress → results_pending → completed → archived
```
Scoring writes lock the instant a competition enters `results_pending` — no LeaderboardEntry may be created or edited against a competition in that state or later.

---

## 4. Invariants — SF-1 … SF-12 (release blockers)

Identical to the PRD; reproduced here as the enforceable contract every task's tests must check.

| # | Invariant | Enforced at |
|---|---|---|
| SF-1 | FeeSchedule is immutable once an Invoice references it | DB constraint + service-layer guard |
| SF-2 | Invoice balance is a derived value from Payment events only, never directly mutated | Repository layer — no `UPDATE invoices SET balance` anywhere in the codebase |
| SF-3 | Promotion requires two human approvals before `applied` | State machine transition guard (§3.3) |
| SF-4 | Academic access (report card, quiz participation, leaderboard) is never gated by fee-payment status | AuthZ layer — payment status must not appear in any academic-content authorization check, enforced by a lint rule / code-review gate, not just convention |
| SF-5 | FeesVault funds sit in a segregated, purpose-tagged ledger sub-account | Ledger service — vault transactions carry `purpose=edtech_fees_vault`, queried and reconciled separately from general float |
| SF-6 | Installment terms locked and disclosed at invoice issuance | FeeSchedule immutability (SF-1) + mandatory disclosure screen before first installment payment (PA-06) |
| SF-7 | Public leaderboard display defaults to first-name + school only for any `minor_flag=true` student; full identity/photo requires explicit recorded guardian consent | API response serializer — strips PII by default, consent flag required to include more |
| SF-8 | Nightly reconciliation of all Payment and Vault transactions against gateway/ledger webhooks | Scheduled job, alerts on drift |
| SF-9 | Hardship/freeze requests route to a human review queue — never auto-approved or auto-denied | Workflow engine — no automated terminal transition on a hardship request |
| SF-10 | Full data export available to any verified school on request (roster, fees, results) | Export API, tested as part of Definition of Done for the School entity |
| SF-11 | Government/regulator reporting sync is opt-in per school, per data category, and every export is logged immutably | ComplianceExport entity, append-only |
| SF-12 | Any automated academic-plus-payment "at-risk" correlation flag is private to school counselor/admin roles only — never surfaced to the student, never auto-actioned | RBAC scope on the alert entity; no notification path to `student` capability |

**Model A only at launch (regulatory):** installments are the guardian paying the school down over time. Paymax never advances fees to a school on a guardian's behalf. Any task or design that has Paymax fronting money to a school and collecting from a guardian later is out of scope — that's receivables factoring, a different licensing category, and explicitly deferred.

---

## 5. Super Admin Console (platform layer — new)

Distinct from the per-school Bursar/School Admin console (`SC-29…SC-40`, owned by each school). This is Paymax's own internal operations layer for overseeing the entire EdTech module across every school on the platform — a new capability, not previously specified.

| ID | Module | Purpose |
|---|---|---|
| SU-01 | Platform School Directory | Every school on the platform, verification tier, status, at a glance |
| SU-02 | School Verification Queue | Review CAC docs / reference checks, approve or reject the verified tier |
| SU-03 | Platform-Wide Collections Dashboard | Aggregate GMV, reconciliation health, and collection trends across all schools |
| SU-04 | Fraud & Risk Queue | Anomalous payment patterns, disputed promotions, chargeback review |
| SU-05 | Government/Regulator Sync Oversight | Which schools have opted in, full ComplianceExport audit log (SF-11) |
| SU-06 | Competition & Tournament Ops | Schedule and approve cross-school tournaments; Spotlight Schools Cup production pipeline management |
| SU-07 | School Trust Score Admin | Audit and, where disputed, override Trust Score calculations |
| SU-08 | Sponsor & Scholarship Oversight | Full fund-flow audit for Sponsor-a-Student pledges |
| SU-09 | Support Ticket Queue | Escalations from school admins and parents that couldn't be resolved at the school level |
| SU-10 | Feature Flag & Tenant Configuration | Roll out features per school, region, or verification tier |
| SU-11 | Platform Audit Log Viewer | Search the immutable audit trail across every entity in this module |
| SU-12 | Compliance & Licensing Dashboard | Tracks the platform's Model-A-only posture (§4); flags any drift toward factoring-like installment structures before it ships |

RBAC: `platform_edtech_admin` capability, entirely separate from any school-level role. A school owner or bursar has zero visibility into the Super Admin Console regardless of their own permissions — this is a platform-operator surface, not an escalated school-admin surface.

---

## 6. API Surface (summary)

Namespaced under `/internal/edtech-fees/`, calling out to existing services rather than reimplementing them.

```
POST   /schools                          create school (draft, pre-verification)
POST   /schools/{id}/verify              admin action → verification_tier change
POST   /schools/{id}/sessions            create AcademicSession
POST   /schools/{id}/classes             create Class
POST   /schools/{id}/fee-schedules       create immutable FeeSchedule
POST   /students                         create Student, link Guardian(s)
POST   /invoices                         issue Invoice against a FeeSchedule
POST   /invoices/{id}/payments           record payment intent → calls existing payment gateway
POST   /vaults                           create FeesVault
POST   /vaults/{id}/contribute           add funds → calls existing ledger service
POST   /vaults/{id}/apply-to-invoice     single-action transfer to an Invoice
POST   /promotions/compute               engine proposal for a Class + Session
POST   /promotions/{id}/approve          teacher or admin approval step
POST   /competitions                     create Competition
POST   /competitions/{id}/register       school registers to compete
GET    /leaderboards                     query by scope/subject/period
POST   /scholarship-pledges              create ScholarshipPledge
GET    /compliance-exports               list per-school export history
POST   /compliance-exports               trigger an opt-in export
```

---

## 7. Proposed Code Layout

```
/services/edtech-fees/
  /internal/school/
  /internal/session/
  /internal/class/
  /internal/student/
  /internal/guardian/
  /internal/fee-schedule/
  /internal/invoice/
  /internal/payment/          # thin adapter → existing payment-gateway service, no new provider integrations
  /internal/fees-vault/       # thin adapter → existing ledger service, purpose-tagged sub-account
  /internal/promotion/
  /internal/competition/      # extends existing quiz-engine service via its public interface, does not fork it
  /internal/scholarship/
  /internal/export/           # government/regulator reporting
/apps/mobile/parent/screens/fees/           PA-01 … PA-16
/apps/mobile/student/screens/competition/   SA-121 … SA-126  (extends existing Academy screen numbering)
/apps/admin-school/modules/fees/            SC-29 … SC-40    (added to the existing 28-module console)
/apps/admin-super/modules/edtech/           SU-01 … SU-12    (new console surface)
```

Each top-level directory under `/internal/` is a single task's ownership boundary for swarm-claiming purposes — see `SWARM-BUILD-PLAN.md` §2.
