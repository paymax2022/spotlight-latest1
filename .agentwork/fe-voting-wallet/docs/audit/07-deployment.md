# Spotlight — Deployment Pipeline Map
> Audit date: 2026-06-13

---

## Infrastructure Overview

| Component | Host | Platform | Deploy Method |
|---|---|---|---|
| Frontend (Next.js) | cPanel shared hosting | CloudLinux + LiteSpeed + Passenger | GitHub Actions → SCP → restart.txt |
| Backend (Go/Gin) | cPanel (inferred) | Dockerfile in repo | Manual or separate CI step |
| Database | Supabase (cloud) | PostgreSQL + Supabase services | Supabase CLI migrations |
| Storage | Cloudflare R2 | Object storage | SDK (R2_ACCESS_KEY_ID) |
| Email | Resend | SaaS API | SDK (RESEND_API_KEY) |

---

## CI/CD Pipeline
> File: `.github/workflows/deploy-cpanel.yml`

**Trigger:** Push to `main` branch

```
Push to main
  └── Job: deploy
        ├── Checkout code
        ├── Setup Node.js v20
        ├── npm ci  (frontend-web/)
        ├── npm run build
        ├── SCP upload: .next/ → {DEPLOY_PATH}/frontend-web  (SSH key auth)
        ├── SSH: Write Passenger .htaccess
        │         PassengerNodejs /usr/bin/node
        │         PassengerStartupFile server.js
        │         PassengerAppEnv production
        └── SSH: touch tmp/restart.txt  (triggers LiteSpeed app restart)
```

**Secrets used in CI:**
| Secret | Purpose |
|---|---|
| CPANEL_SSH_HOST | cPanel server hostname |
| SSH_USER | cPanel SSH username |
| SSH_KEY | Private SSH key (PEM) |
| SSH_PORT | SSH port (non-standard) |

**Deploy path on server:** `/home/specenpo/public_html/spotlightng_v2/frontend-web`

---

## Frontend Server
> File: `frontend-web/server.js` (13 lines)

```javascript
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

const app = next({ dev: false });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen();   // ← No explicit PORT; defaults to 3000 or env PORT
});
```

**Gaps:**
- No explicit PORT/HOSTNAME binding — relies on Passenger to inject
- No graceful shutdown handler (SIGTERM/SIGINT)
- No error handler on server.listen()
- No health check endpoint exposed from this file

---

## Backend Deployment
> File: `backend/Dockerfile` (exists; not read in detail)

The Go backend has a Dockerfile but no CI workflow targeting it was found. Likely deployed manually or via a separate, undocumented process.

**Gaps:**
- No CI/CD for backend deployment
- No automated container registry push
- No health check endpoint confirmed in Go router (public `/api/v1/public/health` exists in router but not in deploy verification)

---

## Database Migrations
> Source: `supabase/migrations/*.sql`

**Mechanism:** Supabase CLI (`supabase db push` or `supabase migration apply`)  
**Pipeline integration:** No automated migration step found in deploy-cpanel.yml  
**Risk:** Schema changes are applied manually; deploy order (code vs. schema) not enforced  

Current migration count: **~80 migration files**  
Most recent: `20260604100000_reality_show_stages_evictions.sql`

---

## Environment Variables
> Source: `frontend-web/.env.example`, `frontend-web/.env.local`

| Variable | Used by | Sensitivity |
|---|---|---|
| NEXT_PUBLIC_SITE_URL | Frontend | Low |
| NEXT_PUBLIC_API_BASE_URL | Frontend → Backend | Low |
| NEXT_PUBLIC_SUPABASE_URL | Frontend Supabase client | Low |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Frontend Supabase client | Low (public) |
| SUPABASE_SERVICE_ROLE_KEY | API routes, auth verification | **CRITICAL — full DB bypass** |
| SPOTLIGHT_ADMIN_API_KEY | Admin dashboard API | **HIGH** |
| NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY | Paystack checkout | Low |
| PAYSTACK_SECRET_KEY | Webhook verification, server API calls | **CRITICAL** |
| RESEND_API_KEY | Email sending | HIGH |
| EMAIL_FROM | Email sender address | Low |
| CONTACT_INBOX_EMAIL | Contact form destination | Low |
| R2_ACCOUNT_ID | Cloudflare R2 | HIGH |
| R2_ACCESS_KEY_ID | Cloudflare R2 | HIGH |
| R2_SECRET_ACCESS_KEY | Cloudflare R2 | **CRITICAL** |
| R2_BUCKET | Cloudflare R2 bucket name | Low |
| R2_PUBLIC_BASE_URL | R2 public CDN URL | Low |

**⚠️ RISK:** `.env.local` present in repo root — confirm it is in `.gitignore`

---

## Gaps & Risks for Fintech Build

| Gap | Risk | Recommendation |
|---|---|---|
| cPanel shared hosting | Low isolation, no container orchestration, shared resources | Migrate to VPS/container (Railway, Render, AWS) before fintech GA |
| No automated migration step in CI | Schema/code drift possible | Add `supabase db push` step with rollback on failure |
| No zero-downtime deploy | Passenger restart causes brief downtime | Use rolling deploy or blue-green |
| No secrets manager | Env vars in .env files; rotation is manual | Migrate to Vault/AWS Secrets Manager for PAYSTACK_SECRET_KEY, SERVICE_ROLE_KEY |
| No backend CI | Backend deploys undocumented | Add GitHub Actions → Docker build → push → deploy |
| No staging environment | Changes go directly to production | Add staging branch + environment for fintech testing |
| No deployment health check | No automated smoke test post-deploy | Add post-deploy Playwright smoke test or API probe |
| Single-region | No DR, no failover | Acceptable for MVP; plan for multi-region in fintech Phase 3 |
| service_role key in env | If .env.local leaks, full DB access is exposed | Short-lived secrets or Supabase service account scoping |
