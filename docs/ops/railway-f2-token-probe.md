# F2 project-token probe — the one cell that decides the release wall

Status: built and tested (PR #1143); the mutate cell is **still unrun**, because
`workflow_dispatch` only registers a workflow that exists on the default branch —
so this file has to land before the probe can fire. Reading of the wall:
[railway-f2-staging-upload](./railway-f2-staging-upload.md) is the fault ledger;
[admin-console-production-errors-2026-11-20.md](./admin-console-production-errors-2026-11-20.md)
carries the owner-run recipes.

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

## Why this cannot be answered from a laptop

Tried and refuted on 2026-11-22, so nobody re-attempts it:

- `projectTokenCreate(input: {projectId, environmentId, name})` — all three
  fields are `NON_NULL String`, and the mutation returns a bare `String`, not a
  `ProjectToken` object. Sent correctly from the owner session it answers
  `HTTP 200` + `errors[0].message = "Not Authorized"`, `path: ["projectTokenCreate"]`.
  The account owner cannot mint a project token, so there is no local stand-in
  for `RAILWAY_TOKEN_STAGING`.
- `projectTokens(projectId:)` is a Relay **connection** whose only fields are
  `edges` and `pageInfo` — there is **no `nodes`**. `{ id name }` directly on it,
  or `{ nodes { … } }`, both fail validation, which is what makes
  "list the tokens and reuse one" a dead end as well as a bad idea.
- The GitHub secret's value is not readable by design (`/actions/secrets`
  returns names only).

What the list *does* show, via `edges { node { id name createdAt } }`
(names and ids are not secrets), is the credential class CI holds:

| token id | name | created |
|---|---|---|
| `c0a9a094` | `github-staging-action` | 2026-11-18 21:17Z |
| `7fc8b1c3` | `staging-new` | 2026-11-18 21:12Z |
| `89729d2d` | `production` | 2026-11-16 15:04Z |
| `f2aae2c5` | `development` | 2026-11-14 19:42Z |

Four tokens, none of them minted by this work — which also confirms the refused
mint above wrote nothing. The name `github-staging-action` is what
`RAILWAY_TOKEN_STAGING` almost certainly is, so a throwaway staging-scoped token
would have been the right *kind* of stand-in; it simply cannot be created from
the owner session.

One transport trap worth knowing before re-attempting any of this: when
`railway api --compact` hits GraphQL errors it prints a **prose line**
("Railway API returned 1 GraphQL error(s)") instead of JSON. A caller that only
checks "is the output non-empty" will hand that sentence to the next step as a
credential.

So the cell is fillable exactly one way: a runner that already holds the secret.

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
exists on this file, so pushing it cannot reach Railway. `--ref main` is
required, not stylistic: dispatching from the feature branch was tried and
answered `HTTP 404: workflow ci-f2-token-probe.yml not found on the default
branch`, because GitHub registers `workflow_dispatch` workflows only from the
default branch. Land it first, then:

```bash
# 1. read-only: two queries per service, no state change. Run this first.
gh workflow run ci-f2-token-probe.yml --ref main -f mode=read-only -f service=backend

# 2. the missing cell: one real staging deploy, backend only.
gh workflow run ci-f2-token-probe.yml --ref main -f mode=mutate -f service=backend
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
| `token-read-unexpected (…)` | the read failed with wording outside the auth/forbidden sets | read the raw cell body in the log; the classifier is guessing, the API is saying something new |
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
deploy-retry test: **55/55 green** locally on 2026-11-22, no network to Railway.
It covers the classifier with recorded payloads (including the measured
HTTP-200 `Not Authorized` body — Railway does not use the status code for auth,
so any logic keyed on HTTP alone reads a token failure as success), plus
end-to-end runs of the whole script against `scripts/ci/f2-probe-stub.py`:
a green stub whose verdict must be `project-token-can-deploy`, an unauthorized
stub that must **not** print it, and an undecodable-body stub in both modes.
The remainder are wiring invariants read off the workflow and the script
themselves: dispatch-only, defaults to `read-only`, repository guard, staging
secret, `PROBE_TRANSPORT: curl`, no environment input, the one hardcoded
environment id is staging's, the summary step cats the file the script writes,
and every form input lands on a variable the script actually reads. It uses
regex rather than PyYAML because the hygiene job's `python3` has no third-party
packages installed.

Three guards were mutation-proved, which is the only reason they are worth
citing — a green suite proves nothing until the defect it names is installed on
purpose and made to go red:

| mutant installed | result |
|---|---|
| `mode == "read-only"` checked before `auth` | 3 failures — a faulting read-only run reports `read-only-ran` |
| HTTP code returned through a variable instead of a file | 11 failures — every cell classified as a transport error |
| workflow env key renamed back to `SERVICE_NAME` | 1 failure — the `service` input would silently probe `backend` |

Restored with `cp`, re-asserted sha256-identical in every case, then re-run to
55/55.

Three live defects that would have produced a confident wrong answer in CI:

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
3. The workflow exported `SERVICE_NAME` while the script reads
   `${PROBE_SERVICE_NAME:-backend}`, so `service=frontend-web` would have
   probed backend and printed a real-looking verdict for the wrong question.

The same three documents were validated against the real API over the owner's
session (`PROBE_TRANSPORT=cli PROBE_MODE=read-only`), which is why the transport
exists: `auth=ok`, `baseline=ok row=005ab765 status=SUCCESS`, so the query
shapes and every id in the script are confirmed live without a project token
ever being handled locally.

