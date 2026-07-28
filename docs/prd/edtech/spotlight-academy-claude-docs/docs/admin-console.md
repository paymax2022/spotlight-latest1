# Admin Management Console

Web console, RBAC-scoped by staff role. Every action audit-logged. Backed by `admin-bff`.

## Roles
`super_admin · content · curriculum · assessment · finance · operations · sponsor_manager ·
moderator · support · analyst · read_only` — least privilege, capability-checked, audited.

## 1. Platform operations
| Module | Key functions |
|---|---|
| Executive dashboard | Live KPIs (engagement, revenue, exam readiness, reward spend); cohort/funnel; alerts. |
| User management | Lookup learners/parents/tutors; profiles, KYC, guardian links; suspend, merge, impersonate-for-support, NDPR export/delete. |
| Identity & access (RBAC) | Staff roles & granular permissions; session/device controls. |
| Audit & compliance | Immutable audit viewer; consent/KYC records; retention & NDPR tooling; exam-integrity logs. |
| Config & feature flags | Env config, flags, A/B experiments, kill-switches. |

## 2. Curriculum & content
| Module | Key functions |
|---|---|
| Curriculum management | Versions (new/legacy), phases, classes, subjects, streams, trade tracks, topics, objectives; alignment & versioning; effective-date rollout per entry class. |
| Content management (CMS) | Lessons, media library, episodic series; create/edit, version, publish workflow; low-data variants; localization. |
| Offline bundle builder | Compose bundles; size budgets; agent-distributable packages; access-card mapping. |
| Content production tracker | Spotlight pipeline: script→storyboard→shoot→edit→QA→publish; status, owners, SLAs. |
| Localization / languages | Translation mgmt for UI + content (English + Nigerian languages). |

## 3. Assessment & exams
| Module | Key functions |
|---|---|
| Question bank | Item authoring (MCQ + rich types); tag by subject/topic/difficulty/objective; review workflow; duplicate detection; item analysis (difficulty, discrimination). |
| Past-questions library | Curated by exam & year; topic mapping. |
| Exam arena management | Configure each exam (CCE/BECE/WASSCE/NECO/UTME/NABTEB); CBT blueprints; mock templates; scoring rules; calendars & countdowns. |
| Subject-combination rules | UTME course→combination requirements engine; admission-requirement data. |
| Adaptive-learning config | Mastery thresholds, recommendation rules, learning-path graphs, remediation logic. |

## 4. Engagement & rewards
| Module | Key functions |
|---|---|
| Gamification engine | XP/level curves, streak rules & freezes, badge criteria, challenges/quests, leaderboard configs & resets; anti-cheat thresholds. |
| Rewards & wallet ops | Funded reward pools; point→value conversion; redemption catalog; per-user caps; fraud controls; ledger reconciliation & reporting. |
| Notifications & messaging | Template mgmt (push/SMS/in-app); segmentation; scheduled & triggered campaigns; quiet hours; deliverability. |

## 5. Commerce & finance
| Module | Key functions |
|---|---|
| Plans & billing | Plans/pricing, trials, promos/scholarship codes; entitlements; dunning. |
| BNPL management | Eligibility, instalments, delinquency, write-offs (BNPL rail). |
| Exam-bundle & store | Bundle catalog, pricing, seasonal merchandising. |
| Access-card management | Generate/issue prepaid cards & inventory; activation; agent allocation. |
| Payments & reconciliation | Transactions, refunds, settlements, revenue reports; gateway config. |
| EduPay / school fees | School onboarding, fee schedules, collections, pots, disbursements, reconciliation. |
| Scholarships & disbursements | Sponsor-funded programs; eligibility; disbursement runs & audit. |

## 6. Partnerships & growth
| Module | Key functions |
|---|---|
| Sponsor & campaign mgmt | Sponsors, CSR campaigns, branded challenges, funded pools; sponsor reporting. |
| School & institution mgmt | B2B2C schools, licences, bulk enrolment, white-label config, usage & billing. |
| Agent network mgmt | Bundle/card inventory to agents, activations, performance, commissions (agent rail). |
| TV-funnel & attribution | Campaign codes for the schools quiz show; sign-up attribution; conversion reporting. |

## 7. Trust, learning ops & support
| Module | Key functions |
|---|---|
| Credential & earning bridge | Cert templates, issuance, verification registry, revocation; map trade credentials → Paymax earning roles & eligibility. |
| Tutor & marketplace ops | Tutor vetting/KYC, payouts, ratings, disputes (Phase 4). |
| Live & events mgmt | Schedule live classes, streaming config, moderation, replays. |
| Moderation & trust/safety | Content & community moderation queues; child-safety controls; report triage; escalation. |
| Support / CRM | Ticketing, lookup, macros, refunds, impersonation with audit. |
| Analytics & BI | Outcome/engagement/retention/funnel/revenue/exam dashboards; cohort analysis; custom reports & export; warehouse feeds. |
