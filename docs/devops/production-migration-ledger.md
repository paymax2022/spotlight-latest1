# Staging → production migration — evidence ledger

**Status:** open at Task 1, 2026-11-12 · **Owner:** DevOps · **Scope:** the one
place the 16-task migration plan records what production measures today, the
command that measured it, and what each later task found when it re-measured.

**Pinned `RELEASE_SHA`:**
`c49b395643473ba6ff7a225d7a7a339a41eddfe6` —
`2026-11-12 18:43:14 +0100` —
`fix(health): run the telemedicine intake after payment (#992)`

> Every figure below is either a measurement taken live at Task 1 and printed
> with its command, or a baseline figure carried forward **as captured** with
> the command that re-reads it and the task that owns that re-read. Nothing in
> this file is a guess. A probe that returned nothing says so.

---

## 1. The pin, and how it was chosen

Plan: `docs/superpowers/plans/2026-11-12-staging-to-production-migration.md`
Tasks 4, 11, 12 and 14 ship exactly this SHA; no later task re-picks it.
(The plan file is not yet committed at the pinned SHA — Task 16 lands the doc
set it belongs to.)

The rule applied: the newest `origin/main` SHA whose **`ci.yml`**
(`CI — CLAUDE.md gates`) **and** `integration-verify.yml` (`integration-verify`)
runs both concluded `success`. `CI (Zero-Billing Optimized)` (`ci-optimized.yml`)
is recorded too, but it is not the deciding lane.

Lanes were read per SHA with:

```bash
gh run list --repo paymax2022/spotlight-latest1 --commit "$SHA" --limit 50 \
  --json name,workflowName,conclusion,event,headBranch,createdAt,databaseId
```

Observed over the newest 20 `origin/main` SHAs. Every run listed by this
probe for these SHAs is `event=push`, `headBranch=main` — verified field by
field for all 20, not assumed:

| SHA | date | `CI — CLAUDE.md gates` | `CI (Zero-Billing Optimized)` | `integration-verify` |
|---|---|---|---|---|
| `c49b39564` | 2026-11-12 18:43 | success | success | **success** ← pinned |
| `a6c963ced` | 2026-11-12 18:16 | success | success | cancelled |
| `bd3089f3a` | 2026-11-12 17:53 | success | success | cancelled |
| `8436ad005` | 2026-11-12 16:44 | success | success | success |
| `4bf6d6f94` | 2026-11-12 14:25 | **failure** | success | success |
| `038b38b2b` | 2026-11-12 10:42 | **failure** | success | success |
| `42adcd535` | 2026-11-12 10:32 | success | success | cancelled |
| `4a595995c` | 2026-11-12 10:15 | — | — | — |
| `7a5f8311e` | 2026-11-12 06:32 | success | success | success |
| `6892068e8` | 2026-11-12 06:32 | — | — | — |
| `1d83f2e42` | 2026-11-12 06:31 | — | — | — |
| `531b07f12` | 2026-11-12 06:31 | — | — | — |
| `3836f3abd` | 2026-11-12 06:06 | — | — | — |
| `8ec1681f5` | 2026-11-12 05:53 | — | — | — |
| `480165e8a` | 2026-11-11 23:30 | success | success | success |
| `3ebb5ab2f` | 2026-11-11 21:06 | — | — | — |
| `318aede25` | 2026-11-11 20:57 | — | — | — |
| `63462dd59` | 2026-11-11 20:56 | — | — | — |
| `deb003ab5` | 2026-11-11 20:56 | — | — | — |
| `215de187a` | 2026-11-11 20:56 | — | — | — |

`—` means `gh run list --commit` returned **no runs at all** for that head SHA.
It is not a hidden failure: `GET /repos/paymax2022/spotlight-latest1/commits/4a595995c/check-runs`
and the same for `3ebb5ab2f` each returned `check_runs: []` (length 0), so those
commits carry no CI record at all — they are branch-side commits that reached
`main` through a merge whose own SHA is the one that ran. They cannot be
pinned: there is nothing to verify.

**Result: the `origin/main` tip is itself the pick.** Four of the twenty are
green on both deciding lanes — `c49b39564` (tip, newest), `8436ad005`,
`7a5f8311e` and `480165e8a` — so the pin is the tip. The two commits sitting
between the tip and the `8436ad005` the baseline table named (`a6c963ced`,
`bd3089f3a`) both show `integration-verify=cancelled` — superseded by the next
push, not red.

Pin and read-back (shell state does not survive between steps, so every later
block starts with the guard):

```bash
RELEASE_SHA=c49b395643473ba6ff7a225d7a7a339a41eddfe6
git log -1 --format='%H %ci %s' "$RELEASE_SHA"
echo "$RELEASE_SHA" > /tmp/RELEASE_SHA

RELEASE_SHA="$(cat /tmp/RELEASE_SHA)"; [ "${#RELEASE_SHA}" = 40 ] || { echo "FATAL: RELEASE_SHA missing or not 40 chars"; exit 1; }
```

Observed at Task 1: `c49b395643473ba6ff7a225d7a7a339a41eddfe6 2026-11-12 18:43:14 +0100 fix(health): run the telemedicine intake after payment (#992)`.

### 1.1 The stale-tree trap, confirmed before anything was read

```bash
git -C /Users/paymax/Documents/spotlight/main rev-list --left-right --count HEAD...origin/main
```

Task 1 observed `10` ahead / `34` behind, counted against `c49b39564`; the same
command against `648d7bca9` now reads `10` / `35` (the local remote-tracking ref
moves with every fetch, so the figure is meaningless without the SHA it was
counted against — the plan-time baseline was `10	31` against `8436ad005`), so
the local working tree **is not the truth**. Every source read in
this plan goes through `git show <RELEASE_SHA>:<path>`; nothing was written to
that tree. All writes land in the isolated worktree
`/tmp/spot-cutover` (branch `feat/prod-cutover`).

### 1.2 Why the pin moved and the baseline table did not

`origin/main` advanced by three commits since the baseline table was captured
(`8436ad005` → `c49b39564` — #993, #987, #992: telemedicine, doctor and health
work). All three touch `backend/`, which is why §3.2 reads 713/242 where the
baseline read 710/239, and the delta adds one migration file
(`20271408000000_preconsult_intake_schema_ui.sql`), which is why §3.4's
git-side count reads 751 where the baseline read 750. That is the reason the
pin is re-taken at Task 1 rather than copied.

### 1.3 `origin/main` moved again while Task 1 was measuring

`git log -1 origin/main` re-read at the end of Task 1 showed a **newer** tip:
`648d7bca903b87c1b6d0dee913ecc2953f90d61a` —
`2026-11-12 19:24:48 +0100` —
`fix(health): let the pre-consult intake resolve a telemedicine appointment (#997)`.
It is a direct child of the pinned SHA (one commit ahead, verified with
`git merge-base --is-ancestor`).

It is **not** the pick, because its verification lanes had not concluded:

```bash
gh run list --repo paymax2022/spotlight-latest1 --commit 648d7bca9 --limit 50 \
  --json workflowName,status,conclusion,event,headBranch,createdAt
```

Observed at 2026-11-12T18:24:52Z for `648d7bca9` (`event=push`, `headBranch=main`):
`CI — CLAUDE.md gates` = **in_progress**, `integration-verify` = **in_progress**,
`CI (Zero-Billing Optimized)` = success, `security` = in_progress,
`DB Migrate (Supabase db push)` = pending, `Deploy to Namecheap cPanel (SSH)` =
skipped. An in-progress lane is not a `success`, so the newest SHA green on both
deciding lanes is still `c49b39564`, and the pin above holds.

**The pin is FROZEN — ruling, not observation.** `c49b39564` is the release cut
for this whole cutover, and Tasks 2, 4, 11, 12 and 14 must **not** re-run this
walk or re-take it. The reason is coupling, not caution: Task 2 derives the
pending-migration set from the files **at the pin**, and Tasks 11 and 12 ship
the code **at the pin**. A re-pick mid-flight splits the two, and a schema set
that does not match the shipped code is the failure this plan exists to prevent.
Anything merged onto `main` after the pin — `648d7bca9` / #997 first among them
— is **out of scope for this cutover** and ships afterwards through the normal
lanes, with its own migration. Pulling a later merge into the cutover is a
human decision, never a task's silent one; if you are a task reading this line
and you think the pin should move, stop and ask rather than re-picking.

What that one commit costs, measured now (so the choice is not made blind):

```bash
git diff --name-only c49b39564 648d7bca9
git ls-tree -r --name-only 648d7bca9 -- supabase/migrations/ | wc -l
git rev-list --count 41c19ea2b97ec216213a0af7b0db79e9edff5767..648d7bca9
git rev-list --count 41c19ea2b97ec216213a0af7b0db79e9edff5767..648d7bca9 -- backend/
```

Observed: 5 files (`backend/internal/health/preconsult/{admin,repository,service}.go`,
one live-DB test, and **`supabase/migrations/20271409000000_preconsult_intake_telemedicine_plane.sql`**)
→ **752** migration files at `648d7bca9` vs 751 at the pin, and prod drift
**714 total / 243 touching `backend/`** vs 713/242 at the pin. Pinning
`c49b39564` therefore leaves #997's migration and its matching Go code out of
the release. Both stay out together, which is the consistent state: the schema
set Task 2 classifies and the code Tasks 11/12 ship are the same cut.

