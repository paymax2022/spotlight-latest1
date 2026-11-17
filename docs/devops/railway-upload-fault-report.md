# Railway `railway up` upload-initiate returns a non-JSON body — staging environment only

Evidence pack for a Railway support ticket. Written 2026-11-17 00:15Z from run
`43972239504` of `paymax2022/spotlight-latest1` and from `railway` CLI and GraphQL
queries against project `spotlight-platform`, none of which created a deployment.
Updated 08:20Z the same day with episode 3 (see Reproduction): 54 more refusals
across two runs while development accepted in the same minutes. Updated again at
12:52Z with episode 4: a full push-triggered release, refused 27 out of 27 on
staging while its own development legs and its own staging `supabase db push`
succeeded in the same run. Updated a third time at 14:48Z with episode 5: two
back-to-back dispatches of that same commit, refused 54 out of 54 staging calls
over 3,474 s, while each run's own three development uploads were accepted — the
last of them 49 s before the same service was refused. Updated a fourth time at
16:05Z with episode 6: run `44108272486`, a commit whose only executable
changes are the release gate and its harness, refused 27 out of 27 staging
calls over 1,170 s while its three development uploads produced `SUCCESS` rows
54-60 s before the same service was refused. No token value appears here.

## The ask

`railway up` to **one environment** of our project intermittently fails before any
bytes move:

```
Failed to fetch: error decoding response body
    0: error decoding response body
    1: expected value at line 1 column 1
```

The CLI exits 1 inside ~1 s, no deployment row is created, and no `Indexing...`
line is printed. **What we need from you: what does your upload-initiate endpoint
actually return, and under what condition, when the answer is not JSON — for
`environmentId = 6b5f27a3-a290-4574-a977-363eb21d43ad` specifically?** We cannot
capture the status code or body: the CLI discards both. If there is a verbose or
wire-log mode that prints the response, name it and we will produce it.

## Identifiers

| | |
|---|---|
| project | `e7dca861-3667-4d9a-8090-6d2f4d179ec2` (`spotlight-platform`) |
| environment refusing | `staging` = `6b5f27a3-a290-4574-a977-363eb21d43ad` (created 2026-11-02, `sourceEnvironment: staging-Old` `acf4b4fe-d3bf-4498-87d2-7a7623c2ab34`, which still exists) |
| environment accepting | `development` = `87489af5-8543-4d17-8811-1241c8869430` |
| services | `backend` `70de07d8-c058-4221-b645-61c4f1ac7aa5`, `frontend-web` `dda6372c-0bb7-4014-a2b1-aa646c11a281`, `frontend-admin` `c4f1086e-0a2d-4367-b503-209c14a2ce6f` — the same three service IDs in every environment, and the only three this pipeline uploads. The project's other two services are `Redis` `abb35037-00ae-4fe5-a4db-cb7467c09327` and `notification-worker` `db24e35f-0178-4924-a95b-fdebcd62ac54`; the latter has no staging instance at all |
| CLI | `@railway/cli@5.40.1` pinned in CI; also reproduced on 5.71.0 and 5.74.1 |
| auth | project tokens, minted per environment in the dashboard |

## The differential that makes this yours and not ours

Run `43972239504`, commit `4d78ecf69e49f6812856a1e65a073b0d7fcf2ea3`, one GitHub
runner, one minute. Development legs and staging legs call **the same command
shape against the same project and the same service IDs at the same time**; only
`--environment` and the token differ.

