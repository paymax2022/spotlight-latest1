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
| Practical assessment workflow | Complete | No | 0 assessments authored; no practical content exists |
| Credentials + PDF/QR + public verification | Complete | No | Cannot issue (0 published/mastered) |
| Admin console | Complete | No | Typechecked only |
| Mobile screens | Complete | No | Typechecked only; repo-wide mobile tsc is red on 12 unrelated `PromoBanner`/`Contact`/electricity errors (0 in film-academy) |
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
- The public verification page and QR expose the same fields, are `noindex`, and
  carry no email, phone, user id or enrollment id.
- The PDF route resolves the learner from the session (no client-supplied ids) and
  refuses revoked or unissued credentials; the PDF carries only registry fields.
- Credential issuance re-derives the whole ledger; replay cannot mint a
  credential.
- Practical scores are computed server-side from rubric criteria against the
  snapshot frozen at submit; a reviewer cannot supply a percentage. The pass mark
  stays inside the 85–100% policy and a failed practical requires actionable
  feedback.
- Practical reads/writes are scoped to the server-resolved enrolment; a learner
  cannot open another learner's submission. Evidence links must be `http(s)`.
- Practical holds are provenance-tagged (`source = 'practical_assessment'`);
  grading and withdrawal clear only workflow-owned holds, never manual academic
  holds.
- Feature flag defaults off; every new route 503s when unset. Learner practical
  routes require both the topics flag and `FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED`.
- Additive migrations only; no existing rows are modified by the certificate or
  practical migrations.

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
- **Admin UI uses browser `prompt`/`confirm`** for revocation/issuance and for
  opening the practical gate; inputs are server-validated, but the UX is basic.
- **Practical evidence is a link, not a file.** No upload, malware scan, link
  liveness check, rights review or identity/authorship verification is automated;
  reviewers open external URLs at their own discretion.
- **Assessment authoring and grading are separate permissions, not separate
  people.** `programs:manage` authors, `scores:manage` grades; one administrator
  may hold both. Academic separation of duties is a governance control.

---

## 3. Operations and observability

- **Audit:** `film_academic_audit` records import, review, publish/unpublish,
  waiver, hold, mastery, practical assessment authoring/submission/grading,
  certificate issue and revocation with actor/role/reason.
- **Events:** `film_mastery_events` is append-only with a unique `dedupe_key`;
  clients poll a monotonic cursor. Practical submit/grade/hold changes are in the
  same stream. No push/websocket infrastructure is required.
- **Logging:** service failures log with a `[film/...]` prefix; route errors are
  mapped to stable JSON error codes.
- **Data volumes:** 72 topics, 864 media rows, 336 questions on import; growth is
  bounded by authored questions, learner attempts and practical submissions
  (evidence text is capped at 20,000 characters).
- **Flags:** `FEATURE_FILM_ACADEMY_TOPICS_ENABLED` gates the module;
  `FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED` gates learner practical routes. Both
  are documented in the frontend-web env examples.

Not established: dashboards, alerting, dead-letter handling, retention policy for
attempt snapshots/events/audit, backup/restore rehearsal for the new tables.

---

## 4. Deployment checklist

**Schema**

1. Read all three migration files and confirm the migration guard passes.
2. Apply `20271099000000_film_academy_topic_mastery.sql`.
3. Apply `20271099000001_film_academy_credentials.sql`.
4. Apply `20271099000002_film_academy_practical_assessments.sql`.
5. **Do not apply `20271025001000_purge_film_academy.sql`** — it deletes film
   academy data and is not part of this implementation.
6. Verify the ten topic tables, the two certificate indexes, the two practical
   tables, and `film_mastery_holds.source`/`source_ref` plus its partial unique
   index exist. Existing holds must read `source = 'manual'`.

**Configuration**

7. Set `FEATURE_FILM_ACADEMY_TOPICS_ENABLED=true` in frontend-web only after the
   import/review plan is staffed. Leaving it false is always safe.
8. Set `FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED=true` to expose the learner
   practical routes. Admin authoring/grading uses the topics flag plus permissions.
9. Set `NEXT_PUBLIC_SITE_URL` (frontend-web) and `EXPO_PUBLIC_SITE_URL` (mobile)
   to the public origin that serves `/verify/certificate`. They must match; an
   unset mobile value falls back to production, so staging must set it.

**Content and operations**

10. Run admin **Curriculum import → preview**, inspect the plan, then apply once.
11. Re-run preview/apply to prove idempotency (no duplicates).
12. SME review: approve questions; the bundled bank cannot reach 20/topic.
13. Produce/rights/accessibility review of 864 assets, or sign waivers with
    genuine rationales.
14. `scores:manage` approves articles and publishes topics individually.
15. Author practical assessments where required. Keep them inactive until the
    brief/rubric is reviewed, then open the gate; confirm the returned
    `holdsOpened` matches the number of learners who had already passed the quiz.
16. Validate the learner journey on a preview account: path → article → quiz →
    8/10 remediation → 9/10 pass → `PASSED` with a practical hold → submit
    practical → fail with feedback → resubmit → pass → `MASTERED` → successor
    unlock. Also withdraw an assessment and confirm only its workflow holds clear
    and earned `MASTERED` returns.
17. Issue a credential only after all topics are published/mastered; download the
    PDF, scan its QR, confirm the public page reports it verified, then revoke a
    test credential and confirm the verifier shows revoked.

**Rollback**

18. Set the topics flag false (all new routes return 503). To withdraw practicals
    without disabling the module, set `FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED=false`
    and deactivate authored assessments to clear their workflow holds. The additive
    schema remains and existing academy readers are unaffected; no data rollback is
    required.

---

## 5. Launch blockers

| Blocker | Owner | Evidence |
|---|---|---|
| 0 approved questions (need ≥1,440 across 72 topics) | Academic/SME | Content report §2 |
| 0 produced media (864 planned) | Production | Content report §3 |
| 0 approved articles (72 drafts/briefs) | Faculty | Content report §1 |
| 0 practical assessments authored (workflow built) | Academic/Faculty | Content report §1 |
| Live migrations/import/E2E not run | Engineering | Testing report §4 |
| No cross-learner/concurrency security tests | Engineering | Testing report §4 |
| No email certificate delivery (in-app PDF/QR download and public page exist) | Product/Engineering | Implementation report §3 |

---

## 6. Go / no-go

- **Enable flag for internal demo / admin review:** yes, with the content caveat
  that every topic shows blocked and no quiz can start.
- **Open to learners as a course:** **no-go** until the question bank, media and
  article approvals meet the gates.
- **Issue certificates:** **no-go** until all 72 topics are published, mastered by
  the learner, and hold-free; by design the software will refuse otherwise.
