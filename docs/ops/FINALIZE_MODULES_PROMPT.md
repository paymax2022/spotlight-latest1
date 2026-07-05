# Prompt — Finalize all built modules to production grade (backend-powered)

> Paste the block below into Claude Code **in the real repo** (Go toolchain, Node,
> Supabase CLI available). It takes every module built in the sandbox — where
> there was no Go compiler, migrations weren't applied, and the frontends ran on
> mocks — through compile, test, migrate, wire, and end-to-end verification so
> everything is actually powered by the Go backend.

---

You are finishing work that was built in a sandbox that could NOT: run the Go toolchain, apply migrations, run the app, or hit a real backend. Go code was written and cross-checked by signature/interface only — never compiled. The frontends were built against mock/fixtures fallbacks. Your job is to take it all to production grade so every module is backend-powered end to end. Work on a branch; keep everything additive; never edit protected legacy files (`.claude/hooks/protect-legacy.sh`); never commit real secrets.

## Modules to finalize (built recently, in order of risk)
1. **Arena competition engine** (ADR-014) — `backend/internal/arena/*`, `backend/internal/app/arena_routes.go`, migrations `20260824000000_arena_core.sql`, `20260824010000_arena_rbac.sql`, `20260824020000_arena_pot.sql`, `frontend-admin/app/admin/arena/*`, `mobile-app/reactnative/app/arena/*` + `src/features/arena/*`. Flag: `FEATURE_ARENA_ENABLED`.
2. **KYC multi-provider verification** (ADR-013) — `backend/internal/finance/kycverify/*`, `backend/internal/provider/{kyc_verify.go,dojah,smileid,youverify}`, `backend/internal/platform/crypto/aesgcm.go`, migration `20260823000000_kyc_verification.sql`, `frontend-admin/app/admin/finance/kyc-verify/*`, `mobile-app/reactnative/app/kyc-verify/*`. Flag: `FEATURE_KYC_VERIFY_ENABLED`.
3. **Address lookup → Google** — `backend/internal/maps/*` (config routes geocode/reverse/autocomplete/matrix → google, new Google Distance Matrix adapter), restaurant delivery fee route-distance, mobile `src/lib/addressLookup.ts` + `EXPO_PUBLIC_MAPS_BASE_URL`. Flag: `FEATURE_MAPS_ENABLED`, key `MAPS_GOOGLE_KEY`.
4. **Config validation + secret hygiene** — `backend/internal/config/validate.go` (fail-fast in prod), `scripts/check-client-secrets.sh`, `docs/ENV.md`.
5. Confirm still-green: any other modules already merged (placement, restaurant delivery fee, transfers, maplerad, telemedicine intake, nutrition).

## Phase 0 — Baseline & branch
- `git switch -c finalize/backend-integration` (or your convention).
- Read `CLAUDE.md` "Commands you should know" and `docs/ENV.md`. Confirm `.env` files are gitignored and only `*.env.example` are tracked.

## Phase 1 — Compile the Go backend (the biggest sandbox blocker)
Nothing here was ever compiled. Expect real errors; fix them minimally and idiomatically.
- `cd backend && go build ./... 2>&1 | tee /tmp/arena_build.log`
- `go vet ./...`
- Fix every compile/vet error. Likely areas: (a) repo structs must fully satisfy the `service/ports.go` interfaces in `arena` and the `provider` KYC ports; (b) import cycles or unused imports; (c) handler ↔ service ↔ repo signature drift; (d) `RegisterArena`/`RegisterKYC` args vs `router.go`/`finance_routes.go` call sites; (e) pgx query column/type mismatches.
- Do NOT change public behavior to make it compile — fix the actual mismatch.
- `go test ./... 2>&1 | tee /tmp/arena_test.log` — make the pure unit tests pass (crypto signer/aesgcm, arena firewall/lifecycle/rails, kycverify state machine/routing/gateway, restaurant delivery fee, config validate). Fix logic bugs the tests surface.

## Phase 2 — Database migrations
- Review the new migrations for additive-only compliance (no DROP/RENAME/type-narrow): `20260823000000_kyc_verification.sql`, `20260824000000_arena_core.sql`, `20260824010000_arena_rbac.sql`, `20260824020000_arena_pot.sql` (+ any delivery-fee migration).
- Apply to a **local/staging** Supabase: `supabase db push` (or `supabase db reset` locally to replay all). Confirm the append-only triggers (`arena_merit_entry_immutable`, `arena_award_result_immutable`, `arena_audit_log_immutable`) and the `arena_merit_leaderboard` matview create cleanly, RLS policies apply, and the RBAC seed inserts.
- Verify `npm run contract:check` (implementation vs `contracts/openapi.yaml`) passes for the new KYC + Arena paths; reconcile any drift (fix code or spec, spec-first).

