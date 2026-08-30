# ADR-PR<pr-number>: One review path, one live application per contest

- **Status:** Accepted
- **Date:** 2026-08-30
- **Module:** registration → voting seam

## Context

An applicant registered for "September Open Mic Challenge", an admin approved
them, and nothing appeared in the mobile app. The database explained why: four
registrations sat in `approved`, and exactly one had a matching `contestants`
row.

The promotion seam was not missing. `promote_registration_to_contestant()`
existed and worked, and the Go path (`RegistrationAdminStore.SetStatus`) called
it inside the same transaction as the status change — deliberately, so a commit
could never leave an approved entry nobody can vote for.

The admin console does not use that path. It posts to the Next handler
`/api/admin/registration/applications/[id]/review`, which reached
`reviewRegistrationApplication` in `src/server/registration/supabase-store.ts` —
a second implementation of the same operation that updated `registrations.status`
and inserted an audit event, and never called the seam. Both were "the review
code"; only one kept the roster consistent.

Separately, nothing enforced one application per contest. One account held five
registrations for `open-mic-competition`, two of them `approved`. The contest
screen offered "Register / Apply to Compete" unconditionally, so applying again
was the only thing the UI let an existing applicant do.

## Decision

**1. One review path, in the database.** A new
`review_registration_application(id, status, note, actor_role)` performs the
status change, the audit event and the roster move in one transaction. The Next
store calls it. The logic now lives in one place both callers reach, rather than
in a third copy that can drift again.

**2. The database owns the one-application rule.** A partial unique index on
`(user_id, contest_slug)`, excluding the terminal statuses
(`withdrawn`, `rejected`, `disqualified`, `eliminated`), so a rejected or
withdrawn applicant may apply again. The API check exists to return the
applicant's existing application instead of a constraint violation — it is the
friendly error, not the authority.

**3. The check sits after contest resolution, not at the route.** Callers pass
either a slug or a contest id (the mobile contest screen passes an id), so a
check on the raw request value would miss half the duplicates. It runs inside
`startRegistrationDraft`, after `resolveAnyContest`.

**4. Existing duplicates were collapsed, not deleted.** The furthest-along and
most recent entry per `(user, contest)` survives; the rest become `withdrawn`
with an audit event recording why. Four rows were collapsed for one account.

## Consequences

- Approving from the admin console now puts the applicant on the roster. A
  transition that cannot promote rolls back rather than committing a status the
  roster does not reflect.
- `POST /api/registration/applications` answers **409** with the existing
  application when one is live. Mobile routes into it rather than reporting a
  failure the applicant cannot act on.
- The contest screen offers "Manage Your Application" / "Continue Your
  Application" when a live application exists, via
  `GET /api/registration/for-contest`.
- Registrations whose `contest_slug` has no `connect_contests` row still promote
  with a NULL contest, per the original seam. Those contestants are on no
  roster and are votable nowhere — `open-mic-competition` is in this state. That
  is pre-existing data, not something this change introduces, and it is worth
  addressing separately.

## Alternatives considered

- **Point the admin console at the Go endpoint.** Would also have removed the
  duplicate implementation, and is arguably the cleaner end state. Rejected for
  now because the two surfaces authenticate differently (console admin identity
  vs. a user JWT with `contestant.approve`), which makes it a larger change than
  the defect warrants. The database function leaves that migration open.
- **Call the RPC from the Next store after the update.** Simpler, but restores
  the exact failure being fixed: a status update that commits while the promotion
  fails.
