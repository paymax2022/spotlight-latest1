# Backup & Restore Runbook

**Status:** UNREHEARSED — runbook written, no restore test evidence yet ·
**Owner:** DevOps/DBA · **Scope:** the production Supabase Postgres
(project ref `nmseefdlliejmdbxytej`, `spotlight-prod`) which holds the
financial ledger — `ledger_entries`, `wallets`, `vote_transactions`,
`platform_users`.

> ⚠️ AUD-INFRA-009: until this runbook has been **executed end-to-end at
> least once against a restore target**, recovery is unverified. Supabase
> platform backups exist *per plan*, but RPO/RTO are unquantified and no
> one has ever restored this database.

---

## 1. What backs this database up today

Supabase-managed Postgres takes daily base backups; PITR/WAL archiving is a
paid-plan feature (Pro plan and above, or the PITR add-on). **Which tier the
`spotlight-prod` project is on is not recorded in this repo** — verify in
Dashboard → Project Settings → Add-ons → Point in Time Recovery.

| Capability | Free | Pro | Pro + PITR add-on |
|---|---|---|---|
| Daily backup retained | 7 days | 7 days | 7 days |
| Point-in-time restore | no | no | yes (arbitrary second, ~2 days back by default, configurable) |
| Downloadable backup | no | yes | yes |

**Action item (external):** confirm plan tier; if PITR is not enabled and
the ledger's data-loss tolerance is < 24 h, enable the PITR add-on or stand
up the scheduled dump in §3. Record the decision here.

## 2. Scheduled self-managed dump (belt & suspenders)

Supabase backups cover platform disasters, not operator error speed —
a bad migration or destructive script is best recovered from a dump you
control. The pattern (not yet scheduled — no `render.yaml` cron or GitHub
Actions job exists as of this writing):

```bash
# nightly; DATABASE_URL = direct connection string (port 5432, not the pooler)
pg_dump "$DATABASE_URL" \
  --format=custom --compress=6 --no-owner --no-privileges \
  --file="spotlight-prod-$(date -u +%Y%m%dT%H%MZ).dump"

# upload to R2 (spotlight-openmic-songs is the app's bucket — create a
# dedicated `spotlight-db-backups` bucket with no public access instead)
aws s3 cp spotlight-prod-*.dump "s3://spotlight-db-backups/daily/" \
  --endpoint-url "$R2_ENDPOINT"
```

Retention suggestion: 30 daily + 12 monthly (first-of-month) dumps.
Ledger tables are append-only and small relative to media — dumps stay cheap.

## 3. Restore procedure (dashboard backup)

1. **Freeze writes** — put the app in maintenance mode / scale workers to 0
   (`notification-worker`, crons). Restoring mid-write loses the gap between
   backup time and now.
2. Dashboard → Database → Backups → select the backup **immediately before**
   the incident → Restore.
3. Supabase restore creates a new database state; **connection strings do not
   change** but expect ~minutes of downtime.
4. Re-run pending migrations if the backup predates the current schema:
   `supabase db push` per the reconciliation runbook.
5. Verify: `SELECT count(*) FROM ledger_entries;` and balance-check a few
   wallets against `SELECT sum(amount) FROM ledger_entries GROUP BY wallet_id`.

## 4. Restore procedure (self-managed dump)

```bash
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname "$TARGET_DATABASE_URL" spotlight-prod-YYYYMMDD.dump
```

Restore to a **staging/fresh project first**, never straight to prod —
a dump restore is the rehearsal (§5), and `--clean` on prod outside a real
incident is how you create the incident.

## 5. Rehearsal checklist (the part that closes the finding)

- [ ] Provision a scratch Supabase project (or local `supabase start`).
- [ ] `pg_restore` the latest scheduled dump into it — time it (that's RTO).
- [ ] Diff schema: `supabase db diff` / `pg_dump --schema-only` both sides.
- [ ] Ledger integrity: wallet sums == ledger projection sums (§3 step 5).
- [ ] Record date, dump age, restore duration, and result **in this file**.
      That row is the "tested recovery" evidence the audit asks for.

## 6. What is NOT covered

- **R2 object storage** — app uploads are in `spotlight-openmic-songs`; R2
  has no snapshot/backup primitive. Objects lost there are gone unless
  re-uploaded. Accept or mirror per business decision.
- **Supabase Auth (GoTrue) users** — included in the Postgres dump (auth
  schema) on full dumps; verify on rehearsal.
- **Redis (idempotency keys, asynq queues)** — ephemeral by design; loss =
  in-flight jobs dropped. Idempotency-key loss mid-incident can replay a
  payment — keep `REDIS_URL` data volatile, never restore stale snapshots.
