# ADR-PR1163: Login names the cause; locked, wrong-password and unknown-account stop sharing one message

## Status
Proposed

## Context
`AuthService.LoginUser` refused everything except two special cases with
`errors.New("invalid credentials")`, and `AuthHandler.Login` answered that with a bare
`401 {"error":"invalid credentials"}`. Five different things were reported as one:

| what was actually wrong | what the user was told |
| --- | --- |
| the password did not match | "invalid credentials" |
| the account is locked by the auto-lockout | "invalid credentials" |
| the account is locked by an admin (`status=locked`, `locked_until NULL`) | "invalid credentials" |
| the account is suspended / soft-deleted | "invalid credentials" |
| no account matches the email or phone at all | "invalid credentials" |
| the identifier is not a parseable email or phone | "invalid credentials" |

`validateLoginStatus` runs BEFORE GoTrue, so a locked account never had its password
evaluated and still got the wrong-password answer. That is not a neutral lie: the message
invites the user to retry the password, and a retry against an account that is already
locked is another strike through `bump_failed_login_attempts`. It cost a real user their
afternoon on 2026-11-23 — `spec.ng+doctor@gmail.com` sat in an active 30-minute lockout
(`failed_login_attempts=6`), kept entering the correct password, and each attempt read back
as "invalid credentials".

The generic answer was #788's anti-enumeration posture. Two things already softened it:
`ErrEmailNotConfirmed` (403) and `ErrAuthUnavailable` (503) are distinct, and
ADR-PR801 (Proposed) deliberately discloses `404 account_not_found` on
`POST /api/auth/request-password-reset`. Product decision for this change: on login, the
user's ability to fix the problem outranks denying an attacker a bounded existence oracle.

## Decision
`LoginUser` returns one classified cause per failure, carrying the data the sentence needs;
`AuthHandler.Login` gives each its own HTTP status, `code`, audit `failure_reason` and plain
sentence.

| cause (service) | status | `code` | audit `failure_reason` | message |
| --- | --- | --- | --- | --- |
| `ErrInvalidIdentifier` | 400 | `invalid_identifier` | `invalid_identifier` | Enter a valid email address or phone number. |
| `ErrAmbiguousIdentifier` | 400 | `ambiguous_identifier` | `ambiguous_identifier` | That phone number is linked to more than one account. Sign in with your email address instead. |
| `ErrAccountNotFound` | 401 | `account_not_found` | `account_not_found` | No account found for \<typed\>. Check you typed it correctly, or create an account. |
| `ErrIncorrectPassword` / `*WrongPasswordError{AttemptsRemaining}` | 401 | `incorrect_password` | `incorrect_password` | Incorrect password for \<typed\>. N attempts left before the account locks. Use Forgot password to reset it. |
| `ErrAccountLocked` / `*AccountLockedError{Until}` | 423 | `account_locked` | `account_locked` | Account locked for \<typed\> after too many failed sign-in attempts. Try again in N minutes. |
| `ErrAccountLockedByAdmin` | 423 | `account_locked_by_support` | `account_locked_by_support` | Your account is locked by our team. Contact support to have it reviewed. |
| `ErrAccountSuspended` | 403 | `account_suspended` | `account_suspended` | This account is suspended. Contact support to have it reviewed. |
| `ErrAccountClosed` | 403 | `account_closed` | `account_closed` | This account was closed. You can create a new one with the same email address. |
| `ErrIdentityRecordMissing` | 500 | `account_record_missing` | `identity_record_missing` | We can't load your account right now. Try again, or contact support. |
| `ErrEmailNotConfirmed` | 403 | `email_not_confirmed` | `email_not_confirmed` | unchanged |
| `ErrAuthUnavailable` | 503 | `auth_unavailable` | `upstream_error` | unchanged |

Rules that hold the design together:

- **\<typed\> is always what the user sent, never the resolved account email.** A phone
  identifier resolves to an address server-side; echoing the address would republish the
  phone→email lookup this service deliberately keeps internal.
  `TestLogin_NeverEchoesTheResolvedEmailForAPhoneIdentifier` pins it.
- **A lock is reported with the countdown, not a clock time.** The API is UTC, the user is
  not; `locked_until` becomes "try again in N minutes". An admin lock (`locked_until NULL`)
  gets a different code, because nothing expires and waiting is not a route forward.
- **A failed lookup is never evidence of absence.** If the phone→email query errors, the
  answer is `auth_unavailable`, not `account_not_found` — we did not read the data.
- **No strike on any path that did not evaluate a password.** Lock, suspension, closed and
  the pre-GoTrue gate count nothing; `ErrAuthUnavailable` counts nothing (E2E-FR-049); the
  5th correct-answer strike reports the lock in the same response.
