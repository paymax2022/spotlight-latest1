# Incident Response Runbook — Paymax × Spotlight Super App

**Last updated:** 2026-06-23  
**Owner:** Platform Engineering  

---

## 1. Severity Levels

| Level | Name | Definition | Initial Response | Resolution Target |
|-------|------|------------|-----------------|-------------------|
| **P0** | Critical | Complete service outage or data loss / financial integrity breach | Immediate page — on-call + engineering lead | 1 hour |
| **P1** | High | Core money path degraded (wallet mutations failing, Paystack webhook down), authentication broken for all users | Page on-call within 5 min | 4 hours |
| **P2** | Medium | Feature degraded for a subset of users, non-critical API errors > 5 %, third-party service failures (telemedicine, transport) | Alert on-call within 30 min | 24 hours |
| **P3** | Low | Minor UI bugs, non-blocking errors, single-user reports | Ticket — next business day | 1 week |

---

## 2. On-Call Rotation

> **TODO:** Replace placeholders with real contacts once the on-call schedule is configured in PagerDuty / OpsGenie.

| Role | Name | Primary Contact | Escalation |
|------|------|----------------|-----------|
| Engineering On-Call | _TBD_ | +234-xxx-xxxx | Engineering Lead |
| Finance On-Call | _TBD_ | +234-xxx-xxxx | CFO |
| Security On-Call | _TBD_ | +234-xxx-xxxx | CISO / Engineering Lead |
| Database On-Call | _TBD_ | +234-xxx-xxxx | Engineering Lead |

---

## 3. Common Incidents & Playbooks

---

### AUTH-001 — Session Breach / Suspicious Logins

**Indicators:**
- Spike in `security_events` table with `event_type = 'suspicious_login'`
- Multiple failed auth attempts from a single IP
- User reports unauthorised access

**Severity:** P0 (if widespread) / P1 (isolated accounts)

**Response steps:**

1. **Identify scope** — Query `security_events` to count affected users:
   ```sql
   SELECT user_id, COUNT(*) AS hits, MAX(created_at) AS latest
   FROM security_events
   WHERE event_type IN ('suspicious_login', 'failed_auth')
     AND created_at > NOW() - INTERVAL '1 hour'
   GROUP BY user_id
   ORDER BY hits DESC
   LIMIT 50;
   ```

2. **Revoke sessions** — Via Supabase Admin API (`service_role` key required):
   ```bash
   # Revoke all sessions for a specific user
   curl -X DELETE "https://<project>.supabase.co/auth/v1/admin/users/<user_id>/sessions" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
   ```

3. **Force password reset** — Send password-reset email via Supabase:
   ```bash
   curl -X POST "https://<project>.supabase.co/auth/v1/admin/generate_link" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"type":"recovery","email":"<user_email>"}'
   ```

4. **Block IP** — Add to Cloudflare firewall rules if a specific IP is attacking.

5. **Audit trail** — Confirm `audit_events` records are written for all revocations.

6. **Notify affected users** — Send breach notification email via Resend if PII exposure is confirmed.

7. **Post-incident** — File P0 post-mortem within 24 hours.

---

### MONEY-001 — Ledger Imbalance Detected

**Indicators:**
- Monitoring alert: `SELECT SUM(amount_kobo) FROM ledger_entries` ≠ 0 (double-entry must net to zero)
- Wallet balance projection does not match sum of ledger entries for a user

**Severity:** P0

**Response steps:**

1. **Halt affected wallet mutations** — Set a feature flag (`wallet_mutations_enabled = false`) to prevent further writes. If no flag exists, coordinate a hotfix deploy to return HTTP 503 for `/api/v1/wallet/topup` and `/api/v1/transfers/*`.

2. **Identify imbalanced entries:**
   ```sql
   SELECT wallet_id, SUM(amount_kobo) AS net
   FROM ledger_entries
   GROUP BY wallet_id
   HAVING SUM(amount_kobo) != 0;
   ```

3. **Trace the root cause** — Find the orphaned entry (credit without matching debit or vice versa):
   ```sql
   SELECT * FROM ledger_entries
   WHERE wallet_id = '<affected_wallet>'
   ORDER BY created_at DESC
   LIMIT 20;
   ```

