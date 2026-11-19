# ADR-PR1095: A referral code is one value across three namespaces

Status: implemented in application code. The schema work this decision
describes but does not perform is recorded under "Deferred" below.

## Context

`PutAdminReferralsByReferrerIdCode` lets an admin replace a referrer's
generated code with a memorable one (`JIDE1` on a flyer). The whole risk of
that feature is collision, and the endpoint decided "free" from a single
query: `referral_links.code = $1`, exact case.

A referral code does not live in one place. Three tables can hold the code a
registered user is known by, and the read paths do not agree on which one wins:

| Table | Who reads it | Case | Index |
| --- | --- | --- | --- |
| `public.referral_links.code` | attribution, first (`RewardService.resolveCode`) | exact comparison | `referral_links_code_key` — UNIQUE on the raw value |
| `public.finance_referral_codes.code` | attribution, fallback — and first for both displays | folded | `finance_referral_codes_code_ci_unique_idx` on `upper(code)` (ADR of 2027-02-18, migration `20270218000000`) |
| `public.platform_users.referral_code` | the admin user record; `Service.LookupCode` reports it as `source: "platform_users"` when neither code table has a row | unmanaged | legacy `platform_users_referral_code_key` on the raw value, no folded index |

Two consequences followed directly from checking one of the three, case-sensitively:

1. **Silent attribution hijack.** Codes minted before REF-004 sit in
   `finance_referral_codes` in lowercase. An admin setting `ABCDE` passed the
   `referral_links`-only check, and both rows then matched a caller typing
   `abcde` — the resolver returns whichever row the planner reaches first, so
   every future signup using that code credited an owner chosen by the query
   planner. No error is raised anywhere in that path.
2. **An edit that changed nothing the referrer could see.** The customer's own
   referral screen (`frontend-web app/api/v1/referrals/me` →
   `financeService.getOrCreateCode`) and the console's read (`Service.LookupCode`)
   both prefer the legacy row, and the legacy row is older, so its
   first-minted-code convergence rule reasserts it. Writing only
   `referral_links` left one person showing two codes.

The write also had no transaction boundary, which is the same bug as (2) in a
different place.

## Decision

**Uniqueness is defined over all three namespaces, folded, and read from
inside the write's own transaction.**

`codeOwnerIn(ctx, rq, code)` takes the read handle as a parameter, so
`SetLinkCode` asks it after `BEGIN`. The answer then describes the same
snapshot the write lands on, instead of a moment that has already passed.
It matches every branch through `UPPER(...)` / `upper(referral_code)` because
the resolver folds case: comparing exactly would call a lowercase legacy code
free while `UPPER(code)` still finds it at attribution time.

**An edit converges every namespace that already records this user's code.**
`referral_links` is the canonical write. `finance_referral_codes` is updated
where the user has a row — leaving it is consequence (2) above.
`platform_users.referral_code` is updated **only where it already holds a
value**: `WHERE id = $1 AND referral_code IS NOT NULL AND referral_code <> ''`.
An admin renaming a code is not the event that starts writing a third column
nobody maintains.

**The duplicate read is not the guarantee; the unique indexes are.** The read
narrows the window, the write resolves it, and a `23505` on any of the three
statements maps back to `ErrCodeTaken` → 409 rather than surfacing as a 500 —
a taken code is a normal outcome. Re-assigning a user their own existing code
stays a no-op success so a double-submit from the console is not a failure.

`referral_links` keeps its exact-value UNIQUE deliberately. Folding it would
make the folded index and the raw index two different definitions of "same
code" on one table; renames are bounded by the folded read above and by the
legacy table's folded index.

## Why the third namespace matters more than it looks

`platform_users.referral_code` held **0** non-empty values in the local dev
database, which invites treating the branch as dead weight. Three things say
otherwise:

- Its origin is untraceable. There is no foreign key from `platform_users.id`
  to `auth.users` (`20270101000000` adds the table without one), the
  `on_auth_user_rbac_bridge` trigger that files auth rows does not populate
  the column, and no function in the migration tree writes it. A field with
  values and no writer in the schema is a field some application layer owns.
- A count of zero in dev is not a count of zero in production, and production
  cannot be queried from this machine.
- `Service.LookupCode` returns it as a code a user holds, which makes it
  load-bearing for the display rule even when empty.

So it is checked, and it is converged only when already set — both halves of
that are the honest limit of what the evidence supports.

## Deferred

Deliberately not in this change, in priority order:

1. **No migration.** A folded `UNIQUE` on `platform_users.referral_code` and
   folded indexes to serve the `UPPER()` lookups are both real gaps, but this
   repo's migration ledger is additive-only across 758 files and
   `supabase db push` refuses on a whole-database preflight: a single legacy
   duplicate turns a rollout into a stalled deploy. Before any of this DDL,
   run the census on the target environment with the read-only recipe in the
   service-pooler shape (session pooler drops `options`, so
   `BEGIN READ ONLY` has to wrap the statements) and confirm whether
   `platform_users_referral_code_key`'s legacy exact UNIQUE is still present,
   because a folded unique over it can be a strict superset of an existing
   constraint.
2. **Renaming a code that already carries attributions** is still allowed. The
   console warns nothing. A code with earned `referral_attributions` rows is
   someone's reward history; moving it reassigns the future, not the past.
   Worth a product call before it becomes a support ticket.
3. **The random-mint paths** (`Service.GetOrCreateCode`,
   `RewardService.GetOrCreateLink`) keep their own collision retries; they are
   unchanged apart from sharing `GenerateCode`.
4. **`public.referral_codes`** (voting engine, migration `20270512000000`) is a
   different namespace with its own contract slug and is not in the
   attribution read order, so it is outside this rule. `public.referral_vanity_links.alias`
   (invite links, `20260914000200`) is a URL slug unique per user, not a code a
   referrer types, and nothing in `resolveCode` reads it.

## Consequences

The uniqueness check is one `UNION` over three tables inside the write
transaction, and only one of the three branches is indexed for it:
`finance_referral_codes` matches `upper(code)` directly, while an exact UNIQUE
cannot serve `referral_links`'s `UPPER(code) = $1` and `platform_users.referral_code`
carries no folded index either — those two are seq scans today. On tables this
size the write path is dominated by its own three statements, so the check is
not the reason to schedule a migration; the deferred folded indexes in item 1
are what make the rule cheap enough to keep.

Admins get one answer per code: `409` and "already in use" mean someone holds
it in a namespace the console does not show them, which the openapi `409`
description now names explicitly.
