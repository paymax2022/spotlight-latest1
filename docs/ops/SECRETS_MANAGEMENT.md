# Secrets management & least-privilege (money-path + provider adapters)

> Satisfies the DevOps skill's "Configuration and secrets" and "Operational
> security" gates for the fintech surface. Scope this to money-path and provider
> adapters first; it applies to all secrets in `ENV_MATRIX.md`.

## Principles

1. **Separate config from code.** Secrets are injected per-environment at deploy
   time, never committed. `.env.local` / `.env` must be git-ignored (risk INF-3).
2. **A dedicated secrets store.** Today secrets live in `.env` files on cPanel /
   the backend host — acceptable for MVP only. Before money GA, migrate the
   CRITICAL/HIGH secrets to a manager (Doppler / AWS Secrets Manager / Vault /
   Supabase Vault). Tracked: risk VA-3, INF-3.
3. **Never print secrets in CI logs.** The CI workflows here only read code and
   run tests/build — they take no secrets. Deploy (`deploy-cpanel.yml`) uses
   GitHub Actions secrets; do not `echo` them.
4. **Rotate on a schedule and on any suspected leak.** Document the rotation
   owner per secret. Rotating `SUPABASE_SERVICE_ROLE_KEY` or `PAYSTACK_SECRET_KEY`
   requires a coordinated redeploy/restart — plan a window.
5. **CI/CD credentials short-lived & narrow.** Prefer GitHub OIDC / workload
   identity over long-lived keys for any cloud deploy. The cPanel SSH key
   (`CPANEL_SSH_KEY`) should be a dedicated deploy key scoped to the deploy path
   only, not a personal key.

## Least-privilege per secret

| Secret | Privilege to grant | Do NOT |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side only; never sent to browser; only routes that must bypass RLS. Prefer scoped Postgres roles for the Go pgx path over the blanket service role where possible. | Ship to client; reuse across staging/prod |
| `DATABASE_URL` | A DB role scoped to the money schema with only needed grants; use the session pooler. | Use the postgres superuser |
| `PAYSTACK_SECRET_KEY` | Server-side webhook verify + provider calls only. Separate test vs live keys per environment. | Put in any `NEXT_PUBLIC_*`; share across envs |
| `R2_SECRET_ACCESS_KEY` / `R2_ACCESS_KEY_ID` | An R2 token scoped to the single bucket (`spotlight-open-mic`) with only the operations used (put/get/sign). | Account-wide R2 credentials |
| `ANTHROPIC_API_KEY` | Server-side only; a key with spend limits/budget. | Expose to client; share with non-AI surfaces |
| `AGORA_APP_CERTIFICATE` / `VIDEOSDK_SECRET` | Backend RTC token signing only. | Embed in mobile/web bundle |
| `MAPLERAD_*` / `EVERSEND_*` webhook secrets | Verify inbound provider webhooks; one per provider. | Reuse the provider API key as the webhook secret |
| `CONNECT_VERIFICATION_PEPPER` | Backend hashing only; treat as long-lived (rotating invalidates existing hashes — plan a migration). | Log; expose |
| `ADMIN_API_KEY` / `SPOTLIGHT_ADMIN_API_KEY` | Strong random; per-environment. Migrate admin to per-user JWT+RBAC (risk RBAC-3) so the shared key isn't the only gate. | Leave empty in prod (empty = open admin) |

## Provider-adapter notes

- **Paystack:** webhook handler verifies HMAC-SHA512 with `PAYSTACK_SECRET_KEY` /
  `PAYSTACK_WEBHOOK_SECRET`. Persist the raw event before processing and dedup on
  `(provider, provider_event_id)` (risk VA-2) so a leaked-and-replayed webhook
  cannot double-credit. Keep test and live keys strictly separate per env.
- **Agora / VideoSDK:** tokens are minted server-side from the app
  certificate/secret and handed to clients short-lived. The certificate/secret
  never leaves the backend.
- **Anthropic:** key is server-side only (realtor AI, aicare). Set a budget cap.
- **R2:** use presigned URLs minted server-side; the bucket token is scoped to
  the one bucket. Public read (if any) goes via `R2_PUBLIC_BASE_URL`, not the
  secret.

## Audit & access review

- Keep an audit trail of who changed which secret and when (secrets-manager audit
  log once migrated; until then, record changes in the deploy ticket).
- Quarterly access review for who can read prod secrets. For the fintech surface,
  restrict prod secret read to release-manager + DBA + finance-ops.