**The consequence of that `DB Migrate (Supabase db push)` = pending line, which
is the live risk here.** #997's push triggered `db-migrate.yml`, whose production
job runs `supabase db push --linked` against prod under `environment: production`
(`db-migrate.yml:75-83` at the pin) — and that environment carries required
reviewers. Re-read at 2026-11-12:

```bash
gh run list --repo paymax2022/spotlight-latest1 --workflow db-migrate.yml --limit 6 \
  --json databaseId,headSha,event,status,conclusion,createdAt
```

Observed: run **`43279570280`**, `648d7bca9`, `event=push`, status **`pending`** —
a parked production approval sitting there right now, waiting for a named human.
Re-read over the last 12 runs of that lane, every **push**-triggered one except
one has concluded `cancelled` — `43272403002` (at the pin), `42423593061`,
`42140178659`, `41871090397`, `41866807842`, `41475181672`, `41226426121`,
`41030357056`; the exception is **`41342305462`** (`886d857f1`, push) which
concluded **`failure`**, and the two `workflow_dispatch` runs in the window
(`42937731019`, `41440285671`) also concluded `cancelled`. The lane has been
declined repeatedly, which is why prod's schema is 87-odd versions behind in the
first place.

Two rules follow, and Task 2 as well as Tasks 4/11/12/14 must obey them:

- **Do not approve `43279570280` on someone else's behalf.** If a human does
  clear it, `20271409000000_preconsult_intake_telemedicine_plane.sql` lands in
  prod *outside* this plan's ordering — before Task 3's dump exists, and before
  the code that expects it ships. That is the stranded-academy-tables failure
  class, arriving from the other direction.
- **If that run is approved or cancelled by anyone else, re-read §3.4 and §3.5
  before Task 2 classifies**, because both numbers move: §3.4's history-table
  count gains a recorded version and §3.5's pending/back-dated split changes.
  Task 2 must not classify against a stale capture.

### 1.4 That rule fired during Task 2 — by a different door (2026-11-12, evening)

Both halves of the rule above triggered, and the parked run was **not** the cause.
Re-read after the writes:

- `43279570280` (`db-migrate.yml`, push, `648d7bca9`) is now
  **completed / cancelled** — someone declined it, so the `DB Migrate` lane never
  wrote prod. §1.3's "do not approve it on someone else's behalf" needed no
  action from this plan.
- Production nevertheless gained `20271408000000` **and**
  `20271409000000`, through the writer that needs no reviewer:
  `ops-db-push-scoped.yml`, run **`43301433055`** (`workflow_dispatch`,
  head `3654f6b3f`, `2026-11-12T20:33:13Z`, `mode=apply`,
  `versions="20271408000000 20271409000000"`, typed confirm present, concluded
  `success`). Its own SQL read `remote history rows: 667` before applying and
  printed `local migrations still without a history row: 85` afterwards, at the
  `3654f6b3f` tree — **754** migration files, three more than the pin.
- `mode=plan` against production, run **`43303287939`** (`2026-11-12T20:44:51Z`),
  then read **`remote history rows: 669`**, and a later `mode=plan` of my own
  (`43311344252`, `2026-11-12T21:33Z`) reads **`670`**. The count this ledger
  carries is **670**; it supersedes §3.4's 667 and the 669 that §2.5 first quoted.
- The same lane kept writing after that: `43308955575` (`21:18:30Z`,
  `versions="20271410000000"`, read 669) and `43309595782` (`21:22:19Z`, same
  version, read 669 before and printed `local migrations still without a history
  row: 84` after) — so `20271410000000` is recorded on production now, applied by
  another session, and prod's pending at that tree is 84.
- An earlier batch that tried to carry `20271408000100` and `20271410000000`
  together (`43308617765`, `21:16:29Z`) **failed at the additive re-check** on the
  former — `##[error]20271408000100_module_readiness.sql is not additive-only` —
  wrote nothing, and the session then **split its batch** and applied only the
  version the gate let through. That workaround is available for a *mixture*, and
  §2.6 records why it is not available for a batch whose own file is blocked.
- `origin/main` moved again in the same window: tip is now **`3654f6b3f`**
  (`2026-11-12 21:20:36 +0100`, `feat(modules): readiness axis for the admin
  portal and production (#996)`), whose tree adds
  `20271408000100_module_readiness.sql` and
  `20271410000000_module_registry_add_ungated_surfaces.sql` to the three-way
  delta already recorded in §1.3.

**What this does to the pin, stated plainly.** The pin is not moved by it —
§1.3's freeze holds, and no task gets to re-pick on the strength of a write it
did not make. But prod's schema is now **two versions ahead of the pinned tree**:
`20271409000000_preconsult_intake_telemedicine_plane.sql` (#997) and
`20271410000000_module_registry_add_ungated_surfaces.sql` (#996) are recorded in
production's history and neither exists at `c49b39564`. A third pin-external file,
`20271408000100_module_readiness.sql`, is **not** recorded — established by
elimination below, not by a direct read. This is the reverse of the drift §1.3
warned about (code shipped without its migration): here the migrations ran
without their code, because #996 and #997 are out of this cutover by ruling R9.
Consequences that Tasks 4, 6 and 11 must carry, not discover:

1. `supabase db push`-style replay of the pinned tree can never reproduce prod's
   history exactly — a Task 4 fresh-DB replay ends at 668 recorded versions where
   prod holds 670. The two-version diff is named, not unknown: it is exactly the
   two files above.
2. Production's max applied is now `20271410000000`, above every file at the pin
   (whose highest is `20271408000000`, itself now applied). So the §3.4 below-max
   hazard is total: measured in §2.5, **all** remaining pending files at the pin
   sort below prod's max applied. §2.5 states what does and does not follow from
   that.
3. **Pending at the pin = 83**, closed two ways. The lane's own SQL gives 84 at
   the `3654f6b3f` tree against 670 rows and 754 files, and `754 − 670 = 84`
   closes — which proves every recorded version has a file in that tree, so the
   only versions missing from the pin's tree are among its three extra files. Two
   of those three are recorded; `20271408000100` is not, because the only two runs
   that ever carried it (`43308617765`, `43311601255`) both died at the additive
   re-check before any write, and no other apply run names it. So
   `751 − (670 − 2) = 83`, and `84 − 1` (the still-pending `module_readiness`)
   agrees. Batches: `ceil(83 / 12) = 7`.
4. **Prod is a moving number, and this section is already a snapshot.** The chain
   this evening is `667 → 669 → 670`, each step a different session's write, with
   my own two reads (`43311344252`, `43311601255`) landing inside eleven minutes of
   the last apply. Any task quoting a count must re-read, not quote here:

   ```bash
   gh workflow run ops-db-push-scoped.yml --repo paymax2022/spotlight-latest1 \
     -f mode=plan -f versions="20271410000000"
   # then, once completed:
   gh run view <run-id> --repo paymax2022/spotlight-latest1 --log \
     | grep -aoE 'remote history rows: [0-9]+|  2027[0-9]{10}: (RECORDED on remote \(may still be absent — the drift case\)|not recorded)' | sort -u
   ```

   One trap in that command, learned the hard way in the run above: **`mode=plan`
   is gated by the same additive re-check as `mode=apply`** — dispatching
   `versions="20271408000100"` failed at step 7 rather than answering whether the
   version is recorded. So a version the gate blocks cannot be *inspected* through
   this lane either, and the only probe that works is a version you already know is
   clean. Ask for a blocked version's state from a `mode=list` capture or from
   psql, not from `mode=plan`.

---

## 2. What Task 1 re-measured, and what it could not

Re-measured **live today** with a read-only HTTP or local-git probe: §3.1, §3.2,
§3.3, §3.6, §3.8's captured-log witnesses (re-read from the stored run, not
re-probed on the host), §3.9's HTTP half (the restaurant 401 and all three
academy 404s), §3.10 (both halves — the `www.spotlightng.com` half and the staging
web half at `https://frontend-web-staging-new.up.railway.app`), the git-side
half of §3.4, and the git half of §3.5 (the 111/112 tree difference, which needs
no production read). A staging HTTP probe needs no approval and no secret, so
deferring it would have been a gap, not a limitation.

**Not** re-measured at Task 1, because the number lives behind a Supabase
production read, a Railway production read, or an SSH host probe: §3.4's
history-table count, §3.5's history-table half, §3.7, §3.8's live host state
(only its stored-log witness was re-read), §3.9's Railway env counts, §3.11,
§3.12, §3.13, §3.14.
Those rows carry the
figure **as captured 2026-11-12**, the exact command that re-reads it, and the
task that owns the re-read. No workflow was dispatched to obtain one —
`Production` has required reviewers, and anything dispatched into it (including
the read-only `ops-db-push.yml mode=list environment=production`) parks rather
than answers.

---

## 3. Measured baseline

