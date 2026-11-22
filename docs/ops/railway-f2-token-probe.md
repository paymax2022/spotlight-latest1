# F2 project-token probe — the one cell that decides the release wall

Status: **the cell is filled, and the answer is a refusal.** Both dispatches ran
from `main` on 2026-11-22 with the same `RAILWAY_TOKEN_STAGING` and the same
`project { id name }` document, and both were refused on every cell they probed:

| run | created | mode | cells |
|---|---|---|---|
| `45009371410` | 09:49:03Z | read-only | `auth=token-rejected (http=200)`, `baseline=token-rejected` |
| `45009997472` | 09:56:55Z | mutate | `auth=token-rejected (http=200)`, `baseline=token-rejected`, `mutation=token-rejected (http=200)` |

Both jobs therefore ended the *authentication* verdict, `token-cannot-authenticate
(token-rejected)` — the name it carried when those runs happened, and the reason
it no longer exists: that wording asserted a bad secret value, when Railway
answers `Not Authorized` for a missing scope with the byte-for-byte same body. It
now prints `token-refused-at-read (token-rejected)` and points at the comparison
that can tell the two apart. That is also why the mutation answer needed its own
line in the log rather than the summary verdict: a failing read cell used to
swallow it. The same three documents, run with
the owner's **user session** over `PROBE_TRANSPORT=cli`, printed `auth=ok` and
`baseline=ok row=005ab765 status=SUCCESS` — so the query shapes are live-correct
and the difference is the credential. That contrast is what
`ci-railway-token-class.yml` is built to interpret: class, or this one secret's
value. See the two explanations under "The 2×2".
Reading of the wall:
[railway-upload-fault-report.md](../devops/railway-upload-fault-report.md) is the
fault ledger and support evidence pack;
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
| **reads** (`project`, `serviceInstance`) | works — proven 2026-11-22, and again in the probe's own `cli` transport run | **refused** — 2/2 runs: `Not Authorized` at HTTP 200 on `project` and on `serviceInstance`. *The claim this row used to make — "works, proven by every `railway up` leg that gets as far as stamping `BUILD_COMMIT`" — was wrong: `railway-deploy.sh` stamps it with `printf '%s' "$SHA" > "$BUILD_DIR/BUILD_COMMIT"`, a local file write that precedes any network call, so it says nothing about whether the token can read the API.* |
| **`railway up` upload** | works — every manual deploy in the ledger | **fails with F2** — 9 retries per leg, three legs per train, reproduced on runs `44922280434`, `44927881957` and `45005535349` |
| **`serviceInstanceDeploy(latestCommit:true)`** | works — staging promoted to `f9309845c` on 2026-11-22 with zero uploads | **refused on the one attempt** — run `45009997472`: `PROBE_CELL mutation=token-rejected` |

The swap this table was built to test is off the table: with this credential the
mutation was refused, and so were the reads, in both runs. What is *not* settled
is why. Two explanations are live and they need different fixes:

- **(A) CLASS.** Project tokens cannot reach the deployment graph at all. Then
  the mutation lane can never replace `railway up` in CI and the credential
  class has to change (a user-scoped token in CI, or a scope grant from Railway).
- **(B) VALUE.** The class is fine and `RAILWAY_TOKEN_STAGING` is stale,
  rotated-out or wrong. It is the only explanation that reaches F2 directly,
  because the request that obtains the upload destination carries that same
  credential. Weakened, but not refuted, by development's legs uploading 3/3
  green on train `45005535349` with `RAILWAY_TOKEN_DEVELOPMENT`: that proves the
  class works *for the upload lane*, which is a different request.

A third shape is worth detecting even though nothing observed so far shows it:
**(C) INTERMITTENT** — the same bearer accepted on some attempts and refused on
others. That is the signature F2 has, so if it ever appears it is the finding,
and it is also the reason the comparison samples each credential more than once
rather than trusting one reading.

`ci-railway-token-class.yml` decides between them. It samples each credential —
anonymous control, development, staging, production — **three times** and
reports `ok/N` rates: one sample cannot tell a stable refusal from a transient
edge refusal, and `Not Authorized` is Railway's wording for both a bad value and
a missing scope. `PROBE_MODE` is a literal `read-only` in the YAML and the file
has no inputs, so no dispatch can reach the cell that deploys.

