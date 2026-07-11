# PAYMAX CONNECT — PHASE 6: PROFESSIONAL NETWORK EXPANSION
### Engineering doctrine + build plan addendum · "Super LinkedIn" upgrade to Networking mode

> **How to use this file:** This is an *addendum* to the existing Paymax Connect CLAUDE.md / PRD (Phases 1–5: Dating, Professional Networking core, Event Networking, Creator Networking, AI & Trust). It does not restate those doctrines — read this alongside them. Screen IDs here are **provisional and scoped to Phase 6 only**; renumber against the master screen ledger before merge. Story points are estimates for scoping, not commitments.

---

## 0. Why this phase exists

Networking mode currently covers profile + connections + endorsements + communities + events — a solid base, but it stops short of the three pillars that make LinkedIn LinkedIn: **Jobs, long-form content, and credentialed skills.** Phase 6 closes that gap and adds a gamification layer that routes through existing Paymax infrastructure rather than inventing new systems.

**In scope:** Jobs marketplace, content/feed layer, full profile (experience/education/recommendations), Company Pages, mentorship matching, skill assessments, and a gamification layer wired into Paymax Black loyalty.

**Out of scope (do not rebuild):** Auth/SSO, RBAC core, Map/geolocation, wallet/ledger internals, Spotlight event ticketing, Spotlight creator verification, the Naija Driver quiz *engine* itself (reuse it — see §3).

---

## 1. Shared services this phase MUST reuse, not rebuild

| Service | What Phase 6 consumes from it | What Phase 6 must NOT do |
|---|---|---|
| **Auth / SSO** | Single identity for every new capability below | Never create a parallel login for Recruiter/Mentor/Company roles |
| **RBAC (capability model)** | New capabilities (Recruiter, Company Admin, Mentor, Assessment Reviewer) as additional capabilities on the existing `User`, computed into effective permissions | Never model these as separate account types |
| **Map / Geolocation** | Job location, mentorship proximity (optional), company page address | — |
| **Wallet / Ledger** | Job-post fees, applicant boosts, referral bounty payouts, loyalty point issuance | Never mutate a balance directly — every payout is a ledger entry |
| **Naija Driver quiz engine** | Question-bank schema, timed-attempt runner, scoring — repointed at *professional* skill content instead of road-safety content | Do not fork the engine; parameterize it by assessment domain |
| **Spotlight event infrastructure** | Mentorship "office hours" and networking meetups can piggyback on existing event creation/RSVP/QR check-in | Do not build a second event system |
| **Paymax Black (loyalty)** | All Phase 6 gamification rewards issue as Paymax Black events | Do not introduce a second points currency (see PN-8) |
| **Business verification (existing admin flow)** | Company Pages and paid job postings inherit this tier | Unverified businesses get read-only presence, no posting rights |

---

## 2. Safety & design invariants (PN-1…PN-12)

These are non-negotiable, same status as the platform's existing NL-/HL- invariant series.

- **PN-1 — No public numeric trust score.** Verification is exposed as a binary badge only. Signals used for internal fraud/trust scoring are never returned by any public-facing API.
- **PN-2 — Referral bounty is single-level, capped.** Referrer → confirmed hire only. No referral-of-referrals structure, in schema or business logic — this is a compliance line, not a style preference.
- **PN-3 — Rank by verified outcomes, not raw engagement.** Feed ranking and community role progression must weight verified signals (assessment passed, booking completed, mentorship completed) at least as heavily as like/comment counts. Raw engagement volume alone must never be a ranking input.
- **PN-4 — Recommendations require subject consent before publishing.** A written recommendation is `DRAFTED` → `SENT` → subject must `ACCEPT` before it is ever publicly visible. Never auto-publish.
- **PN-5 — Assessed skills are visually and structurally distinct from self-reported skills.** A skill badge may only be issued after a passed, timestamped `SkillAssessmentAttempt` tied to a specific schema version.
- **PN-6 — Paid job postings require verified business tier.** Inherit the existing merchant/business verification; do not add a parallel verification path.
- **PN-7 — Mode-privacy boundaries hold for Mentorship too.** Mentorship discovery/visibility must not cross-leak Dating-mode profile signals without explicit, separate opt-in.
- **PN-8 — One loyalty currency.** All Phase 6 rewards emit events into the existing Paymax Black ledger. No parallel points system.
- **PN-9 — One identity, accumulated capabilities.** Recruiter, Mentor, Company Admin, Assessment Reviewer are capabilities on the existing `User`/RBAC model, each independently grantable and revocable (revoking one must not affect the others).
- **PN-10 — Bounty/boost payments are ledger-derived, idempotent, and atomic with their triggering transition.** E.g., `HIRE_CONFIRMED` creates the bounty ledger entry in the same transaction, not a follow-up job.
- **PN-11 — Leaderboards are opt-in and cohort-scoped.** No always-on global ranking of individuals by any metric.
- **PN-12 — Assessment content is versioned.** A badge permanently records which question-bank version was passed; updating questions must never silently change the meaning of a previously issued badge.

