# Metrics contract

> The alert rules and dashboard in this directory are inert until the
> application emits these series. This file is the contract module teams
> implement. Names follow Prometheus conventions (snake_case, base unit, `_total`
> for counters). If you adopt OpenTelemetry, keep the same names/labels.

## HTTP (all surfaces)

```
http_requests_total{service, route, method, status}        # counter
http_request_duration_seconds_bucket{service, route, le}   # histogram
```

`route` MUST be the templated path (`/api/v1/wallet/:id`), never the raw URL, to
keep cardinality bounded.

## Authorization / security

```
authz_denied_total{service, route, permission, reason}     # counter — RBAC RequirePermission denials + 401/403
security_events_total{service, type, severity}             # counter — Go backend security_event emissions
auth_login_failed_total{service, reason}                   # counter
```

## Money path

Emit for routes under wallet / transfers / ledger / virtual-accounts /
vote-bridge / payouts:

```
money_path_requests_total{service, route, status, result}  # result: ok|error
money_path_errors_total{service, route, error_kind}        # counter
```

## Webhooks (Paystack and any future provider)

```
webhook_received_total{provider, event_type}               # counter
webhook_failed_total{provider, event_type, stage}          # stage: verify|persist|process
webhook_dlq_depth{provider}                                 # gauge — pending/dead-letter rows
```

## Ledger invariants (emitted by the invariant-check job — see jobs audit)

```
ledger_balanced{account_class}                             # gauge: 1 balanced, 0 drift
wallet_balance_matches_ledger{}                            # gauge: 1 match, 0 drift
reconciliation_unmatched_total{provider}                   # gauge — provider vs internal unmatched count
```

## Labels to NEVER use

No `user_id`, `email`, `phone`, `bvn`, `pan`, `idempotency_key`, or raw amounts
as metric labels — high cardinality and PII/PCI leakage. Aggregate counts only.
