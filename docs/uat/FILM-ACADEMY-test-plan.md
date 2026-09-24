# Film Academy — UAT Test Plan

Scope: the full Film Academy module (application, curriculum/learning, assignments,
admin console, RLS/authz, notifications) EXCLUDING tuition installment payment
confirmation, which was fully audited and remediated separately this session
(FILM-001, PR #163). Built from the Phase 1 discovery report below each item.

## A. Application flow

- [ ] A1. Apply to an open batch with valid areas-of-interest — succeeds, fee computed server-side from `academy_interest_areas`, not client-supplied.
- [ ] A2. Apply with > max (2) areas — rejected.
- [ ] A3. Apply to an unoffered/unknown area — rejected.
- [ ] A4. Apply twice (same user, same batch) — rejected (duplicate guard: `user_id` OR `email` + DB unique constraint).
- [ ] A5. **Apply to a batch at capacity** — should be rejected once `enrolled_count`/approved applications reach `max_students`. **Suspected gap from discovery — verify empirically.**
- [ ] A6. Application-fee Paystack verification: amount mismatch rejected, wrong reference rejected (mirrors tuition's pattern — confirm it's actually enforced here too, not just in tuition).
- [ ] A7. `GET /api/academy/application` returns only the caller's own application (never another user's) — direct authorization probe.

## B. Curriculum / learning flow

- [ ] B1. Unenrolled user requesting curriculum gets `locked:true` with a reason, not lesson content.
- [ ] B2. Enrolled learner sees only published lessons.
- [ ] B3. Progress update (`setLessonProgress`) for a lesson belonging to the learner's own program succeeds.
- [ ] B4. Progress update for a lesson NOT in the learner's program is rejected (progress-spoofing guard).
- [ ] B5. Un-enroll edge case: revoke enrollment (e.g. a reversed tuition payment) — does learning correctly re-lock? (Not explicitly covered by discovery — verify.)

## C. Assignments flow

- [ ] C1. Submit an assignment before the due date/while open — succeeds.
- [ ] C2. Submit to a closed/draft assignment — rejected.
- [ ] C3. Resubmit an assignment that is already `graded` — rejected (409).
- [ ] C4. Submit a specific part of a multi-part assignment (`submitAssignmentPart`) — succeeds and doesn't overwrite a different part.
- [ ] C5. Admin grades a submission (whole and per-part) via `filmAcademyAdminService` → confirm it actually persists and the UI reflects it (not a stub).
- [ ] C6. Ownership: one learner cannot submit/view another learner's assignment submission.

## D. Enrollment gating

- [ ] D1. Zero-tuition batch (free) — application approval alone enrolls, no plan created.
- [ ] D2. Tuition-bearing batch, approved, no installment plan row yet — must NOT be misread as "free" (discovery flagged this as an explicitly-guarded prior bug — regression-confirm).
- [ ] D3. Tuition-bearing batch, one installment paid — enrolled (partial payment sufficient), curriculum unlocked.
- [ ] D4. Tuition-bearing batch, zero installments paid — NOT enrolled, curriculum locked with `pay_tuition` action surfaced.
- [ ] D5. `ensureEnrollment` called twice for the same application (idempotency / race) — no duplicate `academy_enrollments` row (UNIQUE constraint + fallback read).

## E. Admin console — full surface

- [ ] E1. Batches tab: create/edit a batch — persists to `academy_batches`, not a fixture.
- [ ] E2. Applications tab: approve an application — status flips, installment plan auto-created if tuition owed, `ensureEnrollment` fires.
- [ ] E3. Applications tab: reject an application — status flips, no plan/enrollment created.
- [ ] E4. Tuition tab: already covered by FILM-001 remediation — spot-check the admin list view renders real plan/payment data (not the reminder-email mutation path, which was deliberately left on direct Supabase).
- [ ] E5. Curriculum tab + "seed" action: confirm curriculum/seed writes real rows, not a no-op or fixture.
- [ ] E6. Progress tab: confirm it reflects real `academy_lesson_progress` data for a specific learner.
- [ ] E7. Submissions tab: grade a submission end-to-end (see C5).
- [ ] E8. Settings tab: change a module-level setting (e.g. application fee amount) — persists and is picked up by `apply/route.ts` on the next request.
- [ ] E9. RBAC: a non-admin (or admin without the right permission) cannot reach any of the above admin routes.

## F. Cross-cutting / authorization

- [ ] F1. Direct ID-guessing probe: authenticated User A cannot read User B's application, plan, payments, or submissions via a crafted ID in any of the routes above (RLS is present but bypassed by the service-role client — the REAL enforcement is manual `user_id` filtering in each route; confirm it holds for every route, not just the ones discovery spot-checked).
- [ ] F2. Unauthenticated access to any member route → 401, never a data leak.

## G. Notifications (documented gap, not a defect to fix without product sign-off)

- [ ] G1. Confirm (already done via code read): no email/SMS fires on application approval or rejection — applicant only sees status via in-app polling. **Log as a finding; ask whether this is an accepted product gap or should be remediated.**

## H. Mobile parity

- [ ] H1. Spot-check `mobile-app/reactnative/src/features/filmAcademy/` apply/learn/assignments calls match the web contract (same request/response shapes) — discovery flagged this as unverified.

---

Execution note: A5 (capacity), D1-D5 (enrollment edge cases), F1 (authorization probe), and E1-E3/E5 (admin persistence) will be verified empirically against a live throwaway backend + seeded DB, not just by code reading — per this engagement's standing rule that a defect claim requires observed behavior. C5/E7 (grading) and E6/E8 (progress/settings) will be verified by direct code read of the already-wired routes discovery found, given time budget; flagged if anything looks stubbed on closer inspection.