---

## 3. Domain model additions

New entities (Postgres, consistent with existing append-only/guarded-state-machine conventions):

| Entity | Key fields | Notes |
|---|---|---|
| `JobPosting` | owner_company_page_id, title, description, requirements, location, employment_type, salary_range?, status | status is a guarded state machine, §4 |
| `JobApplication` | applicant_user_id, job_posting_id, resume_ref, cover_note?, state | one active application per (user, posting) — unique constraint |
| `CompanyPage` | verified_business_id (FK to existing business capability), name, about, follower_count (derived, not stored raw) | claim flow gated on existing business verification |
| `Post` | author_type (user\|company_page), author_id, body, media_refs[], hashtags[], reshare_of_post_id? | |
| `Reaction` | post_id, user_id, reaction_type | unique (post_id, user_id) |
| `Comment` | post_id, author_user_id, body, parent_comment_id? | |
| `Recommendation` | author_user_id, subject_user_id, body, state | see PN-4 state machine |
| `SkillAssessment` | domain, title, question_bank_version, pass_threshold | parameterizes the reused quiz engine |
| `SkillAssessmentAttempt` | user_id, assessment_id, assessment_version, score, state, badge_issued_at? | |
| `MentorshipProfile` | user_id, role (mentor\|mentee\|both), domains[], capacity | opt-in capability, not automatic |
| `MentorshipMatch` | mentor_id, mentee_id, state | |
| `ReferralBounty` | referrer_user_id, job_application_id, state, ledger_entry_ref? | single-level only, PN-2 |
| `LoyaltyEvent` (emitted, not owned here) | user_id, event_type, source_entity_ref | consumed by existing Paymax Black service |

---

## 4. State machines

Guarded transitions only — no ad hoc status writes (per backend-engineering doctrine: illegal states must be unreachable).

**Job Application**
```
DRAFT → SUBMITTED → UNDER_REVIEW ⇄ NEEDS_INFO
UNDER_REVIEW → SHORTLISTED → INTERVIEW → OFFERED → HIRED
UNDER_REVIEW|SHORTLISTED|INTERVIEW → REJECTED
SUBMITTED|UNDER_REVIEW|SHORTLISTED|INTERVIEW → WITHDRAWN (applicant-initiated)
```
On `HIRED`: atomically (a) close posting if `positions_filled == positions_open`, (b) transition any linked `ReferralBounty` to `HIRE_CONFIRMED`, (c) emit `LoyaltyEvent`, (d) write audit log.

**Company Page Claim**
```
CLAIM_SUBMITTED → UNDER_REVIEW ⇄ NEEDS_MORE_INFO → VERIFIED | REJECTED
```
Reuses existing business-verification reviewer group (§1).

**Recommendation**
```
DRAFTED → SENT → ACCEPTED_VISIBLE | DECLINED_HIDDEN
```
Only `ACCEPTED_VISIBLE` is queryable by anyone other than author/subject.

