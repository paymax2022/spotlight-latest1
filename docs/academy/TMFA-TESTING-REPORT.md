# TMFA Topic Mastery — Testing Report

Date: 2026-10-25 · Environment: local Windows workspace, no live Supabase writes,
no device/emulator run.

This report lists exactly what was executed and what was not. Unit and type
checks are evidence of code correctness, **not** of live feature correctness.

---

## 1. Results summary

| Check | Command | Result |
|---|---|---|
| frontend-web typecheck | `npm run type-check` (`tsc --noEmit`) | **exit 0** |
| frontend-admin typecheck | `npm run type-check` (`tsc --noEmit`) | **exit 0** |
| Mobile typecheck | `npm run typecheck` (Expo TS config) | **exit 2 — 7 errors, all in unrelated files; 0 in `film-academy`** |
| Academy unit tests | `npx vitest run tests/unit/academy` | **96 passed, 1 skipped** across 6 files |
| New topic-mastery tests | part of the above (`topic-mastery.test.ts`) | **41 / 41 passed** |
| Web targeted lint | `npx eslint` on new routes + services + test | **exit 0, no findings** |
| Admin lint | n/a | **not available** — `frontend-admin` has no ESLint config/dependency |
| Mobile lint | n/a | **not available** — package has no lint script/config |

No test failed. The one skipped test is pre-existing in
`tests/unit/academy/assessment.test.ts` and is unrelated to this slice.

---

## 2. New unit coverage (`frontend-web/tests/unit/academy/topic-mastery.test.ts`)

The Supabase client is mocked; these are pure-domain and plan tests.

### Exact mastery gate (7 tests)

- 8/10 fails, 9/10 passes.
- 16/20 fails, 17/20 passes.
- 84/100 fails, 85/100 passes.
- A sub-85 percentage is not rounded up into a pass.
- Non-integer, negative, over-possible and zero-possible inputs fail closed.
- The display percentage can differ from the gate without changing the verdict.
- The 85% policy and 20-item floor stay named constants.

### Publication gate (10 tests)

- A fully approved, well-formed topic publishes.
- Article approval and ≥200-character teachable length are required.
- ≥20 approved items (or the draw count if larger) are required.
- A threshold below 85% is rejected.
- Mandatory media must be published, rights-cleared and accessibility-passed.
- A "published" asset with no file URL still blocks.
- Optional media never blocks.
- An accessible-equivalent waiver needs both the flag and a ≥20-character rationale.
- A rationale alone (no approval) does not waive media.

### Learner state machine (9 tests)

- Passed + no holds → `MASTERED`, retake blocked.
- Passed + open hold → `PASSED`, not mastered.
- In-progress attempt resumes.
- Failed attempt → remediation, retake allowed when the pool exists.
- Unpublished topic stays locked regardless of personal progress.
- Unmastered prerequisite locks the successor.
- Open hold locks the topic.
- Missing approved pool locks the topic.
- Published, prerequisite-complete topic opens.

### Certificate eligibility (7 tests)

- Issues only when every topic is published, mastered and hold-free.
- Withholds while the curriculum is incomplete/withdrawn.
- Withholds when one topic is unmastered.
- Withholds while a practical hold is open.
- Empty curriculum cannot certify.
- Negative/fractional counts cannot satisfy the gate.

### Media workflow mapping (1 test)

- Manifest notes map to explicit production states; no guessed approvals.

### Import plan (9 tests)

- Topics chain into prerequisites and every topic defaults to draft.
- Declared thresholds are raised to the 85% floor.
- Duplicate topic IDs and media pointing at unknown topics are skipped.
- A question whose answer text disagrees with its key is rejected.
- A question referencing an undeclared objective is rejected.
- Manifest review states are normalised, never auto-approved.
- The plan is deterministic for identical input.
- **The bundled pack imports as drafts only:** 13 courses / 72 topics /
  864 planned media / 336 questions; no approved or published media.
- The supplied A04 article is used; other topics keep their pack copy.

---

## 3. Pre-existing academy tests (unchanged, still passing)

| File | Tests |
|---|---|
| `best-attempt.test.ts` | 5 |
| `assessment.test.ts` | 21 (1 skipped) |
| `exam-window.test.ts` | 5 |
| `revenue.test.ts` | 12 |
| `academy-mock-exams.test.ts` | 13 |

---

## 4. Not tested — explicit gaps

| Gap | Why it matters | Status |
|---|---|---|
| Migration application | Schema was never run against Postgres in this session | Not run |
| Live import (preview + apply) | Idempotency and constraint behaviour against the real schema is unproven | Not run |
| Quiz E2E | Draw, timer, autosave, submit, grade, unlock on a real DB is unproven | Not run |
| Cross-learner access tests | Service-role client bypasses RLS; code filters are the only defence | Not run |
| Concurrency tests | Two submits racing, two certificate issues racing | Not run |
| Mobile device test | Screens were typechecked, not rendered on a device/emulator | Not run |
| Repo-wide mobile typecheck | **Currently red:** 7 errors in `app/(tabs)/home.tsx` (3), `app/arena/state-pride.tsx`, `app/association/index.tsx`, `app/services/airtime.tsx`, `src/features/featured/components/FeaturedHero.tsx` — all `PromoBanner` prop mismatches / an unrelated `Contact` type. **Zero errors reference `film-academy`.** These stem from the branch's image-only `PromoBanner` refactor and were not touched by this slice. | Pre-existing |
| Admin UI browser test | Console was typechecked, not exercised in a browser | Not run |
| Public verification E2E | JSON route not hit over HTTP | Not run |
| Load/performance | No measurement of path queries, analytics counts or event polling | Not run |
| Accessibility audit | Per-asset review state is modelled; no WCAG audit was performed | Not run |
| Security review/pen test | No external review of the new surface | Not run |

Recommended first integration tests, in order:

1. Import twice → same version, no duplicate rows, no approvals.
2. Start → autosave → submit twice → one mastery row, identical result.
3. 8/10 attempt → remediation; 9/10 → `PASSED`; hold → not `MASTERED`; clear
   hold → `MASTERED`; successor unlocks only then.
4. Learner A requests learner B's attempt/topic/certificate → 403/404.
5. Publish blocked with 19 approved items and with missing media; passes at 20
   plus cleared media; waiver requires both flag and rationale.
6. Certificate blocked until all topics published/mastered/hold-free; revoke →
   public verify returns `valid: false, status: revoked`, not 404.
7. Cross-learner certificate readiness cannot leak enrollment counts.

---

## 5. Known risks found during implementation

- **Bundled bank cannot satisfy the 20-item gate.** This is a content issue, not
  a test failure; see the content report.
- **Article length floor is 200 characters.** Every supplied draft passes it, so
  faculty review — not the check — must reject briefs.
- **Waiver breadth.** A signed waiver bypasses mandatory-media blockers by design.
  Governance depends on the `scores:manage` signer and the audit rationale.
- **No dedicated rate limiting** on new learner endpoints beyond the platform
  middleware (which rate-limits only legacy paid-vote paths).
- **Local `npm run typecheck` runs were slow** (several minutes) but completed
  with exit 0; no incremental cache is committed.
