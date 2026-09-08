# Server-issued email OTP (Brevo) — setup and rollout

**Status: built, OFF, and not yet provisionable.** The code is merged and tested.
Nothing can be switched on until a Brevo account, sender domain and template
exist — none of which are present today. There is no `BREVO_API_KEY` in this
repository or in any `.env` file in it, despite the implementation brief stating
that credentials were already in place; that was checked and is not the case.

---

## What this is, and what it is not

It is a second OTP system.

Today every OTP a user receives is minted and mailed by **Supabase Auth**, not by
our code. `docs/audit/USER_MANAGEMENT_AUDIT.md` records why that path is broken:
no custom SMTP on either cloud project (B1), and a project-wide budget of two
emails per hour. This module gives us an OTP path we own end to end — our
generation, our storage, our transport, our rate limits.

**Verifying a code here proves control of a mailbox and nothing else.** It does
not confirm a GoTrue user, and it does not issue a session. Registration, login
and password reset all still run through Supabase. Connecting them is a separate,
deliberate decision — and the audit is explicit that two coexisting verification
paradigms is the state to get out of, so whichever one wins should win on
purpose rather than by accretion.

---

## Environment

| Key | Required | Default | Notes |
|---|---|---|---|
| `FEATURE_OTP_EMAIL_ENABLED` | — | `false` | Master switch. |
| `BREVO_API_KEY` | when on | — | From the Brevo dashboard. |
| `BREVO_SENDER_EMAIL` | when on | — | Must be on a domain verified in Brevo. |
| `BREVO_SENDER_NAME` | — | `Spotlight` | |
| `BREVO_OTP_TEMPLATE_ID` | when on | — | Numeric ID of the transactional template. |
| `BREVO_TIMEOUT_SECONDS` | — | `10` | |
| `OTP_PEPPER` | **when on** | — | See below. |
| `OTP_LENGTH` | — | `6` | 4–10. |
| `OTP_TTL_MINUTES` | — | `10` | |
| `OTP_MAX_ATTEMPTS` | — | `5` | Per code. |
| `OTP_RESEND_COOLDOWN_SECONDS` | — | `60` | |
| `OTP_MAX_SENDS_PER_HOUR` | — | `5` | Per address. |
| `OTP_MAX_SENDS_PER_IP_PER_HOUR` | — | `20` | |
| `OTP_MAX_VERIFY_PER_IP_PER_HOUR` | — | `20` | |

### `OTP_PEPPER` is not optional

```bash
openssl rand -base64 32
```

It is the HMAC key for both the stored code digest and the hashed identifier in
the storage key. Without it the stored digest of a six-digit code is a
one-million-entry rainbow table away from plaintext, and `otp_codes` becomes a
readable list of every address that ever requested a code.

Treat it as a secret of the same class as the API key. **Rotating it invalidates
every in-flight code**, which is acceptable — users request another.

If the feature is on and the pepper (or any Brevo credential) is missing, the
service refuses to wire, logs at ERROR, and both endpoints answer
`503 misconfigured_missing_credentials`. It does **not** kill the process: this
is a sixty-module monolith and one misconfigured flag must not take the other
fifty-nine down with it. Nothing proceeds silently with a weak hash.

---

## Brevo template

Create it in Brevo → Campaigns → Templates → Transactional, then put its numeric
ID in `BREVO_OTP_TEMPLATE_ID`.

The Go client sends three parameters. The template reads them by name, so
renaming one here ships an email with a blank code and **nothing in our code
fails** — `internal/email/brevo_test.go` pins the payload for that reason.

| Param | Example |
|---|---|
| `OTP` | `482913` |
| `NAME` | `Ada` (falls back to `there`) |
| `EXPIRY_MINUTES` | `10` |

```html
<p>Hello {{ params.NAME }},</p>
<p>Your Spotlight verification code is:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:6px;
          font-family:monospace;margin:24px 0;">{{ params.OTP }}</p>
<p>This code expires in {{ params.EXPIRY_MINUTES }} minutes.</p>
<p>If you did not request this, you can ignore this email.</p>
```

Rules for the template:

- The code large, monospace and **selectable** — people copy and paste on mobile.
- State the expiry in minutes, and state the purpose.
- Tell the reader to ignore the mail if they did not request it.
- **No links at all.** An OTP email with nothing to click has no phishing
  surface, which is worth more than any convenience a link buys.
- Provide the plain-text alternative; Brevo sends multipart.

---

## Deliverability — do this before enabling anywhere

An OTP that lands in spam is an outage that pages nobody.

- SPF, DKIM and DMARC on the sending domain, configured in Brevo.
- **Brevo domain verification is separate from Resend's.** `scripts/ci/check-email-sender.py`
  pins every hardcoded sender default to `spotlightng.com` because that is the only
  domain verified on the *Resend* account; it says nothing about Brevo. A sender
  verified in one is not verified in the other. `BREVO_SENDER_EMAIL` deliberately
  has **no default** in `config.go` for this reason — there is no value that could
  be right before the Brevo account exists, and a plausible-looking wrong one
  would fail silently at send time.
- **Send from a subdomain** (`mail.spotlightng.com`) so transactional reputation
  is isolated from the primary domain.
- Monitor bounce and complaint rates in the Brevo dashboard from day one.
- Use a monitored reply-to. Some filters penalise unmonitored senders.

---

## Storage

Postgres, not Redis — deliberately, and against the implementation brief.

`router.go` builds Redis best-effort and states the rule: *"Redis is a latency
optimization, never a correctness dependency"*. `sharedRedis` is nil whenever
`REDIS_URL` is unset or unreachable. Single use, the attempt ceiling and the send
budget are correctness, and the failure mode of a missing OTP store is not a slow
login — it is an unbounded one.

Two tables, migration `20270193000000`:

- `otp_codes` — one live code per `purpose:HMAC(pepper,email)`. Neither the code
  nor the address is stored in plaintext.
- `otp_rate_limits` — fixed-window counters, keyed by hashed address or hashed IP.

Postgres has no TTL, so the service sweeps a bounded number of expired rows on
each issue. Expiry is enforced **on read** as well, so a sweep that has not run
cannot make a stale code verify.

---

## Rollout

| Step | Gate |
|---|---|
| 1. Merge with the flag off | Build green; endpoints answer 503 `feature_disabled` |
| 2. Provision Brevo: account, sender domain, SPF/DKIM/DMARC, template | Test send received, **not** in spam |
| 3. Set the env keys in one non-production environment; flag on | `POST /api/auth/otp/request` returns 200; a code arrives |
| 4. Exercise the full matrix on a real device | Verify, replay, wrong code ×5, expiry, cooldown |
| 5. Decide, explicitly, whether this replaces the Supabase path | Written decision — do not let both run indefinitely |
| 6. Enable in production | Success rate at baseline |

**Keep the Supabase path available for one release after any cutover.** If Brevo
has an incident on the day you switch, being able to fall back is worth more than
the tidiness of deleting the old path.

---

## Observability

Nothing here logs a code — not at debug, not in an error string, not in a span.
Failures log the operation and the purpose only; the address is omitted too,
because an access log full of `otp issue failed for x@y.com` is a user list.

Worth alerting on once this is live:

| Condition | Why |
|---|---|
| Any `ErrPermanent` from Brevo | Usually a revoked key or an unverified sender. Retries will not fix it. |
| Send failure rate > 5% over 5 min | Provider incident. |
| Verify success rate below baseline | Often a broken template — the code is not reaching users. |
| Spike in attempt-ceiling lockouts | Possible brute-force campaign. |