| UTC | call | result |
|---|---|---|
| 23:18:15.08 | `railway up frontend-admin --path-as-root … --environment development` — upload POST opens | — |
| 23:18:16.38 | development `frontend-web` upload POST opens | — |
| 23:18:17.21 | development `frontend-admin` | **accepted** after 2.12 s → deployment `90ed3f04-9749-4961-b7ed-1b19a7fadd04` |
| 23:18:17.23 | development `backend` upload POST opens | — |
| 23:18:19.71 | development `backend` | **accepted** after 2.49 s → deployment `ec68ded5-5de3-4d0b-994e-d4538685d5b8` |
| 23:18:25.22 | `railway up --no-gitignore --service frontend-admin --environment staging --project e7dca861… --detach --message 4d78ecf6…` | **refused** 519 ms after its step started |
| 23:18:27.45 | development `frontend-web` | **accepted** after 11.08 s → deployment `61701dbd-a7ac-4627-b483-273075a77f32` |
| 23:18:29.38 | `railway up backend --path-as-root … --environment staging …` | **refused** 728 ms after its step started |
| 23:38:48.08 | staging `frontend-web`, attempt 9 of 9 | **still refused** — and staging `frontend-web`'s own first attempt died 703 ms in |

The three staging legs' first attempts died **519 ms, 703 ms and 728 ms** after
`railway-deploy.sh` started, and across all 27 staging calls their logs contain
**zero `Indexing...` lines and zero `Uploading...` lines** — the CLI never reached
the point of reading the tree. The three development uploads in the same job took
**2.12 s, 2.49 s and 11.08 s** from `Uploading...` to a returned deployment ID.

One accepted request's own round trip contains a refused one. Across the whole
episode — 23:18:25.2 to 23:38:48.1, 1223 s, 27 staging calls (nine per leg) over
three services — not one of ours was accepted, and our retry budget expired
mid-fault. Every development leg in the same job succeeded, and the
`smoke Development` probes that followed passed against the builds those uploads
produced.

**The 27 refused calls created no deployment records**, which we can show from
your own API rather than from our logs. Queried at 2026-11-17 00:10Z, five hours
after the episode, `serviceInstance(…, environmentId: 6b5f27a3…).latestDeployment`
still returns the pre-episode deployment for all three staging services:

| staging service | latest deployment | `createdAt` | status |
|---|---|---|---|
| `backend` | `28946ae4-1126-4cf0-867f-a71df15e7a77` | 2026-11-16 17:06:29.046Z | `SUCCESS` |
| `frontend-web` | `d5825eff-abe9-4be1-aaeb-2d1f1b791991` | 2026-11-16 16:11:27.795Z | `SUCCESS` |
| `frontend-admin` | `e4670d96-f95f-4c20-8a10-64f0eb7a84c1` | 2026-11-16 15:56:15.481Z | `SUCCESS` |

So nothing on those three services has been accepted since 17:06Z, every
instance is healthy and reports a `SUCCESS` latest deployment, and none of the 27
refusals produced a deployment row.

## What we measured out, and how

Each row is an experiment, not a guess. All were run against the live staging
environment; the credential was the same per-environment project token our CI
uses, except where the row says otherwise.

