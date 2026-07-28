# Merchant Onboarding & Role-Upgrade (`internal/onboarding`)

Self-contained Gin module that lets a customer apply to become a merchant (e.g.
Medical Practitioner, Pharmacy) within a super-app module (Health, Marketplace…),
has the application reviewed, and — on approval — idempotently activates a
**merchant profile** and grants the corresponding RBAC **role**.

Mounted from `app.registerFinanceRoutes` via `onboarding.Register(r, Deps{...})`
behind the `FEATURE_ONBOARDING_ENABLED` flag. Shares the finance `pgxpool.Pool`.

## Layering
- `model.go` — JSON contract types (camelCase, mirrors the mobile app).
- `repository.go` — pgx, parameterised queries only.
- `grant.go` — idempotent role grant (`public.user_roles`), profile activation,
  and audit writes (`public.audit_logs`).
- `validate.go` — form-schema validation engine + reviewer check derivation.
- `service.go` — state machines, duplicate-blocking, idempotent approval.
- `handler.go` — Gin handlers; `{"data": ...}` envelope, `{"error": ...}` on failure.
- `routes.go` — `Register` + middleware wiring.

## Routes (prefix `/api/v1`)
Customer (auth required):
- `GET  /onboarding/modules` — only modules with `status='open'`
- `GET  /onboarding/modules/:id/merchant-types`
- `GET  /onboarding/merchant-types/:id`
- `GET  /onboarding/form-schemas/:id`
- `POST /onboarding/applications` — create DRAFT (blocks duplicate active app/profile)
- `PATCH /onboarding/applications/:id` — save draft
- `POST /onboarding/applications/:id/submit` — **requires `Idempotency-Key` header**
- `POST /onboarding/applications/:id/resubmit`
- `GET  /onboarding/applications/:id`
- `GET  /me/capabilities`

Admin reviewer (`onboarding.review` permission):
- `GET  /admin/onboarding/review-queue?module=&type=&status=&age=`
- `GET  /admin/onboarding/applications/:id`
- `POST /admin/onboarding/applications/:id/approve`
- `POST /admin/onboarding/applications/:id/reject`        (reason required)
- `POST /admin/onboarding/applications/:id/request-info`  (checklist required)
- `POST /admin/onboarding/applications/:id/escalate`

Admin config (`onboarding.configure` permission):
- `POST /admin/onboarding/modules`
- `POST /admin/onboarding/merchant-types`
- `POST /admin/onboarding/merchant-types/:id/form-schemas` (new version; publishing
  repoints `current_form_schema_id`)

## State machines
**Application** — illegal transitions return `409`:
```
DRAFT ──submit──▶ SUBMITTED ──▶ UNDER_REVIEW
                                  │  ▲
                     request-info │  │ resubmit
                                  ▼  │
                            NEEDS_MORE_INFO
SUBMITTED|UNDER_REVIEW ──approve──▶ APPROVED
SUBMITTED|UNDER_REVIEW|NEEDS_MORE_INFO ──reject──▶ REJECTED
REJECTED ──▶ (user starts a new DRAFT)
```
Submit is **idempotent**: a retry with the same row already SUBMITTED/UNDER_REVIEW
returns the current state (200). Approve is **idempotent**: re-running re-applies the
profile activation + role grant (both `ON CONFLICT DO UPDATE`) without duplicates.

**MerchantProfile** — `PROVISIONING → ACTIVE → SUSPENDED → OFFBOARDED`, plus
`ACTIVE ↔ UNDER_REVERIFICATION`. On approval the profile is created directly as
`ACTIVE` (idempotent via `UNIQUE(user_id, merchant_type_id)`).

## On approve
1. Activate/create `onb_merchant_profile` (idempotent).
2. Grant the merchant type's `role_to_grant` into `public.user_roles` (idempotent via
   `ON CONFLICT (user_id, role_id, scope_type, scope_id)`).
3. Move application to `APPROVED`, write `public.audit_logs`.
4. Fire a notification (stub — `notifyApproved`).

## Validation engine
Field types: `text, textarea, number, email, phone, select, multiselect, date,
address, currency (kobo), document (hasExpiry), boolean`. Conditional visibility via
`visibleWhen { field, equals }` (hidden fields are skipped, even if required).
Submissions are validated against the **published schema version** they are pinned to.

## Reused vs. new
- **Reused** existing RBAC tables: `public.roles`, `public.user_roles`,
  `public.audit_logs`, `public.permissions`, `public.role_permissions`.
- **New** tables (all `onb_*`): `onb_module`, `onb_merchant_type`, `onb_form_schema`,
  `onb_application`, `onb_merchant_profile`, `onb_document`, `onb_review_task`.
- Migration: `supabase/migrations/20260619000000_merchant_onboarding.sql` (additive).

## Assumptions
- Money/currency fields are integer **minor units (kobo)**.
- `user_id` is taken from the authenticated session (set by `RequireAuthContext` and
  copied to the `user_id` context key, matching the finance modules' convention).
- `display_name`/`kyc_tier` for `/me/capabilities` are read from context if upstream
  middleware populates them; otherwise email is used as display name and tier defaults
  to 0. KYC-tier gating on `required_kyc_tier` is surfaced but not hard-enforced here
  (it belongs to the finance KYC module) — wire it in when KYC context is available.
- `onb_application.user_id` / `onb_merchant_profile.user_id` are stored as UUIDs
  without a hard FK so the module stays decoupled from `auth.users` vs `platform_users`.
