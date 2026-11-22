# F2 project-token probe — the one cell that decides the release wall

Status: built, first dispatch pending. Reading of the wall: [railway-f2-staging-upload](./railway-f2-staging-upload.md) is the fault ledger; [admin-console-production-errors-2026-11-20.md](./admin-console-production-errors-2026-11-20.md) carries the owner-run recipes.

## The question, in one sentence

Every `deploy Staging (…)` leg of every release train since 2026-11-16 dies on
`Failed to fetch: error decoding response body` (F2), which skips `smoke Staging`
→ `migrate production` → `deploy Production` → `smoke Production`, so `main`
never reaches staging or production on its own — while the GraphQL mutation
`serviceInstanceDeploy(serviceId, environmentId, latestCommit: true)` promotes
the same three staging services with no upload at all, in about three minutes.

What is not known is whether that mutation works with the credential a runner
holds. `RAILWAY_TOKEN_STAGING` is a **project token**; the working calls above
were made with the owner's **user session**. `projectTokenCreate` is refused for
that session, so the token that matters only ever exists inside CI — which is
why this is a workflow and not a laptop command.

## The 2×2

| | user session (owner CLI) | project token (CI secret) |
|---|---|---|
| **reads** (`project`, `serviceInstance`) | works — proven 2026-11-22 | works — proven by every `railway up` leg that gets as far as stamping `BUILD_COMMIT` |
| **`railway up` upload** | works — every manual deploy in the ledger | **fails with F2** — 9 retries per leg, three legs per train, reproduced on runs `44922280434` and `44927881957` |
| **`serviceInstanceDeploy(latestCommit:true)`** | works — staging promoted to `f9309845c` on 2026-11-22 with zero uploads | **THIS PROBE** |

One cell. If it returns `project-token-can-deploy`, the fix to `release.yml` is
to swap the three staging legs from `railway up` onto this mutation — a script
call per environment, staging-only at first, and the wall moves without touching
the upload path at all. If it returns `token-scope-blocks-mutation`, the token
is the variable and the ask goes to Railway. If it returns
`f2-reproduces-on-the-mutation-path`, then F2 is the transport or the edge, not
the upload endpoint, and no CI-side script change will fix it.

## How to run it

Dispatch-only by construction — no `push`, `schedule`, or `pull_request` trigger
exists on this file, so pushing it cannot reach Railway:

```bash
# 1. read-only: two queries per service, no state change. Run this first.
gh workflow run ci-f2-token-probe.yml --ref ci/f2-project-token-probe \
  -f mode=read-only -f service=backend

# 2. the missing cell: one real staging deploy, backend only.
gh workflow run ci-f2-token-probe.yml --ref ci/f2-project-token-probe \
  -f mode=mutate -f service=backend
```

Then read the run:

```bash
gh run view <run-id> --log-failed 2>/dev/null | grep PROBE_
gh run view <run-id>            # the job summary table
```

## Reading the output

Each cell prints a line, then one verdict:

```
PROBE_CELL auth=ok (http=200)
PROBE_CELL baseline=ok row=005ab765 status=SUCCESS
PROBE_CELL mutation=accepted (http=200)
PROBE_CELL readback=build-success after 15s
PROBE_VERDICT[backend]=project-token-can-deploy
```

