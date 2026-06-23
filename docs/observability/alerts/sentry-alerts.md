# Sentry alert rules (for teams running Sentry-only at MVP)

> The repo already ships `@sentry/nextjs` (`frontend-web/src/lib/sentry.ts`).
> If you are not yet running a Prometheus/Grafana stack, encode the same
> symptom-based alerts in Sentry. These are the equivalents of
> `money-path.rules.yml`. Configure under Sentry → Alerts → Create Alert Rule.
> Keep them as **code** by exporting via the Sentry API / Terraform
> `sentry_metric_alert` once defined; this file is the source of intent.

## Prerequisites in app code

Tag money-path and security errors so Sentry can filter them:

```ts
Sentry.captureException(err, {
  tags: { surface: 'money-path', route: '/api/v1/wallet/debit' },
});
// security:
Sentry.captureMessage('authz_denied', {
  level: 'warning',
  tags: { surface: 'security', kind: 'permission_denied' },
});
```

## Alert rules

### 1. Money-path error spike (page)
- Type: Metric alert on `event.count`
- Filter: `tags[surface]:money-path level:error`
- Condition: count > 20 in 5 minutes (tune to baseline)
- Action: PagerDuty/Opsgenie → finance-ops on-call
- Runbook: `docs/runbooks/feature-flag-disable.md`

### 2. Security-event spike (page)
- Type: Metric alert
- Filter: `tags[surface]:security`
- Condition: count > 50 in 5 minutes
- Action: page security on-call
- Runbook: `docs/runbooks/incident-rollback.md`

### 3. Permission-denied surge (warn → page)
- Filter: `tags[kind]:permission_denied`
- Warn: > 30 in 10m; Page: > 100 in 10m
- Runbook: `docs/runbooks/incident-rollback.md`

### 4. Webhook processing failures (page)
- Filter: `tags[surface]:webhook level:error`
- Condition: count > 5 in 10 minutes
- Runbook: `docs/runbooks/incident-rollback.md`

### 5. New money-path issue (page on first seen)
- Type: Issue alert
- Condition: a NEW issue is first seen AND `tags[surface]:money-path`
- Action: page immediately — a brand-new money-path error class is high risk.
- Runbook: `docs/runbooks/incident-rollback.md`

## Notes
- Sentry cannot assert ledger invariants (debit=credit). That alert MUST come
  from the ledger-invariant job emitting a metric / hard alert, not from Sentry.
  Until that job ships, `LedgerInvariantDrift` is covered only by the Prometheus
  rule, which is itself inert without the job. Do not treat Sentry as a
  substitute for the invariant checker before money GA.
