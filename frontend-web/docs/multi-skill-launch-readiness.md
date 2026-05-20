# Multi-Skill Competition Launch Readiness

## Objective
Ship the multi-skill competition extension safely while preserving current Spotlight production flows.

## Required Migrations
Apply, in order:
1. `20260411110000_multi_skill_categories.sql`
2. `20260411113000_user_skill_profiles.sql`
3. `20260411120000_competition_category_linking.sql`
4. `20260411123000_dynamic_submission_fields.sql`
5. `20260411130000_winners_prizes_pipeline.sql`
6. `20260411133000_sponsor_reporting.sql`

## Environment Readiness
- Supabase keys configured.
- Paystack keys configured.
- Mailgun keys configured.
- Storage bucket/policies validated for multi-media uploads.

## Configuration Readiness
At least one pilot competition must include:
- category mappings
- active registration/submission windows
- judging criteria template
- vote settings
- moderation policy
- prize structure
- category-specific onboarding questions/template rules

## Functional Smoke Checklist
1. User can create multiple skill profiles.
2. User can enroll using a selected skill profile.
3. User can save draft submission with category-specific fields.
4. User can submit before deadline and receives lifecycle status update.
5. Moderator action updates status and writes moderation log.
6. Judge can score assigned entry and finalize score.
7. Entry can be published to gallery and appears on leaderboard.
8. Free and paid votes both apply and update ranking.
9. Winner publication updates winner page and winner records.
10. Talent pipeline tagging works for finalist/winner handoff.

## Security + Integrity Checks
1. Non-admin cannot access admin category/competition routes.
2. Non-moderator cannot trigger moderation actions.
3. Non-judge cannot score entries.
4. Rate limiting returns `429` for abuse scenarios.
5. Fraud checks log suspicious vote behavior.

## Rollback Triggers
- elevated 5xx rates on enrollment/submission/vote endpoints
- payment verification mismatch spikes
- severe leaderboard inconsistency
- widespread false-positive fraud blocking

## Monitoring (First 24h)
- Enrollment conversion by category.
- Submission success/failure rates.
- Moderation turnaround time.
- Judge completion rate.
- Vote volume and paid vote revenue.
- Fraud flag volume and invalidation counts.
- Sponsor impression events.

## Release Gate
- `npm run verify` passes.
- Unit + smoke tests pass.
- Manual mobile checks pass for join/submit/gallery/vote paths.
- Ops sign-off from product, engineering, and moderation leads.
