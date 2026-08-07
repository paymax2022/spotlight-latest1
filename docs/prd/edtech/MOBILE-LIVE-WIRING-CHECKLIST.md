# Spotlight Academy — Mobile Live-Wiring Verification Checklist

Scope: React Native app at `mobile-app/reactnative/src/features/academy`. Goal: make the
LIVE branch (`USE_MOCK=false`) of `api.ts` + `fees/api.ts` correct so the flag can be
flipped safely. **Do NOT flip the module-wide default in one shot.** Flip per-feature only
after the rows below are `VERIFIED`.

Flags:
- Main academy: `EXPO_PUBLIC_ACADEMY_USE_MOCK` (default `true`) → base `/api/finance/academy`.
- Fees/competition: `EXPO_PUBLIC_ACADEMY_FEES_USE_MOCK` (default `true`) → base `/api/finance/academy`.

Backend routing confirmed in `backend/internal/app/academy_routes.go`:
- `identity`, `curriculum`, `commerce` register on the bare finance group and embed
  `/academy/...` in their own subpaths.
- `gamification`, `rewards`, `assessment`, `exam`, `progression`, `content`, `parent`,
  `edupay`, `credentials`, `trade`, `live`, `schools`, `tutor`, `fees/*` register on
  `finance.Group("/academy")` with bare subpaths.
- All member routes resolve under `/api/finance/academy/*` (blanket Next.js rewrite
  `/api/finance/:path*` → Go). No dedicated proxy route needed.

## Cross-cutting findings (apply to every row)
1. **Envelope is inconsistent.** `identity/curriculum/exam/progression/commerce/edupay`
   return the model BARE. `rewards`/`gamification` wrap in `{data: …}` (rewards balance is
   DOUBLE-nested `{data:{balance_minor}}`). `api.ts` now has a tolerant `unwrap<T>()`
   that handles both.
2. **Casing is inconsistent.** snake_case: identity, curriculum, exam, gamification,
   rewards. camelCase (but different field NAMES): commerce, edupay.
3. **Money.** Backend `*Minor`/`*_minor` == kobo, 1:1 with the screens' `*Kobo`. Screens
   format via `formatNaira(kobo)`. No unit conversion required — only field renaming.
4. **Reward "points".** Backend rewards ledger is a single running `balance_minor`; the
   screen's `RewardBalance {points, pendingPoints, lifetimeEarned}` split is not modeled
   server-side.

Legend: **VERIFIED** = path+shape correct/mapped, safe to flip · **MAPPED (needs runtime
check)** = mapper added, verify against a live server before flip · **BLOCKED** = no
backend route or divergent aggregate; mock stays default.

---

