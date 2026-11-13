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
- The same lane then touched `20271410000000` twice more, and only one of those two
  wrote: `43308955575` (`21:18:30Z`) was a **`mode=plan`** run of
  `versions="20271410000000"` that read `remote history rows: 669`, printed
  `20271410000000: not recorded` and mutated nothing; `43309595782` (`21:22:19Z`)
  was the **`mode=apply`** run of that same version, which read 669 and `not
  recorded` before applying and then printed `local migrations still without a
  history row: 84` in its post-apply "Verify history rows and remaining pending"
  step. So `20271410000000` is recorded on production because of `43309595782`,
  applied by another session, and prod's pending at that tree is 84.
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
   history exactly. The two trees' file sets differ by three versions
   (`20271408000100`, `20271409000000`, `20271410000000`), and two of those three
   are recorded on prod while the third is not — so a Task 4 fresh-DB replay from
   the pin writes **751** history rows, prod holds **670**, and the overlap is
   **668**. Those three numbers, not one, are the divergence: the replay cannot
   reach 670 (it has no file for `20271409000000`/`20271410000000`), and prod
   cannot reach 751 (83 of the pin's files are still unapplied there). What the
   replay *does* prove is that the 668 shared versions replay cleanly.
2. Production's max applied is now `20271410000000`, above every file at the pin
   (whose highest is `20271408000000`, itself now applied). So the §3.4 below-max
   hazard is total: measured in §2.5, **all** remaining pending files at the pin
   sort below prod's max applied. §2.5 states what does and does not follow from
   that.
3. **Pending at the pin = 83**, closed two ways. The `mode=apply` run
   `43309595782` printed `local migrations still without a history row: 84` in its
   post-apply verify step, at the `3654f6b3f` tree, and my `mode=plan` read
   `43311344252` subsequently measured `remote history rows: 670` — with **754**
   files in that tree, `754 − 670 = 84` closes. That closure proves every recorded
   version has a file in that tree, so the only versions missing from the pin's
   tree are among its three absent files. Two
   of those three are recorded; `20271408000100` is not, because the only two runs
   that ever carried it (`43308617765`, `43311601255`) both died at the additive
   re-check before any write, and no other apply run names it. So
   `751 − (670 − 2) = 83`, and `84 − 1` (the still-pending `module_readiness`)
   agrees. Batches: `ceil(83 / 12) = 7`.
4. **Prod is a moving number, and this section is already a snapshot.** The chain
   this evening is `667 → 669 → 670`, each step a different session's write
   (`43301433055`, then `43309595782`), with my own successful count read
   (`43311344252`) landing inside eleven minutes of the last apply. Any task
   quoting a count must re-read, not quote here:

   ```bash
   gh workflow run ops-db-push-scoped.yml --repo paymax2022/spotlight-latest1 \
     -f mode=plan -f versions="20271410000000"
   # then, once completed:
   gh run view <run-id> --repo paymax2022/spotlight-latest1 --log \
     | grep -aoE 'remote history rows: [0-9]+|  2027[0-9]{10}: (RECORDED on remote \(may still be absent — the drift case\)|not recorded)' | sort -u
   ```

   One trap in that command, learned the hard way in the run above: **`mode=plan`
   is gated by the same additive re-check as `mode=apply`** — dispatching
   `versions="20271408000100"` failed at step 7 (`Re-check every selected file is
   additive-only`, file line `:142`) rather than answering
   whether the version is recorded. To be exact about the step graph: nine steps
   carry no mode condition — the two unnamed `uses:` steps (`:63` checkout, `:68`
   setup-cli) and the seven named ones (`:72` `:94` `:117` `:142` `:169` `:190`
   `:209`) — while `:245` runs under `!cancelled()` and only `:219`/`:220`,
   `:227`/`:228` and `:270-271` are apply-gated. `:142` is therefore **not** the
   only mode-independent step able to abort before the read-only count at `:169`
   prints: `:72` exits 1 on a missing `psql` or an unreachable pooler (`:75`,
   `:91`), `:94` on a missing secret or a staging project ref (`:97-99`, `:104`),
   `:117` on a non-14-digit or fileless version, an empty list or more than 12
   (`:124`, `:128`, `:134`, `:138`). Of those, only `:117` also varies with the
   versions named — and only by **identity and count**, never by what a file says.
   `:142` is the one step before `:169` that reads each selected file's DDL
   **contents**, so it is the only one that can refuse an otherwise well-formed,
   present migration; `:72` and `:94` fail identically for every dispatch. Verified
   from that run's log: it contains **no**
   `remote history rows:` line at all. So a version the gate blocks cannot be
   *inspected* through
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
> on this line.** Production has moved again: `remote history rows` is **670**
> (the `mode=plan` read `43311344252` at 21:33Z, after the `43309595782` apply
> took it from 669),
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
  20:33:13–20:34:21Z and a fresh `mode=plan` read of **669** at 20:44:51Z, and the
  evening did not stop there — `43309595782` applied `20271410000000` at 21:22:19Z
  and `43311344252` read **670** at 21:33Z. What the
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
  this classifier read, and it is still moving while this plan is executed. Every
  number below is attributed to the one step that printed it, because the two
  count-printing steps in that lane are not equivalent: `Prove the connection and
  read history state` (`:169`) runs in both modes and reads the count *before* any
  write, while `Verify history rows and remaining pending` (`:270-271`) is gated
  `if: ${{ always() && inputs.mode == 'apply' }}` and therefore prints the pending
  figure only *after* an apply. A `mode=plan` run cannot supply a pending count at
  all. The observed chain, run by run:

  - `43301433055` — `mode=apply`, head `3654f6b3f`, started 20:33:13Z, finished
    20:34:21Z: recorded `20271408000000` + `20271409000000`; `remote history rows:
    667` before, `local migrations still without a history row: 85` after.
  - `43303287939` — `mode=plan`, 20:44:51Z: `remote history rows: 669`.
  - `43308955575` — `mode=plan`, 21:18:30Z: `remote history rows: 669`, and
    `20271410000000: not recorded`. **Wrote nothing** (plan mode).
  - `43309595782` — `mode=apply`, 21:22:19Z: 669 before, applied
    `20271410000000`, then `local migrations still without a history row: 84`.
    **This is the run that moved prod to 670.**
  - `43311344252` — `mode=plan`, 21:33Z: `remote history rows: 670`, and
    `20271410000000: RECORDED on remote` — the read that confirms the apply landed.
  - `43311601255` — `mode=plan`, started 21:34:35Z, **failure** at step 7 at
    21:34:54Z (additive
    re-check of `20271408000100`): its log contains no count line whatsoever, so
    it is evidence only that the gate fires in plan mode (§1.4).

  So the chain is `667 → 669 → 670`, and the §3.4 figure of 667 is superseded twice
  over.

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
     pending. The true count comes from those two steps instead, each from the run
     that legitimately printed it: the post-apply verify step of `43309595782`
     gives `local migrations still without a history row: 84` against the
     `3654f6b3f` tree, and the read-only history step of `mode=plan` run
     `43311344252` gives `remote history rows: 670`. That tree holds **754** files
     and
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
  Four routes exist, and choosing among them is
  **a user decision, not a ruling this task may make**: routes 1 and 2 both write to
  production, which is R2's boundary (route 1 is covered by the rule rather than by
  R2's wording — see its own entry), and route 1 additionally needs a credential this
  machine does not hold. Route 3 edits a safety gate the owner has
  a standing position on, and route 4 narrows the plan's declared scope.

  1. **The documented host run, one file at a time** —
     `scripts/db/reconcile-pending.sh --db-url "$PROD_URL" --apply-one <version>
     --yes`, which is §5.3 of `docs/devops/academy-prod-migration-set.md:232-235`
     ("Same four commands with `--db-url \"$PROD_URL\"`, in order, stopping on the
     first failure") and the `--apply-one` recipe in
     `docs/devops/cloud-migration-reconciliation-runbook.md:138-141`. Verified in
     the script itself: `--apply-one` (`:35`, `:41`) guards only on `--yes`, runs
     the file through `psql "$DBURL" -1 -v ON_ERROR_STOP=1` (`:58`) and then books
     history with `supabase migration repair --status applied` (`:60`) — and there
     is **no additive regex anywhere in `reconcile-pending.sh`**, so none of the
     four is blocked
     here and no 83-file sweep is needed. This is the only route that lands all
     four *scoped*, which is why the ledger now lists it first. Its cost is the
     opposite kind: it is unguarded by construction (that is the point of the
     lane's grep), it runs as a human with the production DSN in hand, and **no
     production DSN exists on this machine** — `backend/.env` in the live repo
     resolves to `localhost`, `frontend-web/.env.local` to `127.0.0.1:54321/54324`,
     there is no root `.env`, `~/.supabase` holds only `telemetry.json` (243 B, no
     project ref), and the live repo's `supabase/.temp` holds only a 6-byte
     `cli-latest` version marker — no ref, no URL — and is absent entirely in the
     `/tmp/spot-cutover` and `/tmp/rel` trees. A targeted grep for the production
     project ref across those env files, `supabase/config.toml`, `~/.supabase` and
     `supabase/.temp` returns nothing. So this route requires the owner to supply
     the session-pooler URL. It is not one of R2's enumerated items — R2 lists
     "any prod `db push`", which route 2 is and route 1 is not (route 1 is a host
     `psql` plus `migration repair`) — but it writes production history and needs a
     credential this machine does not hold, so it still stops at the human. The
     plan's own closer warrant is line 52: the scoped lane "is the only prod DB
     writer this plan uses", which is exactly what choosing route 1 would change.
  2. **Apply them with the `Production`-environment lane**
     (`ops-db-push.yml mode=push`, 2 required reviewers). This is the automated
     route the repo already has for non-additive DDL. Cost: `mode=push` runs
     `db push --linked --include-all` (`ops-db-push.yml:136`), which at any
     current head is a sweep of *everything* pending (83 files at the pin, §2.5) —
     not these four — and it needs two named humans to approve.
  3. **Amend `ops-db-push-scoped.yml:152`** so the reject set stops treating the
     idempotent drop-and-recreate form as destructive — concretely
     `alter[[:space:]]+table[^;]*drop[[:space:]]+constraint[^;]*if[[:space:]]+exists`
     — and keep `DROP NOT NULL` rejected. That would unblock `20271099000020` only.
     Measured, not asserted: piping each pending file through the lane's reject
     pattern with that one alternative removed as an inverse filter changes the hit
     count only for `20271099000020` (4 → 0); the other three stay at 1, because
     `20271099000010` and `20271401000000` are blocked by a `DROP NOT NULL` and
     `20271200000064` by a `DROP CONSTRAINT` built through `format(...)` with no
     `IF EXISTS`. So route 3 unblocks one of four and cannot carry Task 6 alone.
     It weakens the only gate standing between a reviewer-less lane and production,
     so it is a policy change, not a fix: **and project memory records the owner's
     standing position against exactly this** — *"Do not reformat DDL or add a lane
     to get such a file past it"* (`prod-migration-apply-routes.md`, read as the
     owner buying the scoped lane's blunt grep *with* the no-human-gate choice).
     That position is memory, not repo evidence: no file in this tree states it
     (grepped for `reformat` / `add a lane` / `human gate` across `docs/devops/` and
     the lane — zero hits), so the user must confirm or overrule it rather than
     being quoted back to themselves.
  4. **Declare the four out of Task 6's scope** and ship the other 79, documenting
     the residual as a known prod/staging schema divergence. Each blocked file
     widens a constraint, so prod *stricter than staging* is a live failure mode —
     read from the files, not inferred:
     `20271099000010` drops `NOT NULL` on `election_votes.candidate_id`, which is
     what makes an abstention row writable (`:50`; the completeness guard that must
     pass first is the `NOT EXISTS` at `:47`, whose `WHERE` clause is `:46`);
     `20271099000020` replaces three `elections` CHECKs (`:43/:48/:56`, each
     re-`ADD CONSTRAINT`d on the following line) and, at `:201`, drops
     `election_votes_election_id_voter_id_key` in favour of two **partial** unique
     indexes (`:202-205`), i.e. one vote per voter *or* per unit — without it prod
     rejects the second ballot;
     `20271200000064` re-writes `crypto_swap_orders_status_check` to add
     `'executing'` to the value list (`ADD CONSTRAINT` at `:46`, the widened list
     at `:47`), so prod without it rejects a swap in flight;
     `20271401000000` drops `NOT NULL` on `driver_documents.file_url` (`:20`) and
     replaces the `doc_type` CHECK — drop at `:22-23`, the re-`ADD CONSTRAINT`
     statement at `:24-33` with its widened value list running `:27-33`.
     So this route is only safe while every surface those four touch stays
     flag-off — voting abstentions, crypto swaps, driver documents — which is Task
     7's and Task 10's job, and makes route 4 admissible as a *sequenced* choice
     rather than a shrug.

  Separately from those four routes, and not a substitute for choosing one, the
  lane's own history today shows a batch-construction rule Task 6 must adopt:
  **split around the blocked version.** `43308617765`
  (`mode=plan`, `versions="20271408000100 20271410000000"`, started 21:16:29Z)
  failed at the
  re-check — its dry run caught the gate before any write — and the same session
  then dispatched the clean version alone: `43308955575`
  (`mode=plan`) to see its state and `43309595782` (`mode=apply`) to write it,
  both of which succeeded minutes later. So another session today got its clean
  version applied by dropping the blocked one from the batch. That is
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

---

## Stage 1 — fresh replay (Task 4, 2026-11-12)

Owns the plan's Stage 1: prove the whole chain applies **in order from zero** and
passes the RLS gate, and hand Task 6 the `make rls-check` allowlist result that
prod's post-check is compared against. Scope was read-only + throwaway: no
`supabase db push` against any project, no `gh run approve`, no workflow
dispatched, no write to staging or prod. Every migration file came from
`/tmp/rel`, detached at `RELEASE_SHA`
`c49b395643473ba6ff7a225d7a7a339a41eddfe6` — `git -C /tmp/rel rev-parse HEAD`
printed that value before the replay (the implementer's record) and again after it
(§4.4's addendum, on the re-created tree).

**Which file every line number in this section belongs to:** `Makefile:…` cites are
the **pinned tree's** (`/tmp/rel/Makefile`), because that is the tree the replay
executed. Task 2's `pending-list` target was inserted on `feat/prod-cutover` *after*
`migrate-up`, so the two files agree up to `migrate-up` and diverge after it:
`Makefile:28` (`RLS_ALLOWLIST`) and `:93` (`echo "  applying $$f"`) are the same line
in both, while the pin's `:98/:99/:100/:103/:104` (drop → `$(MAKE) migrate-up` →
`$(MAKE) rls-check` → the `psql -tAc` probe → `from pg_tables t`) are `:101/:102/:103/:106/:107`
on this branch. Checked both ways 2026-11-13.

**Heading note (do not "fix" this to §5's template):** plan:451 and plan:497 ask
for this section by the literal heading `## Stage 1 — fresh replay`, while §5's
append format prescribes `## Task N — <title> (YYYY-MM-DD)`. The plan's wording
wins for the prefix, and the task number and date are carried in parentheses, so
both forms are satisfied by one heading; `4.x` sub-numbers follow the same
per-task convention Task 2's `2.x` sections use.

### 4.1 Step 1 — the CI lane's conclusion at the pin

- **Probe:**

  ```bash
  export RELEASE_SHA=$(cat /tmp/RELEASE_SHA)   # c49b395643473ba6ff7a225d7a7a339a41eddfe6
  gh run list --repo paymax2022/spotlight-latest1 --commit "$RELEASE_SHA" \
    --workflow integration-verify.yml --json databaseId,status,conclusion --jq '.[0]'
  ```

- **Observed (verbatim):** `{"conclusion":"success","databaseId":43272402964,"status":"completed"}`
- **Attribution** — `gh run view 43272402964 --repo paymax2022/spotlight-latest1
  --json databaseId,conclusion,status,createdAt,updatedAt,url,headSha,workflowName,displayTitle`:
  `headSha` = `c49b395643473ba6ff7a225d7a7a339a41eddfe6`, byte-equal to the pin, so
  this is the run §1's table row for `c49b39564` colours (there §1 recorded the
  conclusion; here it is the id). `workflowName` `integration-verify`,
  `displayTitle` `fix(health): run the telemedicine intake after payment (#992)`,
  created `2026-11-12T17:43:18Z`, last updated `2026-11-12T18:15:35Z`,
  [run 43272402964](https://github.com/paymax2022/spotlight-latest1/actions/runs/43272402964).
- **Step-level**, `gh api repos/paymax2022/spotlight-latest1/actions/runs/43272402964/jobs`,
  job `verify` (id `131372215625`, `success`, started `17:43:53Z`, finished
  `18:15:35Z`): each of the five replay-adjacent steps concluded `success` —
  `Start PostGIS service container (pull retried — Docker Hub rate limits)`,
  `Raise Postgres lock table (full-schema drop in migrate-reset)`,
  `Supabase-compat prelude (plain-Postgres shim)`,
  `Migrations apply cleanly (real Postgres)`,
  `Migration fresh replay from zero (clean-apply + RLS check)`.
- **Expected before running:** the brief's `"conclusion":"success"`; the
  stop-the-cutover branch (and its two remedies — a new additive migration, or an
  `RLS_ALLOWLIST` entry with written justification) was therefore not entered, and
  no migration file was edited.
- **Verdict:** pass.
- **What the green conclusion *alone* would not prove:** a lane report says it
  passed, not *what it applied*. That limit does not apply here, because the job log
  is retained and was read back (controller, 2026-11-13):
  `gh api repos/paymax2022/spotlight-latest1/actions/jobs/131372215625/logs --allow-escape-sequences`
  → 1,222,123 B / 7,758 lines, containing **1502** `applying supabase/migrations/…`
  lines — 751 × 2, because CI runs `make migrate-up` (step `:94`) *and then*
  `make migrate-reset` (step `:174`), which drops and re-applies the whole chain —
  reducing to **751** unique names (`grep -o … | sed … | sort -u`), whose md5
  `823d8cde1f335320d6a9cd3ab30aae17` is byte-identical to the local log-derived set
  in §4.2 *and* to the pin's tree listing (`comm` both directions → **0**), plus
  `rls-check ✓ — every public table has RLS enabled (allowlist: 'spatial_ref_sys')`
  and 4,174 `NOTICE` lines. So run `43272402964` **is** a second byte-level witness
  of the in-order 751-file replay, not merely a colour — which is what §4.5's
  "answered yes at the pin, twice" rests on. One earlier sentence of this section
  claimed the opposite ("prints no per-file tally … cannot be the file-count
  evidence") and was wrong: `Makefile:93` echoes `  applying $f` inside `migrate-up`,
  which `migrate-reset` calls at `Makefile:99`.
- **Durability caveat:** job logs expire on GitHub's retention schedule, so this
  corroboration is re-readable *now* and not permanent. `/tmp/replay-logs/replay.log`
  is the *local* counterpart — re-readable today, but it is not durable either: `/tmp`
  does not survive a reboot, and §4.4 forbids copying these captures into the repo
  because line 1 carries a connection string. So neither witness is permanent, and the
  honest reading of §4 is "verified from two independent sources on 2026-11-12/13",
  not "permanently on the record". Re-fetch the job (`gh api …/jobs/131372215625/logs
  --allow-escape-sequences`) before quoting §4.1 in a later task; if a later task
  needs a durable copy of the evidence, that is a decision for the user about where a
  credential-free extract may live — do not invent one.

### 4.2 Step 2 — the local replay, on the image and prelude CI uses

Name and port were checked free first, because this machine already runs this
repo's backend and a local Supabase: `docker ps --format '{{.Names}}'` held no
`prod-replay`, and `lsof -nP -iTCP:55433 -sTCP:LISTEN` returned nothing.
`new-api-1`, `supabase_db_spotlight` (:54322) and kong (:54321) were never
stopped, restarted, removed or pruned.

```bash
cd /tmp/rel
export POSTGRES_PORT=55433
# DATABASE_URL is `integration-verify.yml:43`'s job-env value with the host port
# swapped to ${POSTGRES_PORT} and nothing else changed; it is not pasted here,
# because this ledger carries no credential-bearing URLs. Verified 2026-11-13 by
# reading that line: user and database are both `paymax`, host is `localhost`,
# `sslmode=disable`, and the CI port is the container's 5432.
export DATABASE_URL="<that connection string>"
bash scripts/ci/start-postgres-service.sh postgis/postgis:17-3.4 prod-replay
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET max_locks_per_transaction = 512;"
docker restart prod-replay
# readiness wait — CI's own form is `integration-verify.yml:85`,
#   timeout 90 bash -c 'until pg_isready -h localhost -p 5432 -U paymax >/dev/null 2>&1; do sleep 1; done'
# this host has no `timeout`, so the bound became 90 counted iterations with
# `sleep 1`; it reported ready on the first probe.
pg_isready -h localhost -p ${POSTGRES_PORT} -U paymax
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/ci/supabase-compat-prelude.sql
make migrate-reset DATABASE_URL="$DATABASE_URL"   # full output → /tmp/replay-logs/replay.log
docker rm -f prod-replay
```

Two disclosed deviations, neither of which changes what was measured: (i) the
readiness wait keeps CI's bound (90) but not CI's wrapper: `timeout` is not on this
host (`which timeout` → not found, nor `gtimeout`), so the 90 became counted
iterations with `sleep 1` between probes, and it reported ready on the first probe.
The exact text the implementer typed is not recoverable — it left no script and died
before reporting — but CI's own line at `:85`, quoted in the block above, is the form
it deviates from, and nothing downstream depends on the difference: the first probe
already succeeded, and `start.log`/`alter.log`/`restart.log` record the container
state the wait was protecting; (ii) Step 2's `| tail -8`
became a full capture, because `tail -8` discards the very per-file tally the same
step requires recording. The last lines are quoted below either way.

Order was kept as CI keeps it for the setup half (`integration-verify.yml:62` →
`:83` → `:91` → `:174`): container → lock raise → restart → prelude →
`migrate-reset`. **One CI step was not replicated, and it changes what "from zero"
drops:** CI also runs `make migrate-up` at `:94` (`Migrations apply cleanly`), then
`make build` (`:96-97`), `make test` (`:101`) and the anti-skip canary (`:113`), then
`make tsc` (`:170-171`), and only at `:174` the reset. So CI's
`DROP SCHEMA public CASCADE` falls on a schema holding 751 migrations *plus test
fixtures* — its job log reads `NOTICE: drop cascades to 1656 other objects`, while
this local replay dropped a freshly-preluded schema and its `replay.log:2` reads
`drop cascades to 6 other objects`. The local run therefore exercised a **strictly
easier** drop path than CI's; the two "zeros" are not the same size. The NOTICE
totals line up the same way but only **approximately** — CI's log carries 4,174
against this replay's 2,089, and splitting the CI log at its own reset drop
(job-log line 4583) gives 2,092 before / 2,082 after, so neither half equals 2,089
and the "twice" is a shape, not an identity; the difference is unexplained here and
must not be quoted as evidence of anything. The restart is what makes the raise take
effect, and it did:
`show max_locks_per_transaction` read **512** afterwards, which is what the
`DROP SCHEMA public CASCADE` inside `migrate-reset` (`Makefile:98`) then ran
against. Whether the default 64 would actually have failed here was **not** tested
— that figure is CI's own claim (`integration-verify.yml:78-80`, "the
~400-migration schema blows the default 64"), and this replay inherited it rather
than re-measuring it, so do not quote §4.2 as evidence that the raise is required.

- **Observed, container:** `prod-replay is healthy (postgis/postgis:17-3.4)`; the
  script's pull printed `Digest: sha256:d0b5a6ecab18997637f55a83cb4a9467391de5645916cfa1b6f2a8d19eee7be5`,
  `Status: Image is up to date for postgis/postgis:17-3.4`; server
  `PostgreSQL 17.0 (Debian 17.0-1.pgdg110+1) on x86_64-pc-linux-gnu`.
- **Observed, prelude:** exit 0, 110 bytes on stderr — the single line
  `psql:/tmp/rel/scripts/ci/supabase-compat-prelude.sql:9: NOTICE:  extension "postgis" already exists, skipping`.
  The shim's surface was then present: schemas `auth`, `extensions`, `storage`;
  roles `anon`, `authenticated`, `service_role`, `postgres`.
- **Observed, replay:** `make migrate-reset` exit **0**; **751**
  `applying supabase/migrations/…` lines; then, verbatim from the log's tail:

  ```
  migrations applied
  /Library/Developer/CommandLineTools/usr/bin/make rls-check
  rls-check ✓ — every public table has RLS enabled (allowlist: 'spatial_ref_sys')
  ```

  Wall clock 56 s, read off the capture itself rather than off a stopwatch:
  `stat -f '%SB %Sm' -t '%Y-%m-%dT%H:%M:%S%z' /tmp/replay-logs/replay.log` → birth
  `2026-11-12T23:48:16+0100`, mtime `23:49:12+0100` (re-checked 2026-11-13, still
  56 s). `start.log` brackets it from `23:47:31`.
- **The count equality the brief asks for:** `ls supabase/migrations/*.sql | wc -l`
  → **751**, equal to the 751 applied lines. `ls supabase/migrations | wc -l` is
  also 751 and no entry is a non-`.sql` file, so the Makefile's `*.sql` sweep
  missed nothing. This agrees with §2.5's `repo files at the release SHA: 751` —
  and unlike every prod-side figure in this ledger, this one is commit-determined:
  `c49b39564…` cannot drift, so it needs no re-read before Task 6 uses it.
- **0-pending-equivalent** (applied set vs. tree, both sorted basenames): the
  implementer ran this over the two basename lists §4.4's addendum later finds left
  in `/tmp/replay-logs/` and reported `diff` → identical,
  `comm -23 files applied` → **0**
  (nothing on disk left unapplied), `comm -13` → 0 (nothing applied that is not on
  disk). Because those two files' provenance is undecidable (§4.4's addendum), the
  equalities were re-established against the **commit-determined** set instead —
  the re-created `/tmp/rel` listing versus the basenames parsed out of
  `replay.log` — and both `comm` directions are **0** there too. The set statement
  is what carries; which pair of files a `diff` happened to run over is not.
  0 duplicate `applying` lines (751 occurrences, 751 unique);
  first applied `20260101000000_enable_extensions.sql`, last
  `20271408000000_preconsult_intake_schema_ui.sql` — the pin's highest version, so
  the chain ran end to end in timestamp order.
- **Error scan:** `grep -cE "^psql:.*ERROR:|FATAL:" replay.log` → **0**. The only
  `ERROR` substring in the whole log is `ON_ERROR_STOP` on line 1, where make
  echoes its own `DROP SCHEMA` command — not a server error. The scan is
  corroborating, not load-bearing: each file is applied with
  `-v ON_ERROR_STOP=1` inside a `set -e` loop (`Makefile:92-95`), so the first SQL
  error aborts before `migrations applied` prints, and the sentinel printed.
- **Chatter, recorded rather than fixed:** 2089 `NOTICE` lines — the top five kinds
  being 1491 `policy`, 277 `trigger`, 93 `column`, 69 `extension`, 63 `relation` —
  i.e. the idempotency preambles (`DROP POLICY IF EXISTS`,
  `ADD COLUMN IF NOT EXISTS`), and exactly 1 `WARNING`, from
  `20260405200000_admin_role_setup.sql:119`:
  `created admin@spotlight.internal with a RANDOM password (app.super_admin_password was not set) - it cannot log in until a credential is set out of band`.
  A plain-Postgres-replay property (no GoTrue owns the credential); the random
  value is not recorded here and died with the container.
- **Client caveat:** the driving client is Homebrew psql `16.13` against the
  image's server `17.0`; CI drives the same server with the runner's client. The
  server judges the DDL, so the figure that would differ elsewhere is a version
  string, not the outcome. The client half is a live host read and re-checkable
  (`psql --version` → `psql (PostgreSQL) 16.13 (Homebrew)`, re-run 2026-11-13); the
  server half is in §4.4's not-re-measurable list, pinned only by the image digest.
- **Verdict:** pass — 751/751 applied, from zero, in order, no error.

### 4.3 The RLS gate, and exactly what the allowlist covered

- **Probe (the gate's own output):** `make rls-check`, run as the third command
  inside `migrate-reset` (`Makefile:100`).
- **Observed:** `rls-check ✓ — every public table has RLS enabled (allowlist: 'spatial_ref_sys')`,
  exit 0 — the same string CI's `Migration fresh replay from zero` step produced.
- **Coverage, measured against the replay database before it was removed.** The
  connection argument is written as `psql "$DATABASE_URL" -tAc …` below because that
  is what reaches the throwaway container (and what `Makefile:103` itself does);
  `psql -tAc …` with no argument would have queried the host's default cluster, not
  the replay. **The implementer recorded the queries without that argument and died
  before it could correct them**, so the four figures below are quoted as *what it
  reported from the container*, and the exact command line that produced them is not
  recoverable — see the addendum's "Not re-measurable" list in §4.4.

  ```bash
  psql "$DATABASE_URL" -tAc "select count(*) from pg_tables where schemaname='public';"
  # the rls-check predicate with its allowlist clause removed:
  psql "$DATABASE_URL" -tAc "select coalesce(string_agg(t.tablename, ', ' order by t.tablename),'(none)')
    from pg_tables t join pg_class c on c.relname = t.tablename
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where t.schemaname='public' and c.relrowsecurity = false;"
  psql "$DATABASE_URL" -tAc "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    and n.nspname = 'public' where c.relrowsecurity = true;"
  psql "$DATABASE_URL" -tAc "select count(*) from pg_policies where schemaname='public';"
  ```

- **Observed:** **1407** public tables; ungated = **1**, and its name is
  `spatial_ref_sys`; **1406** public `pg_class` rows carry `relrowsecurity = true`;
  **1974** policies in `public`.
- **Verdict:** pass.
- **Predicate mismatch to carry into Task 6, not discover there:** these counts walk
  `pg_tables` (`Makefile:104`), whose domain includes materialized views, foreign
  tables and partitioned tables, whereas Task 6's prod post-check (plan:665-667)
  enumerates `pg_class … and c.relkind = 'r'` — ordinary tables only. plan:662 calls
  these "the same predicate as `make rls-check`", and that is **not accurate**: the
  allowlist clause matches (`'spatial_ref_sys'` in both) but the population does not,
  so prod's row count is not comparable to 1407/1406 and a difference between them is
  **not** drift evidence. Anyone comparing the two must count under one predicate.
- **For Task 6 (the point of this section):** `RLS_ALLOWLIST` is
  `?= 'spatial_ref_sys'` (`Makefile:28`) and this replay needed **nothing beyond
  that one entry** — the PostGIS reference table owned by the extension, which the
  Makefile's own comment (`Makefile:25-27`) explains cannot take RLS. Prod's
  post-check is therefore compared against a list of exactly one table, and an
  ungated public table in prod with any other name is *not* explained by this
  replay.
- **Image and prelude, so nobody quotes the wrong failure:** this replay used
  `postgis/postgis:17-3.4` plus `scripts/ci/supabase-compat-prelude.sql`,
  mirroring `integration-verify.yml:62` and `:91`. **No vanilla `postgres:15` (or
  plain `postgres:17`) replay was ever run here, and one must not be quoted as a
  failure of this chain:** `20260101000000_enable_extensions.sql` runs
  `CREATE EXTENSION postgis`, which a vanilla image cannot satisfy — it dies on the
  first migration and proves nothing about the 750 behind it. One honest
  narrowing: `postgis/postgis`'s own entrypoint pre-creates `postgis` in
  `POSTGRES_DB`, which is what the prelude's `already exists, skipping` NOTICE
  measured — so "from zero" here means *fresh container plus
  `DROP SCHEMA public CASCADE`*, not an extension-free cluster. That drop cascaded
  to 6 objects (`postgis`, `postgis_topology`, `fuzzystrmatch`,
  `postgis_tiger_geocoder`, `pgcrypto`, `uuid-ossp`) and the chain re-created them:
  `postgis 3.4.3`, `btree_gist 1.7`, `pg_trgm 1.6`, `pgcrypto 1.3`, `uuid-ossp 1.1`
  were installed at the end. CI runs the same script against the same image and the
  same `POSTGRES_DB` default (`start-postgres-service.sh`'s `paymax`), so the same
  narrowing applies there too — read from the config, not observed on a runner, but
  it is parity rather than a divergence.

### 4.4 Teardown (Step 3)

- **Probe:** `git -C /tmp/rel status --porcelain | wc -l`, taken **before** the
  worktree went away.
- **Observed:** `0` — nothing in the pinned tree was modified or left untracked by
  the replay, i.e. no migration file was edited to buy the green.
- `docker rm -f prod-replay` → rc 0; `docker ps -a --format '{{.Names}}' | grep -i
  replay` → nothing, and `new-api-1` / `supabase_db_spotlight` were still listed as
  running afterwards. No volume was created, so none was removed.
- `git -C /Users/paymax/Documents/spotlight/main worktree remove /tmp/rel` → rc 0;
  `ls -d /tmp/rel` → `No such file or directory`. `git worktree list` afterwards
  printed 13 entries — the main tree `/Users/paymax/Documents/spotlight/main` plus 12
  others, **none** of them `/tmp/rel` (the cutover branch tree
  `/private/tmp/spot-cutover` remains). Treat that 13 as a timestamp, not a fact
  about the repo: this main tree is shared with concurrent sessions that attach and
  remove worktrees, so the count moves on its own. Two later re-reads, minutes apart,
  printed **18** (controller, `/tmp/rel` present again) and **20** (round-1 re-review)
  — which is the point of labelling it, not a contradiction of it. The
  load-bearing half of every reading is the same: `worktree list | grep -c /tmp/rel`
  is 1 while the tree exists and 0 after `worktree remove`. The main tree was only
  ever read: no
  rebase/reset/stash/checkout/clean, nothing staged there. `/tmp/rel` is removed
  here because Task 4 was its last consumer — Task 5 onward run the classifier
  from a repo root.
- **Controller addendum, same day, after the implementer's process died before it
  could report or commit.** On the teardown: my dispatch guardrail ("remove only
  what you created in this task") conflicted with the plan, and the implementer was
  right to follow the plan — plan:489 mandates it ("Task 5 onward run the classifier
  from the repo root, so this replay is the last thing that needs `/tmp/rel`"),
  plan:493 is the command, plan:510 expects `git worktree list` to show no
  `/tmp/rel`. Consequence: §4.2's tree-side claims were no longer checkable in
  place, so the tree was re-created at the pin
  (`git -C /Users/paymax/Documents/spotlight/main worktree add --detach /tmp/rel c49b395643473ba6ff7a225d7a7a339a41eddfe6`,
  rc 0, 11,192 files) and re-measured: `git -C /tmp/rel rev-parse HEAD` = the pin;
  `ls supabase/migrations/*.sql | wc -l` = **751**; highest version prefix =
  **`20271408000000`**; non-`.sql` entries = **0**. All three agree with §4.2, so the
  file-count evidence survives its own teardown. The applied set was then re-derived
  independently from `/tmp/replay-logs/replay.log`, which does survive:
  `grep -c "applying supabase/migrations/"` = **751**; the 751 basenames are **all
  unique**, 0 duplicates; first `20260101000000_enable_extensions.sql`, last
  `20271408000000_preconsult_intake_schema_ui.sql`; `comm -23` and `comm -13` of the
  log-derived set against the re-created tree's listing are both **0**;
  `grep -cE "^psql:.*ERROR:|FATAL:"` = **0**; `grep -c "NOTICE:"` = **2089**. Note
  the shape of the two 33,083-byte lists left in `/tmp/replay-logs/`
  (`applied.txt`, `files.txt`): they are byte-identical to each other **and** to a
  set re-parsed from the log's `applying` lines by a third, independent path — all
  three hash to `823d8cde…`. That equality is what a convergence proof looks like,
  and equally what a copied file looks like: content alone cannot tell them apart,
  and the implementer died before it could say which it did. So §4.2's convergence
  claim does not rest on either file; it is carried by the log-derived set above,
  computed without opening them.
  **Corroborated by surviving captures** — `/tmp/replay-logs/` holds six files
  besides the two lists, and they re-state part of §4.2 independently of any
  report: `start.log` (253 B: the pull, `Digest: sha256:d0b5a6ec…`, `prod-replay is
  healthy (postgis/postgis:17-3.4)`), `alter.log` (13 B: the `ALTER SYSTEM` command
  tag, i.e. the lock raise was accepted), `restart.log` (12 B: `prod-replay`),
  `prelude.log` (110 B: exactly the one `already exists, skipping` NOTICE quoted in
  §4.2), and `replay.rc` (`REPLAY_RC=0`, so `make migrate-reset`'s own exit — which
  is the exit of the `migrations applied` → `rls-check` sequence).
  **Caution about the capture directory:** `replay.log:1` is `make`'s own echoed
  command and carries the throwaway connection string **in clear**, including its
  password and host port, and `replay.log:68` names the generated
  `admin@spotlight.internal` address. The value is CI's local-service string from
  `integration-verify.yml`'s job env, not a staging or production credential — but
  these eight files live in `/tmp`, outside the repo, and must not be copied or
  committed into it. Quote line numbers from them; do not paste the lines.
  **Not re-measurable** — everything below was read inside the `prod-replay`
  container or from the first `/tmp/rel` tree, both gone, so each is a
  single-observation figure resting on the implementer's record alone, with
  `replay.log` as the only other witness where it carries the same line:
  §4.3's four coverage counts (1407 public tables, 1 ungated, 1406 with
  `relrowsecurity = true`, 1974 policies); the server string
  `PostgreSQL 17.0 (Debian 17.0-1.pgdg110+1) …` (the digest in `start.log` pins the
  image, so this is re-derivable from that image — but not the run's own read);
  the five installed extension versions (`postgis 3.4.3`, `btree_gist 1.7`,
  `pg_trgm 1.6`, `pgcrypto 1.3`, `uuid-ossp 1.1`); the
  `show max_locks_per_transaction` → **512** read (the statement that produced it
  survives in `alter.log`, its result does not); the shim's schema/role inventory
  (`auth`, `extensions`, `storage`; `anon`, `authenticated`, `service_role`,
  `postgres`); and `supabase_migrations` → 0 tables.
  The teardown `git -C /tmp/rel status --porcelain | wc -l` = **0** needs the same
  caveat, with one addition: it is a genuine witness that nothing in *the tree the
  replay ran in* was modified or left untracked, but it was taken once, by the
  process that died, and the re-created tree's clean status today is **not** that
  probe — a fresh `worktree add --detach` of an untouched commit is clean by
  construction, so re-running it now would print `0` whether or not the original
  replay ever edited a file. What the re-creation does restore is the file-set
  half (§4.2's `ls`, highest prefix, non-`.sql` count) and `rev-parse HEAD` = the
  pin; what it cannot restore is the working-tree state of the tree that was
  actually driven. `/tmp/rel` is
  **present again right now**, deliberately, so the task reviewer can verify §4.2 in
  place; Step 3's teardown is not cancelled and the tree must be removed once this
  task's review closes, before any prod write.
- **Teardown, executed 2026-11-13 after the round-1 re-review returned all findings
  addressed** (that sentence above is left as the implementer-era state it was, and
  this line is what closed it). Before removing: `git -C /tmp/rel status --porcelain |
  wc -l` → **0**, `git -C /tmp/rel rev-parse HEAD` → the pin,
  `ls /tmp/rel/supabase/migrations/*.sql | wc -l` → **751**. Then
  `git -C /Users/paymax/Documents/spotlight/main worktree remove /tmp/rel` → rc 0;
  `ls -d /tmp/rel` → `No such file or directory`;
  `worktree list | grep -c '/tmp/rel'` → **0**; `docker ps -a | grep -ci replay` →
  **0**. The entry count read **18** at that moment — down from the re-review's 20
  minutes earlier, which is the moving-count point made above, not a discrepancy to
  reconcile. Nothing in §4.2 or §4.4 now depends on that tree existing: every
  tree-side figure in it is re-derivable from `git ls-tree -r --name-only c49b39564…`
  against the main repo, and the pin cannot drift.

### 4.5 What this section is evidence of, and what it is not

- Stage 1's question — does the entire chain apply **in order from zero** and pass
  the RLS gate — is answered yes at the pin, twice: once by the lane (§4.1), once
  by a local replay whose applied-file set is provably equal to the tree (§4.2).
  Step 1's stop-the-cutover branch did not fire, so no migration is barred from
  prod on ordering grounds.
- **What that does not certify, and Task 6 must not borrow:** prod is not a fresh
  database. §2.5's classifier against the pin tree prints
  `87 pending = 0 above-max + 87 below-max + 0 NON-ADDITIVE`, and its third
  follow-on states the consequence: **every** pending file at the pin sorts **below**
  prod's max applied version (`20271410000000`), so all of the 83 files Task 6
  applies will land **out of timestamp order** — each will meet a database that had
  already recorded newer versions. That is the shape §2.5's superseded 88-file
  capture showed only for its 18 below-max files, and it is a shape no
  fresh-from-zero replay exercises: in the replay each file met only its own
  predecessors' output, whereas on prod each will meet a schema that has already
  recorded versions newer than itself. If one of them fails on prod, this section is
  not counter-evidence; it proves only that the chain has no order-from-zero blocker.
  (Those 83/87/18 figures are §2.5's to quote, and §2.5 says plainly that the
  0/87 print came from re-running the classifier over the pin tree with three
  versions added from run logs onto a **stale** 2026-11-07 capture — it describes
  what that capture *can* list, not what is pending now — so the shape above is a
  pointer, not a current count: Task 6 must re-derive it from a fresh
  capture-and-classify pair, and §2.5's "re-read, never quote" rule binds anyone
  reading §4.5 too.)
- **751 = 751 is a file-set proof, not a history-row proof.** The psql route
  inserts nothing into Supabase's migration history:
  `select count(*) from information_schema.tables where table_schema = 'supabase_migrations'`
  → **0** on the replay database. So "0 pending" above must not be read as
  prod-shaped evidence: that probe counts *tables*, so the replay database has no
  `supabase_migrations.schema_migrations` to be empty or full — nothing records what
  it applied, and prod's pending figure comes only from writes made by `db push` /
  the scoped lane.
  The legal form of that arithmetic is §2.5's **`751 − 668 = 83`**, where 668 is
  *recorded-with-a-file-at-the-pin*, not prod's raw row count — §3.4 forbids the
  naive `751 − (prod history rows)` subtraction outright (it mixes two trees), so
  do not form one from the 670 here. Task 6 re-reads pending with the §2.6
  classifier at its own time; §2.5's rule that these counts are re-read, never
  quoted, still holds, and its last capture had prod at 670 rows.
- What the replay does **not** cover, so no later task borrows it as if it did: no
  seed/bootstrap data beyond what the migrations themselves insert, no Go test
  suite, no type-check, no `supabase db push`, and no staging or production
  connection of any kind.

---

## Stage 2 — staging (Task 5, 2026-11-13)

Owns the runbook gate `cloud-migration-reconciliation-runbook.md:115`, whose full
text is two clauses: *"Only proceed to prod once staging reconciles to **0 pending**
with an empty diff."* Task 5's steps exercise only the first, and §5.7 names the
second as open. One mutating dispatch was made, against **staging** only (R2 puts
staging's `db push` in-plan and prod's outside it). No prod write, no `gh run
approve`, and no new prod read: the parked `43299959109` was still `waiting` at the
09:48:42Z listing taken before the dispatch.

### 5.1 Step 1 — staging's pending set, from Task 2's captured table

```bash
cd /tmp/spot-cutover
bash scripts/db/list-pending.sh --remote-table /tmp/staging_table.txt \
  > /tmp/pending_staging.txt; echo "classifier exit=$?"
grep -c '^pending' /tmp/pending_staging.txt
```

- **Observed:** exit **0**; **6** pending;
  `-- remote max applied: 20271402000000 | recorded: 745`. All six classify
  `above-max additive`: `20271403000000` `_crypto_watchlist_alerts_rls`,
  `20271404000000` `_group_pool_goal_details`, `20271405000000` `_consult_sessions`,
  `20271406000000` `_consult_slice2`, `20271407000000` `_reality_show_season_two`,
  `20271408000000` `_preconsult_intake_schema_ui`.
- **Expected before running:** no figure is predicted (the brief's point is a fresh
  read); §2.5 had already printed 6 against `/tmp/rel`. `745 recorded + 6 pending =
  751`, the pin's file count — that sums exactly only when every recorded version
  has a file in the tree, so it reads as a coherence check on this capture, not as an
  identity the classifier guarantees (§2.5's prod pair prints `663 + 88 = 751` for
  the same reason).
- **Verdict:** pass. Nothing destructive in the batch, and every one of the six sorts
  above *staging's* own max applied, so the push that follows runs in clean timestamp
  order.

### 5.2 Step 2 — prod's pending set, plus the proof the tree did not move

The brief's own failure mode here is a tree that moved between Task 2 Step 6 and
this step, so the comparison is made on the tree, not only on the count:

```bash
bash scripts/db/list-pending.sh --remote-table /tmp/prod_table.txt > /tmp/pending.txt
tail -1 /tmp/pending.txt; grep -c '^pending' /tmp/pending.txt
git diff --name-only c49b39564..HEAD -- supabase/migrations | wc -l
git ls-tree -r --name-only HEAD -- supabase/migrations | grep -cE '\.sql$'
```

- **Observed:** **88** pending, exit 0,
  `-- remote max applied: 20271073000000 | recorded: 663` — digit-for-digit §2.5's
  Step 6 result. `git diff --name-only c49b39564..HEAD -- supabase/migrations` →
  **0** files, and this tree holds **751** `.sql` migration files.
- **Consequence for R7:** the branch tree is file-identical to the pin under
  `supabase/migrations/`, so running the classifier from `/tmp/spot-cutover`
  reproduces §2.5's `/tmp/rel` form without re-creating a worktree §4.4 removed. R7
  is satisfied by that equality, not by re-checking out the pin.
- **Staging ≤ prod**, as the brief requires (6 ≤ 88): staging was ahead of prod by
  construction and Stage 2 needed no re-plan.
- **Verdict:** pass. **Drift vs §2.5:** none — which is the *tree* agreeing. The
  count is stale against **prod**, and §5.6 says what that costs Task 6.

### 5.3 Step 3 — the one write dispatch, and why it applied nothing

```bash
gh workflow run ops-db-push.yml --repo paymax2022/spotlight-latest1 \
  -f environment=staging -f mode=push -f confirm=PUSH
gh run watch 43404389720 --repo paymax2022/spotlight-latest1 --exit-status
gh run view 43404389720 --repo paymax2022/spotlight-latest1 --log \
  | awk -F'\t' '$2=="Apply migrations (db push)"'
```

- **Observed:** run **`43404389720`** (`supabase push (staging)`) dispatched
  2026-11-13T09:48:49Z at headSha `1f7de771e`, `completed/success`, attempt 1,
  `gh run watch --exit-status` rc 0. Its push step ran
  `supabase db push --linked --include-all`, printed `Connecting to remote
  database...` and then **`Remote database is up to date.`** — zero files applied.
  `grep -ci 'rerun with --include-all\|to be inserted before'` over the log → **0**,
  so this is *not* the brief's `--include-all` no-op mode; the CLI genuinely found
  nothing pending.
- **Root cause, measured rather than assumed:** staging had already been reconciled
  eleven and a half hours earlier by a concurrent session. `db-migrate.yml` run
  **`43319774515`** (event `push`, branch `staging`, headSha `623c7c128` — *"chore:
  promote main to staging — pre-consult intake telemedicine plan…"*, **not** an
  ancestor of `origin/main`, 754 migration files) ran the same
  `supabase db push (staging)` job at 22:25:35Z. Its `Apply migrations (db push)`
  step listed nine files at the `Do you want to push…` prompt and then applied all
  nine between 22:26:52Z and 22:27:09Z before `Finished supabase db push.`: §5.1's
  six, plus `20271408000100_module_readiness.sql`,
  `20271409000000_preconsult_intake_telemedicine_plane.sql` and
  `20271410000000_module_registry_add_ungated_surfaces.sql`.
- **Probe-shape trap to carry into Task 6:** the pattern that counts applies in the
  CI replay lane and in `Makefile`'s `migrate` echo — `applying supabase/migrations/…`
  — returns **0 hits** on a `db push` log, because the Supabase CLI prints
  `Applying migration <basename>.sql`. Reading a `db push` log with the wrong
  pattern yields a false "nothing applied"; both shapes were run against
  `43319774515`'s log to show the difference (0 vs 9).
- **Ruling R14 — `--ref` left unset, exactly as the plan writes it, so this push's
  checkout was the default branch `1f7de771e`, not the pin.** The plan's Step 3 command carries
  no `--ref`, and `workflow_dispatch` therefore runs the default branch. Cost of
  keeping it: staging applied nine files where the pin had six — a **superset**, so
  every file Task 6 will put on prod has now executed under `db push` against a live
  non-customer database, which is exactly what Task 5's *Produces* claims. The
  alternative (dispatching `--ref c49b39564…`) would have left staging **behind**
  prod's already-recorded `20271409000000`/`20271410000000`, breaking the
  staging-ahead-of-prod invariant the gate depends on.
- **Verdict:** pass **as a confirmation, not as the reconciliation** — see §5.7 for
  what that distinction does and does not license.

### 5.4 Step 4 — 0 pending, read from the remote this run addressed

Re-read from the two capture steps of the push run itself, never from
`/tmp/staging_table.txt` (a 2026-11-12 20:24Z capture, now known to be stale):

```bash
gh run view 43404389720 --repo paymax2022/spotlight-latest1 --log \
  | awk -F'\t' -v want='Migration list (before)' '$2==want' | sed 's/\x1b\[[0-9;]*m//g' \
  > /tmp/staging_before.txt        # and the same for '(after)' → /tmp/staging_after.txt
rm -rf /tmp/mainhead && mkdir -p /tmp/mainhead \
  && git archive origin/main supabase/migrations | tar -x -C /tmp/mainhead
bash scripts/db/list-pending.sh --remote-table /tmp/staging_before.txt \
  | grep -c '^pending' || true     # repeat for /tmp/staging_after.txt, and with
                                   # --migrations /tmp/mainhead/supabase/migrations
```

- **Observed:** both captures are **758** pipe-lines and classify identically —
  **0 pending**, exit 0, `-- remote max applied: 20271410000000 | recorded: 754`.
  Against the pin tree (751 files) **and** against `origin/main`'s tree (754 files,
  exported with `git archive` rather than a worktree, so nothing was added to
  `git worktree list`): **0 pending** either way. `754 recorded` with 0 pending over
  a 754-file tree means staging's applied set and `origin/main`'s file set are the
  same set.
- **Expected before running:** `0`, and `recorded:` equal to the repo's file count.
  Both halves hold, on the head tree exactly (`754 = 754`) and on the pin tree in
  the direction that matters (`0` pending of 751).
- **Verdict:** **pass on the clause Task 5 defines** — staging is at 0 pending on a
  fresh remote read. The runbook sentence pairs that with "an empty diff", which no
  step in this task (or this plan) measures; §5.7 carries it as open rather than
  letting this verdict absorb it.
- **Drift vs §2.5:** staging `recorded 745 / max 20271402000000 / 6 pending` →
  `recorded 754 / max 20271410000000 / 0 pending`.

### 5.5 What staging's new shape means for prod

- Staging's max applied is now `20271410000000`, **the same version prod already
  holds** (§1.4's `667 → 669 → 670` chain ended there), while staging records 754
  rows against prod's last read of 670 — that read is twelve hours older than this
  write and concurrent sessions keep moving it, so it is a reading, not a constant.
  Staging is still ahead by volume, which is the invariant Task 6's batches are
  sequenced against.
- The three post-pin versions now have **both** a history row and a file on staging,
  because its checkout came from `623c7c128`/`1f7de771e` (754 files). That is the
  mirror image of §1.4's identifiability gap on prod, where two of those three
  (`20271409000000`, `20271410000000`) hold rows but have no file at the pin and the
  third, `20271408000100`, holds neither. Nothing here repairs prod's gap; Task 6's
  arithmetic stays §4.5's `751 − 668 = 83`.
- Task 4's Stage 1 proved the chain applies **in order from zero** on a psql route
  with **no** history table (§4.5). This is the first evidence in the plan of those
  same files landing under `db push`, i.e. with `supabase_migrations` rows written.
  The two are complementary, and neither substitutes for the other.

### 5.6 `/tmp/pending.txt` is Task 6's declared input and it is stale

Step 2 re-derived `/tmp/pending.txt` and it holds **88** rows classified against a
capture of prod taken **2026-11-07** (`recorded: 663`). Prod has since moved to 670
history rows with max applied `20271410000000`. So:

- The file is a valid classifier output over a valid pin tree; it is **not** the
  batch list. `list-pending.sh` cannot know that, and neither can a task that
  quotes its count.
- Task 6 Step 1 must re-dispatch a prod `mode=list` (or `mode=plan`) capture and
  re-classify before composing any batch; §2.5's "re-read, never quote" and §4.5's
  pointer-not-count warning both bind here. §3.4's ban on subtracting across two
  captures is unchanged.

### 5.7 What this task did not do, and the gaps it leaves

- **No staging dump preceded the write.** The brief's line 3 asks for the
  dump-before-reconcile habit on this database because it is the shared local-dev
  target. The dispatch applied zero files, so there was nothing to restore into and
  no `pg_dump` was taken. **The habit is still owed:** any *later* staging push in
  this plan that is not a no-op must be dumped first, and a task that skips that
  because "Task 5 did" is reading the wrong lesson. (Taking a dump also needs a
  credential route this session has not established — the staging DB password lives
  in Actions secrets, masked as `***` in every log above and never printed here.)
- **The reconciliation was executed by another session's lane, not by this plan.**
  `43319774515` closed staging's gap at 22:26Z on 2026-11-12; this task's dispatch
  confirmed the resulting state. That is disclosed rather than claimed, and it is
  why §5.4's proof reads the remote rather than trusting either run's conclusion.
  The corroboration rides on GitHub log retention for `43319774515`.
- **The runbook's second clause — "an empty diff" — was not measured.** Task 5's
  four steps prove the history table agrees (0 pending, both captures). They do not
  prove the *schema shape* agrees: no `supabase db diff` was run, and neither push
  lane asserts one — `grep -n -i 'drift\|db diff'` over `ops-db-push.yml` hits only
  the header comments (`:4`, `:5`, `:15`, which warn that a drifted remote makes
  `push` fail) and over `db-migrate.yml` only comments at `:4` and `:9`. A local diff
  would also need a credential route this session has not established. So the gate
  Task 6 reads is **half-proven by this plan**, and the honest reading of §5.4's
  verdict is "0 pending, confirmed; empty diff, unmeasured". If a prod write later
  fails with an already-applied collision, this is the clause that went un-checked.
- **Nothing was written to prod**, nothing was approved, and the parked
  `43299959109` is untouched. `origin/main` had moved on its own before this
  dispatch: main is now `1f7de771e` (committed 08:56:44Z today), **13 commits** ahead
  of the pin with 0 merge commits on the first-parent path, 11 of them newer than the
  `3654f6b3f` checkout Task 2's captures ran against. That is why §5.3's push applied
  a superset, and it is what Task 11 (deploy `RELEASE_SHA`) and Task 16 (docs
  correction) each have to reckon with — the pin is a deliberate hold-back, not an
  accident of timing.

---

## Task 7 — production module-flag source of truth (2026-11-13)

Creates `frontend-web/config/production-module-flags.env`, the file Task 8's
cPanel lane installs and Task 9's CI guard compares against. Three commits on
`feat/prod-cutover`, none pushed: `d791ca88e` (76 lines, the deliverable),
`01cc80c20` (the gate-surface figure, 78), `bcd91b3c7` (four comment
inaccuracies the review found, 90). A push of anything under `frontend-web/**`
**is** a production release, so this waits for Task 8's consumer.

### 7.1 The declared set, re-derived the day it is quoted

- **Probe:** names only, never values —
  `railway variables --project e7dca861-3667-4d9a-8090-6d2f4d179ec2 --environment staging --service frontend-web --json`
  piped through a `str(v).lower()=="true"` filter, intersected with the
  `envFlag('…')` names at `origin/main`.
- **Observed:** staging's `frontend-web` env holds **97** keys, **52** of them
  valued `true`; the code reads **45** names; `52 ∩ 45 = 36`, which equals the
  file's `=true` count exactly. **16** staging-ON names are not web-BFF names
  and were dropped — the implementer's report says 6 (`task-7-report.md:151`),
  and 6 is wrong; the arithmetic is `52 − 36 = 16`.
- **Expected before running:** 36 true / 9 false / 45 declared, per the brief.
- **Verdict:** pass, and re-derivable today rather than inherited from a note.
- **File shape:** 90 lines = 44 comment + 1 blank + 45 directives; zero CR,
  zero duplicate keys, one trailing newline.

### 7.2 Parity holds across a `main` move, and both directions are empty

`origin/main` moved from `1f7de771e` to `be9b7eac5` while this task ran.

- **Probe:** `git rev-parse <sha>:frontend-web/src/lib/feature-flags.ts` for
  both, and `comm -3` of the file's directive names against HEAD's `envFlag` set.
- **Observed:** identical blob `91d0038e5` at both SHAs, so the 45-name set did
  not move. `comm -23` (in file, never read) = empty; `comm -13` (read, not
  declared) = empty. No dead wiring, no undeclared gate.
- **Verdict:** pass. Task 9's guard must re-run this extraction on every merge;
  a name that only ever appears in `feature-flags.ts` proves the file cannot
  silently lose it.

### 7.3 A probe trap that will bite Task 9: `frontend-web/src/app` is a symlink

`ls -ld frontend-web/src/app` → `lrwxr-xr-x … src/app -> ../app`. The routes
live in `frontend-web/app/api`; `frontend-web/src/app` is an alias. Recursion
treats them differently:

| Command | Result |
| --- | --- |
| `grep -rn 'featureFlags' frontend-web/src` | **17** lines |
| `grep -rn 'featureFlags' frontend-web/src/app/api` | **413** lines / 184 files |
| `find frontend-web/src -name route.ts` | **1** |
| `find frontend-web/app/api -name route.ts` | **595** |

Both halves are real: `grep -r` does not descend a symlink it *discovers* while
recursing, but the kernel resolves a symlink named directly in the operand. So
walking `src` sees almost nothing, while `src/app/api` sees the whole tree. This
looked like fabricated tool output and was chased down precisely because a
superset cannot be smaller than its own subset — it is not, the two commands
walk different trees.

- **Consequence for Task 9:** a parity guard that enumerates gated routes by
  walking `frontend-web/src` will find ~1 route file and can assert anything it
  likes. It must either walk `frontend-web/app/api` or resolve the alias first.
- **Gate surface measured (this replaces the brief's unsourced "~46 gated route
  groups"):** 46 accessors in `feature-flags.ts` (45 via `envFlag('NAME')`, plus
  `tierLimits` via `envFlagDefaultTrue`), 595 `route.ts` under `app/api`, 184 of
  them referencing `featureFlags`, 221 lines pairing `503` with "not available".

### 7.4 7 of the 36 `=true` names gate nothing in the web plane

- **Probe:** per-accessor call-site counts over `app` **and** `src`, plus
  `requireFeature('…')`, plus a repo-wide `isModuleVisible` caller search.
- **Observed:** `estate` 0, `healthLab` 0, `healthPharmacy` 0, `healthVet` 0,
  `otpEmail` 0, `voteBridge` 0, `votesBridge` 0 — and `isModuleVisible`,
  defined at `src/server/modules/visibility.ts:59`, has no caller outside its
  own file. Controls from the same sweep: `restaurant` 24 call sites, `wallet` 7
  plus 2 `requireFeature('wallet')`. Matches ledger §3.11's independent list.
- **Why this is in the file and not just here:** the header claimed "`=true` is
  a module production serves". For these 7 that is unfalsifiable by HTTP, so
  Task 14's flagprobe would read a legitimate "no route" as a failed gate and
  send an operator hunting a route that was never meant to exist. The header now
  states the caveat and points at §3.11; §3.11's "inert in the web plane"
  standing is unchanged.
- **Verdict:** pass with the caveat committed. These 7 accessors are real dead
  code, outside this task's scope, parked for the final review.

### 7.5 The academy `=false` decision is now measured, not asserted

The brief asserted `503 / 503 / 200` on both planes from code reading. Read-only
`GET`s today:

| Path | prod `www.spotlightng.com` | staging `frontend-web-staging-new.up.railway.app` |
| --- | --- | --- |
| `/api/academy/exams` | **503** `Assessments are not available yet` | **503** same body |
| `/api/academy/topics` | **503** `Topic learning is not available yet` | **503** same body |
| `/api/academy/apply` | **200** `success:true`, Batch A - 2026 | **200** `success:true`, Batch B - 2026 |

- **Verdict:** pass. The academy *application* plane is live everywhere and the
  *assessment/topics* plane is dark everywhere, so declaring the trio `=false`
  records today's truth; flipping it is a product decision, not a migration
  side effect. Note `staging.spotlightng.com` does not resolve (curl `000`) —
  staging's frontend is the Railway domain above, and a probe that guesses the
  hostname reports a false outage.

### 7.6 What Task 7 did not re-measure

"`production`'s runtime env held exactly four keys" is quoted from §3.7/§3.8,
captured 2026-11-12 from deploy run `43037664704`. It was **not** re-read today:
that needs a prod dispatch, which is R2. The header now says so explicitly
instead of letting "Before 2026-11-12" read as a closed outage — as of this
write it is still the live state, and Task 8's lane is what changes it.

### 7.7 Carry into Task 8

- Task 8's validator regex run against this file today: bad-line list empty,
  `flags: on=36 off=9 declared=45`, and the `on >= 30` floor passes at 36.
- Step 3 base64-appends the **whole file, comments included**, so **44** prose
  lines will land in a `chmod 600` host file. `@next/env` ignores `#` lines, so
  runtime behaviour is unaffected, but §3.8's env-inventory greps will start
  counting them — expect 44 more lines there and do not read that as drift.
- Parse by name, not by prefix: a lane that filters `^FEATURE_` silently drops
  `VOTES_BRIDGE_ENABLED` and `FEATURE_CHECKOUT_TOPUP_TIER0` (no `_ENABLED`
  suffix). Both are declared here and both must ride.
- §3.8's warning about that deploy log (`:640-647`) applies to Task 8 Step 4:
  the raw `gh run view … --log` echoes the publishable Supabase key verbatim, so
  only the value-stripping `grep -aoE` forms are safe.

---

## Task 8 — the cPanel lane installs those flags (2026-11-13)

**Status: the lane change is written, locally proven and committed but NOT
pushed.** Steps 4 and 5 need a deploy, and a push to `spotlight-latest` `main`
triggers one — R2. Edit lives on branch `ops/prod-module-flags`, commit
`5355d93`, worktree `/tmp/t8-lane` (added from `/tmp/sl-lane` off
`origin/main` = `54db5b0`, 2026-11-13T08:32:52Z). Base file `.github/workflows/
deploy-cpanel.yml`: one job `deploy`, 11 steps → 13, +29 lines, one file.

### 8.1 Step 1 is a real failing test, and all four branches fire

The brief calls the validator "the failing test — run it before the lane
change". Run locally against a checkout that matches `spotlight-latest`
`main` today, then against Task 7's committed blob, then against two poisoned
files:

| Case | Input | Observed | exit |
| --- | --- | --- | --- |
| A | file absent (current `spotlight-latest`) | `::error::config/production-module-flags.env is missing — the prod runtime would carry zero FEATURE_* and every gated BFF route would 503.` | **1** |
| B | `bcd91b3c7`'s blob, 45 directives | `flags: on=36 off=9 declared=45` | **0** |
| C | 3 directives (`2 true`, `1 false`) | `flags: on=2 off=1 declared=3` then `::error::only 2 flags declared ON — production would 503 most modules.` | **1** |
| D | `FOO=1` and `BAR="true"` present | lists `2:FOO=1`, `3:BAR="true"` and refuses | **1** |

- **Expected before running:** A exits 1 with that message; B prints exactly
  `flags: on=36 off=9 declared=45`. Both hold. C and D prove the two guards
  are not decorative — the `on >= 30` floor is what converts "the flag file
  shipped empty or stale" from a silent outage into a red deploy.
- Case B's input was taken from `git show bcd91b3c7:…` and confirmed
  byte-identical to the worktree copy, so the proof runs against the committed
  artifact rather than a draft.
- **Verdict:** pass.

### 8.2 The transport claim, read from the source instead of paraphrased

The plan justifies the single-line base64 with "the shapes the vendor's
line-splitting exit-code guard breaks". `appleboy/ssh-action@v1.2.0` turned out
to be a thin wrapper (`entrypoint.sh:70` runs `drone-ssh` v1.8.0), so the real
mechanism is in that project, `plugin.go:240-265`:

- `strings.Split(cmd, "\n")` when `ScriptStop` — every newline is a boundary.
- each line is `strings.TrimSpace`'d and empties dropped, so indentation
  inside a literal vanishes.
- after every line **not** ending in a backslash, it injects
  `DRONE_SSH_PREV_COMMAND_EXIT_CODE=$? ; if [ $… -ne 0 ]; then exit $…; fi;`.
- the elements are then re-joined with `\n` and streamed as **one** payload
  (`plugin.go:134`) — so the claim is not "each line is a separate SSH command".
  It is the injected guards and the trimming that destroy a multi-line literal,
  and the backslash continuation is what lets the existing 5-line `printf` block
  at `:412-417` survive.

That distinction matters for Task 11/13, which also write host files: a
multi-line heredoc fails here for the reason above, not for the reason the plan
gives.

Replayed the transform over the edited step and checked the result:

- **Probe:** substitute `${{ … }}` with fake values plus the real base64
  payload, apply the split/trim/guard algorithm, then `bash -n`.
- **Observed:** 80 raw script lines → **133** elements; the `base64 -d` append
  stays **one** element (`6104` chars, no embedded newline) with exactly one
  guard injected after it; `bash -n` on the host payload **exit 0, clean**.
- `6104` chars is one argument against Linux's `MAX_ARG_STRLEN` of 131072 —
  about **21×** margin. The 44 comment lines Task 7's header now carries ride
  inside that payload; they are inert to `@next/env` but they do inflate it.
- **Verdict:** pass. This is the strongest pre-deploy proof available without
  touching the host; Step 4 remains the real test.

### 8.3 Does the flag file even reach `spotlight-latest`?

It is absent there now (`git cat-file -e origin/main:frontend-web/config/
production-module-flags.env` → fatal, path does not exist; `frontend-web/config/`
does not exist at all in that repo, whose `frontend-web/` has `app`, `lib`,
`components` as top-level dirs). It arrives via `sync-frontend-web.yml`, which
was read rather than assumed:

- `rsync -av --exclude=".git" source/frontend-web/ destination/frontend-web/`
  with **no `--delete`** — an overlay that does create new directories, so
  `config/` will be made.
- `git -C destination add -A -- frontend-web` stages it, and the route-shadow
  step only inspects paths matching `frontend-web/app/*`, so a `config/` path
  is skipped, not deleted.
- Tested the ignore question directly in the destination worktree (copied the
  file in, then removed it): `git check-ignore -v` → **exit 1** (not ignored)
  and `git add -An` → `add 'frontend-web/config/production-module-flags.env'`.
  `frontend-web/.gitignore` mentions only `/tsconfig.tsbuildinfo` for config-ish
  names.

- **Verdict:** pass — the sync path can deliver the file, so the validator will
  not be permanently unsatisfiable.

### 8.4 Landing order, because `deploy-cpanel.yml` fires on every push

`on: push: branches: [main]` (`:27-29`) plus `concurrency:
group: deploy-cpanel-main / cancel-in-progress: true` (`:37-39`). So *any* push
to `spotlight-latest` main is a production deploy, including the sync lane's
merge commit, and a second push cancels a deploy already in flight.

| Order | What runs | Result |
| --- | --- | --- |
| flag file first, lane edit second | deploy A = old lane (no validator) writes 4 keys, prod unchanged; deploy B = new lane, file present | **two green deploys, no red run**, prod updated by B |
| lane edit first | deploy A = new lane, file absent → validator exits 1 | **red deploy A**, but it fails at step 6 of 13, before the upload at step 9, so nothing reaches the host and the previous build keeps serving; deploy B then passes |

- Recommendation: the first order. It is safe either way because the validator
  sits after the build and before the upload — that placement is what makes a
  missing file a no-op rather than a half-deploy — but it avoids a red run and
  a misleading failure in the deploy history.
- Whichever order is chosen, **do not push while a `deploy-cpanel` run is in
  flight**: `cancel-in-progress: true` can abort a deploy between the upload and
  finalize, which is exactly the partial state the lane's own route-cache purge exists to clean.
- **Verdict:** deferred-to-user — the pushes themselves are R2.

### 8.5 The outage this task fixes is live as of today

Read-only `GET`s against production on 2026-11-13, taken before any deploy so
Step 5's post-deploy comparison has a real baseline:

| Path | Code | Body |
| --- | --- | --- |
| `/api/v1/restaurant/00000000-0000-0000-0000-000000000000` | **503** | `Restaurant delivery is not available.` |
| `/api/v1/wallet/balance` | **503** | `Wallet feature is not available.` |
| `/api/v1/events` | **503** | `Events are not available.` |

- Step 5 expects the first of these to become **401** `Unauthorized` after the
  deploy — gate passed, auth refused. Still 503 ⇒ the flag block never reached
  the runtime env, and Step 4's probe re-read is the next thing to look at, not
  the lane.
- **Verdict:** pass as baseline. This is a current measurement, so §3.7/§3.8's
  "exactly 4 keys" is confirmed to still describe live production.