4. **Issue reversing entries** — Never UPDATE or DELETE ledger rows. Insert a correcting pair:
   ```sql
   -- Example: reverse an erroneous credit of 5000 kobo
   INSERT INTO ledger_entries (id, wallet_id, amount_kobo, type, reference, idempotency_key, created_at)
   VALUES
     (gen_random_uuid(), '<wallet_id>', -5000, 'debit',  'REVERSAL-<original_id>', '<new_idempotency_key>', NOW()),
     (gen_random_uuid(), '<system_wallet_id>',  5000, 'credit', 'REVERSAL-<original_id>', '<new_idempotency_key>', NOW());
   ```

5. **Re-verify balance** — Re-run the imbalance query; expect zero result.

6. **Re-enable mutations** — Restore feature flag after verification.

7. **Notify finance team** — Slack #finance-alerts with a summary of affected wallets, amounts, and resolution.

---

### MONEY-002 — Failed Paystack Webhook

**Indicators:**
- Paystack dashboard shows events in "failed" state
- `payment_webhooks` table has records with `status = 'failed'` or missing entirely
- Users report topup not reflecting after payment

**Severity:** P1

**Response steps:**

1. **Verify HMAC signature** — Check the webhook handler in `frontend-web/app/api/webhooks/paystack/route.ts`. Confirm `PAYSTACK_SECRET_KEY` env var is set and the `X-Paystack-Signature` header is being validated via HMAC-SHA512.

2. **Check recent webhook logs:**
   ```bash
   # Search Next.js logs for webhook errors (adjust for your log aggregator)
   grep "paystack webhook" /var/log/app/nextjs.log | tail -50
   ```

3. **Replay from Paystack dashboard:**
   - Log into Paystack → Developers → Logs → find the failed event → click "Resend".
   - Verify idempotency: the handler must check for duplicate `reference` values before crediting.

4. **Verify idempotency key prevents double-credit:**
   ```sql
   SELECT reference, COUNT(*) FROM ledger_entries
   WHERE reference = '<payment_reference>'
   GROUP BY reference;
   -- Expect: 1 row (credit + debit pair counts as 2 ledger rows for one reference)
   ```

5. **If webhook cannot be replayed** — Manually credit via admin tool, ensuring idempotency key is set to the original `reference` to prevent future duplicates.

6. **Monitor** — Watch `payment_webhooks` table for 30 minutes post-replay to confirm no further failures.

---

### MONEY-003 — Wallet Topup Credited but Paystack Not Paid

**Indicators:**
- User's wallet balance increased but Paystack shows the transaction as failed or abandoned
- `ledger_entries` has a credit but no corresponding Paystack `charge.success` event

**Severity:** P0 (financial loss)

**Response steps:**

1. **Locate the payment reference:**
   ```sql
   SELECT le.*, ae.metadata
   FROM ledger_entries le
   JOIN audit_events ae ON ae.reference = le.reference
   WHERE le.wallet_id = '<wallet_id>'
     AND le.type = 'credit'
     AND le.created_at > NOW() - INTERVAL '24 hours'
   ORDER BY le.created_at DESC;
   ```

2. **Check Paystack status** — Use Paystack's verify endpoint:
   ```bash
   curl "https://api.paystack.co/transaction/verify/<reference>" \
     -H "Authorization: Bearer $PAYSTACK_SECRET_KEY"
   ```
   If `status != "success"` — the topup was applied without valid payment.

3. **Reverse the ledger entry** — Insert a reversing debit (see MONEY-001 step 4 for the pattern).

4. **Freeze the wallet temporarily** — Set `wallets.is_frozen = true` for the user until investigation completes.

5. **Log in audit_events:**
   ```sql
   INSERT INTO audit_events (id, user_id, action, reference, metadata, created_at)
   VALUES (gen_random_uuid(), '<user_id>', 'wallet_reversal_fraud_investigation',
           '<original_reference>', '{"reason":"topup_credited_without_payment"}', NOW());
   ```

6. **Notify finance team and user** — Explain the hold and timeline for resolution.

---

### DB-001 — Supabase Connection Pool Exhausted