## Phase 3 — Wire real config (staging, server-side only)
Set in the backend env (never client):
- Maps: `FEATURE_MAPS_ENABLED=true`, `MAPS_GOOGLE_KEY=<key with Places+Geocoding+Distance Matrix>`.
- KYC: `FEATURE_KYC_VERIFY_ENABLED=true`, `KYC_PII_ENC_KEY=$(openssl rand -base64 32)`, and Dojah/Smile/Youverify **sandbox** creds (`DOJAH_*`, `SMILEID_*`, `YOUVERIFY_TOKEN`).
- Arena: `FEATURE_ARENA_ENABLED=true`, `ARENA_SIGNING_SEED_THEORY|PRACTICAL|FIRSTAID=$(openssl rand -base64 32)` (one per adapter).
- Set `APP_ENV=staging` (prod would fail-fast if a required secret is a placeholder — that's intended).
- Boot the backend; confirm `config.Validate()` passes and `[arena] routes registered — merit firewall active` + KYC routes log. Fix any validation failures.

## Phase 4 — Take frontends off mocks onto the live backend
- **Admin (`frontend-admin`)**: set the mock flags false so services hit the backend: `NEXT_PUBLIC_KYC_ADMIN_USE_MOCK=false`, `NEXT_PUBLIC_ARENA_ADMIN_USE_MOCK=false` (and any transfers/placement equivalents). Point the admin at the backend base URL. `npm run type-check`, then click through: KYC review queue/case, Arena config (crown←Merit shown LOCKED), screening, lifecycle transitions, merit-integrity viewer, pot multi-approve, credentials.
- **Mobile (`mobile-app/reactnative`)**: set `EXPO_PUBLIC_API_BASE_URL` to the running backend (or `EXPO_PUBLIC_MAPS_BASE_URL=http://localhost:8080/api/finance/maps` for direct), leave `EXPO_PUBLIC_ADDRESS_OFFLINE` unset (or `off` only for pure-offline demos). `npx tsc --noEmit`. Verify: address autocomplete returns Google results; KYC flow (consent → checks → pending/verify); Arena Compete tab renders by lifecycle state, Support gift sheet (KYC step-up), live Merit leaderboard, Play-Along quiz, credential wallet + public verify.
- **Web (`frontend-web`)**: confirm the new Next proxies forward correctly — `/api/finance/kyc/*`, `/api/finance/admin/kyc/*`, `/api/kyc/webhooks/*`, `/api/arena/*` (public GETs unauthenticated; member/admin authed). `cd frontend-web && npm run lint && npx tsc --noEmit && npx vitest run`.

## Phase 5 — Resolve the known TODOs/assumptions the agents flagged
- **KYC**: replace the `/sdk-token` stub with a real provider-issued SDK session token before any live biometric capture; reconfirm the **Smile ID callback signature** scheme against current docs (there's a `TODO(smileid)`); set real `*_WEBHOOK_SECRET`s; verify webhook signature → dedupe `(provider,event_id)` → idempotent end to end with a sandbox callback.
- **Arena**: register each competition's authorized **adapter public keys** in `arena_authorized_adapter` (derive from the seeds via `Signer.PublicKeyB64()`), seed a Naija Driver competition + immutable config version; assign the `arena-*` roles (admin/reviewer/proctor/judge/auditor) scoped to the competition; wire the Redis idempotency fast-path (currently nil → DB-unique fallback); **harden the crown award signing** to use a dedicated award key rather than the practical adapter's merit signer (defense-in-depth for NDC-1); tighten Play-Along cashback rate-limiting.
- **Maps**: decide MapLibre-basemap-with-Google-data vs Google tiles (licensing) per `docs/ENV.md`.

## Phase 6 — Quality gates (must be green) & finale checks
Run and pass all CLAUDE.md gates:
- `npm run test:regression` (legacy golden path) · `npm run test:money` (ledger/idempotency/limits)
- `npm run contract:check`
- `cd backend && go build ./... && go vet ./... && go test ./...`
- `cd frontend-web && npm run lint && npx tsc --noEmit && npx vitest run`
- `cd frontend-admin && npm run type-check`
- `bash scripts/check-client-secrets.sh` (no secret in any client bundle)

Then targeted integrity checks (the headline properties):
- **KYC**: no plaintext PII in logs/columns; consent required before any check (scope-aware); tier elevates only on full pass.
- **Arena merit firewall (NDC-1)**: prove there is no money→merit path — the only `arena_merit_entry` INSERT is `repo/merit.go`, reached only via `MeritService.Append` (verify-before-insert) ← `ScoringService`; Support/Play-Along/Sponsor services hold no signer; advancement reads the merit leaderboard only; the crown award binds to MERIT only and can't be reconfigured. Add an integration test that submits a signed theory score, verifies it, runs a batch cutoff → QUALIFIED, and confirms a Support contribution changes the pot + People's Champion tally but NOT any merit/leaderboard value.

## Guardrails
- Additive migrations only; do not modify protected legacy files.
- Keep feature flags OFF in production until staging verification is green; roll out behind the flags (shadow → canary).
- Server-side secrets only; rotate any sandbox keys before production; commit only `*.env.example`.
- Conventional Commits; PRs < ~400 lines where feasible; add a 1-page ADR for any non-obvious change.

## Deliverable
A branch that compiles (`go build ./...` clean), passes all gates, applies migrations cleanly, and demonstrates each module working against the real backend (screenshots or a short runbook per module). Report: compile fixes made, migrations applied, flags/env set for staging, TODOs resolved vs deferred, and the merit-firewall integration test result.
