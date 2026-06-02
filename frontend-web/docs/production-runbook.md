# Production Runbook

## Environments
- `local`: developer workstation using `.env`
- `staging`: pre-production verification environment with production-like Supabase and Paystack test keys
- `production`: customer-facing environment with locked secrets and audited deploys

## Required Environment Variables
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`
- `PAYSTACK_SECRET_KEY`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO`

Important:
- Film Academy payment confirmation depends on the RPC introduced in
  [20260407135234_confirm_academy_payment_rpc.sql](/Users/paymax/Desktop/wordpress/spotlight website/spotlight/supabase/migrations/20260407135234_confirm_academy_payment_rpc.sql).
- If that migration is missing, the app falls back to service-role confirmation and therefore requires `SUPABASE_SERVICE_ROLE_KEY`.

## Deployment Checklist
1. Confirm `npm run type-check`, `npm run lint`, and `npm run build` pass locally or in CI.
2. Review Supabase migrations to ensure the target environment is on the expected schema revision.
   - Confirm [20260407135234_confirm_academy_payment_rpc.sql](/Users/paymax/Desktop/wordpress/spotlight website/spotlight/supabase/migrations/20260407135234_confirm_academy_payment_rpc.sql) is applied before testing Film Academy payments.
3. Verify Paystack public and secret keys match the target environment.
4. Confirm `NEXT_PUBLIC_SITE_URL` points to the deployed hostname.
5. Deploy application code.
6. Run focused smoke tests:
   - signup with payment
   - film academy application with payment
   - paid vote checkout and confirmation
   - admin login and applicant status update
   - music competition enrollment and enrollment email signal
   - music entry submit flow and submission email signal
   - moderation approve/reject/correction and moderation email signal
   - music leaderboard and gallery visibility after moderation `mark_live`
   - winner publish path from `/admin/competitions/music/[id]/winners`
7. Review logs for 5xx spikes, auth errors, and payment confirmation failures.
8. Review email delivery logs for Resend failure ratio on the new music lifecycle notifications.

## Rollback Checklist
1. Re-deploy the previous known-good application build.
2. Revert any migration that is not backward-compatible only if data-impact has been assessed.
3. Re-run payment and academy submission smoke tests.
4. Notify operators if user-facing payment failures occurred.

## Incident Response Priorities
- Payment failure: verify Paystack status, confirmation route logs, and Supabase updates.
- Auth failure: verify Supabase env vars, cookie propagation, and middleware behavior.
- Upload failure: verify storage bucket policies and academy application ownership checks.
- Voting failure: verify fraud checks, vote pack availability, and payment verification.
- Music competition lifecycle failure: verify competition windows, moderation state transitions, and Resend notification logs.
