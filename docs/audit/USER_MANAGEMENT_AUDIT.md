# User Management & OTP — go-live audit

> **Decision (2026-08-25): OTP CODES, not links.** Progress against this audit is
> tracked in the status column below. B4 and the paradigm split are resolved;
> B2/B3 are fixed in code; **B1 and the new B6 are configuration and remain open —
> both need dashboard access to the two cloud projects.**
>
> | ID | Blocker | Status |
> |----|---------|--------|
> | B1 | No SMTP on either cloud project | **OPEN** — needs Resend DNS, then dashboard |
> | B2 | Prod sends 8 digits, app accepts 6 | FIXED — length is config-driven |
> | B3 | Local never exercises the flow | FIXED — local confirmations on |
> | B4 | `verify-email` faked success | FIXED — endpoint removed |
> | B5 | Web has no verify screen | FIXED — `/verify-email`, browser-verified |
> | B6 | **Email template sends a LINK, not a code** | FIXED locally, **OPEN on cloud** |

Audited 2026-08-25 against `develop`, the live local Supabase, and BOTH cloud
projects via the Management API (`spotlight-staging` `wnicsubiznmishkmunsv`,
`spotlight-prod` `nmseefdlliejmdbxytej`).

**Verdict: the module is substantially built and cannot ship as-is.** Admin-side
user management is genuinely complete and RBAC-gated. The consumer-facing
sign-up/verify path has five blockers, of which two guarantee that no user can
complete registration on production today.

---

## Blockers

### B1 — OTP email cannot be delivered on either cloud project
`smtp_host = None` on staging AND prod: no custom SMTP is configured, so Supabase
falls back to its built-in sender, which is explicitly not for production use.
Both projects also carry `rate_limit_email_sent = 2` — two emails per hour, for
the entire project.

**Resend is not in this path at all.** Every OTP is sent by Supabase Auth, never
by our code, so `RESEND_API_KEY` is irrelevant to it. Verifying `spotlightng.com`
on Resend is necessary but NOT sufficient: Supabase Auth's SMTP settings must
also be pointed at Resend (`smtp.resend.com:587`, user `resend`, pass = the API
key). Doing only the DNS half leaves OTP exactly as broken as it is now.

### B2 — Production issues 8-digit codes; the app accepts only 6
`mailer_otp_length = 8` on prod, while staging and local use 6.
`app/(auth)/verify-otp.tsx` hardcodes `OTP_LENGTH = 6`, renders six single-char
boxes, and rejects short input with "Enter all 6 digits."

A production user receives an 8-digit code and **physically cannot enter it**.
This is invisible in dev and staging, both of which issue 6.

### B3 — The flow is untested by construction: local never exercises it
`supabase/config.toml` sets `enable_confirmations = false`, so local sign-up
auto-confirms, returns a session, and `needsOtp` is false — the verify screen is
never reached. Both clouds set `mailer_autoconfirm = false` and DO require
confirmation. Every local test of registration therefore exercises the one path
production does not use.

### B4 — `verify-email` reports success without verifying anything
`authService.VerifyEmailToken` returns `nil` for any non-empty token, so
`GET /api/auth/verify-email?token=anything` answers
`{"success":true,"message":"Email verified"}`. `ResendVerificationLink` is likewise
a no-op returning `nil`, and the handler discards its error regardless.

This is fabricated success in the authentication path — the same class the
admin-console guard (`scripts/ci/check-simulated-writes.py`) was built to stop,
but on the security boundary rather than an admin screen.

### B5 — The web app has no email-verification screen at all
`frontend-web/app/register` exists; there is no verify-otp page. Only mobile has
one. With confirmations required in cloud, a web sign-up completes, receives no
session, and lands nowhere.

### B6 — the confirmation email sends a link, not a code *(found by testing, not reading)*
Supabase's default confirmation template body is `{{ .ConfirmationURL }}`. Choosing
codes does not change that by itself: the app renders a code-entry screen while the
email contains no code to enter. Confirmed against local Supabase — the mail carried
only a URL, and the digits that could be scraped out of the token failed with
`otp_expired`, because they were never a code.