**Indicators:**
- API returns 500 with `connection pool exhausted` in logs
- Supabase dashboard shows high connection count
- `pg_stat_activity` shows many idle connections

**Severity:** P1

**Response steps:**

1. **Check active connections:**
   ```sql
   SELECT state, COUNT(*) FROM pg_stat_activity GROUP BY state;
   ```

2. **Identify long-running or idle queries:**
   ```sql
   SELECT pid, state, query_start, now() - query_start AS duration, left(query, 100) AS query_snippet
   FROM pg_stat_activity
   WHERE state != 'idle'
   ORDER BY duration DESC
   LIMIT 20;
   ```

3. **Kill idle connections:**
   ```sql
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE state = 'idle'
     AND now() - state_change > INTERVAL '5 minutes';
   ```

4. **Scale the connection pool** — In Supabase dashboard → Database → Connection Pooling → increase pool size. For Go backend, check `backend/internal/platform/db/` pool config and reduce `MaxConns`.

5. **Investigate root cause** — Common causes: missing `defer rows.Close()`, long transactions in finance handlers, or a query loop without pagination.

6. **Monitor** — Set up a Grafana alert on `pg_stat_activity` count > 80 % of `max_connections`.

---

### API-001 — High 5xx Rate

**Indicators:**
- Grafana / uptime monitor alerts on HTTP 5xx > 5 %
- Users report "something went wrong" errors
- Go backend logs show panics or unhandled errors

**Severity:** P1 (if wallet/auth routes) / P2 (other routes)

**Response steps:**

1. **Identify the failing route(s):**
   ```bash
   # Grep Gin logs for 5xx
   grep '"status":5' /var/log/app/gin.log | jq '.path' | sort | uniq -c | sort -rn | head -20
   ```

2. **Check for recent deploy** — `git log --oneline -10` on the server. If a deploy happened in the past hour, it is likely the cause.

3. **Roll back if needed** (see Section 4 — Rollback Procedure).

4. **Check for upstream failures** — Supabase status page, Paystack status page, Redis health.

5. **Restart the Go process** if it is panicking:
   ```bash
   systemctl restart spotlight-api
   # or
   pm2 restart spotlight-api
   ```

6. **Monitor recovery** — Watch 5xx rate for 10 minutes post-action.

---

## 4. Rollback Procedure

```bash
# 1. Identify the last stable commit
git log --oneline -20

# 2. Revert the bad commit (creates a new revert commit — never force-push main)
git revert <bad-commit-sha> --no-edit

# 3. Verify the backend compiles
cd backend && go build ./...

# 4. Run static analysis
go vet ./...

# 5. Push the revert
git push origin main

# 6. Re-deploy (command depends on hosting setup)
# cPanel / Passenger (frontend):
touch frontend-web/tmp/restart.txt

# Systemd (backend):
systemctl restart spotlight-api

# 7. Confirm recovery — check health endpoint
curl -f https://api.spotlight.ng/health
```

> **DB migrations:** A revert commit will not undo a Supabase migration. If the migration caused the incident, create a new **additive** migration to undo the change (no DROP, no renames — see CLAUDE.md Iron Rules).

---

## 5. Post-Incident Template

```
## Post-Incident Report — <INCIDENT_ID>

**Date:** YYYY-MM-DD  
**Duration:** HH:MM  
**Severity:** P0 / P1 / P2  
**Author:** <name>  

### Summary
One-paragraph summary of what happened and the customer impact.

### Timeline (all times UTC)

| Time | Event |
|------|-------|
| HH:MM | Incident detected (how: alert / user report / monitoring) |
| HH:MM | On-call paged |
| HH:MM | Root cause identified |
| HH:MM | Mitigation applied |
| HH:MM | Service restored |
| HH:MM | Post-incident review completed |

### Root Cause
Detailed technical explanation of why the failure occurred.

### Impact
- Number of affected users: X
- Financial impact (kobo): X
- Data impact: none / [describe]
- SLA breach: yes / no

### Fix Applied
Steps taken to resolve the incident.

### Prevention
- [ ] Action item 1 (owner, due date)
- [ ] Action item 2 (owner, due date)
- [ ] Add monitoring / alert for this failure mode
- [ ] Add test coverage for this code path
```
