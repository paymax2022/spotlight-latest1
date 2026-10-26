# TMFA Topic Mastery — Production Readiness Report

Date: 2026-10-25

**Verdict: the code plane is deployable and is now the only Film Academy course;
the programme is not launch-ready.** The legacy modules/lessons course has been
retired from the mobile app and admin console (historical rows are preserved), so
there is no fallback course and both TMFA flags must be on. Migrations and a live
import/E2E have not been run, and the curriculum has zero publishable topics.
Enabling the flags at this moment exposes an empty/locked path with honest
"blocked" copy — not a functioning course.

---

## 1. Readiness matrix

| Area | Software | Live-verified | Launch readiness |
|---|---|---|---|
| Topic hierarchy + import | Complete | Local dev DB only (§1c) | Blocked by content |
| Learner path + locking | Complete | Local dev DB only, as a real learner (§1c, §1d) | Blocked by content |
| Topic quiz + exact 85% gate | Complete | Draw only, local (§1d) — submit/grade/unlock not run | Blocked by question bank |
| Article progress + events | Complete | No | Ready once flag on |
| Publication gate | Complete | Local dev DB only — 8 blockers reported per topic (§1c, §1d) | Blocked by media/articles |
| Media production console | Complete | No | No assets produced |
| Holds + mastery | Complete | No | Ready once content is live |
| Practical assessment workflow | Complete | Read path local (§1c); submit/grade never | 0 assessments authored; no practical content exists |
| Credentials + PDF/QR + public verification | Complete | Readiness read local (§1d); issuance never | Cannot issue (0 published/mastered) |
| Pilot delivery exception (dev/staging) | Complete | Local dev DB only (§1d) | **Must stay off** outside dev/staging |
| Admin console | Complete | HTTP routes local; browser never | Typechecked only |
| Mobile screens | Complete | No | Typechecked only; repo-wide mobile tsc is red on 12 unrelated `PromoBanner`/`Contact`/electricity errors (0 in film-academy) |
| Legacy course retirement | Complete | No | Removed from app/console; legacy DB rows and API routes retained; requires both flags on |
| Deployment/runbooks | This report | — | Checklist below |

Legend: "Complete" means implemented and typechecked/unit-tested in this
workspace. "Local dev DB only" means the call was made over HTTP against this
machine's own Supabase and the response is recorded in `TMFA-TESTING-REPORT.md`;
it is **not** verification of staging or production.

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
- Every new route 503s when its flag is unset. The env examples now default both
  flags on because the legacy course is retired and there is no fallback;
  learner practical routes still require both the topics flag and
  `FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED`.
- Additive migrations only; no existing rows are modified by the certificate or
  practical migrations. `20271099000005_film_academy_pilot_unlocks.sql` adds one
  private table (RLS enabled, no `anon`/`authenticated` grant, service role only)
  and rewrites nothing.
- **Pilot delivery is contained.** It needs all three of: the
  `FEATURE_FILM_ACADEMY_PILOT_DELIVERY_ENABLED` flag, a `film_pilot_unlocks` row for
  that specific course, and a non-production `NODE_ENV`. It relaxes only the
  "published" and "approved pool" preconditions — the 85% gate, prerequisite chain,
  holds and remediation run unchanged; the quiz draw moves from
  `status = 'approved'` to `status <> 'retired'` and still returns no answer key;
  no topic, question or media row is written. Every enable/revoke is audited with a
  mandatory ≥10-character reason, and if the unlock lookup errors the course stays
  locked. Because certificates count `film_topics.published`, a completed pilot
  cannot produce a credential (confirmed locally: `0 of 72 published`).

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
- **A pilot puts unreviewed material in front of real learners.** The labelling is
  honest ("Pilot · not yet reviewed", all publication blockers still shown) and it
  cannot certify, but the academic quality is unvetted by definition — a pilot is a
  rehearsal decision for a named person to own, recorded in
  `film_academic_audit`. Confirm `FEATURE_FILM_ACADEMY_PILOT_DELIVERY_ENABLED` is
  unset or false in every deployed environment; its `NODE_ENV=production` guard is
  code-level and has not been exercised against a production build.

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
- **Flags:** `FEATURE_FILM_ACADEMY_TOPICS_ENABLED` gates the module (path, topics,
  certificates and the admin console); `FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED`
  gates topic quizzes and practicals. With the legacy course retired, **both must
  be on** for the app to offer any course. Both are documented in the frontend-web
  env examples, which now default them to true.

Not established: dashboards, alerting, dead-letter handling, retention policy for
attempt snapshots/events/audit, backup/restore rehearsal for the new tables.

---

## 4. Deployment checklist

**Schema**

