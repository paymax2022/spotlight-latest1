# One-Beat One-Verse Launch Readiness

## Goal
Provide a single operational checklist for shipping the One-Beat One-Verse competition safely to production.

## Pre-Release Gates
1. CI green on `main` (`type-check`, `lint`, `test`, `build`).
2. Supabase migrations applied through:
   - `20260410190000_one_beat_one_verse_foundation.sql`
   - `20260410193000_music_entry_submission.sql`
   - `20260410195500_music_moderation.sql`
   - `20260410202500_music_entry_ranking_fields.sql`
   - `20260410205500_music_voting_engine.sql`
   - `20260410213000_music_reporting_and_winners.sql`
   - `20260410221000_music_judging.sql`
   - `20260410233000_music_growth_features.sql`
3. Required environment variables are present in target environment:
   - Supabase keys
   - Paystack keys
   - Resend keys (`RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`)
4. At least one competition is configured with:
   - `contest_type = one_beat_one_verse`
   - registration and submission windows
   - active beat records
   - judging criteria and assignments

## Functional Smoke Checklist
1. Public landing page loads and CTA routes to `/competitions/[slug]/join`.
2. Authenticated user can enroll and receives `email_notification_sent` result.
3. Enrolled user can create draft entry and submit successfully.
4. Submission response includes `email_notification_sent` metadata.
5. Admin moderation action updates entry status and logs moderation record.
6. Moderation response includes `email_notification_sent` metadata.
7. `mark_live` entry appears in public gallery and leaderboard.
8. Free vote and paid vote both update leaderboard score.
9. Admin can publish winner and view result in winner records.
10. Admin reports endpoint and votes CSV export both return data.

## Security and Integrity Checks
1. Non-admin users cannot access admin music APIs.
2. Judge routes reject users without `judge` or `admin` role.
3. Fraud review page filters correctly by competition.
4. Vote routes log fraud signals and block high-risk requests.
5. Rate limiting returns `429` under repeated abuse patterns.

## Rollback Triggers
- sustained `5xx` on music submission/moderation routes
- severe fraud false positives blocking legitimate voting
- payment verification failures on paid votes
- persistent Resend failures above agreed threshold

## Post-Launch Monitoring (first 24h)
1. Error rates for:
   - `/api/competitions/[id]/enroll`
   - `/api/entries/[id]/submit`
   - `/api/moderation/entries/[id]/action`
   - `/api/vote/free`
   - `/api/vote/paid`
2. Resend delivery outcomes for music lifecycle emails.
3. Fraud flag volume and admin review turnaround.
4. Leaderboard consistency between votes and computed scores.