| candidate | evidence against it |
|---|---|
| credential value / paste corruption | a deliberately corrupted token produces `Unauthorized. …` or `Login state is corrupt … failed to parse header value`, never a decode error. The staging secret has completed uploads with the same value: deployment `28946ae4`, `cliMessage f7d1ac27…-serial2-i3`, 2026-11-16 17:06:29Z |
| credential scope | `railway status --environment staging --json` returns 40,632 bytes of JSON from the same runner, and `railway api projectToken { … }` resolves the staging secret to `environmentId 6b5f27a3…`. From a laptop session authenticated as the project **owner**, `railway up --service f2-probe-nonexistent --environment staging --project e7dca861…` answers cleanly with `Service not found` — so environment resolution and service lookup on that environment are healthy and the failure is later in the flow. (We have not run that last probe with the project token; we cannot create a deployment to test with without overwriting a live staging service.) |
| upload shape | development and staging receive identical shapes for `backend` (`--path-as-root`, `BUILD_DIR=backend`); development is accepted, staging refused. Staging's pathless repo-root frontend uploads have also succeeded from CI (`7f7efc20` SUCCESS, serving the expected literal) |
| archive size | a 133,423,024-byte archive from a 211,126,634-byte checkout uploaded fine; a 6-byte archive failed for an unrelated reason |
| in-flight concurrency | one job made the identical staging `backend` upload twelve times: six strictly serial (`ab-S1`-`ab-S6`, ~9 s apart, 17:01:1x-17:01:50Z) and six fired together (`ab-C1`-`ab-C6`, 17:02:59.247-17:03:04.238Z — **all six inside 5.0 s**). Every one produced a deployment row in `railway deployment list --environment staging --service backend`, each superseding the last. A pile-up cap would have refused some of the six |
| request rate | staging accepted two uploads 3 s apart at 16:34:47 / :50 and refused the next one 62 s later |
| runner / OS / `CI=true` | a container with all three present behaved identically to the GitHub runner; the same runner accepts development in the same second |
| environment name ambiguity | `railway environment list` shows exactly one environment named `staging` (`6b5f27a3…`, `isEphemeral: false`, `restricted: false`, created 2026-11-02 by forking `staging-Old`); all three services CI deploys report a `SUCCESS` latest deployment on it, so nothing is paused or stuck |
| environment protection rules | none configured; a probe job declaring the same environment produced both outcomes |
| connected git source | **this row was dismissed in our first write-up and we now think that dismissal was a reasoning error — see "the one variable that fits" below.** Re-measured 2026-11-17 with `railway api serviceInstance(serviceId, environmentId) { source { repo } }`: staging's instances report `source.repo = paymax2022/spotlight-latest1`, development's report `repo: null`, production's reports `source: null`. Staging also accepted twelve consecutive uploads with that source connected, which is why we dropped it |

## The one variable that fits

`--environment staging` is the only difference between the refused calls and the
accepted ones — same project, same three service IDs, same CLI build, same
archive shape, same runner, same second, different answer. And the property that
makes that environment unique in this project is the connected git source above,
re-measured service by service at 2026-11-17 00:10Z:

| service | `source.repo` on `staging` | on `development` | on `production` |
|---|---|---|---|
| `backend` | `paymax2022/spotlight-latest1` | `null` | `source` is `null` |
| `frontend-web` | `paymax2022/spotlight-latest1` | `null` | `source` is `null` |
| `frontend-admin` | `paymax2022/spotlight-latest1` | `null` | `source` is `null` |

`staging` is therefore the only environment in this project whose uploadable
service instances carry a `ServiceSource` with a repo — and the property is
per-instance, not per-environment: staging's own Redis instance exists and
reports `source.repo = null`. The three instances that carry a repo are exactly
the three that have ever refused an upload. Redis would be the control inside the
refusing environment, but a database service is not something `railway up` can
upload, so we cannot exercise it.

We rejected the source because staging *also* accepted uploads while it was
connected. That proves only that the source is not sufficient to cause a
refusal. It does not rule it out as a necessary condition, and no other
candidate explains why `development` accepted in the same job at the same second
in both episodes. We state the limit of that comparator rather than lean on it:
production, which also carries no `ServiceSource`, was last uploaded from a
laptop at 09:06:11Z and 09:06:41Z on 2026-11-16 (`616bd93b…` and `ea71b561…`,
both `SUCCESS`) — seven hours *before* this episode's fault window opened, so its
legs have never been asked for an upload while the fault was live. The clean test
of the source hypothesis is staging's own source, which we have not touched.

So the specific thing we would like checked: **does upload-initiate behave
differently for a service instance that has a `ServiceSource` — does it resolve
the installation, look up a branch, or check for an in-flight push-deploy before
answering?** If it reaches GitHub at that point, an intermittent failure there
fits every observation: sub-second refusal, no `Indexing...` line, one
environment only, and recovery on its own timescale. We are ready to disconnect
that source as a test, but we would rather ask than mutate a live environment on
a theory.

## Cost to us

