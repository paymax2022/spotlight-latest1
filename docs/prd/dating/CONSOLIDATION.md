# Connect — Consolidation & Production Closeout Plan

Reconciles the **existing dating build** (`docs/prd/dating/*`, Phases 0–6) with the **new Connect
PRD** (`docs/prd/dating/connect/connect-paymax-prd.md`). Module is now named **Connect**.

## 1. What exists today (verified on disk)

| Layer | State | Detail |
|---|---|---|
| **Backend** | **Substantial** | `backend/internal/connect/*` — 16 packages, 77 Go files, ~8k LOC: onboarding, profile, verification, discovery, matching, chat, safety, trust, datesafety, professional, creator, events, moderation, monetization, config. Routes under `/api/v1/connect/*` + `/api/connect/admin/*` (connect_routes.go, connect_phase1_routes.go, connect_growth_routes.go). RBAC `connect.*` perms. 7 additive migrations (rbac, foundation, onboarding, verification, phase1_core, phase1_safety, phases_2to6). |
| **Mobile** | **Phase-0 shell** | `app/connect/{_layout,index}.tsx` (renders backend config only) + 46-line `src/features/connect` contract. **~120 PRD §10 screens unbuilt.** |
| **Admin** | **Phase-0 shell** | `app/admin/connect/{page,cases,audit}` + `connectAdminService.ts`. **~80 PRD §11 screens unbuilt.** |

## 2. New-PRD pillars NOT yet built (the gap)

The new Connect PRD adds, beyond the existing dating/networking work:
1. **Live Streaming** (§6.2, §10.6–10.7): 1:many, co-host, PK battles, low-bandwidth, viewer + broadcaster.
2. **Voting** (§6.3, §10.8): free polls + paid voting (wallet money), integrity.
3. **Gifting** (§6.4, §10.9): **wallet-to-wallet real-Naira transfers** rendered as gifts; ledger-backed; tier-gated.
4. **Gamification** (§6.5, §10.10): XP, missions, streaks, leaderboards, seasons (non-cash currency, no silent conversion).
5. **Tier / KYC / AML core** (§7): CBN three-tier limits gating every money move; AML monitoring; NFIU STR/SAR; sanctions/PEP. **The dependency gate: no money feature ships before this is live.**
6. **Full mobile screen inventory** (§10, ~120 screens) and **Admin console** (§11, ~80 screens).

## 3. Reconciliation decisions
- **Name:** "Connect" everywhere (was "dating"). Keep `internal/connect`, `app/connect`, `app/admin/connect`, `/api/v1/connect`.
- **Stack:** Gin monolith + Supabase/pgx + Expo RN + Next.js admin (per `architecture.md`; the old CLAUDE.md microservice/Mongo/Vue stack is void).
- **Money:** gifts/votes route through the existing `internal/finance/{ledger,wallet,tiers,kyc}` — never new balances. Kobo, idempotency keys, audit, server-side tier checks (PRD §7, §8).
- **Safety invariants** (CLAUDE.md): 18+, no-message-before-match, location privacy, audited admin actions, reports→cases, AI reason codes, media moderation — upheld in all new work.
- **Mock/live switch:** mobile `EXPO_PUBLIC_CONNECT_USE_MOCK`, admin `NEXT_PUBLIC_CONNECT_USE_MOCK`, backend `FeatureConnectEnabled` — default mock, like crowdfunding.

## 4. Production closeout — swarm work split (disjoint files, zero conflicts)

| Agent | Domain | Deliverable |
|---|---|---|
| **M1** | Mobile foundation | 5-tab nav, onboarding/auth/verification (§10.1), Me/settings/safety/support (§10.11–10.12), shared components + design tokens |
| **M2** | Mobile discovery+social | Discover Date (§10.2), Networking (§10.3), unified profile (§10.4), messaging/inbox (§10.5) |
| **M3** | Mobile live+engage | Live viewer+broadcaster (§10.6–10.7), voting (§10.8), gamification (§10.10) |
| **M4** | Mobile money | Wallet, gift catalog/send, tier/KYC upgrade, limit prompts (§10.9) |
| **A1** | Admin trust+money | Shell+dashboard (§11.1), user/identity (§11.2), moderation (§11.4), finance/gifting/AML (§11.5), voting integrity (§11.6) |
| **A2** | Admin ops | RBAC (§11.3), gamification ops (§11.7), catalog/comms (§11.8), analytics (§11.9), geo (§11.10), support (§11.11), config (§11.12) |
| **B1** | Backend money | Gifting (wallet→wallet, ledger, idempotent, tier-gated), paid voting, tier/KYC/AML monitoring + NFIU case scaffold |
| **B2** | Backend live+game | Live-stream sessions/signaling/co-host/PK, gamification (XP/missions/leaderboards) |

Each agent: NEW files only; mock/live switch; matches the established crowdfunding/connect patterns;
gofmt/tsc clean. Orchestrator wires nav (`app/connect/_layout`), routes (`connect_routes.go`),
admin nav, and a `connect-ci.yml`.

## 5. Production-grade bar (definition of done)
- Full PRD screen coverage with loading/empty/error/success + every money screen shows tier+limit+remaining.
- Real backend contracts + additive migrations + RLS + audit; money path: kobo, idempotency, server-side tier checks, ledger entries.
- Mock/live switch; TypeScript + gofmt clean; CI runs networked `go build`/`test` + tsc + migration guard.
- Safety invariants upheld; no §24 "must-not-have" surfaces.
