# ADR-PR1019: Production gets its own module-flag lane, and it never moves the release

**Date:** 2026-11-14  
**Status:** Accepted  
**Deciders:** platform ops, payments/finance module gate  
**Related:** ADR-PR996 (module readiness as a second axis — its "no production counterpart" consequence is closed here), ADR-PR884 (remove Maplerad; decision 5 completes here), ADR-PR876 (gate enforcement)

## Context

ADR-PR996 established that publication in the admin console is not what makes a module reachable.
`modules.NewService` applies an operations kill switch on top of the published registry row:

```go
func(envFlag string) bool { return os.Getenv(envFlag) == "true" }
```

Two properties of that line drive this whole decision.

It is a **raw read, not `getEnvBool`**. The literal string `true` is the only value that enables a
module; `1`, `yes` and `True` leave it disabled while looking enabled in every dashboard that shows
the variable. So the flag cannot be operated by inspection — it needs a writer that guarantees the
byte-exact value and a reader that proves it landed.

And it is **one of two levers**, which is why "admin enabled it but users still cannot see it" is a
reportable state rather than a bug in the registry. Measured on production the same day: 36 modules
are `ready` **and** `visible` in the registry, and 31 are actually served. The five-module gap is
entirely the `FEATURE_*` lever.

`staging-module-flags.yml` has done this for staging for months. Production had no counterpart, and
for two weeks that was written in the past tense for a reason: every `RAILWAY_TOKEN_*` secret
Actions holds was rejected on read, so no lane could authenticate against the production
environment at all (ADR-PR996 Amendment, evidenced from the failed runs' own output). The owner
minted working project tokens on 2026-11-14, which is what made this file writable instead of
merely desirable.

Production also differs from staging in a way that makes the staging lane unsafe to copy. Production's
backend is **not main head** — it runs a pinned narrow release (`585bd2ca7`: the Oct-17 production
base plus the #996 cherry-pick) because main carries migrations production has never applied.
Staging's lane ends its write with `railway redeploy … --from-source` as a fallback, which on
production would pull the connected branch and pair a new binary with a schema it does not match.

## Decision

1. **Add `prod-module-flags.yml`, `workflow_dispatch`-only.** Nothing in this lane can fire from a
   push or a schedule, and merging it changes no running system.
2. **Every job runs under the GitHub `production` environment**, which carries required reviewers.
   A human click is what executes any of this; the lane cannot approve itself.
3. **A restart never pulls a source.** `--from-source` is absent by design. The restart re-runs the
   existing deployment, and the build identity — `GET /api/v1/public/build`, the commit baked by
   `-ldflags` — is read **before** the restart and **after**, and the job fails if either side
   disagrees with the operator's pin. A release that rides along with an ops restart on production
   is the failure this rule exists to catch.
4. **Writes go in with `--skip-deploys`, then exactly one guarded restart.** Railway redeploys on
   every variable write otherwise, so N flags would queue N rolling restarts of a live API. The
   flag belongs to the parent `variable` command, not to the `delete`/`set` subcommand.
5. **The value may only ever be the literal `true` or `false`.** The validator refuses any other
   string, so the trap in the context section cannot be created from this lane, and the read-back
   step compares against the requested literal rather than a truthiness coercion.
6. **Arming `FEATURE_MODULE_GATE_ENFORCE=true` requires `confirm=PRODUCTION-ENFORCE`.** The gate is
   an orthogonal switch: with it on and any module flag still unset, mapped live routes answer 503.
   A routine flag write must not be able to reach that state by accident.
7. **Never print a value.** `--json` only, only into a file, and the log carries a variable *name*
   plus a true/false verdict. `--kv` wins over `--json` when combined and prints every value in the
   clear, which is how `ADMIN_API_KEY` leaked on run 32545670584. The one exception is a flag's own
   value, which the operator typed into the dispatch form.
8. **Key rotation writes both sides in one step and never clears.** `RequireAdmin` fails open on an
   empty key, so a window where the backend has no value is a window where admin endpoints are wide
   open. The value is generated into a shell variable and piped with `--stdin` — never a file on a
   shared runner that also calls `upload-artifact` — then both services are compared by `sha256`
   prefix so agreement is provable without the secret reaching a log.
9. **The browser-bundled copy is checked *after* it is deleted, never before.** The first draft
   asserted `NEXT_PUBLIC_ADMIN_API_KEY` absence inside the agreement check two steps earlier, which
   hard-failed the job on the exact condition the following step existed to repair: the fix could
   never run. Ordering an assertion after its remedy is part of the design, not a detail.
10. **Mirror to `frontend-web` by default.** Its Next routes re-check their own copy of a module's
    flag (`src/lib/feature-flags.ts`) before proxying, so a backend-only write still answers 503 at
    the BFF. Measured today: 47 `FEATURE_*` names are shared between backend and frontend-web with
    **zero** value disagreements, and 7 exist on the backend only — the mirroring gap this closes
    going forward.
11. **Dead provider configuration is removed, not left documented.** The `ALPACA_*` block in
    `backend/.env.example` named four variables that no code in `backend/` reads — the AI-trading
    fund moves cash through the finance ledger and never places a venue order — while inviting
    operators to paste live broker credentials into a service that would ignore them. The deployed
    copies are deleted from the production and staging backends, and with them the orphan
    `FEATURE_MAPLERAD_ENABLED` that **ADR-PR884 decision 1 already ordered gone** ("no shim, no dead
    flag") but which survived in both tiers with zero readers repo-wide.

## Consequences

- Module availability on production becomes an auditable operation instead of a hand-edit of a
  Railway dashboard: one dispatch, a snapshot of the served set taken first, a read-back of every
  write, and a diff of the served set after the restart.
- The `true`-only rule means an operator can no longer "enable" a module in a way that only looks
  enabled. Verification compares the literal.
- The lane cannot be used to ship code. An operator who wants a new build on production must use the
  release path; this one refuses unless the running commit already matches the pin they supplied.
- Completing ADR-PR884's cleanup leaves **all three services on both tiers** with zero `ALPACA` and
  zero `MAPLERAD` variables (production backend 135 → 130, staging backend 149 → 144 across the two
  passes; `frontend-web` never carried either name, verified rather than assumed), each written with
  `--skip-deploys`, with build identity unchanged and no restart triggered.
- Two decisions stay with the owner, deliberately not taken here: **which** of the five dark modules
  (`insurance`, `beneficiaries`, `walletBankTransfers`, `checkoutTopupTier0`, `tierLimits`) becomes
  publicly usable — that is a product call about what is finished — and **when** `ADMIN_API_KEY`
  rotates, since the lane applies it the moment the job runs.
- `ARENA_AWARD_SIGNING_SEED` rotation is out of scope on purpose. `FEATURE_ARENA_ENABLED=true` in
  production, and rotating that seed invalidates credentials already issued, so it needs a count of
  live signed merit/award rows first rather than a safety-improving but destructive click.
- What this lane does **not** prove: an actual write through the Railway API from an Actions runner.
  Every guard in it was exercised locally against stubs and the read-only production endpoints, but
  the first `redeploy=false`, `flags=` dispatch is the real end-to-end proof, and it writes nothing.