**Skill Assessment Attempt**
```
STARTED → IN_PROGRESS → SUBMITTED → GRADED → PASSED (badge issued) | FAILED (cooldown before retry)
```

**Mentorship Match**
```
REQUESTED → ACCEPTED | DECLINED
ACCEPTED → ACTIVE ⇄ PAUSED → COMPLETED | ENDED_EARLY
```
On `COMPLETED`: prompt mutual testimonials (routes into `Recommendation` flow), emit `LoyaltyEvent` for both parties.

**Referral Bounty**
```
REFERRED → APPLICATION_LINKED → HIRE_CONFIRMED → BOUNTY_PAYABLE → PAID
any pre-HIRE_CONFIRMED state → EXPIRED (posting closed/rejected/withdrawn)
```
`BOUNTY_PAYABLE → PAID` is the ledger-writing transition — idempotency key = referral_bounty_id (PN-10).

---

## 5. RBAC additions

New capabilities on the existing single-identity model (never new account types):

| Capability | Granted via | Scope |
|---|---|---|
| `Recruiter` | Company Page owner grants to a User within their org | Object-level: can post/manage jobs only for that CompanyPage |
| `CompanyPageAdmin` | Business-verification approval (existing flow) | One CompanyPage per verified business |
| `Mentor` | Self-opt-in, no approval gate (low risk) | Global, but discovery respects PN-7 |
| `AssessmentReviewer` | Internal grant only | Manage question banks and versions |

Community contribution tiers (Contributor → Trusted Voice → Room Host) are **computed from activity**, not granted — do not model them as RBAC capabilities; they are display-only badges scoped to a single community (PN-11).

---

## 6. Screen inventory (provisional IDs)

### 6.1 Jobs (`JB-`)
| ID | Screen | Purpose |
|---|---|---|
| JB-01 | Jobs feed | Postings by relevance/filter |
| JB-02 | Job detail | Full posting, apply CTA |
| JB-03 | Apply flow | Resume/portfolio attach, cover note |
| JB-04 | My applications | Status tracker per application |
| JB-05 | Create job posting (Recruiter) | Title, description, requirements, location, salary |
| JB-06 | Applicant pipeline (Recruiter) | Kanban by application state |
| JB-07 | Open to Work toggle | Profile-level signal, visible to Recruiters only |
| JB-08 | Referral share sheet | Share posting with bounty terms attached |

### 6.2 Content / Feed (`CN-`)
| ID | Screen | Purpose |
|---|---|---|
| CN-01 | Compose post | Text/media/hashtags |
| CN-02 | Post detail | Reactions, comments, reshare |
| CN-03 | Comment thread | Nested replies |
| CN-04 | Hashtag/topic feed | Follow a topic |
| CN-05 | Notifications center | Reactions, comments, connection activity |
| CN-06 | Global search | People / companies / jobs / posts |
| CN-07 | Profile analytics | Who viewed your profile, reach stats |

### 6.3 Profile completion (`PR-` continued from PR-06)
| ID | Screen | Purpose |
|---|---|---|
| PR-07 | Experience timeline | Add/edit roles, dates, description |
| PR-08 | Education history | Institution, degree, dates |
| PR-09 | About summary | Free-text professional summary |
| PR-10 | Featured section | Portfolio items for any professional, not just creators |
| PR-11 | Profile Strength meter | Completion + verification-weighted score (internal calc, PN-1-safe display) |

### 6.4 Company Pages (`CP-`)
| ID | Screen | Purpose |
|---|---|---|
| CP-01 | Company page (public) | About, posts, jobs, team |
| CP-02 | Claim company page | Links to existing business verification |
| CP-03 | Company page admin | Post, manage team/recruiters |
| CP-04 | Follower list | Who follows this page |

### 6.5 Recommendations (`RC-`)
| ID | Screen | Purpose |
|---|---|---|
| RC-01 | Write recommendation | Author flow |
| RC-02 | Recommendation inbox | Pending recommendations to accept/decline |
| RC-03 | Recommendations on profile | Public, accepted-only display |
| RC-04 | Request a recommendation | Ask a connection to write one |