```bash
gh workflow run ci-railway-token-class.yml --ref main
gh run view <id>   # the summary table and one verdict line
```

Reading its verdict — the order is the design, so read the line, not the table:

| verdict | meaning | do |
|---|---|---|
| `CONTROL BROKEN` | the no-credential row authenticated, so a token and no token were indistinguishable | fix the classifier; nothing else here is evidence |
| `INTERMITTENT` | at least one project token is accepted sometimes and refused other times | **rotate nothing.** Ask Railway what an HTTP-200 `Not Authorized` means for a project token and why identical calls minutes apart differ |
| `VALUE, not class` | development 3/3 ok, staging 0/3 | rotate `RAILWAY_TOKEN_STAGING` (owner action), re-dispatch this probe |
| `CLASS` | all three tokens 0/3 | no CI script change can help; the credential class has to change |
| `neither` | dev and staging both 3/3 ok | contradicts the runs above — read the raw bodies |
| `undecided` | a credential wrote no row | a step crashed; the comparison did not run |

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
PROBE_CELL readback=build-success after 15s (read=ok)
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
| `token-refused-at-read (…)` | the plain read got `Not Authorized` at HTTP 200 — Railway's wording for a bad value **and** for a missing scope, so this line cannot say which | run `ci-railway-token-class.yml`; it compares credentials, which is the only way to separate the two. (Printed as `token-cannot-authenticate` before 2026-11-22, including in the two #1143 runs above) |
| `accepted-awaiting-build (…)` | accepted, row appeared, still building when the budget ran out | re-dispatch; raise `PROBE_POLL_BUDGET_S` above 300 for the frontends |
| `read-only-ran` | reads proved, no mutation attempted | dispatch the mutate cell |
| `accepted-but-readback-blind (…)` | the mutation said `true` but cell 4 had no eyes on the rows: `readback-unreadable` (the row query was refused) or `no-baseline-to-diff` (cell 2 was refused, so there was nothing to diff against) | **neither a deploy nor a no-op is proven.** Fix the read path and re-dispatch; this line must never be the basis for swapping the `release.yml` staging legs |
| `undecided (…)` | no rule matched; the parentheses are the raw `baseline/mutation/readback` classifications | read the cell bodies in the log — the classifier has a gap and the API said something new |

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
deploy-retry test: **102/102 green** locally on 2026-11-22, no network to Railway.
It covers the classifier with recorded payloads (including the measured
HTTP-200 `Not Authorized` body — Railway does not use the status code for auth,
so any logic keyed on HTTP alone reads a token failure as success), plus
end-to-end runs of the whole script against `scripts/ci/f2-probe-stub.py`, which
now serves five scenarios: a green stub whose verdict must be
`project-token-can-deploy`, an unauthorized stub that must **not** print it, an
undecodable-body stub in both modes, `blind-readback` (the row query after an
accepted mutation is refused) and `no-baseline` (cell 2 refused, later rows real).
The last two exist because both used to be able to print the green verdict.
The remainder are wiring invariants read off the workflow and the script
themselves: dispatch-only, defaults to `read-only`, repository guard, staging
secret, `PROBE_TRANSPORT: curl`, no environment input, the one hardcoded
environment id is staging's, the summary step cats the file the script writes,
and every form input lands on a variable the script actually reads. It uses
regex rather than PyYAML because the hygiene job's `python3` has no third-party
packages.

