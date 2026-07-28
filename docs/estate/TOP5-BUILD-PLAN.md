# Top-5 Expansion — Build & Integration Plan (reconciled to the existing repo)

Executes `docs/estate/BUILD-PLAN.md` under `docs/estate/CLAUDE.md` standards + NL-1…NL-12 invariants,
BROWNFIELD into the existing Paymax repo. The docs propose `/modules/<name>` + `/internal/<name>`; this
repo's convention is **`backend/internal/<module>`**, **`mobile-app/reactnative/app/<module>` +
`src/features/<module>`**, **`frontend-admin/app/admin/<module>`** — we follow the REPO convention and reuse
shared services. Mobile design = existing `src/constants/*` tokens.

## 1. Reuse map (verified on disk — DO NOT rebuild)
- **Money:** `backend/internal/finance/{ledger,wallet,settlement,tiers,kyc,va}`. Ledger is append-only
  (NL-8); every balance derived. `settlement.Escrow/Settle/Refund` is the **escrow base** to extend.
  Sub-balances (vaults, event wallet) = dedicated ledger accounts, never mutated integers. Kobo + idempotency (NL-9).
- **AuthZ + audit:** `services.RBACService` (`middleware.RequirePermission`/`RequireAuthContext`) +
  `services.audit_service` (immutable audit, NL-12) — admin shell REUSES these, does not rebuild.
- **Routes:** `Register*(member, admin, pool, rbac)` aggregator like `realtor`/`referral`/`stays`, wired in
  `app/finance_routes.go` under the module's Feature flag. Member `finance.Group("/<mod>")`; admin
  `r.Group("/api/<mod>/admin")`.
- **Frontend-web proxy:** catch-all `app/api/v1/<mod>/[...path]/route.ts` → `/api/finance/<mod>/*`, gated
  by `featureFlags.<mod>()`.
- **Mobile:** `app/<mod>/*` + `src/features/<mod>/*`; reuse `src/components/*` + `src/features/payments`
  (PaymentSheet) + design tokens; register in `src/constants/modules.ts` SERVICE_MODULES.
- **Admin:** reuse `app/admin/connect/_ui.tsx`-style kit; new service per module; `AdminSidebar.tsx` section.
- **Existing platform to reuse (CLAUDE §2):** SSO/single-identity-capabilities, KYC tiers, wallet +
  sub-balances (ledger accounts), virtual accounts, bill-pay/airtime (loyalty redemption), payouts,
  auto-debit (auto-save/subscriptions — reuse scheduler), agent network, notifications, **referral §7A**.
- **Points reference:** `backend/internal/connect/gamification` (non-cash points pattern).
- **Flags (DONE):** Go `Feature{Events,SocialPay,Savings,Creators,Loyalty}Enabled`; web
  `featureFlags.{events,socialPay,savings,creators,loyalty}()`.

## 2. Shared net-new primitives (build ONCE; repo paths)
| Primitive | Path | Reuse note |
|---|---|---|
| Admin shell + RBAC + audit | (reuse `services.RBACService` + `audit_service`) | NOT rebuilt — modules add `*.admin.*` perms |
| Scheduler (recurring/auto-debit) | `backend/internal/scheduler` | durable jobs, retry/backoff, idempotent run records |
| Escrow core | `backend/internal/escrow` | wraps `finance/{ledger,settlement}`; HELD→RELEASED|REFUNDED (+DISPUTED P3) |
| Cashtag directory | `backend/internal/cashtag` | unique @handle per identity; impersonation guard |
| Credential (QR/NFC) | `backend/internal/credential` | rotating single-use QR + NFC; offline-tolerant validate |
| Spray engine | `backend/internal/spray` | instant transfer + animation contract + leaderboard; AML (NL-10) |
| Points ledger | `backend/internal/points` | append-only earn-rules; expiry; NL-4 (points ≠ cash) |

## 3. NL invariants (release blockers — enforce in schema AND code)
NL-1 no own-capital lending/negative balance · NL-2 no yield · NL-3 closed-loop value (event wallet/points;
residual refunds to main wallet) · NL-4 points ≠ cash (redeem to airtime/bills/discount/perks only) ·
NL-5 perks not returns · NL-6 escrow holds never lends · NL-7 Ajo peer rotation (Paymax = ledger/escrow only,
never guarantor) · NL-8 money = ledger · NL-9 idempotent + transactional · NL-10 KYC gates + AML velocity ·
NL-11 content/age moderation · NL-12 immutable audit on every state change.

## 4. Phasing (per BUILD-PLAN dependency graph)
- **Phase 1** (foundation/frequency): shared spine (scheduler, escrow core, cashtag) + **Savings**
  (vaults/Ajo/group-target) + **Social core** (P2P cashtag/split/pools).
- **Phase 2** (the moat): shared (credential, points) + **Events** (ticketing + cashless event wallet) +
  **Loyalty** (points/tiers/catalog).
- **Phase 3** (flywheel): shared (spray, escrow disputes) + **Creators** (storefront/tips/subs/gated) +
  **Social P2P escrow marketplace + spray** + **Paymax Black** perks.

## 5. State machines (guarded transitions + side effects + audit)
- Vault: OPEN→(LOCKED|FLEX)→MATURED|CLOSED (early-break guarded). Circle: FORMING→ACTIVE→CYCLE×n→COMPLETED;
  Member: INVITED→ACTIVE→DEFAULTED|EXITED. Escrow: HELD→RELEASED|REFUNDED (+DISPUTED→RELEASED|REFUNDED P3).
  Event: DRAFT→SUBMITTED→APPROVED→LIVE→CLOSED|SUSPENDED; Ticket: ISSUED→TRANSFERRED?→USED|REFUNDED;
  EventWallet: OPEN→SPENDING→CLOSED(residual refunded). Membership: TIER1→TIER2→TIER3→BLACK.
  Subscription: ACTIVE→PAST_DUE→CANCELLED; Entitlement: GRANTED→REVOKED.

## 6. Swarm split (disjoint files; per-phase waves)
P1: **P1-A** (scheduler+escrow+cashtag + savings + social backend) · **P1-M** (savings+social mobile) ·
**P1-AD** (savings+social admin). P2: **P2-A** (credential+points + events + cashless + loyalty backend) ·
**P2-M** (ticketing+cashless+loyalty mobile) · **P2-AD** (admin). P3: **P3-A** (spray+escrow-dispute +
creators + p2p-escrow + Black backend) · **P3-M** (creators+escrow/spray+Black mobile) · **P3-AD** (admin).
Orchestrator: Register fns in finance_routes.go, frontend-web proxies, Services grid entries, admin sidebar,
top5-ci.yml, trackers.

## 7. Services-grid wiring (the original ask — done at integrate)
SERVICE_MODULES entries (financial/community/lifestyle categories), icons + routes:
- Event Tickets → icon `Ticket`, route `/events` (financial/lifestyle)
- Social Pay → icon `Send` (or `Users`), route `/social` (financial)
- Savings (Ajo) → icon `PiggyBank`, route `/savings` (financial)
- Creators → icon `Sparkles` (or `Mic`), route `/creators` (community)
- Paymax Black / Rewards → icon `Crown` (or `Award`), route `/loyalty` (financial)
Each entry rendered only when its screens exist; routes point to the real module hubs.

## 8. DoD (per CLAUDE §6): invariants in schema+code; object-level authZ; guarded transitions; idempotent+
transactional money as ledger; NL-1..12 verified; FE all states + no dead-ends; audit on every state change;
state-machine + authZ tests; mock/live switch; gofmt/tsc clean; CI build/test + tsc + additive-migration guard.