| `PROBE_VERDICT` | what it means | next step |
|---|---|---|
| `project-token-can-deploy` | the token can drive the mutation and a new SUCCESS row appeared | propose the `release.yml` staging-leg swap (owner sign-off: it is a CI change) |
| `token-deployed-but-build-failed` | the token can deploy; the build itself failed | read the deployment's build log — this is now a normal CI failure, not F2 |
| `mutation-is-noop-for-project-token` | returned `true`, created no row | same shape as production's git-less `frontend-admin`: promotion needs a git-connected service, keep `railway up` |
| `token-scope-blocks-mutation` | GraphQL said Forbidden to a token that can read | ask Railway for deploy scope on the project token; the upload stays broken |
| `token-rejected-at-graphql` | the mutation itself was refused while reads pass | secret is scoped to reads only — same ask, sharper |
| `f2-reproduces-on-the-mutation-path` | the mutation returned an undecodable body | F2 is the transport/edge; stop changing scripts, escalate to Railway with the timing pattern |
| `read-path-fault (…)` | even the plain read did not decode from inside the runner | the runner's network is the variable, not the token — compare against a self-hosted runner |
| `token-cannot-authenticate (…)` | the token did not authenticate at all | check the secret is `RAILWAY_TOKEN_STAGING` and unexpired; the probe is inconclusive, not the token |
| `accepted-awaiting-build (…)` | accepted, row appeared, still building when the budget ran out | re-dispatch; raise `PROBE_POLL_BUDGET_S` above 300 for the frontends |
| `read-only-ran` | reads proved, no mutation attempted | dispatch the mutate cell |

`auth != ok` makes the job exit non-zero: a probe that could not authenticate is
a failed probe, not a verdict.

## What the probe deliberately does not do

**It never runs `railway up`.** An upload probe cannot be made safe: an upload
that *succeeds* from a throwaway directory deploys that directory to staging.
The mutation needs no archive, which is the entire point of it. The offline test
asserts this on the script's code, comments stripped, because the script's own
header mentions the phrase.

**It has no production environment id.** `STAGING_ENV_ID` is hardcoded
(`6b5f27a3-…`) and the workflow exposes no `environment` input, so no dispatch
combination can aim this at production. `PROBE_ENVIRONMENT_ID` is overridable
only by editing the script.

**One cell is still unprobed and cannot be:** whether the token's *upload*
request would succeed if it were not for F2. The public API exposes no
`uploadInitiate` mutation to call directly (introspected 2026-11-22), so the
only way to exercise it is a real upload — which is the thing that fails.

## Verification

`scripts/ci/test-f2-token-probe.sh` runs in the `ci.yml` hygiene job beside the
deploy-retry test: **52/52 green** locally on 2026-11-22, no network to Railway.
It covers the classifier with recorded payloads (including the measured
HTTP-200 `Not Authorized` body — Railway does not use the status code for auth,
so any logic keyed on HTTP alone reads a token failure as success), plus
end-to-end runs of the whole script against `scripts/ci/f2-probe-stub.py`:
a green stub whose verdict must be `project-token-can-deploy`, an unauthorized
stub that must **not** print it, and an undecodable-body stub in both modes.

Both guards were mutation-proved, which is the only reason they are worth
citing — a green suite proves nothing until the defect it names is installed on
purpose and made to go red:

| mutant installed | result |
|---|---|
| `mode == "read-only"` checked before `auth` | 3 failures — the faulting read-only run reports `read-only-ran` |
| HTTP code returned through a variable instead of a file | 11 failures, every cell classified as a transport error |

Restored by `cp` and re-asserted byte-identical by sha256 in both cases, then
re-run to 52/52.

Two live defects the stub found while writing it, both of which would have
produced a confident wrong answer in CI:

1. `HTTP_CODE` was assigned inside `gql`, and every call site is
   `body=$(gql …)` — a subshell. The parent always saw an empty code, so every
   cell classified as `transport-error-no-response` and the job would have
   exited 1 against a healthy staging project. The status now travels through
   `$HTTP_FILE`, and the assertion lives on the raw line
   `PROBE_CELL auth=ok (http=200)`, not on the verdict, because that is where
   the loss showed up.
2. `final_verdict` consulted `mode` before `auth`, so a read-only dispatch whose
   reads already failed to decode answered `read-only-ran` — a clean-looking
   result for a run that had just reproduced F2 on the cheapest path available.
   `auth` now outranks `mode`, and a non-decoding read is reported as
   `read-path-fault` rather than blamed on the secret.

The same three documents were validated against the real API over the owner's
session (`PROBE_TRANSPORT=cli PROBE_MODE=read-only`), which is why the transport
exists: `auth=ok`, `baseline=ok row=005ab765 status=SUCCESS`, so the query
shapes and every id in the script are confirmed live without a project token
ever being handled locally.

