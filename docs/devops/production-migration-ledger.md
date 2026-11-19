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

**How the production schema gets written, as of PR B (`release.yml`).** The `db push`
applies recorded below were produced by `db-migrate.yml` firing on a push to `main` (or by
an operator dispatch). From `release.yml` onward, an automatic production apply is
`release.yml`'s `migrate-production` job — which runs *before* `deploy-production` and only
after `smoke-staging` has confirmed staging is serving the new commit. Both routes call the
same `_reusable-db-apply.yml`, so there is one apply path per database and one Supabase CLI
pin (`2.114.0`) writing it; `db-migrate.yml` survives as the operator tool for a dry run or a
one-off apply. Two consequences that this ledger's earlier rows did not have to care about:

- **A rollback applies nothing.** `release.yml` passes `skip_apply` when the dispatched ref
  is not `main`'s tip, and a `db push` of an older `supabase/migrations/` tree against a
  remote holding newer versions aborts anyway. So the row-count deltas recorded below no
  longer move backwards when a release is rolled back — read "deployed commit" and "applied
  migrations" as two separate facts from here on.
- **`--include-all` is staging-only, by construction.** `db-migrate.yml`'s production caller
  hardcodes it off; an unattended `--include-all` against production is how a superseded
  migration gets applied out of order. It remains available to an operator dispatch on
  staging.

---

## 1. The pin, and how it was chosen

Plan: `docs/superpowers/plans/2026-11-12-staging-to-production-migration.md`
Tasks 4, 11, 12 and 14 ship exactly this SHA; no later task re-picks it.
The plan file was not in the tree at `RELEASE_SHA`, and it is on `origin/main` now: PR #1028's squash
`2e200094b74450a40aa0a5bc276d666421fc848b` added it, `git log --format=%h --reverse … -- <path>` naming
that commit as the only adder among its 16 files / 5,490 insertions. An earlier draft of this paragraph said
the opposite — "still is not on `origin/main` … it resolves from `feat/prod-cutover`", with a pointer to
"why that branch is not pushed" — and was falsified twice over by the merge it was written before: the
branch *was* pushed (draft PR #1028) and *was* merged, so the path resolves from `main` for every reader.

The rule applied: the newest `origin/main` SHA whose **`ci.yml`**
(`CI — CLAUDE.md gates`) **and** `integration-verify.yml` (`integration-verify`)
runs both concluded `success`. `CI (Zero-Billing Optimized)` (`ci-optimized.yml`)
is recorded too, but it is not the deciding lane. (That sentence is about *this* rule for choosing a
`RELEASE_SHA`; it says nothing about which checks block a merge, and the two are not the same set — §6.8.)

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
# mode=plan is not enough on its own: the lane's `Validate the version list` step
# refuses an empty input (`::error::versions is empty.`) and it runs BEFORE the
# `remote history rows: $total` print in `Prove the connection and read history
# state (read-only)`. An empty `versions` therefore aborts the job one step short
# of the number this row exists to re-read. Cite these lane steps by name: the
# line numbers moved when the read-only `RBAC grant probe` step and its
# `rbac_expect` input were added, and they will move again.
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
`www.spotlightng.com`, over all 45 names in `production-module-flags.env`: **85 gated
route lines → 48×503, 25×405, 1×401, 10 NO-ROUTE** (the four buckets total 84; the capture does not record the 85th line's class). Of the 36 declared `true`, **28
answer 503 on at least one real gated route**, **5 resolve to no `app/api` route at
all** (`estate`, `healthLab`, `healthPharmacy`, `healthVet`, `otpEmail` — their sole
reader `isModuleVisible` at `frontend-web/src/server/modules/visibility.ts:59-66` has
zero callers, so they are inert), and **2 are provable by an HTTP flip** (403 while
off, not 200): `FEATURE_VOTE_BRIDGE_ENABLED` is read directly at
`app/api/v2/votes/wallet/route.ts:78`, and `VOTES_BRIDGE_ENABLED` at runtime by
`isBridgeEnabled()` in `src/server/voting-bridge/feature-flag.ts:14`. Only
`FEATURE_REALTOR_ENABLED` is clean. The old "inert seven" was wrong because the Task
14 probe follows `featureFlags.X(` accessors and `requireFeature('X')` but neither direct
`process.env.FEATURE_*` reads nor helpers a route calls (`isBridgeEnabled()`). `FEATURE_UTILITY_BILLS_GO_PROXY_ENABLED` is **not**
inert: it gates three real routes through the `utilityGoProxyEnabled()` wrapper in
`app/api/v1/utility/_utils.ts:67`. That name is why the probe follows wrappers — the
**first, route-only draft** grepped `app/api` route files, found nothing, and
mis-filed it with the inert names; Task 14 must keep the wrapper-resolution step
(`_utils.ts` → helper name → caller routes) or it reports a live gate as unprovable.
Production therefore serves almost none of the promoted modules today. **Target:**
503 must disappear for every flag with a GET handler; the 5 inert names get recorded
as "not HTTP-provable", not as passing.

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

### 2.6 Vocabulary: classifier, `_reusable-migration-guard.yml:102-104`, the scoped lane's additive re-check

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
  `[a-z0-9_."]+` will not span `TABLE x`. But the scoped lane's
  `Re-check every selected file is additive-only` step — the gate the only
  production writer in this plan runs before it applies anything —
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
  3. **Amend the scoped lane's `Re-check every selected file is additive-only` step** so the reject set stops treating the
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
  Against the pin tree (751 files) **and** against `origin/main`'s tree (754 files
  as captured on 2026-11-13 — `origin/main` counts **755** at its 2026-11-14 tip
  `31505cb92`; the added file is `20271411000000_reconcile_doctors_presence_backfill.sql`,
  landed by `8ed8123de`, so this equality is a capture, not a standing property.
  See §16.1.),
  exported with `git archive` rather than a worktree, so nothing was added to
  `git worktree list`): **0 pending** either way. `754 recorded` with 0 pending over
  a 754-file tree means staging's applied set and `origin/main`'s file set were the
  same set **as captured on 2026-11-13** — at `origin/main`'s 2026-11-14 tip that
  sentence is already false (`755` files, so the same read would be `754 recorded`
  against a 755-file tree, i.e. one pending). It is a capture, not a standing
  property; re-run before anyone acts on it.
