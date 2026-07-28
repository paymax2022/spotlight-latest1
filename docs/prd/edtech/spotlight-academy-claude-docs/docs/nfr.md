# Non-Functional Requirements

## Performance
- First meaningful content < 3s on mid-tier Android over 3G; lesson start < 2s from cache.
- CBT simulator interaction latency imperceptible; navigator instant.

## Offline (first-class, not a fallback)
- Lesson playback, practice, and CBT mocks fully usable offline via `ContentBundle`s.
- Progress, attempts, reward-eligible events **queue locally** and reconcile on reconnect.
- Conflict resolution: server-authoritative for scoring/timing/money; last-writer-wins only for
  non-critical UI state. Sync is deterministic and idempotent.

## Low-data
- Adaptive bitrate; audio-only + transcript fallbacks; compressed asset variants.
- Per-bundle **data budgets** surfaced to the user; wifi-only download option (Z4).

## Security & privacy (NDPR)
- Encryption in transit and at rest; tiered KYC; least-privilege RBAC; full audit.
- Data export/delete (Z8); explicit consent records; minimal data collection.

## Child safety
- Guardian consent required for minors; age-appropriate content gating.
- Moderated community; **no open DMs for minors**; parent controls (P5).
- Report/flag → moderation queue (Z11); escalation paths.

## Exam integrity
- Server-authoritative timing; immutable attempts; anti-cheat signals logged.

## Scalability & reliability
- Handle seasonal exam-period spikes; graceful degradation; 99.9% target on core learning paths.

## Accessibility & devices
- Low-end Android first; captions/transcripts; scalable text; English + Nigerian languages.

## Observability
- Structured logs, metrics, traces. Learning events instrumented for analytics.

## Analytics event taxonomy
Emit at each meaningful transition; every event carries `curriculumVersion, class, subject,
offlineOrigin` for cohorting.

| Stage | Events |
|---|---|
| Acquisition | `install`, `tv_code_entered`, `referral_signup` |
| Activation | `onboarding_completed`, `diagnostic_completed`, `first_lesson` |
| Engagement | `lesson_started/completed`, `practice_completed`, `streak_extended`, `challenge_completed` |
| Outcomes | `mastery_gained`, `mock_completed`, `readiness_updated` |
| Monetisation | `plan_viewed`, `checkout_started`, `bnpl_started`, `bundle_purchased`, `edupay_paid` |
| Rewards | `reward_earned`, `reward_redeemed` |
| Earning bridge | `credential_issued`, `opportunity_viewed`, `opportunity_applied` |