`release.yml` promotes `main → development → staging → production`, with
`smoke-staging` gating production. Every staging upload refused means production
is never attempted: `deploy Production` and `smoke Production` skip. Releases have
therefore been done by hand-running `railway up` from a laptop, which is exactly
the audit gap your CI path is meant to remove. Our retry budget is not the fix —
we have already widened it to 900 s of guaranteed backoff, and in episode 2 that
budget spent 1223 s of attempts, was refused 27 times out of 27 calls, and was
still being refused the moment it gave up. Episode 3 repeated the shape back to
back: on 2026-11-17, 07:36-08:16Z, two consecutive runs were refused 54 times out
of 54 staging calls across a single 40-minute window, still with no deployment
row to show for any of them. Episode 4 closed the same day with the strongest
form of the differential we can produce: run `44076555018` refused 27 out of 27
staging calls (12:26:06-12:45:56Z, nine per leg) in a run whose three development
uploads succeeded at 12:25:32-39Z and whose `migrate staging database / supabase
db push (staging)` job — which reaches the staging database over its own
`SUPABASE_*` credentials and never calls Railway at all — succeeded in the same
minutes. We now rate that leg weaker than we first wrote it: measured in
episode 6's run, the step logs `Connecting to remote database...` and then
`Remote database is up to date.` and exits, so it proves the staging Postgres
is reachable and its migration registry is at head — not that anything was
written, and nothing about Railway, which it does not call. The load-bearing
comparator stays the same run's development legs: only upload-initiate answers
non-JSON. Episode 5 is that
same release dispatched twice more in the hour after: runs `44086726792` and
`44092969961`, both `workflow_dispatch` of the same commit `b4bba6e5f`, refused
54 times out of 54 staging calls (nine per leg per run, 12:50:22-13:48:17Z) while
each run's own three development uploads were accepted and its own staging
`supabase db push` succeeded. The comparator is now down to seconds — development
`backend` created deployment `c68da956` at 13:28:34.784Z, and staging `backend`
was refused 49 s later at 13:29:24.172Z, same commit, same runner, same CLI build,
same project, same service ID.

Episode 6 is run `44108272486`, the push of `c5d92c464` — a commit that changes
`scripts/ci/release-gates.py` and its harness, i.e. the gate that decides
whether to deploy at all, plus two docs files. It does not touch
`scripts/ci/railway-deploy.sh` or the `railway up` call. The gate ran that new
code, returned `proceed` after 41m46s, and the upload path then behaved exactly
as in the five earlier episodes: nine refusals on each staging leg, 27 calls
across 1,170 s (15:37:37.183-15:57:07.561Z), the first one 727 ms after the
deploy marker, and zero `Indexing...` and zero `Uploading...` lines in all three
legs. Development in the same run produced `SUCCESS` rows at 15:36:37.443Z
(`b6a4949f`), 15:36:41.228Z (`9107e0c5`) and 15:36:43.953Z (`069837f2`). The
tightest same-basis pair is development `backend`'s row against staging
`backend`'s first refusal, 54.2 s apart, which does *not* beat episode 5's 49 s
— so we record episode 6 as a sixth repetition, not as a tighter differential.
Production was again never attempted: `smoke Staging`, `migrate production
database`, `deploy Production` and `smoke Production` all skipped.

## Reproduction

