# Data Model

Key entities and relationships. Treat curriculum, exams, and rewards config as **versioned data**.

## Identity & people
- `User` — the Paymax identity (do not duplicate auth). KYC tier on the identity.
- `Profile` — per-role profile (learner: class/stream/trade; parent; tutor).
- `Role` — additive capability on a User.
- `GuardianLink` — `guardianUserId ↔ minorUserId`, `consentRecordId`, status.
- `ConsentRecord` — immutable consent for minors (scope, ts, actor).

## Curriculum (versioned)
- `CurriculumVersion` — e.g. `NERDC-2025`, `LEGACY`; effectiveDate, status.
- `Phase` — ECCE | LowerPrimary | UpperPrimary | JSS | SSS.
- `Class` — P1…P6, JSS1…JSS3, SSS1…SSS3 (+ ECCE).
- `Subject` — within a version+phase; flags: core/elective/optional.
- `Stream` — Science | Humanities | Commercial (SSS).
- `TradeTrack` — solar | fashion | gsm | agric | beauty | … (JSS→SSS).
- `Topic` → `LearningObjective` — the granular learning units.
- `CurriculumMapping` — subject/topic ↔ class ↔ version; exam-relevance tags.

## Content
- `Lesson` — belongs to Topic; type: video | interactive | reading; curriculumVersion.
- `MediaAsset` — variants (bitrates, audio-only, transcript) for low-data.
- `ContentBundle` — offline package: set of lessons/assets; sizeBudget; accessCardMapping.
- Publish workflow state on Lesson/Bundle: `draft→review→approved→live→archived`.

## Assessment & exams
- `QuestionItem` — type, stem, options, answer, difficulty, discrimination, tags(topic/objective).
- `PastQuestion` — QuestionItem linked to exam+year.
- `AssessmentTemplate` — quiz/mastery-check definition.
- `ExamArena` — CCE | BECE | WASSCE | NECO | UTME | NABTEB; calendar, countdown, scoringRules.
- `CBTBlueprint` — structure of a mock (sections, counts, timing, subject set).
- `SubjectCombinationRule` — UTME course → required subject set + admission guidance.
- `Attempt` → `Response` — immutable; serverTiming; score; integritySignals.
- `MasteryRecord` — per user+objective: state + score history.
- `ProgressEvent` — emitted on transitions; source for rewards/analytics.

## Gamification & rewards
- `GamificationProfile` — XP, level, streak, freezes.
- `Badge`, `Challenge` (incl. sponsor-branded), `Leaderboard` (scope, resetPolicy).
- `RewardPool` — funded balance, sponsor/campaign, caps, conversionRate.
- `RewardLedgerEntry` — immutable credits/redemptions/reversals (see conventions).
- `RedemptionCatalogItem`, `Redemption` — points→wallet/airtime/data/voucher.

## Commerce & EduPay
- `Plan`, `Subscription`, `Entitlement`.
- `Order`, `BNPLPlan` (on BNPL rail), `ExamBundle`, `AccessCard` (issued/activated).
- `EduPayAccount`, `FeeSchedule`, `SavingsPot`, `Disbursement`, `Scholarship`.

## Partnerships & institutions
- `Sponsor`, `Campaign` — funds pools/scholarships/challenges; reporting.
- `School`, `ClassGroup`, `Enrollment`, `Licence` (Phase 4, B2B2C).
- `Tutor`, `LiveSession` (Phase 4 + live).

## Credentials & earning bridge
- `Credential` — academic/trade; signed, verifiable, revocable; verificationId.
- `EarningOpportunity` — Paymax role unlocked by credential(s); eligibilityRules.

## Cross-cutting
- `Notification`, `Ticket`, `AuditLog` (immutable), `FeatureFlag`, `Experiment`.

### Relationship notes
- `User 1—* Profile`, `User 1—* Role`, `User *—* User` via `GuardianLink`.
- `CurriculumVersion 1—* Class 1—* Subject 1—* Topic 1—* LearningObjective`.
- `LearningObjective 1—* Lesson`, `1—* QuestionItem` (by tag).
- `ExamArena 1—* CBTBlueprint`, `1—* PastQuestion`.
- `RewardPool 1—* RewardLedgerEntry`; balances derived by summation.
- `Credential *—* EarningOpportunity` via eligibility evaluation.
