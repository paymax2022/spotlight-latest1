# Spotlight — Background Jobs & Scheduled Tasks
> Audit date: 2026-06-13

---

## Current State: No Formal Job Scheduler

No background job worker, queue processor, or cron framework was found in the backend (`backend/cmd/`, `backend/internal/`). The Go/Gin backend handles only synchronous HTTP requests.

---

## Existing Async / Fire-and-Forget Patterns

| Operation | File | Pattern | Risk |
|---|---|---|---|
| Vote receipt email | `frontend-web/src/server/voting/paid-vote.service.ts:346` | `sendVoteReceiptEmail()` called with no await after vote credited | Silent failures; email may not send; no retry |
| Fraud auto-flagging | `supabase/migrations/20260404250000_fraud_detection.sql` | Synchronous within RPC `run_fraud_checks()` | Blocks vote insert path; slow fraud checks = slow voting |
| `vote_totals` increment | `frontend-web/src/server/voting/free-vote.service.ts` | Called after vote insert but not in same transaction | If caller crashes between steps, totals diverge from votes |

---

## Missing Jobs (Required for Correctness & Compliance)

### Critical — System Correctness

| Job | Frequency | Purpose | Risk if Missing |
|---|---|---|---|
| **vote_totals reconciliation** | Hourly | Compare SUM(votes) per contestant vs. vote_totals; auto-heal divergence | Silent leaderboard errors; contestants with wrong rank |
| **Free vote reset** | Daily at `voting_settings.free_vote_reset_time` (DEFAULT 00:00 UTC) | Clear voter_daily_limits for new day | Voters unable to cast daily free votes after midnight |
| **Leaderboard rank recompute** | On vote insert (or every 5 min) | Call recompute_leaderboard_ranks() | Stale ranks; wrong position shown |
| **Webhook retry / dead-letter processor** | Continuous | Re-process failed Paystack webhooks from DLQ | Paid votes paid but never credited |
| **Pending vote_transactions cleanup** | Hourly | Mark abandoned transactions older than 1h as status='abandoned' | Pending transactions pile up; payment status reports wrong |

### High — Business Operations

| Job | Frequency | Purpose |
|---|---|---|
| **Academy installment reminders** | Daily | Email trainees with due/overdue payments (reminder_sent_at, reminder_count) |
| **Overdue installment detection** | Daily | UPDATE academy_installment_payments SET status='overdue' WHERE due_date < now() AND status='pending' |
| **Installment plan completion check** | On payment | Trigger already exists (check_installment_plan_completion) — but only fires on payment; no sweep for edge cases |
| **Fraud review SLA alerts** | Every 4h | Alert compliance if fraud_flags.status='open' older than configurable SLA |
| **Expired user_roles cleanup** | Daily | Set is_active=false WHERE expires_at < now() |
| **Expired maker_checker_requests** | Hourly | Expire pending requests past expires_at |

### Required for Fintech PRD

| Job | Frequency | Purpose | PRD Reference |
|---|---|---|---|
| **Daily reconciliation vs. provider** | Daily T+1 | Compare Paystack settlement report vs. internal credits | PRD §8 (launch blocker) |
| **Continuous ledger invariant check** | Every 15 min | Assert SUM(debit entries) = SUM(credit entries) per account; alert on drift | PRD §8, §EPIC 1 AC5 |
| **KYC document expiry** | Weekly | Detect expired government IDs; trigger re-verification request | PRD §EPIC 4 |
| **Reward expiry sweep** | Daily | Mark unclaimed rewards as EXPIRED; sweep back REWARD_LIABILITY | PRD §EPIC 6 AC4 |
| **Wallet balance invariant** | Every 5 min | Balance derived from ledger sum != stored balance → P0 alert | PRD §EPIC 1 AC5 |
| **VA reconciliation** | Continuous + T+1 batch | Provider settlement report vs. internal credits | PRD §EPIC 2 AC5 |
| **STR / CTR generation** | Daily | Flag transactions for regulatory reporting | PRD §8 [LEGAL REVIEW] |
| **Session expiry cleanup** | Daily | Purge expired auth_sessions rows | auth_sessions table |

---

## Implementation Gaps

1. **No job runtime** — Go backend has no scheduler. Options: pg_cron (Supabase native), external cron (GitHub Actions, Railway, Render), or add a job worker goroutine with a tick loop.

2. **No outbox table** — Cross-module side effects (notifications, analytics, reward qualification) are direct calls or fire-and-forget. The PRD requires a transactional outbox before fintech modules go live.

3. **No DLQ** — Failed webhook deliveries have no retry mechanism. The webhook ingestor must persist raw events before processing and implement retry-with-backoff.

4. **Email delivery** — Uses Resend API (`RESEND_API_KEY` in env). No queue, no retry, no delivery status tracking.

---

## Recommended Implementation Order

```
Phase 0 (before any fintech):
  1. pg_cron: daily free-vote reset + weekly role expiry sweep
  2. Outbox table + processor (transactional side effects)

Phase 1 (with wallet/VA):
  3. Webhook raw-persist + retry processor
  4. Ledger invariant checker (15-min cron → alert on drift)
  5. Daily Paystack reconciliation job

Phase 2 (with withdrawals):
  6. Pending tx cleanup
  7. Fraud review SLA alerter
  8. KYC expiry scanner

Phase 3:
  9. STR/CTR generation
  10. Reward expiry sweep
```