Push any commit to `paymax2022/spotlight-latest1:main` and watch
`Release (main → development, staging, production)` → `deploy Staging (*)`. The
fault is intermittent, so this may need several attempts, and a docs-only merge
produces no attempt at all: run `44111967023` cleared its gate in 5m30s and
skipped every deploy leg because no service changed, so a sample needs a commit
that changes a service. Six episodes are on
the record: 16:23:32-16:38:15Z on 2026-11-16, in which CI's staging calls were
refused throughout (though a probe job was accepted twice inside that span, at
16:34:47 and 16:34:50Z); 23:18:25-23:38:48Z the same day, in which all 27 were
refused; and 07:36:04-08:16:24Z on 2026-11-17 — a 40-minute window spanning two
runs back to back — in which all 54 were refused: nine calls per staging leg per
run, every one the same decode error, zero `Indexing...` lines, while the second
run's three development legs uploaded fine and passed their smokes in the same
minutes; and 12:26:06-12:45:56Z the same day, in which one push-triggered release
was refused 27 times out of 27 while its own three development uploads succeeded
16 minutes earlier and its own `migrate staging database / supabase db push
(staging)` job succeeded against the staging database on Supabase's own
credentials, which is not a Railway call; and
12:50:22-13:48:17Z the same day — 3,474 s spanning two back-to-back dispatches of
that identical commit — in which all 54 staging calls were refused, nine per leg
per run, every one the same decode error with zero `Indexing...` and zero
`Uploading...` lines, while both runs' own development legs uploaded fine and
passed their smokes; and 15:37:37-15:57:08Z the same day, in which a sixth
release — the one carrying our gate hardening — was refused 27 times out of 27
while its own three development uploads built `SUCCESS` rows 54-60 s earlier.
Not one staging deployment row was created on 2026-11-17: at 08:18Z the
three `latestDeployment` records still dated from 2026-11-16 (`e4670d96`,
`d5825eff`, `28946ae4`), and a fourth episode four hours later did not change
that — re-measured at 12:50Z, after all 27 of episode 4's refusals, the staging
instances still report those same three 2026-11-16 deployments, and the project's
only deployment rows created after 12:00Z are that run's three `development`
uploads. Re-measured a fifth time at 14:45Z, after all 54 of episode 5's
refusals: staging's `latestDeployment` records are *still* `28946ae4`,
`d5825eff` and `e4670d96`, all dated 2026-11-16 — the environment has now been
dark for 21 h 39 min — while `railway deployment list --environment development`
for the same commit shows rows created at 12:25:32-39Z, 12:49:56-12:50:00Z and
13:28:32-34Z — the 13:28 set `SUCCESS`, the two earlier sets `REMOVED` only
because the later upload superseded them, which is development behaving
normally. Re-measured a sixth time at 16:01:40Z, after all 27 of episode 6's
refusals: staging's `latestDeployment` records are *still* `28946ae4`,
`d5825eff` and `e4670d96`, all dated 2026-11-16 — the environment has now been
dark for 22 h 55 min — while that run's three development instances report the
`SUCCESS` rows named above. All four of 2026-11-17's episodes sit inside a
single day in which
the development project token — a different credential from staging's, per
Identifiers — the same CLI and the same three service IDs accepted every
development upload. Job logs are retained: runs `43905969462`,
`43909191817`, `43913775480`, `43972239504`; staging jobs `133687154665` /
`133687154683` / `133687154708` (episode 2), `133891749720` / `133891749721` /
`133891749748` (episode 3, re-run attempt), `133899929022` / `133899928994` /
`133899928889` (episode 3, dispatch), `134038233231` / `134038233306` /
`134038233308` (episode 4, run `44076555018`, push to `main` at
`b4bba6e5f3b8057a83c2f447e8e60085efcea64f`), `134051443726` / `134051443747` /
`134051443856` (episode 5, run `44086726792`) and `134073206498` /
`134073206566` / `134073206688` (episode 5, run `44092969961`) — both of those
runs being `workflow_dispatch` attempts of the same commit
`b4bba6e5f3b8057a83c2f447e8e60085efcea64f`, whose own development legs are jobs
`134051183072` / `134051183108` / `134051183252` and `134072854755` /
`134072854783` / `134072854845`, and whose staging `db push` jobs are
`134051184868` and `134072855096`. Episode 6 is run `44108272486`, a push to
`main` at `c5d92c46423bbac5da4f608232ce1ae63ed6df4d`, whose staging jobs are
`134155618689` / `134155618802` / `134155618892`, whose development legs are
`134154961295` / `134154961117` / `134154961292`, whose gate is `134126509186`
and whose staging `db push` is `134154961344`; the docs-only run that followed,
`44111967023`, is retained too, as the control showing a no-service change
skips every leg.