The token-class comparison is covered the same two ways, and this is why its
rules live in `scripts/ci/f2-token-class-verdict.py` instead of a YAML heredoc: a
heredoc only ever executes on a runner holding three live credentials, so every
branch would ship unexecuted. Eight recorded sample sets drive the branches —
dev-3/3-plus-staging-0/3, all-refused, the mixed shape (recorded, not observed:
both #1143 runs refused every cell), an authenticating control,
both-tokens-clean, and three missing-credential shapes — and each asserts not
just its own verdict but that the wrong one is absent, which is the only way to
test an ordering.

Thirteen mutants were installed on purpose and made to go red — the three #1143
probe-script ones, five for the comparison, and five for the cell-4 blindness
fixed here. A green suite proves nothing until the defect it names is present:

| mutant installed | result |
|---|---|
| `mode == "read-only"` checked before `auth` | 3 failures — a faulting read-only run reports `read-only-ran` |
| HTTP code returned through a variable instead of a file | 11 failures — every cell classified as a transport error |
| workflow env key renamed back to `SERVICE_NAME` | 1 failure — the `service` input would silently probe `backend` |
| `CONTROL BROKEN` demoted below `INTERMITTENT` | 1 failure — and every text assertion stayed green, which is what makes the behavioural case the load-bearing one |
| a missing credential counted as refused | 2 failures — a crashed step reported `CLASS` |
| the decider keying each attempt as its own credential | 8 failures — the table filled with `staging-1`/`staging-2` rows and no verdict matched |
| the attempt index dropped from the sample filenames | 1 failure — rates could never be anything but N/N |
| one credential sampled once | 1 failure — 3/4 steps loop |
| cell 4 stopped classifying its own row query and reverted to the bare id diff | 3 failures, all in `stub/blind` — a refused readback became `accepted-awaiting-build`, an invented deploy outcome |
| the empty-baseline guard in cell 4 disabled (`if false`) | 3 failures — **`PROBE_VERDICT[backend]=project-token-can-deploy` printed for a token that had never seen a row to compare**, which is the verdict that would have been the evidence for swapping the `release.yml` staging legs |
| the `accepted-but-readback-blind` branch dropped | 4 failures — two classifier cases and both stub end-to-end verdict lines |
| a row deleted from the doc's `PROBE_VERDICT` table | 1 failure naming `undecided` |
| a row added to that table for a verdict that cannot fire | 1 failure naming the fake verdict |

Two of those thirteen were invalid, and both failures are worth recording
because they are how a suite quietly lies:

- the first `accepted-but-readback-blind` mutant deleted the eight leading
  spaces of the following `return`, so `f2-probe-verdict.py` stopped parsing and
  **45 checks** went red, including ones about HTTP codes and token masking.
  Number of failures is not evidence about the named defect; a mutant is only
  informative when the file still runs and only the intended assertions fail.
  Redone line-wise: 4 failures, exactly the intended ones.
- the first version of the doc-table check grepped the whole file for each
  verdict name and stayed **green with the `undecided (…)` row deleted**, because
  "undecided" is also a row of the `ci-railway-token-class.yml` table further
  down the page. It now extracts the rows under the `PROBE_VERDICT` header and
  compares the two sets in both directions, which is why the last two mutants
  above have any force.

Everything restored with `cp`, re-asserted sha256-identical in every case, then
re-run to 102/102.

Five live defects that would each have produced a confident wrong answer in CI:

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
4. Cell 4 decided "a new row appeared" from `[[ "$new_id" != "$base_id" ]]` and
   never classified its own response. Two shapes followed: a refused row query
   gives an empty `new_id`, which differs from a real baseline and so reads as
   new; and a refused *baseline* gives an empty `base_id`, which differs from
   every later row — so a token that could not read anything reached
   `project-token-can-deploy`. Cell 4 now classifies the row query with the same
   read classifier as cell 2, refuses to call a row new unless both ids exist,
   and reports `accepted-but-readback-blind` when it has no eyes on the table.
5. The verdict for a refused read was named `token-cannot-authenticate`, which
   asserted a bad secret value. Railway answers `Not Authorized` for a missing
   scope with the same HTTP-200 body, so the name claimed more than the payload
   can carry; it is now `token-refused-at-read`, and the comparison that *can*
   separate value from scope is `ci-railway-token-class.yml`.

The same three documents were validated against the real API over the owner's
session (`PROBE_TRANSPORT=cli PROBE_MODE=read-only`), which is why the transport
exists: `auth=ok`, `baseline=ok row=005ab765 status=SUCCESS`, so the query
shapes and every id in the script are confirmed live without a project token
ever being handled locally.

