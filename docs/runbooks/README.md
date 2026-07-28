# Runbooks

> Operational procedures for the Paymax × Spotlight super app. All steps here are
> **human-executed**. Nothing in this directory runs `supabase db push` to cloud,
> flips a `FEATURE_*` flag, deploys, or installs live secrets on its own.

| Runbook | When to use |
|---|---|
| [`go-live.md`](go-live.md) | Taking a (money-path) change to production — the exact ordered checklist: secrets matrix, `supabase link` + `db push`, deploy, smoke, gated flag flip. |
| [`feature-flag-disable.md`](feature-flag-disable.md) | Kill switch — disable a module instantly during an incident. Primary mitigation. |
| [`incident-rollback.md`](incident-rollback.md) | Something is on fire — triage, mitigate (flag first), code rollback, why there is no DB rollback. |

Related ops docs:
- CI gates: [`../ops/CI_GATES.md`](../ops/CI_GATES.md)
- Env-var matrix: [`../ops/ENV_MATRIX.md`](../ops/ENV_MATRIX.md)
- Secrets & least-privilege: [`../ops/SECRETS_MANAGEMENT.md`](../ops/SECRETS_MANAGEMENT.md)
- Observability (dashboards + alerts): [`../observability/README.md`](../observability/README.md)

## Quick reference — money incident

1. `feature-flag-disable.md` → disable the affected money flag(s). Restart process.
2. Open incident, assign commander, start timeline.
3. `incident-rollback.md` → if caused by a deploy, redeploy last green commit.
4. Confirm ledger invariant balanced before re-enabling anything.