### 3.1 Go API, prod — RE-MEASURED 2026-11-12 (Task 1)

```bash
curl -sS 'https://backend-production-1b33d.up.railway.app/api/v1/public/build'
```

Observed: `{"commit":"41c19ea2b97ec216213a0af7b0db79e9edff5767","source":"ldflags","started_at":"2026-10-17T15:14:19Z","uptime_seconds":2257605}` (HTTP 200).

Same build as the baseline capture: **still `41c19ea2b9…`, still started
2026-10-17T15:14:19Z**; only `uptime_seconds` moved (2250504 → 2257605, i.e.
the same process). **Target:** the release SHA (§1). Consumed by Task 11.

### 3.2 Drift, prod backend → `origin/main` — RE-MEASURED 2026-11-12 (Task 1)

```bash
cd /tmp/spot-cutover
git rev-list --count 41c19ea2b97ec216213a0af7b0db79e9edff5767..c49b395643473ba6ff7a225d7a7a339a41eddfe6
git rev-list --count 41c19ea2b97ec216213a0af7b0db79e9edff5767..c49b395643473ba6ff7a225d7a7a339a41eddfe6 -- backend/
```

Observed: **713 total, 242 touching `backend/`** (baseline: 710 / 239).
Method check against the baseline's own tip reproduces it exactly —
`git rev-list --count 41c19ea2b97ec216213a0af7b0db79e9edff5767..8436ad005` = 710
and the same with `-- backend/` = 239 — so the +3 delta is the tip moving, not a
different measurement. **Target:** 0.

### 3.3 Go API, staging — RE-MEASURED 2026-11-12 (Task 1)

```bash
curl -sS 'https://backend-staging-new.up.railway.app/api/v1/public/build'
```

Observed: `{"commit":"886d857f19d03b6d0d2ead456162e9d24a8b6ae4","source":"env","started_at":"2026-11-02T11:25:52Z","uptime_seconds":888915}` (HTTP 200).

**886d857f19…** is **227 commits** behind the pinned SHA (baseline: 224 behind
`8436ad005`; re-measured with `git rev-list --count
886d857f19d03b6d0d2ead456162e9d24a8b6ae4..c49b395643473ba6ff7a225d7a7a339a41eddfe6`,
49 of them touching `backend/`). Staging's `source` is `env`, not `ldflags` —
worth knowing before Task 4 copies its config. **Target:** the same SHA as prod.

### 3.4 Prod schema — AS CAPTURED 2026-11-12; git half re-measured

Figure as captured: `supabase_migrations.schema_migrations` = **667** rows — the
`Prove the connection and read history state (read-only)` step of run
**`42983741548`** (`Ops DB Push (scoped)`, `workflow_dispatch`, success,
headSha `9e8d0c779`) printing `remote history rows: 667` at
2026-11-11T08:01:35Z; `origin/main`
carried **750** files in `supabase/migrations/`, every one named
`20<12 digits>_…sql` → **≈83 pending**. On the *previous* captured table — run
**`42367077299`** (`Ops DB Push (manual)`, `workflow_dispatch`, success,
2026-11-07T11:10:47Z, headSha `87b25a8ab`, production `mode=list`), which
prints **663** applied rows — the classifier instead prints **87 pending = 69
above-max additive + 18 below-max additive + 0 NON-ADDITIVE**; the 4-version
difference between the two table reads is the four days between them
(663 → 667), not two answers to one question. **Target:** 0 pending.

> **Superseded 2026-11-12 evening — read §1.4 and §2.5 before quoting any number
> on this line.** Production has moved again: `remote history rows` is now **669**,
> the pinned tree holds **751** files, and pending at the pin is **83**, not ≈83
> and not 87. The two figures captured here (667 rows on 750 files; 663 rows on
> 751 files) are each internally consistent for their own date, and the "83" and
> "87" they imply are *different quantities measured against the same stale
> pairing* — the 69/18 above-max/below-max split in particular is now 0/87, so do
> not carry it forward.

> Task 16 note, found while attributing the 663: plan line 310 describes this
> run as "`42367077299`'s successor at that date", but `42367077299` **is** the
> 2026-11-07 run — there is no successor at that date, and the next
> `Ops DB Push (manual)` run is `42793519947` (2026-11-10, cancelled). A task
> that reads the plan literally will go looking for a run that does not exist.

Re-measured today (local git only, against the pinned SHA):

```bash
git ls-tree -r --name-only c49b395643473ba6ff7a225d7a7a339a41eddfe6 -- supabase/migrations/ | wc -l
git ls-tree -r --name-only c49b395643473ba6ff7a225d7a7a339a41eddfe6 -- supabase/migrations/ | grep -cE '(^|/)20[0-9]{12}_.*\.sql$'
```

Observed: **751 files, 751 matching the `20<12 digits>_…sql` naming, 0 not
matching** (baseline 750 → +1, the `20271408000000_preconsult_intake_schema_ui.sql`
in the three-commit delta).

Not re-measured: the **667** history-row count needs a Supabase production
read. It is re-read by **Task 2 Step 5** through the no-reviewer scoped lane,
whose read-only step prints `remote history rows: <n>`:

```bash
# mode=plan is not enough on its own: at the pin, ops-db-push-scoped.yml:134 is
# `if [ "$n" -eq 0 ]; then echo "::error::versions is empty."; exit 1; fi` and it
# runs BEFORE the `remote history rows: $total` print at :174. An empty `versions`
# therefore aborts the job one step short of the number this row exists to re-read.
gh workflow run ops-db-push-scoped.yml --repo paymax2022/spotlight-latest1 \
  -f mode=plan -f versions=20271408000000
```

`20271408000000` is not invented — it is the newest version at the pin
(`git ls-tree -r --name-only c49b39564 -- supabase/migrations/ | tail -1` returns
`20271408000000_preconsult_intake_schema_ui.sql`), and any version whose file
exists at the pin works equally well, because in `plan` mode the list selects the
connection and applies nothing. The job runs under
`environment: production-db-scoped`, which has no reviewers, so it does not park.

One arithmetic trap in this row, because Task 6's batch split consumes it: today
the git side reads **751** files and the history table read **667** rows, so
naive subtraction gives **≈84**, not the baseline's **≈83**. Neither figure is
wrong, and the reason is one file, not elapsed time: the baseline's 750 was
counted at `8436ad005` and the pin adds `20271408000000_preconsult_intake_schema_ui.sql`,
while the **667** history read came from the same-scoped run on
2026-11-11T08:01:35Z — a production read Task 1 cannot re-take without the
lane in §3.4 above. (The separate 87-vs-≈83 gap two rows up *is* a date gap —
663 rows on 2026-11-07 against 667 on 2026-11-11.) Use the
count Task 2 Step 6 produces from a single capture-and-classify pair, never a
subtraction across two captures.