### 6.6 Mentorship (`MN-`)
| ID | Screen | Purpose |
|---|---|---|
| MN-01 | Mentor/mentee opt-in | Role, domains, capacity |
| MN-02 | Mentor discovery | Browse/filter by domain |
| MN-03 | Match request | Send/accept/decline |
| MN-04 | Active mentorship thread | Reuses messaging (MS-0x), tagged as mentorship |
| MN-05 | Office hours event | Reuses Spotlight event infra |
| MN-06 | Mentorship completion + testimonial prompt | Routes into RC-01 |

### 6.7 Skill Assessments (`SA-`)
| ID | Screen | Purpose |
|---|---|---|
| SA-01 | Assessment catalogue | Browse by domain |
| SA-02 | Assessment runner | Reuses Naija Driver timed-quiz engine |
| SA-03 | Result + badge issuance | Pass/fail, badge to profile |
| SA-04 | Retry cooldown state | Countdown to next attempt |

### 6.8 Gamification / Loyalty surfaces (`GM-`)
| ID | Screen | Purpose |
|---|---|---|
| GM-01 | Networking Passport | Event-attendance stamps, milestone progress |
| GM-02 | Community role badge | Contributor/Trusted Voice/Room Host, scoped to one community |
| GM-03 | Paymax Black activity feed (networking events) | Points earned from Phase 6 actions |
| GM-04 | Referral bounty tracker | Status per referral, single-level only |

### 6.9 Admin (`ADM-`)
| ID | Screen | Purpose |
|---|---|---|
| ADM-JB-01 | Job posting moderation | Approve/reject/flag postings |
| ADM-JB-02 | Bounty payout queue | Review before ledger release |
| ADM-CN-01 | Content moderation queue | Reported posts/comments |
| ADM-CP-01 | Company page claim review | Extends existing business-verification review UI |
| ADM-SA-01 | Question bank management | Versioned CRUD (AssessmentReviewer only) |
| ADM-MN-01 | Mentorship reports | Safety escalations within mentorship threads |
| ADM-GM-01 | Loyalty event audit | Trace any Paymax Black grant back to its Phase 6 source |

---

## 7. API surface additions (representative, not exhaustive)

```
POST   /v1/jobs                          (Recruiter)
GET    /v1/jobs?filters=...
POST   /v1/jobs/{id}/applications
PATCH  /v1/applications/{id}/state        (guarded transition only)
POST   /v1/company-pages/claim
POST   /v1/posts
POST   /v1/posts/{id}/reactions
POST   /v1/posts/{id}/comments
POST   /v1/recommendations
PATCH  /v1/recommendations/{id}/accept
POST   /v1/assessments/{id}/attempts
PATCH  /v1/assessments/attempts/{id}/submit
POST   /v1/mentorship/opt-in
POST   /v1/mentorship/matches
PATCH  /v1/mentorship/matches/{id}/state
POST   /v1/referrals
PATCH  /v1/referrals/{id}/state           (system-triggered on HIRED)
```
All state-changing endpoints: idempotency key required, object-level authZ required, audit log written (per backend-engineering DoD).

---

## 8. Gamification → Paymax Black mapping

| Action | Loyalty event | Notes |
|---|---|---|
| Complete profile (Strength ≥ threshold) | `profile_complete` | One-time |
| Pass a skill assessment | `skill_verified` | Per assessment, not per attempt |
| Recommendation accepted (given or received) | `recommendation_milestone` | Capped per period to prevent farming |
| Mentorship completed | `mentorship_complete` | Both mentor and mentee |
| Event attendance (Networking Passport stamp) | `event_stamp` | Reuses existing event check-in |
| Referral → confirmed hire | `referral_bounty_paid` | Ledger entry, not just points (PN-10) |
| Community role earned | `community_role_up` | Display-only, cohort-scoped (PN-11) |

No new currency, no publicly visible global leaderboard — see PN-3, PN-8, PN-11.

---

## 9. Phased build plan

