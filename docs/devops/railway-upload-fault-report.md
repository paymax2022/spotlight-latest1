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
CI-path-specific, not an environment outage. Updated 15:56Z with episode 10 and
with the two captures this pack said were uncapturable: **the status code and the
endpoint.** Episode 10 is run `44329801870` — Release's `deploy-staging` matrix
copied verbatim onto a branch (all three services, `ref: main`, the pin, the
staging secret) with `max-parallel: 1`, so the three uploads could not overlap;
it refused 4 of 4 at 14:56:37-14:57:59Z with zero `Indexing...` lines, which
removes the last repo-side structural difference we could point at. And
`railway up --verbose` — the flag the ask below used to beg for the name of —
prints the URL, the `bytes:` of the archive and an explicit status, which let us
chase the laptop-side failures and **eliminate them as evidence**: six repo-root
frontend archives of 133,527,512 bytes died with
**`Failed to upload code with status code 524`** on
`https://backboard.railway.com/project/{project}/environment/{env}/up`, and the
uploading machine measures **11.217 Mbps uplink** (`networkQuality -s`,
16:20Z) — 1,068,220,096 bits at that rate is 95 s of transfer at line rate, and
Cloudflare's proxy window is ~100 s. A 7,511,269-byte backend archive from the
same machine takes ~5 s and was accepted (`162c1d04`, `SUCCESS` 15:18:18.823Z,
staging's backend now runs main's tip). **Those laptop refusals are our
bandwidth, not your fault, and we are withdrawing them from the differential.**
What survives is the CI signature — sub-second, pre-row, from a runner that
uploads the same 133 MB class to `development` in the same job — and the two
queryable artifacts in "What episode 10 and the wire captures add". No token
value appears here.

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
| connected git source | **this row was dismissed in our first write-up and we now think that dismissal was a reasoning error — see "the one variable that fits" below.** Re-measured 2026-11-17 with `railway api serviceInstance(serviceId, environmentId) { source { repo } }`: staging's instances report `source.repo = paymax2022/spotlight-latest1`, development's report `repo: null`, production's reports `source: null`. Staging also accepted twelve consecutive uploads with that source connected, which is why we dropped it. **Re-checked 2026-11-18 with `serviceInstance(serviceId, environmentId){ source{ repo } }`: the property is not even uniform across staging** — `backend` and `frontend-web` report `repo: paymax2022/spotlight-latest1`, `frontend-admin` reports `repo: ""` (an empty string, not null), and development reports `null` for all three. The clean test of the source hypothesis is running now: `frontend-admin`'s source was disconnected at ~15:52Z and its CI leg re-run, so the verdict is an A/B against `backend` and `frontend-web` in the same run rather than another correlation. This row stays open until that lands |

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

**Status of that sentence as of 2026-11-18 16:25Z: the test is now running, and
this section has to be read as provisional.** `frontend-admin`'s staging
`source.repo` was set to `""` at ~15:52Z (`serviceInstanceUpdate` with
`input: {source: {repo: ""}}`; `input: {source: null}` is a silent no-op that
still returns `true`), `backend` and `frontend-web` were left connected, and the
three failed staging legs of a run were re-executed together — one job, both
arms. Two of this section's premises are corrected below: the source property is
not uniform across staging's instances (`frontend-admin` now reads `""`), and the
laptop arm that was going to serve as a control for it turns out to have been
bandwidth-limited, so it controls for nothing. See "What episode 10 and the wire
captures add".

So the specific thing we would like checked: **does upload-initiate behave
differently for a service instance that has a `ServiceSource` — does it resolve
the installation, look up a branch, or check for an in-flight push-deploy before
answering?** If it reaches GitHub at that point, an intermittent failure there
fits every observation: sub-second refusal, no `Indexing...` line, one
environment only, and recovery on its own timescale. We are ready to disconnect
that source as a test, but we would rather ask than mutate a live environment on
a theory.

## What episode 10 and the wire captures add

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
that changes a service. Nine episodes are on the record: 16:23:32-16:38:15Z on
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
someone reading their own 524 needs.
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