- **AUTH-014 keeps its teeth.** A missing `platform_users` row still cannot produce a
  session. GoTrue is consulted for CLASSIFICATION ONLY: reject → `account_not_found`,
  accept → `ErrIdentityRecordMissing`, session discarded, log line without an address.
- **An unclassified error keeps the historic 401 `invalid credentials`.** An unknown cause
  must not be dressed up as a known one; no KNOWN cause may reach that fallback.
- The `login_activity` audit row stays attributable through `LoginFailureError`
  (E2E-AUTH-007).

The OTP sign-in path (`otp_login.go`) is deliberately NOT changed: there the identifier is
an address we already agreed to send a code to, so the disclosure buys the user nothing.

## Consequences
- **Login becomes a bounded account-existence oracle.** `account_not_found` vs
  `incorrect_password` proves an email or phone is registered, rate-limited only by the
  per-IP login limiter. This is the accepted cost, and it is the same cost ADR-PR801 already
  accepted on the reset path — one less surface to explain to the user.
- **It breaks RST-UAT-0011**, which asserts that login cannot distinguish a wrong password
  from an unknown account. The requirement document and the live spec are amended in this
  change to the new expectation; the case number keeps its meaning ("no silent differences
  between matched and unmatched requests") only for the OTP path.
- **RST-UAT-0005's 401 stays valid** for a wrong password, and a locked account is now a
  `423`, not a `401`. Any client that branches on `status === 401` to show "wrong password"
  must be updated to read `code`.
- Clients must render `error` verbatim instead of mapping it — that mapping is what
  generalised the message in the first place. The BFF forwards `code` and the 4xx/5xx status.
- Attackers get one more signal for free: nothing about the password-strike budget changes,
  so the lockout still absorbs guessing.
- Revisit if abuse appears: per-identifier throttling or CAPTCHA on login, or fold
  `account_not_found` back into `incorrect_password` while keeping the lockout/suspension
  distinction (which is the part that actually cost a user their afternoon).

## Records amended by this decision

Every one of these asserted the generic login answer as the contract, so each had to change
with the decision rather than be left to go red on its own:

- `docs/qa/food-uat-332/cluster-a-identity-rbac.md` — RST-UAT-0011 (login half superseded,
  reset/OTP half unchanged) and RST-UAT-0005's evidence cell, plus a dated "Contract
  amendment" section holding the old and new behaviour side by side.
- `mobile-app/reactnative/tests/e2e/food-uat/cluster-a-identity-rbac.spec.ts` — the two
  executable legs now assert `code` + sentence instead of `invalid credentials`.
- `docs/qa/events-uat-299/cluster-events-a.md` — note on EVT-UAT-006 / `EX-A-05`, whose
  recorded evidence was "3x wrong password and unknown-account all -> identical 401".
- `docs/audit/E2E_TEST_MATRIX.md` — the "Login (bad password)" row now lists the taxonomy.
- `frontend-web/tests/e2e/helpers/auth.ts` + `tests/e2e/auth.spec.ts`,
  `mobile-app/reactnative/tests/e2e-live/mob-005-invalid-credentials.spec.ts` — the live
  lanes accept the named sentence and the legacy copy (they measure whatever is deployed);
  the per-cause contract itself is pinned by unit tests that control the response:
  `backend/internal/handlers/auth_login_error_classes_test.go`,
  `frontend-web/tests/unit/auth/login-proxy.test.ts`, `frontend-web/tests/unit/auth/login-flow.test.ts`,
  `mobile-app/reactnative/tests/unit/auth/errorMapper.spec.ts`.

## Deliberately not changed

- **Admin and hotelier sign-in** (`frontend-admin/src/features/auth/adminAuth.ts`,
  `hotelierAuth.ts`) still call `supabase.auth.signInWithPassword` directly, so they bypass
  Go, its lockout, and this taxonomy entirely. That is a separate gap (no strike budget, no
  audit row, no cause naming on the console), not a client-rendering one.
- **Open Mic web login and mobile `auth.api.readableAuthError`** already pass an unknown
  message through untouched, so the named sentences reach the user unchanged; comments in
  both files forbid re-generalising them.
- **`POST /api/auth/request-password-reset`** keeps ADR-PR801's behaviour, and the **OTP
  sign-in path** stays generic.

## Separate defect found while writing this (not fixed here)

A successful password reset does not clear `failed_login_attempts` or `locked_until`
(`AuthHandler.ResetPassword` → the RPC that writes the new password touches neither column).
So the "Use Forgot password to reset it" clause in `incorrect_password` gets a person back in
on the next attempt, but it does **not** shorten an active lock — the countdown still has to
run out. The `account_locked` sentence therefore promises only the wait and never the reset;
clearing the strike budget on a completed reset is the fix, and it needs its own change
because it alters a security control.