- **Expected before running:** `0`, and `recorded:` equal to the repo's file count.
  Both halves held, on the head tree exactly as captured (`754 = 754`, and `754 ≠ 755` at today's tip) and on the pin tree in
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

### 7.4 5 of the 36 `=true` names gate nothing in the web plane

- **Probe:** per-accessor call-site counts over `app` **and** `src`, plus
  `requireFeature('…')`, plus a repo-wide `isModuleVisible` caller search.
- **Observed:** `estate` 0, `healthLab` 0, `healthPharmacy` 0, `healthVet` 0,
  `otpEmail` 0, `voteBridge` 0, `votesBridge` 0 — and `isModuleVisible`,
  defined at `src/server/modules/visibility.ts:59`, has no caller outside its
  own file. Controls from the same sweep: `restaurant` 24 call sites, `wallet` 7
  plus 2 `requireFeature('wallet')`. Matches ledger §3.11's independent list.
- **Accessor counts, not route-reader counts:** a zero `featureFlags.X(` call site does not mean
  no route reads the name — two of the seven reach an `app/api` route (`FEATURE_VOTE_BRIDGE_ENABLED` directly,
  `app/api/v2/votes/wallet/route.ts:78`, 403 while off; `VOTES_BRIDGE_ENABLED` via `isBridgeEnabled()`,
  `feature-flag.ts:14`); `isModuleVisible`'s zero callers makes the other five inert.
- **Why this is in the file:** the header claimed "`=true` is a module production serves"; for the five that is
  unfalsifiable by HTTP, so Task 14 would misread "no route" as a failed gate. The header now points at §3.11.
- **Verdict:** pass with the caveat committed. The five inert accessors are real dead code, outside this task's
  scope; the two the earlier draft filed here are live, so §3.11 and Task 14 must probe them.

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

**Status as written (2026-11-13): the lane change is written, locally proven and
committed but NOT pushed.** Steps 4 and 5 need a deploy, and a push to
`spotlight-latest` `main` triggers one — R2. Edit lives on branch
`ops/prod-module-flags`, commit `5355d93`, worktree `/tmp/t8-lane` (added from
`/tmp/sl-lane` off `origin/main` = `54db5b0`, 2026-11-13T08:32:52Z). Base file
`.github/workflows/deploy-cpanel.yml`: one job `deploy`, 11 steps → 13, +29
lines, one file.

**Status re-read 2026-11-16: Steps 1-4 are done and Steps 4-5's push half is
closed.** The branch was pushed and PR #91 squash-merged into destination
`main` as `42789f45b` (15:01:54Z, still that repo's main tip); its
push-triggered cPanel run `43892014887` completed `success` with
`Validate the production module flags before they reach the host` printing
`flags: on=36 off=9 declared=45` and `Finalize on server` appending the decoded
block at `deploy-cpanel.yml:454`. Step 5's host re-read is the only open half,
and it splits in two — the file-side check is already readable from the **next**
dispatch's probe step at no code cost, while the process-env check cannot be
closed by any dispatch, because nothing in the lane greps `FEATURE_*` on the box.
§16.2 row 6 carries both halves with their line citations.

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
- **Order re-read 2026-11-16: the recommended order is the order that happened,
  and it bought what it predicted.** The flag file reached destination `main` a
  day before the lane edit, via the sync merge `cd2709b` (`gh api
  "repos/paymax2022/spotlight-latest/commits?path=frontend-web/config/production-module-flags.env"`
  → one commit only, `cd2709bd8 2026-11-15T15:51:11Z merge: update frontend-web
  from spotlight-latest1`);
  the lane landed as `42789f45b` at 15:01:54Z. Every `deploy-cpanel` run on
  2026-11-15/16 — `f88aa621e`, `34ac7affb`, `42789f45b` and the five before them
  — reads `success`: zero red deploys, so the validator never had to fail a run
  for a missing file. The `cancel-in-progress` warning still stands for the next
  push; nothing here proves it was hit, and nothing here proves it was avoided
  by care rather than by spacing.

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

---

## Task 9 — the CI guard so parity cannot silently reopen (2026-11-13)

Commits `0a7f499df` → `9067198f4` → `51fb4938a` → `6879e1c53` → `638329796` on
`feat/prod-cutover`. Delivered: `scripts/ci/check-prod-flag-parity.sh`,
`scripts/ci/test-prod-flag-parity.sh`, the `prod-flag-parity` job in `ci.yml`
plus its entry in the three deploy `needs:` lists, and `make flag-parity`.

### 9.1 The figures the guard asserts, re-derived rather than trusted

**Probe:** `grep -oE "envFlag\('[A-Z0-9_]+'\)" frontend-web/src/lib/feature-flags.ts | sed "s/envFlag('//;s/')//" | sort -u | wc -l`, and the same set `comm`-ed against the flag file's keys.
**Observed:** 45 derived names · 45 declared keys · `comm -23` empty · `comm -13` empty.
**Expected before running:** the brief's `45 flags declared (36 on, 9 off)`.
**Verdict:** pass — and the agreement is real, not two failures cancelling: an empty `comm` in both directions is what makes `✓` mean something.

The regex cannot match `envFlagDefaultTrue('X')` (it needs a literal `(` straight after `envFlag`, and there is a `D` there), so `tierLimits` at `feature-flags.ts:110` is outside the guard **by design**: `envFlagDefaultTrue` returns `true` when the var is unset (`feature-flags.ts:31-36`, measured not assumed), so an undeclared name there is served ON — it is not the silent-503 class this job exists to catch. Writing it into the file would change no behaviour and would make the count 46.

### 9.2 TDD evidence

- **Red, before the check script existed:** `FAIL: undeclared flag not named`, exit 1 — exactly the failure the brief predicted, because the test captures the missing script's stderr into `$TMP/out`, so case 1's *naming* assertion fires before its *exit* assertion.
- **Green:** `PASS` then `prod-flag-parity ✓ — 45 flags declared (36 on, 9 off)`.
- **Bite, on a copy only** (never the committed file): `UNDECLARED in /tmp/parity…/bitten.env: FEATURE_WALLET_ENABLED (write =true to serve it, =false to refuse it)` + `prod-flag-parity ✗ — 1 drift(s)`, exit 1; `git status` on the committed file stayed empty afterwards, and the copy was deleted.
- The brief's Step 5 said to run this in `/Users/paymax/Documents/spotlight/main`. It could not be run there at the time: Task 7's flag file was not yet on `main` (branch-only, R2 — it has been on `origin/main` since the 2026-11-15 squash merge `2e200094b`), and `main` is a dirty tree shared with live sessions. The byte-identical file on this branch is the same artifact under test.
- Modes set to `755` to match every other `scripts/ci/*.sh` (`git ls-files -s` shows `100755`).

### 9.3 Why this guard is not exposed to the symlink trap (R17)

It derives names by grepping **one real file**, `frontend-web/src/lib/feature-flags.ts`. R17's blind spot only bites a recursive walk that *discovers* `frontend-web/src/app` as a symlink, so `grep -rn … frontend-web/src` reporting 17 lines instead of the 184 gated route files does not apply here — and the guard never needs the route files, because the accessor file is where the gate surface is *defined*. A guard that had instead crawled `frontend-web/src` for gated routes would have shipped a green check over 184 unguarded files.

### 9.4 What the guard does NOT see — read this before believing it

| Not covered | Why | Who covers it |
| --- | --- | --- |
| Host ↔ file drift (cPanel `.env.production.local` differing from the committed file) | The guard compares the file to the **code**, never to a running host. | Task 8's inline validator in `deploy-cpanel.yml`, which runs at the moment the file is written to the host. |
| `envFlagDefaultTrue` names | Absent means ON, so there is no 503 to catch. | None needed; recorded in the script's comment so a later reader does not "fix" it. |
| `envFlag("DOUBLE_QUOTED")` or `envFlag(variable)` call shapes | Measured: the real file has none — every accessor is a single-quoted uppercase literal, including the two-term `fx` accessor. A future shape change would silently shrink the list. | `test-prod-flag-parity.sh` cannot detect it; the post-pipeline empty-name check catches only the all-or-nothing case. |
| Whether the deploy actually happened | It is a structural gate, not a probe. | Tasks 8 Step 5, 11, 14. |

### 9.5 Four fix rounds, and what each one proved

The task review returned **Approved, zero Critical, zero Important** (two reviewers, independently). Every round beyond that was driven by Minor findings, and two of them were real holes in my own fix:

1. `9067198f4` — guarded the name interpolations (`[A-Z0-9_]+` or refuse) because `--live` and the flag file are caller-supplied text and a metacharacter inside `^${name}=(…)` **false-passes**; added a `[ -s "$FLAGS" ]` guard; anchored case 2 on the summary line.
2. `51fb4938a` — the re-review *measured* that round and found three defects: a `--flags` file that exists but matches no `envFlag` still aborted with **zero bytes of output** (grep's exit 1 propagating through `pipefail`); the new `$FLAGS` guard fired on the `--live` path, where the accessor file is never opened, breaking the suite outside the repo root; and **case 6 was a false test** — it asserted `no-such.ts`, which the *pre-fix* script already printed via grep's own error line. Fixed all three and added cases 7-8, plus a CI step that runs the suite, since nothing had ever executed it.
3. `6879e1c53` — replaced `|| true` with a probe before the pipeline (one `|| true` cannot distinguish grep exit 1 from exit ≥2, which is precisely how a half-read accessor file becomes a short list that passes); made `BAD gate name` name its real source (`$FLAGS` was the truthful label where `$LIVE` is a deleted temp path); added case 9 pinning the `--live` path from a tree with no `frontend-web/`, because the relocated guard is inert in every CI run.
4. `638329796` — `DEAD wiring:` blamed `feature-flags.ts` even when the caller supplied `--live` and no accessor file had been opened; both legs now report `LIVE_SRC`, leaving the default-path text byte-identical. Restored the post-pipeline empty-list check the probe cannot see (GNU grep on binary input answers `-q` yes while `-o` emits nothing), and corrected the comment that claimed pipefail would catch a read error — the probe catches it one line earlier.

Rounds 1-3 each got a scoped re-review; round 4 is a one-variable message fix verified directly (suite `PASS`, default run `✓ — 45/36/9`, `make` exit 0, mandated strings each present exactly once), so the loop closed rather than buying a fourth review for prose.

### 9.6 Ruling — its own job, not a step inside `secret-hygiene`

`ci.yml:149-151` documents that cheap repo-wide gates share one runner "for no benefit", and this check is sub-second, so the repo convention argues for folding it in. Kept separate, per the brief: `needs:` can only reference **job ids**, and the plan's interface contract produces "the `ci.yml` check name `prod-flag-parity`, added to every `needs:` list that gates a deploy" — a name later tasks and an operator reading a red X both depend on. Cost is one runner start per CI run, against the outage class §7.3 measured as **221 source lines pairing a `503` with the string "not available"** — a code-surface count, not observed production traffic and not an incident tally. *(Wording corrected 2026-11-14 by Task 16; this line previously read "the 221 503 sites", which §10.7 flagged and §16.1 records as authorised.)*

### 9.7 Carry into Tasks 10, 13, 16

- Task 10 and Task 13 may reconcile one plane at a time using `--live NAMES`; that path never opens `feature-flags.ts`, so its diagnostics name the caller's list. Do not "simplify" by dropping `--live`.
- Task 13's write list must stay consistent with the nine `=false` lines: the guard checks the *web* file only, so a backend env name like `FEATURE_CRYPTO_ENABLED` is invisible to it and must be decided in Task 13's own table.
- Task 16 should record that production's flag wiring now has two independent guards (CI structural, lane runtime) and name what neither covers: a host edited by hand outside the lane.

## Task 10 — deliberate exclusions: the money paths prod stays OFF on (2026-11-13)

Copying staging flag-for-flag is the wrong rule for a money path. This section records the measured state of the three names the brief rules on, and two more the brief did not know about — one of which (bank transfers) changes what Task 8's deploy does to production.

### 10.1 The brief's Step 1 probe cannot answer its own question — rebuilt, with controls

As written it GETs `/api/v1/restaurant/1/like` and predicts "web hosts answer 503". Measured 2026-11-13: **all three** web hosts answer **405** and the backend **404** — a 405 says nothing about a gate (the plan's own constraint), and `/like` is not a route the flag registers. The prefix is wrong too: the Go group is `finance := r.Group("/api/finance")` (`finance_routes.go:334`) then `finance.Group("/restaurant")` (`:1800`), so the two flag-registered routes are `POST /api/finance/restaurant/:id/orders/paystack/initiate` and `GET /api/finance/restaurant/orders/paystack/:reference/status` (`paystackcheckout/service.go:665-666`), registered only inside `if paystackClient != nil && cfg.FeatureRestaurantPaystackCheckoutEnabled` (`finance_routes.go:1915`). The web plane uses a different URL for the same feature: `/api/v1/restaurant/[id]/orders/paystack/initiate` gates twice then proxies to the Go path (`route.ts:11-16`), and the status leg rides the restaurant orders catch-all, which gates on `featureFlags.restaurant()` **only** (`app/api/v1/restaurant/orders/[...path]/route.ts:12-18`). Neither plane shares the other's URL, so one probe path can never test both.

*Every line number in this section is read from this branch's tree (base `c49b39564` = RELEASE_SHA), because that is the code the ledger describes and the artifact a reviewer can re-open. The tree that drifted is `/Users/paymax/Documents/spotlight/main`'s **uncommitted working copy**, not `origin/main`: measured with `git diff HEAD origin/main --` and `diff -q`, `finance_routes.go` is byte-identical in HEAD, `origin/main` and that working copy, while `paystackcheckout/service.go` is **748 lines here and 759 in the working copy** — a live tier-gate edit, marked ` M` and belonging to another session. That +11 is why the three `service.go` citations in the first draft (`676-677`, `694-697`, `666-672`) matched *no commit at all*: they were read off an uncommitted file. Never cite a number across a tree boundary, and check whether the far tree is even committed before calling it a branch difference.*

Rebuilt probe — unauthenticated, no side effect (every handler in the chain calls `requireUser`/`requireRequestUser` before touching the gateway, `service.go:683` and `:725`), and **with a same-group control that is mounted on the host under test**, because the plan forbids reading a 404 as absence:

| Host | Route | Answer | Reads as |
| --- | --- | --- | --- |
| backend-production-1b33d | `POST …/restaurant/1/orders/paystack/initiate` | 404 `No API route matches POST …` | **not mounted** |
| backend-production-1b33d | `GET …/restaurant/orders/paystack/probe-ref/status` | 404 same | **not mounted** |
| backend-production-1b33d | `POST …/restaurant/1/orders` (control, `:1900`) | 401 `missing bearer token` | group reachable; unauth = 401 |
| backend-production-1b33d | `GET …/restaurant/orders/1` (control, `:1928`) | 401 `missing bearer token` | ditto |
| backend-staging-new | the same four routes | 401, 401, 401, 401 | rail **mounted** on staging |
| www.spotlightng.com | `POST /api/v1/restaurant/1/orders/paystack/initiate` | 503 `Restaurant delivery is not available.` | first gate closed |
| frontend-web-production-9259 | same | 503 `Paystack checkout is not available for food orders.` | second gate closed |
| frontend-web-staging-new | same | 503 `Paystack checkout is not available…` | staging web refuses too |

The controls are what turn the 404s into evidence: on the prod host two sibling restaurant routes answer 401, so 404 on the paystack pair is the absence of *that mount*, not a malformed path. Read the control precisely, because its validity is conditional: `:1900` and `:1928` sit inside `if cfg.FeatureRestaurantEnabled` (`finance_routes.go:1674`), exactly like the paystack block — they are not unconditional. They work as controls only because prod's backend env carries that name as `true` (§10.2), which is why the HTTP read and the env read have to be taken together and neither stands alone. `HandleMethodNotAllowed` is unset on this router, so a wrong verb also yields 404 — never test a mount with the wrong method.

### 10.2 The env read independently agrees with the HTTP read

`railway variables -p e7dca… -e <env> -s backend --json`, filtered to `FEATURE_` names whose value is exactly `true`/`false`; no other key and no non-boolean value was printed:

- **prod backend**: 135 keys, 54 boolean `FEATURE_*`. `FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED` **absent**; `FEATURE_CRYPTO_ENABLED=false` (explicitly present); `FEATURE_CRYPTO_SWAPS_ENABLED` **absent**.
- **staging backend**: 149 keys, 65 boolean `FEATURE_*`. All three **true**.

What the staging pair proves, stated exactly: `:1915` mounts the group only when the flag is on **and** `paystackClient != nil`, and that client is built solely from `if cfg.PaystackSecretKey != ""` (`finance_routes.go:259`). So staging's 401 on both paystack routes proves both halves at once — flag on and a Paystack secret configured — while the env read covers only the first. It does **not** prove the key is a live one, that it belongs to the live Paystack environment, or that a payment can settle; nothing short of a sandbox order proves that, and none was attempted.
- Names on staging and not on prod: **11** — `FEATURE_ADMIN_USER_MODULES_ENABLED`, `FEATURE_COMMISSION_ENABLED`, `FEATURE_CRYPTO_SWAPS_ENABLED`, `FEATURE_HEALTH_INTAKE_ENABLED`, `FEATURE_INSURANCE_ENABLED`, `FEATURE_INSURANCE_PROVIDER_IMPORT_ENABLED`, `FEATURE_ONBOARDING_ENABLED`, `FEATURE_PLACEMENT_ENABLED`, `FEATURE_PROPERTY_ROLES_ENABLED`, `FEATURE_REFERRAL_COMMISSION_SPLIT_ENABLED`, `FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED` — every one of them carrying the `_ENABLED` suffix, including the last two. **No boolean `FEATURE_*` name is prod-only.** That claim is scoped to what was compared: the two reads were filtered to `FEATURE_` keys whose value is exactly `true`/`false`, so the diff says nothing about non-flag keys, and there are prod-only keys outside that filter (Task 13's full key-set diff is the place that gets counted, and it is still owed).

The unread name and the unmounted route are the same fact seen from inside and outside, which is as close to proof as a flag gets. It also **corrects Task 13's arithmetic**: the plan says "twelve names on staging absent from prod, minus three money names = nine to write". Measured, the twelve is eleven and `FEATURE_CRYPTO_ENABLED` is not in that set at all (prod carries it as `false`). Re-derived, the staging-only names minus the two money exclusions are still nine — but they are **not the plan's nine**: the plan writes `FEATURE_BANK_TRANSFERS_ENABLED` (which is *not* missing on prod, it is *deliberately* `false` there — see §10.4) and omits `FEATURE_HEALTH_INTAKE_ENABLED`. Task 13 must state which of those two substitutions it wants, per name, before it dispatches a writer lane.

### 10.3 Rulings on the three names the brief puts to this task

**`FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED` — OFF on both planes.** Both planes read it: the web through `featureFlags.restaurantPaystackCheckout()` (`feature-flags.ts:190`, a strict `=== 'true'` test, so `=false` and absent are one behaviour: 503), and Go through `getEnvBool(..., false)` (`config.go:1138`), where the value decides whether the route group and the webhook confirmer / food-chargeback handlers exist at all (`finance_routes.go:1915-1924`). Writing it `=false` in the web file is therefore a declaration of intent and the count `make flag-parity` sees; leaving it out of the backend env is the thing that actually darkens the rail. Why it stays off anyway: `backend-production-1b33d` is publicly reachable and serves its own routes (§10.1 proves it answers), so an armed mount behind a `=false` web flag would leave a real card/bank-transfer checkout — documented as wallet-free and **not** KYC-tier-gated (`finance_routes.go:1910-1912`) — callable by any authenticated member who targets the API host. **Probe that flips it:** three things first — which key set prod's backend holds (`PAYSTACK_SECRET_KEY` name and prefix only, never the value: `config.go:1445` refuses a non-`sk_` value in prod), a sandbox order that settles through `settlement.EscrowExternal`, and a real `charge.success` routed to `OnChargeSuccess` by the `foodorder-` reference prefix through the *shared* Paystack pipeline (`service.go:655-661` — there is no `/orders/paystack/webhook` route to point at). Then re-run §10.1 and expect 401 on the prod pair. The integration contract for all three steps is written down at `docs/runbooks/restaurant-paystack-checkout.md` — it is the document a flip should be read against, and it is the source for the `foodorder-` prefix (`webhooks.RestaurantOrderReferencePrefix`, runbook:23-28) and for the receiver that does exist: `POST /api/webhooks/paystack/go` on the API host, which the Paystack dashboard must be pointed at (runbook:51). There is no per-feature `/orders/paystack/webhook` route.

**`FEATURE_CRYPTO_ENABLED` / `FEATURE_CRYPTO_SWAPS_ENABLED` — left OFF, and they are not this plan's to relitigate.** Backend-only: zero case-insensitive `crypto` hits in `feature-flags.ts`, so neither name is in the web's 45 and neither can ever appear in `.env.production.local` — Tasks 7-9 cannot arm crypto and Task 9's guard cannot see it (recorded in §9.7). Prod's two names reach OFF by two different mechanisms — an explicit `false` and an absent key — which is why the plan's shorthand "prod has `FEATURE_CRYPTO_ENABLED=false`, staging `true`" is true but incomplete: swaps is absent, not false. Crypto is a second money path and its audit record still carries open gaps (hardcoded `gate:"eligible"`, fabricated swap prices, unverified `/admin/crypto`), so it must not ride in as a side effect of a migration. `QUIDAX_WEBHOOK_SECRET` copied by Task 13 arms nothing: it is the *inbound* signature check, and `config.go:1583` makes swaps require `FEATURE_CRYPTO_ENABLED=true` as well. **Probe that flips it:** `GET /api/v1/crypto/assets` on the prod API host must stay 404 (Task 14 asserts this) — that is the prefix the code actually registers, because the whole block sits inside `if cfg.FeatureCryptoEnabled` and mounts `r.Group("/api/v1")` → `/crypto` and `/admin/crypto` (`finance_routes.go:3636-3643`, chosen so the frontend-web proxy `app/api/v1/crypto/[...path]` resolves), with the leaves added by `crypto.Register(cryptoMember, cryptoAdmin, …)` at `:3656` → `internal/crypto/handler.go:274-294`. Measured 2026-11-13 unauthenticated on three of those leaves (`assets`, `markets`, `portfolio`): prod **404 `No API route matches`**, staging **401 `missing bearer token`** — the pair a flip test is allowed to distinguish. The first draft of this line said `GET /api/finance/crypto/...`, a prefix that exists in no tree, and a guess like `/api/v1/crypto/wallets` 404s on **both** hosts because `wallets` is not one of those leaves: pick the probe path from `crypto.Register`'s route list or the test asserts a tautology. It flips only with an owner decision plus `CRYPTO_PROVIDER=quidax` and that environment's key (`config.go:1560`), which the strict pass makes fatal outside development.

**`FEATURE_CHECKOUT_TOPUP_TIER0` — OFF, recorded so its presence in the file is not read as unfinished work.** It is one of Task 7's nine `=false` lines (`production-module-flags.env:85`) and it is *both*-plane: web `checkoutTopupTier0` (`feature-flags.ts:131`) and Go `getEnvBool(..., false)` (`config.go:1212`) — but it is set on **neither** Railway backend env, so today only the web plane can turn it on. `finance_routes.go:1910-1912` names it the **rejected** top-up-then-spend design that the restaurant rail was audited as an alternative to, so the `=false` is the correct terminal state, not a gap. **Probe that flips it:** none in this migration — it needs a new ADR that answers the audit which rejected it.

**`FEATURE_UTILITY_CARD_LEDGER` — absent on the web plane, unmeasured on the Go plane, and outside the CI gate's derived surface.** A fifth money name, and the first *web-plane* one the gate cannot see (crypto's two are backend-only, §9.7): both planes read it directly — `cardLedgerEnabled()` at `frontend-web/src/server/utility/service.ts:85` (`process.env.FEATURE_UTILITY_CARD_LEDGER`, trimmed and lowercased) and `backend/internal/utilitybills/service.go:1451` (`os.Getenv`, same test, its comment at `:1447-1449` saying it must be set on BOTH services) — and both readers default off when unset; the TS doc block at `:78-82` states that off behaviour exactly — "a Paystack-sourced bill posts nothing". The name is absent from `frontend-web/config/production-module-flags.env` (`grep -c '^FEATURE_UTILITY_CARD_LEDGER='` → 0) and from the parity script's derived set, which comes only from `envFlag('NAME')` in `frontend-web/src/lib/feature-flags.ts` (`scripts/ci/check-prod-flag-parity.sh:49-52`), so that gate is green — exit 0, `45 flags declared (36 on, 9 off)` — while this money gate is unaccounted; no Go-plane env read of the name is recorded here, so its Go-side value is the ADR default, not a measurement. **Recorded, not papered over:** neither a `=false` line nor a gate change is made here, because a flag line moves the declared and off counts in every place this ledger and the plan state them. ADR-PR701 requires the name on both planes and defaults it off (`docs/adr/ADR-PR701-card-bills-vend-or-admin-approved-refund.md:3`, `:80`), so while it is unset card-paid utility bills post nothing — today's behaviour and the ADR's default, with no ledger row for the card leg. **Owner:** the operator who owns the card-bills ADR and Task 13 (the Go-plane value belongs in that task's write list); no executor of this plan adds the name to the file unilaterally. **Probe that flips it:** while the name is absent a card-paid bill posts no `utility:<tx>:CARD_COLLECT`/`DEBIT` pair; once it is set on both planes a verified Paystack charge must appear on the admin Transactions page.

### 10.4 Found while proving the above — and it outranks the three rulings

`FEATURE_BANK_TRANSFERS_ENABLED` is a payout flag: `config.go:220` calls it the "wallet-to-bank (payout) go-live flag", and Go fails its route families closed with 503 `feature_disabled` when it is off (`backend/internal/finance/transfers/handler.go:32`, `:54-55`, and seven `if !h.bankEnabled` gates at `:118`, `:153`, `:188`, `:202`, `:225`, `:244`, `:268`). Measured posture: **prod backend `false`, staging backend `true`, and Task 7's committed web file line 39 says `=true`** — because that file was derived from staging's *web* env without consulting prod's *backend* env, which is exactly the money-path mistake this task exists to catch.

Consequence if Task 8 ships and Task 13 does nothing: prod web starts serving the bank-transfer and beneficiaries UI (the name is read twice, `feature-flags.ts:151` and `:166`) and **every** leg that UI calls answers 503 `feature_disabled`. The transfers group is mounted regardless — `finance_routes.go:378-379` states the design ("Routes are always mounted; the handler returns 503 per family when the corresponding go-live flag is off") — and all seven bank gates sit on the handler side: `POST /transfers/bank` (`:389` → `handler.go:118`), `POST /transfers/bank-to-bank` (`:392` → `:153`), `GET /transfers/banks` (`:393` → `:188`), `POST /transfers/resolve-account` (`:396` → `:202`) and the beneficiary trio `GET`/`POST`/`DELETE /transfers/beneficiaries[/:id]` (`:397-399` → `:225`, `:244`, `:268`). There is **no** unbudgeted read path left: the group's other GETs (`/paymax/resolve` `:387`, `/pin/status` `:400`) and the PIN writes (`:404-405`) are gated by `walletEnabled` (`handler.go:62`, `:82`, `:286`, `:305`, `:328`), which prod carries `true` (§10.2) — so the bank screen cannot even load its bank list or its saved beneficiaries. That is the "module on the web, off on the API" mismatch class §7.3 measured as **221 source lines pairing a 503 with the text "not available"** — a code-surface count, not an incident tally — reintroduced deliberately on the one rail that moves money out of the company's wallet. The two consistent states are both `false` (web `=false`, a one-line edit to the committed file before Task 8 ships) or both `true` (Task 13 writes it, and `config.go:1449` then demands `MONNIFY_SECRET_KEY` when the default provider is Monnify — in prod a missing requirement is a boot abort, §10.6).

**Ruling: this is the user's decision, not the plan's, and it must be taken before the Task 8 deploy.** Task 13 loses the authority to write `FEATURE_BANK_TRANSFERS_ENABLED=true` that its Step 1 text grants it; that name joins the exclusions set. `Ruling: decided by the human, because turning on a payout rail is a money commitment with a provider contract attached — not a parity fix. What it costs if wrong: nothing while it waits; if it silently ships on the web side only, prod gains a 503 on a money route the day Task 8 deploys.`

### 10.5 The flag file install is a module go-live on the cPanel host, not a no-op

Two prod web hosts answered the *same* POST differently (§10.1), and the reason is measurable: `www.spotlightng.com` refuses at the restaurant gate while the Railway prod web host refuses at the paystack gate, i.e. **prod www has no `FEATURE_RESTAURANT_ENABLED=true` today**. Direct probes on prod www agree: `/api/v1/wallet/balance` → 503 `Wallet feature is not available.`, `/api/v1/events` → 503 `Events are not available.`, `/api/v1/restaurant/restaurants` → 503 `Restaurant delivery is not available.` — while the prod *backend* carries at least two of the three names as `true` — `FEATURE_WALLET_ENABLED` is stated `true` at §10.6, and `FeatureRestaurantEnabled` is proved `true` by this section's own 401 controls (their validity is conditional on that flag, §10.1) — **but `FEATURE_EVENTS_ENABLED` was never read on the prod backend anywhere in this plan**; §10.2 filtered to boolean `FEATURE_*` names and, for these three, prints neither presence nor value — it enumerates only the 11 staging-only names and asserts no prod-only boolean. *(Scoped 2026-11-14: the section does print values elsewhere, `FEATURE_CRYPTO_ENABLED=false` among them, so the limit is about these three names, not about §10.2 as a whole.)* *(Per-name split substituted 2026-11-14 by Task 16, which found this clause asserting "all three" on a citation that carried two.)* So Task 8's one deploy writes 36 `=true` lines. Read that as *36 names become visible to the web gate*, not "36 modules appear": §7.4 measured that 7 of those 36 accessors have zero call sites in the web plane (`estate`, `healthLab`, `healthPharmacy`, `healthVet`, `otpEmail`, `voteBridge`, `votesBridge`), so the ceiling on what can change HTTP behaviour at once is **29**, and for any of those 7 the flag is unfalsifiable by probe. That is the migration's intent, but it is what the deploy *is*, and Task 8 Steps 4-5 and Task 14 should be read against it: the probe log after the deploy must show these three 503s **flip**, and any that does not flip is a file-to-host drift bug rather than a flag question.

### 10.6 Prod's API moved during this task — re-pin before Task 11, and the validator warning changes shape

Plan §1 pins prod's backend from `/api/v1/public/build` → `41c19ea2b9…`, started 2026-10-17. Re-measured while writing this section: `{"commit":"585bd2ca7fab5c0a5adf9e67ab40b04068e9cee0","source":"ldflags","started_at":"2026-11-13T09:48:09Z","uptime_seconds":7704}`. So prod has been redeployed **today**, ~2 hours before §10.1's probes, and that pin is now history rather than state.

What `585bd2ca7` is, measured rather than assumed: PR #996 "feat(modules): readiness axis for the admin portal and production", authored 2026-11-12, contained on `origin/chore/promote-prod-module-readiness` and **not** on `origin/main` (`git branch -r --contains`). Against this plan's `RELEASE_SHA=c49b39564…`: the **seven-commit promote branch runs on prod and is not an ancestor of the pin** (`585bd2ca7`, `545b01cec`, `41c19ea2b`, `d346c3da3`, `dae77e90b`, `b9a6a152b`, `548d07c4b` — `git merge-base --is-ancestor` proves the divergence rather than asserting it), and **713 commits in the pin do not run**. Three consequences:

- Task 11 must re-read `/api/v1/public/build` at execution time and diff against *that*, not against §1. A promotion-branch deploy happened while this plan was in flight; anything written here about "prod runs the October build" is a timestamped observation, not a fact to deploy against.
- Code that ships in production and exists on no `main` is a parity hole this plan does not cover — the migration moves staging→prod, not prod-branch→main. Whoever owns `chore/promote-prod-module-readiness` should decide whether #996 lands on `main` before Task 12 releases a `main`-derived frontend against a backend that carries an extra module-readiness axis.
- The fail-fast warning below is now *dated and quantified* rather than rhetorical: today's boot proves the `585bd2ca7` rule set passes prod's current env, and nothing else. Measured across that same span, `backend/internal/config/config.go` itself changed **+241/−57 lines** (inside 808 changed Go files, +116,472/−8,547) — so the validator the pin will run has grown by roughly a fifth of its own length since the binary that is up now was built.

`cmd/server/main.go:25-26` aborts startup on any `Validate()` problem, and `config.go:1610-1612` is the disjunct that makes it fatal: `if c.IsProd() || len(strict) > 0` (strict is populated outside development, `:1522-1523`). One delta matters for §10.4, and it is smaller than it looks: prod already carries `FEATURE_WALLET_ENABLED=true`, so `paymentsOn` at `:1443` is already true and `PAYSTACK_SECRET_KEY` is **already required by the running build** — `:1444` demands it and `:1445` refuses a value that does not start with `sk_`. Flipping bank transfers therefore adds *provider credentials* (`MONNIFY_SECRET_KEY` at `:1449`, and only when the default disbursement provider is Monnify), not a new class of existence check. Cheap pre-flight before deploying `RELEASE_SHA`: run the release-tree binary against prod's env in a throwaway container and print only the validator's problem lines — they name variables, never values — and expect zero.

### 10.7 What this task does not prove

- No web host's env file was read. The web evidence is the 503 **bodies**, which prove the gate's state and not which of `=false` / absent produced it — indistinguishable at runtime by design (`=== 'true'`). Only the two Railway backend envs were read, via the API.
- The staging rail was **not exercised**: no order was initiated, no token minted, no Paystack call made, no webhook sent. 401 is mount evidence, nothing more.
- `railway variables` reports what is *configured*, not what a process *has* — a container started before a write still runs the old value. Prod's 404s and prod's absent name agree here, so no such skew is in play for the paystack rail today.
- Task 10 changed no file outside this ledger. Task 7's `=true` line for bank transfers is still committed and still ships unless the user rules otherwise in §10.4 — the decision is escalated, not taken.
- Two claims in this section survived the first review round and were corrected in the second. Both were mine, not the reviewer's inventions, and they came from different rounds: the crypto flip-probe naming `/api/finance/crypto` — a prefix registered in no tree, which would have made Task 14's assertion a tautology — was in the original section commit (`69746c5ce`) and the first review missed it; the transfers sentence describing a `/transfers` list-and-history read path was introduced *by* the round-1 fix (`ce5f610e8`), which replaced "four gates" with the correct seven and, in rewriting the consequence, invented read routes to contrast them against. The rest of round 2's findings — the conditional restaurant control in §10.1, the flag-only scope of "nothing is prod-only" in §10.2, all 11 names carrying `_ENABLED`, three web hosts rather than two at 405, the 29-of-36 ceiling in §10.5, the runbook pointer — are precision fixes to sentences that were directionally right.
- **A number in §9.5 is mislabelled and stays mislabelled:** *(this bullet's own claim went stale on 2026-11-14: the phrase lives in **§9.6**, not §9.5, and Task 16 has since corrected it in place with the attribution note that §5 forbids editing an applied section — so "stays mislabelled" was true when Task 10 wrote it and is false now. Kept rather than rewritten, because §10.7 is a record of what Task 10 could not prove at the time.)* it calls §7.3's count "the 221 503 sites", but §7.3 measured 221 *source lines* pairing a 503 with the string "not available" — a code-surface figure, not observed production traffic. It is left in place because §5 forbids editing another task's section; §10.4 states the correct characterisation, and Task 16 should carry the correction when it revisits §9.

---

## Task 15 — the mobile production plane (2026-11-14)

**Verdict: split — the tracked half shipped, the untracked half is escalated.** `f6e49a31c` puts the
refusal into both release scripts; `1be3e158f` is this section's first review round, which widened it;
`65ee29ec0` rebuilt the normalisation on dotenv's own rules and scoped the shadow gate; `e16da72be` made the
read locale-proof. The
brief's Step 2 (re-point the local `.env.production`) and Step 3 (re-build, re-grep the artifact) were
**not executed**, and that is a ruling, not an omission. Three reasons, each independently checkable: the
file is gitignored — `git check-ignore -v mobile-app/reactnative/.env.production` →
`.gitignore:12:.env.*` — so that edit would be the only change in this plan invisible to the diff that
gates it; what it changes is what a store build talks to, which is a production side effect belonging to
the user; and the standing project rule "do not 'correct' `.env.production` to prod values unprompted"
still binds — but **not** because the fork is deliberate. The first draft of this section called it "a
decision the project memory records as deliberate on 2026-11-10"; the cited note
(`rn-prod-release-staging-plane.md`) carries an **"Update 2026-11-13"** stating that the reason for that
decision has expired, that the profiles are now "a genuine fork, not a deliberate hold", and that
reconciling them is the open task. The instruction survives its rationale, which is why this is an
escalation and not a defence. So Step 2 was run **in full on a scratch copy instead** (§15.5), which means
the user decides with the recipe's measured result in front of them rather than its promise.

**State of the world right now (the sentence a build host needs before the analysis):** the production
mobile lane on this machine is **blocked by design**. `make build-aab-prod`,
`npm run build:aab:production` and the VS Code production task all exit 1 at the guard, because the live
`.env.production` still declares `staging` — re-measured for this correction round: `EXPO_PUBLIC_APP_ENV`
declares `staging`, `wnic` ×4, `nmseef` ×0, 8 key lines carrying a staging ref. Re-measured again in round 3,
this time by running the shipped 14-line pipeline against main's real file without copying it (`ENV_FILE`
pointed at the absolute path, read-only): it prints `declares EXPO_PUBLIC_APP_ENV=staging` and exits 1. The
corrected figures in §15.5 belong to the copy, not to the file.

### 15.1 What landed

- `build-aab.sh:134-158` and `build-apk.sh:154-178` (`1be3e158f`, rewritten in this task's round 2, then
  made locale-proof in round 3 as `e16da72be`; the first commit had them at `:131-138` / `:146-153`, and at
  `f6e49a31c` they were `:130-135` and `:142-147`). Immediately after the `ENV_FILE` existence check
  (`:119-125` / `:126-132`) and before `EXPECTED_API` is read (`:162` / `:182`), both scripts extract
  `EXPO_PUBLIC_APP_ENV` from `$ENV_FILE`, normalise it, and `exit 1` when `NODE_ENV=production` and the
  result is not `production` — absent declaration included — pointing at
  `node scripts/export-eas-profile-env.mjs production`. The
  **14-line extraction pipeline** (`:140-153` / `:160-173`) is byte-identical across the two scripts, and
  `guard-test.sh` now diffs it on every run, so there is one semantics here rather than two that can drift.
- **What round 2 changed, and the rule it is now pinned to.** The `1be3e158f` pipeline was a `grep` +
  `cut` + `tr -d '\r'` + a `sed -E` chain. Measured against dotenv 16.4.7 — what `@expo/env` 2.0.12 loads
  through, and the package whose `LINE` regex at `mobile-app/reactnative/node_modules/dotenv/lib/main.js:9`
  defines the rules — it was wrong in both directions. `old-vs-dotenv.sh` in this workspace replays that
  `1be3e158f` pipeline over the **same table** `guard-test.sh` drives the shipped guard with — it reads the
  rows out of the harness, so a fixture added there is measured here too — and over all **60** fixtures it
  prints **15 refused / 4 passed** (`./old-vs-dotenv.sh /tmp/rn1`, `/tmp/rn1` being a scratch directory
  holding `git show 1be3e158f:mobile-app/reactnative/build-apk.sh`; it refuses a tree that already has an
  `.env.production`, same hazard as the harness). 12 of the 15 refusals are spellings the loader reads as
  `production` — backtick quotes (`bq`, `bq-plus-comment`), an `export ` prefix (`export`, `export-sp`,
  `export-tab`), leading whitespace before the key (`lead-sp-key`, `tab-lead-key`), and the whole
  `KEY: value` colon form (`colon-sp`, `colon-tab`, `colon-quoted`, `colon-two-space`, `colon-export`) —
  and the other 3 are the bare-CR fixtures in the known-limit bullet below. All 4 passes are spellings the loader
  does not read as production — that is what makes them false passes — and they split 3 to 1 by *mechanism*:
  `interior-cr` and `cr-in-dq` because `tr -d` *deletes* the CR instead of treating it as a line terminator, so the
  old chain rejoins `prod` and `uction` into `production` where the loader's own column reads `"prod"` and
  `"prod\nuction"`; and `nested-quotes` because two sequential `sed` quote-strips remove two layers where dotenv
  removes one, leaving the loader with `"'production'"`. The fourth, `swallow-case`, misses in the other direction:
  dotenv's `/m` quoted-value swallow hides the declaration from the loader, which reads `<unset>`, while the
  `grep`-anchored old chain extracts it. (That fourth is also one of the four divergences the new pipeline keeps on
  purpose — see the known-limit bullet below, not a fix it claims. Round 2 cited this run as "12 and 3"; re-running
  it with the three `cr-sep-*` rows (`cr-sep-last-wins`, `cr-sep-lead`, `cr-sep-mixed`) deleted from the harness
  table gives **12 refused / 4 passed** over the remaining 57, so the CR fixtures account for the refused side, 12
  → 15, and not for the passed side — round 2's "3" is its own list, which named `interior-cr`, `cr-in-dq` and
  `nested-quotes` and filed `swallow-case` separately as a documented divergence.) The pipeline now reproduces
  dotenv's rules: `^[[:space:]]*(export[[:space:]]+)?KEY` then either `[[:space:]]*=[[:space:]]*` or
  `:[[:space:]]+` (colon needs the space, and nothing before the colon — `KEY : value` parses nowhere), last
  assignment wins, CR cut **from** the value rather than deleted out of it, an unquoted `#` starts a
  comment (so `production#live` is `production`, and a `#` *inside* quotes is kept, so `"production #
  live"` is refused), trim, then exactly one surrounding quote layer of `"` `'` or `` ` `` — with no
  re-trim after unquoting, because dotenv does not re-trim either, which is what keeps `" production "`
  refused (`dq-padded-inside`; the old chain refused it too, on a different accident, so parity there is
  preserved rather than gained). All of it is one `sed` expression: two
  `-e`s would run the second against what the first already substituted, and a value that itself looks
  like a declaration (`EXPO_PUBLIC_APP_ENV=EXPO_PUBLIC_APP_ENV: production`) would then be read twice and
  **pass on the second read** — which dotenv does not do. The four rows where the two still disagree are
  the known-limit bullet below, which also says which way each of them falls. Three of the four make the
  guard refuse a build the loader would have wired correctly — that is the only direction a divergence in a
  safety gate should ever go — and the fourth is safe for a different reason, stated there rather than
  glossed as "fails closed".
- **Why the normalisation is shell and not the loader itself** (asked by round 2's review, ruling R2-3).
  Asking `dotenv` would agree with the parser by construction, and a future host will reach for it:
  `node -e 'require("dotenv").parse(...)'` inside the release script. It cannot work here. The guard runs
  at `:155` / `:175`, ahead of the first `node` call in either script (`:191` / `:218`,
  `scripts/check-env-mocks.mjs`), and a checkout is allowed to have no `node_modules` at all — this plan's
  own worktree does not — so a guard that needs the installed loader is a guard that cannot run on the
  machine that needs it. The 14 lines of `sed`/`awk` are therefore pinned to the loader by a measured
  60-row differential table, not by a shared implementation, and `env-parse-diff.mjs` regenerates that
  table's loader column against the real `dotenv` — it `createRequire`s `main`'s installed copy by absolute
  path, so it produces the oracle from a worktree that has no `node_modules` of its own.
- **Round 3: the read must not be able to kill the script (review N-2).** Round 2 replaced a chain whose
  `sed` only ever saw an already-extracted line with one that runs over the whole file. BSD `sed -E` with
  `[[:space:]]` aborts on a byte sequence that is illegal in the host locale: on
  `LC_ALL=en_US.UTF-8` a file holding `EXPO_PUBLIC_APP_ENV=production` plus one stray `\xff\xfe` makes the
  `sed` print `RE error: illegal byte sequence` and exit **1** — after printing the match, but the status
  is what `set -euo pipefail` sees, and inside `$(...)` that abort ends the script at the assignment, so
  the refusal's remedy never prints. Round 1's chain is immune on the same file (measured: `production`,
  rc 0), so the abort was a regression the rewrite introduced — and a harmless-outcome one: nothing ships
  wrong, the build just dies with a `sed` error instead of an instruction. The guard now pins its own read:
  `LC_ALL=C` on the `sed` (same file → `production`, rc 0) with `|| true` kept for any other pipeline
  failure. They are not duplicates — with only `|| true` the message would print `declares <unset>` for a
  file that does declare production, which is a wrong diagnosis of a real failure. A broken read therefore
  always lands on the empty value, and the empty value is refused. Evidence:
  `.superpowers/sdd/…/task-15-locale-probe.txt` (the four-way measurement, and the shipped script running
  clean end to end on the poisoned file with zero `illegal byte sequence` lines).
- **Deliberate divergence, recorded so a future host does not "fix" it.** Capital `Production` is refused
  although `src/lib/serverProfile.ts:53,59-61` — `isSwitchAvailable` ends in `SWITCH_ENVIRONMENTS.has(appEnv
  .trim())` — treats anything not exactly in its allowlist as not-switchable, so `Production` would in fact
  build a safe production-behaving bundle. The same reasoning covers a quoted-and-padded `" production "`
  (`dq-padded-inside`): dotenv hands the padding through, the runtime trims it away — the source comment at
  `:57` gives `' staging '` as its own example of a value that counts — and the guard still
  refuses. Both are exact-token comparisons against what
  `scripts/export-eas-profile-env.mjs production` writes, so a mis-cased or padded declaration stops a
  release instead of quietly becoming the file's own dialect. **Known limits — four fixtures pin them, and
  they fall in opposite directions.** (a) *A closed quote earlier in the file:* dotenv matches with `/mg`
  over the whole file, so a *closed* multi-line quoted value earlier in the file swallows the declaration
  line and dotenv then never sees the key (`swallow-case` in the harness, where the loader column reads
  `<unset>`). The line-based pipeline reads the declaration and **stays silent** — this one does not fail
  closed, and the harness row says so rather than being written to look like it does. It is still not a
  hazard, for a runtime reason and not a guard reason: what ships is whatever the loader produced, the
  loader produced nothing for the key, and `src/lib/serverProfile.ts:50-52` says out loud what happens then —
  "an unset, empty or unrecognised `EXPO_PUBLIC_APP_ENV` … is treated as production, so a typo can only hide
  the switch, never expose it in a shipped build". The cost of
  the divergence is a lost reminder, not a wrong build. (b) *A bare `CR` used as the line terminator:*
  dotenv's `/m` ends a line at a lone `\r`, so
  `EXPO_PUBLIC_APP_ENV=staging<CR>EXPO_PUBLIC_APP_ENV=production<CR>` means `production` to the loader,
  while `sed` sees one physical line and cuts at the first CR — the guard reads `staging` and refuses. The
  same class covers `A=1<CR>EXPO_PUBLIC_APP_ENV=production<CR>` (the pattern anchors at the physical line
  start, so the guard reads `<unset>`) and the mixed `<CR>`-terminated-then-`LF` form (`staging` again); all
  three are harness rows `cr-sep-last-wins`, `cr-sep-lead`, `cr-sep-mixed`, and the three guard-side values
  above are the shipped pipeline measured against those exact bodies. These fail closed in the literal sense:
  a build that would have been wired correctly is blocked, which is the direction a safety gate is allowed
  to err. (c) What neither class can do is ship a switch-on production build — (a) because the loader leaves
  the key absent, (b) because the guard stops the build — which is the property the gate exists to protect.
  (a) additionally cannot be hit by the real file today: its line 241
  (`FEATURE_ADMIN_USER_MODULES_ENABLED`) opens a `"` that no later line closes, so nothing is swallowed,
  which is why dotenv reads `staging` from line 24 at all.
- **Shadow-file coverage closed (review Finding 5).** The refusal at `build-aab.sh:174-185` /
  `build-apk.sh:198-209` greps the two files that outrank `$ENV_FILE`
  (`.env.<mode>.local`, `.env.local`) and its pattern is now the interpolated
  `^EXPO_PUBLIC_(${_shadow_keys})=` — `API_BASE_URL|SUPABASE_URL`, plus `|APP_ENV` only for a production
  build (`:175-177` / `:199-201`), so grep-the-literal comparisons against an older draft should search
  for `_shadow_keys`, not for a fixed key list. Before, a `.env.production.local` carrying
  `EXPO_PUBLIC_APP_ENV=staging` passed the guard (which reads only `$ENV_FILE`) *and* the old shadow grep
  (which matched only the two URLs) and shipped exactly the switch-on build this task exists to prevent.
  No such file exists today; the hole was structural. Round 2 narrowed `APP_ENV` to that production leg
  while the two URL keys stayed mode-blind. A dev or staging build that declares its plane in
  `.env.development.local` was then refused by a gate whose own printed remedy is "rename it to
  `.env.development.local`" — the advice and the check contradicted each other, and the file it objected
  to is the documented way to write a dev override.
- Why a declaration check and not a bundle check: `EXPECTED_HOST` is derived from `EXPECTED_API`
  (`build-aab.sh:162` → `:309`) and `EXPECTED_API` is read out of the same `$ENV_FILE` the bundle is
  grepped against, so a staging-wired prod file makes the existing gate print
  `✅ API host present: frontend-web-staging-new.up.railway.app` — green for the wrong host.
  `EXPECTED_SUPABASE` (`:163`) is only ever echoed (`:233`), never compared to anything. Asserting the
  declaration is the one check in either script that is not self-referential.
- **Tree caution, again.** The brief cites `build-aab.sh:122-128` / `:133` / `:134` / `:278` / `:129`. Those
  are **main's uncommitted working copy** — `git status` shows ` M mobile-app/reactnative/build-aab.sh`
  (12 insertions / 3 deletions) with another session's SDK-dir capture at `:38-44` and
  `npx expo prebuild --platform android --no-install --clean` at **`:222`** (an earlier draft of this
  section wrote `:213`, which is the `fi` of that session's `Android SDK not found` refusal — message
  `:211`, `exit 1` `:212` — not the prebuild). In this plan's base, post-`1be3e158f`, the same landmarks are
  `:119-125` (existence + exit 1), `:142`, `:143`,
  `:285`, and the prebuild is `:229` **without** `--clean`. Both later commits moved them again, and each
  number below was read off that commit rather than derived: `65ee29ec0` (round 2's longer comment and
  14-line pipeline) → `:156`, `:157`, `:303`, prebuild `:247`; `e16da72be` (round 3's six comment lines and
  `LC_ALL=C`) → `:162`, `:163`, `:309`, prebuild `:253`. `:119-125` is unchanged across all three. Same
  files, different numbers; Task 15's hunks
  sit nowhere near the other session's two, so both commits should merge clean — but they must be diffed
  against whatever `main` becomes, not against this base.
- **Probe (harness):** `.superpowers/sdd/…/guard-test.sh` — **79 assertions over the two real scripts**:
  **18 structural** (9 per script: 2 guard-fire — `staging` and declaration-absent; 1 shadow-file-fire —
  `.env.production.local` declaring `staging`; 5 guard-silent — `production`, `"production"`,
  `production # live`, CRLF, and the legitimate `staging` build declaring `staging`; 1 dev-build case that
  must *not* be refused), **1 pipeline byte-identity** (`awk` from `_declared_env=` to its own closing
  `)"`, so a drift between the two scripts fails the run rather than silently forking the semantics), and
  a **60-spelling loader-parity table**. Every structural case asserts the guard's exit **and** placement —
  a refusal must not print the `EXPO_PUBLIC_API_BASE_URL is not set` message of the check below it, a silent
  case must; a shadow case must get *past* both — and that the run never reaches `expo prebuild`/gradlew.
  The parity table is an **oracle, not a mirror**: each row carries the verdict real dotenv 16.4.7 returns
  for those bytes, and the expected outcome is derived from that column, so the test would still fail if
  the scripts and the author agreed on something wrong. That claim is worth nothing unless the column
  itself is checked, so it is machine-checked: `env-parse-diff.mjs` writes each row's exact
  bytes, parses them with the `dotenv` installed in `main` and prints `name<TAB>JSON.stringify(value)<TAB>verdict`,
  and `table-vs-dotenv.mjs` diffs that against the harness table. **Observed: 60 rows, 0 verdict and 0
  rendered-value differences** — before round 3 normalised four cells, that second number was 4
  (`dq-junk`, `dq-split`, `dq-unterm`, `inner-quote` displayed the value under a loose escaping convention;
  no assertion read them, every assertion reads PASS/REFUSE, so this was presentation drift only). Four of
  the 60 rows are marked `divergent=` and pin the *guard's* verdict instead of the loader's, because those
  are the known limits, not parity: one `swallow-case` plus the three `cr-sep-*`. Parity runs through
  `build-apk.sh` only; the byte-identity assertion is what makes that cover `build-aab.sh`.
  **Observed:** RED against the round-1 scripts (`542609281`, whose `mobile-app/reactnative/` is
  byte-identical to `1be3e158f`'s) — **19 assertions wrong**: 15 parity rows (the 12 over-refusals and the
  3 `tr -d`/double-strip over-passes above; the 4 divergent rows go green there, because the old chain
  guessed the same wrong way) and 4 from the dev-build case (2 scripts × 2 asserts). GREEN
  (**0 wrong**) against `65ee29ec0` and again against `e16da72be` — round 3 re-ran both and kept the output
  as `task-15-guard-red.txt` / `task-15-guard-green.txt`; `/bin/bash -n` clean on both scripts; worktree
  clean.
- **Two dead tests this harness had, both found by breaking the thing on purpose.** The first draft
  asserted only the exit code and printed `ALL CASES AS EXPECTED` against a deliberately broken guard. The
  round-2 dev-build case passed at round-1 HEAD while proving nothing either: its `.env.development`
  fixture had no API URL, so the run stopped at `EXPECTED_API` and never reached the shadow loop the case
  existed to exercise — it only became a test once the fixture carried a URL and the case was allowed to
  fail (`saw=shadow` at RED). A test that cannot fail is worse than no test, because it reads like evidence.
- **Harness hazard (review Finding 9 — read before pointing it at a tree).** The probe writes fixtures and
  then `rm -f`s `.env.production`, `.env.staging` **and** `.env.production.local` in whatever tree it is
  given. Those files are gitignored: pointed at a live checkout the probe would delete an untracked,
  unrecoverable file — the very file §15.6 says must be re-created on any new build host. It now **refuses
  to run** (exit 2) if any of them already exists — the round-2 dev case added `.env.development` and
  `.env.development.local` to both the refusal list and the `EXIT` trap — and it was developed and
  re-run only against scratch copies under `/tmp`. A future session should still pass it a copy, not a
  working tree.
- Most fixtures are minimal on purpose (`EXPO_PUBLIC_APP_ENV` only, no API URL) so the run stops at the
  guard or one line past it and never reaches `expo prebuild`/gradle; the shadow and dev fixtures are the
  two that must carry an API URL, because their whole point is to get *past* `EXPECTED_API`. The parity
  fixtures each carry exactly one declaration in one spelling. `ALLOW_DEBUG_SIGNING=1` skips the signing
  refusal that sits *before* the guard on a machine without the release keystore.

### 15.2 The file, measured — and the brief's "three backend keys" is 134

- **Observed:** `.env.production` sha256 `890a00b7b5e9bcb6…`, 11,725 B, mtime **2026-11-03 22:25** —
  older than every artifact in §15.3, which is what makes the artifact grep a measurement *of this file*
  rather than of some later edit. 253 lines total, 247 non-empty, 252 by `wc -l` (the file ends without a
  trailing newline), 32 comment lines, **215 keys = 81 `EXPO_PUBLIC_*` + 134 non-`EXPO_PUBLIC_`**. One key
  has an empty value: `EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY`. `EXPO_PUBLIC_APP_ENV=staging`.
- 12 lines match the staging-ref pattern, and the split matters. Re-measured for this correction round,
  with the commands so nobody has to take the figure on faith (all run in
  `mobile-app/reactnative`):
  `grep -cE 'wnic|ptcz|frontend-web-staging|staging' .env.production` → **12**; of those,
  `grep -E 'wnic|ptcz|frontend-web-staging|staging' .env.production | grep -cE '^[A-Z_]'` → **8 key lines**
  (`EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SITE_URL`, `EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL`, `SUPABASE_URL`, `DATABASE_URL`, `SUPABASE_JWKS_URL`) and
  `… | grep -c '^#'` → **4 comment lines**, the file's own "copy this to `.env.staging`" header. Per
  pattern: `wnic` 4, `frontend-web-staging` 3, `staging` 8, `ptcz` 0, `nmseef` **0**. The 4 comments survive
  any correct re-point, so **the brief's own verification command can never print 0 for this file** — a
  future session running it literally will conclude the fix failed when it succeeded. Filter to key lines;
  after a correct re-point the key-line count is 0 (§15.5).
- The brief describes the non-`EXPO_PUBLIC_` set as "three backend keys (`SUPABASE_URL`, `DATABASE_URL`,
  `SUPABASE_JWKS_URL`) that drifted into a mobile env file". The file has **134**, all non-empty, including
  `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, `MONNIFY_*`, `DOJAH_*`, `QUIDAX_*`, `LIVEKIT_*`,
  `OTP_PEPPER`, `DATABASE_URL` and **63** `FEATURE_*` (`grep -cE '^FEATURE_' .env.production` → 63; the
  remaining 71 are the secrets named above and other backend config — an earlier draft of this section
  wrote "~90", which is the sort of round number the rest of the ledger objects to). None of the 134 can
  reach a user: Metro inlines only `EXPO_PUBLIC_*`, and a per-key sweep for readers across `src/`, `app/`,
  `scripts/`, `eas.json` and both build scripts finds nothing for that whole set. So it is hygiene debt
  with a real rotation cost (§15.6), **not** a live leak — but the plan must stop describing 134 keys as
  three, because a reader who takes "three" literally will delete three lines and call the exposure closed.
- **Recipe hazard the brief does not mention — reproduced.** The last line is `R2_ENDPOINT=…` **with no
  trailing newline** (last byte measured `m`; `wc -l` 252 against 253 awk lines), so Step 2's
  `printf '%s=%s\n' "$k" "$v" >> .env.production` append branch would concatenate the new key onto it.
  Demonstrated on a throwaway copy of the patched file: appending one key produced a single malformed
  `R2_ENDPOINT=<endpoint-url>NEW_KEY=value` line. The branch is dead today — all six profile keys already
  exist, so the recipe applies 6 and appends 0, and note it does **not** add the missing newline either, so
  the hazard stays latent after a successful run. Either emit a bare newline first, or regenerate the file
  rather than patch it.
- `.env` vs `.env.production`: 215 keys each, and exactly **one** differing pair —
  `EXPO_PUBLIC_SENTRY_ENVIRONMENT` (staging vs production). The prod file is a copy of `.env` with one
  label changed, which is the mechanism behind the whole finding: it was never derived from the profile.

### 15.3 The shipped artifacts, grepped (read-only — nothing was built)

`release-artifacts/` holds **three** artifacts, not the one the brief names: `app-release-production.aab`
(43,447,249 B, 2026-11-11 01:21), `app-release-production-vc20.aab` (58,823,398 B, 2026-11-10 15:35) and
`app-release-production.apk` (65,024,079 B, 2026-11-10 21:58). `android/app/build/outputs/bundle/release/app-release.aab`
is the same build as the newest AAB (identical 43,447,249 B; the script copies it).

- **Probe:** `.superpowers/sdd/…/bundle-scan.py <aab> <reactnative-dir>` — read-only, extracts
  `base/assets/index.android.bundle` into `/tmp` and reports only counts, offsets, lengths and key
  *formats*. Counts are fixed-string occurrences (`bytes.find` looped), not greedy regexes, for the reason
  in the last bullet below. Re-run for this correction round against both AABs: identical output, byte for
  byte.
- **Observed — the bundle is 19,054,516 B (18.2 MiB; the brief's "18 MB" and "41 MB" are MiB for its
  43,447,249 B) and all three artifacts carry the same one** — hash-confirmed this round, not inferred from
  size: the bundle extracted from `app-release-production.apk` and the one from `app-release-production.aab`
  are both sha256 `12b9b09918b02460…`, and the two AABs' probes report identical counts and offsets. Plane
  strings: staging API host ×1 (@3,290,266),
  `wnicsubiz…` ×1 (@2,938,586), `www.spotlightng.com` ×1 (@3,370,365), production API host ×**0**,
  `nmseef…` ×**0**, retired `ptcz` ×**0**. So every artifact on this machine that is named "production" is
  staging-wired end to end, and the single `www.spotlightng.com` is a source fallback constant, not a baked
  API base. This is not a forecast about a future build.
- **What the re-point has to change, pinned from the tracked profile** (`eas.json` `build.production.env`):
  `EXPO_PUBLIC_APP_ENV=production`,
  `EXPO_PUBLIC_API_BASE_URL=https://frontend-web-production-9259.up.railway.app`,
  `EXPO_PUBLIC_SUPABASE_URL=https://nmseefdlliejmdbxytej.supabase.co`, `EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME=paymax`,
  and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in the 46-character `sb_publishable_…` form. Neither the production
  host, nor the production project ref, nor that key **appears anywhere in the shipped bundle** (0, 0, 0
  measured above), which is the cleanest statement of the gap: the artifact and the profile currently share
  no plane-identifying byte.
- **Credential test (the one that actually settles it):** for each of the 134 non-`EXPO_PUBLIC_` keys, does
  its **value** appear as a substring of the bundle? 58 values ≥12 chars were testable; 76 were skipped for
  being too short to count as evidence (most are `true`/`false` flags). **Observed: 1 hit.**
- That single hit is explained without any leak: in this file `SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_URL`
  hold the **same** 40-character value, so the string in the bundle is the legitimately-inlined public
  project URL — not the non-`EXPO_PUBLIC_` line. Nothing else matched, and a `service_role` scan returns 0.
- **Complete naive-scan enumeration** (an earlier draft of this section listed three hits and thereby missed
  the pattern most secret scanners flag, which invites exactly the re-raise this list exists to prevent):
  `sk_live` ×1 and `sk_test` ×1 — fake fixtures in `src/features/fx/api/fxAccount.api.ts:55-56`, with the
  same prefixes regenerated by the template at `:99`; `sb_secret` ×1 — a string inside
  `node_modules/@supabase/functions-js/dist/module/FunctionsClient.js`; `DOJAH` ×1 — a provider name, not a
  key; and **one JWT-shaped string**, which is the file's own `EXPO_PUBLIC_SUPABASE_ANON_KEY`: 208 chars,
  present once at @2,484,679, byte-identical to the `staging` profile's value, decodes to
  `iss=supabase role=anon ref=wnic… exp=2090573596`. It is a **public-by-design** client key and both
  scanners already allow-list it deliberately (`.gitleaks.toml:90`, explained at `:91-96`;
  `trivy-secret.yaml:23-29` — the whole file is one allow-rule). **No
  secret value ships.**
- **Read regex output before believing it — two measured over-reads.** The JWT pattern most scanners ship
  (`eyJ[A-Za-z0-9_.-]+`, dot inside the class) matches **four** strings in this bundle, of 254, 73, 37 and 6
  characters; only the 254 one relates to the anon key, and even it over-reads by 46 characters because the
  bundle is a Hermes string pool and the greedy class runs on into the neighbouring bytes (a strict
  three-segment pattern still reports 254). The real value is 208. Likewise the 14-byte run
  `sb_publishable` is present once, but **not** as a key: at @2,434,077 it sits inside unrelated
  font-metric table data (`…kiometer` + `sb_publishable` + `_INTERNAL_flushLogs…`), while the production
  publishable key itself has 0 occurrences. And `wnic` as a literal occurs once, but the anon key's
  base64url payload *encodes* the same ref, so an audit that decodes tokens finds two staging references
  where this section's grep counts one. Cite the method with the number.

### 15.4 The two user-visible consequences (Step 5's requirement — changes, not cleanups)

1. **Today's "production" store build shows end users the Remote/Local server switch; the re-point removes
   it.** `EXPO_PUBLIC_APP_ENV` is read by `isServerSwitchAvailable()` → `isSwitchAvailable()` against a
   fail-closed allowlist `['development','dev','staging','test','local']` (`src/lib/serverProfile.ts:53`,
   `:59-61`; `src/lib/serverProfileStore.ts:47-48`). `src/components/dev/ServerSwitch.tsx:25` returns
   `null` when it is false, and `resolveActiveProfile` bails to `{mode:'remote'}` at
   `src/lib/serverProfile.ts:216` ("Production ignores any stored value"). So shipping the corrected file
   withdraws a way for a Play-installed build to be pointed at `http://localhost:8091`,
   `http://localhost:54321` or `10.0.2.2` — behaviour change and blast-radius reduction, to be announced as
   such. The tracked profile agrees: `scripts/export-eas-profile-env.mjs:49` **refuses to project** a
   production profile that sets `EXPO_PUBLIC_LOCAL_*` ("the Local server switch is non-production only").
2. **Share links and certificate links move from staging to prod.**
   `src/features/voting/api/voting.api.ts:206-210` resolves
   `EXPO_PUBLIC_SHARE_BASE_URL || EXPO_PUBLIC_WEB_BASE_URL || EXPO_PUBLIC_SITE_URL || 'https://www.spotlightng.com'`;
   neither of the first two is set in this file (the only other reader is
   `src/features/registration/components/ContestVotingCard.tsx:28`), so today the **staging**
   `EXPO_PUBLIC_SITE_URL` wins and vote-invite links leave the app naming
   `frontend-web-staging-new…`. `src/features/filmAcademy/api.ts:334-337` (`resolvePublicSiteUrl`) uses
   `EXPO_PUBLIC_SITE_URL` whenever it is non-empty and falls back to the prod constant only when blank, so
   printed certificate verification URLs (`/verify/certificate/<code>`) do the same. Both are fixed by the
   re-point, and both are strings that escape the app into other people's browsers.

### 15.5 The recipe, run on a scratch copy (main's file untouched)

- `node scripts/export-eas-profile-env.mjs production` → rc 0, exactly **6 keys**: `EXPO_PUBLIC_APP_ENV`,
  `EXPO_PUBLIC_SENTRY_ENVIRONMENT`, `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME`.
- **Step 2 rehearsed end to end on a copy, twice** — once when the task ran and again for this correction
  round, through `.superpowers/sdd/…/recipe-rehearsal.sh`, which copies main's file to `/tmp`, applies the
  brief's recipe verbatim, and prints only counts, key names and value *formats*. Measured on the copy:
  247 → **244** non-empty lines, 215 → **212** keys (the three dropped backend keys are the only removals),
  staging-carrying **key** lines 8 → **0**, `EXPO_PUBLIC_APP_ENV` → `production`, and JWT-valued keys
  1 → **0**: the recipe swaps the 208-char legacy `wnic…` anon key for the profile's 46-char
  `sb_publishable_…` one, which §15.3 measured as absent from every shipped bundle. Two things the recipe
  does **not** do: it does not restore the missing trailing newline (§15.2's append hazard survives a
  successful run), and it leaves the other **131** non-`EXPO_PUBLIC_` keys in place (134 − the 3 dropped;
  the 81 `EXPO_PUBLIC_*` keys are untouched in count). The guard from
  §15.1, run verbatim against the copy, **passes**; run against main's real file it **refuses** — which is
  the demonstration Step 4 wanted, obtained without touching the file.
- `node scripts/check-env-mocks.mjs` exits 0 on the patched copy (69/70 derived flags live, 1 allow-listed
  on mock: `EXPO_PUBLIC_SCHEDULED_USE_MOCK`) **and also exits 0 on today's staging-wired file**. That gate
  detects placeholders and mocks, not planes — the concrete reason Step 4's guard was necessary rather than
  decorative: nothing in the existing lane would have refused this build.
- `node scripts/check-env-mocks.mjs .env.production.example` exits **1** with 3 issues
  (`EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` still `CHANGE_ME`).
  The tracked example is a shape reference, not a drop-in — and the shipped file is 215 keys vs the
  example's 80, so it cannot be regenerated by copying the example.
- **A brief claim is false — and this section's first draft mis-stated the correction.** Step 2 justifies
  `EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL=https://www.spotlightng.com/login` by saying
  `.env.production.example:26` "states the prod value". Measured in both trees (the file is tracked and
  byte-identical): line 26 is
  `EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL=https://CHANGE_ME.example.com/login` — a **placeholder**, and it
  *is* an `EXPO_PUBLIC_` name (my first draft wrote "a non-`EXPO_PUBLIC_` name at that", which is wrong; the
  review caught it). The same sentence's other half is fine: `.env.production.example:19` genuinely is
  `EXPO_PUBLIC_SITE_URL=https://www.spotlightng.com`, and `:26` is the file's **only** `PASSWORD_RESET` line,
  so there is no other provenance to appeal to. The value the brief proposes is harmless but baseless — the
  name has **no reader anywhere** in the mobile lane (swept across `src/ app/ scripts/ eas.json
  build-aab.sh build-apk.sh`), and neither its 53-character value (0 occurrences) nor even its key **name**
  appears in the shipped bundle, which is what an un-inlined `EXPO_PUBLIC_*` looks like in practice. So: a
  user decision, or leave the line as-is. Do not let a future session cite `:26` as provenance.
- Recommendation carried to the user: regenerate and **rebuild**, then re-grep the artifact (§15.3's probe is
  the only proof that survives); do not sed-patch three keys and call the plane fixed, because the installed
  bundle is where the truth lives and it is 19 MB of stale bytes until a build runs.

### 15.6 What this task does not prove, and what is the user's to decide

- No build ran. Nothing was compiled, installed, uploaded, or submitted; **Play's current production bundle
  was not inspected**, so this section states what the three artifacts on this machine contain and claims
  nothing about what users have installed.
- `.env.production` is gitignored, so when the re-point is approved it will exist **only on this machine**.
  Every new build host starts staging-wired or empty, and `build-aab.sh:119-125` / `build-apk.sh:126-132`
  exit 1 when the file is absent — a new host must run the recipe, never `mv` the file aside.
  **No backup of the current file exists anywhere** (corrected after review: an earlier draft of this bullet
  told a future session to keep `.env.production.pre-cutover.2026-11-12` "and do not restore it", but that
  file is created *by* Step 2's `cp`, and Step 2 has never run — `find` over main, this worktree and `/tmp`
  returns nothing). Two consequences: today there is no safety net, so §15.2's sha256, byte size, line count
  and the `.env` comparison above are the only record of the current content — and `.env` differs from it in
  exactly one key pair, so the staging-wired original is in practice recoverable from `.env` if it is ever
  lost. Once Step 2 does run, the copy it makes *is* the staging-wired original: keep it, do not restore it.
- **Rotate the `wnic…` pooler credential.** `DATABASE_URL` in that file is a staging pooler DSN whose
  password surfaced in tool output earlier in this planning session. Treat it as exposed and rotate it, by
  whoever owns the `wnic…` project, before this plan is called closed. The 134 backend keys sitting in a
  mobile env file are the same class of exposure waiting to happen — the fix is to move them to the backend
  plane's own env, not to re-point the mobile file.
- **Known limit of the guard, as shipped.** It asserts that *the file it reads* declares `production`, plus
  the shadow refusal on `.env.<mode>.local` / `.env.local`. It does not assert anything about the process
  environment, and `@expo/env` lets an already-set variable win over the file — so a host that exports
  `EXPO_PUBLIC_APP_ENV=staging` in its shell, or an EAS run whose profile carries it, still outranks the
  check. Measured today: no such export, and `eas.json`'s `production` profile declares `production`, so this
  is a documented boundary rather than a live hole. The remaining true statement is §15.1's: the file's
  declaration is what the guard can prove.
- **Round 2 pinned that caveat's mechanism to the loader actually installed here.** `@expo/env@2.0.12` is the
  only copy a repo-wide `find` turns up (under `expo@54.0.37` / `@expo/cli@54.0.27`), and both of its
  mutation APIs skip a key already present in the environment — `loadEnvFiles` at `build/index.js:197` and
  the legacy `load` at `:317`, each printing `"…" is already defined and IS NOT overwritten` — while the
  *file list* is chosen from `process.env.NODE_ENV` (`getEnvFiles`, `:86-109`), which is what the two build
  scripts export. Nothing in the toolchain supplies `EXPO_PUBLIC_APP_ENV` on its own:
  `grep -ro 'EXPO_PUBLIC_APP_ENV' node_modules/@expo/cli/build` → **0 matches**. So the key has exactly two
  possible sources — the `.env*` files, which the guard now reads with loader parity, and an explicit export,
  which it cannot see — and that is the whole boundary. Worth knowing, because some `@expo/env` releases
  behave differently: 2.0.12's `build/` is a single `index.js` with no `getExpoEnv.js`, no
  `injectNativeFallbacks`, no `process.env` prefix filter (the file's only `EXPO_ENV` strings are the
  `__EXPO_ENV_LOADED` marker at `:78` and stale doc comments), and no `@dotenvx` installed. An SDK bump
  should re-run this check, not assume it.
- Task 16's inputs from this section, with the commands so the counts can be re-run (review Finding 8: an
  earlier draft gave a "11" that three reconstructions could not reproduce, so it is replaced by figures
  each tied to its own command, all run in this repo with the ledger itself excluded —
  `git grep -lE 'mobile-app/reactnative/\.env' -- ':!docs/devops/production-migration-ledger.md'` → **19**
  tracked files at this branch's HEAD and **18** at RELEASE_SHA `c49b395…` (18 also at `42759cfde`, the
  commit before the plan file was committed). The single differing file is
  `docs/superpowers/plans/2026-11-12-staging-to-production-migration.md`, whose own text names that path.
  This bullet formerly asserted "the same on both trees … so it needs no label"; Task 16 fix round 3
  invalidated that by committing the plan file, and fix round 4 re-ran the command and put the tree label
  back. The 18-file list below is the RELEASE_SHA/parent list; the 19th is that plan file.
  `git grep -l '\.env\.production' -- ':!docs/devops/production-migration-ledger.md'`
  → **33** at this branch's HEAD (**32** before the plan file landed, **31** at RELEASE_SHA), of which **6** belong to the *web* apps and are red herrings for a mobile
  doc fix (`frontend-admin/.env.production.example`, `frontend-admin/middleware.ts`,
  `frontend-admin/src/services/sprayAdminService.ts`, `frontend-web/.env.production.example`,
  `frontend-web/src/lib/config/index.ts`, and `frontend-web/config/production-module-flags.env`, which is
  **new in this branch** — Task 7 committed it, so the same command at RELEASE_SHA gives **31 of which 5**.
  Quote the tree with the number or the pair looks like a disagreement; and the same command restricted to
  `-- mobile-app` → **9**
  (`build-aab.sh`, `build-apk.sh`, `scripts/check-env-mocks.mjs`, `scripts/check-estate-mocks.mjs`,
  `docs/GO-LIVE-CONFIG.md`, `.vscode/tasks.json`, `.env.example`, `.env.production.example`,
  `src/features/marketplace/api/marketplace.api.ts`). Which list a doc fix needs depends on whether the
  sentence names the file or the plane, so report the list you used, not a count. Re-running these through
  a shell: pipe the count (`| wc -l`); one redirect-to-file invocation here returned zero matches with
  `rc=1` for a pattern that pipes 33, and an empty result from this command would read as "no references".
  The 18 (the RELEASE_SHA / pre-plan-file set; `HEAD` adds the plan file as the 19th):
  `MOBILE_SUPABASE_LOCAL_CONFIG.md`, `REGISTRATION_E2E_TEST_RESULTS.md`, `docs/CROWDFUNDING_GO_LIVE.md`,
  `docs/ENV.md`, `docs/audit/E2E_TEST_MATRIX.md`, `docs/devops/DEPLOY-RUNBOOK.md`,
  `docs/devops/GO-LIVE-FINAL.md`, `docs/e2e/results/mobile.md`, `docs/prd/golive/GO_LIVE_CHECKLIST.md`,
  `docs/prd/transportation/INTEGRATION-RUNBOOK.md`, `docs/qa/food-uat-332/cluster-c-discovery-cart.md`,
  `docs/qa/test-release-runbook.md`, `docs/runbooks/fx-e2e-test.md`, `docs/supabase-go-live.md`,
  `launch/CREDENTIALS.md`, `launch/apply-env.sh`, `launch/master.env.template`,
  `mobile-app/reactnative/docs/association/GO_LIVE.md`.
- Re-measurement entry points, left in this plan's SDD workspace for whoever takes Step 2: `guard-test.sh`
  (18 structural cases + 1 pipeline byte-identity + a 60-spelling loader-parity table; refuses to run
  against a tree with real env files), `env-parse-diff.mjs` (writes those 60 fixtures *and* prints dotenv's
  own `JSON.stringify(value)` + verdict for each — it `createRequire`s main's installed 16.4.7, so it needs
  no `node_modules` in the tree it sits in), `table-vs-dotenv.mjs` (diffs that output against the harness
  table: **60 rows, 0 verdict and 0 rendered differences**), `extract-probe.sh` (the shipped 13 inner
  pipeline lines on their own, no build script needed: **56 of 60 agree with dotenv, and the 4 that do not
  are exactly the 4 `divergent=` rows**), `old-vs-dotenv.sh` (the round-1 `1be3e158f` chain over the *same*
  table read out of `guard-test.sh`, which is where §15.1's 15-refused / 4-passed figures come from; give it
  a scratch directory holding that commit's `build-apk.sh`), `recipe-rehearsal.sh` (Step 2 on a copy),
  `bundle-scan.py` (the artifact numbers), `task-15-guard-red.txt` / `task-15-guard-green.txt` (the two
  harness runs quoted in §15.1), `task-15-locale-probe.txt` (the round-3 `LC_ALL=C` measurement). All are
  read-only against main and print no secret values; the two that write env fixtures into the tree they are
  pointed at — `guard-test.sh` and `old-vs-dotenv.sh` — must be given a scratch directory, never `main` or
  this worktree (`env-parse-diff.mjs` writes only to `/tmp/spot-env-fixtures`). **Measurer-only:** every
  evidence file named here lives in the git-ignored SDD workspace (`.superpowers/sdd/.gitignore` is `*`,
  `git check-ignore -v` confirms), so none exists in a clone and these figures cannot be re-run from the
  repository alone (the limit §16.1 labels on its plan-file row) — except `mobile-app/reactnative/build-apk.sh`, which is tracked and named only as a scratch input.

*This section was corrected on 2026-11-14 after its own review round: nine findings accepted, one (a
"254-character token nobody had traced") refuted by byte-offset measurement and replaced with the regex
caveat in §15.3. The code half of that round is `1be3e158f`; the dispositions are in*
`.superpowers/sdd/2026-11-12-staging-to-production-migration/task-15-report.md`.

*A second round followed the re-review of that commit: the guard's normalisation was rebuilt from dotenv's
own `LINE` regex and measured against 57 spellings, the shadow gate's `APP_ENV` term was scoped to
production builds, and this section's stale line citations, scanner-exemption citations and reference counts
were re-measured tree by tree. Code `65ee29ec0`, docs `b0ed83db2`. Everything in §15.1 and §15.6 above is
that round's text, updated by round 3.*

*A third round closed that re-review's five Minor findings, all of them about this section's accuracy rather
than the guard's behaviour: the bare-`CR` line-terminator class was measured, documented and pinned with
three fixtures (N-1); the whole-file `sed` was made locale-proof and the failure mode written down (N-2,
code `e16da72be`); the shadow pattern and main's SDK-refusal line were re-quoted from the files (N-3); the
round-1 comparison moved out of `/tmp` into the workspace and was re-sourced from the harness table (N-4);
and the parity table's displayed value column was normalised to `JSON.stringify` so the whole column diffs
against real dotenv, 0 of 60 rows apart (N-5). R2-3's shell-not-loader ruling gained its own bullet.*

---

## Task 16 — the docs the cutover outdated, and what still open (2026-11-14)

**Verdict: six** documents corrected and the plan file itself landed — **seven paths**
(`git diff --name-only 814f5d3e4..cfe0152a2`); the migration is not done, **and §16.3 is what makes that
unreadable-two-ways.** Every figure below was re-taken on 2026-11-14 with the command printed beside it.
Where a Task 16 brief stated a number that measurement did not reproduce, this section carries the
measured number and says the brief's was never taken — three of the plan's own docs argued wrongly about
production during this session's evidence-gathering, so "the plan said so" is not a source here.

### 16.1 What changed in each document

| File | Was | Now | Proof read |
|---|---|---|---|
| `docs/devops/deployment-matrix.md` §Authoritative paths, `backend` row | "last prod dispatch 2026-10-17", implying this plan moved it | split into **measured** (prod serves `585bd2ca7fab5c0a5adf9e67ab40b04068e9cee0`, read from `/api/v1/public/build`) and **PENDING, NOT DONE** (nothing in this plan deployed, dispatched or pushed this service; §10.6 requires re-reading `/api/v1/public/build` at execution time) | `curl -s https://www.spotlightng.com/api/v1/public/build` and the same path against `backend-production-1b33d.up.railway.app`: re-run 2026-11-14, **both → `200` with the same `commit` and the same `started_at`** (the bodies differ only in `uptime_seconds`, which is counted per request), so www proxies this route to the Go service instead of serving its own. Two earlier drafts of this cell were both wrong paths — the first used `/api/v1/health`, which answers a different question because a health body carries no SHA, and fix round 1 used the bare `/public/build`, which **404s on both hosts** (as HTML on www, as `No API route matches GET /public/build` on the Go host). The registered route is `/api/v1/public/build` (`internal/app/router.go`, and plan §1's own pin uses that path; only the plan's shorthand at `:1111`/`:1575` drops the prefix). Verification is by the served build id, never run colour. That SHA is the tip of `origin/chore/promote-prod-module-readiness` (PR #996), **not an ancestor of `origin/main`**, 7 ahead / 713 behind the pin. **Fix round 3 corrected the same cell's staging parenthetical**, which had been left reading `623c7c128…`: re-read 2026-11-14, `https://backend-staging-new.up.railway.app/api/v1/public/build` → `2a82a62ef…` with `started_at 2026-11-14T20:54:20Z`, and `origin/staging`'s tip at that reading is `2a82a62ef` |
| same file, Postgres row | "`db-migrate.yml` is dormant by design (AUD-INFRA-005)" | **not dormant**: triggers on push to `[main, staging]` with `supabase/migrations/**` + its own file (`:40-43`); `apply` runs on `(dispatch && target==production) \|\| (push && ref==refs/heads/main && vars.DB_MIGRATE_ENABLED=='true')` (`:79-81`) under `environment: production` (`:83`); `ops-db-push-scoped.yml` (`environment: production-db-scoped`, ungated, refuses the staging ref) — plus the bare `supabase db push` of the reconciliation runbook; fix round 2 then deleted the live run ids this cell had also been restating, so the cell points at §16.2 item 1 for them | `gh api …/actions/variables`; the two parked runs in §16.2 item 1 |
| same cell (corrected twice this round) | a first draft asserted the gate was `Production`'s **required reviewers**; this round then over-corrected it to "a gate exists, the rule is unconfirmed" because `deployment_protection_rules` returned `[]` | **required reviewers, measured.** `pending_deployments[].reviewers` on both parked runs carries two `User` entries with `wait_timer: 0` and `current_user_can_approve: false` for a non-reviewer. `deployment_protection_rules` lists *custom* rules (wait timers etc.), not required-reviewer rules, so `[]` is the expected answer and refutes nothing | re-read for `43299354226` and `43299959109`, both `env=Production reviewers=2`. **Ruling: this is a refuted review-of-my-own-hedge — the hedge was the defect, and it had also contradicted four sentences that were already correct: `:345` (inside **§2**, not §1.3 — that heading is `:118`), `:795` (inside **§3.12**, not §2 — that heading is `:781`), and `:1079` / `:1201` (**§2.5** and **§2.6**), all of which already said "required reviewers" and all four of which re-measure true today.** and the scoped lane is measured rather than hedged: the `scoped` job of `ops-db-push-scoped.yml` runs `environment: production-db-scoped`, that environment's `protection_rules` came back empty, and its run `43311344252` completed with zero `pending_deployments` entries |
| `docs/devops/backup-restore-runbook.md:37` | "not yet scheduled" (nobody's task) | unscheduled **on purpose**, with the owner named (whoever holds `nmseefdlliejmdbxytej` + the `Production` environment), the cadence (nightly; 30 daily + 12 monthly), and the note that `scripts/db/` is a reconciliation route, not a backup route | `git grep -ln pg_dump -- ':!docs'` → **no matches**, so no in-repo dump path exists to schedule |
| `docs/runbooks/referral-gate-parity.md` | a referral-specific incident | generalised to the 503 class, with `wallet` / `events` added as non-referral evidence rows; `frontend-web/config/production-module-flags.env` + `make flag-parity` named as the fix; a "Verify before claiming" section; the docker-compose note split into "still wrong" vs "out of date"; step 2 now reads the file rather than the cPanel console. **Fix round 1 added a host-attribution paragraph** after the measured table: the table's paths are BFF paths, `backend-staging-new` 404s on them, and the API's real referral paths (`/v1/referrals/me/dashboard` `referral_routes.go:204`+`:212`; `/api/finance/referral/my-rewards` `:133`) 401 on staging | all four prod probes re-run 2026-11-14 (503 ×4, strings verbatim); visibility re-probed 2026-11-14 against prod www `200`, `data.environment=production`, **31 names enumerated**, and the membership check that matters is per-name, not the count: present → `wallet`, `walletTransfers`, `events`, `restaurant`, `referrals`; **absent → `walletBankTransfers`, `beneficiaries`** (which is why §16.2 item 13 changed its subject). That is the two-levers point stated exactly: prod *visibility* lists `wallet`/`events`/`restaurant` while prod *www* still 503s them |
| same file, the lane commit citation | read as a commit in this repo | quotes the source verbatim: "branch `ops/prod-module-flags` at `5355d932581e…` is in the **destination** repo `paymax2022/spotlight-latest`, *not* in `spotlight-latest1`, so it will not resolve from this checkout." — the repo half is right and still measures; the state half went stale the same day and is corrected in §16.2 row 6. **The citation trap for the next reader: cite the squash `42789f45b`, not the branch tip `5355d93`.** | `git log 5355d932581e` in this repo → `fatal: bad object` (still true — different object store); the same SHA resolves in the destination worktree, and `git merge-base --is-ancestor 5355d93 origin/main` **there** returns false, because squash-merging writes a new commit and leaves the branch's own SHA outside main's ancestry |
| `docs/devops/staging-environment-setup.md` §"Remaining manual steps" | an unchecked 2026-08 checklist | per-step DONE / STILL-OPEN verdicts each with its command; a "deploy only to main, never staging" policy correction (`b5bc4480f` deleted `staging-frontend-web-deploy.yml`; `sync-frontend-web.yml:5-11` is main+development only; `db-migrate.yml:40` still makes a *staging* push a live DB-write lane); the 2026-08-21 figures marked superseded; a re-measured branch-drift table; the real **10** environment names with the `spotlight-platform / staging-new` vs bare-`staging` lookup trap; fix round 2 also stripped the three live run ids from its §"Remaining manual steps" prose and the two scoped-apply ids from its FALSE-marked 2026-08 block, pointing at §16.2 item 1 and §1.4 respectively; fix round 2 also marked the 2026-08-21 "still 11 migrations behind and was NOT touched" sentence **itself** (it had been relying on the FALSE block four lines below it) and double-pinned the branch-drift table, because `origin/main` advanced from `31505cb92` to `7a97609d0` while that sentence was being written — 19/4/1627 at the first pin, **22/4/1630** at the second (main's advance moves the outer numbers; `7a97609d0..623c7c128` is still 4), while `supabase/migrations` holds **755 files at both**, which is why the migration-count row below needed no re-measurement. **Fix round 3 corrected that round-2 attribution**: the doc had credited main alone with the middle number rising to **5**, which happened only when `origin/staging` itself moved to `2a82a62ef` (`7a97609d0..2a82a62ef` = 5), and it replaced the stale staging sentences in that file's drift discussion — "4 commits **ahead** of `main` (its tip is `623c7c128`)" and the build body `623c7c128…` / `started_at 2026-11-13T00:55:09Z` are now given as the 2026-11-13 capture beside the live 2026-11-14 read (`2a82a62ef…`, `started_at 2026-11-14T20:54:20Z`, 5 ahead) | `git show b5bc4480f --stat`; `gh api …/actions/runs?status=waiting`; `gh api …/actions/variables` (4 repo-scope, 0 env-scope); `git rev-list --count` on the three pairs, and `git ls-tree -r --name-only origin/main -- supabase/migrations \| grep -c '\.sql$'` at both pins |
| same file, the migration-file counts | "`origin/main`'s tree holds 754" | **755** as re-read at `origin/main` = `31505cb92`; the 754→755 step is `8ed8123de`, which added `20271411000000_reconcile_doctors_presence_backfill.sql`; plus an explicit **do not sweep-replace** note, because the `recorded: 754` and the `754 − 670 = 84` closures are pinned to `3654f6b3f` / `623c7c128`, both of which count 754 | `git ls-tree -r --name-only <ref> -- supabase/migrations \| grep -c '\.sql$'` → 754 / 754 / 755 / 755 for `3654f6b3f` / `623c7c128` / `8ed8123de` / `31505cb92`, and **755 again at the later tip `7a97609d0`** re-fetched ~3h after this row was written; this worktree holds 751 |
| `docs/devops/GO-LIVE-CHECKLIST.md` | a live checklist citing `VIDEOSDK_*` and "fill deploy.yml TODOs with your cloud" | HISTORICAL banner pointing at the matrix and this section — and it cites the stale rows **by searchable text, not line numbers** | `vars.GCP_PROJECT_ID` unset ⇒ every `deploy.yml` job skips (recorded in *Deferred by design*). Three drafts of that banner got its own citations wrong in a row: `47/33/58`, then `55/41/66` (read off the pre-banner file), then `56/42/67` — which the very next edit to the banner invalidated by adding a line. A file cannot cite its own post-edit line numbers, so the numbers are gone rather than re-guessed a fourth time. |
| `docs/devops/production-migration-ledger.md` §9.6 (this file) | "the 221 503 sites" | "**221 source lines** pairing a `503` with the string 'not available'… a code-surface count, not observed production traffic and not an incident tally" | `grep` over `frontend-web/src` at the pin — **authorised here**, as §10.7 flagged and §9.6's parenthetical now points at this row |
| `docs/superpowers/plans/2026-11-12-staging-to-production-migration.md` **added to the tree** | existed only as an untracked file in the live working copy, so every citation this ledger and the five docs make to "the plan" pointed at a path no commit contained | committed, so the plan travels with its evidence record. §1's parenthetical is rewritten to say where it can now be read (`feat/prod-cutover`, not `main`) | secret scan before staging it: no `eyJ…`/`sk_live_`/`sk_test_`/`AKIA`/`ghp_`/`sbp_`/`sb_secret_`/`-----BEGIN` match. `sk_test_` and `sb_secret_` are on the list even though both shapes are already present in this tree (§15.3: two fixture lines and one vendored string), because the scan's purpose is that no *production* secret ships, not that those test-prefix shapes are absent; the only credential-shaped fields are two 6-char **local-dev** DSN passwords plus one field that is not a credential at all — the literal text `<pw>`, a placeholder, which the plan's prod `pg_dump` line uses in place of the real pooler secret (so this commit ships no production secret). Counts re-taken for fix round 2 with the exact command the row prints: `git grep -l -F <value> <ref> -- . \| wc -l` → **253 and 453** tracked files at the parent `42759cfde`, **254 and 454** at this HEAD `cfe0152a2` — the +1 each is the plan file itself repeating them, values never printed. **This is the one §16 row whose command cannot be re-run by a reader who does not hold the two 6-char local-dev DSN passwords the plan writes into its `localhost`/`127.0.0.1` command lines (`:264` the classify probe, `:408`/`:410` `psql`, `:412` `pg_restore`, `:414` the `R=` rehearsal DSN, `:475` `export DATABASE_URL`); its one `pg_dump` line, `:393`, carries `<pw>`, not a password:** `<value>` is deliberately a placeholder, so the figures are measurer-only. That is a real limit of the row, not of its conclusion — the conclusion (no production secret ships here) rests on the `<pw>` sub-claim below, which anyone can re-run. The `<pw>` placeholder is in 0 files at the parent and 2 at HEAD (the plan, and one prose use in this ledger), which is what a short literal string matches incidentally and is not a leak. Fix round 1 wrote "253 and 453 at this HEAD", which was the parent's count, and a reviewer read 254/**455** here; round 2's re-measure says 454, so the disagreement is settled in favour of the printed command rather than either recollection. The conclusion is unchanged — this commit adds no value the tree did not already hold hundreds of times over — but under R31 a scan figure the printed command cannot reproduce may not stand. **The scan's own limit: it looks for shapes, not meanings; an operator who doubts it should read the file before shipping it.** |

Two brief-level claims were **refuted rather than edited**, and are recorded so nobody re-imports them:

- The brief's Step 1 says "**9 of the 13** publicIds return 404". The route has **13 `SPOTLIGHT/Banners/` literals / 12 unique** (`ChatGPT_Image_Sep_25_2026_09_27_19_AM_ywlasa` twice), and that is a scope, not the file: `frontend-web/app/api/media/banners/[slug]/route.ts` holds 16 lines matching `cloudinaryPublicId:` — 13 Banners literals, one publicId outside the folder (`Happy_Lagos_restaurant_delivery_nd1gdd` `:77`, never probed here), and two non-entries (the `CloudinaryBanner` type at `:31` and a pass-through at `:140`). Re-taken for round 2 so the next reader does not "correct" it: `grep -n` of `cloudinaryPublicId:` lines carrying the folder gives exactly **13** (`:52 57 62 67 72 82 87 92 97 102 107 112 117`), of which `:52` and `:117` hold the same publicId → **12 unique**; `grep -c 'SPOTLIGHT/Banners/'` returns **14** because `:48` is a comment naming the folder, and a `grep -o` of the publicId pattern reads 9 for `banner-*` prefixes only because the regex stops at the hyphen — which is why the count is taken per line, not per pattern match.
  and 2026-11-14 probing of `https://res.cloudinary.com/paymax/image/upload/…` — bare and with
  `f_auto,q_auto`, which agree — returns **4 × 200 and 8 × 404**. So the honest statement is *8 of 12
  unique publicIds (8 of 13 entries)*. The 9 was never measured.
- Nothing in the shipped docs contained a "24-key Railway scope" or "18 gate names / 337 files" figure.
  Those numbers came from controller narration, not from the diff; `grep -n '33 rows' docs/devops/` and
  its siblings returned no match, so nothing was "corrected" out and nothing needed correcting.

### 16.2 Still open, with the owner and the command that settles it

| # | Open item | Who can close it | What closes it |
|---|---|---|---|
| 1 | **Two production writes are parked for approval, and a third run had not reached an environment job.** Re-read in this session on 2026-11-14: `43299354226` (`DB Migrate (Supabase db push)`, head `3654f6b3f`, created 2026-11-12T20:20:40Z) and `43299959109` (`Ops DB Push (manual)`, head `3654f6b3f`, 20:24:15Z) are both `status=waiting`, each carrying exactly one `pending_deployments` entry on environment `Production`. `43534854471` (`DB Migrate`, head `8ed8123de`, 2026-11-14T00:32:20Z) reads `status=pending` with **zero** `pending_deployments` entries — it has not reached an environment job; recorded as measured, with no reason claimed, because nothing here proves why. **Ownership of these run ids, stated exactly**: this row is the record of their *current* state, and after fix round 2 no other tracked file carries any of them — `git grep -l -F <id>` over the tree returns this ledger alone for all six ids named here and in §16.1 (`43299354226`, `43299959109`, `43534854471`, `43311344252`, `43301433055`, `43309595782`), because `deployment-matrix.md` and `staging-environment-setup.md` now point here instead of restating them (a fourth copy of a live fact is a fourth way to be stale). Inside this ledger the ids do recur, and unavoidably: §1.4, §2.3, §2.4, §2.5, §2.6, §3.4, the Stage 2 (Task 5) heading and §5.7 hold them as the historical record of writes that already happened, and §16.1/§16.3 cite them as the run a correction was measured against. Fix round 3 re-measured that list with `grep -n -F <id> docs/devops/production-migration-ledger.md` per id, because round 2's sentence named only §1.4, §2.5 and §16 and was an under-count. Those are citations of a past measurement, not a second live state — only this row may be re-read for what is parked **now**. Read against §1.4 and §2.5: prod has **already been written twice** by `ops-db-push-scoped.yml` — `43301433055` (`mode=apply`, two versions) and `43309595782` (`mode=apply`, one) — three migration versions in all (`20271408000000`, `20271409000000`, `20271410000000`); the runs that read 669 and 670 between them were `mode=plan` and wrote nothing. That lane is now measured rather than assumed ungated: the `scoped` job of `ops-db-push-scoped.yml` sets `environment: production-db-scoped`, that environment's `protection_rules` is **empty**, and its run `43311344252` completed with **zero** `pending_deployments` entries. So "nothing was deployed" is true of the two gated lanes named here and of nothing else. | the two `Production` reviewers — logins from `gh api repos/paymax2022/spotlight-latest1/actions/runs/43299354226/pending_deployments --jq '[.[].reviewers[].reviewer.login]'` (2 entries) and the rule type from `…/environments/Production --jq '[.protection_rules[].type]'` (includes `required_reviewers`) — **not this agent**. An earlier draft of this cell cited `environments/Production` for `pending_deployments`; that endpoint returns no such key, which is why the reviewers are read from the run. | a human decision to approve or decline each. `gh run approve` was never run here and is on this plan's forbidden list: approving a `Production` deployment on someone else's behalf is exactly the side effect the gate exists to prevent. **This row is CLOSED as of 2026-11-16, and closed by the gate going away rather than by the queue being worked**: all three run ids above now read `completed` / `cancelled` with `pending_deployments` → `[]`, and `Production`'s `protection_rules` is `["branch_policy"]` with **zero** reviewers — the reviewers were removed on 2026-11-15, deliberately, per `db-migrate.yml:11-17`. "The two `Production` reviewers" no longer exist, so nothing in this repo parks for them any more. See `## Stage 3`, §6.4. It was closed by the gate being removed, not by anyone approving a run. |
| 2 | **DONE, by a route this row did not name.** It read "Prod `db push` has not happened (Task 6). Prod's pending count is a 2026-11-07 capture (§5.6) and must be re-read, not quoted." Prod's pending count has now been re-read, and it is **0**: 756 applied against 756 files, max `20271500000000`. | closed — the writes happened through `ops-db-push.yml mode=push` (2026-11-15T19:54Z, 676→755) and a `db-migrate.yml` `dry_run=false` dispatch (2026-11-16T15:20Z, 755→756), **not** through the scoped batches this row assumed | the fresh `mode=list` table, the classifier on it, the classifier on a prod-direct `psql` read, and `make rls-check`'s predicate at 0 rows — all four in `## Stage 3`, §6.3. The row's "in scoped batches, with a dump taken first" clause is **not** met: there was no backlog left to batch, and the dump post-dates the last apply by 1h45m (§6.5) |
| 3 | **No production dump exists** (Task 3). No in-repo route to make one either. | the `nmseefdlliejmdbxytej` key-holder | **Superseded for the dump itself, 2026-11-16 — see `## Backup`.** A prod dump now exists and is proven to restore (756 history rows, 1416 public tables, 1990 policies, `rls-check` predicate 0, ten exact row counts equal to live prod). The "no in-repo route" half is still true: `git grep -ln pg_dump -- ':!docs'` still returns nothing, so it stays a hand-run procedure and nothing prevents the next drift from being unrecoverable — which is the argument for a scheduled dump, not for this one. What is still owed is this row's own text: the runbook's restore rehearsal *against a dashboard backup id*, which only the key-holder can mint. |
| 4 | **CLOSED 2026-11-16, and without touching production.** It read: **`Production` env's `SUPABASE_PROJECT_ID` may still hold the staging ref** `wnicsubiznmishkmunsv`. The env-scoped variables list is empty and the repo-scope variable exists, so this is unverifiable from a review session — the second half of that sentence is what was wrong. | **closed from a retained log** — no new dispatch needed | `_reusable-db-apply.yml:60` binds `environment: ${{ inputs.target }}`, `:63` resolves the ref from that scope, and `:132-139` refuses unless it differs from `$STAGING_PROJECT_ID`. Run `43895117150` (today's `target=production` apply) printed `Production project ref is distinct from staging.` to stdout, and the branch is not vacuous: `Production` overrides only `SUPABASE_DB_PASSWORD`, so `SUPABASE_STAGING_PROJECT_ID` resolved non-empty from repo scope. Read with §6.1 (the only writer that could have applied `20271500000000`) and §6.3 (prod's own pooler DSN holding it), the linked project can only be prod's — an outcome inference, not a read of the masked value. Full chain in §6.8. |
| 5 | **Prod Go is not at `RELEASE_SHA`** (Tasks 11/12). It serves `585bd2ca7…` from a branch that is not an ancestor of `origin/main`. **Re-read 2026-11-16 and it has moved again without this plan moving it:** `/api/v1/public/build` now reports `5ab7c9cc0bf3d2b42aa43215fe5df9630dfbc421` (`source: ldflags`, `started_at 2026-11-15T09:00:26Z`) — the tip of the `prod` promotion lineage, likewise **not** an ancestor of `origin/main`, 8 ahead / 756 behind, and its tree carries only **643** of main's 756 migration files while prod's database holds all 756 (§6.7). So this row is now stated against a *third* value, which is the row's whole point: prod's Go plane is being moved by hand, outside this plan. | operator who dispatches the backend deploy | `/api/v1/public/build` reading `c49b395643473ba6ff7a225d7a7a339a41eddfe6`, plus login-page chunk hrefs matching the build (verification is by served bytes, never run colour). **Re-read the endpoint before quoting any value into that acceptance test** — it has changed twice since this row was written. |
| 6 | **Split 2026-11-16: the install landed, the read-back did not, and the read-back is now two different sizes of job.** It read: "The flag file and the CI gate exist; the host has not been shown to carry the 45 keys with no `FEATURE_*` in the process env." The install half is done on the host's own deploy path — PR #91 squash-merged into `spotlight-latest` main as `42789f45b` (15:01:54Z, still that repo's main tip), push-triggered run `43892014887` `completed success`, validator printing `flags: on=36 off=9 declared=45`, `Finalize on server` truncating `.env.production.local` to the 4 pinned keys (`deploy-cpanel.yml:440-445`) and **appending** the decoded block at `:454`. Neither show-half has been observed. | whoever holds the `CPANEL_SSH_*` secrets — the reach the lane already uses. Not this session: the read is on the box, and there is no SSH path from here. | **The old cell's blocker is falsified.** "The commit that would install it, `5355d932581e…`, is un-pushed and lives only in `/private/tmp/t8-lane`" — it is pushed (`git ls-remote origin refs/heads/ops/prod-module-flags` → `5355d932581e432924c5f3fa4db8d9d09b6607e6`) and merged. Cite the squash `42789f45b`, not that SHA: `git merge-base --is-ancestor 5355d93 origin/main` is **false** in the destination, because a squash writes a new commit and leaves the branch tip outside main's ancestry. **Reading the step, rather than trusting its name, is what splits this row.** The probe (`:98`) loops the four `.env*` files (`:137`) and `mask_values` (`:112`) prints *every* name in them, so the **next** `deploy-cpanel` run already shows whether the 45 keys are on the host — no new code needed, and the trigger does not have to be a commit: `on:` carries a bare `workflow_dispatch` (`:32`), so `gh workflow run "Deploy to Namecheap cPanel (SSH)" --repo paymax2022/spotlight-latest` re-deploys current main and produces the read. **Either route is a live production release** — rebuild, upload, Passenger restart — so it is the user's word to give, not a step to take quietly. The precedence half cannot be closed by any dispatch: its process-env reads grep `^(NEXT_PUBLIC_SUPABASE\|SUPABASE_SERVICE_ROLE\|GO_BACKEND)` only (`:160`, `:162`), and `grep -n FEATURE_ .github/workflows/deploy-cpanel.yml` at `42789f45b` returns two hits (`:314`, `:321`), both in the CI-side validator that reads the **repo file**, never the box. Since a real process env var outranks every `.env` file, "the file carries them" ≠ "the app sees them": closure needs step 5's dump showing the 45 names **and** `grep -c '^FEATURE_' /proc/$APP_PID/environ` → 0, which means one added line in that step. **Effect-level read exists (2026-11-16, PR #1050 head `9a0d18bb3`):** the flagprobe matrix ran the whole declared surface against production — 84 lines over the 45 names, `41×401` `25×405` `7×503` `1×404` `10 NO-ROUTE` — and **zero `=true` flags answer 503**, where the 2026-11-12 baseline had 28 of 36; the three named flip probes answer 401. That proves the web tier stopped refusing. It is not the host read, and it satisfies neither show-half above. Log-safety carries over from §7.7 — the same step echoes resolved URLs, so read its log with the value-stripping greps, not raw. |
| 7 | **The mobile prod plane is still wired to staging** (Task 15 Step 2, deliberately escalated). main's gitignored `mobile-app/reactnative/.env.production` (11,725 B, mtime Nov 3 22:25) declares `EXPO_PUBLIC_APP_ENV=staging` at `:24`, carries `wnic` ×4 and `nmseef` ×0, and **8 key lines** hold a staging ref: `EXPO_PUBLIC_API_BASE_URL` (:21), `EXPO_PUBLIC_SITE_URL` (:23), `EXPO_PUBLIC_APP_ENV` (:24), `EXPO_PUBLIC_SUPABASE_URL` (:25), `EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL` (:29), `SUPABASE_URL` (:126), `DATABASE_URL` (:145), `SUPABASE_JWKS_URL` (:231). Its own header (`:2`–`:5`) calls it a "STAGING env TEMPLATE / Copy to `.env.staging`", which is the root cause of the fork. | the user — it changes what a store build talks to, and the standing rule forbids correcting it unprompted | the re-point **plus** a real `EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL` **plus** a rebuild **plus** the artifact re-grep. **The acceptance grep is necessary, not sufficient.** It must be `grep -ic wnic` → 0 **and** `EXPO_PUBLIC_APP_ENV` reading `production`, NOT `grep -icE 'wnic\|staging'`: nine comment lines (`:2`, `:4`, `:5`, `:6`, `:8`, `:10`, `:16`, `:17`, `:112`) use the word "staging" descriptively, so the combined pattern can never reach 0 without rewriting prose. Clearing that grep only satisfies the plane guard — `build-apk.sh` then refuses on an empty `EXPO_PUBLIC_API_BASE_URL` (`:185-188`), a loopback host baked into it (`LOOPBACK_RE` `:231`, refusal `:248`) — **caveat: `ALLOW_LOOPBACK_CONFIG=1` downgrades that one refusal to a warning (`:243-246`), so the gate is conditional on an env var a caller can set**, a shadow `.env.production.local` / `.env.local` re-declaring `API_BASE_URL` / `SUPABASE_URL` / `APP_ENV` (`:198-208`), and any `*_USE_MOCK` not set to `false` (`:211+`); `build-aab.sh` carries the same chain. The re-point is done when the script exits 0 on its own gates, not when the grep goes quiet. |
| 8 | **`wnic…` pooler password was printed in project history.** | the key-holder | rotation. It is not repeated here and never will be. |
| 9 | **Split 2026-11-16: written and measured — the blocker moved from "nobody has done it" to "held for a production-facing merge".** It read: "`scripts/flagprobe.sh` and the acceptance matrix do not exist". The script exists (36 lines, mode 100755, derived flag → route from `feature-flags.ts` and the BFF wrappers rather than from flag names) and the matrix ran against production 2026-11-16 22:41–22:47Z: 84 lines over the 45 declared names, `41×401` `25×405` `7×503` `1×404` `10 NO-ROUTE`, with both probe branches proven to fire. Both are on `feat/flagprobe-acceptance` → **PR #1050** (head `9a0d18bb3`), deliberately unmerged. | the user's word on PR #1050; then the same operator the old cell asked for, for the live reads it recorded. | **Not closed on `main`.** `git ls-files \| grep -i flagprobe` still returns nothing at `origin/main` `c334b4aed`, so this row's own closure test is unchanged here. What changed is why it fails: not an unwritten probe but an unmerged one — #1050's diff adds a file outside `docs/**` and `**.md`, so `release-gates.py` classifies that SHA `proceed` and the merge rides gates → migrate staging → deploy Development + Staging → smoke → migrate **production** → deploy Production. Merging it is the closure; rolling it back afterwards is a redeploy of the prior SHA, not a revert. |
| 10 | **`SPOTLIGHT/Banners/*` art was never uploaded** — 8 of 12 unique publicIds 404 (§16.1). | whoever holds Cloudinary `paymax` upload credentials | an **upload**, not a code change. `SpotlightBanner` already collapses the misses, so no prod error depends on it. |
| 11 | **Half of this item is falsified.** It was written while the merchant-receipt tiers were uncommitted; they are on `origin/main` as of `fc705d58da05612f020e8d4f53d7b7eafdc1df1a` (#1013; commit date `2026-11-14T13:49:24 +0100` = 12:49:24Z, and the push run `43596691682` created 12:49:28Z — the run id, not the commit, is what that 28-second timestamp is), and that same PR seeds the outlet **owner's** `kyc_tier` through a new `seedRestOwner` helper — in *that commit's* tree (`fc705d58d:backend/internal/restaurant/merchant_receipt_live_db_test.go`), not in this branch's: `git merge-base --is-ancestor fc705d58d HEAD` returns false here and `git grep -l seedRestOwner HEAD -- backend` matches **zero files** — that pathspec excludes the only file in this tree which names it, so the grep proves the code is absent here in the weakest possible way; dropping the pathspec returns exactly `HEAD:docs/devops/production-migration-ledger.md`, i.e. this ledger quoting its own earlier claim. The helper's own text must therefore be read at that SHA, not here. §10.1 states the rule this citation was about to break: "Never cite a number across a tree boundary." Commit message: "fixtures now seed the outlet owner, the same way they already seeded the payer." So "green in CI only because that code is not on `main`" is no longer the mechanism that spares CI those six tests. What survives is the memory-backed claim that some `integration-verify.yml` lanes are red by choice, and this session could not re-observe it: the run that pushed `fc705d58d` (id `43596691682`) and the newest PR run (id `43600606809`) both conclude `success`, each with a single `verify` job. | **owner unverified.** The last human editor of the workflow file is `ayaaakinleye@gmail.com` (`1cf5e4fb6`, 2026-10-10), but file maintenance is not ownership — the user must say who may declare a lane intentionally red. | a `gh run view <id> --json jobs` capture of the specific run the user means, set beside `ci-lanes-left-red-on-purpose.md`. Until that exists this row is a recollection, not a measurement — which is exactly the standard §16.3 applies to itself. |
| 12 | **20 tracked files reference `mobile-app/reactnative/.env`** and will be stale the moment item 7 lands: `MOBILE_SUPABASE_LOCAL_CONFIG.md`, `REGISTRATION_E2E_TEST_RESULTS.md`, `docs/CROWDFUNDING_GO_LIVE.md`, `docs/ENV.md`, `docs/audit/E2E_TEST_MATRIX.md`, `docs/devops/DEPLOY-RUNBOOK.md`, `docs/devops/GO-LIVE-FINAL.md`, `docs/devops/production-migration-ledger.md`, `docs/e2e/results/mobile.md`, `docs/prd/golive/GO_LIVE_CHECKLIST.md`, `docs/prd/transportation/INTEGRATION-RUNBOOK.md`, `docs/qa/food-uat-332/cluster-c-discovery-cart.md`, `docs/qa/test-release-runbook.md`, `docs/runbooks/fx-e2e-test.md`, `docs/supabase-go-live.md`, `launch/CREDENTIALS.md`, `launch/apply-env.sh`, `launch/master.env.template`, `mobile-app/reactnative/docs/association/GO_LIVE.md`. Two are operational (`launch/apply-env.sh`, `launch/master.env.template`), the rest documentation. | whoever lands item 7 | `git grep -ln 'mobile-app/reactnative/\.env'` → **20** at this HEAD, measured both in the worktree and re-run against the `HEAD` tree; **19** at the parent `42759cfde`. Three drafts of this row disagreed with itself: fix round 2 left the headline saying 20 beside a proof cell still printing "19 today", and an earlier reading said 18 because it predates `fc705d58d` landing. Fix round 3 re-ran the cell's own command against both trees, so headline and proof now carry the same number: the 19 was correct *at the parent*, and fix round 1 had *added* the twentieth by committing the plan file, whose own text names that path (`git grep -c` → 3 matching lines in it). The enumeration above lists 19 and omits `docs/superpowers/plans/2026-11-12-staging-to-production-migration.md`; it is the 20th, and it is the one this branch controls. |
| 13 | **Bank-transfer payout decision** — §10.4's deferral, restated with the correct names. The payout rail is `FEATURE_BANK_TRANSFERS_ENABLED`, whose registry module is `walletBankTransfers` ("Wallet Bank Transfers", Block 11, `supabase/migrations/20261210000000_platform_module_registry.sql:89`). It is **not** `walletTransfers`: that is Block 10, Paymax-to-Paymax, under `FEATURE_WALLET_TRANSFERS_ENABLED` (`:88`) — a different rail, and this row's earlier draft conflated the two. Measured 2026-11-14 against prod www `GET /api/v1/modules/visibility` → `200`, `environment=production`, **31 names, and `walletBankTransfers` is not one of them** (nor `beneficiaries`), while `wallet`, `walletTransfers`, `events`, `restaurant` and `referrals` are. Yet Task 7's committed file says `FEATURE_BANK_TRANSFERS_ENABLED=true` (`frontend-web/config/production-module-flags.env:39`) and prod's backend env says `false` (§10.2). *Why* the module is unlisted is not decidable from here: either the `platform_modules` row is not published/ready in prod, or it is fine and the kill switch is what hides it — with no flag file installed on the web host (§16.2 item 6) `envFlag` reads absent, and absent is `false` (`envFlag` is the strict test at `frontend-web/src/lib/feature-flags.ts:21`; `:190` is only a call site). Separating those two needs a `platform_modules` read this session does not hold. | the product owner who answers §10.4 — a payout rail is a money commitment with a provider contract attached, so no one executing this plan may decide it | a recorded yes or no. `false` is a one-line edit at `:39` **before** Task 8 ships. `true` needs Task 13's backend write **and** a published, ready `platform_modules` row, because listing is the second lever and the module is not listed today. |
| 14 | **`#996`-vs-main drift**: prod's serving SHA is 7 ahead / 713 behind the pin and is not an ancestor of `origin/main`. **Re-read 2026-11-16 against prod's current SHA:** prod now serves `5ab7c9cc0…`, which is **8** ahead / **756** behind `origin/main` and 8 ahead / 713 behind the `RELEASE_SHA` pin — so the drift is not only still live, it has grown by one commit and the promoting branch has moved on twice. `git merge-base --is-ancestor` proves it rather than asserting it, and the tree it was built from carries 643 migration files against prod's 756 applied (§6.7). | the operator in item 5 | a promotion decision — deploying the pin silently *removes* whatever `5ab7c9cc0…` carries that `main` does not (measured: `comm -23` of the two `supabase/migrations` trees → **0**, so on the migration axis the prod branch adds nothing main lacks; the risk is in the Go and web source, which this row has never enumerated). This is the single largest un-addressed risk in this section and no earlier task named it. |
| 15 | **`FEATURE_UTILITY_CARD_LEDGER` is a money-path gate the CI parity check cannot see.** Both planes read it directly — web at `frontend-web/src/server/utility/service.ts:85`, Go at `backend/internal/utilitybills/service.go:1451` — and it is absent from `frontend-web/config/production-module-flags.env`, so it is outside the gate's `envFlag('NAME')` surface; unset means off on both planes, so card-paid utility bills post nothing — the ADR-PR701 default, and a state no env read in this ledger contradicts. Recorded in §10.3 rather than fixed in the file, because a `=false` line moves the declared and off counts in every place this ledger and the plan state them. | the operator who owns the card-bills ADR and Task 13 | `grep -c '^FEATURE_UTILITY_CARD_LEDGER=' frontend-web/config/production-module-flags.env` → 0 today; plus a card-paid bill probe before and after the name is set on both planes. |

### 16.3 Step 3's checklist — verified vs not, per row

The brief's rule: "Every row is a command someone ran, with the value it returned written in the ledger
beside it. No row may be closed on recollection, and the migration is not done while any row is
unverified." Re-counted on 2026-11-16 this gives **7 of 15 verified, 4 half-verified, 4 not done** — and
the sentence had already fallen behind its own table once before today: `## Backup` turned row 3 into a
half and nobody re-added the tally, so the "6 of 15 verified, 3 half-verified, 6 not done" printed here
was really 6 / 4 / 5. The four halves each fail a different way: row 3 proves a restore into a *fresh*
database but cannot roll prod in place, because only the key-holder can mint the dashboard backup; row 5
is true about *what* and false about *when* (staging reconciled after the
prod writes); row 14 is a refusal that shipped on an artifact that was never rebuilt; and row 15 shipped
its docs on 2026-11-15 but still names owners for only thirteen of fifteen
items. Row 6 left the not-done column today — see `## Stage 3`, §6.3.

| # | "Done" means | Status 2026-11-14 | The value |
|---|---|---|---|
| 1 | `RELEASE_SHA` pinned, read back at 40 hex | **VERIFIED** | `c49b395643473ba6ff7a225d7a7a339a41eddfe6`, 40 chars, `git cat-file -t` → `commit`, subject "fix(health): run the telemedicine intake after payment (#992)" |
| 2 | `list-pending.sh` + its test committed, test prints `PASS` | **VERIFIED** | §2 |
| 3 | A prod dump exists **and** restores, `supabase_migrations` = baseline | **MET for the fresh-DB restore — the in-place half is still open** | `## Backup` (2026-11-16): 10,671,662-byte custom dump, `sha256 848855b4…`, kept at `~/Documents/spotlight/backups/`; restore lands **756 / 1416 / 1990 / 9 / 356** and `no_rls_minus_allowlist = 0`, each exactly equal to the live prod read, plus ten exact row counts. "Baseline" is **prod's count at dump time**, not this row's original `667`. Still open: Task 3 Step 1's dashboard/PITR backup id, which no agent can mint, and which is the only in-place prod rollback route |
| 4 | Release SHA's migrations replay from zero on `postgis/postgis:17-3.4`, `rls-check` clean | **VERIFIED** | §Stage 1 |
| 5 | Staging reconciled to 0 pending before any prod write | **STATE VERIFIED / ORDERING NOT MET** | §5.4: `0 pending`, `recorded: 754`, `remote max applied: 20271410000000` — all real, and all of it **after** the prod writes, not before. Staging's nine applies land inside `43319774515` at 22:26:52–22:27:09Z on 2026-11-12 (§5.3); prod was already written twice that evening — `43301433055` at `20:33:13Z` and `43309595782` at `21:22:19Z` (§1.4, §2.5)  — 1h53m and 1h04m earlier respectively, so the write that moved prod to 670 is barely an hour ahead of staging's reconciliation, not ninety minutes. So the row's second clause fails: **prod migrations were applied against a staging schema that was not yet reconciled.** Reconciling staging first is what would have made prod's set derivable from staging's; that ordering was not honoured and cannot be repaired retroactively — it is a fact about the past, and the only forward-looking obligation it leaves is §16.2 item 2 (prove prod's own 0-pending on a fresh `mode=list`). |
| 6 | Prod at 0 pending on a fresh `mode=list` table | **VERIFIED (2026-11-16)** | `## Stage 3`, §6.3. Fresh dispatch `43916692518` (`ops-db-push.yml`, `environment=production`, `mode=list`, 17:16:48Z, wrote nothing — both mutating steps are `if:`-guarded off `mode`) → 760 `\|`-bearing log lines, **756** distinct `Remote` versions, max `20271500000000`, no local-only row. `scripts/db/list-pending.sh --remote-table` on it prints `-- remote max applied: 20271500000000 \| recorded: 756` and `grep -c '^pending'` → **0**, with `recorded: 756` equalling the tree's 756 files. Cross-read from prod's own pooler (`postgres.nmseefdlliejmdbxytej`) agrees set-for-set (`comm` → 0 / 0), which is also the only thing that attributes the lane's read to a plane at all, since the step prints `SUPABASE_PROJECT_ID: ***`. §5.6's 88 stays a 2026-11-07 capture — this row no longer rests on it |
| 7 | `production-module-flags.env` committed: 45 lines, 36 `=true`, 9 `=false` | **VERIFIED** | `make flag-parity` → exit 0, `prod-flag-parity ✓ — 45 flags declared (36 on, 9 off)`; file is 90 physical lines, 45 of them assignments |
| 8 | The cPanel runtime env carries those 45 keys, no `FEATURE_*` in the process env | **NOT DONE** | The lane has since dispatched and installed: destination PR #91 (`42789f45b`) → `Deploy to Namecheap cPanel (SSH)` run `43892014887` → the lane's own validator printed `flags: on=36 off=9 declared=45`, and six baseline-503 routes answer 401 (§Task 14 (partial), 2026-11-16). Two clauses still fail: the flip evidences 6 of the 45 names, not 45, and **no `FEATURE_*` in the process env** has never been read on the host. §16.2 item 6 stands until that env read exists. |
| 9 | `make flag-parity` green **locally and in CI**, and proven to bite | **VERIFIED** | local: exit 0 + `test-prod-flag-parity.sh` → `PASS`; the bite is pinned by the red capture. **CI executed it on 2026-11-15 and it passed**: PR #1028's run `43698229085` (the PR was a draft at the time), job `132763388007` (`prod-flag-parity`, 11s), which runs the bite test before the check exactly as `ci.yml:136-147` specifies. Until that push no runner had read the job — `git ls-remote --heads origin` found no such ref, `gh api …/commits/814f5d3e4/check-runs` → 422 *No commit found*, and `git branch -r --contains 0a7f499dfc1e39a495e3e87896d49dc1b1afdbea` → **empty**. **After the merge** (2026-11-15, squash `2e200094b74450a40aa0a5bc276d666421fc848b`) the job is on `main`: `git show origin/main:.github/workflows/ci.yml` piped to `grep -c prod-flag-parity` → **7**. `git branch -r --contains 0a7f499dfc…` still prints only `origin/feat/prod-cutover`, because a squash copies the content without the ancestry. |
| 10 | Money-path rulings recorded per name (both web planes + the Go route group) | **VERIFIED as a record** | rulings: §10.3 (the brief's three names, each with both-plane reads and a probe that would flip it, plus `FEATURE_UTILITY_CARD_LEDGER` — the money name the gate cannot see, added by the final review) and §10.4 (a fourth name the task found and overruled its own brief on). The reads those rulings rest on: §10.1 (HTTP probe table, 8 rows, with same-group controls) and §10.2 (the Railway env read). Read the verdict narrowly — "recorded" is not "decided": §10.4's ruling is explicitly *deferred to the user*, so one of the five money names is ruled-but-open, and §10.3's `FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED` stays off on a reasoning chain, not a green test. |
| 11 | Nine missing backend flags set; five provider keys copied without printing a value | **NOT DONE** | Task 13; the copy step is operator-only by design (never print secret values) |
| 12 | Prod Go reports its build id == `RELEASE_SHA` (the plan's row 12 names it `/public/build`; the route that answers is `/api/v1/public/build`); login chunk hrefs match | **NOT DONE** | §16.2 items 5 and 14 — measured *against*: prod reports `585bd2ca7…`. **Re-measured 2026-11-16: `/api/v1/public/build` → 200, `commit 5ab7c9cc0bf3d2b42aa43215fe5df9630dfbc421`, `source ldflags`, `started_at 2026-11-15T09:00:26Z`** (§Task 14 (partial)) — that is `fix(health): port the telemedicine intake fixes onto prod (#1025)`, so the row is now refuted by a *third* value rather than the second: prod's Go plane moves without this plan moving it, and Task 11's pin-and-promote still has to decide what to do about that. |
| 13 | Acceptance matrix committed with `scripts/flagprobe.sh`, no `=true` flag answering 503 on a real gated route | **NOT DONE** | §16.2 item 9. **Both halves moved on 2026-11-16.** The second half is no longer **false**: the four names this cell listed as still 503-ing — `FEATURE_EVENTS_ENABLED` `:44`, `FEATURE_RESTAURANT_ENABLED` `:60`, `FEATURE_WALLET_ENABLED` `:70`, both referral names `:58-59` — flipped 503→401 once destination PR #91's lane installed the flag file, measured on six route paths in §Task 14 (partial). What still holds the row open is the first half: `scripts/flagprobe.sh` and the matrix themselves are uncommitted, and a six-route probe round is not the 45-name sweep, so the "no `=true` flag answering 503" clause is evidenced for 6 names and unmeasured for the other ~29 that have BFF routes (§7.4's ceiling). `docs/runbooks/referral-gate-parity.md:34-38` still prints the 2026-11-14 503 captures as its measured table and needs re-capture before it is cited again. `FEATURE_EVENTS_ENABLED` on the prod **backend** env was still never read anywhere in this plan, so the backend half of that row cannot be closed from here. |
| 14 | Shipped AAB has zero `wnic…` / `frontend-web-staging…` strings; `build-aab.sh` refuses a prod build whose env declares staging | **HALF** | refusal: **done** (`f6e49a31c` → `e16da72be`, §15). AAB zero-strings: **not done** — no rebuild happened, because the env file it would read is still staging (§16.2 item 7) |
| 15 | Four outdated docs corrected, still-open list named with owners | **docs SHIPPED / owners partial** | **seven paths, not four** — the brief's `Files:` list names four (`deployment-matrix.md`, `backup-restore-runbook.md`, `referral-gate-parity.md`, `staging-environment-setup.md`); `GO-LIVE-CHECKLIST.md` is the fifth, and it is the one Task 16's survey **added** to that list — the brief had raised it only in Step 1's prose ("should be marked historical"), not under `Files:`. Fix round 3 corrected this cell's earlier claim that the survey also added `backup-restore-runbook.md`: the brief already lists it, with the `:37` target quoted verbatim. `production-migration-ledger.md` is the sixth (its §9.6 mislabel), and the plan file is the seventh. An earlier draft of this cell said "six" and reached it by omitting the ledger itself. The corrections were branch-only until 2026-11-15: the operator authorised the merge, PR #1028 landed as squash `2e200094b74450a40aa0a5bc276d666421fc848b`, and `origin/main` — the copy a reader actually opens — now carries them. That squash also carried one `frontend-web/` path (`config/production-module-flags.env`), so the merge was a production release: `sync-frontend-web.yml` run `43732146898` and the destination `Deploy to Namecheap cPanel (SSH)` run `43732180593` both concluded `success`. The owner column is **not** complete and the row no longer claims it is. Re-read cell by cell: thirteen of fifteen point at someone — two key-holders (items 3 and 8), the two named `Production` reviewers (item 1), the user (item 7), and nine holders defined by a capability they hold ("the operator who can dispatch X", items 2, 4, 5, 6, 12, 14, 15, plus item 10's upload-credential holder and item 13's product owner) — while item 9 names a role only after stating outright that no human is recorded for it, and item 11 states outright that its owner is unverified. Naming a capability is not naming a person, so those thirteen are *reachable* owners rather than assigned ones; the two disclaiming rows are the ones that cannot even be reached. Scored honestly, row 15 is **three-quarters**: docs corrected and merged to `main`, still-open list named, owners named for thirteen of fifteen. |

### 16.4 What this plan does **not** claim

It does not claim the staging→production migration is complete, or close. Seven of fifteen acceptance rows
verified, four half-verified, four not. What it did achieve: production's flag surface now has a committed
source of truth and a CI guard — a guard that passes in CI as well as locally (§16.3 row 9) — the
reconciliation tooling exists and is tested, staging is at 0 pending, **prod is at 0 pending too (§6.3)**,
and the docs no longer describe
production wrongly — they landed on `origin/main` on 2026-11-15 as squash `2e200094b` (PR #1028), which is
the copy a reader opens. These are prerequisites for what §16.2 still carries open — **twelve of its fifteen
rows**, with three closed (items 1, 2 and 4) and item 6 narrowed today to its read-back half — not §16.3's
fifteen checklist rows, whose count is seven verified for a different reason — not substitutes
for them (§16.2 row 4 closed itself on 2026-11-16 from a log this session already held — §6.8). Two of this plan's
four operator-owned gates have since closed from the other side: the
parked approvals are gone (all three runs ended `cancelled`, and `Production`'s required reviewers were
removed on 2026-11-15 — §6.4), and prod's `db push` has happened (§6.1). That leaves the cPanel **read-back**
— the lane itself merged and deployed on 2026-11-16, so what remains is showing the host carries the flags
(§16.2 item 6) — and the mobile re-point. The removal is not a convenience — it is the reason the last
paragraph's caution now reads differently: with no reviewer between a dispatch and the live production
database, what protects prod is the per-lane additive-only guard, and `ops-db-push.yml mode=push` has none
(§6.4). Item 14 — the `#996` drift — should still be settled before item 5, because promoting the pin is not
a no-op on a production that is already ahead of it; re-measured 2026-11-16 that lead is **8** commits, not
the seven this row long stated, against a prod-serving SHA this plan did not choose (§6.7). Closing Task 6
also surfaced a gap no acceptance row in this section names: prod's database holds **756** migration
versions while the tree prod's Go binary was built from carries **643** of `main`'s files, so prod's schema
is 113 migrations ahead of prod's code and every further whole-remote apply widens it (§6.7). That is the
safe direction under additive-only — dark, not broken — but it is a real divergence between the two halves
of "production", and this plan has no task that measures it, only Task 11, which would incidentally fix it.

*No deployment approval, no `workflow_dispatch`, and no secret value appears anywhere in this section. The
plan branch was pushed as draft PR #1028 on 2026-11-15 for one reason: a gate no runner had read could not be
claimed as green, and `gh api …/commits/814f5d3e4/check-runs` → 422 "No commit found for SHA" is the evidence
§16.3 row 9 rested on until that run. The merge itself happened on the operator's explicit instruction later
that day, as squash `2e200094b`; the two runs it triggered are recorded in row 15.*

---

## Post-cutover record — the Film Academy pricing schema reaches production (applied 2026-11-11 and 2026-11-15; written 2026-11-16)

Not a plan task and not numbered as one: Tasks 1–16 never owned this, and no task's close-out
mentions it. §5's rule binds — append-only, so the §3.5 measurement this supersedes is left exactly
as Task 1 recorded it, including the row below that §3.5 uses as its illustration.

It was looked for because `https://www.spotlightng.com/service-details/film-academy` served no
pricing section while the same code on localhost served the whole ladder. That report had two
independent production causes and only one of them is a migration: prod's Next runtime Supabase
credential was failing **every** server-side read — anon-client ones too, so `/api/v1/contests`,
`/api/v1/contests/<uuid>` and `/api/academy/apply` were all 500 for real visitors — and that is what
hid the section, because `app/service-details/film-academy/page.tsx:306` is the `areas.length > 0`
guard that wraps the whole `<section id="plan">` (`:176` carries the matching jump link, whose comment
states the rule: "The pricing section only renders once areas are published"). The missing academy
pricing schema was the *smaller* half: it kept `tuition` in the failed-read banner and made admin
per-area price edits fail, but could not hide anything. `src/server/services/academy/pricing.ts`
supplies the ladder in code — `attachPricingOptions` (`:105`) maps `ACADEMY_PRICING_STRUCTURE` (`:30-36`)
and takes `stored.find((o) => o.key === def.key) ?? def` (`:126-127`), so an area whose option rows are
missing is still priced at the approved ₦50k/80k/100k/150k/200k.

The credential half has no run id. It was edited by hand in the runtime env on the cPanel box, and no
workflow in this repo can reach that file — `deploy-cpanel.yml` has never carried its `CPANEL_SSH_*`
secrets, and the `Production` GitHub environment holds only `SUPABASE_DB_PASSWORD`. That is recorded
here because the page works and the ledger would otherwise imply a migration is why.

### P.1 Production's state before the writes, read by the lane that wrote

- **Probe:** `gh run view 42983104867 --log` → job `supabase db apply (scoped, production)`, step
  `Prove the connection and read history state (read-only)`
- **Observed:** `remote history rows: 663`, then `20271060000000: not recorded`,
  `20271095000000: not recorded`, `20271095000001: not recorded`, `20271095000002: not recorded`.
  The next read-only step, `Active interest-area count (read-only)`, printed
  `active academy_interest_areas = 8`.
- **Expected before running:** the versions the dispatch targeted absent from history — that is what
  the dispatch existed for. Whether the list was three or four was not settled until the `VERSIONS:`
  line in P.2 printed.
- **Verdict:** pass
- **Drift vs baseline:** the `663` is the same Remote count §3.5 carries, so §3.5's illustrative row
  `` `20271060000000` | ` ` `` — the LOCAL-ONLY shape it warns about — is prod's state as of the
  2026-11-07 run §3.5 measured on, and is no longer true from 2026-11-11. Read P.2, not §3.5, for the
  current value.

The 404 that started the hunt (`GET /rest/v1/academy_area_pricing_options` → `PGRST205`, table
genuinely absent) is deliberately not cited as this ledger's before-state: it was a one-off curl
against the live project with no run behind it. Four `not recorded` lines from a job that reads
`supabase_migrations.schema_migrations` prove the same thing, reproducibly.

### P.2 The scoped apply — four versions, one at a time (2026-11-11T07:56Z)

- **Probe:** `gh run view 42983104867` — workflow `Ops DB Push (scoped)`, run number 6,
  `workflow_dispatch`, created 2026-11-11T07:56:02Z, job `supabase db apply (scoped, production)`,
  steps `Re-check every selected file is additive-only` → `Apply the selected versions one at a time`
  → `Verify history rows and remaining pending`
- **Observed:** `VERSIONS: 20271060000000 20271095000000 20271095000001 20271095000002` with
  `CONFIRM: SCOPED`; four `additive: <file>` lines; four `== applying <version> ==` blocks each
  ending `✓ applied + history recorded`; then `recorded:` × 4 and
  `local migrations still without a history row: 83`.
- **Expected before running:** **three** files — `20271060000000` plus the two label restatements.
  That was the count the debugging session carried into its own summary, and it was wrong. The
  dispatch list held four: `20271095000002_academy_pricing_selections.sql`, the per-area format map
  the pricing accordion writes, belongs to the same change. Recording three would leave that
  column's origin unexplained for the next reader of `academy_pricing_selections`.
- **Verdict:** pass
- **Drift vs baseline:** four versions move `not recorded` → `recorded`. The `83` is **not** §3.5's
  `86` minus 4, and no arithmetic should be read into it: §3.5's 86 counts Remote-empty pipe rows in
  `supabase migration list` output, while this step counts local versions with no history row via
  `psql` over an explicit version array — two denominators §3.5 already warns are not
  interchangeable (the same section documents a 749-vs-663 sweep that turns into a false all-green).
  No post-write history total was printed, so `663 + 4 = 667` is arithmetic on this file, not a
  measurement, and is not claimed.

Three earlier dispatches of the same workflow did not write anything: run numbers 1 and 2
(42981056816, 42981368514) failed inside ~20 seconds in `supabase db plan (scoped, production)`, and
run 42981674376 failed with `::error::psql is not on this runner; refusing to start.` and
`::error::the direct db host has no A record on this runner; nothing to dial.` — which is why the
successful lane resolves prod through the session pooler (`Resolve the production DSN (session pooler;
values never printed)`) rather than the direct host. The first two runs' failure text is not
recoverable from `gh run view --log-failed`, so their cause is **not recorded here**; that is a gap,
not a clean sweep.

### P.3 The fifth academy pricing file landed four days later, by the full sweep

- **Probe:** `gh run view 43755019295 --log` → `Ops DB Push (manual)` run number 37,
  `workflow_dispatch` from `main`, created 2026-11-15T19:54:25Z, conclusion `success`, job
  `supabase push (production)`, `MODE: push`, `CONFIRM: PUSH`, command `supabase db push --linked
  --include-all`
- **Observed:** 79 `Applying migration` lines. Seven are academy files, including
  `20271095000003_academy_area_options.sql`, `20271089000000_academy_default_film_curriculum.sql`,
  `20271090000000_academy_film_module_quizzes.sql`, `20271098000000_academy_exam_windows_and_curriculum_fill.sql`,
  `20271200000061_academy_tmfa_curriculum.sql`, `20271300000010_academy_assistant_chatbot.sql` and
  `20271400000200_academy_tmfa_curriculum.sql`. In the `supabase migration list --linked` table printed
  immediately before the push, `20271095000003` shows a **Remote-empty** row — §3.5's LOCAL-ONLY class
  again — and the same version shows Remote-filled in the identical table printed after it. Independently,
  `20271060000000` already shows **Remote-filled** in the *before* column, which corroborates P.2 from a
  different run four days later.
- **Expected before running:** the `20271095000003` row to be empty, since the scoped lane at P.2
  listed only `…000000/…09500000/…09500001/…09500002`.
- **Verdict:** pass
- **Drift vs baseline:** the pricing-schema class §3.5 illustrates is now closed for all five academy
  pricing/selection files: four by P.2, the fifth here. The `--include-all` requirement §3.5 records
  is demonstrated by this run rather than argued — `20271095000003` is back-dated below prod's max
  applied version, so a plain `db push` would have skipped it.

### P.4 Served-bytes verification, per §4's authority rule (2026-11-16)

§4 says a lane's colour is not evidence of what the site serves, so the schema records above are
worthless without this.

```bash
curl -s -o /tmp/fa.html -w '%{http_code} %{size_download}\n' \
  https://www.spotlightng.com/service-details/film-academy
# Occurrences, not lines: the page is one HTML line, so `grep -c` reports 1 for everything below.
# The `_56W1uG_` prefix below is a CSS-modules build hash and will not survive the next build —
# re-derive it (`grep -o '_[A-Za-z0-9]*_matrixArea' /tmp/fa.html | sort -u`) before trusting a zero.
grep -o "could not be read right now" /tmp/fa.html | wc -l
grep -o "price_ngn"                    /tmp/fa.html | wc -l
grep -o "pricing_options"              /tmp/fa.html | wc -l
grep -o "1 month - Boarding"           /tmp/fa.html | wc -l
grep -o "_56W1uG_matrixArea"           /tmp/fa.html | wc -l
curl -s -o /dev/null -w '%{http_code}\n' https://www.spotlightng.com/api/academy/apply
curl -s -o /dev/null -w '%{http_code}\n' https://www.spotlightng.com/api/v1/contests
```

- **Observed:** the page is **200, 81,856 bytes**; the failed-read banner appears **0** times;
  `price_ngn` appears **40** times and `pricing_options` **8** — five priced options on each of
  **8** areas — with labels `Weekend (No Boarding)`, `Weekend (With Boarding)`,
  `Week days (No Boarding)`, `Week days (Boarding)`, `1 month - Boarding`. Each label appears 12
  times: eight per-area payloads, then the rendered accordion `<li>`, price-row `<dt>`, table
  `<th>`, and one FAQ sentence. The rendered comparison table carries **8** area rows — Acting,
  Cinematography, Editing, Film Directing, Producing, Production Design, Script Writing, Sound.
  `/api/academy/apply` → **200** with `"batch_name":"Batch A - 2026"`; `/api/v1/contests` → **200**.
- **Verdict:** pass — the section renders on production, and the routes that were 500 for visitors
  answer 200.
- **The limit of this read, stated so nobody over-reads it:** served bytes prove the section renders
  and that neither academy read *errored*. They do **not** prove the `academy_area_pricing_options`
  rows are what is being served, for two reasons this file should not let anyone forget:
  1. **The prices and labels are not discriminators.** `ACADEMY_PRICING_STRUCTURE`
     (`pricing.ts:31-35`) carries the same five prices *and byte-identical labels* to
     `20271095000001` — `1 month - Boarding` is in both. So the label set cannot even establish which
     migration is the latest one the DB reflects, let alone whether the DB was consulted. (The
     original `20271060000000` seed did differ — `Weekend — Saturday & Sunday` with the boarding
     detail in `note`, not `label` — but since the fallback matches the *restated* strings, that
     difference is evidence about nothing.)
  2. **Banner absence is weaker than "the read returned rows".** `catalogue.ts:115-117` appends
     `tuition` to the banner only when PostgREST *errors* (`if (optionError) loadErrors.push('tuition')`),
     and `page.tsx:231` is what prints it — `Some catalogue details ({loadErrors.join(', ')}) could not
     be read right now`. A successful read of an empty table errors nowhere, prints no banner, and hands
     `attachPricingOptions` zero stored rows — which renders the identical ladder. Zero banner
     occurrences therefore rules out a failed read, not an empty one.

  What does establish that the rows exist is the write evidence, not this read: P.2 and P.3 record the
  applies landing, and `20271060000000` inserts the five rows per area in the same migration file that
  creates the table — so the table's presence and its seed are one atomic event, and P.1 proved the
  table was absent beforehand. The open inference is only that nothing deleted those rows afterwards;
  no probe here reads the table directly. The app's own read goes through `createAdminClient()`
  (`catalogue.ts:96`) with the service credential, which is not in this repo, and the publishable key
  that is checked in does not authenticate against the production project.

### P.5 What this section does not prove

It does not prove the 83 local-without-history versions are harmless. That `83` is the residual the
P.2 verify step printed *after* its own four applies, so it does not include them, and no task has
enumerated the list. It does not prove prod's `academy_settings` row is what the admissions team
wants, only that the read answers — a thrown settings read would have pushed `fees` into the same
banner P.4 counts as zero. It does not record the credential change beyond the fact that it happened
by hand: nobody has read the value, and the value should not be pasted into this file. And it does
not close §16.3 row 12 — the acceptance matrix still wants prod to report `RELEASE_SHA` from
`/api/v1/public/build` and the login chunk hrefs to match, which is a different surface than the one
this section is about.

## Task 14 (partial) — the crypto gate re-measured, and the probe that could not have failed (2026-11-16)

**Why this section exists.** The cPanel flag-file install landed on the destination repo as PR #91
(`42789f45b`), its `Deploy to Namecheap cPanel (SSH)` run `43892014887` concluded `success`, and the lane's
own validator printed `flags: on=36 off=9 declared=45`. A probe round against production afterwards returned
**401 on every route that had been a baseline 503** — the six paths §3.6, §8.5 and
`docs/runbooks/referral-gate-parity.md:34-38` recorded as 503 on 2026-11-12/13/14 all answer 401 now. One
extra route in that round was `GET /api/v1/crypto/balances` on `www.spotlightng.com`, and the plan's Task 14
Step 2 had given that path a special meaning: *"If it answers 401, `FEATURE_CRYPTO_ENABLED` leaked into
production and the ledger needs an entry explaining who set it."* Writing that entry would have been
inventing a leak. The rule is wrong, crypto is dark on prod, and §10.3 already contained the correct probe —
the plan step simply was not using it.

**The 401 has two possible authors, and the response body says which one answered.** Both are unauthenticated
rejections of the same request shape, and neither carries information about a module flag:

| Probe (anonymous, 2026-11-16, prod www) | Baseline | Status now | Body | Who answered |
|---|---|---|---|---|
| `/api/v1/restaurant/00000000-…` | 503 §3.6 | 401 | `{"success":false,"error":"Unauthorized"}` | the BFF guard |
| `/api/v1/referral/my-rewards` | 503 §3.6 | 401 | `{"success":false,"error":"Unauthorized"}` | the BFF guard |
| `/api/v1/association/mine` | 503 §3.6 | 401 | `{"success":false,"error":"Unauthorized"}` | the BFF guard |
| `/api/v1/wallet/balance` | 503 §8.5 | 401 | `{"success":false,"error":"Unauthorized"}` | the BFF guard |
| `/api/v1/events` | 503 §8.5 | 401 | `{"success":false,"error":"Unauthorized"}` | the BFF guard |
| `/api/v1/referrals/me/dashboard` | 503 runbook :34 | 401 | `{"success":false,"error":"Unauthorized"}` | the BFF guard |
| `/api/v1/crypto/balances` | never probed | 401 | `{"success":false,"error":"Unauthorized"}` | the BFF guard |
| **`/api/v1/crypto/definitely-not-a-leaf`** | — | **401** | `{"success":false,"error":"Unauthorized"}` | the BFF guard |
| `/api/finance/events/00000000-…` | — | 401 | `{"error":"missing bearer token","success":false}` | **Go**, forwarded |

The first body is `errorResponse('Unauthorized', 401)` (`frontend-web/src/lib/api/responses.ts:50`, shape at
`:41`), reached because the crypto catch-all authenticates before it forwards: `app/api/v1/crypto/[...path]/route.ts:13`
awaits `requireRequestUser`, which throws `UNAUTHORIZED` on a missing bearer token at
`frontend-web/src/lib/auth/request.ts:14`, and the route's `catch` pipes that to `handleApiError`. Row 8 is
the point made explicit: a path invented out of thin air under that prefix gets the same 401 as a real one,
because the request never leaves the web tier. The last row's body is Gin's own auth middleware, which only
appears when the BFF forwarded — i.e. when the upstream really was consulted.

**The decisive probe is Go-direct, on the leaves `crypto.Register` actually mounts — on both hosts.**
`backend/internal/crypto/handler.go:274-324` registers `assets`, `portfolio` and `eligibility` (among others);
there is no `balances` leaf in that list, which is the first half of why the plan step failed. Same command
against each API host, plus one invented leaf as the negative control:

```bash
for HOST in backend-production-1b33d backend-staging-new; do
  for P in /api/v1/crypto/assets /api/v1/crypto/portfolio /api/v1/crypto/eligibility /api/v1/crypto/definitely-not-a-leaf; do
    printf '%-22s %-38s ' "$HOST" "$P"
    curl -s -o /tmp/b.txt -w "%{http_code} " --max-time 25 "https://$HOST.up.railway.app$P"
    head -c 60 /tmp/b.txt; echo
  done
done
```

| Path | prod Go (2026-11-16) | staging Go (2026-11-16) |
|---|---|---|
| `/api/v1/crypto/assets` | **404** `No API route matches` | **401** `missing bearer token` |
| `/api/v1/crypto/portfolio` | **404** `No API route matches` | **401** `missing bearer token` |
| `/api/v1/crypto/eligibility` | **404** `No API route matches` | **401** `missing bearer token` |
| `/api/v1/crypto/definitely-not-a-leaf` | 404 | 404 |

Three rows of asymmetry, one row of agreement: the invented leaf 404s on both hosts, so the table cannot be
read as "these paths never exist anywhere" — and on staging the same three leaves answer as authenticated
routes. Prod's not-found handler is not evidence of an outage either: `…/healthz` returns
`{"service":"backend","status":"ok"}` and `…/api/v1/public/build` returns **200** with
`commit 5ab7c9cc0bf3d2b42aa43215fe5df9630dfbc421`, `source: ldflags`, `started_at 2026-11-15T09:00:26Z`
(staging's own build: `2a82a62ef…`, started 2026-11-14T20:54:20Z).

The build-lineage gap that asymmetry across two different binaries would otherwise leave open is closed in
the tree, not inferred: `git cat-file -t 5ab7c9cc0…` → `commit` ("fix(health): port the telemedicine intake
fixes onto prod (#1025)"), and `git show 5ab7c9cc0…:backend/internal/app/finance_routes.go | grep -c
FeatureCryptoEnabled` → **1** — the gated mount exists in the very source prod was built from. So prod's 404
is not "routes absent from this build"; it is `if cfg.FeatureCryptoEnabled` (`backend/internal/app/finance_routes.go:3638`)
taking the `else` branch at `:3708` and never calling `crypto.Register(cryptoMember, cryptoAdmin, …)`
(`:3656`). §10.3's 2026-11-13 pair (prod 404 / staging 401 on `assets`, `markets`, `portfolio`) reproduced on
a different leaf set.

**Verdict.** `FEATURE_CRYPTO_ENABLED` did not leak. No owner set anything, so the entry the plan asked for
is not written. Two independent reads now agree on the same fact from opposite sides: §10.2's prod-backend
env read recorded the name as explicitly present and `false` (line "prod backend: 135 keys, 54 boolean
`FEATURE_*`… `FEATURE_CRYPTO_ENABLED=false` (explicitly present)"), and today's probe shows the consequence
of that value — the group is unmounted. The web plane could not have leaked it either: zero case-insensitive
`crypto` hits in `frontend-web/src/lib/feature-flags.ts`, so the name is not in the 45-name derived surface
and can never appear in `.env.production.local` — which is §9.7's point, restated here because the plan step
ignored it.
The plan's Task 14 Step 2 is corrected in this same commit to run the Go-direct registered-leaf probe, carry
the control, and state the "401 on www is the guard" rule. It is the third member of a family this ledger has
now caught three times: a probe path guessed from a route's *name* rather than from its registration list —
`/api/finance/crypto/...` (§10.3, corrected in review), `/api/v1/crypto/wallets` (called out in §10.3 as a
tautology), and `/api/v1/crypto/balances` (this one, which got further because the BFF answered).

**Two side measurements this section is responsible for.**

1. **Prod Go reports `5ab7c9cc0bf3d2b42aa43215fe5df9630dfbc421`** (`/api/v1/public/build`, `source:
   ldflags`, `started_at 2026-11-15T09:00:26Z`, uptime ≈ 30 h at read time). That is neither `RELEASE_SHA`
   `c49b3956…` nor the `585bd2ca7…` recorded in §16.2 items 5/14, and it is the pre-consult-intake commit
   another session shipped on 2026-11-15. §16.3 row 12 therefore stays **NOT DONE**, with a third value in
   place of the second — the drift is not a single stale SHA but a moving prod head. Task 11's job is
   unchanged in substance: prod must be brought to a SHA that carries the flag-file-aware build, and the
   `#996`-drift decision (item 14) still gates it.
2. **The flag-file mechanism is proven end to end for the probed names.** Six routes that were 503 at the
   §3.6 / §8.5 / runbook baselines answer 401 now, and a 503 flips only if `envFlag()` reads a value that has
   actually reached the prod runtime. §16.3 row 8's first clause ("the cPanel runtime env carries those 45
   keys") is thereby evidenced for those six names — not for the other 39, and its second clause ("**no**
   `FEATURE_*` in the process env") is still unmeasured, so row 8 stays **NOT DONE** rather than being
   upgraded on six samples. Row 13's first half is likewise untouched: `scripts/flagprobe.sh` and the
   acceptance matrix are still not committed, and this section is a probe round, not the matrix.

**One thing the plan could not have known: `release.yml`, and where it leaves the push steps.** It landed on
`main` as `ef97ec64b` ("every push to main releases itself") — `on: push: branches: [main]`, no `paths`
filter, no environment approval, and the legs gates → migrate-staging → deploy-staging → smoke-staging →
migrate-production → deploy-production → smoke-production. Measured on a docs-only merge: `479bcd10b`
produced release run `43887543175` (push, 2026-11-16T14:36:47Z) — which finished with **zero jobs**,
conclusion `cancelled` — and then `43893246842` (workflow_dispatch of the same SHA, 15:08:55Z), whose
`release gate` job concluded `failure` after ten polls of "no .github/workflows/ci.yml run for this SHA yet",
with all eight downstream jobs **skipped**, `migrate production database` and `deploy Production` among them.

So the plan's conclusion survives, by a mechanism the plan did not have:

- A **docs-only** push to `main` still releases nothing — **now measured, not inferred.** PR #1043 squash-merged
  at 16:17:18Z as `f90b3ef3043d5620ea5d25109baa1a3fd649c996` (2 files, both under `docs/`), which produced push
  run `43905831788`. Its `release gate` job concluded `success` and printed `### Release gate:
  **noop_docs_only**` after ten polls of "no .github/workflows/ci.yml run for this SHA yet" (`+0s` … `+281s`,
  the 5-minute `--absence-budget-minutes` default); all eight downstream jobs — `migrate staging database`,
  `deploy Staging`, `smoke Staging`, `deploy Development`, `smoke Development`, `migrate production database`,
  `deploy Production`, `smoke Production` — concluded **skipped**. The separate
  `Deploy to Namecheap cPanel (SSH)` run for the same SHA, `43905831719`, was also `skipped`.
  The mechanism is `ci.yml`'s and `integration-verify.yml`'s `on.push.paths-ignore`: both carry
  `paths-ignore: ['**.md','docs/**']` on push, so the SHA gets no CI run at all, and the gate classifies that
  as `noop_docs_only` (`release-gates.py`, `classify()`'s absent-CI branch), which exits 0 while every deploy and
  migrate job tests `needs.gates.outputs.verdict == 'proceed'` (`release.yml:163`, `:301`, `:435`, `:453`).
  Task 14 Step 5's and Task 16 Step 2's reasoning was therefore right about the outcome and wrong about the
  reason: the inertness comes from the release gate's classifier, not from `sync-frontend-web.yml`'s filter.
- A **non-docs** push to `main` self-releases *by design*: no dispatch, no typed `DEPLOY`, no promotion
  branch, no human. Task 11 and Task 13 assume the prod Go plane is moved by an explicit promote, and Tasks
  3, 6, 14 and 15 end in commits that mix paths; any one of those commits that carries a single non-docs file
  is aimed straight at production, migration apply included. The `#996`-drift decision (§16.2 item 14) is
  therefore no longer a question the plan can defer past the next code push, and each remaining push needs
  the operator's explicit word — this correction was delivered as a PR rather than pushed for that reason,
  and #1043's merge then confirmed the prediction held: the docs-only push it produced wrote nothing and
  deployed nothing.
- **But no non-docs push has actually reached production yet, and the reason is a defect, not the design.**
  Measured on the three pushes after `ef97ec64b` landed — `43827942317` (`ef97ec64b`, 08:01:10Z),
  `43877393067` (`2303984cf`, 13:36:28Z) and `43886555996` (`ee58728e0`, 14:31:05Z): in all three the gate
  concluded `success`, `migrate staging database / supabase db push (staging)` concluded **`success`**, the
  three `deploy Staging (…)` jobs concluded **`failure`**, and `smoke Staging`,
  `migrate production database` and `deploy Production (…)` were therefore `skipped`. So staging's database
  *is* being written automatically on every push, and production is shielded only because the staging deploy
  leg is red — `deploy-staging` failing cascade-skips `smoke-staging` (`needs: [gates, deploy-staging]`,
  `release.yml:377-379`), which skips `migrate-production` (`needs: [gates, smoke-staging]`, `:428-434`).
  **Read "shielded" narrowly: it describes the chain, not the database.** The same afternoon a migration
  reached prod with every prod job above it `skipped`, through a manual `db-migrate.yml` dispatch — see
  `## Stage 3`, §6.1 and §6.2.
  That is a one-line-of-luck guarantee: the failure is Railway's upload-initiate decode error
  (`Failed to fetch: error decoding response body`, e.g. job `133390268421` at 15:10:07Z, with
  `RAILWAY_HTTP_TIMEOUT: 600` already set), which `docs/devops/deployment-matrix.md:323-332` and the project
  note `railway-up-400ms-decode-error-is-theirs.md` both measure as transient and **theirs**, not a token or
  upload-shape fault — the same secret completed an upload in one job and hit it 21 s later in another.
  **And the first draft of this bullet overstated the blast radius, so it is corrected here rather than
  quietly left.** It said the first green leg "releases the whole prod backlog" — but it had not measured
  prod's pending set, and prod has no backlog. Measured 2026-11-16 through the session pooler:
  `supabase_migrations.schema_migrations` holds **756** rows, every version numeric, max applied
  `20271500000000`, and `information_schema.tables` where `table_schema='public'` counts **1416**.
  `origin/main`'s tree (`f90b3ef30`) carries **756** `supabase/migrations/*.sql` files, and the two sets are
  identical in both directions — `comm -23` (in tree, not applied) = **0**, `comm -13` (applied, not in tree)
  = **0**. So `db push` against prod today is a no-op, and the real exposure is narrower and still live:
  **the first green staging leg that rides a commit containing a new migration applies that migration to
  prod with no dump taken.** §16.2 item 3 still holds exactly — no production dump exists and no in-repo
  `pg_dump` caller does — so Task 3 is not guarding a backlog that does not exist; it is the one rollback
  route for the next migration anyone lands. It still has to precede a staging-leg fix, for that reason and
  not the one first written here.
- **§5.6's prod figures are refuted by a fourth value, and this is the measurement the row was asking for.**
  §5.6 recorded "prod moved to **670** history rows, max applied `20271410000000`" and §16.2 item 2 asked for
  a fresh read; the live read today is **756** / `20271500000000`. §16.3 row 6 ("Prod at 0 pending on a fresh
  `mode=list` table") therefore cannot be closed by this bullet: set-equality here is a re-derived sweep, and
  Task 14 Step 3 forbids substituting one for the lane's table — `list-pending.sh` refuses an empty table
  with exit 2 for the reason measured in Task 2 Step 5. What the sweep does establish is the *absence of a
  backlog*, which is the fact that makes Task 6's batching question moot and Task 3's dump urgent.
- The contrast case is the one to remember: `noop_docs_only` is valid **only** for a push
  (`release-gates.py:185-190`), which is why dispatching the same docs-only SHA read as `failed` rather than
  as a no-op. A red `release gate` on a docs SHA is not evidence that docs deploy something; it is the
  classifier refusing to infer silence from an event that has no CI run by construction.

### The whole matrix, on the probe the plan asked for (2026-11-16 22:41–22:47Z)

The window is UTC and the box runs `+01:00`; the Step-4 page read carries the local mtime `23:46:05` at the
85,541 B recorded below, and this branch's two commits are `23:51:49`/`23:52:22` local. An earlier draft of
this heading stamped the local clock with a `Z`, which would have dated the matrix 40 minutes after the
commits that describe it.

Everything above this heading probed **eight hand-picked paths**. Task 14 Step 1 refuses that method — its
first draft guessed URLs from flag names, reported every flag green, and proved nothing, because a guessed
404 says as little about a gate as a 405 does. The step's deliverable is a probe that derives flag → route
from the source. `scripts/flagprobe.sh` is that probe, committed here for the first time: the file did not
exist anywhere on `main` (§16.2 item 9's whole claim), and `git ls-files | grep -i flagprobe` returning
nothing was the reason that row could not be closed on intent.

Run from a clean checkout at this branch's base, against production, read-only:

```bash
/bin/bash scripts/flagprobe.sh www.spotlightng.com frontend-web/config/production-module-flags.env
```

**84 lines over the 45 declared names — 67 lines from the 36 names declared `true`, 17 from the 9 declared
`false`.** Class histogram: `401 ×41`, `405 ×25`, `503 ×7`, `404 ×1`, `NO-ROUTE-IN-app/api ×10`.

| Verdict | Measured | Against the plan's rule |
|---|---|---|
| A `=true` flag answers **503** on some real gated route | **zero lines.** All 7 × 503 belong to four `=false` names: `FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED`, `FEATURE_FILM_ACADEMY_TOPICS_ENABLED`, `FEATURE_FINTECH_ADMIN_ENABLED`, `FEATURE_P2P_MARKET_ENABLED` | Pass condition is "not-503 anywhere". Baseline (2026-11-12) had **28 of 36** true flags 503-ing. That is the flip Tasks 8/12/13 exist to cause, now measured over the whole surface rather than six chosen paths |
| A `=false` flag answers 503 (deliberately dark, Task 10) | 4 of 9 names carry ≥1 503 | Proven dark |
| `=false` with routes but **no** 503 | `FEATURE_DOCTOR_ENABLED` (1 line, 405) and `FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED` (1 line, 405) | **Not a finding.** Both probes hit POST-only leaves, and Next answers 405 for a missing method *before* the handler's flag check can run. A GET probe cannot see these gates |
| `NO-ROUTE-IN-app/api` | 10 lines — the 5 true names the plan names as inert (`estate`, `healthLab`, `healthPharmacy`, `healthVet`, `otpEmail`), the 2 bridge names the plan says are **not** inert but the probe still misses (`voteBridge`, `votesBridge`), and 3 false names (`filmAcademyPilotDelivery`, `checkoutTopupTier0`, `estateDualControl`) | Matches the plan's prediction exactly on both counts. The 5 inert are not to be reported as passing: their only reader is `isModuleVisible` (`frontend-web/src/server/modules/visibility.ts:59-66`), which has zero callers |
| `NO-KEY-IN-CODE` | 0 lines | Every declared name resolves to a `feature-flags.ts` key — the parity guard (Task 9) is what keeps this column empty |

Named flip probes, re-run in the same window: `/api/v1/restaurant/<uuid>`, `/api/v1/referral/my-rewards`,
`/api/v1/association/mine` → **401 `{"success":false,"error":"Unauthorized"}` on all three** (baseline: 503
×3). `/api/v2/votes/wallet` → **405**, not the 403 the plan expected while off: same POST-only blind spot as
the two `=false` names above, so the bridge's own flip is unobservable from a GET.

**Both branches of the probe are exercised by the real run, and one of them only by the wrapper case.** Zero
`route.ts` files name `utilityBillsGoProxy` (`grep -rlE "featureFlags\.utilityBillsGoProxy|requireFeature\('utilityBillsGoProxy'" frontend-web/app/api | grep -c '/route.ts$'` → 0);
the flag's only source reader under `app/api` is the wrapper `app/api/v1/utility/_utils.ts`. All three lines
the probe produced for `FEATURE_UTILITY_BILLS_GO_PROXY_ENABLED` (`beneficiaries/<uuid>` 405, `beneficiaries`
401, `billers` 401) therefore came from the wrapper-following loop — the shape whose absence made an earlier
draft report a live flag as "no route". The refusal branch is proven separately: a file containing one
invented name prints `NO-KEY-IN-CODE` for it and exits 0, so an unmapped flag is reported, never silently
skipped.

Step 4's runtime rows, measured in the same window:

| Check | Expected | Measured |
|---|---|---|
| `POST /api/auth/login`, wrong credentials | 401, never 504 | **401** `{"error":"invalid credentials"}` — `GO_BACKEND_URL` is wired; the 2026-11-08/09 504 class is not present |
| `/service-details/film-academy` | 0 "could not be read right now", `area-tab-0` present | **200**, 85,541 B, banner count **0**, `area-tab-0` ×1 |
| `GET /api/academy/apply` | 200 | **200** with a non-empty `batches[]` — real prod rows through the BFF |
| `GET /api/v1/contests` | 200 | **200 `[]`** — routing proven, data not: prod has zero contests, so this row proves the rail, not a populated module |
| `/api/v1/public/build` == `RELEASE_SHA` | equal | **not equal** — prod Go reports `5ab7c9cc0…`. Item 5/14 stay open, operator-owned |
| `/login` chunk hrefs == the build's | equal set | **not measured here**: the comparison needs the build's own `.next/server/app/login.html` href set, i.e. a local production build. Live page serves 10 distinct chunk hrefs; that number alone is not the acceptance test |

**One new production fact, and the mistake that nearly hid it.** Probing the flag file's `FEATURE_DOCTOR_ENABLED=false`
led to `if cfg.FeatureDoctorEnabled` (`backend/internal/app/finance_routes.go:3051`, group at `:3098`) — and
`GET /api/v1/doctor/profile` on prod Go answers **404 `No API route matches`**, i.e. the provider console is
**unmounted** on the live API, not merely guarded. Two things had to be true before that sentence was
allowable, and the first probe round satisfied neither:
- *The deployed binary must contain the group.* `5ab7c9cc0:backend/internal/app/finance_routes.go` carries
  both the gate (`:2726` in that tree's numbering) and `docGroup := r.Group("/api/v1/doctor")` (`:2772`), so
  the 404 is the flag and not a stale build.
- *The 404 must be the unmounted shape, not the guarded one.* Control, same request shape, on the same host:
  `/v1/referrals/me/dashboard` → **401 `missing bearer token`** (mounted, Gin's own auth answered).
- And it is not a prod-only gap: `backend-staging-new` returns the identical pair — doctor **404**, referrals
  **401**. The doctor console is dark on **both** API planes, so the web flag file's `=false` is faithful to
  the Go runtime rather than masking a divergence, and Task 13 has no doctor parity item to carry.
- **The wrong-path trap, recorded because this plan's own Step 2 failed the same way:** the first round probed
  `/v1/doctor/appointments` and `/api/v1/wallet/balance` on the Go host, got 404s, and looked like proof.
  Neither path is registered. The doctor group is `/api/v1/doctor` (not `/v1/…`), and the wallet balance leaf
  is `GET /balance` under `finance := r.Group("/api/finance")` → `finance.Group("/wallet")`
  (`finance_routes.go:335`, `:428`, `:430`), so the real path is **`/api/finance/wallet/balance`** — which was
  then probed and answers **401 `missing bearer token`**, mounted and guarded, while `connect_routes.go:290,294`
  mounts a *different* `/api/v1/wallet` group whose only GET leaves are `summary` and `history`. The invented
  path and the real one differ by a prefix and returned opposite verdicts; only the source read told them
  apart.

**What this section does not claim.** It does not close §16.2 item 6: a not-503 answer proves the web tier no
longer refuses, which is the *effect* the flags were installed for, but not that `.env.production.local` holds
the 45 keys on the box, and not that no `FEATURE_*` sits in the Passenger process env (the precedence case —
a process var outranks every file). Item 6's own cell names the two reads that would settle it. Nor does it
close item 9 outright: the script lands on `main` only when this PR merges, and until then the honest state is
"the probe exists on `feat/flagprobe-acceptance`, and merging it is not a docs-only push".

**It is also a snapshot, and a release is in flight underneath it.** The build behind every code above is prod's
own at 22:41–22:47Z: `/api/v1/public/build` answered `5ab7c9cc0…`, the tip of the `prod` promotion lineage —
which is why the `== RELEASE_SHA` row reads *not equal*. Meanwhile another session merged PR #1044 at 22:40Z
(`4d78ecf69`, riding out Railway's upload failure), and that SHA's release run `43972239504` was still inside
its `release gate` job while this probe ran, with `integration-verify` unsettled. That commit changes
`.github/workflows/ci.yml`, `scripts/ci/railway-deploy.sh` and `scripts/ci/test-railway-deploy-retry.sh`, so
`noop_docs_only` does not apply to it: if its gate goes green, the run deploys development,
staging **and production** by design. These numbers then describe the build this section measured, not the one
prod serves an hour later — re-run the probe before citing them as current.

## Backup — the pre-cutover prod dump, taken and rehearsed (Task 3, 2026-11-16)

`§16.2 item 3` said "no production dump exists, and no in-repo route to make one either". The route part is
still true — nothing in `scripts/` calls `pg_dump` (`git grep -ln pg_dump -- ':!docs'` returns no matches), so
this was done by hand, through the session pooler, from this machine. The "no dump exists" part is now closed
for one date: a dump exists, and it is proven to restore.

**Step 2 — the dump.** `pg_dump --format=custom` against `aws-0-eu-north-1.pooler.supabase.com:5432/postgres`
(session port, `sslmode=require`) for `nmseefdlliejmdbxytej`. The DSN was read from `~/.supabase/prod_pooler_dsn`
into a shell variable and mounted read-only into the client container; it was never printed, and the staged
copy under `/tmp` was deleted after use.

| measured | value |
|---|---|
| prod `server_version` | **17.6** — the laptop's `pg_dump`/`pg_restore` are **16.13** and refuse a 17 server, so both ran from `postgis/postgis:17-3.4` |
| prod `pg_database_size` | **113 MB** (`public` 107 MB, `auth` 2848 kB, `storage` 600 kB, `realtime` 104 kB, `vault` 40 kB) |
| dump bytes | **10,671,662** |
| dump `sha256` | `848855b42a0f43e4811b5f81f6369a147dc5d8e96bc29f7282bf794255771137` |
| kept at | `~/Documents/spotlight/backups/prod-pre-cutover-2026-11-16.dump` — outside every repo, deliberately: it holds real prod rows |
| `pg_dump` exit | **0** |

**Step 1 — the dashboard backup: NOT DONE.** `nmseefdlliejmdbxytej` has no PITR/backup id recorded here because
this agent cannot mint one; the plan already said `gh` cannot and there is no CI path to it. It stays a
human action, and it is the only route that rolls prod *in place* — what follows proves a restore into a
*fresh* database, which is a rescue path, not a rollback of the live instance.

**Step 3 — the rehearsal, and the one thing the plan's procedure does not cover.**
Target: `prod-restore-rehearsal-n1046` (`postgis/postgis:17-3.4`, `127.0.0.1:55432`, started with
`scripts/ci/start-postgres-service.sh`, reported `healthy`), `scripts/ci/supabase-compat-prelude.sql` applied,
then `CREATE DATABASE rehearsal` and `pg_restore --no-owner --jobs=2` from the dump.

The plan predicted two shapes would bite — `--create` colliding with a database already named `postgres`, and
a fresh cluster missing the `auth`/`storage` schemas and the `anon`/`authenticated`/`service_role` roles. Both
predictions held. It did not predict the third, and it is not cosmetic: **the prelude does not create the
Supabase platform roles, and `postgis/postgis` cannot provide `supabase_vault`.** Against the prelude alone the
restore exits **1** with **145** error lines. Classified:

| failing object | lines | cause |
|---|---|---|
| role `dashboard_user` | 105 | not created by `supabase-compat-prelude.sql` (which makes only `anon`, `authenticated`, `service_role`, `postgres`) |
| role `supabase_admin` | 17 | same |
| role `supabase_auth_admin` / `supabase_storage_admin` / `supabase_realtime_admin` / `pgbouncer` | 4 / 3 / 1 / 1 | same |
| `vault.secrets`, `vault.decrypted_secrets`, `supabase_vault` | 2 / 1 / 1 | extension absent from `postgis/postgis:17-3.4` |

Adding the six roles prod actually has (`dashboard_user` NOLOGIN, `pgbouncer` LOGIN, `supabase_admin` LOGIN
SUPERUSER BYPASSRLS, `supabase_auth_admin` LOGIN, `supabase_realtime_admin` NOLOGIN,
`supabase_storage_admin` LOGIN — attribute set read from prod's `pg_roles`, not guessed) takes the same restore
from **145 error lines to 4**, and every remaining line is the vault extension. Prod's `vault.secrets` holds
**0 rows**, so the residual is a missing empty table owned by a Supabase-managed extension, not lost data.
There is no single local image that removes it: prod has both `postgis` and `supabase_vault` installed
(`pg_extension`: `btree_gist, pg_stat_statements, pg_trgm, pgcrypto, plpgsql, postgis, supabase_vault, uuid-ossp`),
and `postgis/postgis` carries only the former. A faithful target is a real Supabase instance — which is the
same reason Step 1's dashboard backup stays the in-place rollback route.

**Counts, restored against prod, and they are the assertion** (`667` was the plan's expected history count, read
2026-11-11; prod has been written since, so the pass condition is *equality with prod at dump time*, and that is
how it was checked):

| measure | prod (live, 2026-11-16) | rehearsal |
|---|---|---|
| `supabase_migrations.schema_migrations` rows | **756** | **756** |
| `information_schema.tables` where `table_schema='public'` | **1416** | **1416** |
| `pg_policies` rows | **1990** | **1990** |
| `information_schema.views` in `public` | **9** | **9** |
| `information_schema.triggers` | **356** | **356** |
| `public` tables with `relrowsecurity = false` | **1** | **1** |
| same, excluding `RLS_ALLOWLIST` (`spatial_ref_sys`) — the `make rls-check` gate | **0** | **0** |

Data, not just schema: exact `count(*)` matches on `user_profiles` 17, `ledger_entries` 0, and on six of the
largest tables — `spatial_ref_sys` 8500, `academy_question_items` 8804, `academy_learning_objectives` 1764,
`mkt_categories` 84, `academy_mock_exam_instances` 57.

**Step 4 — teardown, and the targets the rehearsal shares with Task 4.** `docker rm -f
prod-restore-rehearsal-n1046` confirmed removed. `git show origin/main:Makefile` at `:91-116` prints
`migrate-up` (loop over sorted `$(MIGRATIONS_DIR)/*.sql` with `ON_ERROR_STOP=1`), `pending-list`
(`scripts/db/list-pending.sh`, the `--remote-table` form Task 14 Step 3 needs), `migrate-reset` (drop/recreate
`public`, then `migrate-up` then `rls-check`) and `rls-check` (`relrowsecurity = false` minus
`RLS_ALLOWLIST ?= 'spatial_ref_sys'`, `Makefile:28`). The query this section ran for the `no_rls` row is that
same predicate, so the rehearsal and the CI gate are the one procedure, measured twice.

**Rollback instruction, one line.** A fresh-database restore is proven: `pg_restore --no-owner --jobs=2` into a
Supabase-compat target that also has the six platform roles, then compare `schema_migrations` to **756**.
Rolling *production itself* back is a dashboard restore on `nmseefdlliejmdbxytej` and needs the key-holder —
see Step 1, which is still open.

## Stage 3 — production reached 0 pending, but not the way this task was written (Task 6, 2026-11-16)

Task 6 was sized for a prod backlog of 87 versions (§5.6's 2026-11-07 capture: 88 pending, 89 files
newer than prod). **There is no backlog.** Prod reached `recorded: 756` against a tree of 756 files with
**0 pending**, and it got there through two writes this plan did not schedule — so this section records
what happened rather than ticking the steps as if it had.

### 6.1 The two writes that filled prod's history

| when (UTC) | run | lane | inputs | what it did |
|---|---|---|---|---|
| 2026-11-15T19:54:32Z | `43755019295` | `ops-db-push.yml` (`Ops DB Push (manual)`) | `environment=production`, `mode=push`, `confirm=PUSH` → `supabase db push --linked --include-all` | job `supabase push (production)` **success**, and the log carries **79** `Applying migration …` lines (`20261030000500_user_profiles_phone_backfill.sql` … `20271411000000_reconcile_doctors_presence_backfill.sql`) — prod **676 → 755** (676 is arithmetic off today's 756, less this 79 and the 1 below, not a captured read) |
| 2026-11-16T15:20:36Z | `43895117150` | `db-migrate.yml` (`DB Migrate (Supabase db push)`) | `target=production`, **`dry_run: false`**, `include_all: false`, head `479bcd10b` | log line `Applying migration 20271500000000_academy_acting_level_assessment.sql...` — prod **755 → 756** |

Two sibling dispatches of the same workflow, `43893847812` (15:12:21Z) and `43896013708` (15:24:41Z),
both print `dry_run: true` and applied nothing; they are named because a job called
`supabase db push (production)` that ends `success` is not by itself evidence of a write — the input is.
All three were dispatched by `specng-patrick`, the same account this session's `gh` uses.

Neither write used `ops-db-push-scoped.yml`, which this task's opening sentence names as "the only prod
DB writer this plan uses". Both used a **whole-remote** push, one of them with `--include-all` — the
exact shape the task's own hazard table exists to avoid.

### 6.2 What the release chain did instead, all day

`release.yml` ran **12 times** on 2026-11-16, and `migrate production database` did not execute in any of
them. Enumerated rather than characterised, because the first draft of this section said "in each,
`deploy Staging (…)` failed" and that was wrong for two of the twelve:

| cause | runs |
|---|---|
| gate `proceed`, then `deploy Staging (…)` red on all three services → `smoke Staging` and every prod job cascade-`skipped` | `43827942317` (`ef97ec64b`, 08:01:10Z), `43877393067` (`2303984cf`, 13:36:28Z), `43886390671` (`2303984cf`, dispatch 14:30:12Z), `43886555996` (`ee58728e0`, 14:31:05Z — the push that *added* `20271500000000`), `43901034793` (`479bcd10b`, dispatch 15:51:49Z), `43905969462` (`f90b3ef30`, dispatch 16:18:09Z), `43915347705` (`5c95fe376`, dispatch 17:09:24Z) |
| gate verdict `noop_docs_only` → every deploy and migrate job `skipped` at the `verdict == 'proceed'` condition (§6.4's last bullet) | `43905831788` (`f90b3ef30`, 16:17:22Z), `43915306385` (`5c95fe376`, 17:09:08Z), `43918883292` (`b5cc95c72`, 17:29:17Z) |
| gate verdict `failed` — its own reason line reads "no `ci.yml` run for this SHA, and this is a workflow_dispatch… Re-dispatch with `skip_gates=true`" | `43893246842` (`479bcd10b`, dispatch 15:08:55Z) |
| run `cancelled`; the migrate job never materialised | `43887543175` (`479bcd10b`, push 14:36:47Z) |

Two things fall out of doing it this way. The staging leg is not the only thing standing between a push and
a production write — three of these were inert because the commit touched nothing deployable, and one was
stopped by the CI-green gate itself. And two pairs above (`f90b3ef30`, `5c95fe376`) reach *opposite* verdicts
on the *same* commit, push versus dispatch: the push earns `noop_docs_only`, the hand-dispatched retry of it
fails the gate for lack of a `ci.yml` run. Same tree, different verdict, because the verdict depends on the
event, not the content.

Put 6.1 and 6.2 side by side and the sentence from the release-lane section needs correcting: prod was
not in fact shielded by the red staging leg on 2026-11-16. **The automated door stayed shut and a manual
one was used 49 minutes after the migration landed on `main`.** The chain has still never shipped a
migration to production end-to-end — that claim survives, but "so prod is protected" does not.

### 6.3 Step 5's proof, run fresh — and it is now the only step with a verdict

Three independent reads, all taken on 2026-11-16 after both writes:

| the read | how it was taken | result |
|---|---|---|
| The lane's own `mode=list` table | `gh workflow run ops-db-push.yml -f environment=production -f mode=list` → run **`43916692518`**, created 17:16:48Z, job `supabase list (production)`, `completed/success`. Steps that ran: `Resolve target…`, `Enforce confirm…`, `Link project`, `Migration list (before)`. `Apply migrations (db push)` and `Repair migration history` are absent, both `if:`-guarded off `mode` — the run wrote nothing. | 760 log lines carry `\|`, **756** distinct `Remote` versions, max `20271500000000`, and no row is local-only |
| The classifier on that table | `bash scripts/db/list-pending.sh --remote-table /tmp/prod_versions_final.txt` | `-- remote max applied: 20271500000000 \| recorded: 756`, exit 0; `… \| grep -c '^pending'` → **0**. `recorded: 756` equals the tree's own `ls supabase/migrations/*.sql \| wc -l` → **756** |
| The classifier on prod read directly | `psql` over the session pooler (user `postgres.nmseefdlliejmdbxytej`) selecting `version` from `supabase_migrations.schema_migrations` → 756 lines → `list-pending.sh --remote` | the identical line: `remote max applied: 20271500000000 \| recorded: 756`. `comm -23` and `comm -13` between this set and the lane's table → **0 / 0** |
| `make rls-check`'s predicate, on prod | the Step 5 SQL verbatim (`relrowsecurity = false`, `relname not in ('spatial_ref_sys')`) over the same pooler connection | **0 rows** |

**One thing the lane's read cannot on its own prove, and the plan should stop pretending it can.** The
`Migration list (before)` step prints `SUPABASE_PROJECT_ID: ***` — the secret is masked, so the run's own
log never names the ref it linked, and §16.2 item 4's suspicion (that `Production`'s
`SUPABASE_PROJECT_ID` may still hold the staging ref) survives this dispatch untouched. The attribution
comes from the third row above, not the first: prod's own pooler connection — where the ref is in the
username, not in a secret — agrees set-for-set with what the lane printed.

### 6.4 The gate this task was built around no longer exists

§16.2 item 1 recorded two prod writes parked on `Production`'s `required_reviewers` and told the reader
the reviewers (ids `18039055` / `59900242`) own that queue. Re-read today:

| measured on 2026-11-16 | value |
|---|---|
| `GET /repos/…/environments/Production` | `protection_rules` → **`["branch_policy"]`**, reviewers → **`[]`** (env id `19520517709`) |
| the three runs item 1 called parked | `43299354226`, `43299959109`, `43534854471` → all `completed` / **`cancelled`**, each `pending_deployments` → `[]` |
| why the reviewers are gone | `db-migrate.yml:11-17`, verbatim: "The reviewers were removed on **2026-11-15** as the whole point of the auto-release change (`docs/superpowers/specs/2026-11-15-auto-deploy-release-pipeline-design.md`), and a reviewer on `production` would silently re-gate every automatic production apply" |

So every "this parks for a human, budget a second approval" instruction in this plan is now false —
including Step 5's own "parks for review" comment and its closing sentence. My dispatch of
`43916692518` did not park: `created_at` and `run_started_at` are both `17:16:48Z`. The consequences run
in both directions and both belong in the ledger:

- Rows previously blocked on "a Production reviewer must press approve" — item 1, and with it the
  standing reason Task 6 could not be closed — are **no longer blocked**. They are waiting on a decision,
  not on a permission.
- A whole-remote `supabase db push` against the live production database is one `gh workflow run` plus one
  typed word away from anyone who can dispatch a workflow, and **what stands between that and a destroyed
  schema differs by lane**: `db-migrate.yml` still runs an `additive-only guard` job and a `refuse a stale
  ref` job (today's write went through both, green), but `ops-db-push.yml mode=push` — the lane that did
  the 676→755 sweep with `--include-all` — contains **no occurrence of the word `additive` at all**. Its
  only protection is `confirm=PUSH`, a string the operator types into the dispatch form. Item 1's text —
  "approving a `Production` deployment on someone else's behalf is exactly the side effect the gate exists
  to prevent" — describes a gate that has since been removed, and the guard that remains is per-lane.
- **One exemption measured rather than assumed, because this ledger's own merges depend on it.**
  `release.yml` triggers on `push: branches: [main]` with **no `paths:` filter**, so on its face even a
  docs-only merge would reach `migrate production database` — whose `with:` block is `dry_run: false`,
  `include_all: false` (`release.yml:440-446`). It does not, and the reason is in the gate, not the
  trigger: `release-gates.py`'s absent-CI branch returns **`noop_docs_only`**, not `proceed`, when no
  `CI` run exists for the SHA, because `ci.yml` carries `paths-ignore: ['**.md','docs/**']` on push
  to main. Every deploy and migrate job is `if: needs.gates.outputs.verdict == 'proceed'`, so they all
  skip. Measured on the merge that landed §Stage 2's docs (`b5cc95c72`, run `43918883292`, 17:29:17Z): the
  run concludes **`success`** — which is why reading a release run's colour is not enough here — with the
  gate `success` and all eight downstream jobs `skipped`, and its log prints
  `### Release gate: **noop_docs_only**`. So a docs-only push is inert; **any push that touches code,
  config, a workflow or a migration is not**, and once the staging leg goes green that push applies to
  production automatically with no reviewer in front of it.
  That inertness used to be an inference from an absence, and is now a proof: the gate reads the commit's
  changed files before it will grant `noop_docs_only` (`release-gates.py:191-209`), so a push that touches
  anything outside those two globs and has no CI run **fails** instead of exiting 0 — and `superseded` has
  to name main's newer tip or fail the same way (`:124-135`). The two silent verdicts, which are the only
  ways this gate can stop a release with nobody being told, are now the two that carry evidence. The
  docs-only SHA above still reads `noop_docs_only`, and correctly: both of its files are under `docs/`.

### 6.5 Step-by-step disposition

- **Steps 1–4 — NOT APPLICABLE, not skipped.** The batch plan split a pending list that is now empty;
  `/tmp/pending.txt`'s 87 additive versions were applied by the two writes in 6.1, one of them with
  `--include-all`. Running eight scoped batches today would apply zero versions. Recorded as superseded
  so nobody reads the unchecked boxes as unfinished work.
- **Step 5 — MET**, by 6.3.
- **Ordering, stated plainly:** the pre-cutover dump in `## Backup` was written at 17:05:36Z UTC
  (`18:05:36 +0100`), **1h45m after** the 15:20:36Z prod apply it was supposed to precede. For
  `20271500000000` the dump is a post-hoc rescue, not a pre-flight safety net; the file is additive-only,
  so nothing needs rolling back, but the plan's "with a dump taken first" clause (§16.2 item 2) did not
  hold for the last version that reached production.

### 6.6 What this section does not prove

Not that prod's *data* matches staging's — 6.3 reads history rows and one RLS predicate. Not that either
write in 6.1 was reviewed by anyone; neither was, and 6.4 explains why nothing stopped it. Not that the
release chain can ship a migration to production at all: every prod migrate job this plan has observed
was `skipped`, and the one version that reached prod today arrived there by hand.

### 6.7 Prod's schema is now 113 migrations ahead of the code prod runs

Closing Task 6 makes this the next un-finished sentence in the plan, and it was measured rather than
inferred. Re-read 2026-11-16 while checking whether the auto-release chain had quietly closed Tasks 11/12:

| read | value |
|---|---|
| `curl https://www.spotlightng.com/api/v1/public/build` | `commit 5ab7c9cc0bf3d2b42aa43215fe5df9630dfbc421`, `source: ldflags`, `started_at 2026-11-15T09:00:26Z` — that is `fix(health): port the telemedicine intake fixes onto prod (#1025)`, the tip of the `prod` promotion lineage |
| `git merge-base --is-ancestor 5ab7c9cc0 origin/main` | **not an ancestor**; `git rev-list --count origin/main..5ab7c9cc0` → **8** ahead, `…5ab7c9cc0..origin/main` → **756** behind |
| migration files in *that commit's* tree | `git ls-tree -r --name-only 5ab7c9cc0 supabase/migrations/ \| grep -c '\.sql$'` → **643**, newest `20271410000000_module_registry_add_ungated_surfaces.sql` |
| migration files on `origin/main` | the same command against `origin/main` → **756** |
| set difference | `comm -13` → **113** files on main that are absent from prod's code tree; `comm -23` → **0**, so the prod tree is a strict subset — it is old, not divergent |
| prod's applied history (§6.3) | **756** versions |

So prod's database carries 756 applied versions while the Go binary serving prod was compiled from a tree
holding 643 of them, and `20271500000000_academy_acting_level_assessment.sql` — the version applied to prod
at 15:20:36Z today — is **not in that tree** (`git ls-tree -r --name-only 5ab7c9cc0 supabase/migrations/ \| grep -c 20271500000000`
→ 0). This is the safe direction of the two the additive-only rule permits: nothing deployed reads a
table it does not know about, so the migration is dark rather than breaking. What it means operationally is
that **113 migrations' worth of shipped capability is live in prod's schema and absent from prod's backend**,
and each further whole-remote apply widens that gap while this plan's Task 11 stays open.

**Two 756s appear above and neither was derived from the other.** `origin/main`'s migration-file count and
the `git rev-list --count 5ab7c9cc0..origin/main` commit gap are independent measurements that happen to
share a value; re-run both commands rather than assuming one implies the other. `git merge-base
5ab7c9cc0 origin/main` → `94ad08c05` (PR #791, 2026-11-09), which is where the prod-serving lineage and
`main` last touched.

Two things this does **not** say. It is not evidence that the release chain is silently deploying prod: §6.2
enumerates all twelve 2026-11-16 runs and none of them executed a prod job, though for three different
reasons — a red staging leg, a `noop_docs_only` verdict, and once the CI-green gate itself. So prod's Go
plane has not been redeployed by the chain this week, and which of those three reasons applied changed
mid-afternoon. None of them is a design that protects production; they are accidents of this week's traffic,
and §6.4 says what removes the remaining protection.

And it does not replace §16.2 item 5's acceptance read, which asks for `/api/v1/public/build` to return a
chosen `RELEASE_SHA` plus matching login-page chunk hrefs; prod reporting a *third* SHA since that row was
written is the point of item 5, not a refutation of it.

## 6.8 What blocks a merge is not what blocks a deploy — and row 4 closes itself

Learned while landing this section's own evidence (PR #1048, squash `22f82de18`, 2026-11-16T22:21:57Z), and
none of it is derivable from reading either workflow alone.

**The two gates read different, non-overlapping name sets.** Live branch protection on `main`
(`gh api repos/…/branches/main/protection`) requires exactly five contexts — `backend`, `frontend-web`,
`frontend-admin`, `migrations`, `secrets-scan`. `.github/required-checks.txt` lists nine, and **none of the
five is among them**: `backend (go build + vet) / verify`, `frontend-admin (type-check) / typecheck`,
`frontend-web (regression + money + contract + tsc + lint) / verify`, `hygiene (client secrets + live-DB test
gate + migration versions)`, `migrations (additive-only guard) / guard`, `mobile (whole-app tsc) / typecheck`,
`openapi (validate all contracts) / validate`, `which modules changed`, `workflows (actionlint)`. Those nine
are `ci.yml`'s decorated job names (`ci.yml:93,101,119,126,130,134,167,232,486`), and `ci-optimized.yml`
contains no `name:` override at all (`grep -c '^    name: '` → 0), so its five job ids
(`ci-optimized.yml:16,35,54,72,137`) are the only things that can satisfy the five contexts protection
actually enforces. `scripts/ci/test-changed-modules.py:109-126` asserts that each name in
`required-checks.txt` "still exists as a job in `ci.yml`" — a true and useful assertion about the deploy
gate that structurally cannot notice the divergence, because it never looks at the protection API.

So the gate's `required_names()` waits on the nine deep names, while GitHub waits on the five shallow ones. Reading
that as a consequence of the two lists, not as an event observed this session: a `main`-bound PR can be
merged with `openapi … / validate`, `mobile … / typecheck` or `hygiene (…)` red, because none of those is a
required context — and `release.yml`'s gate would still refuse to deploy on the same red, because all three
are in `required-checks.txt`. The deploy gate is strictly deeper than the merge gate; nothing in either file
says so, and the file that reads like the contract for both is the one protection does not use.

**A cancelled `ci-optimized` run blocks a docs merge while every lane that tests code is green.** Observed
on `9b5ddc73d`: `ci.yml`'s run `43926226680` concluded `success`, yet `gh pr view` read `BLOCKED` because
`migrations` was `cancelled`. The cancellation was run `43926226658` (`CI (Zero-Billing Optimized)`), dead
3m1s into its `migrations` job — its other four jobs had already concluded `success`, which is why exactly
one required name went dark instead of five. `gh run rerun 43926226658` re-reported it green inside about
four minutes and the PR went `CLEAN`. That is the whole remedy, and it is safe here specifically because
`ci-optimized.yml` carries no `railway`, `deploy`, `secrets.` or `environment:` reference in its 200 lines.
Note also what that job does *not* do on a docs diff: `ci-optimized.yml:145-172` computes
`changed_migrations.txt` and gates its validate step on `changed == 'true'` (`:172`), so with no `.sql` in the diff the
required `migrations` check passes having read no migration at all — the same all-skip shape §16.3 warns
about elsewhere.

**§16.2 row 4 closes without a new dispatch,** by the writer's own guard. `_reusable-db-apply.yml:60` binds
`environment: ${{ inputs.target }}` and `:63` resolves `SUPABASE_PROJECT_ID` from that scope; `:132-139`
then refuses to run unless `$SUPABASE_PROJECT_ID` differs from `$STAGING_PROJECT_ID`. In run `43895117150`
— today's `target=production` apply — the step's stdout is `Production project ref is distinct from
staging.`, and the branch is not vacuous: `Production` overrides only `SUPABASE_DB_PASSWORD`
(`gh api …/environments/Production/secrets`), so `SUPABASE_STAGING_PROJECT_ID` resolved from repo scope,
where it exists alongside `SUPABASE_PROJECT_ID`. `≠ staging` is still not `= nmseef…` on its own, but
combined with §6.1 (the only writer that could have applied `20271500000000`, since the 11-15 `mode=push`
stopped at 755) and §6.3 (prod's own pooler DSN read holding 756 with that version), the ref that run
linked can only be the project prod's database belongs to. This is an outcome inference from a retained log,
not a read of the masked value, and it should be re-derived that way if the secret is ever re-pointed.

**This merge is itself a fourth instance of the inertness §6.4 measures.** Release run `43969361088` at
`22f82de18` logged verdict `noop_docs_only`, its gate `success`, and all eight remaining jobs —
`migrate staging`, both `deploy Development`/`Staging` legs, `smoke Development`/`Staging`, `migrate
production database`, `deploy Production`, `smoke Production` — `skipped`. The PR that documents "a docs-only
push releases nothing" released nothing.

## RBAC grant probe — checking a seed's result instead of its ledger row (written 2026-11-18, 21:00–22:24Z)

**Why this exists.** `20271700000000` (PR #1077, squash `6f58f0b0a` — re-read today as `origin/prod`'s tip,
subject "seed the connect.contests.view permission onto prod") was applied to production by this lane: run
`44376916739`, `Ops DB Push (scoped)` with `mode=apply` as dispatched here, head `5ec5870ce`,
`conclusion=success` — the last three re-read from the API in the session that wrote this section rather than
restated from the run page. It is also the first seed this lane booked whose **effect** could not be read from
here: a slug-keyed `INSERT … SELECT` that matches zero role rows commits, books `schema_migrations`, prints
`recorded: <version>`, and 403s a scoped admin forever. `pending: 0` and `recorded:` are both statements about
the **ledger**; nothing in the lane used to say anything about the **grants**. The runbook §8.1 added in the
same PR states the contract; this section records the measurement.

**Probe.** `scripts/db/probe-rbac-grants.sh` (272 lines) plus its harness `scripts/db/test-probe-rbac-grants.sh`
(288 lines, 14 sections, 59 assertions, 26 probe invocations), wired into
`.github/workflows/ops-db-push-scoped.yml` as its 4th input `rbac_expect` and 14th step
`RBAC grant probe (read-only)` (`if: !cancelled()`, so it also runs on a red apply). Contract and usage are
in the runbook §8.1; the exit codes are `0` clean-or-plan, `1` assertions do not hold (apply), `2` arguments
refused before any query, `3` database unreadable — deliberately distinct from "grants missing", because the
first version of this test conflated them and reported a red herring on a dead connection.

**Expected before running.** That a probe which never writes needs no proof beyond grep, and that the
fixture's own counts would be the read-only evidence.

**Observed.** Both were insufficient, and the interesting part is what it took to find that out:

- The harness runs against a `postgis/postgis:17-3.4` container (`Server 17.0`) holding only the RBAC plane —
  copying the DDL out of the migrations rather than replaying 758 of them. The 5 proof cases in the plan all
  reproduce: RED before the seed (row `MISSING`, three roles `MISSING`, exit 1 in apply / labelled `WARNING`
  and exit 0 in plan), GREEN after applying the real `20271700000000` bytes, the negative control (delete
  only `contest-manager`'s grant → that role `MISSING` while `super-admin` stays `GRANTED`), malformed input
  refused in both modes, empty input refused rather than vacuously green.
- **Read-only is precedence-sensitive, and only one of the three levers matters.** Measured on the fixture:
  `PGOPTIONS='-c default_transaction_read_only=on'` **beats** both `ALTER DATABASE postgres SET
  default_transaction_read_only = off` and `ALTER ROLE postgres SET … = off` — `SHOW` still returned `on` and
  `CREATE TABLE` was still refused, so pinning the GUC at db or role level cannot dislodge the lane's DSN. A
  DSN that carries its own `options=` **does** beat `PGOPTIONS`: `?options=-c%20default_transaction_read_only%3Doff`
  made `SHOW` answer `off` and a `CREATE TABLE` succeed. (libpq rejects a raw `=` inside a query value —
  *"extra key/value separator"* — and does not decode `+`, hence both escapes.) That single reachable case is
  why the probe reads its posture from the server instead of trusting its own environment.
- **Mutation testing, and the 3-of-4 false alarms.** An 11-mutant battery first reported four survivors;
  re-running with per-mutant byte verification showed three were **no-op patches** whose patterns are not in
  the file (`PGOPTIONS` is one statement on line 109, not two lines; the empty-expectation guard has existed
  since line 105; role validation is an inline `grep -Eq "$ROLE_RE"`, there is no `role_ok()` function), and
  the fourth matched twice, so the replacement never ran. A battery that cannot tell "not caught" from "not
  applied" manufactures survivors. Fixed: every mutant now has to prove the sha changed and the pattern was
  unique before its verdict counts. The one real survivor was `M14`, deleting
  `[ "$ro" = on ] || die3` — no behavioural case could see it, because the session genuinely is read-only in
  every other scenario. §7b now points the probe at the writable DSN above and requires exit 3 with no
  verdict lines, which kills both M14 and a sharper `M15` (`ro="on"`, the posture *printed* but never read).
  Final tally: **15 mutants, 15 caught**, probe restored byte-identically (`sha256` asserted after every run).
- The workflow step's own shell was exercised with `psql` stubbed on `PATH`: empty `rbac_expect` → notice
  naming the skip + exit 0; expectation set but `SCOPED_DB_URL` unresolved → `::error::` + exit 1; probe
  exit `0/1/2/3` → step exit `0/1/2/3`, each with its own mapped `::error::` text. `actionlint` v1.7.12 with
  CI's exact flags (`-no-color -oneline -shellcheck= -pyflakes=`, built by `go install` as `ci.yml:522-528`
  does) and the YAML parse (4 inputs, 14 steps, concurrency group unchanged) both run clean.

**Verdict.** The lane can now answer "did the seed take?" without a browser, and `mode=plan` + `rbac_expect`
with any already-recorded version is an anytime read-only production RBAC query — it writes nothing, needs no
migration, and is the cheap way to close the one thing still unproven here.

**Drift / what this does not prove.** No GitHub run of the modified workflow exists yet: the step is unexecuted
in CI, and the local reproduction above is a stubbed `psql`, not the runner. Production's actual
`permissions`/`role_permissions` rows for `connect.contests.view` are **still machine-unverified** — the first
`mode=plan` dispatch with `rbac_expect=connect.contests.view=super-admin,system-admin,contest-manager` is what
closes that, and it has not been dispatched. The fixture is Postgres 17.0; prod's major was not re-read in
this session, and the enforcement-path sample assumes the RPC's 4-argument form (`pg_proc.pronargs = 4`), so
an upstream signature change shows up as `rpc: SKIPPED`, never as a false green. As with everything in this
file, these citations are by **step name**: `rbac_expect` shifted this workflow's line numbers, which is the
same hazard §10.1's "never cite a number across a tree boundary" warns about from the other side: a line
number is only worth as much as the tree and the revision it was read from. Living references were
re-pointed to step names in the same commit; pin-qualified historical prose was left exactly as written.

## The grant probe finally reaches production — and `connect.contests.view` is verified (written 2026-11-19, 07:13–09:41Z)

The section above ended with production's `permissions`/`role_permissions` rows for
`connect.contests.view` **machine-unverified** and its dispatch "not yet run". Both halves of that
sentence are now closed, and the reason it took a second PR is the more useful fact: **the probe
could not run against production at all.**

**Root cause (measured, not inferred).** The probe bounded its session with
`PGOPTIONS='-c default_transaction_read_only=on'` and read that same session GUC back. Production is
reached through Supabase's **session pooler** — the direct host is AAAA-only, so a GitHub runner has
no alternative path — and that pooler **does not forward the client's `options` startup parameter**.
The server therefore answered `off`, the posture guard fired, and the first dispatch (run
`44478529252`, `mode=plan`, `versions=20271700000000`) exited 3 with *"this session is not read-only …
refusing to probe, nothing has been concluded"*. That refusal was the designed behaviour — exit 3 is
deliberately not exit 1 — but it meant the one question this tool exists to answer stayed unasked. The
`PGOPTIONS` precedence recorded in the previous section is real and still true on a **direct**
connection; it is simply unreachable from CI, so "export `PGOPTIONS` in the step" would not have
helped either.

**Fix (PR #1088, head `d9f7e499c`, squash `8c8db6bee` on `main` at 08:34:16Z; 30 success / 15 skipped
/ 0 failed on the head).** A **statement** survives any connection path, so `q()` now wraps every
query in `BEGIN READ ONLY … ROLLBACK`, and the posture guard reads `SHOW transaction_read_only`
*from inside that transaction* — what the wrapper actually did, rather than what the client asked
for. `PGOPTIONS` is kept (still the stronger posture when the path is direct) and the session value is
still printed, as information: a probe that hid a writable session would recreate the blind spot it
was fixing. There is deliberately **no write-canary** (`CREATE TABLE` inside the transaction) — if the
wrapper were ever stripped, the canary would create a table on production.

**Production verdict, twice.** Run `44483640603` (07:58Z, off the PR head) and run `44488847928`
(08:35Z, off `main` at the squash `8c8db6bee`) both completed in under a minute and printed the same
facts:

```
transaction: read-only (transaction_read_only=on)
session: default_transaction_read_only=off        ← the pooler fault, now harmless
permission row: present  connect.contests.view (is_system_permission=true)
holders: contest-manager, super-admin, system-admin
grant: GRANTED  super-admin    -> connect.contests.view
grant: GRANTED  system-admin   -> connect.contests.view
grant: GRANTED  contest-manager -> connect.contests.view
rpc: OK  super-admin -> connect.contests.view (1 of 1 eligible holder, sample …3f32, resolved via the role grant)
```

So seed `20271700000000` did not merely book a history row: its slug-keyed `INSERT … SELECT` matched
its role rows and the grants exist, and the enforcement path itself — the same
`public.user_has_permission` the middleware calls — returns true for a real user who holds the role,
resolved **via the role grant rather than the super-admin bypass**. That is the end of the gap that
made `pending: 0` an insufficient answer.

**What this still does not prove.** `system-admin` and `contest-manager` each reported
`rpc: no eligible holder … (no active, unexpired, global assignment to sample)`, which is
informational and by design: the candidate filter requires `scope_type = 'global'`, so nobody could be
sampled for those roles. The probe therefore proves the *role → permission* grant rows and one actual
enforcement-path resolution, not any individual user's scoped assignment. The owner-side confirmation
stays what it always was: a scoped contest-manager opening `/admin/competitions/results`.

**A destructive bug in the harness, found by running it somewhere real.** While verifying the fix, the
harness was pointed at the local dev database, and afterwards its baseline counts had moved: **368 →
367 permissions, 784 → 781 `role_permissions`**. `cleanup()` ran *before* the "fixture must start
WITHOUT the seed" precondition and deleted `connect.contests.view` plus — through `ON DELETE CASCADE`
— its three role grants, and the error text then told the operator to "run cleanup first". Its second
half was quieter and worse: cleanup replaced `public.user_has_permission` with a generic
EXISTS-based stub, which silently drops the super-admin bypass and scope rules from any real database
the harness touches. Dev was repaired by replaying the additive seed (`.view` now reads
contest-manager, super-admin, system-admin) and the harness now (a) requires the target to **prove** it
is disposable before its first write — seed row absent and no live global assignments, else exit 1 with
nothing deleted — and (b) cleans up only from a start-state snapshot: grants for roles that did not
hold the permission, the row only because the guard proved it absent, and the function restored from
`pg_get_functiondef`. Measured both directions: with the seed present it exits 1 leaving 28/52 rows and
a byte-identical function; on a clean fixture the whole suite passes leaving zero residue and an
unchanged RPC definition.

**Unrelated context for anyone reading the deploy rows.** The merge that carried this fix triggered
Release run `44488725106`, whose gate rendered **`proceed`** at 09:16Z and then lost all three
Development and all three Staging deploy legs; the dev legs' own output is
`Your trial has expired. Please select a plan to continue using Railway.` — the Railway subscription
lapse of 2026-11-19 (08:31–14:45Z, tracked separately from the staging upload fault). Nothing in
`8c8db6bee` is app code — two scripts, one workflow comment, one doc — and production's backend
lineage was not redeployed by it, so this section changes no deployed behaviour.