Tags: **BE** backend · **FE** frontend (mobile) · **AD** admin · **SH** shared/infra · **TS** tests. Points are estimates for planning, not commitments.

### Phase 6A — Jobs Core (~34 pts)
- SH: Extend RBAC with Recruiter capability (3)
- BE: JobPosting + JobApplication models, guarded state machine (8)
- BE: Referral bounty schema + single-level enforcement (5)
- FE: JB-01–JB-04, JB-07 (10)
- FE: JB-05, JB-06 (Recruiter tools) (5)
- AD: ADM-JB-01, ADM-JB-02 (3)

### Phase 6B — Content Layer (~28 pts)
- BE: Post/Reaction/Comment models, feed ranking service (PN-3-compliant) (10)
- FE: CN-01–CN-04 (10)
- FE: CN-05 Notifications, CN-06 Search (6)
- AD: ADM-CN-01 (2)

### Phase 6C — Full Profile (~16 pts)
- BE: Experience/Education schema (4)
- FE: PR-07–PR-11, Profile Strength calc (10)
- TS: Strength-score unit tests (2)

### Phase 6D — Company Pages (~18 pts)
- BE: CompanyPage model, claim flow tied to existing business verification (6)
- FE: CP-01–CP-04 (8)
- AD: ADM-CP-01 (extend existing review UI) (4)

### Phase 6E — Recommendations (~14 pts)
- BE: Recommendation state machine, consent gate (5)
- FE: RC-01–RC-04 (7)
- TS: PN-4 compliance tests (never-auto-publish) (2)

### Phase 6F — Skill Assessments (~20 pts)
- SH: Parameterize Naija Driver quiz engine by assessment domain (6)
- BE: SkillAssessment/Attempt models, versioning (5)
- FE: SA-01–SA-04 (7)
- AD: ADM-SA-01 question bank CRUD (2)

### Phase 6G — Mentorship (~22 pts)
- BE: MentorshipProfile/Match state machine (6)
- FE: MN-01–MN-03, MN-06 (8)
- FE: MN-04 (extend existing messaging), MN-05 (extend existing events) (4)
- AD: ADM-MN-01 (2)
- TS: PN-7 mode-privacy isolation tests (2)

### Phase 6H — Gamification & Loyalty Wiring (~16 pts)
- BE: LoyaltyEvent emission for all Phase 6 actions (§8) (6)
- FE: GM-01–GM-04 (8)
- AD: ADM-GM-01 audit trail (2)

**Total: ~168 pts across 8 sub-phases.** Sequencing note: 6A and 6C can run in parallel; 6F depends on the quiz-engine parameterization landing first since 6G's mentorship-domain matching benefits from it but is not blocked by it.

---

## 10. Definition of Done (Phase 6 specific, extends existing DoD)

- [ ] All PN-1…PN-12 invariants verified by test, not just code review
- [ ] No endpoint exposes a granular trust/ranking number (PN-1) — grep audit before merge
- [ ] Referral bounty schema physically cannot represent a second-level referral (PN-2)
- [ ] Feed ranking query includes at least one verified-outcome weight term (PN-3)
- [ ] Recommendation cannot appear in any public read path before `ACCEPTED_VISIBLE` (PN-4)
- [ ] Every skill badge references a specific `assessment_version` (PN-5, PN-12)
- [ ] Job posting creation blocked server-side for unverified CompanyPage (PN-6)
- [ ] Mentorship discovery query never joins Dating-mode-only fields without explicit opt-in flag (PN-7)
- [ ] Every gamification reward emits to the existing Paymax Black ledger — zero new balance tables (PN-8)
- [ ] All new capabilities (Recruiter, Mentor, CompanyPageAdmin, AssessmentReviewer) independently revocable (PN-9)
- [ ] Bounty payout is same-transaction with `HIRE_CONFIRMED`, keyed for idempotency (PN-10)
- [ ] No leaderboard endpoint returns global, always-on individual rankings (PN-11)
- [ ] Screen IDs above renumbered against master ledger; no collisions
- [ ] Admin audit log covers every state transition introduced in this phase