The template must emit `{{ .Token }}`. `supabase/templates/confirmation.html` now
does this for local, and the full loop is verified end to end: sign up → no session
→ six-digit code in the mail → `type: 'signup'` verify → session issued.

**Each cloud project holds its own copy of this template** and still sends links
until changed in the dashboard (Authentication → Email Templates → Confirm signup).

---

## Divergence — three registrations, two paradigms

Sign-IN was deliberately consolidated onto Go. `app/api/auth/login/route.ts`
carries an explicit comment: having a second implementation meant phone-vs-email
diverged and "fixing one feature broke another." **Registration never got the same
treatment** and currently has three implementations:

| Path | Mechanism | Audit? | Lockout? |
|---|---|---|---|
| `frontend-web /api/auth/register` | `supabase.auth.signUp` direct | no | no |
| mobile `auth.api.ts register` | `supabase.auth.signUp` **from the client** | no | no |
| Go `POST /api/auth/register` | `RegisterUser` + audit events | yes | n/a |

Two verification paradigms coexist: **OTP codes** (Next `verify-otp`/`resend-otp`,
mobile screen) versus **verification links** (Go `verify-email`,
`resend-verification-link`). They are not interchangeable and no product decision
records which one is canonical.

The Next OTP routes have **no caller** — mobile calls `supabase.auth.verifyOtp`
directly. They are dead code, and they disagree with the live path anyway: the
route passes `type: 'email'`, mobile passes `type: 'signup'`.

---

## Gaps (not launch-blocking, but load-bearing)

- **No rate limiting on Go `/api/auth/*`.** `StemRateLimit` exists and is applied
  to stem routes; login, register and password-reset have none. The only throttle
  is Supabase's.
- **Session hardening is OFF by default** (`FEATURE_SESSION_HARDENING_ENABLED=false`),
  so the self-service session endpoints (`/sessions`, revoke, revoke-all) return 503.
- **No general account deletion.** One exists for `(doctor)` and for `connect`;
  there is no path for an ordinary user. Relevant to app-store policy and GDPR.
- `RequestPasswordReset` swallows upstream failures (`return nil` on HTTP ≥400),
  so a broken reset is indistinguishable from a working one.

---

## What is solid (do not rebuild)

- **Sign-in on Go**: phone-or-email resolution, a deliberately generic 401 so a
  wrong password and an unknown account are indistinguishable, and an audit trail.
- **Account lockout is real**: `failed_login_attempts`, `locked_until`,
  `AccountLockMinutes`, enforced in `authService`.
- **Admin user management is complete and genuinely live** — `usersService.ts` has
  no mock branch, and Go backs every call under `/api/admin` with a per-action RBAC
  permission: list, get, export, update, suspend/unsuspend, lock/unlock, role
  assign/remove, bulk role assignment, per-user session view, force-logout,
  force-password-reset, audit logs, login activity, security events.
- **Password reset** genuinely calls Supabase `/auth/v1/recover`.

---

## Recommended order

1. **B1 + B2 together** — point Supabase Auth SMTP at Resend on both projects and
   align `mailer_otp_length`. Neither is a code change; both are config, and B2 is
   one number. Until B1 is done nothing else in the flow is testable.
2. **B4** — make `VerifyEmailToken` verify or fail. A no-op that returns success on
   the auth boundary should not survive a day longer than it must.
3. **B3** — set local `enable_confirmations = true` so dev exercises the real path.
   Expect this to surface further breakage immediately; that is the point.
4. **Decide codes vs links**, then delete the losing paradigm rather than leaving
   both. Consolidate registration onto Go exactly as sign-in was.
5. **B5** — build the web verification screen.
6. Gaps, in the order the launch checklist needs them.

Open question for the product owner: **codes or links?** Everything in step 4
depends on that answer and it is not mine to make.