1. Read all four migration files and confirm the migration guard passes.
2. Apply `20271099000000_film_academy_topic_mastery.sql`.
3. Apply `20271099000001_film_academy_credentials.sql`.
4. Apply `20271099000004_film_academy_practical_assessments.sql`. This version was
   renumbered on 2026-10-26: it previously collided with
   `20271099000002_expand_payment_sources.sql`, and because `supabase db push`
   keys on the version alone, the practical tables were silently never created on
   any environment that had already applied that version. Verify
   `film_practical_assessments`, `film_practical_submissions` and
   `film_mastery_holds.source`/`source_ref` exist after applying.
5. **Do not apply `20271025001000_purge_film_academy.sql`** — it deletes film
   academy data and is not part of this implementation.
6. Apply `20271099000005_film_academy_pilot_unlocks.sql` if the rehearsal escape
   hatch is wanted in dev/staging. It is additive (one private table) and harmless
   when unused. Verify `film_pilot_unlocks` has RLS enabled and no `anon`/
   `authenticated` grant. In a **production** database it is inert while
   `NODE_ENV=production`, but leaving it out is the safer default.
7. Verify the ten topic tables, the two certificate indexes, the two practical
   tables, and `film_mastery_holds.source`/`source_ref` plus its partial unique
   index exist. Existing holds must read `source = 'manual'`.

**Configuration**

8. Set `FEATURE_FILM_ACADEMY_TOPICS_ENABLED=true` in frontend-web. **Required:**
   the legacy course is retired, so with this false the app has no course at all.
9. Set `FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED=true` to expose topic quizzes and
   the learner practical routes. Admin authoring/grading uses the topics flag plus
   permissions. Neither flag publishes content; every topic still clears its own
   server-side gate.
10. Leave `FEATURE_FILM_ACADEMY_PILOT_DELIVERY_ENABLED` unset or false in any
    deployed environment. Turn it on only in dev/staging, and only to open a named
    course through the admin console's **Pilot delivery** tab — which records the
    actor and a mandatory reason.
11. Set `NEXT_PUBLIC_SITE_URL` (frontend-web) and `EXPO_PUBLIC_SITE_URL` (mobile)
   to the public origin that serves `/verify/certificate`. They must match; an
   unset mobile value falls back to production, so staging must set it.

**Content and operations**

12. Run admin **Curriculum import → preview**, inspect the plan, then apply once.
13. Re-run preview/apply to prove idempotency (no duplicates).
14. SME review: approve questions; the bundled bank cannot reach 20/topic.
15. Produce/rights/accessibility review of 864 assets, or sign waivers with
    genuine rationales.
16. `scores:manage` approves articles and publishes topics individually.
17. Author practical assessments where required. Keep them inactive until the
    brief/rubric is reviewed, then open the gate; confirm the returned
    `holdsOpened` matches the number of learners who had already passed the quiz.
18. Validate the learner journey on a preview account: path → article → quiz →
    8/10 remediation → 9/10 pass → `PASSED` with a practical hold → submit
    practical → fail with feedback → resubmit → pass → `MASTERED` → successor
    unlock. Also withdraw an assessment and confirm only its workflow holds clear
    and earned `MASTERED` returns.
19. Issue a credential only after all topics are published/mastered; download the
    PDF, scan its QR, confirm the public page reports it verified, then revoke a
    test credential and confirm the verifier shows revoked.

**Rollback**

20. To withdraw the course, set the topics flag false (all new routes return 503).
    Note this now removes the app's only course — the old modules/lessons screens
    are gone; use it as an emergency withdrawal, not as a way to "fall back". To
    withdraw quizzes/practicals without disabling the topic path, set
    `FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED=false` and deactivate authored
    assessments to clear their workflow holds. The additive schema and historical
    legacy rows remain; no data rollback is required.
21. To end a pilot, use **Pilot delivery → revoke** (or drop
    `FEATURE_FILM_ACADEMY_PILOT_DELIVERY_ENABLED`). The topics return to `LOCKED`
    immediately, the `film_pilot_unlocks` row is kept with `revoked_at` as history,
    and the `FILM_PILOT_REVOKED` audit row is written. Scores already earned stay
    in the mastery ledger — they were earned against the same 85% gate — but they
    never counted toward a credential, so nothing has to be reversed.

---

## 5. Launch blockers

| Blocker | Owner | Evidence |
|---|---|---|
| 0 approved questions (need ≥1,440 across 72 topics) | Academic/SME | Content report §2 |
| 0 produced media (864 planned) | Production | Content report §3 |
| 0 approved articles (72 drafts/briefs) | Faculty | Content report §1 |
| 0 practical assessments authored (workflow built) | Academic/Faculty | Content report §1 |
| Live migrations/import/E2E not run against staging or production (local dev DB has the schema, an imported pack and the pilot table since 2026-10-26) | Engineering | Testing report §1c, §1d |
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
- **Run a rehearsal cohort on unreviewed content:** possible **only** in dev/staging,
  via the audited **Pilot delivery** control on one named course, with the learner
  labelling visible on every screen. It changes no publication or approval state and
  cannot mint a credential, but it does teach unvetted material to real people, so it
  is an academic/product decision to record against an owner — not a technical
  convenience. Revoke it when the rehearsal ends.