Scope of the paragraph above, stated so §2.5 does not read as contradicting it:
it defends why the *baseline-era* 83 and the *pin-era* 84 were two honest readings
of two different trees, and neither was a mistake at the time. It is **not** a
claim about today's pending count. Today's is §2.5's **83**, which comes from one
current pair rather than from the mixed pairing this paragraph warns about, and
whose history side (§1.4's 667) has itself since moved again. Re-derive from a
single capture-and-classify pair; do not quote 83 or 84 from either paragraph as
current.

### 3.5 Migrations added prod→main — git half RE-MEASURED 2026-11-12, DB half AS CAPTURED

Figure as captured: **111** files under `supabase/migrations/` newer than
prod's deployed state, against ≈83 unrecorded — the 28-file difference is
**not yet explained** (already-applied academy-era files is the likely reading,
not a proven one). Both figures are baseline-era and were counted over
`supabase/migrations/` at `8436ad005`, the `origin/main` tip when the baseline
was taken (750 files there); at the pin the file side is 751, so if you re-derive
the 111 today it will read 112 against a different SHA. **Target:** Task 2 Step 6
produces the authoritative pending set, and the ledger must reconcile the two
numbers before Phase 2.

The two halves have **different** provenance, and conflating them was the error
this rewrite fixes. The 111 figure is a pure local-git tree difference — it
needed no production read at all, so it is re-measured here, today:

```bash
# prod's deployed commit, from §3.1's own build endpoint (41c19ea2b97ec216213a0af7b0db79e9edff5767)
git diff --name-only --diff-filter=A 41c19ea2b97ec216213a0af7b0db79e9edff5767..8436ad005 \
  -- supabase/migrations/ | wc -l      # baseline-era → 111
git diff --name-only --diff-filter=A 41c19ea2b97ec216213a0af7b0db79e9edff5767..c49b39564 \
  -- supabase/migrations/ | wc -l      # at the pin → 112
```

Observed: **111** against `8436ad005`, **112** against the pin — both reproduced
at Task 1's fix round. Note the shape of the command: `41c19ea2b9` is **not in
`main`'s history at all** (`git merge-base --is-ancestor 41c19ea2b9 origin/main`
fails), because prod was last built from a `prod`-branch promotion commit
(`git branch -a --contains` → `origin/prod`,
`origin/chore/promote-prod-oct17-2`; subject "chore: promote main to prod
(…) (#830)"). So this is a *tree* difference between what prod runs and what the
pin carries — which is the right question — but it is not a history walk, and a
`git log --diff-filter=A` over the same range would answer a different question
(it returns 114 unique paths across the 713-commit range, because it walks merge
history rather than comparing two trees).

The **≈83 unrecorded** half is the classifier's count and genuinely does need
prod's history table. It comes from `scripts/db/list-pending.sh`, which **does
not exist at the pin** (at the pin only `scripts/db/reconcile-pending.sh` and
`scripts/db/classify-pending-migrations.sh` exist); the script is authored by
**Task 2 Steps 2–4** and run from the `/tmp/rel` worktree at
**Task 2 Step 6** — so this command is only executable in that context:

```bash
cd /tmp/rel
bash scripts/db/list-pending.sh --remote-table /tmp/prod_table.txt \
  | grep -c '^pending'
```

`/tmp/prod_table.txt` is produced upstream by Task 2 Step 5's read. Take it from
that column whole — **never** a `grep -oE '20[0-9]{12}'` sweep of the same log.
Measured on run `42367077299`'s `Migration list (before)` column: such a sweep
returns **749** distinct version tokens, while the pipe-rows with a non-empty
Remote cell number **663** and **86** rows print an empty one (the shape
`` `20271060000000` | ` ` ``, which the plan calls the LOCAL-ONLY class — note
the literal string `LOCAL-ONLY` does not appear in that log, so match on the
empty cell, not on the word). Feeding a 749-row sweep in as "applied" marks every
pending migration already applied and the classifier prints **0 pending** — the
false green that would have cancelled this migration on its first run. The git
commands above spell their SHAs out rather than using `$RELEASE_SHA`; the
read-it-back rule still binds any later block that substitutes it, since an
empty `$RELEASE_SHA` expands silently and turns a `git diff` into a comparison
against nothing.

Why the second half was not re-measured at Task 1: it depends on prod's
`schema_migrations` state, and the only lane that reads it is the scoped
`mode=plan` run described in §3.4, which Task 2 Step 5 dispatches.
Re-read by **Task 2 Step 6** (the classifier run over the pending set), not at
Task 1.

### 3.6 Prod web module flags — RE-MEASURED 2026-11-12 (Task 1)

```bash
curl -sS -w '\n%{http_code}\n' 'https://www.spotlightng.com/api/v1/restaurant/00000000-0000-4000-8000-000000000000'
curl -sS -w '\n%{http_code}\n' 'https://www.spotlightng.com/api/v1/referral/my-rewards'
curl -sS -w '\n%{http_code}\n' 'https://www.spotlightng.com/api/v1/association/mine'
```

Observed, all three HTTP **503**:
`{"success":false,"error":"Restaurant delivery is not available."}` ·
`{"success":false,"error":"Referrals are not available."}` ·
`{"success":false,"error":"This service is not available."}`.

Unchanged from the baseline. **Target:** **401** Unauthorized (gate passed,
auth refused). The restaurant path is probed with a synthetic nil UUID because
the flag check is the handler's **first** statement, ahead of
`requireRequestUser` and of any row lookup —
`git show c49b39564:frontend-web/app/api/v1/restaurant/[id]/route.ts`, line 9:
`if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);`
Per the plan's rule, only 503 vs 401/400 decides "was the flag read"; a 405 or
404 would prove nothing.

### 3.7 Prod web runtime env — AS CAPTURED 2026-11-12

Figure as captured: `spotlight-latest` `deploy-cpanel.yml` Finalize writes
`.env.production.local` with exactly **4 keys** —
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `GO_BACKEND_URL` — and **zero `FEATURE_*`**.
**Target:** 4 + the 36 reviewed flags.

Why not re-measured here: the writer lives in the **shipping repo**, and the
figure that matters is the file's content on the host, i.e. the SSH read in
§3.8. Re-read from the lane's own definition (names and structure only, values
never printed):

```bash
# the file's path/name:
gh api repos/paymax2022/spotlight-latest/contents/.github/workflows/deploy-cpanel.yml --jq '.name'
# its content (read the Finalize step in this output, not the name above):
gh api repos/paymax2022/spotlight-latest/contents/.github/workflows/deploy-cpanel.yml --jq '.content' | base64 -d
```

Path confirmed present at Task 1: the `.name` call returns `deploy-cpanel.yml`.
Note for Tasks 8 and 16, which this row is the first evidence of: the cPanel
lane and its runs live in **`paymax2022/spotlight-latest`**, the shipping repo —
not `spotlight-latest1`, where every lane named in the plan's Tasks 1–7 lives. A
`gh run list --repo paymax2022/spotlight-latest1 --workflow "Deploy to Namecheap
cPanel (SSH)"` finds nothing, and that is the repo being wrong, not the lane
being missing. **Re-run by Task 8**, which is the task that changes this file's
writer.

### 3.8 Host env-file inventory — AS CAPTURED 2026-11-12; stored log re-read today

Figure as captured: the `Probe prod Supabase runtime env (read-only)` step of
the shipping repo's `deploy-cpanel.yml` (run `43037664704`, 2026-11-11T14:23:27Z)
lists **one** `.env*` file in `APP_DIR` — `.env.production.local`, mtime
`2026-11-11T07:50:07` — holding those same 4 keys and no `FEATURE_*`.
**Target:** unchanged; Task 8's truncate-and-write therefore drops nothing it
did not itself write.

What was and was not re-read: the **live host** was not probed — it is an SSH
probe, so its only witness is a deploy's log. The **stored** witness is
readable today, and it still says the same thing:

```bash
gh api repos/paymax2022/spotlight-latest/actions/runs/43037664704/jobs \
  --jq '.jobs[] | select(.name=="deploy") | .id'          # → 130580727795
gh run view 43037664704 --repo paymax2022/spotlight-latest --log --job 130580727795 \
  | grep -aoE '\-\-\- \.env[A-Za-z0-9._-]* \(mtime [0-9T:-]+\)'
```

Observed re-read today — exactly one line, `--- .env.production.local (mtime
2026-11-11T07:50:07)`, which is the "one `.env*` file" figure, and
**0** `FEATURE_*` lines. The key half, name-only: the `KEY : file` inventory
shape surfaces two of the four keys
(`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, both
`→ .env.production.local`); by name across the whole job the four appear
**42 / 26 / 11 / 7** times (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`GO_BACKEND_URL`) and nothing else in that family appears — re-count with
`grep -ao "<name>" | wc -l` per name, which is total occurrences; `grep -ac`
on the same names gives **41 / 25 / 11 / 7** lines — the two differ because
exactly one line mentions each of the first two names twice. So the "exactly 4 keys,
zero `FEATURE_*`" figure survives re-reading, with the caveat that these are
occurrence counts of the log's own echoes, not a distinct-key inventory.

```bash
gh run view 43037664704 --repo paymax2022/spotlight-latest --log --job 130580727795 \
  | grep -aoE '[A-Z0-9_]+ *: ?\.env[A-Za-z0-9._-]*' | sort -u
gh run view 43037664704 --repo paymax2022/spotlight-latest --log --job 130580727795 \
  | grep -acoE 'FEATURE_[A-Z0-9_]+'          # → 0
```

**Read this log through a value-stripping filter, never raw.** The `deploy`
job's own echoes carry the publishable/anon Supabase key verbatim on **22
lines** (`grep -ac 'sb_publishable_'` on the raw log; the service-role value is
not among them — no `eyJhbGci`, no `sb_secret_` match). That is still a
credential value, so piping the raw output into a reply, a commit, or this
ledger breaks the plan's "names and lengths only" rule. Use the
`grep -aoE '<name-shaped pattern>'` forms above: they match identifiers, so
they cannot emit a value.

**The step-column trap, measured per repo rather than generalized.** `gh run
view --log` labels each line's step column differently depending on the run:

| Run | repo | `awk -F'\t' '$2 == "Migration list (before)"'` | lines reading `UNKNOWN STEP` |
|---|---|---|---|
| `42367077299` | `spotlight-latest1` | **771 lines** | 0 |
| `43037664704` job `130580727795` | `spotlight-latest` | **0 lines** | all 99,563 |

So the column match is **not** broken universally — it works against precisely
the runs Task 2 Step 5 and Task 6 Step 5 consume, both in
`spotlight-latest1`, and **the plan's own capture commands must not be changed
on the strength of this row.** The `spotlight-latest` deploy lane is the
exception, which is why the two commands above select the job by id and match on
content instead. Two consequences for later tasks:

- Keep the `grep -c '|'` guard beside every column-matched capture; it is what
  turns an empty capture into a failure rather than a "nothing pending" green.
  The right hardening is that guard plus a sanity floor on the captured row
  count — not a different capture command.
- Do **not** substitute a job-scoped content `grep -a` where the plan intends a
  step-scoped one: on `spotlight-latest1` logs the content match blends
  "Migration list (before)" with "Migration list (after)", which silently
  unions two different sets. Column matching is the correct instrument there.

Task 8 re-runs the probe on the next shipping-repo deploy and records its output
as a `## Task 8` section in §5's format — appends go there, never into this row,
so the "before" value survives.

### 3.9 Prod BFF for mobile — HTTP halves RE-MEASURED 2026-11-12; env counts AS CAPTURED

Re-measured live (all ungated HTTP GETs, so they were in scope all along — the
three academy paths are probed here as a set because §3.10's claim is about the
set, not about one URL):

```bash
curl -sS -w '\n%{http_code}\n' 'https://frontend-web-production-9259.up.railway.app/api/v1/restaurant/00000000-0000-4000-8000-000000000000'
for U in /api/academy/topics /api/academy/exams /api/academy/certificates/verify/00000000-0000-0000-0000-000000000000; do
  curl -sS -w '\n%{http_code}\n' "https://frontend-web-production-9259.up.railway.app$U"
done
```

Observed: **401** on the restaurant route (gate passed, auth refused), matching
the baseline. All three academy routes **404**, each with body
`"No API route matches GET <path>"` — that plane's served build has no academy
routes at all. Only `/api/academy/topics` was probed when this row was first
re-measured; the other two are today's additions and agree with it.
**Target:** unchanged for the 36; but see §3.10 — this build predates some
routes entirely, which a flag cannot fix.

Not re-measured: the **49 `FEATURE_*` / 46 ON** half needs a Railway production
read, which dispatches into `Production` and parks. Re-read by **Task 15** (and
Task 12 if it touches this service) with:

```bash
gh workflow run ops-railway-vars-list.yml --repo paymax2022/spotlight-latest1 -f environment=production -f service=frontend-web
```

(the second needs a named human to clear the `Production` approval; values are
never printed by that lane, only names and digests).

### 3.10 Academy gates, both web planes — RE-MEASURED 2026-11-12 (both halves)

```bash
curl -sS -w '\n%{http_code}\n' 'https://www.spotlightng.com/api/academy/topics'
curl -sS -w '\n%{http_code}\n' 'https://www.spotlightng.com/api/academy/exams'
curl -sS -w '\n%{http_code}\n' 'https://www.spotlightng.com/api/academy/certificates/verify/00000000-0000-4000-8000-000000000000'
```

Observed, all three HTTP **503** on `www.spotlightng.com`:
`"Topic learning is not available yet"` · `"Assessments are not available yet"` ·
`"Credential verification is not available yet"`. Unchanged.

**The staging half.** Staging's web plane is
`https://frontend-web-staging-new.up.railway.app` — the
origin the repo itself uses (**10 references across 9 tracked files at the
pin**, `git grep -c -e frontend-web-staging-new c49b39564` — workflows,
`docs/devops/deployment-matrix.md`, `mobile-app/reactnative/eas.json`, and
`staging-crypto-user-steps.sh`; the plan never names it, so it was taken from
the tree, not guessed).

```bash
for U in /api/academy/topics /api/academy/exams /api/academy/certificates/verify/00000000-0000-0000-0000-000000000000; do
  curl -sS -w '\n%{http_code}\n' "https://frontend-web-staging-new.up.railway.app$U"
done
```

Observed, all three HTTP **503** on staging, with bodies
`"Topic learning is not available yet"` · `"Assessments are not available yet"` ·
`"Credential verification is not available yet"` — identical to the prod-web
half above. So the baseline's claim reproduces exactly: staging is not a source
of correct academy configuration, and "copy staging's ON set" ships a broken
product area, because
`FEATURE_FILM_ACADEMY_TOPICS_ENABLED`, `FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED`
and `FEATURE_FILM_ACADEMY_PILOT_DELIVERY_ENABLED` are **absent from staging's
`frontend-web` env as well**. The mobile-facing prod BFF answers **404** on all
three of these paths (§3.9, probed as a set today) — a missing route, not a
closed gate, and per the plan's rule a 404 says nothing about a flag.
**Target:** a decision per name in **Task 7
Step 5**, recorded in the flag file as an explicit `=false` unless promoted.

### 3.11 Full flag sweep (code-derived routes) — AS CAPTURED 2026-11-12

Figure as captured: `scripts/flagprobe.sh` (wrapper-aware) against
`www.spotlightng.com`, over all 45 names in `production-module-flags.env`:
**85 gated route lines → 48×503, 25×405, 1×401, 10 NO-ROUTE**. Of the 36
declared `true`, **28 answer 503 on at least one real gated route**, **7 resolve
to no `app/api` route at all** (`estate`, `healthLab`, `healthPharmacy`,
`healthVet`, `otpEmail`, `voteBridge`, plus the test-only
`VOTES_BRIDGE_ENABLED` — their sole reader `isModuleVisible` at
`frontend-web/src/server/modules/visibility.ts:59-66` has zero callers, so they
are inert in the web plane and no HTTP probe can prove them), and only
`FEATURE_REALTOR_ENABLED` is clean.
`FEATURE_UTILITY_BILLS_GO_PROXY_ENABLED` is **not** inert: it gates three real
routes through the `utilityGoProxyEnabled()` wrapper in
`app/api/v1/utility/_utils.ts:67`. That name is the reason the probe follows
wrappers at all — the sweep's **first, route-only draft** grepped `app/api` route
files and found nothing for it, so it mis-filed this flag with the inert seven.
Task 14's probe must keep the wrapper-resolution step (`_utils.ts` → the exported
helper's name → the route files that call it) or it reproduces that error and
reports a live gate as unprovable. Production therefore serves almost none of
the promoted modules today. **Target:** 503 must disappear for every flag with a
GET handler; the 7 inert names get recorded as "not HTTP-provable", not as
passing.

Why not re-measured here: neither half exists at the pinned SHA — checked with
`git ls-tree -r --name-only c49b395643473ba6ff7a225d7a7a339a41eddfe6 | grep -E 'flagprobe|production-module-flags'`,
which returns nothing. The probe script and the 45-name flag file are Task 14's
and Task 7's own outputs. Re-read by **Task 14** with `scripts/flagprobe.sh`,
whose full tally is recorded as a `## Task 14` section in §5's format — this row
stays as captured, so the before/after pair survives for Task 16's doc fix.

### 3.12 Backend Railway flags — AS CAPTURED 2026-11-12

Figure as captured: prod has 54 `FEATURE_*` (50 ON) vs staging 64 (62 ON) →
**12** staging-ON names not ON in prod. **Target:** flag-for-flag parity.

Why not re-measured here: both halves are Railway production reads. Re-read
command (**Task 13** owns the gap-closing; the count is confirmed there):

```bash
gh workflow run ops-railway-vars-list.yml --repo paymax2022/spotlight-latest1 -f environment=production -f service=backend
gh workflow run ops-railway-vars-list.yml --repo paymax2022/spotlight-latest1 -f environment=staging -f service=backend
```

The `environment=production` run enters the GitHub `Production` environment,
which has required reviewers — it parks until a named human approves. Never
approve one on someone else's behalf.

### 3.13 Backend non-flag keys — AS CAPTURED 2026-11-12

Figure as captured: prod is missing 5 names staging holds — `DOJAH_BASE_URL`,
`DOJAH_PUBLIC_KEY`, `R2_ENDPOINT`, `R2_BUCKET_NAME`, `QUIDAX_WEBHOOK_SECRET`
(plus `ADMIN_SIGNUP_CODE`, `AUTH_IDENTITY_CACHE_TTL_SECONDS`); prod holds 4
staging lacks — `CORS_ALLOW_ORIGINS`, `MAPLERAD_PROD`, `REDIS_PRIVATE_URL`,
`WS_TICKET_SIGNING_SECRET`. **Target:** decided per name, in **Task 12**.

Why not re-measured here: same Railway production read that parks. Names only
in this ledger, always; a value from either list is never printed, in a reply,
a commit or a log. Re-read with the two `ops-railway-vars-list.yml` dispatches
in §3.12.

### 3.14 `frontend-admin` prod — AS CAPTURED 2026-11-12

Figure as captured: lacks `PAYSTACK_PUBLIC_KEY` / `PAYSTACK_SECRET_KEY` that
staging holds; `WEB_API_BASE_URL=https://frontend-web-production-9259.up.railway.app`
while the public site is `https://www.spotlightng.com`. **Target:** **Task 13**.

Why not re-measured here: a Railway production read behind the same approval
gate:

```bash
gh workflow run ops-railway-vars-list.yml --repo paymax2022/spotlight-latest1 -f environment=production -f service=frontend-admin
```

### 3.15 Backups — doc statement RE-READ 2026-11-12 (local git)

```bash
git show c49b395643473ba6ff7a225d7a7a339a41eddfe6:docs/devops/backup-restore-runbook.md | sed -n '33,40p'
```

Observed: the runbook still says the scheduled-dump pattern is "**not yet
scheduled — no `render.yaml` cron or GitHub Actions job exists as of this
writing**" (§2, line 37 area). Unchanged from the baseline row.
**Target:** dump taken **and** restore rehearsed before any prod write —
**Task 3**.

---

## 4. The authority rule

A lane's colour is never evidence of what the site serves:
[`deployment-matrix.md`](deployment-matrix.md) names the authoritative path per
service, and verification is by served bytes — a green deploy proves delivery,
not serving. When this ledger and a config file disagree, the matrix wins.

---

## 5. Append format (Tasks 2–16)

Each task appends a section here, never edits an earlier measurement:

```markdown
## Task N — <title> (YYYY-MM-DD)

- **Probe:** `<exact command>`
- **Observed:** `<output, secrets masked to name + length>`
- **Expected before running:** `<the figure the plan stated>`
- **Verdict:** pass | fail | deferred-to-Task-M | blocked-on-<thing>
- **Drift vs baseline:** `<baseline §3.x figure → new figure>`
```

Rows that a task changes state here rather than deleting, so the "before"
survives for the parity guard in Task 9 and the final doc correction in Task 16.

---

## Task 2 — Authoritative pending-migration list (2026-11-12)

Owns the re-read deferred by §3.4 ("the **667** history-row count needs a
Supabase production read") and §3.5 ("Task 2 Step 6 produces the authoritative
pending set"). Tool: `scripts/db/list-pending.sh` + `scripts/db/test-list-pending.sh`,
both added this task, plus a `pending-list` Makefile target.

### 2.1 The classifier and its test (TDD order)

- **Probe:** `bash scripts/db/test-list-pending.sh` (run *before* the classifier existed)
- **Observed:** `bash: /tmp/spot-cutover/scripts/db/list-pending.sh: No such file or directory`
  then `FAIL: drop not flagged`, exit 1 — i.e. it failed on the assertion, not
  silently, which is the point of the `|| true` on the capture line.
- **Probe:** `bash scripts/db/test-list-pending.sh` (after writing the classifier)
- **Observed:** stdout `PASS`, stderr 0 bytes, exit 0.
- **Verdict:** pass

### 2.2 The refusal cases, each proven outside the test harness

Migrations dir = the branch's own `supabase/migrations`.

```bash
: > /tmp/empty_refuse.txt
bash scripts/db/list-pending.sh --remote /tmp/empty_refuse.txt --migrations supabase/migrations
# (a table whose every row is LOCAL-ONLY, i.e. Remote = ` `)
bash scripts/db/list-pending.sh --remote-table /tmp/alllocal_table.txt --migrations supabase/migrations
printf '2027-01-01\n' > /tmp/badline.txt
bash scripts/db/list-pending.sh --remote /tmp/badline.txt --migrations supabase/migrations
bash scripts/db/list-pending.sh --migrations supabase/migrations
```

- **Observed:** `refusing: remote version list is missing or empty` rc=2;
  `refusing: remote version list is missing or empty` rc=2 (the all-local-only
  table parses to zero applied); `refusing: remote list holds a non-14-digit line`
  rc=2; `refusing: no remote state given` rc=2. `make pending-list` with no
  variables also refuses with rc=2, so the target cannot false-green either.
- **Verdict:** pass — all four false-green paths exit non-zero.

### 2.3 Step 5 dispatches (read-only `mode=list`; no writer, no approval given)

```bash
gh workflow run ops-db-push.yml --repo paymax2022/spotlight-latest1 -f environment=staging -f mode=list
gh workflow run ops-db-push.yml --repo paymax2022/spotlight-latest1 -f environment=production -f mode=list
gh workflow run ops-db-push-scoped.yml --repo paymax2022/spotlight-latest1 -f mode=plan -f versions=20271408000000
```

- **Observed:** run **`43299937814`** (`Ops DB Push (manual)`, job
  `supabase list (staging)`) `completed/success`; run **`43299959109`**
  (`Ops DB Push (manual)`, job `supabase list (production)`) **`waiting`** — it is
  parked on the `Production` required-reviewer gate and was **left parked**; no
  `gh run approve` was run and none is recorded here, because no reviewer was
  asked. Run **`43299979306`** (`Ops DB Push (scoped)`, environment
  `production-db-scoped`, no reviewers) `completed/success`. All three at
  headSha `3654f6b3f` (the default branch, which still carries the two capture
  steps at `ops-db-push.yml:131` and `:146`).
- **Verdict:** deferred-to-a-human for the fresh prod table; prod numbers below
  come from the newest *successful* prod table that already exists.

### 2.4 The prod table actually classified, and its reconciliation

`42367077299` (`Ops DB Push (manual)`, `workflow_dispatch`, success,
2026-11-07T11:10:47Z, headSha `87b25a8ab`) — **five days stale as of this writing**.

```bash
gh run view 42367077299 --repo paymax2022/spotlight-latest1 --log \
  | awk -F'\t' '$2 == "Migration list (before)"' > /tmp/prod_table.txt
grep -c '|' /tmp/prod_table.txt
awk -F'|' '/`20[0-9]{12}`[ ]*\|/ { v = $2; gsub(/[` ]/, "", v); if (v ~ /^20[0-9]{12}$/) print v }' \
  /tmp/prod_table.txt | sort -u | wc -l
