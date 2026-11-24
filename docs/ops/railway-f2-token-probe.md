# F2 project-token probe — the one cell that decides the release wall

Status: **the cell is filled, and the answer is `project-token-can-deploy`.** The
2026-11-22 dispatches below ended in a refusal and were read as "the class"; that
answer has since been narrowed twice (see "The class question, answered" and "The
12:07Z measurement: the tokens are not silent"), retired for the reads by the
transport cells, and finally closed on the write at 14:27:14Z on 2026-11-23 by run
`45194092365` — CI's own `RAILWAY_TOKEN_STAGING` calling
`serviceInstanceDeploy(commitSha:)` and a new `SUCCESS` row appearing 30 s later.
Both original dispatches ran from `main` on 2026-11-22 with the same
`RAILWAY_TOKEN_STAGING` and the same `project { id name }` document, and both were
refused on every cell they probed — which is what the transport cells later
explained as the curl sampler rather than the credential:

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

## The class question, answered: those two fields are refused for every project token

*(Read this section with the two corrections under it. The table is real and
still stands as a statement about curl; the sentence "no project token can read
the deployment graph" that this section drew from it does not — `railway status
--json` with those same tokens is measured a few hundred bytes below, and the
13:01Z transport cells underneath it measure those same tokens reading the very
fields this table said they could not, once the client is `railway api`.)*

Sampler run `45024735432` (`workflow_dispatch` on `main` at `d6f282f5a`, job
`compare`, 12:55:10Z–12:56:22Z) wrote all twelve samples before anything went
wrong, and every one of them was refused:

| credential | `project` read, 3 attempts | staging `serviceInstance`, 3 attempts |
|---|---|---|
| `anonymous` (control) | `token-rejected` ×3 | `token-rejected` ×3 |
| `RAILWAY_TOKEN_DEVELOPMENT` | `token-rejected` ×3 | `token-rejected` ×3 |
| `RAILWAY_TOKEN_STAGING` | `token-rejected` ×3 | `token-rejected` ×3 |
| `RAILWAY_TOKEN_PRODUCTION` | `token-rejected` ×3 | `token-rejected` ×3 |

Fed to `f2-token-class-verdict.py`, that table reads **Verdict: CLASS** — and
what it proves on 2026-11-22 is narrower than that word: no project token can
read `project(id)` or `serviceInstance` through a raw `POST` to
`/graphql/v2`, so hypothesis (B) ("only the staging secret is broken") is dead
and rotating that secret could never have moved this wall. The discriminator is
the control row's own meaning: `development`'s token is the credential whose
`railway up` legs upload 3/3 green on every train, and it is refused those two
reads exactly like the other two. The class, not the value — for those fields.

**[Retired by the 13:01Z transport measurement below: those same three tokens,
sent through `railway api` instead of curl, all resolve `project(id)`. What that
table was measuring is the curl surface's refusal, not the credential class. The
fact that survived is narrower and not a class fact at all — on the CLI surface
`serviceInstance` resolves for `RAILWAY_TOKEN_STAGING` and for nobody else.]**

What the same verdict could not say, and was later read as if it did, is that a
project token reaches *nothing* on the graph. That sentence needed a cell nobody
had: a read that is not `project(id)`/`serviceInstance`, taken with the same
token in the same runner. It exists now, and it came back decoded.

Consequence, as re-stated at 13:01Z on 2026-11-23: **the reads no longer keep CI
off the mutation lane.** With `PROBE_TRANSPORT=cli`, `RAILWAY_TOKEN_STAGING`
reads staging's `serviceInstance.latestDeployment` — the field pair CI needs in
order to name a deployment target — while the development and production tokens
authenticate on `project(id)` and are refused that field. The earlier sentence
here, that the lane is reachable "only with a user-scoped credential and never
from a project token", was read from the curl cells and is withdrawn. What now
stands between CI and the swap is the write cell alone, and measuring it *is*
deploying staging — so it stays an owner-signed action, and the checkbox that
reaches it is default-off and names a full commit or nothing at all (see "The
write cell" below). What remains unknown: whether the staging token's read scope
extends to `serviceInstanceDeploy`, and whether curl's refusal of a project token
is a header the CLI adds that the sampler does not (the sampler sends only
`Content-Type` and `Authorization: Bearer`) or a rule on that surface. Either way
the question that belongs in the support thread alongside the upload refusal
changes shape: not "why can project tokens not read the graph", but "why does the
same project-token bearer authenticate through the CLI client and come back `Not
Authorized` through raw HTTP".

A second discriminator fell out of using that lane on 2026-11-22, and it is not about
credentials: within one logged-in user session, `serviceInstanceDeploy(…, latestCommit:
true)` was refused `Not Authorized` wrapped in `INTERNAL_SERVER_ERROR` three times out of
three at 13:53:24/39/54Z (traceIds `7638569940617653028`, `8666048400144838034`,
`245729836332584137`), while `serviceInstanceDeploy(…, commitSha:"<full sha>")` returned
`true` three times out of three at 13:59Z on the same three instances, with the same bearer
identity (`spec.ng@gmail.com`, user `bbb8bca4-84df-483e-a227-97a971e9f4a7` — the `creator.id`
of every resulting row, all `SUCCESS` by 14:02:44Z). `isUpdatable=false` correlated with the
refusals but did not cause them: the same instance accepted an explicit sha minutes later
while still reporting `false`. So the argument *shape*, not the token, decides that call
today — and the probe's own `DOC_DEPLOY` document pins the refused shape **[retired as the
document that is sent: `DOC_DEPLOY_SHA` is what cell 3 now calls, and `DOC_DEPLOY` stays in
the file as the recorded exclusion, asserted-never-sent by the suite]**. One cell is
therefore still empty: the CI attempt (`45009997472`) called `latestCommit`, so no project
token has ever been asked for `commitSha`. The verdict did not depend on filling it
then, because that same token was refused every read this probe knows how to make
on the graph the mutation writes to — a sentence that stopped being true on
2026-11-23, when `railway status --json` decoded with all three tokens (see "The
12:07Z measurement" below), which is exactly why the transport cells were added.
If the support thread asks what to try next, that is the call.

The step that computes this died on its own spelling and is fixed here: the
workflow passed `--glob /tmp/class-*.txt` unquoted, the runner's shell handed
argparse twelve words, and the job exited 2 with `unrecognized arguments:
/tmp/class-anonymous-2.txt …` after twelve good samples. Check (7) in
`scripts/ci/test-f2-token-probe.sh` now runs the decider both ways and requires
one identical verdict, and check (8) fails if the quotes ever come off. The table
above is the real sample set, reconstructed from the job log — the summary that
should have held it was never written.

Re-dispatched as `45027737590` (`main` at `df6676406`, 13:29:23Z, job `compare`,
conclusion `success`) to verify the fix where it matters. The step ran, wrote the
four rows into the job summary, and printed the same verdict independently of my
reconstruction: `anonymous`, `development`, `staging` and `production` all
`0/3 all-refused`, then **Verdict: CLASS**. Two runs, twenty-four samples, four
credentials, no disagreement — the answer does not depend on how the reporter is
spelled, and the reporter is now proven on a runner rather than only offline.

## The 12:07Z measurement: the tokens are not silent, and F2 is not on the plain read

Run `45171097305` (`ci-railway-token-class.yml`, dispatched on `main` at
`d56314415` at 12:06:12Z, job `compare` = `137680533814`) ran the status cells on
the pinned binary — `@railway/cli@5.40.1`, the version `ops-railway-upload.yml`
installs, so the answer is about the right executable:

| credential | `railway status --json` | bytes | verdict |
|---|---|---|---|
| `anonymous` (control) | `rc=1` | 0 | `other-failure` |
| `RAILWAY_TOKEN_DEVELOPMENT` | `rc=0` | 43,753 | `decoded` |
| `RAILWAY_TOKEN_STAGING` | `rc=0` | 52,349 | `decoded` |
| `RAILWAY_TOKEN_PRODUCTION` | `rc=0` | 36,979 | `decoded` |

Three things fell out of that table, and one of them is the headline the support
thread has been missing since 2026-11-16:

**F2 is not on the plain read.** The six staging dispatches of
`ops-railway-upload.yml` that died 0.3 s into their own pre-flight (job
`137230172408`) were the fault arriving on `railway status`, and here the same
call, on the same runner class, with the same pinned binary and the same staging
token, returns 52,349 parseable bytes. So the decode refusal is **time-windowed**,
not a standing property of staging's environment — which retires the "staging
payload makes every CLI read undecodable" reading that episode left open.

**All three CI secrets are live project tokens.** The control failed and each
credential succeeded, with a body sized like this workspace's real graph. Nobody
should rotate `RAILWAY_TOKEN_STAGING` on the strength of tonight's data.

**The graph-wide CLASS sentence is gone.** A token that decodes 43–52 KB of this
project's status is not a credential that reaches nothing. What the 2026-11-22
curl cells actually measure is narrower and still true: those two specific fields
— `project(id)` and `serviceInstance` — are refused for every project token and
for no token at all, identically.

Two explanations survive that, and they need different fixes: the two fields are
out of what a project token is scoped to read, whatever client asks; *or* the raw
`POST /graphql/v2` call the sampler makes cannot carry a project token's
authority, and the refusal is my instrument rather than the credential.

The second possibility was checked on the laptop first, with a credential whose
authority is not in question (the owner's CLI session), the same document, the
same endpoint, and a curl-like `User-Agent` — without it every variant answers
`HTTP 403` and 17 bytes of non-JSON, which is an edge refusing the client and says
nothing about tokens:

| how the request carried the credential | what came back |
|---|---|
| `Authorization: Bearer <token>` | `http=200`, `project.name = spotlight-platform` |
| `X-Railway-Token: <token>` | `http=200`, `errors[0].message = "Not Authorized"` |
| no credential at all | `http=200`, `errors[0].message = "Not Authorized"` |

So the sampler's header is the working one, `Not Authorized` is precisely what an
unauthenticated call looks like on that surface, and the runner's twelve refusals
are a real statement about the credentials — just not yet the statement the word
`CLASS` was carrying. Which of the two explanations is true needs the same token
sent through the *other* client, and only a runner holds one.

### The transport cells

`ci-railway-token-class.yml` now sends the sampler's two documents a second time,
through `railway api` instead of curl, for the control and each credential, and
`scripts/ci/f2-transport-verdict.py` compares the two answers per credential:

```bash
gh workflow run ci-railway-token-class.yml --ref main
gh run view <id> --log | grep -E 'PROBE_CELL|CLASS_CELL'   # raw cells
gh run view <id>                                           # the summary tables
```

| the two answers | what it means | do |
|---|---|---|
| refused on curl, refused on cli | the class really is the variable, across both clients. A project token authenticates but is not scoped to resolve a deployment target. | ask Railway for that scope (or put a user token in CI); owner-side sha-pinned `serviceInstanceDeploy` stays the staging path meanwhile |
| refused on curl, `ok` on cli | the sampler was the broken instrument for this credential class. The CLASS reading is retired. | re-measure the write cell with `PROBE_TRANSPORT=cli` — CI can probably resolve the ids and reach the mutation after all, which moves the wall |
| `ok` for the credential-less control | CONTROL BROKEN: that field does not need a token through this client, so `ok` rows prove nothing. | fix the cell before reading the table |
| one credential differing | not a class story at all — per-secret scope or value | act on those secrets only, not on the class |

Two facts had to be measured before those cells could be trusted, and both were
wrong in ways that would have produced a confident, false verdict:

- `railway api` prints the JSON body **and** a human sentence
  (`Railway API request failed with HTTP 400 Bad Request`) whenever the status is
  not 200. Two lines of "body" do not parse, so `classify_read` would have
  reported a *refused credential* as a *transport fault*. The cli branch of
  `scripts/ci/f2-token-probe.sh` now passes `--allow-errors` and keeps only the
  compact first line, and the transport verdict refuses to resolve a table of
  `body-undecodable` cells into either story — `body-undecodable` is F2's own
  fingerprint, and a credential probe that quietly swallows it is the worst place
  for it to hide.
- `scripts/ci/f2-status-probe.sh` computed the version of the binary that ran and
  then printed `${VERSION}` — what the workflow *asked* for — instead of it, so
  its own "measured, not requested" comment described code that was never
  emitted. The cell now carries both spellings (`cli=` measured, `pin=`
  requested), caveats when they disagree, and accumulates caveats into one line,
  because the cell parser keeps the last value of a repeated key. Driving the
  probe against a stub that reports `9.9.9` while the pin says `5.40.1` is part
  of check (11) in `scripts/ci/test-f2-token-probe.sh`.

Also proven here, because the transport cells depend on it: `railway api`
resolves **both** documents from a directory that has never been linked. The
runner reports `link_state=no-config` on every cell, so "the lane never linked a
project" is not an available excuse for a refused read. Checked twice — with the
installed CLI, and again at 12:45Z on 2026-11-23 through
`npx @railway/cli@5.40.1 api … --compact --allow-errors` from `/tmp`, which is
the version the runner installs: `project(id)` returned
`name = spotlight-platform` and the row query returned the staging backend's
`latestDeployment` (`faa7ff43…`, `SUCCESS`, 2026-11-22T14:03:00.891Z). That also
confirms 5.40.1 accepts both flags the cli branch passes, so the cells cannot
fail for want of a flag.

### The 13:01Z transport measurement: the sampler was the broken instrument

Run `45179580758` (`ci-railway-token-class.yml` dispatched on `main` at
`0329a903a`, 13:00:04Z–13:01:33Z, job `compare` = `137709644373`, conclusion
`success`) is the first train-free pass of both clients on the same documents.
Sixteen cell files, one verdict. These are the raw cells, read out of the job log
and fed back through `scripts/ci/f2-transport-verdict.py` itself — the step's own
writing goes to `$GITHUB_STEP_SUMMARY`, which the CLI does not print, so the log
plus the decider is the reproducible channel:

| credential | curl `project(id)` | curl `serviceInstance` | cli `project(id)` | cli `serviceInstance` |
|---|---|---|---|---|
| `anonymous` (control) | `token-rejected` ×3 | `token-rejected` | `token-rejected` | `token-rejected` |
| `RAILWAY_TOKEN_DEVELOPMENT` | `token-rejected` ×3 | `token-rejected` | **`ok`** | `token-rejected` |
| `RAILWAY_TOKEN_STAGING` | `token-rejected` ×3 | `token-rejected` | **`ok`** | **`ok`** — `faa7ff43…`, `SUCCESS` |
| `RAILWAY_TOKEN_PRODUCTION` | `token-rejected` ×3 | `token-rejected` | **`ok`** | `token-rejected` |

The decider lands on the second row of the table above: **The sampler, not the
token.** Four things follow, and they are not all the same kind of thing.

- Every project token authenticates. Three of three labels return
  `{"data":{"project":{"id":"e7dca861-…","name":"spotlight-platform"}}}` through
  `railway api`. The `CLASS` reading this probe carried for a day was a property
  of the raw-HTTP call, not of the credential.
- The control is intact: the credential-less cell is refused on **both** clients,
  so an `ok` row means a token did something and not "this field needs nobody".
  Without that row the three `ok`s would be evidence for nothing.
- The scope that remains is per-token, not per-class: only the staging secret can
  resolve a staging `serviceInstance`. Development's and production's tokens are
  refused that exact field minutes after they resolve `project(id)` on the same
  instance of the same project, which rules out an outage and rules out a header
  they all share.
- F2 is nowhere in this table. Sixteen reads on the same endpoint, with three
  project tokens, on both clients, and `body-undecodable` never appears — the
  transport verdict would have said "outside the taxonomy" rather than fold it
  into a credential claim, and it did not need to.

What this changes in practice: CI holds a credential that can already see the
deployment targets of staging, so the `serviceInstanceDeploy` swap is no longer
blocked by a proven read restriction — it is blocked by an unmeasured write.

### The write cell: the last unmeasured fact, and what it costs to measure it

That write cell is `serviceInstanceDeploy` called with a project token. It is the
only fact standing between this repo and moving the staging legs off `railway up`
onto the mutation, and it cannot be answered from a laptop: `projectTokenCreate`
is refused for the owner session, so the only token that matters exists inside a
runner. It is also, uniquely, a cell with a side effect — if the answer is
"authorized", the run deploys staging.

So the cell was built rather than run by accident. `ci-railway-token-class.yml`
now has two dispatch inputs, and neither names a target:

- `write_cell` — a checkbox, **default off**. Nothing checks it automatically:
  no other workflow calls this file, and it has no `push`, `schedule`, or
  `pull_request` trigger.
- `deploy_sha` — a full 40-hex commit. A short sha (the shape GitHub's own UI
  displays) or an empty one is refused twice over: a guard step before any
  credential is loaded, and the script itself before it builds a request.

When the checkbox is checked, one step runs — staging token, `backend` service,
`PROBE_TRANSPORT: cli` (curl cannot authenticate a project-token bearer on the
read surface, so a curl refusal here could never be read as a scope answer),
`PROBE_MODE: mutate` — and the environment id stays hardcoded to staging inside
the script, with no production id anywhere in the file. Everything else in the
workflow keeps reading.

**The cheapest honest version of the measurement is to name the sha staging
already serves.** An authorized call then creates a new deployment row for a tree
that is already running, so the cell proves authorization with effectively no
version change and no unmigrated schema; a refused call changes nothing at all.
That is why `deploy_sha` is a required part of the dispatch rather than a
"latestCommit" convenience: `latestCommit` is also the spelling that has been
refused owner-side three of three (see the measured exclusion above), so it would
confound a shape refusal with a scope refusal — the exact ambiguity this file was
rewritten to remove.

Reading the result:

| `PROBE_VERDICT[backend]` | meaning | do |
|---|---|---|
| `project-token-can-deploy` | authorized, and a new SUCCESS row appeared | propose the `release.yml` staging-leg swap — owner sign-off, it is a CI change |
| `mutation-is-noop-for-project-token` | returned `true`, created no row | the git-less-service shape production's `frontend-admin` already showed; the swap buys nothing |
| `token-scope-blocks-mutation` | Forbidden to a token that can read | ask Railway for deploy scope on the project token |
| `token-rejected-at-graphql` | the mutation refused while the reads pass | the staging secret is read-scoped; same ask, sharper |
| `f2-reproduces-on-the-mutation-path` | the mutation returned an undecodable body | F2 is the transport, not the endpoint — escalate with the timing pattern |
| `accepted-but-readback-blind (…)` | said `true`, cell 4 had no eyes on the rows | **neither a deploy nor a no-op is proven**; do not act on this line |

### The 14:27Z write cell fired, and the answer is `project-token-can-deploy`

Run `45194092365` (`ci-railway-token-class.yml`, dispatched on `d91a6e2e9` at
14:25:44Z, job `compare` = `137759803757`, `write_cell` checked, `deploy_sha =
df6676406` — the sha staging already served, per the cheapest-honest-version rule
above). Cell 3 at 14:27:12.918Z:

```
14:27:14.200Z {"data":{"serviceInstanceDeploy":true}}
14:27:14.216Z PROBE_CELL mutation=accepted (http=cli-transport) sha=df6676406
14:27:29.777Z   [+15s] row=d1fb169d status=BUILDING isNew=true read=ok
14:27:45.405Z   [+30s] row=d1fb169d status=SUCCESS isNew=true read=ok
14:27:45.438Z PROBE_VERDICT[backend]=project-token-can-deploy
```

So the last unmeasured fact is measured: **the project token CI holds can deploy
staging**, by sha, with no upload, and the row appeared and reached `SUCCESS` in
about 30 s. The 2×2 below is now wrong in its mutation row and is left standing
only as the history of what was believed at the time.

Two things this does *not* say, both of which would have been easy to over-read
from the same log:

- At 14:27:03.450Z the run printed `**Verdict: CLASS.** No project token reads the
  deployment graph, so serviceInstanceDeploy is unreachable from CI`. That line is
  the **curl** branch of the sampler, retired four seconds earlier by the run's own
  cli cells and by run `45179580758`; the write cell below it is the cli branch.
  Read cells, not inherited summary lines.
- Only `backend` was written to. The generalisation to all three staging services
  came 27 minutes later from the owner lane, and it is visible in the row history:
  `2df11e51` (backend, 14:29:10.823Z), `d7abcc2e` (frontend-web, 14:29:24.779Z),
  `6e39f119` (frontend-admin, 14:29:38.077Z) — all `SUCCESS`, all
  `meta.reason = "deploy"` with `meta.cliMessage = null` and
  `meta.commitHash = 0329a903a…`, i.e. all three mutation-shaped. Production's
  `frontend-admin` stays excluded on its own measured evidence (the git-less silent
  no-op, `reason=redeploy`), and the swap's `no-new-row` verdict is what catches any
  service that turns out to be a no-op too rather than letting `true` pass as a deploy.

Consequence, per the `project-token-can-deploy` row of the table above: the staging
legs of `release.yml` moved to `serviceInstanceDeploy(commitSha:)` and are judged by
the deployment row that names the commit, not by the mutation's return value. See
Episode 21 of `docs/devops/railway-upload-fault-report.md`.

## The question, in one sentence

Every `deploy Staging (…)` leg of every release train since 2026-11-16 dies on
`Failed to fetch: error decoding response body` (F2), which skips `smoke Staging`
→ `migrate production` → `deploy Production` → `smoke Production`, so `main`
never reaches staging or production on its own — while the GraphQL mutation
`serviceInstanceDeploy(serviceId, environmentId, commitSha:"<full sha>")` promotes the same
three staging services with no upload at all, in about three minutes. (The `latestCommit:
true` spelling did the same job until 2026-11-22T13:53Z and is refused since; see Episode 18
of `docs/devops/railway-upload-fault-report.md`.)

What was not known — and is now answered, 2026-11-23T14:27:14Z, run
`45194092365` — is whether that mutation works with the credential a runner
holds. It does: `PROBE_VERDICT[backend]=project-token-can-deploy`, a new `SUCCESS`
row 30 s later, zero bytes uploaded. `RAILWAY_TOKEN_STAGING` is a **project
token**; the working calls above were made with the owner's **user session**, and
`projectTokenCreate` is refused for that session, so the token that matters only
ever exists inside a CI runner — which is why this is a workflow and not a laptop
command, and why the answer had to be paid for with a real staging deploy.

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
| **reads** (`project`, `serviceInstance`) | works — proven 2026-11-22, and again in the probe's own `cli` transport run | **refused for these two fields** — 2/2 runs: `Not Authorized` at HTTP 200 on `project` and on `serviceInstance`. Not "no reads": the same tokens decode `railway status --json` in a runner (2026-11-23, run `45171097305`), so this cell is about two fields, not about the whole graph. *The claim this row used to make — "works, proven by every `railway up` leg that gets as far as stamping `BUILD_COMMIT`" — was wrong: `railway-deploy.sh` stamps it with `printf '%s' "$SHA" > "$BUILD_DIR/BUILD_COMMIT"`, a local file write that precedes any network call, so it says nothing about whether the token can read the API.* |
| **`railway up` upload** | works — every manual deploy in the ledger | **fails with F2** — 9 retries per leg, three legs per train, reproduced on runs `44922280434`, `44927881957` and `45005535349` |
| **`serviceInstanceDeploy(latestCommit:true)`** | worked earlier on 2026-11-22 (staging promoted to `f9309845c`, zero uploads) but was refused in all three attempts from 13:53Z in this session — the reproducible owner-side spelling is `commitSha`, which promoted staging to `b55757379` at 13:59Z (the `df6676406` rows ten minutes later came from the same lane driven by another session) | **refused on the one attempt** — run `45009997472`: `PROBE_CELL mutation=token-rejected` |
| **`serviceInstanceDeploy(commitSha:"<40-hex>")`** | works — the reproducible owner-side spelling, and the one that promoted staging to `0329a903a…` on all three services at 14:29:10-14:29:38Z (rows `2df11e51`, `d7abcc2e`, `6e39f119`) | **works** — run `45194092365` at 14:27:14Z: `true`, new row `d1fb169d` `BUILDING` +15 s and `SUCCESS` +30 s, `PROBE_VERDICT[backend]=project-token-can-deploy` |

The question this table was built to ask is now **answered on the write**: the
project token CI holds can deploy staging by sha. The swap it was gating —
`release.yml`'s three `deploy Staging (…)` legs, off `railway up` and onto the
mutation — is therefore no longer blocked by an unmeasured fact, and the two
explanations below survive only as the history of what was believed and as the
open support question about *scope between the three tokens*:

- **(A) CLASS — retired for the reads, open for the write.** Project tokens were
  said to be unable to reach the two fields that resolve a deployment target.
  Through `railway api` all three reach `project(id)` and the staging token
  reaches `serviceInstance`, so the class story is dead on the CLI surface for
  those reads. *(Wording history: this row first read "cannot reach the
  deployment graph at all", which the 12:07Z status cells refuted; the narrower
  claim it was corrected to is the one the transport cells retired. What is left
  of it is a scope question with exactly one answer-giving call, the mutation.)*
- **(B) SCOPE, per secret — now the live reading.** The class is fine and the
  three secrets are not equally scoped: staging alone can resolve a staging
  service instance. That is neither "stale" nor "rotated out" — the refused
  tokens authenticate — it is a grant difference between three project tokens on
  the same project, which is a Railway-side settings question and belongs in the
  support thread. The original (B) hypothesis, that `RAILWAY_TOKEN_STAGING` was
  the broken value, is dead: it is the only one of the three that works on that
  field. *Weakened, but not refuted, by development's legs uploading 3/3 green on
  train `45005535349` with `RAILWAY_TOKEN_DEVELOPMENT`: that proves the class
  works for the upload lane, which is a different request.*

A third shape is worth detecting even though nothing observed so far shows it:
**(C) INTERMITTENT** — the same bearer accepted on some attempts and refused on
others. That is the signature F2 has, so if it ever appears it is the finding,
and it is also the reason the comparison samples each credential more than once
rather than trusting one reading.

`ci-railway-token-class.yml` decides between them. It samples each credential —
anonymous control, development, staging, production — **three times** and
reports `ok/N` rates: one sample cannot tell a stable refusal from a transient
edge refusal, and `Not Authorized` is Railway's wording for both a bad value and
a missing scope. `PROBE_MODE` is a literal `read-only` in the job env, so every
step that does not override it is a read; the one step that overrides it sits
behind the default-off `write_cell` checkbox and a 40-hex `deploy_sha` (see "The
write cell" above), and the suite checks that structurally rather than by
banishing the word.

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
| `CLASS` | all three tokens 0/3 | read the transport verdict below before treating it as anything about the credentials: a curl-only table cannot tell a class refusal from a refusal that only the raw-HTTP surface produces, and on 2026-11-23 13:01Z the transport cells proved it was the surface. |
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

# 2. the same reads plus the transport cells, on all four credentials.
gh workflow run ci-railway-token-class.yml --ref main

# 3. the write cell — THIS ONE DEPLOYS. Checked box, staging backend only, and
#    the commit it names must be a full 40-hex sha. Naming the sha staging
#    already serves makes the deploy a no-op version change, which is the
#    cheapest way to buy the answer:
gh workflow run ci-railway-token-class.yml --ref main \
  -f write_cell=true -f deploy_sha="$(git rev-parse df6676406)"

# 3b. the same cell on the other entry point, where curl cannot authenticate a
#     project token and the run therefore stops at cell 1 (see the note in
#     ci-f2-token-probe.yml). Kept for the edge-status answer, not for the write.
gh workflow run ci-f2-token-probe.yml --ref main \
  -f mode=mutate -f service=backend -f deploy_sha="$(git rev-parse df6676406)"
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
deploy-retry test: **200/200 green** locally at the commit that adds the write
cell (it was 182/182 on 2026-11-23 12:40Z, before the sha guard and the
dispatch-wiring direction below were written, and 107/107 on 2026-11-22 13:20Z,
before the status cells and the transport cells). No network to Railway.
It covers the classifier with recorded payloads (including the measured
HTTP-200 `Not Authorized` body — Railway does not use the status code for auth,
so any logic keyed on HTTP alone reads a token failure as success), plus
end-to-end runs of the whole script against `scripts/ci/f2-probe-stub.py`, which
now serves five scenarios: a green stub whose verdict must be
`project-token-can-deploy`, an unauthorized stub that must **not** print it, an
undecodable-body stub in both modes, `blind-readback` (the row query after an
accepted mutation is refused) and `no-baseline` (cell 2 refused, later rows real).
The last two exist because both used to be able to print the green verdict.
Every mutate stub run passes a real 40-hex commit, and three shapes that must not
get a request out are driven through the same server: an empty sha (the dispatch
form half-filled), a 9-character sha (the exact spelling GitHub's own UI shows,
so this is the mistake an operator makes by copying what they see), and a
40-character value containing a non-hex letter (which is why the check is a hex
class and not a length). What is asserted there is *absence*: no `PROBE_CELL`, no
`PROBE_VERDICT`, exit 2. A guard that prints a warning and then sends the
mutation would be a release with a notice attached, and no text assertion can see
that difference — only running it can.
The fake edge also stopped answering documents it was not given correctly: it now
compares each request's variable signature against the variables actually sent
and refuses a mismatch with HTTP 400. That is what makes the mutation cell's
shape testable rather than merely documented, and it was measured, not assumed —
sending the `commitSha` document with a `latest` variable turned **ten** checks
red, because `classify_read` looks at the status before the body.
The remainder are wiring invariants read off the workflow and the script
themselves: dispatch-only, defaults to `read-only`, repository guard, staging
secret, `PROBE_TRANSPORT: curl`, no environment input, the one hardcoded
environment id is staging's, the summary step cats the file the script writes,
and every form input lands on a variable the script actually reads — and now in
both directions, because the earlier version only checked the mapping in one
direction and its input-name character class excluded `_`, so `deploy_sha` and
`write_cell` were invisible to it: the checker printed "2 mappings" for a
3-mapping file, which is the shape of a green suite that cannot see the wiring it
exists for. A declared-but-unforwarded input is the same bug from the form's
side, and it is what would turn "the guard refused" into an operator's surprise.
The write cell's own guard is checked structurally rather than by banning the
word `mutate` — the earlier assertion (`'mutate' appears nowhere`, `no inputs
block`) could only stay green by having no write cell at all, i.e. by not
answering the question. What must be true instead: exactly one `PROBE_MODE:
mutate` step exists in the file; that step's block — located by line range, so a
mention in prose cannot satisfy it — contains the checkbox gate, the staging
secret, the cli transport, a sha that comes from the form rather than a literal
in the YAML, and `|| true`; it contains no development or production credential;
the form declares nothing except `write_cell` and `deploy_sha`; the checkbox
defaults to off; nothing in the file asks for `latestCommit`; and the guard step
tests a 40-hex shape before any token is loaded. All of it uses regex rather
than PyYAML because the hygiene job's `python3` has no third-party packages.

The token-class comparison is covered the same two ways, and this is why its
rules live in `scripts/ci/f2-token-class-verdict.py` instead of a YAML heredoc: a
heredoc only ever executes on a runner holding three live credentials, so every
branch would ship unexecuted. Eight recorded sample sets drive the branches —
dev-3/3-plus-staging-0/3, all-refused, the mixed shape (recorded, not observed:
both #1143 runs refused every cell), an authenticating control,
both-tokens-clean, and three missing-credential shapes — and each asserts not
just its own verdict but that the wrong one is absent, which is the only way to
test an ordering.

The transport comparison (`scripts/ci/f2-transport-verdict.py`) is driven the
same way from nine recorded cell sets, and its fixtures deliberately keep the
two filenames the workflow really writes — `class-<label>-<n>.txt` per attempt,
`cli-<label>.txt` per credential — because a fixture that tidied that difference
out would test the fixture and not the reader. Thirteen of that file's checks
are those nine sets: seven positive verdict lines and six that name the sentence
which must stay unreachable for that shape, which is the only way to test an
ordering. The rest of the block pins the wiring the run depends on (four cli
steps, both quoted globs, `PROBE_TRANSPORT: cli`) and the two measurement fixes
below. A missing cli cell must print neither of the two clean conclusions, and a
cli body of `body-undecodable` — F2's own fingerprint, seen from a read — falls
to "outside the taxonomy" rather than being folded into a credential claim.

Twenty-six mutants were installed on purpose and made to go red — the three #1143
probe-script ones, five for the comparison, five for the cell-4 blindness
fixed here, two for the argument surface that silenced run 45024735432, two
for the 2026-11-23 measurements: the `body-undecodable` fold-in that would have
turned a decode fault into a credential verdict, and the status cell that printed
the version the workflow *pinned* instead of the version that ran — and nine for
the write cell, each re-run after restoring the file by hash rather than by
`git checkout`, because every one of these files was uncommitted work.
A green suite proves nothing until the defect it names is present:

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
| the quotes taken off the workflow's `--glob` line, as run `45024735432` had it | 2 failures — both YAML guards — **while all thirteen classifier checks stayed green**, which is exactly how the live job could die after twelve good samples |
| `--glob` back to a single value with the positional backstop gone (script still parses and runs) | 2 failures — the two spellings disagreed, i.e. a decider silently reading one file of twelve, and the backstop grep |
| `unknown()` reverted to `v not in KNOWN`, so a cli body of `body-undecodable` counts as an answer | 2 failures — the same table that had refused to conclude in the previous paragraph resolved to "Per-credential, not per-class", i.e. a sentence telling the owner to rotate three secrets because of a decode fault |
| the status cell printing `cli=${VERSION}` instead of the measured `CLI_ACTUAL` | 2 failures — run 45171097305's own bug: eight cells that said `cli=5.40.1` while nothing proved which binary ran |
| cell 3 sent `DOC_DEPLOY` with a matching `$latest` variable (self-consistent, wrong spelling) | 2 failures — `cell 3 sends the commitSha document` and `latestCommit is never sent`, **and the fake edge stayed silent**: the drift check compares a document against its own variables, so it cannot see a pair that agrees on the retired shape. That is why the text guard exists beside it |
| cell 3 sent the `commitSha` document with a `latest` variable (signature and payload disagree) | 10 failures — the stub answered HTTP 400, `classify_read` saw the status before the body, and every mutate scenario lost its `mutation=accepted` and its verdict |
| the write step's `if: inputs.write_cell` line deleted | 2 failures — the checkbox gate, and the structural read of the step's own block |
| `PROBE_DEPLOY_SHA` pointed at a literal sha in the YAML instead of the form | 1 failure — the write step no longer takes its commit from the operator, which is the difference between a measurement and a scheduled release |
| a third dispatch input (`service_name`) declared | 2 failures — `no environment or service input`, and the declared-inputs set came back `deploy_sha service_name write_cell` |
| the write step given `RAILWAY_TOKEN_PRODUCTION` | 1 failure — "the write step names a credential other than staging's", the only check in the file that inspects the step's block and not the page |
| the script's 40-hex guard deleted | 8 failures — each of the three bad shapes lost both its silence assertion and its exit code (exit 0 instead of 2), plus the two guards that name the refusal and its reason line, so an empty `deploy_sha` became **a mutation sent with no commit named** |
| the `PROBE_DEPLOY_SHA` mapping deleted from `ci-f2-token-probe.yml` | 1 failure — `dispatch input(s) deploy_sha are declared on the form but never forwarded` |
| the input-name character class reverted to `[a-z-]+` (no underscore) | 1 failure — the same reverse check, reached by blinding the checker instead of the workflow: it read 2 mappings in a 3-mapping file |

Three of those twenty-six were invalid, and every one of those failures is worth recording
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
- the first argument-surface mutant deleted the `extra` declaration but left
  `args.extra` in the body, so the decider raised `AttributeError` and **14
  checks** went red — including eight that were about verdict ordering. The
  failure count was the tell, not the defect. Redone so the script still runs and
  only the tolerance is gone: 2 failures, both intended, and the two arg-shape
  checks that stayed green are themselves a lesson — a single-value `--glob` still
  exits 0 and still prints exactly one verdict, because it is quietly reading one
  file of twelve. Only the byte-comparison against the quoted spelling catches it.

Everything restored from a pre-mutant copy, re-asserted sha256-identical in every
case, then re-run to full green — 107/107 for the first fifteen, 182/182 with the
two 2026-11-23 mutants, 200/200 with the nine for the write cell.
One of those nine nearly proved nothing: the restore was written as
`sha256sum file | grep -q <clean-hash> && cp backup file`, so the assertion asked
"is the file already clean?" and, finding the mutant's own hash, restored
*nothing* — the run reported its 10 failures against a tree that still contained
the defect. Caught because the printed hash was the mutant's, not the backup's.
The order has to be restore-then-assert, which is the same trap as
`git checkout -- <file>` on a dirty tree: it restores HEAD and silently deletes
the uncommitted work you were measuring. Every file here was uncommitted, and
none of them could have been recovered that way.

Six live defects that would each have produced a confident wrong answer in CI:

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
6. The sampler's own Verdict step passed `--glob /tmp/class-*.txt` **unquoted**.
   The runner's shell expanded it, argparse took the first file as the pattern's
   value and rejected the other eleven (`unrecognized arguments`, exit 2), so
   `45024735432` produced no verdict after twelve correct samples — and every
   check in the suite called the decider with a quoted pattern, so the suite was
   green the whole time. The workflow line is quoted now, `--glob` accepts the
   expanded words, and the decider also takes them positionally; checks (7) and
   (8) run both spellings, require byte-identical output, and fail if the quotes
   come off. This is the same failure mode as defect 1 one layer up: a probe that
   cannot report is not a probe that proved nothing happened.

The same three documents were validated against the real API over the owner's
session (`PROBE_TRANSPORT=cli PROBE_MODE=read-only`), which is why the transport
exists: `auth=ok`, `baseline=ok row=005ab765 status=SUCCESS`, so the query
shapes and every id in the script are confirmed live without a project token
ever being handled locally.


## Corrected 2026-11-24: the refusals this probe was built to explain were ours, not Railway's

Full measurement in `docs/devops/railway-upload-fault-report.md`, Episode 25. In one
line: **`release.yml` and `ops-railway-upload.yml` exported `RAILWAY_ENV: staging`, and
the Railway CLI reads `RAILWAY_ENV` as its own internal API-stage selector** — that
value moves every request to `https://backboard.railway-staging.com/graphql/v2`, which
answers a non-JSON `unconditional drop overload` HTTP 503. `development`, `production`,
`preview`, `zzz`, `staging-Old` and unset all stay on `backboard.railway.com`.

What that retires from this file:

- *"the decode refusal is time-windowed"* (the 12:07Z measurement section). It is not a
  window on the production API; it is a second backend whose availability nobody on
  this side can see or affect. The 900 s ladder was always spanning the wrong wall.
- *"no project token can read the deployment graph" (Verdict: CLASS)* as an explanation
  for the release legs. The CLASS samples measured the sampler, this file already says
  that twice, and the leg-vs-probe asymmetry that motivated the whole probe is the env
  var: this workflow has never set `RAILWAY_ENV`, which is why it answers in forty
  seconds.
- *"the refusal follows the staging credential"* in
  `docs/ops/admin-console-production-errors-2026-11-20.md` §2026-11-22 (afternoon). That
  lane derived `RAILWAY_ENV` from `inputs.environment`, so `production` passed the same
  pre-flight and `staging` refused it six times — same runner image, same CLI, same
  document.

What stands untouched, because it was measured with the variable absent: the write cell
(`project-token-can-deploy`, 14:27:14Z), the token-scope inventory and the minting
refusals, the transport cells, and "the sampler, not the credential" conclusion.

One correction to "Why this cannot be answered from a laptop", for the next reader: that
section is about the **credential** — no local stand-in for `RAILWAY_TOKEN_STAGING`
exists, and it still does not. The **host selection** turned out to need no credential at
all: `RAILWAY_TOKEN= RAILWAY_ENV=staging railway api …` refuses identically on a laptop
with an empty token, and a dead `HTTPS_PROXY` prints the URL the CLI chose without
sending a byte. Two of the twenty-three episodes' worth of runner dispatches were
purchasable locally in under a minute; the asymmetry that made them look like a Railway
secret was one key in an `env:` block.
