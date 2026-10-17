# ADR-PR801: Password-reset request says when no account matches

## Status
Proposed

## Context
#788 made every step of password reset answer identically whether or not an account exists, to avoid an account-enumeration oracle. In practice a mistyped email moved the user to the code screen and no code ever arrived, with no hint why.

## Decision
Only the **request** step (`POST /api/auth/request-password-reset`, proxied by `/api/auth/forgot-password`) answers `404 account_not_found` when the identifier resolves to no account (unknown email, or a phone matching nothing). No code is sent in that case. Mobile and web show "No account found for <what was typed>."

- If the account lookup itself errors, the answer stays the neutral 200 and the code is sent: an outage must not tell a real user their account is missing.
- Verify and reset steps are unchanged and still answer identically for every identifier.
- The per-IP reset limiter on the route is unchanged and is the only brake on enumeration.

## Consequences
- Anyone can learn whether an email or phone is registered, bounded only by the rate limiter. This was a conscious product choice (usability over enumeration resistance).
- Timing is no longer equalised between matched and unmatched requests.
- Revisit if abuse appears: add per-identifier throttling or CAPTCHA, or revert to the neutral answer.
