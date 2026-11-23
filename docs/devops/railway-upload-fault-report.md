# Railway `railway up` upload-initiate returns a non-JSON body — staging environment only

Evidence pack for a Railway support ticket. Written 2026-11-17 00:15Z from run
`43972239504` of `paymax2022/spotlight-latest1` and from `railway` CLI and GraphQL
queries against project `spotlight-platform`, none of which created a deployment.
Updated 08:20Z the same day with episode 3 (see Reproduction): 54 more refusals
across two runs while development accepted in the same minutes. Updated again at
12:52Z with episode 4: a full push-triggered release, refused 27 out of 27 on
staging while its own development legs succeeded in the same run — its staging
`supabase db push` succeeded too, but that job is a Supabase call, not a Railway
one, as Cost to us now says. Updated a third time at 14:48Z with episode 5: two
back-to-back dispatches of that same commit, refused 54 out of 54 staging calls
over 3,474 s, while each run's own three development uploads were accepted — the
last of them 49 s before the same service was refused. Updated a fourth time at
17:42Z with episode 6: run `44108272486`, a commit whose only executable
changes are the release gate and its harness, refused 27 out of 27 staging
calls over 1,170 s while its three development uploads produced `SUCCESS` rows
54-60 s before the same service was refused. Updated 2026-11-18 at 11:50Z with
episode 7: run `44285855063`, a backend-only commit, refused 27 out of 27
staging calls over 1,165 s while its own three development uploads returned
deployment IDs **29.3, 35.1 and 57.7 s** before that same service was refused —
the tightest same-basis pair on the record — and in which `frontend-admin`
failed all nine of its staging calls although the commit contains no
`frontend-admin/` file at all. Updated the same day at 12:37Z with episode 8:
run `44296221501`, the very next release (tip `98bb394d0d`), refused 27 out of
27 staging calls over 1,183 s while its own three development uploads returned
deployment IDs 48.7-51.1 s before the same service was refused. Updated
15:52Z with episode 9: run `44323824351` (tip `6057b0d3c`, the menu-visibility
squash merge — one migration re-slotted above the registry schema, the
services-grid/module-keys gating and its three unit-test files, a new
non-required CI job, two docs files; no `backend/` and no `frontend-admin/`
file in it), refused 27 out of 27
staging calls over 1,134-1,201 s while its own development uploads were
accepted **25.8-33.3 s** before the same service was refused — backend's
25.8 s the tightest pair yet — and its staging `supabase db push` applied the
new migration; in the same minutes, uploads to the same staging services from
outside CI were being accepted (a local backend deploy succeeded at 15:00:33Z
and a second, carrying the released tip itself, succeeded at 15:18Z; the other
local attempts failed later at build on the submitting machine), so the
refusal is
CI-path-specific, not an environment outage. Updated 15:56Z with episodes 10,
11 and 12 and with the two captures this pack said were uncapturable: **the
status code and the endpoint.** Episode 10 is run `44329801870` — Release's
`deploy-staging` matrix copied verbatim onto a branch (all three services,
`ref: main`, the pin, the staging secret) with `max-parallel: 1`, so the three
uploads could not overlap; it refused 4 of 4 at 14:56:37-14:57:59Z with zero
`Indexing...` lines, which removes the last repo-side structural difference we
could point at. And `railway up --verbose` — the flag the ask below used to beg
for the name of — prints the URL, the `bytes:` of the archive and an explicit
status, which let us chase the laptop-side failures and **eliminate them as
evidence**: six repo-root frontend archives of 133,527,512 bytes died with
**`Failed to upload code with status code 524`** on
`https://backboard.railway.com/project/{project}/environment/{env}/up`, and the
uploading machine measures **11.217 Mbps uplink** (`networkQuality -s`,
16:20Z) — 1,068,220,096 bits at that rate is 95 s of transfer at line rate, and
Cloudflare's proxy window is ~100 s. A 7,511,269-byte backend archive from the
same machine takes ~5 s and was accepted (`162c1d04`, `SUCCESS`
15:18:18.823Z, staging's backend now runs main's tip). **Those laptop refusals
are our bandwidth, not your fault, and we are withdrawing them from the
differential.** What survives is the CI signature — sub-second, pre-row, from a
runner that uploads the same 133 MB class to `development` in the same job —
and the two queryable artifacts in "What episode 10, 11 and 12 add".
**Episode 12 then removes our last own-side suspect:** the A/B ran **twice** —
once inside a real Release (`44296221501` re-run with `--failed`, 15:52:03Z to
16:10:14Z, nine attempts on each of the three staging legs) and once on a
branch-scoped serial matrix (`44349761092`, `16:44:57.617Z` and `16:45:21.001Z`)
— and both times the staging instance whose connected git source we disconnected
refused exactly like the two that kept theirs, so
`ServiceSource.repo` is not the discriminator; the one that is left is the
credential path — a per-environment project token from a runner refuses
pre-row on staging while this account's own login session is accepted on the
same instances minutes later. Updated the same day at 17:25Z with
a **positive control** rather than an episode: `serviceInstanceDeploy` put
`main`'s tip `a30a8fd5b…` on all three staging services — three rows, three
snapshots, three `SUCCESS` inside two minutes — while the upload path was still
refusing, which confines the fault to upload-initiate and not to staging. See
"Positive control". Updated a last time for that day at 22:20Z with episode 13 — the
fault surviving a brand-new `RAILWAY_TOKEN_STAGING` — and with the differential probe
that produced the transport change, both recorded in the
[Resolution](#resolution--2026-11-18-2154z-the-fault-is-time-windowed-and-staging-no-longer-depends-on-it).
No token value
appears here. The chain continued on 2026-11-19 with episodes 14, 15 and 16, each
summarised in its own block below; episode 15 established the narrowed ask and episode 16
re-produced it on a commit with no application code in it at all. The chain continued on
2026-11-20 with episode 17: run `44774228871` refused 27 of 27 staging calls at
17:13-17:32Z and, after `gh run rerun --failed` re-executed exactly those three legs,
another 27 of 27 at 20:19-20:39Z — **54 refused requests from one commit**, `9cedaad87…`,
with identical argument strings, identical CLI, identical token and no deployment row in
either wave. Its same-basis pairing is timed from Railway's own deployment rows
(27.5-30.0 s), and it records why the two arms interleave at all: `deploy-staging` needs
`gates` and `migrate-staging`, never the development deploys.

> **Episode 14 (2026-11-19 08:31Z) changes how to read the two arms of every
> table above.** Today's two real release attempts failed **six** legs, not three.
> The development uploads are no longer a positive control: each one now dies
> **0.12-0.94 s** after `Uploading...` with a legible
> **`Your trial has expired. Please select a plan to continue using Railway.`**
> The staging legs still die exactly the way this report describes — pre-row,
> `error decoding response body`, 18 such lines on each of the five staging legs
> that reached the CLI (9 attempts × 2 lines), and **zero** `Indexing...`,
> **zero** `Uploading...`, **zero** trial lines — so staging never even reaches
> the plan gate. (The sixth leg, `135437519699`, died in `actions/checkout` on a
> GitHub-side git transport error and is not counted as evidence.) Read as
> evidence this leaves *The ask* unchanged and narrows it: nothing has been
> uploaded to **any** environment of this project since 2026-11-18T21:54:16Z.
> The billing gate is ours to settle, not yours; the record of both signatures
> side by side is Episode 14, below.
>
> **Episode 15 (2026-11-19 15:19-15:49Z) settles that gate, and supersedes two
> sentences of the block above.** The owner added a plan — no agent touched
> billing; `Project.subscriptionType` reads `"hobby"` from 15:45Z — and
> development uploads resumed from the same runner class: run `44547867538` shows
> all three dev legs printing `Indexing...` → `Uploading...` → a byte count
> (`1930791`, `103327180`, `7516645`) in the same minutes as the three staging
> legs of the *same commit* refused 9/9 with **zero** `Indexing...`. So "nothing
> has been uploaded to any environment" held only for the 08:31-14:45Z plan-gate
> window, and "the development uploads are no longer a positive control" is now
> reversed: they are a positive control again, and F2 is demonstrably not the
> plan gate on a different transport. **The live ask is the narrowed one in
> Episode 15** — the status and body of the request that *obtains the upload
> destination* for environment `6b5f27a3-a290-4574-a977-363eb21d43ad` at
> 2026-11-19 15:20:10-15:20:13Z — not the archive PUT that follows it, and not
> the version of *The ask* below, which predates that measurement.
>
> **Episode 16 (2026-11-19 23:09-23:30Z) is the freshest window and the cleanest
> control.** Run `44629671567`, head `d446dfd9e`, a commit whose only file is
> `docker-compose.yml` — no application code changed anywhere in it, so nothing
> in our tree can explain the split that followed: three development legs landed
> (`Indexing...` → `Uploading...` → `1930743` / `103321303` / `7516251` bytes,
> rows created 23:09:56-23:10:04Z) while the three staging legs of the same
> commit refused 9 times each with **zero** `Indexing...`, **zero** `Uploading...`
> and **zero** deployment rows, the staging backend's first refusal arriving
> **0.689 s** after its `stamped backend/BUILD_COMMIT` line. Billing is now
> excluded outright: `Project.subscriptionType` reads `hobby`, the staging
> instances' own deployment metas say `"plan": "hobby"`, and the trial sentence
> appears zero times in those logs. **The pull list at the end of Episode 16 is
> what to ask for now** — environment `6b5f27a3-a290-4574-a977-363eb21d43ad`,
> ref `d446dfd9e`, 23:11:03.627Z / 23:11:08.421Z / 23:11:22.142Z first refusals.
>
> **Episode 17 (2026-11-20 17:13-20:39Z) is the freshest window and it refuses the
> same commit twice.** Run `44774228871`, head `9cedaad87…` — a `frontend-admin` +
> `docs/ops` release with no `backend/` file in it — refused 27 of 27 staging calls in
> its first attempt (17:13:37-17:32:23Z) and, after `gh run rerun --failed` re-executed
> only those three legs three hours later, another 27 of 27 (20:19:05-20:39:13Z). Fifty-four
> requests, zero `Indexing...`, zero `Uploading...`, zero `bytes:`, zero deployment rows,
> and not one trial sentence. Meanwhile that attempt's own development legs printed
> `Indexing...` → `Uploading...` → `1979720` / `103327021` / `7523897` bytes and Railway
> created their rows at 17:13:09-17:13:11Z — **27.5, 28.7 and 30.0 s** before the staging
> refusal of the same service, measured this time from Railway's own deployment rows. The
> two lanes overlap because they are designed to: `deploy-staging` needs `gates` and
> `migrate-staging`, not `deploy-development`. **Pull list now:
> environment `6b5f27a3-a290-4574-a977-363eb21d43ad`, ref `9cedaad87…`, both attempts** —
> first refusals 17:13:37.826Z / 17:13:38.041Z / 17:13:41.642Z and 20:19:05.552Z /
> 20:19:06.092Z / 20:19:15.085Z.
>
> **Episodes 18-21 (2026-11-22 13:53Z → 2026-11-23 15:17Z) supersede the pull list
> above and settle the last open question in this pack.** Episode 19 retired the
> credential-class story (three project tokens decode `railway status --json` in a
> runner; the curl sampler, not the token, was refusing), and **Episode 21 then
> measured the write**: CI's own `RAILWAY_TOKEN_STAGING` calls
> `serviceInstanceDeploy(serviceId, environmentId, commitSha)` and staging deploys
> — `PROBE_VERDICT[backend]=project-token-can-deploy`, run `45194092365`, 14:27:14Z,
> a new `SUCCESS` row 30 s later, zero bytes uploaded. In the same three hours the
> upload path refused **27 out of 27** staging calls across three consecutive trains
> (`45171028615`, `45179479514`, `45194518587`), nine attempts per leg, every leg
> with zero `Indexing...`, zero `Uploading...` and **zero deployment rows**, while the
> mutation deployed those same three staging services to the same commit in 28 seconds
> (rows `2df11e51`, `d7abcc2e`, `6e39f119`, 14:29:10-14:29:38Z). That is the control
> this pack was missing: the environment, the services, the plan and the credential
> are all demonstrably deployable, and only the request that obtains the upload
> destination refuses. **Pull list now: environment
> `6b5f27a3-a290-4574-a977-363eb21d43ad`, refs `d563144151…` / `0329a903a5…` /
> `09921c258f…`, nine legs — first-refusal times in Episode 21.**

## The ask

`railway up` to **one environment** of our project intermittently fails before any
bytes move:

```
Failed to fetch: error decoding response body
    0: error decoding response body
    1: expected value at line 1 column 1
```

The CLI exits 1 inside ~1 s, no deployment row is created, and no `Indexing...`
line is printed. **What we needed from you we have now found ourselves:**
`railway up --verbose` prints the request line and the archive size, and in the
failure it prints the status code — `Failed to upload code with status code 524`,
which is Cloudflare's origin-timeout, on

```
https://backboard.railway.com/project/e7dca861-…/environment/6b5f27a3-…/up?serviceId=…&message=…
```

So the revised ask is narrower and it is about that route. Two arms, and we now
know they are different questions:

1. **The laptop arm is ours to fix.** A 524 after a long transfer on a machine
   measured at 11.217 Mbps uplink is Cloudflare's ~100 s proxy window closing on
   a 133 MB upload; the same machine lands a 7.5 MB archive in ~5 s. We are not
   reporting that as a fault, and we have stopped uploading repo-root archives
   from it.
2. **The CI arm is the one we need you on.** From a GitHub runner — which
   uploads the same 133 MB class to `development` in the same job, and did so at
   14:23:32.640Z and 14:23:35.695Z today — the staging upload-initiate on
   `environmentId = 6b5f27a3-a290-4574-a977-363eb21d43ad` answers in
   **well under a second** with a body that is not JSON, creates **no deployment
   row**, and the CLI never reaches `Indexing...`. A sub-second refusal cannot be
   a payload timeout. **What we need is the server-side record of those
   initiations** — the episodes are timestamped to the millisecond in Reproduction
   (episode 9: 14:29:15Z backend, 14:29:17Z frontend-admin, 14:29:22Z
   frontend-web, nine attempts each through 14:48:57.578Z; episode 10,
   serialised: 14:56:37-14:57:59Z) — and whether anything on the staging
   environment's upload path is rate-limited, circuit-broken or routed
   differently from `development`'s.

> **Everything above is the 2026-11-18 form of the ask; the dates in it are that
> day's.** Episode 15 (final section) moves two points: the development arm is a
> positive control again — the plan gate came off before run `44547867538`, whose
> dev legs landed from 15:19Z, and `Project.subscriptionType` read `"hobby"` at
> the 15:45Z probe — and
> the failing request has been narrowed from "the staging upload-initiate" to the
> call that *obtains the upload destination* — the one that dies before
> `railway up --verbose` can print a URL, a byte count or a status code, which is
> why no flag on our side can ever surface the number. The timestamps above are
> still the ones to pull from your edge logs; the freshest datum is Episode 17 —
> run `44774228871` (attempt 1) and the same run's attempt 2 from `gh run rerun
> --failed`, ref `9cedaad87…`, three services, nine refusals each in each attempt,
> fifty-four staging requests, zero deployment rows, first refusals at
> 17:13:37.826Z / 17:13:38.041Z / 17:13:41.642Z and 20:19:05.552Z / 20:19:06.092Z /
> 20:19:15.085Z on 2026-11-20 — a commit whose only changed code is
> `frontend-admin/**` and `docs/ops/**`.

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
| archive size | a 133,423,024-byte archive from a 211,126,634-byte checkout uploaded fine; a 6-byte archive failed for an unrelated reason. **Re-tested 2026-11-18 with `--verbose`, and the apparent size discriminator dissolved**: seven laptop uploads split cleanly by size (one 7,511,269 B accepted, six 133,527,512 B `524`), which is what a ~100 s proxy ceiling does to a machine measuring **11.217 Mbps uplink** — 133 MB is 95 s of line-rate transfer there. Size is a property of the *submitting link*, not of the environment, and CI's refusal is not that: it arrives in well under a second from a runner that ships the same size to `development` in the same job. See episode 11 |
| in-flight concurrency | one job made the identical staging `backend` upload twelve times: six strictly serial (`ab-S1`-`ab-S6`, ~9 s apart, 17:01:1x-17:01:50Z) and six fired together (`ab-C1`-`ab-C6`, 17:02:59.247-17:03:04.238Z — **all six inside 5.0 s**). Every one produced a deployment row in `railway deployment list --environment staging --service backend`, each superseding the last. A pile-up cap would have refused some of the six. **Re-tested 2026-11-18 14:56:37-14:57:59Z** with the whole staging matrix at `max-parallel: 1` — three services, one at a time, no overlap possible, CI, the pin, the staging secret: run `44329801870` refused 4 of 4 (`Indexing lines: 0`). Serialization is not a protection |
| request rate | staging accepted two uploads 3 s apart at 16:34:47 / :50 and refused the next one 62 s later |
| runner / OS / `CI=true` | a container with all three present behaved identically to the GitHub runner; the same runner accepts development in the same second |
| environment name ambiguity | `railway environment list` shows exactly one environment named `staging` (`6b5f27a3…`, `isEphemeral: false`, `restricted: false`, created 2026-11-02 by forking `staging-Old`); all three services CI deploys report a `SUCCESS` latest deployment on it, so nothing is paused or stuck |
| environment protection rules | none configured; a probe job declaring the same environment produced both outcomes |
| connected git source | **this row was dismissed in our first write-up and we now think that dismissal was a reasoning error — see "the one variable that fits" below.** Re-measured 2026-11-17 with `railway api serviceInstance(serviceId, environmentId) { source { repo } }`: staging's instances report `source.repo = paymax2022/spotlight-latest1`, development's report `repo: null`, production's reports `source: null`. Staging also accepted twelve consecutive uploads with that source connected, which is why we dropped it. **Re-checked 2026-11-18 with `serviceInstance(serviceId, environmentId){ source{ repo } }`: the property is not even uniform across staging** — `backend` and `frontend-web` report `repo: paymax2022/spotlight-latest1`, `frontend-admin` reports `repo: ""` (an empty string, not null), and development reports `null` for all three. The clean test of the source hypothesis is running now: `frontend-admin`'s source was disconnected at ~15:52Z and its CI leg re-run, so the verdict is an A/B against `backend` and `frontend-web` in the same run rather than another correlation. This row stays open until that lands. **It landed: the verdict is NO — see "Status of that sentence" below and episode 12; the source was restored and verified by readback** |

## The one variable that fits

> **Superseded as of 2026-11-18 16:47Z — read this section for the reasoning, not
> for the ask.** The hypothesis below was tested twice that afternoon and failed
> both times; the falsification and the surviving discriminator (the credential
> path) are recorded immediately after it, and the live ask is the one in
> "The ask". We are leaving the section in place because the withdrawal *is* the
> finding we want you to see.

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

## Positive control, 2026-11-18 17:16-17:22Z: these same instances deploy `main` fine when Railway pulls the commit

We can now show that the refusing endpoint is the only broken part of this
environment, without waiting for you. `serviceInstanceDeploy` — the mutation
behind the dashboard's **Deploy** — was called once per staging service with
`latestCommit: true`:

```
railway api 'mutation($s:String!,$e:String!,$latest:Boolean){
  serviceInstanceDeploy(serviceId:$s, environmentId:$e, latestCommit:$latest) }' \
  --var s=<serviceId> --var e=6b5f27a3-a290-4574-a977-363eb21d43ad --var latest=true
```

Each returned `true`, each created a deployment row **with a `snapshotId`** — the
thing the upload path never gets far enough to make — built from
`branch: "main"`, and reached `SUCCESS` inside two minutes:

| service | deployment | created | `snapshotId` | `meta.commitHash` | status |
|---|---|---|---|---|---|
| `frontend-admin` | `bf679fce` | 17:16:40.749Z | `4e4c5637` | `a30a8fd5b…` | `SUCCESS` |
| `frontend-web` | `484b5797` | 17:18:26.703Z | `ff3e708e` | `a30a8fd5b…` | `SUCCESS` |
| `backend` | `7de6cf94` | 17:18:52.387Z | `531a9cf6` | `a30a8fd5b…` | `SUCCESS` |

and staging serves it: `GET /api/v1/public/build` on
`backend-staging-new.up.railway.app` answers
`{"commit":"a30a8fd5b68e084ac5b96436e97e1204fc0c17ac","started_at":"2026-11-18T17:21:48Z"}`
— the exact tip whose own staging upload legs refused 27 out of 27 in every run
whose legs opened, the last being run `44323824351` at 14:55-15:33Z.

So the project, the environment, all three service instances, their builds and
their swap-over are healthy **now, in the same minutes the upload path is
refusing**. Set that beside the credential-scope row above, where the same
staging token authenticates from a runner, resolves to `6b5f27a3…`, and drives
`railway status`, `railway api` and `railway deployment list` without error: the
fault is confined to upload-initiate for this environment and touches nothing
else about staging.

Two further exclusions came out of the same pass, both read-only.
`ServiceInstance.isUpdatable` is `false` on **all nine** instances — three
services in each of development, staging and production — so it cannot be what
separates the refusing three from the accepting six, and a `clearance` on the
staging instances is likewise excluded: it is `null` on all three, and those same
three accepted a deploy 40 s after we asked.

This section does **not** test the `ServiceSource` hypothesis, and we will not
present it as if it did: `serviceInstanceDeploy` and upload-initiate are
different endpoints, and this call went out under an owner user session rather
than a project token, so the endpoint and the credential both changed at once.
What it does settle is the operational half. All three staging instances carry
`source.repo = paymax2022/spotlight-latest1` again — the temporary removal from
`frontend-admin`'s described in the Reproduction notes has been reversed, by us
or from the dashboard we cannot tell from the API — and that instance then built
from that same source without trouble. The question we still put to you is the
one above: does upload-initiate take a different path, reaching out to GitHub,
when the target instance carries a `ServiceSource`?

So the specific thing we would like checked: **does upload-initiate behave
differently for a service instance that has a `ServiceSource` — does it resolve
the installation, look up a branch, or check for an in-flight push-deploy before
answering?** If it reaches GitHub at that point, an intermittent failure there
fits every observation: sub-second refusal, no `Indexing...` line, one
environment only, and recovery on its own timescale. We are ready to disconnect
that source as a test, but we would rather ask than mutate a live environment on
a theory.

**Status of that sentence as of 2026-11-18 16:47Z: the test has reported, and
the answer is NO — this section's hypothesis is falsified.** `frontend-admin`'s
staging `source.repo` was set to `""` at ~15:52Z (`serviceInstanceUpdate` with
`input: {source: {repo: ""}}`; `input: {source: null}` is a silent no-op that
still returns `true`), `backend` and `frontend-web` were left connected, and a
branch-scoped CI run executed all three staging uploads serially inside one
matrix — both arms, one job set, one runner class, one CLI pin, one secret. The
disconnected instance refused in exactly the same way as the two connected ones:
`16:44:57.617Z` and `16:45:21.001Z`, `error decoding response body` / `expected
value at line 1 column 1`, zero `Indexing...` lines, no deployment row. Full
numbers in episode 12. `frontend-admin`'s source has been restored
(`serviceInstanceUpdate input:{source:{repo:"paymax2022/spotlight-latest1"}}` →
readback `source{repo:"paymax2022/spotlight-latest1"}`, `rootDirectory
"frontend-admin"`), so all three staging instances are back in their
pre-experiment state and this pack is no longer describing a mutated config.

Two premises of this section also need correcting on the record: the source
property was never uniform across staging's instances during the experiment
window, and the laptop arm that was going to serve as a control for it turns out
to have been bandwidth-limited, so it controls for nothing. See "What episode 10,
11 and 12 add".

## What episode 10, 11 and 12 add

Three runs on 2026-11-18 afternoon close the last structural gaps and change the
shape of the ask.

**Episode 10 — serialization (`44329801870`, 14:56:37-14:57:59Z).** Episode 9
left one difference between CI's two accepts at 14:23:3x — single serial one-shot
uploads — and its own 27 refusals: CI's staging legs are a three-service matrix,
and every one-shot success up to then had been a serial upload. We took the
matrix and set `max-parallel: 1`, changing nothing else: `ref: main`, the pin,
`environment: staging`, the staging secret, `scripts/ci/railway-deploy.sh`, all
three services. Every leg refused (`Indexing lines: 0`, `decode-error lines: 4`
with `RETRY_ATTEMPTS=2`). Concurrency was the last repo-side structural
difference we could name, and it is now falsified too.

**Episode 11 — the laptop arm, measured, and withdrawn as evidence (15:18-16:20Z).**
A retry driver running from the project owner's laptop, one upload at a time, put
a 7.5 MB archive and six 133 MB archives through the same environment with the
same credential. `--verbose` reported the size of each; the small one landed
(`162c1d04`, `SUCCESS` 15:18:18.823Z — staging's `backend` now runs main's tip
`6057b0d3c`), and every 133 MB one died with
`Failed to upload code with status code 524`:

| row | created (UTC) | service / shape | `bytes:` | status |
|---|---|---|---|---|
| `162c1d04` | 15:18:18.823 | `backend`, `--path-as-root` | 7,511,269 | **SUCCESS** |
| `2071ea80` | 15:27:31 | `frontend-admin`, repo root | 133,527,512 | FAILED (524) |
| `37104509` | 15:38:52.103 | `frontend-web`, repo root | 133,527,512 | FAILED (524) |
| `e0d257a9` | 15:42:57 | `frontend-admin`, repo root | 133,527,512 | FAILED (524) |
| `3b3fa49c` | 15:47:09.377 | `frontend-web`, repo root | 133,527,512 | FAILED (524) |
| `94b26f40` | 15:49:47 | `frontend-admin`, repo root | 133,527,512 | FAILED (524) |
| `4746ac48` | 15:53:34.685 | `frontend-web`, repo root | 133,527,512 | FAILED (524) |

We initially read that as a payload-size discriminator inside staging. **It is
not; it is our own uplink.** `networkQuality -s` on that machine at 16:20Z
measures **11.217 Mbps uplink** (5.896 Mbps downlink, 557 ms idle latency):
133,527,512 bytes is 1,068,220,096 bits, which is 95 s at that rate at line
speed, against a Cloudflare proxy window of roughly 100 s — and 524 is
Cloudflare's origin-timeout status, delivered as an HTML page, which is exactly
what the CLI renders as `error decoding response body` /
`expected value at line 1 column 1`. A 7,511,269-byte archive is 5 s of the same
link. Two earlier captures on the same machine put the same arithmetic on the
wall clock: `Indexing...`/`Uploading...` ran ~35 s before
`error sending request for url (…/up?…)` → `Caused by: operation timed out` on a
7.5 MB archive, and 115 s on a 133 MB one — i.e. the link is variable enough that
even the small archive sometimes does not finish. So the laptop arm tells us
about our bandwidth and the ~100 s ceiling, and nothing about the fault; **we have
stopped uploading repo-root archives from that machine and we withdraw these seven
rows from the differential.** They are documented here rather than deleted because
the pack's earlier claim that "no deployment row is created" needs the correction
below, and because a reader who sees 524 in their own logs deserves the bandwidth
arithmetic before they file it as a server fault.

**Episode 12 — the A/B reports, and the git source is exonerated (16:40-16:46Z).**
Run `44349761092`, workflow "F2 staging upload probe (branch-only, no production
path)" on a diagnostic branch, `checkout ref: main`, `environment: staging`,
`secrets.RAILWAY_TOKEN_STAGING`, `@railway/cli@5.40.1`, the same
`scripts/ci/railway-deploy.sh` Release uses, `fail-fast: false` and
`max-parallel: 1` so the three legs cannot overlap, `RETRY_ATTEMPTS=2` so the run
finishes in minutes either way. The arms differ in exactly one instance property,
re-measured immediately before and after:

| leg (job id) | staging instance's `source.repo` at the time of the leg | attempts | what the CLI printed |
|---|---|---|---|
| `deploy Staging (backend)` (`134961865736`) | `paymax2022/spotlight-latest1` | 2/2 refused `16:40:25.871Z`, `16:40:52.371Z` | `Failed to fetch: error decoding response body` / `expected value at line 1 column 1`, no `Indexing...`, no row |
| `deploy Staging (frontend-web)` (`134961866303`) | `paymax2022/spotlight-latest1` | 2/2 refused `16:41:28.384Z`, `16:41:50.773Z` | same, ~0.5 s after the command |
| `deploy Staging (frontend-admin)` (`134961866826`) | **`""` — source disconnected for this test** | 2/2 refused `16:44:57.617Z`, `16:45:21.001Z` | same |

So the instance whose git source we removed behaved identically to the two that
kept theirs, in the same job, minutes apart. **`ServiceSource.repo` is not the
discriminator**, and with it the last repo-side structural suspect is gone: what
remains is that a project token from a runner is refused pre-row by staging's
upload-initiate while the same account's own login session is accepted on the same
instances within minutes. Six refusals added to the ledger; `frontend-admin`'s
source restored and verified by readback, as recorded above.

**The same A/B one arm earlier, on the lane that actually costs us (15:51:47-16:10:17Z).**
Before the branch matrix, the disconnected instance was tested on the real
`release.yml`: run `44296221501` — episode 8's release of tip `98bb394d0d` —
re-run with `--failed` after `frontend-admin`'s `source.repo` had been set to
`""`, so all three staging legs executed nine attempts each inside one production
release, same runner image, same pin, same secret.

| leg (job id) | `source.repo` during the leg | attempts | what the nine attempts printed |
|---|---|---|---|
| `deploy Staging (backend)` (`134928782893`) | connected | 9/9 refused `15:52:03.751Z` → `16:10:11.718Z` | 8 × `error decoding response body`, 1 × `error sending request for url (https://backboard.railway-staging.com/graphql/v2)` |
| `deploy Staging (frontend-admin)` (`134928782909`) | **`""` — disconnected for this test** | 9/9 refused `15:52:05.476Z` → `16:10:02.476Z` | 9 × `error decoding response body` |
| `deploy Staging (frontend-web)` (`134928783012`) | connected | 9/9 refused `15:52:03.787Z` → `16:10:14.891Z` | 9 × `error decoding response body` |

Zero `Indexing...` and zero `Uploading...` lines on all three legs, and the run
created no deployment row: queried afterwards through the API, the only staging
row anywhere in the 15:50-16:11Z window is `4746ac48` at 15:53:34.685Z — the
laptop's own 524, `meta.cliMessage = 6057b0d3c…`,
`meta.cliCaller = automation:launchd:f2_staging_driver` — not CI's sha. Twenty-
seven attempts, with the property under test the only difference between the
three legs, and the disconnected leg was indistinguishable from the two connected
ones. Same verdict as the branch matrix twenty minutes later, reached first on the
transport that matters.

**One host name we can hand you, with the caveat that it is n=1.** Across every
staging leg we have logs for, exactly one CI attempt printed the endpoint it was
talking to — the backend leg's sixth attempt, 16:02:44.979Z above:
`error sending request for url
(https://backboard.railway-staging.com/graphql/v2)`. Nothing on our side selects
an API domain: `release.yml` sets `RAILWAY_PROJECT`, `RAILWAY_HTTP_TIMEOUT` and
per-leg `RAILWAY_TOKEN`/`RAILWAY_ENV` only, the four repository `vars.*` are
feature flags, and the `staging`, `development` and `production` GitHub
environments carry no variables at all (production has one secret,
`SUPABASE_DB_PASSWORD`). So that host came from your side of the wire. We are not
claiming it is the cause — the other 26 attempts printed no URL — but if a canary
or blue/green hop exists between `backboard.railway.com` and
`backboard.railway-staging.com`, it is invisible to a client and one log lookup
for you.

**One correction that does survive the withdrawal.** Every CI refusal in episodes
1-10 created **no** deployment row and printed no `Indexing...` line. Each of the
laptop timeouts above created a `FAILED` row carrying our commit as
`meta.cliMessage`, and `deployment(id:)` on two of them —
`37104509-b197-40c6-bbd0-242bedae5b6a` and
`4746ac48-775f-455b-a380-65ac23749b00` — returns `snapshotId: null`,
`diagnosis: null`. So `error decoding response body` is what the CLI prints for
*any* non-JSON answer, and it covers at least two distinct server outcomes: a
pre-row refusal (the CI arm, sub-second, no row, which is the one we are asking
about) and a post-row snapshot timeout (an upload that dies mid-transfer). That
distinction is why this pack's title needs reading with the timestamps: only the
no-row cases are F2.

**The route's front door is healthy, and that is the problem.** A body-less
`GET` and `POST` to the exact upload URL, from a CI runner, at 15:20:48Z
(run `44334536965`; no archive was sent, deliberately — a real payload would land
on staging):

| probe | status | time | body |
|---|---|---|---|
| `GET …/environment/6b5f27a3…/up?serviceId=70de07d8…` with the staging token | `404` JSON `{"message":"Not Found","requestId":"ea241832-…"}` | 54.7 ms | 74 bytes |
| `GET` the same with the development token on `87489af5…` | `404` JSON, `requestId d0f75cd5-…` | 45.8 ms | 74 bytes |
| `POST` with the staging token, no body | `401` JSON `{"message":"User does not have access to environment 6b5f27a3-…","requestId":"3208cdc0-…"}` | 50.9 ms | 142 bytes |
| `POST` with the development token, no body | `401` JSON, same sentence for `87489af5-…`, `requestId 326c1c01-…` | 174.6 ms | 142 bytes |

Every answer is clean JSON in under 200 ms, `server: cloudflare`,
`via: 1.1 google`, `cf-cache-status: DYNAMIC`, `cf-ray: …-PDX`. Two things
follow. First, the 401 sentence is not a staging authorization fault — the
development token, whose environment accepts every release, is told exactly the
same thing on this request shape, so a body-less `POST` is simply not the upload
handshake and we do not read anything into it. Second, the refusal only appears
when a real archive is put behind the call, so whatever times out is on the
payload path, not the auth path — and that is where we would like the server-side
log for the 15:38Z, 15:46Z, 15:49Z and 15:53Z attempts.

**What is left standing.** With the CLI pin, the archive shape, the checkout, the
secret's validity, in-flight concurrency and now the connected git source all
falsified from inside CI, the only discriminator this pack still has is the
**credential path**: a per-environment project token from a runner refuses, while
the same project's own CLI login session from a workstation passes initiate on the
same instances within minutes (rows `a6cd8fd3…` `SUCCESS` 16:12:12Z and
`162c1d04…` `SUCCESS` 15:18:18.823Z, both staging, both with `source.repo`
connected). We are testing that now by minting a fresh, staging-scoped project
token and repeating the identical serial probe with it, which separates "this
token" from "project tokens as a class". **It landed, and the split was wrong
twice over**: episode 13 — a token minted at 21:13:48Z — refused 27-for-27, so
"this token" is not the discriminator either, and the CI-arm reproduction below
then accepted a single-shot upload from the *same* credential seven minutes
after its own 27 refusals — the fault is a time window on the upload-initiate
path, not a property of any credential ([Resolution](#resolution--2026-11-18-2154z-the-fault-is-time-windowed-and-staging-no-longer-depends-on-it)).

## The CI arm reproduced cleanly on a fresh commit, 2026-11-18 18:10-18:29Z — and two more of our own explanations died with it

This is the run we have been waiting for since the fault began. Release run `44359708940` (`main`
`5ec5870ce8c9234609829a730a4c442594a6481e`) is the **first** run in this whole episode whose gate returned
`proceed` rather than being cancelled or `superseded`-no-op'd by the merge train, so its staging legs
opened for the first time in roughly two days — and all three refused, 9 attempts out of 9, without
creating a single deployment row.

| leg | outcome | window |
| --- | --- | --- |
| `release gate` | **success** (verdict `proceed`) | 17:34:15 → 18:09Z |
| `migrate staging database` | **success** (`supabase db push` applied) | 18:09 → 18:10Z |
| `deploy Development (frontend-admin)` | **success** | 18:09:26 → 18:11:03 |
| `deploy Development (backend)` | **success** | 18:09:26 → 18:12:38 |
| `deploy Development (frontend-web)` | **success** | 18:09:27 → 18:13:05 |
| `deploy Staging (frontend-web)` | **failure** — 9/9 refusals | 18:10:06 → 18:28:51 |
| `deploy Staging (backend)` | **failure** — 9/9 refusals | 18:10:06 → 18:29:02 |
| `deploy Staging (frontend-admin)` | **failure** — 9/9 refusals | 18:10:06 → 18:29:35 |
| `smoke Staging` / production trio | skipped (by design: no upload, no smoke) | 18:29:36 |

Every one of the 27 staging attempts printed the same four lines and nothing else:

```
Failed to fetch: error decoding response body

Caused by:
    0: error decoding response body
    1: expected value at line 1 column 1
```

with no `Indexing...`, no `Uploading...`, and — checked independently through the API, not just from the
logs — **no deployment row created**: at 18:12Z, mid-ladder, all three staging instances still reported
their 17:16-17:18Z rows. The retry ladder itself behaved exactly as designed (the `frontend-web` leg slept
68/121/169/131/129/153/173/150 s, ≈ 18.5 min end to end), which retires the idea that our budget is too
short: it covered more than the 883 s continuous-fault window measured in episode 11, and all 27 attempts
still refused.

**Three things this run settles, and the first two are our own hypotheses losing.**

1. **Archive size does not discriminate inside CI.** The `backend` leg ran
   `railway up backend --path-as-root … --detach --verbose --message 5ec5870ce…`, i.e. the ~7.5 MB
   directory archive that this report's size-boundary row records as *accepted* from a laptop, and it was
   refused 9/9 in the same minutes that the 133 MB frontend archives were refused. So within the CI arm
   small and large behave identically; the 7,511,269 B / 133,527,512 B boundary is a property of *our
   laptop's uplink* (524 from Cloudflare), not of Railway's upload-initiate.
2. **`--verbose` produces no extra detail on this arm.** We added it in #1074 expecting the request URL,
   the `bytes:` count and the origin status code. In CI it printed none of those — the step output jumps
   straight from `=== deploying backend to staging (5ec5870ce…) ===` / `stamped backend/BUILD_COMMIT` to
   `Failed to fetch: error decoding response body`. The `status code 524` we can surface is the *laptop*
   failure; the CI refusal gives the CLI nothing to print, which is itself evidence that no HTTP response
   with a status ever reached the client. We therefore still cannot hand you a status code for the arm
   that matters, and no flag on our side will change that — it needs a server-side lookup.
3. **Nothing else moved.** Same runner image as the three successful development legs minutes earlier,
   same pinned `@railway/cli@5.40.1`, same script, same commit, same project; the only differences remain
   the environment (`staging`) and the environment-scoped token.

**Positive control repeated on the same commit, 18:31-18:34Z, this time with an explicit sha.** Fifteen
minutes after CI gave up on `5ec5870ce`, the same three staging services were deployed to that exact
commit through the dashboard lane —
`serviceInstanceDeploy(serviceId:$s, environmentId:$e, commitSha:"5ec5870ce…")` → `true` ×3, rows
`b6a58148` (18:33:12), `5b5b847f` (18:33:39), `52d7f9e6` (18:34:07), each **SUCCESS with a `snapshotId`**
(`b3e271cf` / `f1080258` / `82807a5e`), each with `meta.commitHash = 5ec5870ce…`, `meta.branch = main`,
`meta.reason = deploy`. Serving was confirmed from outside:
`https://backend-staging-new.up.railway.app/api/v1/public/build` →
`{"commit":"5ec5870ce8c9234609829a730a4c442594a6481e","source":"env","started_at":"2026-11-18T18:33:44Z"}`,
and both frontend hosts returned 200 (`/` and `/admin/login`). Staging is therefore **not** behind main
because of our pipeline — it is behind only in the sense that it can no longer be reached by upload.

The distinction we need from you has narrowed to one thing: `POST /up`-equivalent initiate, called with a
**project token scoped to the staging environment**, refuses before producing a row; every other way of
starting a deployment of that same commit to those same instances — user-session upload, repo-lane
`serviceInstanceDeploy`, with or without a pinned `commitSha` — succeeds.



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
`supabase db push` succeeded; that leg is a Supabase call, per above, so it is
the uploads doing the work. The comparator is now down to seconds — development
`backend` created deployment `c68da956` at 13:28:34.784Z, and staging `backend`
was refused 49 s later at 13:29:24.172Z, same commit, same runner, same CLI build,
same project, same service ID.

Episode 6 is run `44108272486`, the push of `c5d92c464` — five files:
`scripts/ci/release-gates.py` and its harness, i.e. the gate that decides
whether to deploy at all, a comment-only hunk in `.github/workflows/ci.yml`, and
two docs files. Nothing in the deploy path changed: it does not touch
`scripts/ci/railway-deploy.sh` or the `railway up` call. The gate ran that new
code, returned `proceed` after 41m46s, and the upload path then behaved exactly
as in the five earlier episodes: nine refusals on each staging leg, 27 calls
across 1,170 s (15:37:37.183-15:57:07.561Z), each leg's first refusal 727, 448
or 573 ms after its own deploy marker, and zero `Indexing...` and zero
`Uploading...` lines in all three legs. Development in the same run produced
`SUCCESS` rows at 15:36:37.443Z (`b6a4949f`), 15:36:41.228Z (`9107e0c5`) and
15:36:43.953Z (`069837f2`). The tightest same-basis pair is development
`backend`'s row against staging `backend`'s first refusal, 54.2 s apart, which
does *not* beat episode 5's 49 s
— so we record episode 6 as a sixth repetition, not as a tighter differential.
Production was again never attempted: `smoke Staging`, `migrate production
database`, `deploy Production` and `smoke Production` all skipped.

Episode 7 is run `44285855063`, a push to `main` at
`a09d99f321bfdb5b5bef9995ebfe50d721fba957` — ten files, all of them
`backend/**`, `contracts/openapi.yaml` and one ADR. It adds two things the
record did not already have.

First, **content independence measured rather than argued.** `frontend-admin`
was refused nine times out of nine (job `134758402040`, first refusal
11:07:52.678Z, last 11:26:56.071Z) although `git show --name-only` on that very
commit returns **zero `frontend-admin/` paths**, and the diff against the
immediately preceding `main` (`f6f762aca`) is likewise empty for that directory:
between the release before it and this one the admin service's upload payload
did not change at all, yet its staging leg failed where nothing else about it
did either. We state the limit of that rather than lean on it — five
`frontend-admin/` files have changed since staging last accepted an upload
(anchor `f90b3ef30`, 2026-11-16), so this episode does not show the payload was
never touched. What it does show is that a service this release never modified
fails 27-of-27 exactly like the two services it did, which leaves no version of
"the changed app breaks staging uploads" standing.

Second, **the comparator is down to 29.3 s.** The gate (`134738569937`) cleared
in 36m25s (10:30:12→11:06:37Z) and returned `proceed`. The three development
legs then took `railway up` from `Uploading...` to a returned deployment ID at
11:06:55.021Z (`d1348626`, frontend-admin), 11:06:55.744Z (`e7a77f9a`, backend)
and 11:07:04.482Z (`018be5b2`, frontend-web), and all three `smoke Development`
legs passed. The same run's staging legs, started at 11:07:20Z, then died
nine-for-nine with `Failed to fetch: error decoding response body` / `expected
value at line 1 column 1` across 27 calls and 1,165 s (11:07:30.849 —
11:26:56.071Z), with **zero `Indexing...` and zero `Uploading...` lines in all
three legs** — counted, not recalled. Same service, same runner, same CLI build,
same project, same service ID:

| service | development `Uploading...` accepted | staging first refusal | apart |
|---|---|---|---|
| frontend-web | 11:07:04.482Z (`018be5b2`) | 11:07:33.755Z | **29.3 s** |
| backend | 11:06:55.744Z (`e7a77f9a`) | 11:07:30.849Z | 35.1 s |
| frontend-admin | 11:06:55.021Z (`d1348626`) | 11:07:52.678Z | 57.7 s |

The frontend-web pair beats episode 5's 49 s and episode 6's 54.2 s, and it is
the right basis: one accepted upload-initiate round trip and one refused one for
the *same service*, inside one minute of each other. The run's
`migrate staging database / supabase db push (staging)` (`134758048845`)
succeeded at 11:07:16Z, which — read as episode 6 corrected it — proves the
staging Postgres is reachable and at head, and says nothing about Railway.
Production was again never attempted: `smoke Staging`, `migrate production
database`, `deploy Production` and `smoke Production` all skipped.

Episode 8 is run `44296221501`, the release of the very next `main` tip,
`98bb394d0d` — the merge of the cashtag client parity (PR #1064: the BFF
resolver, two screens' cashtag hunks and the mobile cashtag tests; no
`backend/` and no `frontend-admin/` file in it either). Its gate
(`134773823212`) cleared in 36m37s (11:36:28→12:13:05Z), development deployed
and smoked fine — `Uploading...` accepted at 12:13:26.676Z (`b782c660`,
frontend-admin), 12:13:27.214Z (`433552ad`, backend) and 12:13:37.288Z
(`d15f8720`, frontend-web) — and then the three staging legs, started at
12:14:03Z, refused nine-for-nine across 27 calls and 1,183 s
(12:14:15.378-12:33:57.938Z) with the same decode error and **zero
`Indexing...` and zero `Uploading...` lines in all three legs, counted**. The
same-service pairs are 48.7 s (frontend-admin), 51.1 s (backend) and 49.5 s
(frontend-web) — right at episode 5's 49 s, not tighter, so episode 7's 29.3 s
stands as the tightest on the record. This run adds one more sampling fact:
between episode 7's refused tip and this one, the cashtag stack had merged onto
`main`, `frontend-web` changed, and `frontend-admin` again changed nothing and
again failed 27-of-27 with the same transport refusal — the fault has now
outlasted two different tips in one day, and every staging `latestDeployment`
row is still dated 2026-11-16. Production was never attempted: `smoke Staging`
(`134804645166`) and `smoke Production` (`134804648020`) skipped.

Episode 9 is run `44323824351`, the release of tip `6057b0d3c` — the menu
visibility change (one migration re-slotted above the registry schema, the
services-grid/module-keys gating and its three unit-test files, a new
non-required CI job, two docs files; no `backend/` and no `frontend-admin/`
file in it). Its
gate (`134869605743`) cleared in 30m51s (14:24:04→14:54:55Z) and returned
`proceed`. Development deployed and smoked fine — `Uploading...` accepted at
14:55:14.514Z (frontend-web), 14:55:17.727Z (frontend-admin) and 14:55:22.210Z
(backend), all three `smoke Development` legs passed — and the run's
`migrate staging database / supabase db push (staging)` (`134889897933`)
connected at 14:55:21Z, logged `Applying migration
20271600000000_mobile_menu_modules.sql...` at 14:55:25Z and finished at
14:55:27Z — a Supabase call, per episode 4, but this time it moved data: the
live staging payload behind `/api/v1/modules/visibility` went from 34 keys
(last pre-migration read 14:41Z) to 38 keys (read 14:58Z, re-measured 15:09Z),
which is what
that migration exists to do. The three staging legs, started at 14:55:33Z,
then refused nine-for-nine across 27 calls — backend 14:55:48.000-15:15:07.888Z
(1,160 s), frontend-web 14:55:47.777-15:14:41.980Z (1,134 s), frontend-admin
14:55:47.837-15:15:48.364Z (1,201 s) — with the same decode error and **zero
`Indexing...` and zero `Uploading...` lines in all three legs, counted**. Same
service, same runner, same CLI build, same project, same service ID:

| service | development `Uploading...` accepted | staging first refusal | apart |
|---|---|---|---|
| backend | 14:55:22.210Z | 14:55:48.000Z | **25.8 s** |
| frontend-admin | 14:55:17.727Z | 14:55:47.837Z | 30.1 s |
| frontend-web | 14:55:14.514Z | 14:55:47.777Z | 33.3 s |

backend's 25.8 s beats episode 7's 29.3 s and is the tightest pair on the
record. Production was again never attempted: `smoke Staging`,
`migrate production database`, `deploy Production` and `smoke Production` all
skipped at 15:15:50Z.

Episode 9 adds one fact the eight earlier episodes could not: **in the same
minutes, staging's upload-initiate answered normally for uploads that came from
outside CI.** Local deploys created staging-scoped rows at 14:23:32-35Z
(`f2A-/f2B-058101df…`, the recovery-probe branch), 15:00:33Z (backend
`e907664a`, **SUCCESS**, labeled `diag-verbose-1`) and 15:07:09-15:08:19Z
(three rows from a local refresh automation, all failing later at build with
`Failed to create code snapshot` — a packaging fault on the submitting machine,
not the transport refusal), and at 15:18:18Z backend `162c1d04` was **BUILDING**
from tip `6057b0d3c` itself (it has since concluded **SUCCESS** — staging
backend now runs the released tip, deployed locally). Same environment, same
services, same CLI —
accepted locally while CI was refused 27 of 27 inside one window, which moves
the suspicion from "the staging environment is rejecting uploads" to "the
refusal tracks the caller's path". The staging `latestDeployment` records at
15:07-15:20Z are all local rows, none from CI; frontend-web's newest SUCCESS
remains `d5825eff` (2026-11-16 16:11:27Z) and frontend-admin's `e4670d96`
(2026-11-16 15:56:15Z) — dark 46 h 56 m and 47 h 24 m at those anchors — while
backend's newest SUCCESS in that window was the local `e907664a` at 15:00:33Z,
ending a 45 h 54 m dark span that CI never got to end.

One attribution trap worth recording, because the pack's own method relies on
timing: `Service.deployments(first: N)` is **not** environment-scoped — its
14:55:14-22Z rows (cliMessage `6057b0d3c…`, SUCCESS, imageDigest present) are
this run's own *development* deployments, created 0.1-0.2 s after each
development leg's `Uploading...` line, and reading them as staging successes
would invert the story. Staging-scoped reads need
`serviceInstance(serviceId, environmentId){ latestDeployment }` or
`deployments(input: {environmentId, serviceId})` — introspection says
`DeploymentListInput` takes environmentId/serviceId/projectId/status and no
page-size field, so that call returns the full history. Finally, this
afternoon also re-probed episode 8's own run (`gh run rerun --failed`, attempt
2, legs 13:40:29-14:00:18Z): all three staging legs refused 9/9 again, zero
`Indexing`/`Uploading` lines — one run has now refused 54 staging calls across
two attempts in a single day.

## Reproduction

Push any commit to `paymax2022/spotlight-latest1:main` and watch
`Release (main → development, staging, production)` → `deploy Staging (*)`. The
fault is intermittent, so this may need several attempts, and a docs-only merge
produces no attempt at all: run `44111967023` cleared its gate in 5m30s and
skipped every deploy leg because no service changed, so a sample needs a commit
that changes a service. Thirteen episodes are on the record: 16:23:32-16:38:15Z on
2026-11-16, in which CI's staging calls were refused throughout (though a probe
job was accepted twice inside that span, at
16:34:47 and 16:34:50Z); 23:18:25-23:38:48Z the same day, in which all 27 were
refused; and 07:36:04-08:16:24Z on 2026-11-17 — a 40-minute window spanning two
runs back to back — in which all 54 were refused: nine calls per staging leg per
run, every one the same decode error, zero `Indexing...` lines, while the second
run's three development legs uploaded fine and passed their smokes in the same
minutes; and 12:26:06-12:45:56Z the same day, in which one push-triggered release
was refused 27 times out of 27 while its own three development uploads succeeded
16 minutes earlier and its own `migrate staging database / supabase db push
(staging)` job succeeded against the staging database on Supabase's own
credentials, which is not a Railway call; and 12:50:22-13:48:17Z the same day —
3,474 s spanning two back-to-back dispatches of that identical commit — in
which all 54 staging calls were refused, nine per leg
per run, every one the same decode error with zero `Indexing...` and zero
`Uploading...` lines, while both runs' own development legs uploaded fine and
passed their smokes; and 15:37:37-15:57:08Z the same day, in which a sixth
release — the one carrying our gate hardening — was refused 27 times out of 27
while its own three development uploads built `SUCCESS` rows 54-60 s earlier;
and 11:07:30-11:26:56Z on 2026-11-18, in which a seventh release — a
backend-only feature commit — was refused 27 times out of 27 while its own
development legs returned deployment IDs 29.3-57.7 s before the same service was
refused, and in which `frontend-admin`, a service that commit never touched,
failed all nine of its calls exactly the same way; and 12:14:15-12:33:58Z the
same day, in which the eighth release — the next tip, which touched
`frontend-web` and not `frontend-admin` — was refused 27 times out of 27 while
its own development legs returned deployment IDs 48.7-51.1 s before the same
service was refused; and 14:55:47-15:15:48Z the same day, in which the ninth
release — the menu-visibility tip — was refused 27 times out of 27 while its
own development legs returned deployment IDs 25.8-33.3 s before the same
service was refused, its own `migrate staging database` leg applied a real
migration, and uploads to the same staging services from outside CI were
accepted inside the window (one backend SUCCESS at 15:00:33Z, and — read
together with episode 11 below — the rest of that afternoon's local attempts
dying on a 524 against `backboard`, not on the submitting machine); and
14:56:37-14:57:59Z the same day, in which the tenth episode — Release's staging
matrix copied onto a branch with `max-parallel: 1`, so its three uploads could
not overlap — was refused 4 times out of 4 (`Indexing lines: 0`); and
15:27:31-15:53:34Z, in which the eleventh episode — a laptop retry driver, one
upload at a time — landed a 7,511,269-byte backend archive at 15:18:18.823Z
(`162c1d04`, `SUCCESS`, staging's backend now on main's tip) and timed out on six
133,527,512-byte repo-root frontend archives with
`Failed to upload code with status code 524`. **Those six are not F2**: the
uploading machine measures 11.217 Mbps uplink, so 133 MB is ~95 s of transfer
against a ~100 s proxy ceiling, and each produced a `FAILED` row (the two we
queried carry `snapshotId: null`) — a mid-transfer death, not the pre-row refusal this ledger
otherwise records. They stay listed because the withdrawal is itself the finding
someone reading their own 524 needs. And 16:40:10-16:45:23Z the twelfth episode — the same matrix on a branch,
serial, two attempts each, with `frontend-admin`'s staging git source
disconnected as the A/B against the two instances that kept theirs — refused 6
times out of 6, the disconnected instance indistinguishable from the connected
ones (`134961865736` / `134961866303` / `134961866826`), which is how
`ServiceSource.repo` left the list of suspects; and 21:27:25-21:47:07Z the
thirteenth episode — the staging `RAILWAY_TOKEN` replaced minutes earlier, at
21:13:48Z, to test the one variable every episode had left uncontrolled — was
refused 27 times out of 27, the first refusal 0.84 s after its step group
opened, so a brand-new credential behaves identically to the old one. At
21:54:16Z, seven minutes after that run closed, the same token, runner and CLI
build accepted a single-shot staging upload, and a `serviceInstanceDeploy`
mutation in the same minute built and served main's tip from the connected
repo — the window's other edge, recorded in [Resolution](#resolution--2026-11-18-2154z-the-fault-is-time-windowed-and-staging-no-longer-depends-on-it).
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
`SUCCESS` rows named above. Re-measured a seventh time at 17:33:16Z, ninety
minutes on and with no further release attempted since the docs-only run
`44111967023`: the same three 2026-11-16 rows are still `latestDeployment` for
all three services, so on backend's 17:06:29.046Z anchor staging has been dark
for 24 h 27 min. Re-measured an eighth time at 2026-11-18 11:49:55Z, after all
27 of episode 7's refusals and with no other staging attempt in between: the
same three 2026-11-16 rows are still `latestDeployment` for all three services,
so on backend's 17:06:29.046Z anchor the environment has now been dark for
**42 h 43 min** across seven episodes. Re-measured a ninth time at 2026-11-18
12:36:59Z, after all 27 of episode 8's refusals: the same three 2026-11-16 rows
are still `latestDeployment` for all three services, so the environment has now
been dark for **43 h 30 min** across eight episodes — and since a successful
upload would have created a newer row, those unchanged timestamps are themselves
the proof that staging has accepted nothing at all in that span. Re-measured a
tenth time at 15:07-15:33Z on 2026-11-18, after all 27 of episode 9's refusals:
the staging-scoped `latestDeployment` records are now backend `162c1d04`
(tip `6057b0d3c`, created by a local deploy at 15:18:18Z — `BUILDING` when
probed 15:20Z, **SUCCESS** by 15:33Z), frontend-web `76e58284` (FAILED, local,
15:07:44Z) and frontend-admin `c674cd77` (FAILED, local, 15:20:27Z) — none of
them created by CI. frontend-web's newest SUCCESS remains `d5825eff`
(2026-11-16 16:11:27Z) and frontend-admin's `e4670d96` (2026-11-16 15:56:15Z),
so those two services were dark 46 h 56 m and 47 h 24 m at those anchors;
backend's newest SUCCESS is the local `162c1d04` (before it `e907664a` at
15:00:33Z — the first staging row since 2026-11-16, closing a 45 h 54 m dark
span that nine CI episodes never closed). Both staging successes came from
local uploads in CI's refusal window; CI itself created no row. One method note: the
`serviceInstance(serviceId, environmentId){ latestDeployment }` probe still
works for staging, but for the development and production environment IDs it now
returns `latestDeployment: null` for this credential rather than a row — so
episode 7's development evidence is taken from the `Uploading...` and
`Build Logs: …?id=<deployment>` lines in that run's own job logs, not from a
GraphQL read, and `railway api` accepts no `--project` flag (it exits with clap's
`For more information, try '--help'`, which reads like a quoting error and is
not one). All four of 2026-11-17's episodes sit inside a single day
in which the development project token (a different credential from staging's,
per Identifiers), the same CLI and the same three service IDs accepted every
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
and whose staging `db push` is `134154961344`; and episode 7 is run
`44285855063`, a push to `main` at
`a09d99f321bfdb5b5bef9995ebfe50d721fba957`, whose gate is `134738569937`, whose
three staging jobs are `134758402152` / `134758402061` / `134758402040`, whose
development legs are `134758048828` / `134758048709` / `134758048756`, and whose
staging `db push` is `134758048845`; the docs-only run that followed,
`44111967023`, is retained too, as the control showing a no-service change
skips every leg. Episode 8 is run `44296221501`, a push to `main` at
`98bb394d0d65109155cfa0366947f7a929bfca4b`, whose gate is `134773823212`, whose
three staging jobs are `134793654794` / `134793654805` / `134793654687`, whose
development legs are `134793153324` / `134793153321` / `134793153514`, whose
staging `db push` is `134793153712`, and whose skipped `smoke Staging` and
`smoke Production` are `134804645166` and `134804648020`; that run's
`--failed` re-run attempt the same afternoon (episode 9's probe) re-ran staging
jobs `134842442814` / `134842442841` / `134842443078` (13:40:29-14:00:18Z) and
re-concluded `failure` at 14:00:36Z. Episode 9 is run `44323824351`, a push to
`main` at `6057b0d3cedf78db54d9bfe6e46c1031106f5e6b`, whose gate is
`134869605743`, whose three staging jobs are `134890280555` / `134890280564` /
`134890280857`, whose development legs are `134889896799` / `134889896983` /
`134889897024`, whose staging `db push` is `134889897933`, and whose skipped
`smoke Staging`, `migrate production database`, `deploy Production` and
`smoke Production` are `134904132748` / `134904134661` / `134904136046` /
`134904138560`.

## Resolution — 2026-11-18 21:54Z: the fault is time-windowed, and staging no longer depends on it

One more episode and one differential probe close this out on our side. The CI-arm
reproduction (run `44359708940`, 27-for-27, with the size, `--verbose` and
retry-budget theories dying with it) is recorded above, in *The CI arm reproduced
cleanly on a fresh commit*; this section adds the fresh-token episode and the probe
that produced the transport change. Everything in this section was read back out of
the retained job logs, not from a shell transcript, so every number below can be
re-checked with
`gh api repos/paymax2022/spotlight-latest1/actions/jobs/<id>/logs`.

**Episode 13 — run `44401391758`** (`workflow_dispatch` of `release.yml`, tip
`560e4287d`, 21:25:53Z → 21:47:11Z, `failure`). `RAILWAY_TOKEN_STAGING` had been
**replaced minutes earlier, at 21:13:48Z**, to test the one variable every episode
so far left uncontrolled. The answer is no: each staging leg still lost its full
budget — 9 of 9 on `backend` (job `135145845620`), 9 of 9 on `frontend-admin`
(`135145845593`) and 9 of 9 on `frontend-web` (`135145845664`), 27 refusals between
21:27:25Z and 21:47:07Z, the first one **0.84 s** after its step group opened
(21:27:25.734Z → 21:27:26.576Z) — while the same run's three development uploads
were accepted (`135145317315` / `135145317334` / `135145317466`). A brand-new
credential behaves identically to the old one, so **the token is out as a variable.**

**The probe — run `44406178859`** (`.github/workflows/f2-probe.yml`, branch
`ci/f2-trigger-deploy-probe` at `729a3c1a3`, dispatch input
`sha=560e4287dd25db5d21a999de4172ca5b6156607f`, single job `135161899727`,
21:54:01Z → 22:03:43Z, `success`). One job, **one credential file held constant**,
three arms, run seven minutes after episode 13 closed:

| arm | what it asked | what came back |
|---|---|---|
| B — upload, no ladder | `railway up backend --path-as-root --no-gitignore --service backend --environment staging --detach --verbose --message f2-probe-armB` | **accepted**: `Indexing...`, `bytes: 7513454`, `Uploading...`, row `2d26552d-c5a2-43a4-9746-6bcae9142473`, `arm_B_upload_exit=0` at 21:54:16Z |
| C — trigger | `railway api 'mutation($s,$e,$sha){ serviceInstanceDeploy(serviceId:$s, environmentId:$e, commitSha:$sha) }'` with the *same* service id and the *same* staging environment id | `{ "data": { "serviceInstanceDeploy": true } }` at 21:54:17Z |
| C — outcome | `deployment list --service backend --environment staging --json`, then the host's own build endpoint | newest row `9f0d3f7c`: `status=SUCCESS`, `meta.commitHash=560e4287dd…`, `meta.branch=main`, `meta.cliMessage=null`, `meta.reason=deploy`; arm B's row `2d26552d` had become `REMOVED`; `https://backend-staging-new.up.railway.app/api/v1/public/build` → `{"commit":"560e4287dd25db5d21a999de4172ca5b6156607f","source":"env","started_at":"2026-11-18T21:54:39Z","uptime_seconds":540}` |

Read the probe honestly, in the order it actually discriminates:

1. **F2 is a window, not a ban on the staging target.** The identical token, runner,
   CLI build, service, environment and command shape that refused 27 consecutive
   times from 21:27:25Z to 21:47:07Z accepted a single-shot upload at 21:54:16Z. Any
   sentence in this file that can be read as "staging uploads never work from CI" is
   wrong; "intermittently" in *The ask* is the operative word, and the observed
   windows run to at least nineteen minutes.
2. **`serviceInstanceDeploy` works from a GitHub runner with the project token.**
   Until this run the mutation had only ever been exercised with a user session. It
   returned `true`, Railway built the connected commit 13 s later, and the instance
   was serving it. That is the transport question this repo needed answered, and it
   is answered yes.
3. **The served-commit read alone does not prove which arm did it** — arm B and arm C
   both targeted `560e4287d`. The discriminating evidence is the row census: the
   active row is the one whose `meta` carries `commitHash` and `branch` with
   `cliMessage: null` — the git-source signature, not an upload row — and arm B's
   upload row is the one that got superseded into `REMOVED`.

**What we changed.** `release.yml`'s three staging legs no longer upload. They call
`scripts/ci/railway-trigger-deploy.sh`, which snapshots the deployment ids *before*
mutating, pins `commitSha` to the sha the gate approved (never `latestCommit` — a
merge train would otherwise deploy a commit CI did not test), waits for a **new** row
whose `meta.commitHash` starts with that sha, and then compares the sha the backend
actually serves. `backend/internal/platform/buildinfo/buildinfo.go` reads
`BUILD_COMMIT` / `RAILWAY_GIT_COMMIT_SHA` / `SOURCE_COMMIT`, so a git build reports its
own commit with `source:"env"` and needs no stamping. Development and production keep
`railway up`: they have never refused, and their `rootDirectory` is `None`, so a
repo-root git build there would run the root `Dockerfile` — which is the Go backend —
into the two frontend services. See `docs/devops/deployment-matrix.md`.

**Two things the CLI's own JSON taught us**, worth stating because both failed
silently on the first draft and either one looks exactly like a deploy that never
happened:

- `railway deployment list --json` returns **only** `createdAt`, `id`, `meta` and
  `status` (measured 22:06:55Z against staging's backend, 5 rows). There is no
  `gmtCreate` and no `snapshotId` in the CLI envelope, although the GraphQL layer
  exposes both — so a poll that filters rows by `gmtCreate` matches nothing forever.
  The probe's own poll had this bug: it printed no row for the whole nine minutes
  while the row it was hunting reached `SUCCESS` in about ninety seconds.
- A git-connected row carries `meta.cliMessage: null` and puts the commit in
  `meta.commitHash`. The selector written for the upload lane
  (`select(.meta.cliMessage == $msg)`) therefore times out on a trigger row even when
  the trigger succeeded. Both selectors are now pinned by
  `scripts/ci/test-railway-trigger-deploy.sh` against a stub that returns the observed
  field set, and the test has been mutation-proven in three places.

**What is still open for Railway.** *The ask* is unchanged and the probe sharpens it:
`--verbose` does not surface the status, and the refusal now has a documented
on/off timescale — 27-for-27 inside 21:27:25Z–21:47:07Z, accepted at 21:54:16Z,
against `environmentId = 6b5f27a3-a290-4574-a977-363eb21d43ad`. The `ServiceSource`
hypothesis in *The one variable that fits* is **dead**: episode 12 disconnected
`frontend-admin`'s staging git source (job `134961866826`, `source.repo` `""` re-read
before and after) and it refused indistinguishably from the two instances that kept
theirs, in the same run, minutes apart — so no probe straddling a refusal window is
needed for that variable. What remains of *The ask* is narrower and entirely
server-side: the HTTP status and body that staging's upload-initiate returns to a
project-token runner during a refusal window — the CLI prints a decode error with no
URL, no bytes and no status, so only your edge logs can say what status was actually
sent. The mutation path is not offered as a fix to you — it is our workaround, and
this file's title still describes a fault on your side that we can no longer
characterise from ours.

---

## Episode 14 — 2026-11-19 08:31Z: the development arm became a second fault, and the two signatures stayed cleanly apart

Two release runs of `main` ran today, both real attempts (gate verdict
`proceed`, staging `supabase db push` success in both), and both ended
`completed/failure` with **all six deploy legs red**:

| run | started | tip | release gate | dev legs | staging migrate | staging legs |
|---|---|---|---|---|---|---|
| `44482224276` | 07:46:41Z | `138d7a906` | `135417090118` success | `135437246412` / `135437246386` / `135437246677` **all failure** | `135437246903` success | `135437519699` / `135437519804` / `135437519816` **all failure** |
| `44488725106` | 08:34:19Z | `8c8db6bee` | `135449002409` success | `135459329473` / `135459329245` / `135459329446` **all failure** | `135459329612` success | `135459608343` / `135459608026` / `135459608032` **all failure** |

**The development legs fail differently from the staging legs, in the same
run, twelve minutes apart.** Verbatim from the retained job logs
(`gh api repos/paymax2022/spotlight-latest1/actions/jobs/<id>/logs`):

Development, `deploy Development (backend)`, job `135437246412`, first two and
last of nine attempts:

```
2026-11-19T08:31:42.7145184Z Indexing...
2026-11-19T08:31:42.9537368Z Uploading...
2026-11-19T08:31:43.2437091Z Your trial has expired. Please select a plan to continue using Railway.
2026-11-19T08:32:58.4359994Z Indexing...
2026-11-19T08:32:58.6658628Z Uploading...
2026-11-19T08:32:58.9930151Z Your trial has expired. Please select a plan to continue using Railway.
2026-11-19T08:50:17.3962031Z Indexing...
2026-11-19T08:50:17.6275792Z Uploading...
2026-11-19T08:50:18.0704361Z Your trial has expired. Please select a plan to continue using Railway.
```

Measured over all **54** dev attempts (six legs × nine), the refusal lands
**0.120-0.940 s** after `Uploading...` opens — per leg: run 1's `backend`
`135437246412` **0.276-0.443 s**, `frontend-admin` `135437246386`
**0.272-0.303 s**, `frontend-web` `135437246677` **0.322-0.405 s**; run 2's
`backend` `135459329473` **0.120-0.177 s**, `frontend-web` `135459329245`
**0.186-0.201 s**, `frontend-admin` `135459329446` **0.184-0.940 s**. So the CLI
does reach the transfer step — which for this report has always been the
dividing line — and the message is Railway's own plan/billing sentence, printed
clean. Contrast the staging arm of the same runs: no `Indexing...` line, no
`Uploading...` line, and an unparseable body instead of a sentence — the two
arms never even reach the same step.

Staging, `deploy Staging (backend)`, job `135459608343` (run `44488725106`),
first three of its nine attempts, with the command repeated on each retry
warning elided as `…`:

```
2026-11-19T09:16:54.6825441Z Attempting to download 20...
2026-11-19T09:17:00.5324118Z Failed to fetch: error decoding response body
2026-11-19T09:17:00.5327689Z     1: expected value at line 1 column 1
2026-11-19T09:17:00.5383593Z ##[warning]with-retry: attempt 1/9 failed (exit 1); retrying in 84s — railway up backend --path-as-root … --environment staging …
2026-11-19T09:18:24.8818557Z Failed to fetch: error decoding response body
2026-11-19T09:21:00.2026783Z Failed to fetch: error decoding response body
```

`grep -c 'trial has expired'` over that whole staging job returns **0**. Staging
produces zero `Indexing...` lines and zero `Uploading...` lines, exactly as in
every episode since 2026-11-16, so **staging never gets far enough to be told
about the plan** — we cannot say from this evidence whether staging is also
plan-gated, and we do not claim it is.

**Per-line census of all twelve legs today** (counts of literal log lines per job,
so the two arms can be compared without reading any log at all):

| leg | job | `Indexing...` | `Uploading...` | trial lines | decode lines | note |
|---|---|---|---|---|---|---|
| dev `backend` (run 1) | `135437246412` | 9 | 9 | 9 | 0 | |
| dev `frontend-admin` (run 1) | `135437246386` | 9 | 9 | 9 | 0 | |
| dev `frontend-web` (run 1) | `135437246677` | 9 | 9 | 9 | 0 | |
| staging `backend` (run 1) | `135437519699` | 0 | 0 | 0 | 0 | **never reached the CLI** — `actions/checkout` died with `RPC failed; curl 56 GnuTLS recv error (-24)`, `fatal: early EOF`, `fetch-pack: invalid index-pack output`, git exit 128 |
| staging `frontend-web` (run 1) | `135437519804` | 0 | 0 | 0 | 18 | |
| staging `frontend-admin` (run 1) | `135437519816` | 0 | 0 | 0 | 18 | |
| dev `backend` (run 2) | `135459329473` | 9 | 9 | 9 | 0 | |
| dev `frontend-web` (run 2) | `135459329245` | 9 | 9 | 9 | 0 | |
| dev `frontend-admin` (run 2) | `135459329446` | 9 | 9 | 9 | 0 | |
| staging `backend` (run 2) | `135459608343` | 0 | 0 | 0 | 18 | |
| staging `frontend-web` (run 2) | `135459608026` | 0 | 0 | 0 | 18 | |
| staging `frontend-admin` (run 2) | `135459608032` | 0 | 0 | 0 | 18 | |

So today's totals are **54 plan-gated development refusals** (6 legs × 9) and
**90 pre-row staging refusals** (5 legs × 9, 2 log lines each), with one staging
leg excluded because it failed in checkout on the GitHub side — that leg is not
counted as F2 evidence anywhere in this pack, and 18 decode lines per leg is the
"2 lines × 9 attempts" shape, not eighteen attempts.

**Two signatures, not one fault.** A plan gate that refuses *after* the upload
is initiated, on the development token, and a non-JSON response *before* any
row is created, on the staging token, in the same pipeline, one hour apart.
The second one is what this pack is about. The first one is ours.

**Read-only account state, queried 2026-11-19 ~09:50Z** with `railway api`
against the project and workspace (no mutations, no deployment created):

```
project(id: e7dca861-3667-4d9a-8090-6d2f4d179ec2) {
  subscriptionType  -> "trial"
  expiredAt         -> null
  isTempProject     -> false
  workspaceId       -> fdc5d434-58a6-44be-8f67-32d39fc33dc7
}
workspace(workspaceId: fdc5d434-…) { name -> "My Projects", plan -> "HOBBY" }
```

and `serviceInstance(serviceId, environmentId) { isUpdatable latestDeployment {
createdAt status snapshotId } }` for all nine instances:

| environment | backend | frontend-web | frontend-admin |
|---|---|---|---|
| development | `2026-11-18T21:26:41Z` SUCCESS snap=Y | `21:26:38Z` SUCCESS snap=Y | `21:26:41Z` SUCCESS snap=Y |
| staging | `2026-11-18T21:54:16Z` SUCCESS snap=Y | `18:33:39Z` SUCCESS snap=Y | `18:34:07Z` SUCCESS snap=Y |
| production | `2026-11-18T16:37:12Z` SUCCESS snap=Y | `14:35:15Z` FAILED snap=Y | `14:47:15Z` SUCCESS snap=Y |

`isUpdatable` is `false` on all nine. **The census is the part that matters:**
the newest deployment row anywhere in this project is 2026-11-18T21:54:16Z —
arm B of the probe in *Resolution*. Today's six red legs created **no rows**,
and nothing between 21:54Z yesterday and now created a row either. So the
honest summary of 2026-11-19 is *zero deploys to zero environments*, and the
development-side reason for that is a billing state, not F2.

**Three of today's Release runs read green and deployed nothing** — worth
stating in a vendor ticket because the row alone misleads: `44478442712`
(07:17:15Z, `757f0a229`), `44480631166` (07:34:14Z, `62a47a710`) and
`44481476457` (07:40:51Z, `83c7cac73`) are `completed/success` with
`release gate` success and **every** `deploy`, `migrate` and `smoke` job
`completed/skipped` — the merge-train `superseded`/`noop_docs_only` verdict
from `scripts/ci/release-gates.py`. Only the two runs in the table above
actually attempted uploads today.

**What this invalidates, and what it does not.** Every episode in this pack
rests part of its force on "the development legs in the same job succeeded".
That statement is true for every run it is made about (2026-11-16 through
episode 13 at 21:47Z on 2026-11-18, and the 21:54:16Z arm-B accept) and is no
longer true going forward: from 08:31:42Z today the same development path
refuses, for a different reason. Two consequences:

1. The *same-basis* pairing — one runner, one minute, dev accepted, staging
   refused — cannot be re-produced from CI while the plan gate is up, because
   the dev arm no longer returns. Until we clear the billing state, the tight
   intervals quoted in *The differential* and in episodes 7-13 are historical,
   and the reproducible live datum is staging's own 27-for-27 pre-row refusal,
   which is unchanged and still reproducible on demand.
2. We cannot date the billing change more finely than this: the last accepted
   development upload was 2026-11-18T21:26:41Z and the first plan-gated
   refusal was 2026-11-19T08:31:43.243Z, and CI exercised neither path in
   between, so the account state may have changed at any point in that
   window. `Project.expiredAt` is `null` while `subscriptionType` is still
   `"trial"`, which is why we do not present the account fields as proof of a
   timestamp — the proof of the gate is the CLI's own message in the logs.

**One asymmetry we would like your view on.** The plan-gate refusal reaches the
CLI as a legible, actionable sentence, while F2 reaches it as a body the client
cannot parse (`expected value at line 1 column 1`, no URL, no status). Both
come from the same CLI build against the same project within the same hour.
Whatever the staging upload-initiate returns during a refusal window, it is
not the same error path — which is further evidence that the staging refusal
is not a policy response with a nice message and a different transport, but a
malformed one.

**What we did not do, and what we could not find out.** No plan was selected and
no payment was touched; that is an owner action on our side. We did **not**
establish whether the `serviceInstanceDeploy(commitSha:)` workaround of
*Resolution* still works after 08:31Z today: a successful refresh is a write that
would have destroyed today's datum, so the only probe we ran used deliberately
non-existent ids —
`serviceInstanceDeploy(serviceId:"00000000-0000-0000-0000-000000000000",
environmentId:"00000000-…", commitSha:"0…0")` — and it returned
`{"code":"INTERNAL_SERVER_ERROR","message":"Not Authorized",
"path":["serviceInstanceDeploy"]}`. That answer is about id authorization, not
about billing: the resolver rejects a phantom service before any plan check, so
**this probe proves nothing either way** and the mutation path's behaviour behind
the gate stays open. Nothing in this file claims it still works.
`railway whoami` reads logged in; no token was printed, moved, or opened.

## Episode 15 — 2026-11-19 15:19-15:49Z: the plan gate came off, the same-basis pairing came back, and it said the same thing

Episode 14 had to concede that "*the same-basis* pairing — one runner, one minute, dev
accepted, staging refused — cannot be re-produced from CI while the plan gate is up". The
gate is no longer up: the owner added a plan (no agent touched billing;
`Project.subscriptionType` reads `"hobby"` as of 15:45Z). The pairing has now been
re-produced on one commit, and nothing about F2 moved.

**The run.** `44547867538`, head `773fe0285`, gate `### Release gate: **proceed**` at
15:19:02.5Z, `migrate staging database` success.

| leg | started | ended | outcome | `Indexing...` | `Uploading...` | `bytes:` | refused | plan line |
|---|---|---|---|---|---|---|---|---|
| dev frontend-admin | 15:19:16 | 15:20:07 | success | 1 | 1 | `1930791` | 0 | 0 |
| dev frontend-web | 15:19:16 | 15:21:40 | success | 1 | 1 | `103327180` | 0 | 0 |
| dev backend | 15:19:16 | 15:22:45 | success | 1 | 1 | `7516645` | 0 | 0 |
| staging frontend-web | 15:19:57 | 15:38:15 | failure | **0** | **0** | **0** | 9 | 0 |
| staging frontend-admin | 15:19:57 | 15:39:13 | failure | **0** | **0** | **0** | 9 | 0 |
| staging backend | 15:19:57 | 15:39:47 | failure | **0** | **0** | **0** | 9 | 0 |

Mind the arithmetic, because our own census invites a wrong reading of it: each attempt
emits **two** lines containing `error decoding response body` — `Failed to fetch: error
decoding response body` and `    0: error decoding response body`, alongside a third line
`    1: expected value at line 1 column 1` that does *not* match that phrase — so the
"18 decode lines per leg" of episode 14's census is **9 attempts**, the same number of
tries the dev legs show for the plan sentence during the 08:31-14:45 window. Nine per leg
on both sides of the billing change. This is why the tables below count *refusals*, not
matched lines.

**What this run adds that episodes 1-14 could not.** Three dev legs and three staging legs
of one commit ran inside the same two minutes. All three staging refusals land in a 2.03 s
burst — 15:20:10.433, 15:20:12.360, 15:20:12.466 — and in every staging log
**`Indexing...` never prints once**, while the dev legs print `Indexing...` →
`Uploading...` → a byte count and finish. The backend archive reaches `bytes: 7516645` on
dev and never reaches a byte count on staging. So the failing request is not the archive
transfer: it is the call that *obtains the upload destination*, which precedes `Indexing...`.

The same flag, same conclusion. `--verbose` **was on the staging command** (checked in the
invocation, not assumed) and printed no URL, no `bytes:`, no status — because it emits only
once the CLI holds a destination and an archive. Whatever status code is behind this, our
logs cannot surface it by any flag we control; it exists only in your edge/origin log.

**Size is confirmed irrelevant, not newly argued.** *The CI arm reproduced cleanly* section
already retired the episode-11 boundary from inside CI: the ~7.5 MB backend archive was
refused 9/9 in the same minutes as the 133 MB frontend archives, so small and large behave
identically on that arm, and the `7,511,269 B` / `133,527,512 B` split was our laptop's
11.217 Mbps uplink against Cloudflare's ~100 s window. Today adds the other half of the
comparison, which that section could not make: the *dev* frontend-web leg of run
`44547867538` shipped `103,327,180 B` and completed inside the minute the *staging*
frontend-web leg of the same commit refused. And the staging side still has no CLI-reported
size — that section established that `--verbose` prints no URL, `bytes:` or status on the CI
arm, and all three legs here repeat exactly that: the flag is on the invocation, and the
output jumps from `stamped backend/BUILD_COMMIT` (15:20:11.7597533Z) to `Failed to fetch`
(15:20:12.4661144Z) — **0.71 s**, nothing in between.

**The narrowed ask.** For environment `6b5f27a3-a290-4574-a977-363eb21d43ad`, services
`70de07d8-c058-4221-b645-61c4f1ac7aa5` (backend), `dda6372c-0bb7-4014-a2b1-aa646c11a281`
(frontend-web), `c4f1086e-0a2d-4367-b503-209c14a2ce6f` (frontend-admin): the status and
body of the upload-initiate request at **2026-11-19 15:20:10-15:20:13Z**, retried nine
times per service until 15:39:47Z. **Zero deployment rows came of it.** At 15:45Z the
staging instances' latest rows were still `560e4287d` (backend, 2026-11-18T21:54:16Z) and
`5ec5870ce` (both frontends, 2026-11-18T18:33-18:34Z) — yesterday's manual refresh, not
today's CI.

**The asymmetry Episode 14 asked about is now measured, not inferred.** During the plan
gate, the dev legs printed `Your trial has expired. Please select a plan…` nine times each
and the staging legs printed it **zero** times while printing nine decode refusals each. A
staging upload therefore never reaches whatever check emits the plan message: the malformed
response preempts the policy response. That is the strongest evidence in this file that F2
is not "the same refusal on a prettier transport".

**Episode 14's open question, answered for the post-plan state.** We deliberately did not
exercise the pull-based workaround while the gate stood, because a successful refresh would
have destroyed the datum. With billing restored we ran it, and it behaves as it did on
2026-11-18: three `serviceInstanceDeploy(serviceId, environmentId, commitSha:)` calls —
flat args; `input:` is rejected as `Unknown argument` — each returned `true`. Both frontends
were already `SUCCESS` at the first read ~80 s after the calls (rows created 15:46:22 and
15:46:52, `commitHash 773fe0285`); the backend was still `DEPLOYING` at that read and
`SUCCESS` at the next one ~70 s later (row `d07620c7…`, created 15:45:59).
`backend-staging-new` `/api/v1/public/build` then
served `{"commit":"773fe0285…","started_at":"2026-11-19T15:48:54Z"}`. Still untested
*behind* a plan gate, and we will not test it there.

**What it costs us.** 18.3-19.8 min of staging lane per release, production legs `skipped`
because `smoke Staging` gates them, and a staging environment that stays one CI cycle
behind `main` until a human pulls the commit.

**What we changed on our side.** PR #1091 (landed as `c88138353`) teaches `with-retry.sh`
an opt-in `RETRY_NON_RETRYABLE` so an account-state refusal stops at one try instead of
nine. F2's decode error is deliberately **not** in that pattern, and this table is the
reason: a window that closes on its own must be ridden out, so staging keeps its full
900 s ladder on purpose. The guard cannot fire on staging legs anyway — they are never
told why they failed.

## Episode 16 — 2026-11-19 23:09-23:30Z: the pairing re-produced on a commit that changes no application code, and the window reopened

Episode 15 proved the same-basis pairing on `773fe0285`, a commit whose payload was a CI
probe removal. Run `44629671567` proves it again on `d446dfd9e`, whose entire diff is
`docker-compose.yml` (+11 / −3, one file) — local orchestration that Railway never builds.
There is no application delta available to explain a difference in outcome, and the
outcome still differs.

**The run.** Head `d446dfd9e`. `integration-verify` (`44629671413`) went green and the gate
rendered `### Release gate: **proceed**` at 23:09:32.392Z. The run concluded `failure`;
the only failures are the three staging legs, whose last job ended at 23:30:14Z.

| leg | job | started | ended | outcome | `Indexing...` | `Uploading...` | `bytes:` | decode refusals | retry notices | plan sentence |
|---|---|---|---|---|---|---|---|---|---|---|
| dev frontend-admin | `135951837272` | 23:09:42 | 23:10:30 | success | 1 | 1 | `1930743` | 0 | 0 | 0 |
| dev frontend-web | `135951837723` | 23:09:43 | 23:11:17 | success | 1 | 1 | `103321303` | 0 | 0 | 0 |
| dev backend | `135951837290` | 23:09:44 | 23:13:12 | success | 1 | 1 | `7516251` | 0 | 0 | 0 |
| staging backend | `135952256616` | 23:10:50 | 23:29:13 | failure | **0** | **0** | **0** | 9 | 8 | 0 |
| staging frontend-web | `135952256565` | 23:11:08 | 23:29:38 | failure | **0** | **0** | **0** | 9 | 8 | 0 |
| staging frontend-admin | `135952256542` | 23:10:54 | 23:30:13 | failure | **0** | **0** | **0** | 9 | 8 | 0 |

Nine refusals against eight retry notices per staging leg: the notice prints only before a
retry, so 9 is the ladder's full budget — the same count episode 15 settled, and the same
27 staging requests in the run.

**Sub-second refusal, re-measured on episode 15's own rule.** The staging backend stamps
`backend/BUILD_COMMIT` at 23:11:02.9384113Z and its first refusal lands at
23:11:03.6274782Z — **0.689 s**, against 0.71 s in episode 15 and inside the 0.120-0.940 s
band. What is *not* repeated: episode 15's three first refusals fell in a 2.03 s burst,
while here they are 23:11:03.627Z, 23:11:08.421Z and 23:11:22.142Z — an 18.5 s spread,
because the legs started minutes apart. The invariant is the sub-second refusal after a leg
starts, not a burst between legs, and this paragraph exists so nobody reads "burst" into
this window.

**Same archives as episode 15, to the byte class.** `1930743` vs `1930791`, `7516251` vs
`7516645`, `103321303` vs `103327180`. Size stays irrelevant on the CI arm.

**Zero staging rows, three dev rows — read live, all six instances.** Census taken across
23:56Z on 2026-11-19 and 00:00Z on 2026-11-20 with
`serviceInstance(serviceId, environmentId) { isUpdatable latestDeployment { createdAt status meta } }`:
dev's three instances report rows created 23:09:56 (frontend-admin), 23:10:02
(frontend-web) and 23:10:04 (backend), all `SUCCESS`; staging's three still report
`773fe0285` created 15:45:59.288Z (backend), 15:46:22.677Z (frontend-web) and
15:46:52.238Z (frontend-admin) — episode 15's manual refresh, eight hours old, not this
CI run. `isUpdatable` is `false` on all six.

**Billing is no longer even a candidate.** `Project.subscriptionType` reads `hobby` live,
and each staging instance's own deployment meta carries `"plan": "hobby"`, while the
staging legs printed the trial sentence zero times. Episode 14's second fault is closed;
what remains is F2, and F2 behaves as a window: refused 23:10-23:30Z here, accepted at
15:45Z the same afternoon through the pull path.

**Requests to pull from your edge logs, to the millisecond.** Environment
`6b5f27a3-a290-4574-a977-363eb21d43ad`, ref `d446dfd9e`, the request that obtains the
upload destination:

| service | id | first refusal | last refusal |
|---|---|---|---|
| backend | `70de07d8-c058-4221-b645-61c4f1ac7aa5` | 2026-11-19T23:11:03.627Z | 2026-11-19T23:29:12.074Z |
| frontend-web | `dda6372c-0bb7-4014-a2b1-aa646c11a281` | 2026-11-19T23:11:22.142Z | 2026-11-19T23:29:36.185Z |
| frontend-admin | `c4f1086e-0a2d-4367-b503-209c14a2ce6f` | 2026-11-19T23:11:08.421Z | 2026-11-19T23:30:11.890Z |

**The cost chain is identical to episode 15's, and one step of it is easy to miss.**
`migrate staging database / supabase db push (staging)` **succeeded** at 23:10:28 — so
staging's schema is current with `main` while its code is not, which is the worst of the
two states for anyone testing there. `smoke Staging` then came back `skipped` at 23:30:14Z,
and that skip is what left `migrate production database`, `smoke Production` and
`deploy Production` skipped in the same second. `smoke Development` passed on all three
services at 23:13:15-23:13:37.


## Episode 17 — 2026-11-20 17:13-20:39Z: one commit refused twice in one run, 54 staging requests, and what a deployment row actually marks

Episode 12 re-ran a release with `--failed` to test `ServiceSource`. This lap applies the
same technique to the clock: run `44774228871` refused 27 of 27 staging calls in its first
attempt and, after `gh run rerun 44774228871 --failed` re-executed exactly those three
legs three hours later, another 27 of 27 — **54 refused requests from one commit**, the
same total episode 5 reached with two separate dispatches, but here with nothing rebuilt,
nothing re-decided, no credential changed and no argument changed between the two waves.
Its same-basis pairing is also timed from Railway's own deployment rows instead of the leg
logs.

**The run.** Head `9cedaad870791374d02f891c750f4956a1f3bf09` — the PR #1107 squash, 52
files, `frontend-admin/**` plus `docs/ops/**` only, **no `backend/` file in it**. The
checkout in each leg prints `HEAD is now at 9cedaad` and
`/usr/bin/git log -1 --format=%H` returns that sha. `release gate (CI green for this
commit)` (`136419609995`) ended `success` at 17:12:52Z with
`### Release gate: **proceed**`. Both attempts conclude `failure`, and in both the only
failures are the three staging upload legs.

**Attempt 1 — 27 refused, 27.5-30.0 s after the same service's development row.**

| leg | job | started | ended | outcome | `Indexing...` | `Uploading...` | `bytes:` | decode refusals | retry notices | plan sentence |
|---|---|---|---|---|---|---|---|---|---|---|
| dev frontend-admin | `136443674247` | 17:12:55 | 17:14:47 | success | 1 | 1 | `1979720` | 0 | 0 | 0 |
| dev frontend-web | `136443674367` | 17:12:56 | 17:16:00 | success | 1 | 1 | `103327021` | 0 | 0 | 0 |
| dev backend | `136443674034` | 17:12:55 | 17:16:20 | success | 1 | 1 | `7523897` | 0 | 0 | 0 |
| staging backend | `136443975834` | 17:13:27 | 17:31:40 | failure | **0** | **0** | **0** | 9 | 8 | 0 |
| staging frontend-web | `136443975819` | 17:13:27 | 17:31:44 | failure | **0** | **0** | **0** | 9 | 8 | 0 |
| staging frontend-admin | `136443975848` | 17:13:27 | 17:32:25 | failure | **0** | **0** | **0** | 9 | 8 | 0 |

`serviceInstance(...){ latestDeployment{ createdAt } }` gives the development rows as
17:13:09.146Z (backend), 17:13:10.560Z (frontend-admin) and 17:13:11.662Z (frontend-web).
The same service's first staging refusal follows at 17:13:37.826Z, 17:13:38.042Z and
17:13:41.643Z — **28.68 s, 27.48 s and 29.98 s**, all three inside episode 9's
25.8-33.3 s band and below episode 7's minimum pair (29.3 s). Episode 9's 25.8 s stays the
tightest figure in this pack; what differs here is the instrument — these three come from
`latestDeployment.createdAt` read off the API, while episodes 7 and 9 timed from the
deployment-ID line the CLI prints — so the numbers are comparable but not interchangeable.

**Why the two arms overlap, and what a row actually marks.** `deploy-staging` declares
`needs: [gates, migrate-staging]` — **not** `deploy-development` — so the development and
staging lanes of one release run concurrently by design. Their legs started 17:13:27Z while
two of the three development jobs were still running (`frontend-admin` ended 17:14:47Z,
`frontend-web` 17:16:00Z, `backend` 17:16:20Z) and all three `smoke Development` legs
still lay ahead at 17:16:35-17:16:39Z, even though every development archive had already
been accepted by then (`Uploading...` printed 17:13:10.918Z, 17:13:11.806Z and
17:13:21.539Z). Episodes 15 and 16 interleave for the same reason; this paragraph exists
so nobody reads a deliberate A/B into it.

**The instrument, measured.** On those three accepted legs the row's
`latestDeployment.createdAt` (17:13:09.146Z, 17:13:10.560Z, 17:13:11.662Z) lands
**1.25-9.88 s before the CLI prints `Indexing...`** — the deployment row is created at the
initiation, not when the bytes arrive. So "no deployment row" and "no `Indexing...` line"
are the same event read from the two ends of the call, and staging's 54 refusals are absent
from your logs in both senses at once. That is also why the pairing above is quoted to the
initiation: it compares initiation with initiation.

**Sub-second on both attempts, six legs, two runner images.** Measured from the leg's own
`##[group]Run bash scripts/ci/railway-deploy.sh` line to its first refusal:

| leg attempt | service | step group starts | first refusal | latency |
|---|---|---|---|---|
| 1 | backend | 17:13:37.1247892Z | 17:13:37.8262446Z | **0.701 s** |
| 1 | frontend-admin | 17:13:37.4961192Z | 17:13:38.0416578Z | **0.545 s** |
| 1 | frontend-web | 17:13:41.1358438Z | 17:13:41.6425303Z | **0.507 s** |
| 2 | frontend-web | 20:19:04.7794177Z | 20:19:05.5521565Z | **0.773 s** |
| 2 | frontend-admin | 20:19:05.4176398Z | 20:19:06.0916359Z | **0.674 s** |
| 2 | backend | 20:19:14.5868172Z | 20:19:15.0847968Z | **0.498 s** |

All six are inside the 0.120-0.940 s band episode 15 set as the discriminator, and all
six are far under the ~5 s a 7.5 MB archive takes to move. Attempt 1 placed the three
staging legs on runner image `20261111.635`; attempt 2 placed backend and frontend-admin
there and frontend-web on `20261103.629` — six refused legs over two images with one
signature, so the refusal is not an image artifact.

**Attempt 2 — `gh run rerun 44774228871 --failed`, launched 20:18:52Z.** GitHub
re-executed *only* the three failed legs (new job ids) and re-evaluated the downstream as
`skipped` at 20:39:16-17Z; every job that had succeeded kept its attempt-1 row and its
17:1x timing, including `migrate staging database / supabase db push (staging)`
(`136443674430`, success, 17:12:55-17:13:23Z). That is why attempt 2 has **no fresh
development upload in its window** — its positive control is attempt 1's, three hours
earlier in the same run on the same commit — and it is the honest limit of this lap.

| leg | job | started | ended | outcome | `Indexing...` | `Uploading...` | `bytes:` | decode refusals | retry notices | plan sentence |
|---|---|---|---|---|---|---|---|---|---|---|
| staging frontend-web | `136544501180` | 20:18:52 | 20:37:45 | failure | **0** | **0** | **0** | 9 | 8 | 0 |
| staging frontend-admin | `136544501171` | 20:18:52 | 20:37:44 | failure | **0** | **0** | **0** | 9 | 8 | 0 |
| staging backend | `136544501170` | 20:18:53 | 20:39:16 | failure | **0** | **0** | **0** | 9 | 8 | 0 |

The `railway up` argument strings are **identical, character for character, between the
attempts** — `--no-gitignore --service {backend|frontend-web|frontend-admin} --environment
staging --project e7dca861-… --detach --verbose --message 9cedaad870791374d02f891c750f4956a1f3bf09`
(with `backend --path-as-root` leading the backend leg) — as is the CLI they came from
(`npm install --global @railway/cli@5.40.1` in both), the credential
(`RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN_STAGING }}` on the `Deploy …` step,
`release.yml`), and the ladder's own conclusion:
each leg ends `with-retry: '…' still failing after 9 attempts (last exit 1)`. The refusal
block is the one this report was written about, printed inside 280 µs:

```
2026-11-20T20:19:15.0847968Z Failed to fetch: error decoding response body
2026-11-20T20:19:15.0848506Z Caused by:
2026-11-20T20:19:15.0848841Z     0: error decoding response body
2026-11-20T20:19:15.0849292Z     1: expected value at line 1 column 1
```

**Fifty-four staging requests, zero rows — and the row count is the cleanest datum.**
Read live after the second attempt ended, `serviceInstance(serviceId, environmentId)`
across all six instances: development reports rows created 2026-11-20T17:13:09.146Z,
17:13:10.560Z and 17:13:11.662Z, all `SUCCESS`, all this commit; staging still reports
2026-11-19T15:45:59.288Z (backend), 15:46:22.677Z (frontend-web) and 15:46:52.238Z
(frontend-admin), all `SUCCESS` — **episode 15's manual `serviceInstanceDeploy` refresh,
still the newest thing that environment has**. Between that refresh and 20:39:13Z today
the staging upload path created no row from any of 54 CI requests, while the pull path had
created the rows it still shows.

**Size stays irrelevant, and this lap says so with a real delta.** The `frontend-admin`
archive is `1979720` bytes against episode 16's `1930743` and episode 15's `1930791` —
48,977 bytes heavier than episode 16's, on a release that changes 50 files under
`frontend-admin/`. Development accepted those bytes; the staging leg for the same service
died before it ever printed a size, which is the point — nothing about the archive enters
the failure. `backend` moved 7,646 bytes (from `7,516,251`) although no `backend/` file is
in the commit, consistent with `backend/BUILD_COMMIT`, which each leg stamps with the sha
before uploading. `frontend-web` is `103327021`, the same 103 MB class as always.

**Two things we changed on our side, so the record is complete.** Before the rerun we
temporarily added a required-reviewers gate to the GitHub `Production` environment,
because a green staging lane would have released `main` into production as a side effect
of a diagnostic. It never had to act: `migrate production database`,
`deploy Production (${{ matrix.service }})` and `smoke Production` came back `skipped` in
both attempts, and the environment is now restored to its prior policy (one
`branch_policy` rule, no reviewers, `can_admins_bypass: true`). The consequence is the
one this episode exists to explain: PR #1107's operator-visible fixes are live on
development and on `main`, and reach staging or production only through the pull path or
a manual upload — `docs/ops/admin-console-production-errors-2026-11-20.md` records that
as Command 5.

**Requests to pull from your edge logs, to the millisecond.** Environment
`6b5f27a3-a290-4574-a977-363eb21d43ad`, ref `9cedaad870791374d02f891c750f4956a1f3bf09`,
the request that obtains the upload destination, **both attempts**:

| service | id | attempt 1 first / last refusal | attempt 2 first / last refusal |
|---|---|---|---|
| backend | `70de07d8-c058-4221-b645-61c4f1ac7aa5` | 2026-11-20T17:13:37.826Z / 17:31:38.575Z | 2026-11-20T20:19:15.085Z / 20:39:13.398Z |
| frontend-web | `dda6372c-0bb7-4014-a2b1-aa646c11a281` | 2026-11-20T17:13:41.643Z / 17:31:42.926Z | 2026-11-20T20:19:05.552Z / 20:37:43.444Z |
| frontend-admin | `c4f1086e-0a2d-4367-b503-209c14a2ce6f` | 2026-11-20T17:13:38.042Z / 17:32:23.507Z | 2026-11-20T20:19:06.092Z / 20:37:42.770Z |

**How this updates the "time-windowed" reading.** Episodes 13 and 16 made the fault look
like a window that opens and shuts; the phrase is still true of *when* it refuses, but
this lap sharpens what distinguishes accepted from refused. From 17:13:37.826Z to
20:39:13.398Z — **3 h 25 m 36 s**, across two attempts and three services — the CI upload
path to this environment refused 54 of 54. The development lane of the same attempt was
accepted 27.5-30.0 s before the first refusal and its jobs and smokes ran on *inside* that
span (to 17:14:47, 17:16:00, 17:16:20 and 17:16:39Z), so the two outcomes are not even
separated in time. The rows still on `staging` right now were created by
`serviceInstanceDeploy` on 2026-11-19, while episode 9's laptop `railway up` to that very
staging backend was accepted at 15:18:18Z on 2026-11-18. The accepted staging calls in
this pack are the API/pull call and a laptop call; the refused ones are, without a single
exception in 54 tries, `railway up` from a GitHub runner holding
`RAILWAY_TOKEN_STAGING`. That is episode 12's last surviving suspect, and these 54 are the
largest sample of it the pipeline can produce without your logs.

**What it costs us.** 18.2-20.4 minutes of runner time per attempt (attempt 1's legs ran
18 m 13 s, 18 m 17 s and 18 m 58 s; attempt 2's 18 m 52 s, 18 m 53 s and 20 m 23 s), a
`failure` conclusion on a run whose code passed its own development smoke, staging's
schema current with `main` since 17:13:23Z while its three apps are still the
2026-11-19T15:46Z refresh, and a production console that cannot receive the fix this
commit contains without a human upload.

**The retry ladder, leg by leg, so the twenty minutes is auditable.** The waits are not
ours to invent — `scripts/ci/railway-deploy.sh` exports `RETRY_ATTEMPTS=9` and
`RETRY_BASE_DELAY_S=60`, and `scripts/ci/with-retry.sh` doubles the step, caps it at 120 s
and adds a uniform 0–½·delay jitter. That makes the sleep floor 60 + 7 × 120 = **900 s** and
the ceiling 90 + 7 × 180 = **1,350 s**, both numbers already written in that script's own
comments. Below are the eight `retrying in Ns` values each of the six staging legs actually
printed, and every sum lands inside that band:

| attempt | staging leg job | service | the eight sleeps, in order (s) | Σ sleep | leg wall clock | not sleep |
|---|---|---|---|---|---|---|
| 1 | `136443975834` | backend | 89, 156, 123, 128, 141, 145, 141, 153 | 1,076 s | 1,093 s (18 m 13 s) | 17 s |
| 1 | `136443975848` | frontend-admin | 64, 180, 137, 157, 164, 131, 133, 156 | 1,122 s | 1,138 s (18 m 58 s) | 16 s |
| 1 | `136443975819` | frontend-web | 67, 160, 129, 156, 123, 136, 176, 130 | 1,077 s | 1,097 s (18 m 17 s) | 20 s |
| 2 | `136544501170` | backend | 73, 180, 145, 173, 166, 132, 156, 171 | 1,196 s | 1,223 s (20 m 23 s) | 27 s |
| 2 | `136544501171` | frontend-admin | 64, 178, 153, 133, 161, 129, 171, 123 | 1,112 s | 1,132 s (18 m 52 s) | 20 s |
| 2 | `136544501180` | frontend-web | 86, 123, 156, 173, 137, 146, 152, 141 | 1,114 s | 1,133 s (18 m 53 s) | 19 s |

The shape is the designed one: the first wait in every leg is 64–89 s (the 60 s step plus
jitter) and the remaining seven are 123–180 s (the capped 120 s step plus jitter). The last
column is the one that matters for reading these logs — **16 to 27 seconds**, and it is the
whole of a leg that is not sleep, spread over the five steps GitHub lists for the job
(`Set up job`, `actions/checkout@v4`, `actions/setup-node@v7`, `Install Railway CLI`, and the
failing `Deploy <service>` step, which contains the archive build and all nine refused CLI
calls). Nine refusals inside ~20 s of the 1,076–1,196 s a leg spends is the arithmetic form
of the sub-second signature above, and it means the twenty minutes proves nothing about the
payload — it is a timer, not work.

Two consequences for anyone sampling these legs. A status check taken before ~20 minutes is
blind, because the ladder has not reached attempt 9 yet, so only the *first* refusal
timestamp is informative — which is why the pull list above is expressed to the
millisecond. And anyone re-counting attempts from a raw log should grep
`failed (exit 1); retrying in` (**exactly 8 lines in each of these six logs**), because the
notice prints only *before* a retry and the ninth attempt ends instead with
`still failing after 9 attempts (last exit 1)`; a bare `grep -c retry` returns 9 and
double-counts that terminal line.

## Episode 18 — 2026-11-22 13:53-14:56Z: staging left the upload fault behind, and the lane that does it needs an explicit sha

F2 reproduced on the way in. Train `45027694563` (head `df6676406`, the PR #1148 squash)
cleared its gate, deployed all three development services (`SUCCESS` rows at 14:10:58Z,
14:11:02Z and 14:11:04Z), kept `migrate staging database / supabase db push (staging)`
green, and then lost all three staging legs. Those logs were pulled before this paragraph
was written, and each carries the F2 signature and none of the other two:

| leg (job id) | `Failed to fetch: error decoding response body` | retry notices | `GnuTLS recv error` | `trial has expired` | `Indexing` |
|---|---|---|---|---|---|
| `deploy Staging (backend)` `137235706730` | 9 | 8 | 0 | 0 | 0 |
| `deploy Staging (frontend-web)` `137235706713` | 9 | 8 | 0 | 0 | 0 |
| `deploy Staging (frontend-admin)` `137235706716` | 9 | 8 | 0 | 0 | 0 |

`smoke Staging` → `migrate production database` → `deploy Production (…)` → `smoke
Production` were skipped, which is the usual blast radius. Nine attempts per leg, eight
notices, nothing indexed — the request that obtains the upload destination still refuses to
return a decodable body.

**Staging, however, no longer needs the upload path.** At 13:59:00Z, 13:59:05Z and
13:59:25Z the same three staging instances were deployed by GraphQL instead of by upload,
and each reached `SUCCESS` inside four minutes with a `snapshotId`, `meta.branch = "main"`
and `meta.reason = "deploy"` — the git-source signature, no archive anywhere in the request.
The point of this section is the argument that made that work, because the obvious one does
not:

| call, same account, same three instances, minutes apart | result |
|---|---|
| `serviceInstanceDeploy(serviceId, environmentId, latestCommit: true)` — 13:53:24Z / 13:53:39Z / 13:53:54Z | **refused 3/3** — `{"extensions":{"code":"INTERNAL_SERVER_ERROR"},"message":"Not Authorized","path":["serviceInstanceDeploy"]}`, traceIds `7638569940617653028`, `8666048400144838034`, `245729836332584137` |
| `serviceInstanceDeploy(serviceId, environmentId, commitSha: "b557573795e7e13540d1254901ad4bdcd42fe057")` — 13:59:00Z / 13:59:05Z / 13:59:25Z | **accepted 3/3** — `{"data":{"serviceInstanceDeploy":true}}`, rows `faa7ff43`/`032caf24`/`95ed7740` `SUCCESS` by 14:02:44Z |

The bearer is the same in both rows of that table, so the difference is the argument.
`railway whoami` printed `spec.ng@gmail.com`, and that account id (`bbb8bca4…`, matched
against the config's own `user.id`) is also the `creator.id` recorded on the staging rows —
this is not a token-class mix-up. Reads were healthy throughout: `project`, `environments`,
`serviceInstance` and `deployments` all returned data in the same minute the mutation was
refused.

This is a **change on Railway's side, not a myth about the past**. This file's own positive
control (2026-11-18 17:16-17:22Z, above) called `latestCommit: true` on these same staging
services and got `true` three times, with rows that built from `branch: "main"` and reached
`SUCCESS` inside two minutes. Whatever made that call work then makes it `Not Authorized`
now, for the same user, on the same three instances. One caveat stated plainly: the
`02:18:30Z` staging rows that promoted this environment to `f9309845c` earlier today carry
the same git-source signature, and a deployment row does not record which of the two
arguments produced it — so this section does not claim `latestCommit` was used then.

The nearest read that tracks the refusal is `serviceInstance { isUpdatable }`, which is
`false` on `backend` in both staging and production. It is a correlate, not a proven cause:
`isUpdatable` was already `false` on the instance that accepted `commitSha` five minutes
later, so the field cannot be the gate. It is reported because it is the only boolean the
API offers next to the refusal.

**Six staging dispatches reproduce F2 on a read, and that is new.** Six `workflow_dispatch`
runs of `.github/workflows/ops-railway-upload.yml` targeting staging — `45029642480`,
`45029655782`, `45029668211` (13:51Z) and `45030318903`, `45030322482`, `45030326422`
(13:59Z), all at head `df6676406` — die inside thirty seconds at their own step
`Confirm the token resolves the intended environment and service`, before any archive is
built. The step is one command:

```bash
railway status --json > /tmp/railway-status.json
```

and job `137230172408` (run `45029642480`) shows what that command printed back, 0.3 s after
it started (13:51:21.380Z):

```
Failed to fetch: error decoding response body
    0: error decoding response body
```

That is F2's string, verbatim, on an endpoint that has nothing to do with uploads. So two
things held at once, on the same runner, within an hour: `railway api` with the staging
project token **decodes fine** and answers the GraphQL read with `Not Authorized` at HTTP
200 (the probe's own cells, run `45027737590`), while `railway status --json` with that same
token **cannot decode the response at all**. **[Corrected by Episode 19: that is what these
six dispatches did on 2026-11-22, not what a project token always does — at 12:07Z on
2026-11-23 the same pinned CLI with the same staging token decoded the same read into
52,349 bytes, rc=0. So the refusal is time-windowed, and the narrowing below — "at least two
CLI requests, one of which is a plain status read" — holds as a set of requests that CAN
refuse, not as a property of the credential.]** The decode refusal therefore tracks a request
shape, not the upload-initiate call — which narrows the hypothesis in this file's "what is
F2" section from "the request that obtains the upload destination" to "at least two CLI
requests, one of which is a plain status read, and not the raw `railway api` path".

One confound was controlled here rather than assumed. That runner installs
`@railway/cli@5.40.1` (`ops-railway-upload.yml`, step *Install the pinned Railway CLI*), and
this laptop runs 5.71.0, so "the CLI is too old for the response" was a live alternative. It
is not the whole story: `npx @railway/cli@5.40.1 status --json` against this workspace with
the owner's user token exits 0 and writes 213,691 bytes of parseable JSON. The pinned version
decodes this project's status when a *user* credential asks for it. What has never been
measured is the same pinned binary running `railway status --json` on a runner holding the
development project token: if that decodes, the staging response differs by environment and
the variable is Railway's data; if it refuses too, the variable is the credential class, and
the support thread gets a two-line repro — `railway api` decodes a refusal, `railway status`
cannot decode anything.

**Production `frontend-web` had a different fault, and both halves of it are now read.**
Three `ops-railway-upload.yml` dispatches fire inside ten minutes, all three aimed at
production `frontend-web`, and the one that worked is the one running different lane code:

| run | time | branch the workflow ran from | payload sha | where it died |
|---|---|---|---|---|
| `45021408276` | 12:16:17Z | `main` (`1002ec24e`) | `528382b26a…` | step *Resolve the upload shape…* — `UPLOAD_PATH: unbound variable` |
| `45021663624` | 12:19:19Z | `main` (`1002ec24e`) | `1002ec24e…` | step *Upload frontend-web to production* — `scripts/ci/railway-deploy.sh: line 66: RAILWAY_ENV: required: RAILWAY_ENV` |
| `45022257571` | 12:26:10Z | `ops/upload-tooling-split` (`fa3146287`) | `1002ec24e…` | nothing — success |

Neither failure reached the network: each exited within four seconds of its step starting,
so F2 is not in either log and no deployment row was created for them. They are variable
wiring. The job exported `ENVIRONMENT`, while `railway-deploy.sh` demands `RAILWAY_ENV`, and
the inline shape-resolution step echoed `UPLOAD_PATH`/`ROOT_FLAG`/`BUILD_DIR` before
`eval` had set them under `set -u`. PR #1147 — "fix(ops): give the upload lane a harness that
outlives the payload" — fixes exactly those two lines: it adds `RAILWAY_ENV: ${{ inputs.environment
}}` at job level and `${UPLOAD_PATH:-}` / `${ROOT_FLAG:-}` / `${BUILD_DIR:-}` in the echo, and
its comments quote both error strings verbatim, so the lane now names its own failure modes.
Its branch tip `fa3146287` merged fifty-three minutes *after* the successful dispatch (13:19:59Z,
squash `e7b229172`), so the run that worked was executing lane code main did not yet have. The
row it produced is `SUCCESS` at 12:26:33Z with `meta.cliMessage = 1002ec24ec6eab39…` — the
first sha production `frontend-web` has served since `ea71b561` (2026-11-16).

The row underneath it was a separate cause, and Railway names it. The `FAILED` row at
11:00:31Z carries `meta.cliMessage = 2f51561fb0e3f329…` — PR #1068's squash — and its
`diagnosis` is `build_error`: `npm ci` completed, `[builder 5/5] RUN npm run build` exited
1, "Turbopack build failed with 28 errors", each `Module not found: Can't resolve
'@vercel/turbopack-next/internal/font/google/font'`, traced through the Kumbh Sans
`next/font/google` import in `app/layout.js`. Railway's own words: "This build ran Next.js
16.4.0, while the last successful build (`ea71b561`) ran 16.4.3." The repository supplies the
detail the diagnosis could not see: `2f51561fb` pins `"next": "^16.4.0"` in
`frontend-web/package.json` and its lockfile resolves **16.4.0**, while `ce977589e` (#1010,
"bump the npm-minor-patch group", 2026-11-18) — the commit that raises that pin to
`^16.4.6` — is **not** an ancestor of `2f51561fb`. `1002ec24e` is a descendant, resolves
16.4.6, and builds. So the streak was an upload lane carrying pre-#1010 trees, and it ended
for two reasons at once: the lane got a harness that survives the payload, and the payload
moved past the Next bump.

One signature in that history belongs to neither cause. The 2026-11-21T15:58:45Z `FAILED`
row uploaded `bd1b2aa3e` (post-#1010, Next 16.4.6) yet failed with `configErrors: ["Failed
to create code snapshot…"]` and `cliCaller: automation:launchd:webdeploy` — a scheduled job
on somebody's machine, a third failure mode. "Prod web wouldn't build" was never one cause,
and PR #1142 (`528382b26`, "cut staging frontend upload archives from the commit", merged
09:01:45Z) is not the fix either — it changes how the *staging* legs derive an archive, and
the row it did produce is production `frontend-admin` serving `528382b26` from 10:55:27Z.

**State at 14:53Z, read from `latestDeployment` per service, not from HTTP:**

| environment | backend | frontend-web | frontend-admin |
|---|---|---|---|
| development | `df6676406` 14:11:04Z (train) | `df6676406` 14:11:02Z (train) | `df6676406` 14:10:58Z (train) |
| staging | `df6676406` 14:03:00Z (mutation) | `df6676406` 14:03:05Z (mutation) | `df6676406` 14:03:09Z (mutation) |
| production | `e43c64557` 2026-11-21T23:32:45Z | `1002ec24e` 12:26:33Z (ops lane) | `528382b26` 10:55:27Z |

Development and staging therefore match, which they have not done since 2026-11-21. One
honest wrinkle in that row: the staging rows above are *not* the ones this session created.
`commitSha: b55757379…` (main's tip after PR #1150) was promoted at 13:59Z and was serving
staging at 14:02:44Z; at 14:03:00-14:03:09Z another caller replaced all three rows with
`df6676406`, one commit older and differing only by a documentation commit. Nothing was
broken by that — it is the same lane pointed at the previous sha — but it is why the recipe
below says to re-read `latestDeployment` before promoting, and it is the second time this
week a staging row appeared that this session did not create.

**The recipe, as it now works (owner-side, no upload, ~4 min per service):**

```bash
SHA=$(git rev-parse origin/main)
DOC='mutation($s:String!,$e:String!,$sha:String){ serviceInstanceDeploy(serviceId:$s, environmentId:$e, commitSha:$sha) }'
for s in 70de07d8-c058-4221-b645-61c4f1ac7aa5 dda6372c-0bb7-4014-a2b1-aa646c11a281 c4f1086e-0a2d-4367-b503-209c14a2ce6f; do
  railway api "$DOC" --compact --raw-var "s=$s" \
    --raw-var "e=6b5f27a3-a290-4574-a977-363eb21d43ad" --raw-var "sha=$SHA"
done
```

`--raw-var` matters: `--var` tries to parse its value as JSON, and a 40-hex sha that happens
to be all digits would arrive as a number rather than a string. Pin the sha to a commit the
gates approved. `latestCommit` is both refused today and the wrong thing to want on a merge
train: it deploys whatever HEAD happens to be when the call lands, which is exactly how a
staging row ended up one documentation commit behind the one this session promoted.

**The ask, amended.** Add to the support thread: why does `serviceInstanceDeploy` with
`latestCommit: true` return `Not Authorized` (wrapped in `INTERNAL_SERVER_ERROR`, traceIds
above) for a user session that deploys the same three services with `commitSha` five minutes
later, when the identical call succeeded on these same instances on 2026-11-18? The F2
question itself is unchanged: staging's upload-initiate still never returns a body, and this
episode removes only staging's *dependence* on it — and the episode adds one line to that
question, because `railway status --json` with the same staging project token returns a body
the CLI cannot decode in 0.3 s, which is the same failure string on an endpoint with no
upload anywhere in it. **[Episode 19 measures the same command succeeding with the same
token eleven hours later on a runner, so this line is now a window, not a standing property
of the credential — and the transport cells exist to say whether the `Not Authorized` half of
this paragraph was ever a statement about the tokens at all.]**

**What this does not fix.** No code, no secret, no workflow changed here. `release.yml`'s
staging legs still upload with a project token and still die 9/9; production still receives
nothing from a train; and the mutation lane is reachable only from the owner's session
because of the credential-class answer, not because of anything episode 18 discovered.

## Episode 19 — 2026-11-23 12:06-12:07Z: the same pinned CLI decoded the same read with the same staging token, and the credential answer got narrower

PR #1155 put four status cells into `ci-railway-token-class.yml` to ask the
question episode 18 could only assert: does F2 reproduce on `railway status
--json` **with a project token in a runner**? Run `45171097305` (dispatched on
`main` at `d56314415` at 12:06:12Z, job `compare` = `137680533814`,
`@railway/cli@5.40.1` — the version `ops-railway-upload.yml` installs):

| credential | rc | bytes | verdict | link state |
|---|---|---|---|---|
| `anonymous` control | 1 | 0 | `other-failure` | `no-config` |
| `RAILWAY_TOKEN_DEVELOPMENT` | 0 | 43,753 | `decoded` | `no-config` |
| `RAILWAY_TOKEN_STAGING` | 0 | 52,349 | `decoded` | `no-config` |
| `RAILWAY_TOKEN_PRODUCTION` | 0 | 36,979 | `decoded` | `no-config` |

That closes one line of the support question and opens another.

**Closed:** the plain read is not a standing F2 path. Six staging dispatches died
0.3 s into exactly this call on 2026-11-22 (job `137230172408`), and none of them
reproduced here — with the same credential class, the same binary, the same
runner image. So the decode refusal is **time-windowed** rather than a property of
staging's environment payload, which is how episode 17 already described the
upload path. The F2 census in this file is unchanged: staging legs still refuse
`railway up` 9/9 per attempt.

**Opened:** the credential answer. Episode 18's closing paragraph rested on
"the mutation lane is reachable only from the owner's session because of the
credential-class answer". The class answer was built from twelve curl samples in
which `project(id)` and `serviceInstance` were refused identically by all three
project tokens *and* by the token-less control. Tonight's table shows those same
tokens decoding a 43–52 KB status body, so "project tokens cannot read the graph"
was never supported by that data — only "project tokens are not answered by these
two fields on this surface".

Two clients, one document, is what separates them, so this PR adds the second
client rather than a new argument: four `PROBE_TRANSPORT=cli` cells that send the
sampler's own documents through `railway api`, plus
`scripts/ci/f2-transport-verdict.py` to compare the answers per credential. Its
reading table is in `docs/ops/railway-f2-token-probe.md`; the short version is
that refused-on-both keeps the class story alive (now field-scoped), while
refused-on-curl-and-`ok`-on-cli retires it and re-opens the mutation lane for CI.

Measured before writing a word of that, because each one would have silently
produced a false verdict:

- `Authorization: Bearer` **is** the header backboard honours. Same document, same
  endpoint, owner's CLI credential: Bearer returned `project.name =
  spotlight-platform`, while `X-Railway-Token` and no credential at all both
  returned `Not Authorized` at HTTP 200. (Without a curl-like `User-Agent` all
  four variants answer `HTTP 403` with 17 non-JSON bytes — an edge refusal, not a
  token statement. That dead end is worth recording so nobody reads it as scope.)
  So the curl sampler is not a broken instrument for credentials that can use it,
  and the runner's refusals are about the tokens — the open question is only which
  kind of "about".
- `railway api` appends a sentence to the body on non-200 responses, which makes
  the body unparseable and would have classified a refused credential as a
  transport fault; the cli branch now keeps only line 1 and passes
  `--allow-errors`.
- `f2-status-probe.sh` printed the version the workflow *pinned* rather than the
  version it had just measured, in a block whose comment promised the opposite.
  The cell now says `cli=<measured> pin=<requested>` and caveats a mismatch — a
  stub run of the probe against a fake `railway 9.9.9` is part of the offline
  suite, which is how the bug was found at all.

**No deployment, secret, or workflow behaviour changed in this episode.** The
cells are read-only (`PROBE_MODE` is a literal in the YAML, the file has no
`inputs:` block), and the answer they will produce decides whether the next change
belongs in `release.yml` or in a Railway support reply.

## Episode 20 — 2026-11-23 12:36-12:57Z: F2 reproduced on the train that carried the status probe

Run `45171028615` (push-triggered at 12:05:36Z, head `d5631441510aaaa27fa28993b36dfa364fc62fc7`
— PR #1155, the four status cells) is the plainest F2 demonstration in this file,
because its own gate and development arms succeeded minutes before the refusals:
`release gate` green 12:05:39-12:36:00Z, all three `deploy Development (…)` legs
green (12:36:03-12:39:50Z), `migrate staging database` green (12:36:03-12:36:31Z).
Then the three staging legs of the same commit, same runners, same binary, same
credential class:

| leg | job | first → last refusal | span | `Failed to fetch` | decode lines | retry notices | GnuTLS | trial | `Indexing` | `Uploading` |
|---|---|---|---|---|---|---|---|---|---|---|
| `frontend-admin` | `137696986827` | 12:36:45.088 → 12:57:39.990 | 1,254.9 s | 9 | 18 | 8 | 0 | 0 | 0 | 0 |
| `backend` | `137696987689` | 12:36:46.079 → 12:54:44.230 | 1,078.2 s | 9 | 18 | 8 | 0 | 0 | 0 | 0 |
| `frontend-web` | `137696986800` | 12:36:53.212 → 12:55:11.882 | 1,098.7 s | 9 | 18 | 8 | 0 | 0 | 0 | 0 |

Nine attempts per leg, the Episode 17 ladder, and the refusal is still the first
network call: zero `Indexing...`, zero `Uploading...`, zero byte counts. The
ladder spans its designed 900-1,350 s window and the fault is still there at the
end of it, so the window reading from Episode 19 cannot be stretched over a
staging leg either.

`deploy Staging (…)` failing is what skips `smoke Staging` → `migrate production
database` → `deploy Production (…)` → `smoke Production`; all four were `skipped`,
and the run concluded `failure`. **Zero staging deployment rows were created in
that window** — see Episode 21's row diff, which is the cheap live tell.

## Episode 21 — 2026-11-23 13:42-15:17Z: nine legs, twenty-seven refusals, zero rows — and the same commit reaches staging by mutation 27 minutes later

Two more trains of the same hour reproduce the identical signature, so this is no
longer a sample of one. Both are push trains whose gate and development arms and
`migrate staging database` all passed:

| run | head | leg | job | first → last refusal | span | FTF / decode / notices | GnuTLS / trial / Indexing / Uploading |
|---|---|---|---|---|---|---|---|
| `45179479514` | `0329a903a…` | `backend` | `137733900111` | 13:43:10.529 → 14:02:07.234 | 1,136.7 s | 9 / 18 / 8 | 0 / 0 / 0 / 0 |
| `45179479514` | `0329a903a…` | `frontend-web` | `137733899932` | 13:43:15.241 → 14:01:55.559 | 1,120.3 s | 9 / 18 / 8 | 0 / 0 / 0 / 0 |
| `45179479514` | `0329a903a…` | `frontend-admin` | `137733900558` | 13:43:15.800 → 14:01:18.240 | 1,082.4 s | 9 / 18 / 8 | 0 / 0 / 0 / 0 |
| `45194518587` | `09921c258…` | `backend` | `137780874302` | 14:59:13.707 → 15:16:32.647 | 1,038.9 s | 9 / 18 / 8 | 0 / 0 / 0 / 0 |
| `45194518587` | `09921c258…` | `frontend-web` | `137780874224` | 14:59:14.291 → 15:17:01.636 | 1,067.3 s | 9 / 18 / 8 | 0 / 0 / 0 / 0 |
| `45194518587` | `09921c258…` | `frontend-admin` | `137780874613` | 14:59:16.043 → 15:16:46.663 | 1,050.6 s | 9 / 18 / 8 | 0 / 0 / 0 / 0 |

Three trains × three legs × nine attempts = **27 refusals in the 12:36:45-15:17:01Z
band**, and the row history says what that costs. `railway deployment list
--service <n> --environment staging --project e7dca861-… --limit 30` filtered to
2026-11-23 returns **three rows in total** — one per service — and not one of them
falls inside any leg window:

| service | rows on 2026-11-23 | created | by |
|---|---|---|---|
| `backend` | `d1fb169d` (REMOVED), `2df11e51` (SUCCESS) | 14:27:13.595Z, 14:29:10.823Z | mutation |
| `frontend-web` | `d7abcc2e` (SUCCESS) | 14:29:24.779Z | mutation |
| `frontend-admin` | `6e39f119` (SUCCESS) | 14:29:38.077Z | mutation |

Every one of those four rows carries `meta.reason = "deploy"`, `meta.cliMessage =
null` and a `meta.commitHash` — the mutation signature. Upload rows look
different (`meta.cliMessage = <sha>`), and no upload row exists for staging on
this date at all. So: **27 refused uploads mint zero rows; 4 mutations mint 4 rows
and deploy three services in 28 seconds.** That asymmetry is the strongest single
fact in this pack, because it locates the fault inside the upload-initiate path
rather than in the environment, the service, the plan, the archive or the network.

**The write cell answered in the same hour, and it answered `yes`.** Run
`45194092365` (`ci-railway-token-class.yml` dispatched on `d91a6e2e9` at 14:25:44Z,
job `compare` = `137759803757`) checked `write_cell` with `deploy_sha = df6676406`
— the sha staging already served, so an authorized call could not change the
running tree:

```
14:27:12.918Z --- cell 3: the missing cell — project token x serviceInstanceDeploy(commitSha:)
14:27:14.200Z {"data":{"serviceInstanceDeploy":true}}
14:27:14.216Z PROBE_CELL mutation=accepted (http=cli-transport) sha=df6676406
14:27:29.777Z   [+15s] row=d1fb169d status=BUILDING isNew=true read=ok
14:27:45.405Z   [+30s] row=d1fb169d status=SUCCESS isNew=true read=ok
14:27:45.438Z PROBE_VERDICT[backend]=project-token-can-deploy
```

CI's own `RAILWAY_TOKEN_STAGING` therefore resolves staging's deployment target and
deploys it, with no upload — the reading table's `project-token-can-deploy` row
says propose the `release.yml` swap, and Episode 21 is where that happens. Two
traps worth recording from the same log: at 14:27:03.450Z the run's **curl** branch
still printed `Verdict: CLASS`, four seconds before its own **cli** branch produced
the deploy above, so a summary line inherited from the retired sampler must never
be read as this run's answer; and the same run's read-only cells only resolved
`serviceInstance` for the staging token — development's and production's tokens
stay refused that field, so the scope is per-token and the swap is staging-only.

**What we changed as a result (this is ours, not yours).** The three
`deploy Staging (…)` legs no longer call `railway up`. They call
`serviceInstanceDeploy(serviceId, environmentId, commitSha)` for the same three
services against environment `6b5f27a3-a290-4574-a977-363eb21d43ad`, and the leg is
**not** judged on the `true` return: `scripts/ci/staging-deploy-watch.py` decides
`deployed` / `build-failed` / `no-new-row` / `other-commit` / `rows-unparseable`
from the row list, because Episode 18 measured a `true` that created nothing on a
git-less service, and a short sha created a `FAILED` row for a commit that does not
exist. `deploy Development (…)` and `deploy Production (…)` still upload; production
is untouched by this and its `frontend-admin` remains a git-less service where the
mutation is a silent no-op. The behaviour is pinned offline by
`scripts/ci/test-staging-deploy-watch.sh` (76 checks) wired into `ci.yml`.

**Served state read back after all of it** (`serviceInstance.latestDeployment`,
not inferred from a run conclusion): development `backend`, `frontend-web` and
`frontend-admin` all at `09921c258…` (rows 14:58:40-14:58:42Z, `SUCCESS`); staging
all three at `0329a903a…` (14:29:10 / 14:29:24 / 14:29:38Z, `SUCCESS`); production
`backend` `e43c64557…` (2026-11-21T23:32:45Z), `frontend-web` `f3407986d…`
(12:51:27Z), `frontend-admin` `528382b26…` (2026-11-22T10:55:27Z). Three other runs
in this window conclude `success` (`45184035823` verdict `noop_docs_only`,
`45193856472` and `45176930855` both `superseded`) with every deploy leg `skipped`,
which is the standing reason a green Release is not evidence of a deploy.

**Pull list now — three refs, one environment, 27 refused requests:**

- environment `6b5f27a3-a290-4574-a977-363eb21d43ad`, ref `d5631441510aaaa27fa28993b36dfa364fc62fc7`
  — first refusals 12:36:45.088Z (`frontend-admin`), 12:36:46.079Z (`backend`), 12:36:53.212Z (`frontend-web`)
- ref `0329a903a5ffccc96e8b080f9467f62fe185e32b` — 13:43:10.529Z (`backend`), 13:43:15.241Z (`frontend-web`), 13:43:15.800Z (`frontend-admin`)
- ref `09921c258f4d044c3cc5443efa8776252a84243b` — 14:59:13.707Z (`backend`), 14:59:14.291Z (`frontend-web`), 14:59:16.043Z (`frontend-admin`)

Each leg retried nine times across ~1,040-1,255 s and was refused every time, with
`project.id = e7dca861-3667-4d9a-8090-6d2f4d179ec2` and the same
`@railway/cli` upload path in all three. Meanwhile `serviceInstanceDeploy` with a
commit sha deployed the *same three staging services* to `0329a903a…` in 28 seconds
and produced the rows above. So the question for Railway stays exactly the one
Episode 15 narrowed it to — **the status and body of the request that obtains the
upload destination for this environment** — and Episode 21 adds the strongest form
of the control: the environment is deployable, the services are deployable, the
token is authorized to deploy them, and only the upload-destination call refuses.
