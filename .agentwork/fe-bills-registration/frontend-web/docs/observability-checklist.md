# Observability Checklist

## Error Tracking
- Add Sentry or an equivalent error aggregator for client and server exceptions.
- Tag events with route, environment, release version, and authenticated user ID when available.
- Capture API errors from payment confirmation, academy apply, uploads, and vote casting first.

## Structured Logging
- Emit structured JSON logs for:
  - payment confirmation attempts
  - academy application submission failures
  - upload validation failures
  - fraud review actions
  - admin mutations
- Avoid logging secrets, access tokens, raw payment payloads, or full PII blobs.

## Metrics
- Track request volume and error rate for:
  - `/api/auth/registration/payment/confirm`
  - `/api/academy/apply`
  - `/api/academy/payment/confirm`
  - `/api/academy/upload`
  - `/api/vote/free`
  - `/api/vote/paid`
  - `/api/vote/referral`
- Track payment success rate, academy conversion rate, and vote purchase conversion.

## Alerts
- Alert on any sustained 5xx rate above baseline.
- Alert on payment confirmation failures above baseline.
- Alert on sudden spikes in fraud scores, rate-limit rejections, or storage upload failures.

## Dashboards
- Create a launch dashboard covering auth, payments, academy applications, voting, and admin errors.
- Add a release dashboard for the first 24 hours after every production deploy.
