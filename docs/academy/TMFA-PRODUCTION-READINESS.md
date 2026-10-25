# TMFA Topic Mastery — Production Readiness Report

Date: 2026-10-25

**Verdict: the code plane is deployable behind its feature flag; the programme is
not launch-ready.** Migrations and a live import/E2E have not been run, and the
curriculum has zero publishable topics. Enabling the flag at this moment exposes
an empty path with honest "blocked" copy — not a functioning course.

---

## 1. Readiness matrix

| Area | Software | Live-verified | Launch readiness |
|---|---|---|---|
| Topic hierarchy + import | Complete | No | Blocked by content |
| Learner path + locking | Complete | No | Blocked by content |
| Topic quiz + exact 85% gate | Complete | No | Blocked by question bank |
| Article progress + events | Complete | No | Ready once flag on |
| Publication gate | Complete | No | Blocked by media/articles |
| Media production console | Complete | No | No assets produced |
| Holds + mastery | Complete | No | Ready once content is live |
| Credentials + public verification | Complete | No | Cannot issue (0 published/mastered) |
| Admin console | Complete | No | Typechecked only |
| Mobile screens | Complete | No | Typechecked only; repo-wide mobile tsc is red on 7 unrelated `PromoBanner`/`Contact` errors (0 in film-academy) |
| Deployment/runbooks | This report | — | Checklist below |

Legend: "Complete" means implemented and typechecked/unit-tested in this
workspace. It does **not** mean exercised against a live database, browser or
device.

---

## 2. Security posture

**Enforced:**

- Answer key never leaves the bank table; learner payloads carry presentation IDs
  and own picks only.
- Server-authoritative draw, deadline and score with an immutable item snapshot.
- At-most-once submission (guarded update) and scoped idempotency.
- All learner reads resolve enrollment from the authenticated user; no
  client-supplied `enrollmentId` is trusted.
- Admin actions require `programs:manage` or `scores:manage`; publish/approve/
  waiver/holds/mastery/credentials are `scores:manage`.
- Public certificate lookup validates the identifier and returns only holder
  display name, programme, completion date and status. Revoked credentials remain
  resolvable, so a verifier sees revocation instead of a 404.
- Credential issuance re-derives the whole ledger; replay cannot mint a
  credential.
- Feature flag defaults off; every new route 503s when unset.
- Additive migrations only; no existing rows are modified by the certificate
  migration.

**Risks / gaps:**

- **Service-role boundary.** The BFF bypasses RLS by design. Any missed code-level
  filter is a cross-learner exposure. Live negative tests are mandatory before
  launch.
- **Waiver authority.** `scores:manage` can waive all mandatory media for a topic
  with a written rationale. This is an academic-governance control, not a
  technical one. Audit every waiver.
- **No dedicated rate limiting** on topic start/autosave/submit beyond the shared
  middleware; abuse protection relies on authentication and the platform.
- **No external security review** of the new endpoints.
- **Admin UI uses browser `prompt`/`confirm`** for revocation/issuance in the
  existing console style; inputs are server-validated, but the UX is basic.

---

## 3. Operations and observability

- **Audit:** `film_academic_audit` records import, review, publish/unpublish,
  waiver, hold, mastery, certificate issue and revocation with actor/role/reason.
- **Events:** `film_mastery_events` is append-only with a unique `dedupe_key`;
  clients poll a monotonic cursor. No push/websocket infrastructure is required.
- **Logging:** service failures log with a `[film/...]` prefix; route errors are
  mapped to stable JSON error codes.
- **Data volumes:** 72 topics, 864 media rows, 336 questions on import; growth is
  bounded by authored questions and learner attempts.
- **Flag:** `FEATURE_FILM_ACADEMY_TOPICS_ENABLED` is the on/off switch; it is
  documented in both frontend-web env examples.

Not established: dashboards, alerting, dead-letter handling, retention policy for
attempt snapshots/events/audit, backup/restore rehearsal for the new tables.

---

## 4. Deployment checklist

**Schema**

1. Read both migration files and confirm the migration guard passes.
2. Apply `20271099000000_film_academy_topic_mastery.sql`.
3. Apply `20271099000001_film_academy_credentials.sql`.
4. **Do not apply `20271025001000_purge_film_academy.sql`** — it deletes film
   academy data and is not part of this implementation.
5. Verify the ten tables and the two certificate indexes exist.

**Configuration**

6. Set `FEATURE_FILM_ACADEMY_TOPICS_ENABLED=true` in frontend-web only after the
   import/review plan is staffed. Leaving it false is always safe.

**Content and operations**

7. Run admin **Curriculum import → preview**, inspect the plan, then apply once.
8. Re-run preview/apply to prove idempotency (no duplicates).
9. SME review: approve questions; the bundled bank cannot reach 20/topic.
10. Produce/rights/accessibility review of 864 assets, or sign waivers with
    genuine rationales.
11. `scores:manage` approves articles and publishes topics individually.
12. Validate learner journey on a preview account: path → article → quiz →
    8/10 remediation → 9/10 pass → hold → clear → successor unlock.
13. Issue a credential only after all topics are published/mastered; verify
    publicly; revoke a test credential and confirm the verifier shows revoked.

**Rollback**

14. Set the flag false. All new routes return 503; the additive schema remains and
    existing academy readers are unaffected. No data rollback is required.

---

## 5. Launch blockers

| Blocker | Owner | Evidence |
|---|---|---|
| 0 approved questions (need ≥1,440 across 72 topics) | Academic/SME | Content report §2 |
| 0 produced media (864 planned) | Production | Content report §3 |
| 0 approved articles (72 drafts/briefs) | Faculty | Content report §1 |
| Live migrations/import/E2E not run | Engineering | Testing report §4 |
| No cross-learner/concurrency security tests | Engineering | Testing report §4 |
| No PDF/email certificate delivery | Product/Engineering | Implementation report §3 |

---

## 6. Go / no-go

- **Enable flag for internal demo / admin review:** yes, with the content caveat
  that every topic shows blocked and no quiz can start.
- **Open to learners as a course:** **no-go** until the question bank, media and
  article approvals meet the gates.
- **Issue certificates:** **no-go** until all 72 topics are published, mastered by
  the learner, and hold-free; by design the software will refuse otherwise.
