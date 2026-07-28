# Exam Arenas & CBT Engine

The crown: each national exam is a self-contained, gamified arena. Highest-intent, most monetisable
surface and the primary acquisition hook (Phase 1).

## Arenas
`CCE` (Common Entrance, P6→JSS1) · `BECE` (JSS3) · `WASSCE` (WAEC, SSS3) · `NECO` (SSS3) ·
`UTME` (JAMB, tertiary) · `NABTEB` (Phase 4, optional).

Each `ExamArena` carries: subject set, `CBTBlueprint`s, scoringRules, calendar, countdown,
readiness model. **Verify each body's current format before each exam season** (CBT rules change).

## CBTBlueprint
Defines a mock: sections, subjects, item counts, per-section timing, navigation rules, tools
allowed (calculator/none), shuffle policy. Full mock, single-subject, and timed-drill variants.

## CBT simulator (screen X7)
- **Server-authoritative timer.** Client renders countdown but the server clock is truth;
  offline attempts reconcile on sync.
- Question navigator + flag-for-review; resume on disconnect per blueprint pause policy.
- **Attempt + responses immutable** once submitted (integrity); submit is **idempotent**.
- Anti-cheat signals captured (focus loss, timing anomalies, response patterns) → logged, not
  auto-punitive; surfaced to moderation/analytics.
- Offline-capable: bundled items, local capture, deterministic upload.

## Scoring & readiness
- Scoring per `scoringRules` (e.g., UTME 400-scale; WASSCE/NECO grade bands).
- **Readiness score** = coverage × mastery × mock-performance, per subject and overall.
- **Predicted score** from attempt history (transparent, not a black box).
- Weakness heatmap by topic feeds adaptive practice recommendations.

## UTME subject combinations (X3)
`SubjectCombinationRule` maps intended **course → required subject set + admission guidance**.
Drives subject selection and the readiness model. Keep as editable data.

## Monetisation hooks (see commerce + rewards)
- Premium `ExamBundle`s per arena (seasonal).
- BNPL-financeable; agent **AccessCard** unlock for the unbanked/low-data.
- Milestone **rewards** (sponsor-funded) on readiness/streak — never balance-sheet funded.