```

- **Observed:** 771 captured lines, 0 `UNKNOWN STEP`, 753 lines carrying a `|`;
  **663** applied versions parsed from column 2; **86** rows with an empty
  `Remote` cell (LOCAL-ONLY); **749** lines carrying a version token.
  This reproduces the plan's 663 / 86 / 749 triple from **one** run, which also
  settles §3.4's Task 16 note: plan line 310's "`42367077299`'s successor at that
  date" is that very run.
- **Probe (psql-side count, no-reviewer lane):** `gh run view 43299979306 --log | grep -oE 'remote history rows: [0-9]+'`
- **Observed:** `remote history rows: 667` on 2026-11-12 — identical to §3.4's
  2026-11-11 read, so prod's history had not moved in that day. **That inference
  did not survive the evening:** §1.4 records two more versions recorded at
  20:34:16–17Z and a fresh `mode=plan` read of **669** at 20:44:51Z. What the
  663-vs-667 reconciliation establishes still holds on its own terms — the gap is
  the date difference, not hidden applied-versions-without-files — but "has not
  moved" was a claim about a quiet system, and this system is not quiet.
- **Reconciliation:** 667 (psql, today) − 663 (table, 2026-11-07) = **4**, and the
  four are accounted for by the date gap §3.4 already records (663 → 667), not by
  hidden applied-versions-without-files. A same-date comparison is **not** available:
  it needs the parked run above approved. The "0 rows with a blank `Local`" claim
  in the plan holds on this capture (753 pipe-lines = 749 + header + separator +
  2 banner lines; every version line has a filled `Local`).
- **Verdict:** pass with a named caveat (stale source table).

### 2.5 Step 6 — the classifier against the release tree (R7 form)

`scripts/db/list-pending.sh` does not exist at `c49b39564` (that tree's
`scripts/db/` holds only `classify-pending-migrations.sh` and
`reconcile-pending.sh`), so the plan's `cd /tmp/rel && bash scripts/db/list-pending.sh`
cannot run. Command actually used — classifier from the cutover branch, migration
**files** from the pin:

```bash
git -c advice.detachedHead=false worktree add --detach /tmp/rel "$(cat /tmp/RELEASE_SHA)"
FILES=$(ls /tmp/rel/supabase/migrations/*.sql | wc -l | tr -d ' ')
bash /tmp/spot-cutover/scripts/db/list-pending.sh \
  --remote-table /tmp/prod_table.txt --migrations /tmp/rel/supabase/migrations > /tmp/pending.txt
echo "classifier exit=$?"; grep -c '^pending' /tmp/pending.txt; tail -1 /tmp/pending.txt
```

- **Observed:** `repo files at the release SHA: 751`; `classifier exit=0`;
  **88 pending**; `-- remote max applied: 20271073000000 | recorded: 663`;
  `above-max=70`, `below-max=18`, `NON-ADDITIVE=0`.
  Checks: `70 + 18 = 88` and `751 − 663 = 88`.
  Staging, same classifier against `/tmp/staging_table.txt` (run `43299937814`,
  745 recorded, max applied `20271402000000`): **6 pending**, exit 0 — that is
  Task 5's remaining work, not Task 6's.
- **Expected before running:** plan/brief Step 6 stated **87 = 69 above-max + 18
  below-max + 0 NON-ADDITIVE** on a 750-file tree.
- **Verdict:** pass.
- **Drift vs baseline:** §3.4 `87 → 88`, §3.4 files `750 → 751`. The +1 pending is
  exactly `20271408000000_preconsult_intake_schema_ui.sql` (above-max, additive),
  the file §3.4's arithmetic trap predicted the pin adds; the `below-max` set did
  **not** move (18 → 18).
- **Batch implication for Task 6 — and why every count in this paragraph must be
  re-read, never quoted.** Production has moved twice since the 2026-11-07 table
  this classifier read, and it is still moving while this plan is executed. The
  applies observable from this machine: a concurrent session ran
  `ops-db-push-scoped.yml` in `mode=apply` (run `43301433055`,
  2026-11-12T20:34:16–17Z, head `3654f6b3f`) and recorded `20271408000000` +
  `20271409000000`; `mode=plan` on production (run `43303287939`,
  2026-11-12T20:44:51Z) then measured **`remote history rows: 669`**; a third apply
  landed `20271410000000` and `mode=plan` in run `43311601255` measured
  **`remote history rows: 670`**. So the chain is `667 → 669 → 670`, and the §3.4
  figure of 667 is superseded twice over.

  Re-running the classifier over the *same pin tree*, adding the three versions
  named above to the applied set, gives the shape it prints today (measured,
  exit 0, `/tmp/pending_now.txt`):

  ```
  87 pending = 0 above-max + 87 below-max + 0 NON-ADDITIVE
  -- remote max applied: 20271410000000 | recorded: 666
  ```

  Three things follow, and the third is the one that changes Task 6's plan.

  1. **The 666 above is not 670, and the gap is closed exactly by two independent
     routes.** The capture can name 663 recorded versions; three more were named by
     today's run logs (`20271408000000`, `20271409000000`, `20271410000000`), so 666
     of prod's 670 are *identifiable* from this machine and 4 are not — those 4 are
     applies between 2026-11-07 and the 2026-11-11 read that reported 667, and their
     identities exist only in prod's history table. Hence `recorded: 666` and 87
     enumerable pending rows describe what a stale capture *can* list, not what is
     pending. The true count comes from the lane's own SQL instead: `mode=plan`
     measured `remote history rows: 670` and `local migrations still without a
     history row: 84` against the `3654f6b3f` tree, which holds **754** files, and
     `754 − 670 = 84` closes — meaning every recorded version has a file in that
     tree. The pin lacks exactly **3** of those 754 files, all three newer than the
     pin's own head (`comm -23` of the two `git ls-tree` sets):
     `20271408000100_module_readiness.sql`,
     `20271409000000_preconsult_intake_telemedicine_plane.sql`,
     `20271410000000_module_registry_add_ungated_surfaces.sql`. Two of those three
     *are* recorded in prod; the third is not (verified: the only runs carrying
     `20271408000100` died at the additive gate and never wrote history — §2.6). So
     recorded-with-a-file-at-the-pin = `670 − 2 = 668`, and
     **pending at the pin = `751 − 668 = 83`**, which is also `87 − 4` — the
     enumerable list over-counts by exactly the 4 unnamed applies. Two routes,
     same answer. What a fresh `mode=list` read is still needed for is
     *enumeration*, not the count: the 83 cannot be listed from this machine, and
     the run that would name them is parked on the `Production` reviewers (run
     `43299959109`) — a human action, not one this task may take.
  2. **Batch count is `ceil(83 / 12) = 7`.** That supersedes both the brief's "≈8"
     and an earlier line of this ledger, which subtracted 667 from 751: §3.4 forbids
     that subtraction because 751 is the pin's file count while 667 was production's
     row count on a different commit, so the difference mixes two trees. It happened
     to be close (84) and is still wrong by 1 — and note that `754 − 670 = 84` *is*
     a legal subtraction, because both numbers describe the `3654f6b3f` tree; it
     measures pending there, not pending at the pin. The `− 2` correction that turns
     84 into 83 lives entirely in route 1's `668`.
  3. **Every pending file at the pin now sorts BELOW production's max applied
     version.** The highest pending file at the pin is
     `20271407000000_reality_show_season_two.sql` (measured; the pin's newest file
     `20271408000000` is itself applied now), and prod's max applied is
     `20271410000000`, which has no file at the pin. `above-max` has gone from 70 to
     **0**, so a *bare* `supabase db push` at the pin would apply **nothing at all**
     — not "some of the backlog", none. Do not read that as "the push lane is
     harmless": `ops-db-push.yml:136` runs `db push --linked --include-all`, and
     `--include-all` is precisely the flag that ignores the version-ordering rule
     and sweeps every unrecorded local file. At the pin that is all 83 — this plan's
     backlog **plus** anything else a `3654f6b3f`-based checkout carries, which is
     why the `Production` lane (2 required reviewers) and not `db push` is the only
     broad route. This is the §3.4 hazard in its total form, and it is the reason
     Task 6 uses only the scoped lane's `--apply-one`-by-name and must re-derive its
     batches from a fresh capture, never from this paragraph.

### 2.6 Vocabulary: classifier, `_reusable-migration-guard.yml:102-104`, `ops-db-push-scoped.yml:152`

- **Probe:** read all three regexes; run the guard's and the classifier's against a
  relaxation fixture, and run each of the three against the full pending set.
- **Observed:** the guard's `DESTRUCTIVE` covers
  `drop (table|column|type|schema|database)`, `alter <token> drop`,
  `rename (column|to)`; `ALLOW` is the identical object-kind set
  `(policy|trigger|index|function|view|materialized view|publication|rule) … if exists`.
  The classifier keeps both verbatim (POSIX `[[:space:]]` instead of `\s`) and adds
  `domain|sequence`, `truncate` and `set not null` — i.e. it is a **strict superset,
  still in agreement** with the guard's shared core; the guard is the weaker of the
  two. Measured matrix (each string through both patterns, comment-stripped):
  `DROP TABLE` 1/1, `ALTER TABLE x DROP COLUMN y` 1/1, `RENAME COLUMN` 1/1,
  `TRUNCATE TABLE x` **1/0**, `SET NOT NULL` **1/0**,
  `DROP POLICY IF EXISTS` 0/0, a plpgsql function body 0/0
  (classifier hits/guard hits).
- **Three vocabularies, not two — and the strictest one is the prod writer.**
  `ALTER TABLE x DROP CONSTRAINT y` and `ALTER TABLE c ALTER COLUMN d DROP NOT NULL`
  score **0 for both** the guard and the classifier, because
  `alter[[:space:]]+[a-z0-9_."]+[[:space:]]+drop` cannot match a three-token form —
  `[a-z0-9_."]+` will not span `TABLE x`. But `ops-db-push-scoped.yml:152`, the
  gate the only production writer in this plan runs before it applies anything,
  adds `alter[[:space:]]+table[^;]*drop`, and `[^;]*` *does* span those tokens.
  Measured against the 88 pending files of the 2026-11-07 capture — and re-measured
  against the 87 enumerable today (§2.5), same result — guard fails 0, classifier
  prints `NON-ADDITIVE=0`, **the scoped lane refuses 4**:

  | version | line | statement the lane rejects |
  | --- | --- | --- |
  | `20271099000010` | :50 | `ALTER TABLE election_votes ALTER COLUMN candidate_id DROP NOT NULL` |
  | `20271099000020` | :43, :48, :56, :201 | `ALTER TABLE … DROP CONSTRAINT IF EXISTS …` (×4) |
  | `20271200000064` | :37 | `EXECUTE format('ALTER TABLE public.crypto_swap_orders DROP CONSTRAINT %I', c.conname)` |
  | `20271401000000` | :20 | `ALTER TABLE public.driver_documents ALTER COLUMN file_url DROP NOT NULL` |

  All four are still pending after the 2026-11-12 concurrent applies, so they are in
  Task 6's path. **This is not merely a red run.** The re-check (`:142`) runs before
  "Apply the selected versions one at a time" (`:227`), so a batch carrying any of
  these aborts with exit 1 and writes nothing — but `ops-db-push-scoped.yml` has
  **no override, force, or acknowledge input** (its `workflow_dispatch:` block
  offers `mode`, `versions` and `confirm`, and `confirm` is a *stricter* requirement
  — the typed `SCOPED` gate at `:219`, not an escape hatch), and `mode=plan` is
  gated by the *same* regex because the re-check at `:142` carries no `if:`. So a
  blocked version cannot even be inspected through this lane. The result
  is a **permanent dead stop for those four versions through the only production
  writer this plan can drive end to end** — not "fails, but fails safe". Sized
  against §2.5's 12-version batches, the four sit at enumerable positions 40, 41,
  63 and 81, so **at least three of the seven batches are unrunnable as planned**,
  and Task 6 as written would discover that only by dispatching a red production run.
  Re-runnable probe (from the pin tree, pending list from §2.5):

  ```bash
  cd /tmp/rel/supabase/migrations
  cut -d' ' -f3 /tmp/pending.txt | grep '\.sql$' | while read -r f; do
    bad="$(grep -inE 'drop[[:space:]]+(table|column|schema|database|type|domain|sequence)|truncate[[:space:]]|rename[[:space:]]+(to|column)|alter[[:space:]]+table[^;]*drop' "$f" || true)"
    [ -n "$bad" ] && { echo "LANE REFUSES $f"; printf '%s\n' "$bad"; done
  done
  ```

- **Ruling R10 — do not unify the three regexes; require the batch lists to name
  the relaxations.** Tightening the guard and classifier to match the lane (adding
  `drop[[:space:]]+(constraint|default|not[[:space:]]+null|identity)`) would make
  `NON-ADDITIVE` fire on this backlog, which the plan defines as a stop-event
  requiring those versions "rewritten as new additive files" — but these four are
  already applied on staging and already merged, so rewriting their history is not
  available; the change would block the cutover on a definitional disagreement
  rather than on a hazard. Loosening the lane to match the guard would weaken the
  only gate standing between `mode=apply` and production. So the divergence stands,
  deliberately, and is handled where it bites: **Task 6's per-batch list must carry
  a `constraint-relax lines in this batch` section produced by the probe above, and
  any batch containing one of the four versions above is dispatched only after that
  section has been read** (the reviewer of that batch decides, per case, whether the
  relaxation is intended — all four here read as drop-and-replace or as deliberate
  loosening, and none drops a column or a table). Recorded as a ruling, not as a
  fix: if this plan is ever re-executed against a tree where the four are still
  pending, the same probe re-derives them.
- **Amendment to R10 (Task 2 fix round 2) — the ruling as written named no action
  path, so Task 6 would hit the dead stop blind.** Reading the lane's own inputs
  (`mode` / `versions` / `confirm`, no force flag) and the ungated `:142` re-check
  that also fires in `mode=plan` shows R10's "the reviewer decides per case" cannot
  be executed as stated: there is nothing for the reviewer to approve *through*.
  The four versions therefore have exactly three routes, and choosing among them is
  **a user decision, not a ruling this task may make**, because two of the three
  cross an R2 boundary and the third changes the plan's declared scope:

  1. **Apply them with the `Production`-environment lane**
     (`ops-db-push.yml mode=push`, 2 required reviewers). This is the route the repo
     already has for non-additive DDL, and it is the only one that actually lands
     the four. Cost: `mode=push` runs `db push --linked --include-all`, which at any
     current head is a sweep of *everything* pending (83 files at the pin, §2.5) —
     not these four — and it needs two named humans to approve.
  2. **Amend `ops-db-push-scoped.yml:152`** so the reject set permits the
     idempotent re-create forms it currently swallows by accident — concretely
     `alter[[:space:]]+table[^;]*drop[[:space:]]+constraint[^;]*if[[:space:]]+exists`
     — and keep `DROP NOT NULL` rejected. That would unblock `20271099000020` only.
     Measured, not asserted: piping each pending file through the lane's reject
     pattern with that one alternative removed as an inverse filter changes the hit
     count only for `20271099000020` (4 → 0); the other three stay at 1, because
     `20271099000010` and `20271401000000` are blocked by a `DROP NOT NULL` and
     `20271200000064` by a `DROP CONSTRAINT` built through `format(...)` with no
     `IF EXISTS`. So route 2 unblocks one of four and cannot carry Task 6 alone.
     It weakens the only gate standing between a reviewer-less lane and production,
     so it is a policy change, not a fix: **and project memory records the owner's
     standing position against exactly this** — *"Do not reformat DDL or add a lane
     to get such a file past it"* (`prod-migration-apply-routes.md`, read as the
     owner buying the scoped lane's blunt grep *with* the no-human-gate choice).
     That position is memory, not repo evidence: no file in this tree states it
     (grepped for `reformat` / `add a lane` / `human gate` across `docs/devops/` and
     the lane — zero hits), so the user must confirm or overrule it rather than
     being quoted back to themselves.
  3. **Declare the four out of Task 6's scope** and ship the other 79, documenting
     the residual as a known prod/staging schema divergence. Each blocked file
     widens a constraint, so prod *stricter than staging* is a live failure mode —
     read from the files, not inferred:
     `20271099000010` drops `NOT NULL` on `election_votes.candidate_id`, which is
     what makes an abstention row writable (`:50`, after the `:46` guard proving the
     registry no longer needs it);
     `20271099000020` replaces three `elections` CHECKs (`:43/:48/:56`, each
     re-`ADD CONSTRAINT`d on the following line) and, at `:201`, drops
     `election_votes_election_id_voter_id_key` in favour of two **partial** unique
     indexes (`:202-205`), i.e. one vote per voter *or* per unit — without it prod
     rejects the second ballot;
     `20271200000064` re-writes `crypto_swap_orders_status_check` to add
     `'executing'` to the value list (`:48`), so prod without it rejects a swap in
     flight;
     `20271401000000` drops `NOT NULL` on `driver_documents.file_url` (`:20`) and
     replaces the `doc_type` CHECK on the next statement.
     So this route is only safe while every surface those four touch stays
     flag-off — voting abstentions, crypto swaps, driver documents — which is Task
     7's and Task 10's job, and makes route 3 admissible as a *sequenced* choice
     rather than a shrug.

  There is also a fourth thing the lane's own history already does: **split around
  the blocked version.** Runs `43308617765` (`versions="20271408000100
  20271410000000"`) failed while `43308955575` and `43309595782`
  (`versions="20271410000000"`) succeeded minutes later, so another session today
  got its clean version applied by dropping the blocked one from the batch. That is
  a *deferral mechanism*, not a remedy — it leaves the blocked file pending forever
  — but it is the pattern Task 6 must use so the 79 clean files are never held
  hostage to 4 blocked ones. Batches should therefore be built from a fresh capture
  **minus** any version the probe refuses, and the refused list carried into Task
  16's "what stays open".
- **The divergence is not hypothetical — it fired on live work today.** Run
  `43308617765` (`ops-db-push-scoped.yml`, dispatched 2026-11-12T21:16:29Z at head
  `3654f6b3f`, `versions="20271408000100 20271410000000"`) concluded **`failure`**
  at the additive re-check: `##[error]20271408000100_module_readiness.sql is not
  additive-only`. Reproduced locally from that commit's copy of the file — `:86`
  reads `ALTER TABLE public.platform_module_audit DROP CONSTRAINT
  platform_module_audit_action_check;`, one line, same statement, same shape as
  the four above. So another session's production write was refused by this gate
  roughly forty minutes before this paragraph was written, which is also proof the
  gate holds: it aborted at step `:142`, before `Apply the selected versions one at
  a time` at `:227`, and prod's row count did not move.
- Measured on the pin: 55 files contain `DROP CONSTRAINT`/`DROP NOT NULL` and
  **none** of them trips the guard or the classifier regex. That confirms the brief's
  claim that the four relaxation files an earlier draft flagged are things the repo's
  CI guard allows, and it also bounds it: 7 of today's 88 pending files carry such a
  line and classify `additive` (0 hits each), consistent with `NON-ADDITIVE=0`. The
  extra 3 of those 7 (no `ALTER TABLE` token on the *same line* as the `DROP` —
  grep is line-based, so `[^;]*` cannot reach back to the `ALTER TABLE public.x`
  that opens the statement on an earlier line) are `20271071000000` (:37),
  `20271099000002` (:6) and `20271400000100` (:7), each a
  `ALTER TABLE … \n DROP CONSTRAINT …` pair. The lane would accept them. That is
  the honest limit of the lane's regex: it is the strictest of the three, and it is
  still defeated by a line break.

- One known over-match, recorded rather than fixed: the three already-applied
  immutability guards (`20270192000000`, `20270217000000`, `20271038000000`)
  contain `BEFORE TRUNCATE ON …`, which this vocabulary would flag as
  NON-ADDITIVE if those versions were ever pending. They are recorded in prod, so
  the stop-event does not fire today; if a future pending set includes a
  `BEFORE TRUNCATE` guard, read it as a false positive before rewriting it.
- **Verdict:** pass.

### 2.7 Dead `--migrations` input: the classifier's own false green (fix round 1)

- **Probe:** run the classifier against three inputs it cannot actually sweep —
  a `--migrations` path that is not a directory, a directory holding no `.sql`, and
  a directory holding one unreadable `.sql` — each with a valid `--remote`.
- **Observed before the fix** (all three, exit **0**):

  ```
  refusing: nothing. Output was instead
  pending *.sql *.sql above-max additive
  -- remote max applied: 20270000000001 | recorded: 1
  list-pending.sh: line 45: [: *.sql: integer expression expected
  ```

  With no nullglob the pattern stays literal, so `basename | cut` yields `*.sql` as
  a "version", `sed` fails, its stderr leaks, `wc -l` counts the empty stream as 0
  and the file is printed as `additive`. The unreadable case is worse in kind: no
  garbage row at all, just `pending 20270000000050 20270000000050_x.sql above-max
  additive` — `sed: Permission denied` swallowed by the load-bearing `|| true`, so
  a file whose contents the tool never saw is certified clean. That is the exact
  silence-is-green failure §2.2 was written to eliminate, reintroduced one input
  over: the applied set was guarded, the tree being swept was not.
- **Fix:** `[ -d "$MIG" ]`, then a `shopt -s nullglob` array whose count is checked
  before it is expanded (bash 3.2 on macOS errors on `"${files[@]}"` under `set -u`
  when empty), then per file `[ -r "$f" ]` and a 14-digit shape check on the version
  prefix (it feeds the `-lt` ordering), and an assertion that `$hits` is numeric
  rather than a leaked error string. Every one of these refuses with exit 2.
- **Observed after the fix:** the same three probes print
  `refusing: --migrations '…' is not a directory`,
  `refusing: '…' holds no .sql migration files`,
  `refusing: cannot read '…'` respectively, each exit 2; `scripts/db/test-list-pending.sh`
  prints `PASS` (the unreadable case self-skips with a note when the user reads past
  mode bits, e.g. root).
- **No regression:** re-running the fixed classifier over the same pin tree and the
  same 2026-11-07 applied set yields a diff-identical 88-row pending list and the same
  summary line — the guards fire only on inputs that previously produced garbage.
- **Verdict:** pass (fix round 1).
