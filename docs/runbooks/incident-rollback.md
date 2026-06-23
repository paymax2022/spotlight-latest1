# Runbook — Incident response & rollback

> Audience: on-call engineer. Satisfies RELEASE_READINESS §5 ("Incident
> rollback/runbook docs"). These are HUMAN steps; nothing here is automated.
> First action for any money/security incident is almost always **disable the
> feature flag** (see `feature-flag-disable.md`), not a code rollback.

## 0. Severity & first move

| Symptom | Sev | First move |
|---|---|---|
| Ledger drift / wallet ≠ ledger (LedgerInvariantDrift) | P0 | FREEZE money flags immediately → `feature-flag-disable.md` |
| Money-path error rate / webhook failures | P1 | Disable the affected module flag, then investigate |
| Authz/security spike | P1 | Assess: attack vs regression. If regression from a deploy → rollback |
| Latency only, no errors | P2 | Investigate provider/DB; no rollback yet |

Open an incident channel. Assign one Incident Commander. Record a timeline.

## 1. Identify the trigger

- Check the Grafana **Paymax — Money Path & Security** dashboard and the firing
  alert's `description`.
- Correlate with the deploy annotation timeline. **Did an incident start right
  after a deploy?** If yes, the deploy is the prime suspect → roll back.
- Check Sentry for the error class (`tags[surface]:money-path|security`).

## 2. Mitigate before you fix

Order of preference (fastest, lowest blast radius first):

1. **Feature-flag disable** the affected module (`feature-flag-disable.md`).
   This is the primary mitigation — modules are flag-gated by design.
2. **Provider pause** — if a provider (Paystack) is the cause, stop initiating
   new provider calls (flag disable already does this for the module).
3. **Code rollback** — only if the bad change is not flag-gated.

## 3. Code rollback (frontend-web / cPanel)

Deploy is `frontend-web` build → SCP → Passenger restart (deploy-cpanel.yml).
There is no built-in version rollback, so roll back by **re-deploying the last
known-good commit**:

1. In GitHub, identify the last green `main` commit BEFORE the bad deploy
   (CI must have been green — see `ci.yml`).
2. Re-run the `Deploy to Namecheap cPanel (SSH)` workflow against that commit
   (Actions → select the workflow run for that commit → Re-run), **or** revert
   the offending commit on `main` (a normal PR, CI must pass) and let the push
   trigger deploy.
3. Confirm Passenger restarted: the deploy step writes `.htaccess` and touches
   `tmp/restart.txt`. Hit the health route to confirm the old build is serving.
4. **Do not hand-edit files on the cPanel server.** All changes go through the
   pipeline so the next deploy doesn't silently overwrite a manual fix.

> Gap (risk INF-1/INF-3): cPanel has no blue/green and a brief restart blip is
> expected. Communicate the short downtime in the incident channel.

## 4. Backend (Go) rollback

The Go backend has no automated deploy pipeline yet (audit gap INF-5). Until one
exists, roll back by redeploying the previous container image / binary by hand
on the backend host. Record exactly what was done in the incident timeline.

## 5. Database — there is NO migration rollback

Migrations are **additive-only and immutable** (CLAUDE.md iron rule). You do
**not** "roll back" a migration.

- A bad schema change is fixed with a **new additive forward-fix migration**,
  reviewed and applied through the normal path. Never DROP/ALTER to undo.
- If a migration was applied to cloud that should not have been, escalate to the
  DB owner; do not attempt destructive correction. The additive-only CI guard
  (`_reusable-migration-guard.yml`) exists precisely to stop this class of
  incident before merge.
- Because schema is additive, an old build keeps working against the new schema,
  which is exactly why code rollback (step 3) is safe.

## 6. Verify recovery

- Alert clears and stays clear for 15 minutes.
- Run the post-deploy smoke checks from `go-live.md` §Smoke.
- For money incidents: confirm ledger invariant job reports balanced
  (`ledger_balanced == 1`, `wallet_balance_matches_ledger == 1`) before
  re-enabling any money flag.

## 7. After action

- Re-enable flags only after root cause is fixed and verified in staging.
- Write a short post-incident review: timeline, root cause, what alert caught it
  (or didn't — file a gap), and follow-ups. Link from `docs/adr/` if a design
  decision changed.
