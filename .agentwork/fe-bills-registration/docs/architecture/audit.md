# Paymax × Spotlight — Architecture Audit (P1)

**Audit date:** 2026-06-16  
**Playbook:** PAYMAX_BUILD_PLAYBOOK.md v2  
**Auditor:** Orchestrator (Claude Code)

---

## 1. ADOPT / EXTEND / KEEP / CONFLICT map

| Concern | Today | Target | Decision | Notes |
|---|---|---|---|---|
| Relational DB | Supabase Postgres (65 migrations) | Same Supabase Postgres | **KEEP** | pgx pool added for money-path direct access |
| Business logic / money | Next.js API routes (`frontend-web/app/api/`) | Go backend owns all write paths + ledger | **EXTEND** | Go mirrors then supersedes Next.js financial routes; Next.js routes stay live during migration |
| Auth / identity | Supabase Auth (JWT) | Supabase Auth issues JWT; Go validates + owns PIN/KYC/device | **EXTEND** | `RequireAuthContext` middleware already in Go; PIN/device/KYC to be added |
| Go HTTP router | Gin v1.10 (`backend/`) | Chi per playbook v2 | **CONFLICT** | **Decision: KEEP Gin.** CLAUDE.md explicitly requires Gin v1.10; migrating to Chi would be churn with zero functional gain at this stage. Documented here, playbook §2.1 Chi preference overridden by project constraint. |
| Go backend modules | Competition, STEM, Reality TV, Chat, RBAC, Audit (all Supabase REST) | Add: Finance, Provider adapters, Platform primitives | **EXTEND** | New modules under `internal/platform/` and `internal/finance/` |
| File storage | Supabase Storage / Cloudflare R2 | Supabase Storage (KYC, recordings, media) | **KEEP** | R2 for open-mic, Supabase Storage for KYC docs |
| Realtime | Supabase Realtime (legacy) | Go WebSocket hub + Redis pub/sub | **ADOPT** | Non-critical presence may stay on Supabase Realtime; money/tracking moves to Go WS |
| Search | SQL `ilike` in Supabase queries | Elasticsearch via transactional outbox | **ADOPT** | ES for discovery/admin; Postgres kept for transactional queries |
| Cache / locks / queues | None | Redis (cache, Redlock, asynq, WS pub/sub, reservations) | **ADOPT** | New infra; no existing dependency to migrate |
| Mobile app | `apps/mobile-starter/` (Expo/RN) + `mobile-app/reactnative/` | Same RN apps, now call Go financial API | **EXTEND** | Voting UI done; financial screens to be added |
| Admin frontend | `frontend-admin/` (Next.js 15.1) | Full admin screen coverage per §10 | **EXTEND** | Shell exists; module screen-sets to be added per lane |
| Payments | Paystack (Next.js API routes) | Paystack via Go `PaymentProvider` adapter | **EXTEND** | Webhook handler stays in Next.js until Go webhook route is live |
| Email | Resend API (fire-and-forget in Next.js) | Notification service (asynq workers) | **EXTEND** | Move to Go notification worker; Resend stays as the transport |
| Feature flags | `frontend-web/src/lib/feature-flags.ts` (env vars) | Same env-var flags + Go-side flag checks | **EXTEND** | Each new Go module checked behind env flag |

---

## 2. What already exists in the financial stack (Next.js)

The following blocks are **done** in `frontend-web/` — they form the migration source for the Go financial core:

| Block | What exists | Go migration status |
|---|---|---|
| Block 2 | KYC schema: `kyc_tier`, `kyc_status`, `kyc_events` table | Pending Go service |
| Block 3 | Ledger schema: `ledger_accounts`, `ledger_entries`, `wallet_balance` view | Pending Go service |
| Block 4 | Wallet service: `getBalance`, `creditWallet`, `debitWallet`, `listTransactions` | Pending Go service |
| Block 5 | Virtual accounts: Paystack DVA provisioning, inbound webhook | Pending Go service |
| Block 6 | Vote bridge: idempotent bridge, KYC gate, outbox | Done — stays in Next.js (brownfield wrapper) |
| Block 7 | Tier limits: `tier_limit_events`, atomic debit RPC | Pending Go service |
| Block 8 | Referrals: `referral_codes`, `referral_events`, outbox processor | Pending Go service |
| Block 9 | Admin RBAC: maker-checker, `admin_adjustments`, finance roles | Pending Go service |
| Block 10 | Wallet-to-wallet transfer: `transfer_wallet_atomic()` RPC | Pending Go service |
| Block 11 | Wallet-to-bank transfer: `reserve_for_bank_transfer()` RPC, Paystack payout | Pending Go service |
| Block 12 | Beneficiary management: `bank_transfer_recipients` | Pending Go service |

---

## 3. New infrastructure to ADOPT

| Infrastructure | Package | Purpose |
|---|---|---|
| Redis | `github.com/redis/go-redis/v9` | Cache, sessions, rate limit, Redlock, asynq, WS fan-out |
| asynq | `github.com/hibiken/asynq` | Background jobs: webhooks, reconciliation, notifications |
| Elasticsearch | `github.com/elastic/go-elasticsearch/v8` | Discovery search, admin search; synced via outbox |
| pgx | `github.com/jackc/pgx/v5` | Direct Postgres access for money-path (transactional, no ORM) |
| WebSocket | `nhooyr.io/websocket` | WebSocket hub for real-time tracking and WS fan-out |
| JWT | `github.com/golang-jwt/jwt/v5` | Supabase JWT validation in Go (HS256) |
| argon2 | `golang.org/x/crypto` | PIN hashing |

---

## 4. Module build sequence (P2 → P3+)

```
P2 Foundation (sequential within sub-lane, sub-lanes parallel):
  ├── Platform primitives: db (pgx), redis, queue (asynq), search (ES), ws (WebSocket)
  ├── Finance core: ledger → wallet → kyc → tiers → transfers → referrals
  ├── Provider adapters: Paystack, (Maplerad future), (Agora/VideoSDK future)
  ├── Notifications: push/email/SMS via asynq
  ├── Settlement scaffold
  ├── Disputes scaffold
  ├── Ratings scaffold
  └── Admin shell: extend frontend-admin with module screen-sets

P3+ Vertical lanes (parallel after P2 gate):
  FX (Maplerad) | Groups | Events/Tickets | Estate/Voting | Crowdfunding |
  Restaurant/Delivery | Transport | Telemedicine | Spotlight integration
```

---

## 5. Protected paths (brownfield safety)

The `PreToolUse` hook enforces these — never modify:
- `frontend-web/app/api/v1/votes/` — legacy vote handler
- `frontend-web/src/server/votes/` — legacy vote service
- `supabase/migrations/` existing files — additive only
- Any file in `frontend-web/components/` not in the fintech namespace

---

## 6. Key risks

| Risk | Mitigation |
|---|---|
| Gin vs Chi divergence from playbook | Documented above; Gin stays; revisit only if a hard Chi dependency emerges |
| Two parallel financial stacks (Next.js + Go) during migration | Next.js routes stay authoritative; Go routes introduced behind flags; feature-flag cut-over per endpoint |
| pgx vs Supabase REST for money paths | pgx used only for direct transactional money operations; Supabase REST kept for read-heavy Spotlight modules |
| No Redis/ES provisioned yet | Platform primitives built with graceful degradation (Redis/ES nil → fallback to Postgres) |