## A — Identity (`api.ts`)
| Fn | Method+Path | Status | Note |
|----|-------------|--------|------|
| getMe | GET `/me` | **MAPPED (needs runtime check)** | `mapMeToProfile` collapses `Me` aggregate → one `AcademyProfile` (prefers learner profile; `guarded_by`→minor/consent inference). TODO(product): `isMinor/kycTier/guardianConsent/onboardingComplete` are inferred/defaulted (DOB→minor + finance/kyc tier + consent scope not first-class on `Me`). |
| setRole | POST `/roles` | **MAPPED (needs runtime check)** | Body `{role}` already correct. Response `{ok, role}` echoed into a minimal `AcademyProfile` via `mapProfile`; screens should re-fetch `getMe` for authoritative state. |
| updateProfile | PUT `/profile` | **MAPPED (needs runtime check)** | Body FIXED → `{role, class_id←classCode, display_name←displayName, stream}` (role defaulted to caller's current role). Response `Profile` → `mapProfile`. TODO: `class_id` is UUID server-side vs class CODE; `curriculumVersion` unmodeled. |
| linkGuardian | POST `/guardians/link` | **MAPPED (needs runtime check)** | Body FIXED → `{minor_user_id}`. CAVEAT: direction inversion — screen passes a guardian phone (minor→guardian) but backend models guardian→minor by user id. Response `GuardianLink` merged into a `mapProfile` echo (`guardianConsent:'pending'`). TODO(product): resolve direction + phone→user_id lookup. |
| recordConsent | POST `/guardians/:minorId/consent` | **MAPPED (needs runtime check)** | Body FIXED → `{scope:{purchases,community,data_sharing}}` expanded from `granted`. Response `{consent_id,status}` → `mapProfile` echo with `guardianConsent` set. |

## L — Curriculum + Learner content (`api.ts`)
| Fn | Method+Path | Status | Note |
|----|-------------|--------|------|
| getCurriculumVersions | GET `/curriculum/versions` | **MAPPED (needs runtime check)** | Path OK. Backend `{id, code, name, effective_date, status}` → screen `{id, label, effectiveYear, isLegacy}`: needs a small mapper (name→label, derive isLegacy). Currently returns raw. |
| getClasses | GET `/curriculum/classes` | **MAPPED (needs runtime check)** | Backend `Class {id, code, name, ordinal, phase, version_id}` → `{id, code, label, band, curriculumVersionId}`. Map name→label, phase→band. |
| getSubjects | GET `/curriculum/classes/:id/subjects` | **BLOCKED (partial)** | Path OK but mobile passes `classCode`, backend expects class **UUID id**. Backend Subject lacks `icon/colorKey/topicCount/masteredTopics/progressPct` — a mapper would fabricate. |
| getSubject | GET `/curriculum/subjects/:id` | **BLOCKED** | No such route (only `/subjects/:id/topics`). Inline TODO added; mock stays default. |
| getTopics | GET `/curriculum/subjects/:id/topics` | **BLOCKED (partial)** | Path OK. Backend Topic `{id, subject_id, code, title, ordinal}` lacks `mastery/locked/examRelevant/objectiveCount/lessonCount`. |
| getTopic | GET `/curriculum/topics/:id` | **BLOCKED** | No such route (only `/topics/:id/objectives`). Inline TODO added; mock stays default. |
| getObjectives | GET `/curriculum/topics/:id/objectives` | **BLOCKED (partial)** | Path OK. Backend Objective `{id, topic_id, code, title, exam_tags, ordinal}` lacks `statement/mastery/masteryPct` (title≈statement). |
| getLessons | GET `/curriculum/topics/:id/lessons` | **BLOCKED** | No curriculum lessons route. Lessons live in `content`: `GET /content/lessons/:objectiveId` (keyed by objective, not topic). Inline TODO added; mock stays default. |
| getLesson | GET `/curriculum/lessons/:id` | **BLOCKED** | No such route. Inline TODO added; mock stays default. |

## Assessment (`api.ts`)
| Fn | Method+Path | Status | Note |
|----|-------------|--------|------|
| getPractice | GET `/practice` | **MAPPED (needs runtime check)** | Path OK. Verify item/option field names vs `Question`. |
| submitPractice | POST `/practice/submit` | **NEEDS RUNTIME CHECK** | Path OK. Confirm request/response `PracticeResult` shape. |
| getMastery | GET `/mastery` | **NEEDS RUNTIME CHECK** | Path OK. Confirm `MasterySnapshot[]` shape. |

## X — Exam (`api.ts`)
| Fn | Method+Path | Status | Note |
|----|-------------|--------|------|
| getArenas | GET `/exam/arenas` | **BLOCKED (partial)** | Path OK. Backend Arena `{id, code, name, subject_set, scoring_rules, calendar, countdown_at, status}` (snake_case) ≠ screen `{slug, nextSittingDate, readinessPct, syllabusCoveragePct, subjectsRequired, isCbt}`. Needs mapper; several screen fields not modeled. |
| getArena | GET `/exam/arenas/:id` | **BLOCKED (partial)** | As above. |
| getBlueprints | GET `/exam/arenas/:id/blueprints` | **BLOCKED (partial)** | Backend `{total_items, total_seconds, tools, pause_policy, sections}` ≠ screen `{subjects[], durationMin, totalQuestions, calculatorAllowed, offlineItemCount}`. |
| getUtmeCombinations | GET `/exam/utme/combinations` | **MAPPED (needs runtime check)** | Backend `{course, required_subjects, guidance}` → `{course, subjects, note, institution?}`. |
| startAttempt | POST `/exam/attempts` | **MAPPED (needs runtime check)** | Body FIXED → `{blueprint_id, offline_origin}`. Response is still a snake_case `Attempt` with no embedded `questions[]`. TODO(shape): map `Attempt→ExamAttempt` (state→status, server_deadline→remainingSec) + client-source questions before flipping the CBT runner. |
| getAttempt | GET `/exam/attempts/:id` | **BLOCKED (partial)** | snake_case `Attempt`, no `questions[]`. |
| pauseAttempt / resumeAttempt | POST `/exam/attempts/:id/{pause,resume}` | **NEEDS RUNTIME CHECK** | Paths OK; response is snake_case `Attempt`. |
| submitAttempt | POST `/exam/attempts/:id/submit` | **BLOCKED (partial)** | Backend body is `SubmitRequest {responses[], integrity}`; mobile sends `{}` (relies on server-side answer store). Response `ScoreResult {subjects[], overall, readiness, ...}` ≠ `ExamResult`. |
| getExamResult | GET `/exam/attempts/:id/result` | **MAPPED (needs runtime check)** | Route NOW exists (`GetAttemptResult`, owner-only). `mapExamResult` maps `Result{subjects[],overall,readiness,late}` → `ExamResult`. TODO(shape): `overall` is exam-native scale (e.g. UTME 400) not 0–100; `unanswered/timeSpentSec/pointsEarned` + `readinessDelta` not in the score projection. |

## G — Gamification (`api.ts`)  ← mappers ADDED
| Fn | Method+Path | Status | Note |
|----|-------------|--------|------|
| getGamificationProfile | GET `/gamification/profile` | **MAPPED (needs runtime check)** | `{data: UserState}` → mapped `{level, xp, streakDays←streak_days, freezeTokens←freezes}`. `xpToNext`/`rank` not modeled → 0/undefined. |
| getBadges | GET `/gamification/badges` | **MAPPED (needs runtime check)** | `{data: Badge[]}` snake_case mapped; `earned` defaults false (no per-user join on list route). |
| getChallenges | GET `/gamification/challenges` | **MAPPED (needs runtime check)** | `{data: Challenge[]}` mapped; per-user `progress/completed` default 0/false. |
| getLeaderboard | GET `/gamification/leaderboards/:id` | **MAPPED (needs runtime check)** | `{data: Entry[]}` → `{rank, name←user_id, xp←score, isMe:false}`. Needs server name + viewer flag. |

## R — Rewards (`api.ts`)  ← mappers ADDED
| Fn | Method+Path | Status | Note |
|----|-------------|--------|------|
| getRewardBalance | GET `/rewards/balance` | **MAPPED (needs runtime check)** | DOUBLE-nested `{data:{balance_minor}}` → `{points←balance_minor, pendingPoints:0, lifetimeEarned:points}`. Pending/lifetime not modeled server-side. |
| getRewardHistory | GET `/rewards/history` | **MAPPED (needs runtime check)** | `{data: LedgerEntry[]}` snake_case → `RewardLedgerEntry` (type→kind, created_at→ts, synced:true). |
| getRewardCatalog | GET `/rewards/catalog` | **MAPPED (needs runtime check)** | `{data: CatalogItem[]}` → `{pointsCost←cost_points, walletValueKobo←value_minor}`; description/icon defaulted. |
| redeemReward | POST `/rewards/redeem` | **MAPPED (needs runtime check)** | Request FIXED: body now `{sku, idempotency_key}` (was `{itemId}`). Response `{data: IssueResult}` → `entry`. **Caveat:** mobile catalog `id` must equal backend `sku`. |

## C — Commerce (`api.ts`)
| Fn | Method+Path | Status | Note |
|----|-------------|--------|------|
| getPlans | GET `/commerce/plans` | **MAPPED (needs runtime check)** | camelCase but `priceMinor`→`priceKobo`, `features` is RawMessage(JSON) not `string[]`; no `tagline/recommended`. Mapper needed. |
| getBundles | GET `/commerce/bundles` | **MAPPED (needs runtime check)** | Now unwraps `{data}` + maps via shared `mapBundle` (`priceMinor`→`priceKobo`, `contents`→`itemCount`). `examSlug` defaults `'utme'` (row carries `arenaId`); `bnplEligible/dataBudgetMb/icon` defaulted. NOTE: server filters `?arena=`, not by slug. |
| getBundle | GET `/commerce/bundles/:id` | **MAPPED (needs runtime check)** | Route NOW exists (`GetBundle`). Reuses the shared `mapBundle` contract. |
| getBundleManifest | GET `/commerce/bundles/:id/manifest` | **NEEDS RUNTIME CHECK** | Path OK; confirm manifest item shape. |
| createOrder | POST `/commerce/orders` | **MAPPED (needs runtime check)** | Body FIXED → `{kind:'plan'|'bundle', refId}` (kind derived from which id passed). Response `Order` → shared `mapOrder` (`state→status`, `amountMinor→amountKobo`, `refId→bundleId|planId` by kind). |
| payOrder | POST `/commerce/orders/:id/pay` | **MAPPED (needs runtime check)** | `Idempotency-Key: pay_<orderId>` now sent (money path). Response `Order` → `mapOrder`. |
| bnplOrder | POST `/commerce/orders/:id/bnpl` | **MAPPED (needs runtime check)** | `Idempotency-Key: bnpl_<orderId>` now sent. Backend `StartBNPL` takes no body (instalments server-driven); the mobile `instalments` arg is local/mock UX only. Response `Order` → `mapOrder`. |
| activateAccessCard | POST `/commerce/access-cards/activate` | **BLOCKED (input)** | Body FIXED → `{serial}` (+`Idempotency-Key`). Backend requires a non-empty `pin` but the access-card screen has NO pin input → will 400 until the screen captures serial+pin. Response is an `Entitlement`, not `AccessCardResult` (unlocked[]/valueKobo defaulted). |

## W — Wallet (`api.ts`)
| Fn | Method+Path | Status | Note |
|----|-------------|--------|------|
| getWallet | GET `/wallet` | **BLOCKED** | No academy `wallet` package exists. Academy wallet = Paymax finance wallet (finance/ledger) surfaced elsewhere. Point at the real Paymax wallet endpoint or expose a read here. Annotated inline. |

## P — Progression (`api.ts`)
| Fn | Method+Path | Status | Note |
|----|-------------|--------|------|
| getPath | GET `/progression/paths/:subjectId` | **NEEDS RUNTIME CHECK** | Path OK; confirm `LearningPath` field names/casing. |
| createPath | POST `/progression/paths` | **NEEDS RUNTIME CHECK** | Path OK; body `{subjectId}` — confirm casing. |
| advanceStep | POST `/progression/steps/:objectiveId/advance` | **NEEDS RUNTIME CHECK** | Path OK. |
| getAdaptiveSet | POST `/progression/practice/adaptive` | **NEEDS RUNTIME CHECK** | Path OK. |
| getRecommendations | GET `/progression/recommendations` | **NEEDS RUNTIME CHECK** | Path OK. |

## Parent / EduPay (`api.ts`)
| Fn | Method+Path | Status | Note |
|----|-------------|--------|------|
| getChildren / getChildDashboard / getChildSubject / getControls / updateControls / getReports / generateReport / getApprovals / decideApproval | `/parent/*` | **NEEDS RUNTIME CHECK** | `parent` package registers on `memberAcad`; routes are `/parent/*` (parent handler routes were not enumerated here). Verify each path + shape against `parent/handler.go` before flip. |
| getSchools | GET `/edupay/schools` | **BLOCKED (partial)** | camelCase; backend School `{id, name, code, virtualAccountRef, status}` ≠ screen `{lga, state, logoColorKey, linked, verified}`. |
| getFeeSchedules | GET `/edupay/fee-schedules` | **BLOCKED (partial)** | `amountMinor`→needs `items[]/totalKobo`; classCode present; missing `bnplEligible/linked`. |
| linkSchool | POST `/edupay/link` | **NEEDS RUNTIME CHECK** | Path OK; confirm body/response `EduPayProfile`. |
| getEduPayProfile | GET `/edupay/me` | **NEEDS RUNTIME CHECK** | Path OK. |
| payFees | POST `/edupay/pay` | **NEEDS RUNTIME CHECK** | Path OK; money path — send `Idempotency-Key`; confirm body field names + response. |
| getPots | — | **BLOCKED** | No `GET /edupay/pots` route (only `POST /pots`, `/pots/:id/fund`, `/pots/:id/pay`). Inline TODO added; mock stays default. |
| createPot / fundPot / payFromPot | POST `/edupay/pots{,/:id/fund,/:id/pay}` | **NEEDS RUNTIME CHECK** | Paths OK; money paths need `Idempotency-Key` + body-field confirmation. |
| getScholarships / applyScholarship | `/edupay/scholarships*` | **NEEDS RUNTIME CHECK** | Confirm these exist in `edupay/handler.go` (not enumerated); shape check. |
| getSubscriptions / getInvoices / getParentNotifications / getDailyGoal / searchAcademy / bookmarks / notes / downloads / storage | `/parent/billing/*`, `/learner/*` | **NEEDS RUNTIME CHECK / BLOCKED** | `learner/*` + `parent/billing/*` routes not found in the packages surveyed — likely no backend route. Verify per handler; treat as BLOCKED until confirmed. |

## S — Trade & Skills / Credentials / Earning (`api.ts`)
| Fn | Method+Path | Status | Note |
|----|-------------|--------|------|
| getTradeHub | GET `/trade/hub` | **NEEDS RUNTIME CHECK** | Path OK; confirm `TradeHub` shape. |
| getTradeTracks | GET `/trade/tracks` | **MAPPED (needs runtime check)** | Route NOW exists (`GetTracks`). `mapTradeTrack` maps `{id,code,name,status}` → screen `TradeTrack`; `slug←code`; tagline/icon/colorKey/progress/moduleCount/chosen/unlocksRoles defaulted. |
| getTradeModule | GET `/trade/modules/:id` | **NEEDS RUNTIME CHECK** | Path OK. |
| getTradeProject | GET `/trade/projects/:id` | **MAPPED (needs runtime check)** | Route NOW exists (`GetProject`). `mapTradeProject` maps `{id,module_id,title,rubric,ordinal}` → screen `TradeProject`; trackId/brief/rubric[]/status/attachments defaulted. |
| submitProject | POST `/trade/projects/:id/submit` | **NEEDS RUNTIME CHECK** | Path OK. |
| getAssessment | GET `/trade/assessments/:id` | **MAPPED (needs runtime check)** | Route NOW exists (`GetAssessment`). `mapAssessment` maps `{id,trade_track,title,rubric,pass_threshold,...}` → screen `SkillAssessment` (`trackId←trade_track`, `passMark←pass_threshold`); questions[]/durationMin defaulted (rubric opaque). |
| takeAssessment | POST `/trade/assessments/:id/take` | **NEEDS RUNTIME CHECK** | Path OK. |
| getMentors / requestMentor | `/trade/mentors*` | **NEEDS RUNTIME CHECK** | Paths OK. |
| getCredentials | GET `/credentials` | **MAPPED (needs runtime check)** | Now unwraps `{data}` + maps via shared `mapCredential` (`verification_id`→`verificationId`, `trade_track`→`trackSlug`). issuer/recipientName/verifyUrl/unlocksRoles defaulted (holder name lives only on the public verification record). |
| getCredential | GET `/credentials/:id` | **MAPPED (needs runtime check)** | Route NOW exists (`GetOne`, owner-only). Reuses the shared `mapCredential` contract. |
| verifyCredential | GET `/credentials/verify/:verificationId` | **NEEDS RUNTIME CHECK** | Path OK. |
| getOpportunities | GET `/earning/opportunities` | **MAPPED (needs runtime check)** | Now unwraps `{data}` + maps via shared `mapOpportunity` (`role='service_provider'→'service'`, `eligibility_rules.trade_track`→`requiredCredentialKinds`). partner/earningsLabel/requirements defaulted; `eligibility:'eligible'` (member route only surfaces qualifying rows). |
| getOpportunity | GET `/earning/opportunities/:id` | **MAPPED (needs runtime check)** | Route NOW exists (`GetOpportunity`, eligibility-gated). Reuses the shared `mapOpportunity` contract. |
| applyOpportunity | POST `/earning/apply` | **NEEDS RUNTIME CHECK** | Path OK; body `{opportunityId}` — confirm casing. |

## Live / Community / Notifications (`api.ts`)
| Fn | Method+Path | Status | Note |
|----|-------------|--------|------|
| getLiveSessions | GET `/live/sessions` | **MAPPED (needs runtime check)** | Now unwraps `{data}` + maps via shared `mapLiveSession` (`state→status`: scheduled→upcoming/ended→replay; `trade_track||subject_id`→`subjectOrTrade`; `host_id`→`host`). durationMin/viewers defaulted; `moderated:true`. |
| getLiveSession | GET `/live/sessions/:id` | **MAPPED (needs runtime check)** | Route NOW exists (`GetSession`). Reuses the shared `mapLiveSession` contract. |
| joinLiveSession | POST `/live/sessions/:id/join` | **NEEDS RUNTIME CHECK** | Path OK. |
| getGroups / createGroup / joinGroup | `/community/groups*` | **NEEDS RUNTIME CHECK** | Paths OK. |
| getDiscussions / createDiscussion | `/community/discussions` | **NEEDS RUNTIME CHECK** | Paths OK (POST handler = `PostDiscussion`). |
| reportContent | POST `/moderation/report` | **NEEDS RUNTIME CHECK** | Path OK. |
| getNotifications / markNotificationRead / markAllNotificationsRead | `/notifications*` | **BLOCKED** | No notifications routes in `live` or any surveyed package. Inline TODO added to `getNotifications`; mock stays default. |
| getAnnouncements | GET `/announcements` | **BLOCKED** | No route found. Inline TODO added; mock stays default. |

## T — Tutor & School (`api.ts`)
| Fn | Method+Path | Status | Note |
|----|-------------|--------|------|
| getTutorMe | GET `/tutor/me` | **NEEDS RUNTIME CHECK** | Path OK. |
| onboardTutor | POST `/tutor/onboard` | **NEEDS RUNTIME CHECK** | Path OK; confirm body/response. |
| getTutors | GET `/tutors` | **NEEDS RUNTIME CHECK** | Path OK. |
| getCohorts | GET `/tutor/cohorts` | **BLOCKED** | No such route. Inline TODO added; mock stays default. |
| getAssignments | GET `/tutor/assignments` | **BLOCKED** | Only `POST /tutor/assignments` — no GET list. Inline TODO added; mock stays default. |
| createAssignment | POST `/tutor/assignments` | **NEEDS RUNTIME CHECK** | Path OK. |
| getSubmissions | GET `/tutor/submissions` | **BLOCKED** | No such route found. Inline TODO added; mock stays default. |
| gradeSubmission | POST `/tutor/grades` | **NEEDS RUNTIME CHECK** | Path OK. |
| getTutorEarnings | GET `/tutor/earnings` | **NEEDS RUNTIME CHECK** | Path OK. |
| requestPayout | POST `/tutor/payouts` | **NEEDS RUNTIME CHECK** | Path OK; money path. |
| getMySchools | GET `/schools/mine` | **NEEDS RUNTIME CHECK** | Path OK (schools group). |
| getSchoolOverview | GET `/schools/:id/overview` | **NEEDS RUNTIME CHECK** | Path OK. |

## E — ECCE (`api.ts`)
| Fn | Status | Note |
|----|--------|------|
| getEcceHome | **MOCK-ONLY (by design)** | No live branch; intentionally mock (play surface). No action. |

---

## Fees module (`fees/api.ts`) — already wired + annotated by sibling; VERIFIED against handlers
Base `/api/finance/academy`. This file already: unwraps `{data}`, maps `amountKobo→amountMinor`
(1:1), sends `Idempotency-Key` on money paths, and annotates every no-route case. Confirmed
against `backend/internal/academy/fees/*/handler.go`:

| Fn | Method+Path | Status |
|----|-------------|--------|
| getInvoice | GET `/invoices/:id` | **VERIFIED** (route exists, `{data}` unwrapped). |
| payInvoice | POST `/invoices/:id/payments` `{amountMinor}` +Idem | **VERIFIED** (route + body correct). |
| getVaults | GET `/vaults` | **VERIFIED**. |
| createVault | POST `/vaults` | **VERIFIED**. |
| fundVault | POST `/vaults/:id/contribute` `{amountMinor}` +Idem | **VERIFIED**. |
| submitHardship | POST `/hardship` | **VERIFIED**. |
| getDirectory | GET `/schools` (ListMine) | **VERIFIED (semantic caveat)** — returns caller's own schools, not a public directory; `q` ignored server-side. |
| getChildren / getInvoices / getInstallmentPlan / linkChild / createInstallmentPlan / acceptInstallmentDisclosure / payInstallment / getReceipts / updateAutoSave / getHardshipRequests / getSponsorships / pledgeSponsorship | (various) | **BLOCKED (annotated)** — no matching member route or shape differs (installments are payment intents `POST /payments/installment`, not a fetchable plan; hardship list is admin-only; sponsorship is 2-step pledge/fund; etc.). Kept on mock intentionally. |
| getCompetitionProfile / getLeaderboard / getTournaments / joinTournament / getChallenges / playChallenge / getBadges / getCompetitionRewards / redeemCompetitionReward / setCompetitionConsent | `/competition/*` | **BLOCKED (annotated)** — the only real competition member route is `GET /competitions/:id/leaderboard` (keyed by competition id, richer shape than the scope-only mobile call). Everything else has no member route. Kept on mock. |

---

## Recommended flip order (safest first)
1. **Fees reads/writes already VERIFIED** — can flip `EXPO_PUBLIC_ACADEMY_FEES_USE_MOCK`
   for the invoice/vault/hardship surfaces after one runtime smoke test; leave the
   `TODO(no backend route)` competition/sponsorship surfaces on mock.
2. **Gamification + Rewards** (mappers added) — flip after a runtime check confirms the
   `{data}`/snake_case shapes; expect missing `earned/progress/name` until server projections land.
3. Everything marked **BLOCKED** needs a backend route or a product decision on the
   response aggregate (esp. identity `Me`, exam attempts/results, commerce order shape,
   wallet endpoint) before the corresponding screens can go live. Do NOT flip the main
   `EXPO_PUBLIC_ACADEMY_USE_MOCK` module-wide.

## Constraints honored
TypeScript/mobile only. No backend Go, migrations, or OpenAPI files changed. Mappers are
additive; mocks and the `USE_MOCK` defaults are untouched (both remain `true`).
</content>
</invoke>
