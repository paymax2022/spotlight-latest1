# Staging → Production Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move production (`spotlightng.com`, Supabase `spotlight-prod`, Railway `production`) from its current 26-day-old, flag-less, schema-behind state to the same verified release SHA that staging runs, with every pending migration applied, every module flag set, and a machine-checked parity guard so the gap cannot silently reopen.

**Architecture:** Three planes migrate in dependency order — database first (additive-only, batched through the no-reviewer scoped lane), then configuration (committed flag sources + the two production config writers: Railway env vars and the cPanel lane's `.env.production.local`), then code (Railway `production` dispatch + the `spotlight-latest` cPanel deploy). Every task ends with a live probe whose expected value is stated before it is run, and every measured value is appended to one evidence ledger that is committed alongside the work.

**Tech Stack:** GitHub Actions (`.github/workflows/`), Supabase CLI + `psql` over the session pooler, Go 1.x backend (`backend/`), Next.js App Router BFF (`frontend-web/`), Railway CLI v5.40.1, bash + Python 3.6.8 on the Namecheap/cPanel host, Appleboy ssh-action under `script_stop: true`.

**Spec:** this plan argues from five in-repo sources, read in this order —
[docs/devops/deployment-matrix.md](file:///Users/paymax/Documents/spotlight/main/docs/devops/deployment-matrix.md)
(which lane is authoritative per service),
[docs/devops/cloud-migration-reconciliation-runbook.md](file:///Users/paymax/Documents/spotlight/main/docs/devops/cloud-migration-reconciliation-runbook.md)
(the throwaway → staging → production ladder this plan's Phase 2 follows),
[docs/devops/academy-prod-migration-set.md](file:///Users/paymax/Documents/spotlight/main/docs/devops/academy-prod-migration-set.md)
(the scoped-batch pattern and its §5.1/§5.2/§5.3 pre-flight gates),
[docs/runbooks/referral-gate-parity.md](file:///Users/paymax/Documents/spotlight/main/docs/runbooks/referral-gate-parity.md)
(the 503-is-a-missing-env-var class, already documented for one module), and
[docs/devops/staging-environment-setup.md](file:///Users/paymax/Documents/spotlight/main/docs/devops/staging-environment-setup.md)
(the ref table).

## Measured baseline (2026-11-12, all probes run this session)

These are the numbers the plan closes. Re-measure each at Task 1; if a figure has moved, the task that consumes it must be re-read, not re-guessed.

| Plane | Measured today | Target |
|---|---|---|
| Go API, prod | `GET backend-production-1b33d.up.railway.app/api/v1/public/build` → `{"commit":"41c19ea2b9…","source":"ldflags","started_at":"2026-10-17T15:14:19Z","uptime_seconds":2250504}` | the release SHA |
| Drift, prod backend → `origin/main` | **710 commits** total, **239** touching `backend/` | 0 |
| Go API, staging | `886d857f19…`, started 2026-11-02, **224 commits** behind `origin/main` | same SHA as prod |
| Prod schema | `supabase_migrations.schema_migrations` = **667** rows (read-only scoped run `42983741548`, 2026-11-11T08:01:35Z); `origin/main` carries **750** files in `supabase/migrations/`, every one named `20<12 digits>_…sql` → **≈83 pending**. Measured on the last captured table (2026-11-07, 663 applied) the classifier instead prints **87 pending = 69 above-max additive + 18 below-max additive + 0 NON-ADDITIVE** — the 4-version difference is the four days between the two reads, not two answers | 0 pending |
| Prod schema, **re-read 2026-11-16** | Through the session pooler: `schema_migrations` = **756** rows (all versions numeric), max applied `20271500000000`, `information_schema.tables` where `table_schema='public'` = **1416**. `origin/main` (`f90b3ef30`) carries **756** `supabase/migrations/*.sql`, and `comm` in both directions prints **0 / 0** — identical sets, no drift either way | **0 pending**, so the rows above ("≈83 pending", "111 files newer than prod") are superseded, not refined |
| Migrations added prod→main | **111** files under `supabase/migrations/` newer than prod's deployed state, against ≈83 unrecorded — the 28-file difference is **not yet explained** (already-applied academy-era files is the likely reading, not a proven one). Task 2 Step 6 produces the authoritative pending set, and the ledger must reconcile the two numbers before Phase 2 | — |
| Prod web module flags | `www.spotlightng.com/api/v1/restaurant/<uuid>` → **503** "Restaurant delivery is not available."; `/api/v1/referral/my-rewards` family → **503** "Referrals are not available."; `/api/v1/association/mine` → **503** | **401** Unauthorized (gate passed, auth refused) |
| Prod web runtime env | `spotlight-latest` `deploy-cpanel.yml` Finalize writes `.env.production.local` with exactly **4 keys**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GO_BACKEND_URL` — **zero `FEATURE_*`** | 4 + the 36 reviewed flags |
| Host env-file inventory | That run's own probe step (`Probe prod Supabase runtime env (read-only)`, run `43037664704` 2026-11-11T14:23:27Z) lists **one** `.env*` file in `APP_DIR` — `.env.production.local`, mtime `2026-11-11T07:50:07` — holding those same 4 keys, and no `FEATURE_*` | unchanged; Task 8's truncate-and-write therefore drops nothing it did not itself write |
| Prod BFF for mobile | `frontend-web-production-9259.up.railway.app` same probe → **401** (its Railway env carries 49 `FEATURE_*`, 46 ON) | unchanged for the 36; **but see the academy row — that build predates some routes entirely** |
| Academy gates, both web planes | `GET /api/academy/topics` and `/api/academy/exams` → **503 on `www.spotlightng.com` AND on staging**; `/api/academy/certificates/verify/<id>` → **503 "Credential verification is not available yet"** on both. Cause: `FEATURE_FILM_ACADEMY_TOPICS_ENABLED`, `FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED`, `FEATURE_FILM_ACADEMY_PILOT_DELIVERY_ENABLED` are **absent from staging's `frontend-web` env too**, so "copy staging's ON set" reproduces a broken product area. The same probe on the mobile-facing prod BFF → **404 "No API route matches GET /api/academy/topics"**, i.e. that plane's served build has no academy routes at all | a decision per name in Task 7 Step 5, recorded in the flag file as an explicit `=false` unless promoted |
| Full flag sweep (code-derived routes) | The Task 14 probe (`scripts/flagprobe.sh`, wrapper-aware) against today's `www.spotlightng.com`, over all 45 names in `production-module-flags.env`: **85 gated route lines → 48×503, 25×405, 1×401, 10 NO-ROUTE** (the four buckets total 84; the capture does not record the 85th line's class). Of the 36 declared `true`, **28 answer 503 on at least one real gated route**, **5 resolve to no `app/api` route at all** (`estate`, `healthLab`, `healthPharmacy`, `healthVet`, `otpEmail` — their sole reader `isModuleVisible` at `frontend-web/src/server/modules/visibility.ts:59-66` has zero callers, so they are inert in the web plane), **2 are provable by an HTTP flip** (403 while off, not 200: `FEATURE_VOTE_BRIDGE_ENABLED`, read directly at `app/api/v2/votes/wallet/route.ts:78`, and `VOTES_BRIDGE_ENABLED`, read at runtime by `isBridgeEnabled()` in `frontend-web/src/server/voting-bridge/feature-flag.ts:14` — the two the draft called inert), and only `FEATURE_REALTOR_ENABLED` is clean. The draft's list was wrong because the probe follows `featureFlags.X(` accessors and `requireFeature('X')` but neither direct `process.env.FEATURE_*` reads nor helpers a route calls (which is how the runtime reader above was missed). `FEATURE_UTILITY_BILLS_GO_PROXY_ENABLED` is **not** inert: it gates three real routes through the `utilityGoProxyEnabled()` wrapper in `app/api/v1/utility/_utils.ts:67`, which is why the probe follows wrappers — the first, route-only draft of it mis-filed that flag with the inert names. Production therefore serves almost none of the promoted modules today | 503 must disappear for every flag with a GET handler; the 5 inert names get recorded as "not HTTP-provable", not as passing |
| Backend Railway flags | prod has 54 `FEATURE_*` (50 ON) vs staging 64 (62 ON) → **12** staging-ON names not ON in prod | flag-for-flag parity |
| Backend non-flag keys | prod is missing 5 names staging holds: `DOJAH_BASE_URL`, `DOJAH_PUBLIC_KEY`, `R2_ENDPOINT`, `R2_BUCKET_NAME`, `QUIDAX_WEBHOOK_SECRET` (+ `ADMIN_SIGNUP_CODE`, `AUTH_IDENTITY_CACHE_TTL_SECONDS`); prod holds 4 staging lacks: `CORS_ALLOW_ORIGINS`, `MAPLERAD_PROD`, `REDIS_PRIVATE_URL`, `WS_TICKET_SIGNING_SECRET` | decided per name, in Task 12 |
| `frontend-admin` prod | lacks `PAYSTACK_PUBLIC_KEY` / `PAYSTACK_SECRET_KEY` that staging holds; `WEB_API_BASE_URL=https://frontend-web-production-9259.up.railway.app` while the public site is `https://www.spotlightng.com` | Task 13 |
| Backups | `docs/devops/backup-restore-runbook.md:37` — "not yet scheduled — no render.yaml cron or GitHub" | dump taken **and** restore rehearsed before any prod write |

## Global Constraints

- **Refs.** Production = `nmseefdlliejmdbxytej` (eu-north-1). Staging = `wnicsubiznmishkmunsv` — **the same project local dev uses** (Supabase free plan, 2 active projects, so there is no third DB). `ptczqwfokydsdafpscex` is retired: never configure from it, and treat it appearing in any runtime env as the fault it already caused once.
- **DDL is additive-only.** `DROP TABLE|COLUMN|TYPE|SCHEMA|DATABASE`, `ALTER … DROP`, `RENAME COLUMN|TO`, `TRUNCATE`, `SET NOT NULL` are forbidden in any migration this plan applies. `DROP <policy|trigger|index|function|view> IF EXISTS` is the allowed re-create pattern.
- **Never** `supabase migration repair --status applied` a version whose DDL did not run — that is how the academy tables were stranded.
- **Ordering is not negotiable:** backup → schema → config → code → verify. Migrations are applied before traffic (deployment-matrix.md §Reconciliation checklist item 4).
- **The scoped lane caps at 12 versions per run** (`ops-db-push-scoped.yml:214`, "past this the list is a sweep wearing a scoped label"). 87 pending on the stale table ⇒ **8 writes** (6 above-max batches of 12,12,12,12,12,9 + 2 back-dated of 12,6 — the exact split Task 6 Step 1 verifies); re-read the count from Task 2 Step 6 rather than this figure.
- **Approvals.** `production-db-scoped` has no reviewers (automatable, and it is the only prod DB writer this plan uses). `Production` has required reviewers `18039055` and `59900242` — anything dispatched into it (including read-only `ops-db-push.yml mode=list environment=production`) **parks** until a named human approves. Never leave a parked prod approval unaddressed, and never approve one on someone else's behalf.
- **Never put a secret in a `workflow_dispatch` input** — inputs are visible in the run's input pane. Booleans and names only; secret values travel via copy lanes or the dashboard.
- **Never print secret values** in a reply, a commit, or a log. Names and lengths only.
- **Do not push or merge anything to the `staging` branch.** frontend-web releases from `main` only (`staging-frontend-web-deploy.yml` was deleted in `b5bc4480f`; the policy is user-set).
- **`frontend-web/**` pushed to `main` IS a production release** — `sync-frontend-web.yml` → `paymax2022/spotlight-latest` `main` → its ungated `Deploy to Namecheap cPanel (SSH)`. A docs-, backend- or mobile-only push to main releases nothing. Say so before every push.
- **`script_stop: true` on ssh-action forbids** `case`, `else`, `set +e`, and multi-line quoted arguments; an `if` block survives only while its condition exits 0. Host scripts in this plan are written as flag variables + single-line commands.
- **Local worktree is not the truth.** `/Users/paymax/Documents/spotlight/main` is on `main` at `bc86d5a77`, **10 ahead / 31 behind `origin/main` (`8436ad005`)**, with 97 files dirty from concurrent sessions. Author and verify against `git show origin/main:<path>`; never `rebase`/`reset`/`stash` that tree.
- **Verification is by served bytes, not run colour.** A green deploy proves delivery, not serving: re-grep the live page's chunk hrefs (and delete `.next/server/route-cache` is already handled by the lane).
- **Staging's ON set is a starting point, not the definition of correct.** Nine names the BFF reads are absent from staging's `frontend-web` env (`FEATURE_FILM_ACADEMY_{TOPICS,ASSESSMENT,PILOT_DELIVERY}_ENABLED`, `FEATURE_CHECKOUT_TOPUP_TIER0`, `FEATURE_DOCTOR_ENABLED`, `FEATURE_ESTATE_DUAL_CONTROL_ENABLED`, `FEATURE_FINTECH_ADMIN_ENABLED`, `FEATURE_P2P_MARKET_ENABLED`, `FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED`), and three of them demonstrably 503 on staging today. Each is decided by name in Task 7 Step 5 and written into the flag file as `=true` or `=false`, never left implicit.
- **A 405 or a 404 is not evidence about a gate.** `requireFeature` throws 503 *inside* the handler, so Next answers 405 for an unsupported method without ever reaching the gate, and answers 404 when the route is not in the served build. Only 503 vs 401/400 decides "was the flag read".

---

## Phase 0 — Baseline and the release cut

### Task 1: Pin one release SHA and open the evidence ledger

**Files:**
- Create: `docs/devops/production-migration-ledger.md`
- Reference: `docs/devops/deployment-matrix.md`, `docs/devops/cloud-migration-reconciliation-runbook.md`

**Interfaces:**
- Produces: `RELEASE_SHA` (a full 40-char commit on `origin/main`) used by Tasks 4, 11, 12, 14; and the ledger file every later task appends to.

- [ ] **Step 1: Confirm the stale-tree trap before reading anything**

Run: `git -C /Users/paymax/Documents/spotlight/main rev-list --left-right --count HEAD...origin/main`
Expected: `10	31` (or a larger right-hand number). This is why every later `Read` in this plan names `git show origin/main:<path>`.

- [ ] **Step 2: Pick the release SHA**

Choose the current `origin/main` tip only if its verification lanes are green; otherwise walk back to the newest SHA whose `ci.yml` + `integration-verify.yml` runs both concluded `success`.

```bash
cd /Users/paymax/Documents/spotlight/main
for SHA in $(git log --format=%H -20 origin/main); do
  gh run list --repo paymax2022/spotlight-latest1 --commit "$SHA" \
    --json workflowName,conclusion --jq '.[] | .workflowName + "=" + (.conclusion // "?")' \
    | tr '\n' ' ' ; echo "  <- ${SHA:0:9}"
done
```

Expected: lines naming `CI`, `Integration Verify`, `Deploy to Namecheap cPanel (SSH)`, `Spotlight Frontend Web Safe Merge`. Select the newest SHA whose `CI` and `Integration Verify` are both `success`, then pin it:

```bash
RELEASE_SHA=<that 40-char sha>
git log -1 --format='%H %ci %s' "$RELEASE_SHA"
echo "$RELEASE_SHA" > /tmp/RELEASE_SHA          # shell state does not survive between steps
```

Every later block that says `"$RELEASE_SHA"` assumes it is exported in *that* call. A fresh shell expands it to empty, and the failure is quiet in the worst way: `worktree add --detach /tmp/rel ""` errors, but `gh run list --commit ""` happily lists every run in the repo. So read it back at the head of any block that uses it:

```bash
RELEASE_SHA="$(cat /tmp/RELEASE_SHA)"; [ "${#RELEASE_SHA}" = 40 ] || { echo "FATAL: RELEASE_SHA missing or not 40 chars"; exit 1; }
```

- [ ] **Step 3: Write the ledger with the baseline table above**

Create `docs/devops/production-migration-ledger.md` containing the `RELEASE_SHA`, its date/subject, and a `## Baseline` section reproducing every row of the Measured-baseline table **with the command that produced it** under each row. Add one line stating the deployment-matrix authority rule: a lane's colour is never evidence of what the site serves.

- [ ] **Step 4: Verify the ledger is committed as docs-only (so it cannot deploy anything)**

```bash
cd /Users/paymax/Documents/spotlight/main
git add docs/devops/production-migration-ledger.md
git commit -m "docs(devops): open the staging→production migration ledger at the pinned release SHA"
git show --stat --format=%s HEAD | head -5
```

Expected: the stat lists **only** `docs/devops/production-migration-ledger.md`. `sync-frontend-web.yml` is path-filtered to `frontend-web/**` and `db-migrate.yml` to `supabase/migrations/**` + its own file, so this commit releases nothing when pushed. Do not push it yet — Task 16 Step 2 pushes the doc set.

### Task 2: Produce the authoritative pending-migration list

The repo's own helpers cannot produce this list — `scripts/db/reconcile-pending.sh` and `classify-pending-migrations.sh` bucket only what `supabase migration list` prints, and that command's table is what the academy notes proved unreadable by their `awk` filter ("APPLIED=0 MISSING=0 REVIEW=0" even on a connection that reads 663 history rows). This task writes a real classifier and tests it.

**Files:**
- Create: `scripts/db/list-pending.sh`
- Create: `scripts/db/test-list-pending.sh`
- Modify: `Makefile` (add a `pending-list` target after `migrate-up`, Makefile:91)

**Interfaces:**
- Consumes the remote's applied set in one of two forms: `--remote <versions.txt>` (one 14-digit version per line) or `--remote-table <list-log.txt>` (the raw `supabase migration list` table text from a `mode=list` run — Step 5 produces this).
- Produces: `pending <version> <file> <above|max_applied> <additive|NON-ADDITIVE>` lines on stdout, apply order (version ascending); exit 0 only when nothing is `NON-ADDITIVE`.

- [ ] **Step 1: Write the failing test**

Create `scripts/db/test-list-pending.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # scripts/db -> repo root
LIST="$ROOT/scripts/db/list-pending.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
MIG="$TMP/supabase/migrations"; mkdir -p "$MIG"
printf 'CREATE TABLE a (id int);\n'             > "$MIG/20270000000001_one.sql"
printf 'DROP TABLE b;\n'                        > "$MIG/20270000000002_drop.sql"
printf 'ALTER TABLE c ALTER COLUMN d SET NOT NULL;\n' > "$MIG/20270000000003_narrow.sql"
printf 'CREATE TABLE z (id int);\n'             > "$MIG/20260101000000_backdated.sql"
printf '20270000000001\n' > "$TMP/applied.txt"
# `|| true` is load-bearing: the classifier exits 1 on this very fixture (a
# NON-ADDITIVE row exists), and under `set -e` a failing command substitution
# would abort the test before it asserts anything.
out="$(bash "$LIST" --remote "$TMP/applied.txt" --migrations "$MIG" || true)"

echo "$out" | grep -q '^pending 20270000000002 .* NON-ADDITIVE' || { echo "FAIL: drop not flagged"; exit 1; }
echo "$out" | grep -q '^pending 20270000000003 .* NON-ADDITIVE' || { echo "FAIL: SET NOT NULL not flagged"; exit 1; }
echo "$out" | grep -q '^pending 20260101000000 .* below-max'    || { echo "FAIL: back-dated not marked"; exit 1; }
echo "$out" | grep -q '^pending 20270000000001' && { echo "FAIL: applied version listed"; exit 1; }
if bash "$LIST" --remote "$TMP/applied.txt" --migrations "$MIG" >/dev/null 2>&1; then
  echo "FAIL: must exit non-zero when a NON-ADDITIVE row is present"; exit 1
fi
# An empty remote list is refused rather than read as "everything is pending".
: > "$TMP/empty.txt"
if bash "$LIST" --remote "$TMP/empty.txt" --migrations "$MIG" >/dev/null 2>&1; then
  echo "FAIL: empty remote list must be refused"; exit 1
fi
# --remote-table reads the CLI's own table. The 20270000000002 row is LOCAL-ONLY
# (Remote padded with a space between backticks), so it must still come back as
# pending; sweeping every 14-digit run instead calls it applied and hides it.
cat > "$TMP/table.txt" <<'TBL'
 Local            | Remote           | Time (UTC)
------------------|------------------|-----------------------
 `20260101000000` | `20260101000000` | `2026-01-01 00:00:00`
 `20270000000002` | ` `              | `2027-01-01 00:00:00`
 `20270000000003` | `20270000000003` | `2027-01-01 00:00:00`
TBL
tout="$(bash "$LIST" --remote-table "$TMP/table.txt" --migrations "$MIG" || true)"
echo "$tout" | grep -q '^pending 20270000000002 .* NON-ADDITIVE' || { echo "FAIL: local-only row must stay pending"; exit 1; }
# The table's max applied is ...0003, so ...0001 and ...0002 are below-max: the
# hazard that makes a bare `db push` apply nothing.
echo "$tout" | grep -q '^pending 20270000000001 .* below-max additive' || { echo "FAIL: absent-from-table row must be pending below-max"; exit 1; }
echo "$tout" | grep -q '^pending 20260101000000' && { echo "FAIL: table row with a Remote value listed"; exit 1; }
echo "$tout" | grep -q '^pending 20270000000003' && { echo "FAIL: table row with a Remote value listed"; exit 1; }
echo "$tout" | grep -q 'recorded: 2' || { echo "FAIL: --remote-table must record 2 applied versions"; exit 1; }
# A table with no applied rows is refused, not read as "nothing is applied".
printf ' Local            | Remote           | Time (UTC)\n `20270000000001` | ` ` | `x`\n' > "$TMP/none.txt"
if bash "$LIST" --remote-table "$TMP/none.txt" --migrations "$MIG" >/dev/null 2>&1; then
  echo "FAIL: all-local-only table must be refused"; exit 1
fi
# Malformed --remote input is refused too — a typo here silently mis-orders prod.
printf '2027-01-01\n' > "$TMP/bad.txt"
if bash "$LIST" --remote "$TMP/bad.txt" --migrations "$MIG" >/dev/null 2>&1; then
  echo "FAIL: malformed remote line must be refused"; exit 1
fi
echo "PASS"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/paymax/Documents/spotlight/main && bash scripts/db/test-list-pending.sh`
Expected: FAIL — `scripts/db/list-pending.sh: No such file or directory`.

- [ ] **Step 3: Write the classifier**

Create `scripts/db/list-pending.sh`:

```bash
#!/usr/bin/env bash
# list-pending.sh — which committed migrations are NOT recorded in a remote's
# history table, in apply order, each tagged for the two hazards that bit this
# repo: files that sort BELOW the remote's max applied version (a bare
# `supabase db push` silently applies nothing when any exist) and files that are
# not additive-only. Read-only: it never touches a database.
set -euo pipefail
REMOTE=""; TABLE=""; MIG="supabase/migrations"
while [ $# -gt 0 ]; do
  case "$1" in
    --remote) REMOTE="$2"; shift 2 ;;
    --remote-table) TABLE="$2"; shift 2 ;;
    --migrations) MIG="$2"; shift 2 ;;
    *) echo "usage: list-pending.sh (--remote <versions.txt> | --remote-table <list-log.txt>) [--migrations <dir>]" >&2; exit 2 ;;
  esac
done
[ -n "$REMOTE" ] || [ -n "$TABLE" ] || { echo "refusing: no remote state given" >&2; exit 2; }
[ -n "$REMOTE" ] && [ -n "$TABLE" ] && { echo "refusing: --remote and --remote-table are alternatives" >&2; exit 2; }
if [ -n "$TABLE" ]; then
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  # Column 2 only. A LOCAL-ONLY row pads Remote with a space between backticks,
  # so sweeping every 14-digit run instead counts pending versions as applied.
  awk -F'|' '/`20[0-9]{12}`[ ]*\|/ { v = $2; gsub(/[` ]/, "", v); if (v ~ /^20[0-9]{12}$/) print v }' \
    "$TABLE" | sort -u > "$TMP/remote.txt"
  REMOTE="$TMP/remote.txt"
fi
[ -s "$REMOTE" ] || { echo "refusing: remote version list is missing or empty" >&2; exit 2; }
grep -qvE '^ *[0-9]{14} *$' "$REMOTE" && { echo "refusing: remote list holds a non-14-digit line" >&2; exit 2; }
max="$(tr -d ' ' < "$REMOTE" | sort | tail -1)"
DESTRUCTIVE='drop[[:space:]]+(table|column|type|schema|database|domain|sequence)|truncate[[:space:]]|alter[[:space:]]+[a-z0-9_."]+[[:space:]]+drop|rename[[:space:]]+(column|to)|set[[:space:]]+not[[:space:]]+null'
ALLOW='drop[[:space:]]+(policy|trigger|index|function|view|materialized[[:space:]]+view|publication|rule)[[:space:]]+if[[:space:]]+exists'
bad=0
for f in "$MIG"/*.sql; do
  v="$(basename "$f" | cut -d_ -f1)"
  grep -qx "$v" "$REMOTE" && continue
  # Same vocabulary as .github/workflows/_reusable-migration-guard.yml:102-104 —
  # one source of truth for "destructive", plus SET NOT NULL (a narrowing CI's
  # regex cannot judge without seeing the data) and TRUNCATE. Comments are
  # stripped first so a header note about "no DROP TABLE" is not read as DDL.
  # `|| true` is load-bearing twice over: grep exits 1 on a zero-match line and
  # `set -o pipefail` propagates that through `wc -l` into the assignment, which
  # under `set -e` would abort the sweep on the first clean migration.
  hits="$(sed -E 's/--.*$//' "$f" | grep -iE "$DESTRUCTIVE" | grep -ivE "$ALLOW" | wc -l | tr -d ' ' || true)"
  if [ "$hits" -gt 0 ]; then kind=NON-ADDITIVE; bad=$((bad + 1)); else kind=additive; fi
  pos=above-max; [ "$v" -lt "$max" ] && pos=below-max
  printf 'pending %s %s %s %s\n' "$v" "$(basename "$f")" "$pos" "$kind"
done
echo "-- remote max applied: $max | recorded: $(wc -l < "$REMOTE" | tr -d ' ')"
[ "$bad" -eq 0 ] || exit 1
```

**Why a new script, when `scripts/db/` already holds `classify-pending-migrations.sh` and `reconcile-pending.sh`:** both of those need a database URL reachable from wherever they run, and this plan's prod project is not reachable from a laptop (the direct host is IPv6-only, which is why the lanes compose a session-pooler DSN server-side). Verified on the release tree today:

```
$ bash scripts/db/classify-pending-migrations.sh 'postgres://nobody:nobody@127.0.0.1:59999/postgres?sslmode=disable' supabase/migrations
version	bucket	kind	sentinel
$ echo $?
0
```

750 migration files on disk, an unreachable database, and the output is a bare header with **exit 0** — its `supabase migration list --db-url … 2>/dev/null` swallows the connection failure, `pending.txt` comes out empty, and every bucket is empty. That is a false green by silence, and this repo has already been caught by it: `ops-db-push-scoped.yml:161-166` records that *"a dead DSN, a DSN the CLI cannot use, and a fully-recorded history all print the same `APPLIED=0 MISSING=0 REVIEW=0` — two prod runs proved it"*. This task exists to remove that failure mode: `list-pending.sh` reads a captured table, never a live connection, and **refuses** an empty applied set instead of reporting none-pending. Its column-2 awk is deliberately the same shape as `classify-pending-migrations.sh:17` (`$2 !~ /[0-9]/`), so the two scripts agree on what the table means — and the `--remote-table` case in Step 1 locks that agreement down. Step 5 reconciles the parsed count against psql's own, because the table alone cannot see an applied version whose file is missing.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/paymax/Documents/spotlight/main && bash scripts/db/test-list-pending.sh`
Expected: `PASS`.

- [ ] **Step 5: Get the remote version lists**

Production needs a named reviewer; staging does not. Dispatch both read-only, and note in the ledger that the prod run parks.

```bash
gh workflow run ops-db-push.yml --repo paymax2022/spotlight-latest1 \
  -f environment=staging -f mode=list
gh workflow run ops-db-push.yml --repo paymax2022/spotlight-latest1 \
  -f environment=production -f mode=list
gh run list --repo paymax2022/spotlight-latest1 --workflow ops-db-push.yml --limit 4 \
  --json databaseId,status,conclusion,createdAt
```

Expected: the staging run completes `success`. The production run reports `waiting` — ask a reviewer holding one of `18039055`/`59900242` to approve that specific deployment, and record who and when in the ledger. If no reviewer is available, fall back to the scoped lane, which needs no approval and reads the same history table:

```bash
gh workflow run ops-db-push-scoped.yml --repo paymax2022/spotlight-latest1 \
  -f mode=plan -f versions="20271060000000"
```

Then capture the table from whichever run succeeded — one file per environment — and classify from the table, never from a number sweep:

```bash
cd /Users/paymax/Documents/spotlight/main
gh run view <prod-list-run-id> --repo paymax2022/spotlight-latest1 --log \
  | awk -F'\t' '$2 == "Migration list (before)"' > /tmp/prod_table.txt
gh run view <staging-list-run-id> --repo paymax2022/spotlight-latest1 --log \
  | awk -F'\t' '$2 == "Migration list (before)"' > /tmp/staging_table.txt
grep -c '|' /tmp/prod_table.txt /tmp/staging_table.txt
```

Expected: both files non-empty. `--remote-table` takes column 2 (Remote) only, which is the applied set.

**Do not substitute a `grep -oE '20[0-9]{12}'` sweep of the log — measured against the 2026-11-07 production `mode=list` run (job `supabase list (production)`, run `42367077299`'s successor at that date), that sweep returns 749 "versions" while only 663 are applied. The other 86 are exactly the LOCAL-ONLY rows: the CLI prints them as `` `20271060000000` | ` ` `` so the *Local* number is still in the text. Feeding the sweep to `--remote` therefore marks every pending migration as already applied and the classifier prints 0 pending — a false green that would have cancelled this entire migration on the first run.**

Reconcile the parsed count against psql's own history count (`SELECT COUNT(*) FROM supabase_migrations.schema_migrations`), which Task 6 Step 2 prints as `remote history rows: N`:

```bash
awk -F'|' '/`20[0-9]{12}`[ ]*\|/ { v = $2; gsub(/[` ]/, "", v); if (v ~ /^20[0-9]{12}$/) print v }' \
  /tmp/prod_table.txt | sort -u | wc -l
```

Two facts about these numbers, both measured on this project:

- **The table cannot see an applied version whose file is gone.** Every row in the 2026-11-07 prod table has a filled `Local` cell — 663 applied + 86 local-only = the 749 lines carrying a version — and **0 rows with a blank `Local`**. So a version recorded in `supabase_migrations` but absent from the tree does not appear in this text at all, and the table alone cannot tell "none exist" from "the CLI hid them". The *only* detector is the comparison: psql `N` above the parsed `recorded:` count means `N − recorded` applied versions have no migration file, i.e. schema changes this repo does not describe. Record any such gap in the ledger and name it in Task 3's rehearsal, because a restore-and-replay of the tree will not reproduce them.
- **These two figures agreed on the same date, and the plan's earlier ≈83 estimate came from a later one.** The lane's own comment (`ops-db-push-scoped.yml:165`) records prod reading `663 history rows`, and the parsed table from that run also yields 663 — no gap. The `667` in this plan comes from the 2026-11-11 prod dump restore, four days later. So prod's true current pending count is `files − 667` (≈83 on a 750-file tree), while the 87 measured below is what the stale table shows; a fresh `mode=list` run closes the difference. Do not read the two numbers as a contradiction — read them as two dates. **Re-read 2026-11-16 and the sentence is now obsolete:** prod is at **756** applied versions against a **756**-file tree with set-difference **0** in both directions, so `files − 667` describes a backlog that no longer exists. Prod has been written since this line was written — first by the two `ops-db-push-scoped` applies, then to 755 and 756 — and Task 6's remaining obligation is only the authoritative `mode=list` confirmation, not an 83-migration sweep.

- [ ] **Step 6: Run the classifier against the live tree at the release SHA**

```bash
cd /Users/paymax/Documents/spotlight/main
git -c advice.detachedHead=false worktree add --detach /tmp/rel "$RELEASE_SHA"
cd /tmp/rel
FILES=$(ls supabase/migrations/*.sql | wc -l | tr -d ' ')
echo "repo files at the release SHA: $FILES"
bash scripts/db/list-pending.sh --remote-table /tmp/prod_table.txt > /tmp/pending.txt
echo "classifier exit=$?"
grep -c '^pending' /tmp/pending.txt          # not `wc -l`: the file's last line is the summary
tail -1 /tmp/pending.txt
grep -c 'above-max' /tmp/pending.txt; grep -c 'below-max' /tmp/pending.txt; grep -c 'NON-ADDITIVE' /tmp/pending.txt
```

Measured today against the 2026-11-07 production table, on `origin/main`'s tree (750 files, 663 applied rows parsed from the table):

```
87 pending   =  69 above-max additive  +  18 below-max additive  +  0 NON-ADDITIVE
-- remote max applied: 20271073000000 | recorded: 663
classifier exit=0
```

`$FILES` can differ at your SHA, and the table is five days stale — that number, not this one, is what Phase 2 closes. Three things to take from the shape of it: **`above-max` + `below-max` must equal the pending count exactly**; the **18 `below-max`** files are the set that makes a bare `supabase db push` a silent no-op, so they are the reason the scoped lane's `--apply-one`-by-name is the only prod writer this plan uses; and a `NON-ADDITIVE` count above 0 is a stop-event — those versions get rewritten as new additive files before Phase 2 touches them. On today's backlog the stop-event does **not** fire (0), which is worth recording as evidence rather than assuming: the four files an earlier, wider draft of this pattern flagged are `ALTER … DROP NOT NULL` (×2) and `ALTER … DROP CONSTRAINT` (×2), all relaxations the repo's own guard allows. Expect ≈8 batches at the scoped lane's 12-per-run cap (87 ÷ 12), not the 7 an earlier estimate implied.

- [ ] **Step 7: Commit**

```bash
cd /Users/paymax/Documents/spotlight/main
git add scripts/db/list-pending.sh scripts/db/test-list-pending.sh Makefile
git commit -m "feat(db): classify unapplied migrations by order and destructiveness

The existing classifier and reconciler both need a database reachable from the
machine running them, and prod's direct host is not reachable from a laptop.
Against a dead URL classify-pending-migrations.sh prints a bare header and exits
0 with 750 migrations on disk: its \`supabase migration list\` pipes stderr to
/dev/null, so a failed connection reads as \"nothing pending\". This takes the
applied set from a captured CI table instead, refuses an empty one, and names the
two hazards that actually block a prod push: files sorting below the remote max,
and narrowing DDL -- using the guard workflow's own vocabulary."
```

Expected: one commit, three paths. Verify the `Makefile` hunk only adds a target: `git show --stat HEAD`.

---

## Phase 1 — Rollback capacity before any prod write

### Task 3: Take the pre-cutover dump and prove it restores

`docs/devops/backup-restore-runbook.md:37` states the scheduled dump is "not yet scheduled — no render.yaml cron or GitHub". An ≈83-migration sweep with no tested restore is not a migration, it is a bet.

**Files:**
- Modify: `docs/devops/production-migration-ledger.md` (append `## Backup`)
- Reference: `docs/devops/backup-restore-runbook.md` §3, §4, §5

**Interfaces:**
- Consumes: `RELEASE_SHA`.
- Produces: a dated prod dump path/backup id recorded in the ledger, plus a restore-rehearsal note that names the throwaway DB it was restored into.

- [ ] **Step 1: Trigger a dashboard backup of `nmseefdlliejmdbxytej` and log its id**

Do this in the Supabase dashboard (PITR/backup list) — there is no CI path to it, and `gh` cannot mint it. Record: backup id, start/finish time, size.

- [x] **Step 2: Take a logical dump through the session pooler**

The direct host `db.nmseef….supabase.co` is AAAA-only and GitHub runners (and many local networks) have no IPv6 route; the pooler is the address that works (`ops-db-push-scoped.yml:86`). From a machine that holds the prod DB password:

```bash
pg_dump "postgres://postgres.nmseefdlliejmdbxytej:<pw>@aws-0-eu-north-1.pooler.supabase.com:5432/postgres?sslmode=require" \
  --format=custom --file=/tmp/prod-pre-cutover.dump
ls -l /tmp/prod-pre-cutover.dump
```

Expected: a non-zero-length file. **Never** commit or paste the DSN; keep it in a shell variable. If no local copy of the password exists, run the dump from `ops-db-push.yml`-equivalent CI context instead of asking anyone to paste it into chat.

- [x] **Step 3: Rehearse the restore into a throwaway database**

Two shapes will bite if copied from a generic runbook. The dump is of Supabase's `postgres` database, so `pg_restore --create` tries to create a database named `postgres`, which already exists — make the target DB yourself and restore into it by name. And a fresh Postgres has no `auth`/`storage` schemas and no `anon`/`authenticated`/`service_role` roles, so the dump's GRANT/COMMENT statements abort the restore: run this repo's own Supabase-compat prelude first, the same one `integration-verify.yml` runs. Use the postgis image for the same reason Task 4 does.

```bash
cd /Users/paymax/Documents/spotlight/main
export POSTGRES_PORT=55432
bash scripts/ci/start-postgres-service.sh postgis/postgis:17-3.4 prod-restore-rehearsal
psql "postgres://paymax:paymax@localhost:${POSTGRES_PORT}/paymax?sslmode=disable" \
  -v ON_ERROR_STOP=1 -q -f scripts/ci/supabase-compat-prelude.sql
psql "postgres://paymax:paymax@localhost:${POSTGRES_PORT}/paymax?sslmode=disable" \
  -v ON_ERROR_STOP=1 -c 'CREATE DATABASE rehearsal;'
pg_restore -d "postgres://paymax:paymax@localhost:${POSTGRES_PORT}/rehearsal" \
  --no-owner --jobs=2 /tmp/prod-pre-cutover.dump
R='postgres://paymax:paymax@localhost:55432/rehearsal'
psql "$R" -tAc 'select count(*) from supabase_migrations.schema_migrations;'
psql "$R" -tAc "select count(*) from information_schema.tables where table_schema='public';"
```

Expected: history count **equal to prod's own live count at the moment the dump is taken** — re-measured 2026-11-16 as **756**, not the `667` this plan was written against, because prod has since been written to 755 and then 756 (see the ledger's release-lane section). Take the live count first (`select count(*) from supabase_migrations.schema_migrations` through the pooler), dump, restore, and compare the rehearsal against *that* number; `667` is a 2026-11-11 figure and must not be used as the pass condition. That equality is the whole point of the rehearsal, because it proves the dump carries the migration ledger, which is what a rollback would have to reconcile against. Record the public-table count as the control Task 6's post-check compares to — **1416** measured 2026-11-16. A restore that lands fewer history rows is not a usable rollback: stop and fix the dump before Phase 2.

`pg_restore` reports non-fatal `ERROR:` lines for `ALTER TABLE … OWNER TO` when `--no-owner` is omitted and roles differ; read the exit status, not the noise, and re-run with the offending object named in the ledger if the exit is non-zero.

- [x] **Step 4: Tear the rehearsal down and read the targets Phase 2 will replay**

```bash
cd /Users/paymax/Documents/spotlight/main
docker rm -f prod-restore-rehearsal
git show origin/main:Makefile | sed -n '91,116p'
```

Expected: the quoted `migrate-up` / `migrate-reset` / `rls-check` bodies are the exact commands Task 4 replays, so the local rehearsal and the CI lane are provably the same procedure.

- [x] **Step 5: Append `## Backup` to the ledger and commit**

Include: backup id, dump size, restore-rehearsal counts, teardown confirmation, and the one-line rollback instruction (`pg_restore` into a fresh DB is proven; in-place prod rollback needs the dashboard restore, which is a human action).

```bash
git add docs/devops/production-migration-ledger.md
git commit -m "docs(devops): prove the pre-cutover prod dump restores"
```

---

## Phase 2 — Schema reconciliation (the runbook's three stages)

### Task 4: Stage 1 — replay every migration on a fresh database

This is `integration-verify.yml`'s job (`make migrate-reset` → `migrate-up` → `make rls-check`), already wired to run on every push to `main`, so the release SHA's green run *is* the evidence. Step 2 replays it locally anyway, because Step 1's conclusion says the lane passed but not *what it applied* — and because a plain-Postgres replay is the only place the Supabase-compat shim gets exercised in order.

**Files:**
- Modify: `docs/devops/production-migration-ledger.md` (append `## Stage 1 — fresh replay`)

**Interfaces:**
- Consumes: `RELEASE_SHA`, the `/tmp/rel` worktree Task 2 Step 6 created.
- Produces: proof the whole chain applies in order from zero and passes the RLS gate, plus the `make rls-check` allowlist result the prod post-check in Task 6 compares against.

- [ ] **Step 1: Read the release SHA's integration-verify conclusion**

```bash
gh run list --repo paymax2022/spotlight-latest1 --commit "$RELEASE_SHA" \
  --workflow integration-verify.yml --json databaseId,status,conclusion --jq '.[0]'
```

Expected: `"conclusion":"success"`. If it is `failure`, stop the cutover: a migration that cannot replay from zero must not be applied to production in any order.

**If and only if it is red:** pull the failing step and decide between two fixes — a new additive migration (never an edit to the original file, per the repo's own rule) or an `RLS_ALLOWLIST` entry with written justification. Re-push and re-read.

- [ ] **Step 2: Replay at the release SHA on the same image CI uses**

`postgres:15` is the wrong image here: `20260101000000_enable_extensions.sql` runs `CREATE EXTENSION postgis`, so a vanilla image fails on the first extension-migration and proves nothing. CI uses `postgis/postgis:17-3.4` started from a step (not a `services:` block — Docker Hub 429s must be retryable) plus a Supabase-compat prelude for the `auth`/`storage` surface the migrations assume. Mirror all three parts:

```bash
cd /tmp/rel
export POSTGRES_PORT=55433
export DATABASE_URL="postgres://paymax:paymax@localhost:${POSTGRES_PORT}/paymax?sslmode=disable"
bash scripts/ci/start-postgres-service.sh postgis/postgis:17-3.4 prod-replay
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET max_locks_per_transaction = 512;"
docker restart prod-replay
timeout 90 bash -c "until pg_isready -h localhost -p ${POSTGRES_PORT} -U paymax >/dev/null 2>&1; do sleep 1; done"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/ci/supabase-compat-prelude.sql
make migrate-reset DATABASE_URL="$DATABASE_URL" 2>&1 | tail -8
docker rm -f prod-replay
```

Expected: `applying supabase/migrations/…` for every file, then `migrations applied`, then `rls-check ✓ — every public table has RLS enabled (allowlist: 'spatial_ref_sys')`. The lock-table raise is not optional: `migrate-reset`'s `DROP SCHEMA public CASCADE` needs a lock per dropped object and the default 64 is blown by this schema (CI comments the same). Record the applied-file count and compare it to `ls supabase/migrations/*.sql | wc -l` — they must be equal.

- [ ] **Step 3: Append the evidence, release the worktree, and commit**

Task 5 onward run the classifier from the repo root, so this replay is the last thing that needs `/tmp/rel` — tear it down here rather than leaving a detached worktree dangling through the prod writes.

```bash
cd /Users/paymax/Documents/spotlight/main
git worktree remove /tmp/rel
git worktree list
```

Append to `docs/devops/production-migration-ledger.md` under `## Stage 1 — fresh replay`, one line per fact, each with the command that produced it:

- `integration-verify.yml` at `RELEASE_SHA`: `databaseId` and `conclusion` verbatim from Step 1.
- The replay's migration count as applied by `make migrate-reset` (Step 2's own tally) and `-- 0 pending`-equivalent evidence that the chain ran end to end without an error.
- The `make rls-check` result, including anything the allowlist covered, because Task 6 Step 5 compares prod against exactly this list.
- The image and prelude used (`postgis/postgis:17-3.4` + `scripts/ci/supabase-compat-prelude.sql`), so a later reader knows a vanilla `postgres:15` replay was never run and must not be quoted as a failure.

```bash
git add docs/devops/production-migration-ledger.md
git commit -m "docs(devops): record the release-SHA migration replay for the production cutover"
git show --stat --format=%s HEAD | head -3
```

Expected: the stat lists only the ledger, and `git worktree list` shows the main tree plus no `/tmp/rel`.

### Task 5: Stage 2 — reconcile the staging project to 0 pending

The runbook's gate at `cloud-migration-reconciliation-runbook.md:115` is explicit: *"Only proceed to prod once staging reconciles to 0 pending."* Because staging **is** the shared local-dev database, say so in the ledger and take the dump-before-reconcile habit on that DB too.

**Files:**
- Modify: `docs/devops/production-migration-ledger.md` (append `## Stage 2 — staging`)

**Interfaces:**
- Consumes: `/tmp/prod_table.txt` and `/tmp/staging_table.txt` (Task 2 Step 5), `scripts/db/list-pending.sh`.
- Produces: `/tmp/pending.txt` (prod's, the input to Task 6's batches) and staging at 0 pending, i.e. every migration in this plan has executed once on a live-but-non-customer database before touching prod.

- [ ] **Step 1: Read the staging applied set from the captured table**

Task 2 Step 5 already wrote `/tmp/staging_table.txt` from the staging `mode=list` run. Do not re-derive it from a number sweep, for the reason measured there: the sweep counts local-only rows as applied.

```bash
cd /Users/paymax/Documents/spotlight/main
bash scripts/db/list-pending.sh --remote-table /tmp/staging_table.txt \
  > /tmp/pending_staging.txt; echo "classifier exit=$?"
grep -c '^pending' /tmp/pending_staging.txt
tail -1 /tmp/pending_staging.txt
```

Expected: `classifier exit=0` and a `recorded:` line equal to staging's own psql history count. No pending figure is predicted here — staging's applied set is read fresh at execution time, which is the point of deriving it from the lane rather than from a note.

- [ ] **Step 2: Read the prod pending set the same way**

```bash
cd /Users/paymax/Documents/spotlight/main
bash scripts/db/list-pending.sh --remote-table /tmp/prod_table.txt > /tmp/pending.txt
tail -1 /tmp/pending.txt
```

This overwrites Task 2 Step 6's `/tmp/pending.txt` with the same classifier run from the repo root rather than `/tmp/rel`; if the two pending counts differ, the tree moved between those steps and the release SHA needs re-pinning before any prod write.

Expected: staging's pending count is ≤ prod's (staging is ahead of prod by construction). If staging's is *larger*, staging has drifted backwards relative to prod and Stage 2 must be re-planned before anything else runs — say so in the ledger rather than pushing through.

- [ ] **Step 3: Apply staging's backlog**

`db-migrate.yml`'s `apply-staging` job only selects on `refs/heads/staging` and refuses the production project, and `ops-db-push.yml mode=push` with `environment=staging` runs unattended (the `staging` environment has no reviewers). Use the latter, always with `--include-all` semantics so the below-max files are not silently skipped:

```bash
gh workflow run ops-db-push.yml --repo paymax2022/spotlight-latest1 \
  -f environment=staging -f mode=push -f confirm=PUSH
gh run watch --repo paymax2022/spotlight-latest1 --exit-status <run-id>
```

Expected: the run applies every pending file and exits 0. A `Found local migration files to be inserted before the last migration on remote database. Rerun with --include-all` line in the log means the job did **not** apply them — that run is a no-op, not a partial success, and must be re-dispatched with the include-all path the job already uses (`apply-staging` passes `--include-all` on dispatch; confirm from `db-migrate.yml:282` if using that route instead).

- [ ] **Step 4: Prove staging reached 0 pending**

Re-read from the remote, never from the pre-push table — that is the whole point of the check:

```bash
gh workflow run ops-db-push.yml --repo paymax2022/spotlight-latest1 \
  -f environment=staging -f mode=list
gh run watch --repo paymax2022/spotlight-latest1 --exit-status <new-run-id>
gh run view <new-run-id> --repo paymax2022/spotlight-latest1 --log \
  | awk -F'\t' '$2 == "Migration list (before)"' > /tmp/staging_after.txt
bash scripts/db/list-pending.sh --remote-table /tmp/staging_after.txt \
  | grep -c '^pending' || true
```

Expected: `0`, and `recorded:` on that table's last line equals the repo's file count. Non-zero ⇒ stop; the prod ladder is invalid until staging reconciles.

### Task 6: Stage 3 — apply production's backlog in reviewable batches

> **Disposition, 2026-11-16 — the backlog this task was sized for no longer exists, and Steps 1–4 are
> superseded, not pending.** Prod reached `recorded: 756` against a tree of 756 files with **0 pending**
> through two writes this task did not schedule: `ops-db-push.yml mode=push` on 2026-11-15T19:54Z (676→755)
> and a `db-migrate.yml` dispatch with `dry_run: false` on 2026-11-16T15:20Z (755→756). Neither used the
> scoped lane this task names as the only permitted prod writer, and neither was batched. Step 5's proof
> was then run fresh and passes, on four reads — see the ledger's `## Stage 3`, §6.1 and §6.3. **Also
> obsolete as written:** this task's "parks for review / budget a second reviewer approval" steps.
> `Production`'s required reviewers were removed on 2026-11-15 (`db-migrate.yml:11-17`), the env now reads
> `protection_rules: ["branch_policy"]`, and my `mode=list` dispatch of 2026-11-16 began in the same second
> it was created. Do not read an unchecked Step 1–4 box as work left to do; do read §6.4 as the safety
> change that came with this one closing.

The only prod DB writer this plan uses is `ops-db-push-scoped.yml`: `environment: production-db-scoped` (no reviewers, deliberately — `Production`'s rule also gates `ops-db-rotate`, which rewrites the prod password), max 12 versions, re-greps the exact bytes for destructive shapes, and refuses the staging ref. It composes the session-pooler DSN because the direct host is IPv6-only.

**Files:**
- Modify: `docs/devops/production-migration-ledger.md` (append `## Stage 3 — production`, one sub-section per batch)

**Interfaces:**
- Consumes: `/tmp/pending.txt` filtered to `additive` + `above-max`, then `below-max`; `scripts/db/list-pending.sh`.
- Produces: prod history == repo file count; per-batch post-check lines.

- [ ] **Step 1: Build the batch plan, forward-dated files first** — **SUPERSEDED** (0 pending; see the Disposition)

```bash
cd /Users/paymax/Documents/spotlight/main
grep 'additive$' /tmp/pending.txt | grep 'above-max' | awk '{print $2}' > /tmp/prod_batches.txt
grep 'additive$' /tmp/pending.txt | grep 'below-max' | awk '{print $2}' > /tmp/prod_backdated.txt
# `rm -f /tmp/batch_*` is not safe here: on zsh an unmatched glob aborts the
# whole line ("no matches found") before rm runs, so a first execution with no
# prior batches dies on its own cleanup.
find /tmp -maxdepth 1 \( -name 'batch_*' -o -name 'backdated_*' \) -delete 2>/dev/null
split -l 12 /tmp/prod_batches.txt /tmp/batch_
split -l 12 /tmp/prod_backdated.txt /tmp/backdated_
for b in /tmp/batch_* /tmp/backdated_*; do echo "$(basename "$b") ($(wc -l < "$b" | tr -d ' ')): $(tr '\n' ' ' < "$b")"; done
cat /tmp/batch_* /tmp/backdated_* | wc -l
```

Verified on today's backlog: 6 `batch_` files (12,12,12,12,12,9) + 2 `backdated_` files (12,6) = **87 versions across 8 prod writes**, each list in ascending version order, and the final `wc -l` must equal the pending count from Task 5 Step 2 — if it does not, a file fell out of both greps and the batch plan is silently incomplete. Re-derive both lists from your own `/tmp/pending.txt`; if its `NON-ADDITIVE` count is above 0, those versions come out of the batches entirely and go to Task 2's stop-event path instead. The two prefixes are kept apart because the above-max set goes first and the back-dated set is reviewed separately: `--apply-one` takes the version by name, so back-dating is not an obstacle to applying — only a review requirement, because history order and execution order will differ.

- [ ] **Step 2: Dry-run the first batch through the lane's own guard** — **SUPERSEDED** (no batch to dry-run)

```bash
gh workflow run ops-db-push-scoped.yml --repo paymax2022/spotlight-latest1 \
  -f mode=plan -f versions="$(tr '\n' ',' < /tmp/batch_aa | sed 's/,$//')"
gh run watch --repo paymax2022/spotlight-latest1 --exit-status <run-id>
```

Three numbers appear here and they are not the same quantity — reading them as one is how a prod run once looked clean:

| log line | what it actually counts | expected |
|---|---|---|
| `remote history rows: N` | psql `COUNT(*)` of `supabase_migrations.schema_migrations` — the **applied** set | Task 2 Step 5's parsed `recorded:` count |
| `CLI migration list: M rows carrying a version` | `grep -cE '[0-9]{14}'` over the CLI's whole table, so **applied + local-only** rows | ≈ the release tree's `ls supabase/migrations/*.sql \| wc -l` (measured 749 on a 663-applied prod, where 86 rows were local-only) |
| `additive: <file>` ×12 | the lane's own re-check of the 12 selected files | once per version in the batch |

`M` exceeding `N` is normal and is not drift — the difference is this plan's own pending backlog. What *is* drift: **`N` above the parsed `recorded:` count**, because an applied version with no file in the tree never appears in the CLI table (0 blank-`Local` rows in the 2026-11-07 table, so the table cannot reveal one). Name any such version in the ledger and carry it into Task 3's rehearsal, which replays files and therefore cannot reproduce it. The lane exits 1 when `M < 100`, which means psql works while the CLI cannot book history — the "DDL applied with no history row" drift, and the reason `migration repair` gets proved read-only before this lane may write. Zero active `academy_interest_areas` triggers a warning only.

- [ ] **Step 3: Apply the batch** — **SUPERSEDED**; prod was written whole-remote twice instead (§6.1), never in batches

```bash
gh workflow run ops-db-push-scoped.yml --repo paymax2022/spotlight-latest1 \
  -f mode=apply -f confirm=SCOPED -f versions="$(tr '\n' ',' < /tmp/batch_aa | sed 's/,$//')"
gh run watch --repo paymax2022/spotlight-latest1 --exit-status <run-id>
```

Expected: `== applying <version> ==` per file, then the `always()` post-check step's read-only assertions pass. A run that dies mid-batch leaves a half-applied set: re-run `mode=plan` on the same versions and read which are now `RECORDED on remote` before dispatching anything else. Never re-apply a version whose DDL already ran.

- [ ] **Step 4: Repeat for every batch, ledger entry per batch** — **SUPERSEDED** (there were no batches)

Re-read the pending list between batches rather than trusting the earlier count:

```bash
gh run view <plan-run-for-next-batch> --repo paymax2022/spotlight-latest1 --log \
  | grep -E 'remote history rows|RECORDED|not recorded'
```

- [x] **Step 5: Prove prod reached 0 pending, then check RLS on prod itself** — **DONE 2026-11-16, ledger
  `## Stage 3` §6.3.** `43916692518` produced the table, `list-pending.sh` printed
  `remote max applied: 20271500000000 | recorded: 756` with `grep -c '^pending'` → **0**, and the prod
  RLS predicate returned **0 rows**.

Re-read from the remote rather than trusting the batch logs. **Use `ops-db-push.yml mode=list`, not the scoped lane**: the scoped workflow prints only its own `remote history rows` / per-version `RECORDED` lines and never the CLI table, so filtering its log for `Migration list (before)` yields an empty file — and an empty applied set is precisely what `list-pending.sh` refuses (exit 2, `refusing: remote version list is missing or empty`). If you see `0` from the `grep -c` below alongside that refusal, the read is empty, not clean.

```bash
cd /Users/paymax/Documents/spotlight/main
gh workflow run ops-db-push.yml --repo paymax2022/spotlight-latest1 \
  -f environment=production -f mode=list
# does NOT park: `Production`'s required reviewers were removed on 2026-11-15, so the run starts the
# second it is created. (Historic note: this line used to name reviewers 18039055 / 59900242.)
gh run watch --repo paymax2022/spotlight-latest1 --exit-status <new-run-id>
gh run view <new-run-id> --repo paymax2022/spotlight-latest1 --log \
  | awk -F'\t' '$2 == "Migration list (before)"' > /tmp/prod_versions_final.txt
grep -c '|' /tmp/prod_versions_final.txt          # must be non-zero before classifying
bash scripts/db/list-pending.sh --remote-table /tmp/prod_versions_final.txt \
  | grep -c '^pending' || true
```

Expected: a table with a `recorded:` count equal to the release SHA's file count, and `0` pending.
This step was written assuming the read needs a reviewer; measured 2026-11-16 it needs none, and the
dispatch is the cheapest prod write-adjacent action in the repo — so verify `mode=list` before pressing it,
because the same form with `mode=push` and `confirm=PUSH` applies to production with no gate and, unlike
`db-migrate.yml`, no additive-only guard in the workflow at all (§6.4).

Then confirm no table shipped unguarded, using the same predicate as `make rls-check` (read-only, through the scoped lane's connection shape):

```sql
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
   and c.relname not in ('spatial_ref_sys');
```

Expected: **0 rows.** Anything else is the `crypto_watchlist` / `crypto_price_alerts` failure mode repeating at scale, and the repair is a NEW additive migration enabling RLS, not an edit.

---

## Phase 3 — Configuration parity (this is what actually breaks the site)

### Task 7: Commit the production module-flag source of truth

Nothing in the repository states what flags production must run: staging's list lives in `staging-module-flags.yml:161-205` (47 distinct names, web **and** backend mixed together) and production's cPanel app gets **none**. This task creates that file, inside `frontend-web/` so the existing sync lane carries it to `spotlight-latest` with no new plumbing.

**Files:**
- Create: `frontend-web/config/production-module-flags.env`

**Interfaces:**
- Consumes: the **45** env names `frontend-web/src/lib/feature-flags.ts` reads through `envFlag()` — 44 `FEATURE_*` plus `VOTES_BRIDGE_ENABLED` (`FEATURE_FX_ENABLED` and `FEATURE_FX_ORCHESTRATION_ENABLED` both appear, on one shared `fx:` line) — and Railway staging's `frontend-web` env, which of those names are `true` there (**36**).
- Produces: one `KEY=true` or `KEY=false` line per gated name — **36 true, 9 false** — parsed by Task 8 (lane) and Task 9 (parity guard). `FEATURE_TIER_LIMITS_ENABLED` is intentionally absent: `envFlagDefaultTrue` at `feature-flags.ts:31` treats unset as enabled, and writing `=false` for it would *disable* a gate that is currently on.

- [ ] **Step 1: Regenerate the list, do not hand-copy it**

```bash
cd /Users/paymax/Documents/spotlight/main
git show origin/main:frontend-web/src/lib/feature-flags.ts \
  | grep -oE "envFlag\('[A-Z0-9_]+'\)" | sed "s/envFlag('//;s/')//" | sort -u > /tmp/web_names.txt
wc -l < /tmp/web_names.txt
~/.railway/bin/railway variables -p e7dca861-3667-4d9a-8090-6d2f4d179ec2 \
  -e staging -s frontend-web --json 2>/dev/null \
  | /usr/bin/python3 -c 'import json,sys; d=json.load(sys.stdin); print("\n".join(sorted(k for k,v in d.items() if str(v).strip().lower()=="true")))' > /tmp/stg_on.txt
comm -12 /tmp/web_names.txt /tmp/stg_on.txt > /tmp/prod_flags.txt
comm -23 /tmp/web_names.txt /tmp/prod_flags.txt > /tmp/prod_off.txt
wc -l < /tmp/prod_flags.txt; wc -l < /tmp/prod_off.txt
```

Expected (verified this session): `/tmp/web_names.txt` = **45** names — and note `VOTES_BRIDGE_ENABLED` is already among them, because the `grep -oE` shape is not `FEATURE_`-prefixed, so do **not** append it a second time. `/tmp/prod_flags.txt` = **36** (the ones to write `=true`) and `/tmp/prod_off.txt` = **9** (the ones Step 5 decides and Step 2 writes as `=false`). `FEATURE_TIER_LIMITS_ENABLED` appears in neither file: the `grep -oE "envFlag('…')"` pattern cannot see it because it is read through `envFlagDefaultTrue`.

- [ ] **Step 2: Write the file**

`frontend-web/config/production-module-flags.env`:

```bash
# Production module flags for the frontend-web BFF — the reviewed source of
# truth for what spotlightng.com's Next runtime process must carry.
#
# Why this file exists: `featureFlags.*()` in src/lib/feature-flags.ts is a
# strict `process.env[X] === 'true'` read, so an unset flag makes the ~46 gated
# route groups answer 503 "…is not available." while the Go API behind them is
# perfectly healthy. Before 2026-11-12 production's runtime env held exactly
# four keys (see docs/devops/production-migration-ledger.md), i.e. every gated
# module was refused on the public site while staging served it. Same class as
# docs/runbooks/referral-gate-parity.md, one level up.
#
# Consumers: paymax2022/spotlight-latest `.github/workflows/deploy-cpanel.yml`
# (writes these into .env.production.local on every deploy) and
# scripts/ci/check-prod-flag-parity.sh (fails CI on drift). Do not rename lines
# in one place without the other.
#
# Set from staging's ON set: a name present here as `=true` is a module
# production serves. A name present as `=false` is a module production
# deliberately does NOT serve — the strict read makes `=false` and "absent"
# behave identically (both 503), so writing it down changes no runtime
# behaviour and buys one auditable decision. Do not leave a gated name absent:
# scripts/ci/check-prod-flag-parity.sh fails CI on it.
# FEATURE_TIER_LIMITS_ENABLED is deliberately absent: feature-flags.ts reads it
# with envFlagDefaultTrue, where unset already means enabled and `=false` would
# switch a working gate off.
FEATURE_AICARE_ENABLED=true
FEATURE_ASSOCIATION_ENABLED=true
FEATURE_BANK_TRANSFERS_ENABLED=true
FEATURE_CREATORS_ENABLED=true
FEATURE_CROWDFUNDING_ENABLED=true
FEATURE_DISPUTES_ENABLED=true
FEATURE_ESTATE_ENABLED=true
FEATURE_EVENTS_ENABLED=true
FEATURE_FX_ENABLED=true
FEATURE_FX_ORCHESTRATION_ENABLED=true
FEATURE_GROUPS_ENABLED=true
FEATURE_HEALTH_ENABLED=true
FEATURE_HEALTH_LAB_ENABLED=true
FEATURE_HEALTH_PHARMACY_ENABLED=true
FEATURE_HEALTH_VET_ENABLED=true
FEATURE_INSURANCE_ENABLED=true
FEATURE_KYC_ENABLED=true
FEATURE_LOYALTY_ENABLED=true
FEATURE_OTP_EMAIL_ENABLED=true
FEATURE_RATINGS_ENABLED=true
FEATURE_REALTOR_ENABLED=true
FEATURE_REFERRALS_ENABLED=true
FEATURE_REFERRAL_REWARDS_ENABLED=true
FEATURE_RESTAURANT_ENABLED=true
FEATURE_SAVINGS_ENABLED=true
FEATURE_SOCIAL_PAY_ENABLED=true
FEATURE_STAYS_ENABLED=true
FEATURE_TELEMEDICINE_ENABLED=true
FEATURE_TRANSPORT_ENABLED=true
FEATURE_UTILITY_BILLS_GO_PROXY_ENABLED=true
FEATURE_UTILITY_PAYMENTS_ENABLED=true
FEATURE_VIRTUAL_ACCOUNTS_ENABLED=true
FEATURE_VOTE_BRIDGE_ENABLED=true
FEATURE_WALLET_ENABLED=true
FEATURE_WALLET_TRANSFERS_ENABLED=true
VOTES_BRIDGE_ENABLED=true

# ---- Declared OFF. These 9 names are read by feature-flags.ts but are ABSENT
# from staging's frontend-web env (measured 2026-11-12), so "promote staging's
# ON set" would leave them implicit and unauditable. Writing `=false` changes no
# runtime behaviour — the strict `=== 'true'` read treats absent and false
# identically — it only records the decision Task 10 argues.
FEATURE_FILM_ACADEMY_TOPICS_ENABLED=false
FEATURE_FILM_ACADEMY_ASSESSMENT_ENABLED=false
FEATURE_FILM_ACADEMY_PILOT_DELIVERY_ENABLED=false
FEATURE_CHECKOUT_TOPUP_TIER0=false
FEATURE_DOCTOR_ENABLED=false
FEATURE_ESTATE_DUAL_CONTROL_ENABLED=false
FEATURE_FINTECH_ADMIN_ENABLED=false
FEATURE_P2P_MARKET_ENABLED=false
FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED=false
```

The academy trio above is not a style choice: `GET /api/academy/exams` and `GET /api/academy/topics` answer **503 on staging as well as on production**, while `GET /api/academy/apply` answers **200** on both (it is ungated). So the academy *application* plane works everywhere and the *assessment/topics* plane is dark everywhere — declaring it `=false` states today's truth, and flipping it is a product decision, not a migration side effect.

- [ ] **Step 3: Prove the file and the code agree, in both directions**

```bash
cd /Users/paymax/Documents/spotlight/main
grep -E '^[A-Z0-9_]+=(true|false)$' frontend-web/config/production-module-flags.env \
  | cut -d= -f1 | sort > /tmp/file_names.txt
wc -l < /tmp/file_names.txt
echo "in file, never read by the code (dead wiring):"; comm -23 /tmp/file_names.txt /tmp/web_names.txt
echo "read by the code, missing from the file (undeclared):"; comm -13 /tmp/file_names.txt /tmp/web_names.txt
```

Expected: `45` lines in `/tmp/file_names.txt` and **both** `comm` outputs empty. A name in the file the code never reads is dead wiring, which `docs/full_audit.md:162` already records once for `FEATURE_CONTESTANT_SOCIAL_ENABLED`; a name the code reads that the file omits is the silent-503 class this whole task exists to end. Do not use `grep -P` here — BSD grep on this machine has no `-P`, and a `(?=…)` recipe fails with `invalid option` rather than proving anything.

- [ ] **Step 4: Commit, and state the release effect before pushing**

This file lives under `frontend-web/**`, so the eventual push to `main` **is** a production release: it triggers Safe Merge → `spotlight-latest`'s cPanel deploy. Task 8 lands the consumer first; do not push Task 7 alone.

```bash
git add frontend-web/config/production-module-flags.env
git commit -m "feat(frontend-web): commit the production module-flag source of truth"
```

### Task 8: Make the cPanel lane install those flags into the runtime env

**Files:**
- Modify: `paymax2022/spotlight-latest:.github/workflows/deploy-cpanel.yml` — add a validation step after `Build frontend on GitHub` and extend the `Finalize on server` `printf` block (the one writing `NEXT_PUBLIC_SUPABASE_URL … GO_BACKEND_URL`, current line ~412).

**Interfaces:**
- Consumes: `frontend-web/config/production-module-flags.env` in the same checkout (all 45 declared lines).
- Produces: `.env.production.local` holding the 4 existing keys **plus** the 45 declared lines (36 `=true`, 9 `=false`); a base64 single-line payload carried to the host so `script_stop: true` cannot mis-split it.

- [ ] **Step 1: Add the runner-side validator (this is the failing test — run it before the lane change)**

```yaml
      - name: Validate the production module flags before they reach the host
        working-directory: frontend-web
        run: |
          set -euo pipefail
          f=config/production-module-flags.env
          [ -s "$f" ] || { echo "::error::$f is missing — the prod runtime would carry zero FEATURE_* and every gated BFF route would 503."; exit 1; }
          bad="$(grep -vnE '^[A-Z0-9_]+=true$|^[A-Z0-9_]+=false$|^#|^$' "$f" || true)"
          [ -z "$bad" ] || { echo "::error::$f has non KEY=true/false lines:"; printf '%s\n' "$bad"; exit 1; }
          on=$(grep -cE '^[A-Z0-9_]+=true$' "$f" || true)
          off=$(grep -cE '^[A-Z0-9_]+=false$' "$f" || true)
          echo "flags: on=$on off=$off declared=$((on + off))"
          [ "$on" -ge 30 ] || { echo "::error::only $on flags declared ON — production would 503 most modules."; exit 1; }
```

Expected on a checkout without the file: exit 1 with that message. With Task 7's file present: `flags: on=36 off=9 declared=45`. The `on >= 30` floor is what turns "the flag file shipped empty/stale" from a silent production outage into a failed deploy.

- [ ] **Step 2: Carry the file to the host in one line**

In the job, after the validation step, publish it as a single-line base64 output so the `script:` template stays one statement:

```yaml
      - id: flags
        name: Encode the flag block for the host
        run: echo "b64=$(base64 -w0 frontend-web/config/production-module-flags.env)" >> "$GITHUB_OUTPUT"
```

- [ ] **Step 3: Extend Finalize to write the flags into `.env.production.local`**

Add inside the existing `script:` block, immediately after the 4-line `printf … > "${APP_DIR}/.env.production.local"` and before `chmod 600`:

```bash
            printf '%s' '${{ steps.flags.outputs.b64 }}' | base64 -d >> "${APP_DIR}/.env.production.local"
```

One line, no `case`/`else`/`set +e` — the shapes the vendor's line-splitting exit-code guard breaks (`ops-ssh-transport-proof` runs `43007006481` / `43008559216` measured all 11 shapes). Keep `chmod 600` after it, since the file still carries the service-role key.

- [ ] **Step 4: Prove the ordering assumption the old outage depended on**

The lane's own comments record that `@next/env` will not overwrite a key already in `process.env`, and that the host's cPanel Node app env vars therefore outrank this file. The probe step already prints both layers, and its last run (`43037664704`, 2026-11-11T14:23:27Z) shows `== runtime env files present in APP_DIR ==` containing **only** `.env.production.local` with the 4 keys — so nothing hand-added will be lost by Finalize's truncate-and-write, and there is no `.env.local` shadowing the flags today. Re-read that step's log after the deploy: expected now is the same inventory with **45** flag lines appended under `.env.production.local`, and **no `FEATURE_*` in the `== env of the running app process ==` block**. If a `FEATURE_*` does appear in the process env, the reviewed file is being shadowed by the cPanel Node app env (`~/.cl.selector/node-selector.json`) and the flag change is inert — fix the app env, don't re-deploy.

- [ ] **Step 5: Verify serving, not colour**

```bash
/usr/bin/curl -s -o /tmp/p.txt -w "%{http_code}\n" --max-time 25 \
  "https://www.spotlightng.com/api/v1/restaurant/00000000-0000-0000-0000-000000000000"; cat /tmp/p.txt
```

Expected after the deploy: **401** `{"success":false,"error":"Unauthorized"}` — the gate passed and auth refused. If it is still 503, the flag block did not reach the runtime env; look at Step 4 before touching anything else.

### Task 9: Add the CI guard so parity cannot silently reopen

**Files:**
- Create: `scripts/ci/check-prod-flag-parity.sh`
- Modify: `.github/workflows/ci.yml` — a new structural job next to `migration-guard` (:126) and `secret-hygiene` (:135)
- Modify: `Makefile` — a `flag-parity` target beside `rls-check` (:102)

**Interfaces:**
- Consumes: `frontend-web/config/production-module-flags.env` (Task 7) and `frontend-web/src/lib/feature-flags.ts` — both from the checkout, so the job needs no secrets, no network and no Railway token.
- Produces: exit 0/1, one line per drift, and the summary line `prod-flag-parity ✓ — 45 flags declared (36 on, 9 off)`; the `ci.yml` check name `prod-flag-parity`, added to every `needs:` list that gates a deploy.

- [ ] **Step 1: Write the failing test**

Create `scripts/ci/test-prod-flag-parity.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT/scripts/ci/check-prod-flag-parity.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/config"

# 1 — a gated name the file never declares must fail and name the offender.
printf 'FEATURE_A_ENABLED=true\nFEATURE_B_ENABLED=true\n' > "$TMP/config/production-module-flags.env"
printf 'FEATURE_A_ENABLED\nFEATURE_B_ENABLED\nFEATURE_C_ENABLED\n' > "$TMP/live.txt"
if bash "$CHECK" --file "$TMP/config/production-module-flags.env" --live "$TMP/live.txt" > "$TMP/out" 2>&1; then
  echo "FAIL: undeclared flag went undetected"; exit 1; fi
grep -q 'FEATURE_C_ENABLED' "$TMP/out" || { echo "FAIL: undeclared flag not named"; exit 1; }

# 2 — an explicitly declared OFF name is a decision, not drift.
printf 'FEATURE_A_ENABLED=false\n' > "$TMP/config/production-module-flags.env"
printf 'FEATURE_A_ENABLED\n' > "$TMP/live.txt"
bash "$CHECK" --file "$TMP/config/production-module-flags.env" --live "$TMP/live.txt" >/dev/null \
  || { echo "FAIL: declared=false must be accepted"; exit 1; }

# 3 — a name the code does not read is dead wiring.
printf 'FEATURE_A_ENABLED=true\nFEATURE_DEAD_ENABLED=true\n' > "$TMP/config/production-module-flags.env"
printf 'FEATURE_A_ENABLED\n' > "$TMP/live.txt"
if bash "$CHECK" --file "$TMP/config/production-module-flags.env" --live "$TMP/live.txt" > "$TMP/out" 2>&1; then
  echo "FAIL: dead wiring went undetected"; exit 1; fi
grep -q 'FEATURE_DEAD_ENABLED' "$TMP/out" || { echo "FAIL: dead wiring not named"; exit 1; }

# 4 — a value that is neither true nor false is not a flag, it is a typo.
printf 'FEATURE_A_ENABLED=1\n' > "$TMP/config/production-module-flags.env"
printf 'FEATURE_A_ENABLED\n' > "$TMP/live.txt"
if bash "$CHECK" --file "$TMP/config/production-module-flags.env" --live "$TMP/live.txt" > "$TMP/out" 2>&1; then
  echo "FAIL: bad value went undetected"; exit 1; fi
grep -q 'BAD value' "$TMP/out" || { echo "FAIL: bad value not named"; exit 1; }
echo "PASS"
```

- [ ] **Step 2: Run it to verify it fails, then implement**

```bash
bash scripts/ci/test-prod-flag-parity.sh
```

Expected: exit 1 with `FAIL: undeclared flag not named` — not `No such file or directory`, because the test captures the missing-check script's stderr into `$TMP/out` and its own assertion fires first. Verified on 2026-11-12 by running the two files exactly as written below in a scratch tree: red without `check-prod-flag-parity.sh`, `PASS` with it. Then create `scripts/ci/check-prod-flag-parity.sh`:

```bash
#!/usr/bin/env bash
# Fail when a feature gate the web BFF reads is not DECLARED in the committed
# production flag file, or when the file declares a name the code never reads.
# Rationale: feature-flags.ts gates are strict `process.env[X] === 'true'` reads,
# so a name production never declares is a silent 503 on the public site — the
# referral-gate-parity runbook class, caught in CI instead of by a user.
#
# Declared means `KEY=true` (serve it) or `KEY=false` (deliberately don't). Both
# behave identically to an unset var at runtime; the difference is that false is
# a recorded decision and absence is an accident waiting to be argued about.
#
# --live overrides the derived name list (one name per line) when reconciling a
# specific plane instead of the whole codebase.
set -euo pipefail
FILE="frontend-web/config/production-module-flags.env"
FLAGS="frontend-web/src/lib/feature-flags.ts"
LIVE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --file) FILE="$2"; shift 2 ;;
    --flags) FLAGS="$2"; shift 2 ;;
    --live) LIVE="$2"; shift 2 ;;
    *) echo "usage: check-prod-flag-parity.sh [--file F] [--flags TS] [--live NAMES]" >&2; exit 2 ;;
  esac
done
[ -s "$FILE" ] || { echo "FAIL: $FILE missing or empty — production would carry zero FEATURE_*"; exit 1; }
if [ -z "$LIVE" ]; then
  LIVE="$(mktemp)"; trap 'rm -f "$LIVE"' EXIT
  grep -oE "envFlag\('[A-Z0-9_]+'\)" "$FLAGS" | sed "s/envFlag('//;s/')//" | sort -u > "$LIVE"
fi
drift=0
while read -r name || [ -n "$name" ]; do
  [ -n "$name" ] || continue
  grep -qE "^${name}=(true|false)$" "$FILE" \
    || { echo "UNDECLARED in $FILE: $name (write =true to serve it, =false to refuse it)"; drift=$((drift + 1)); }
done < "$LIVE"
while read -r line || [ -n "$line" ]; do
  case "$line" in ''|\#*) continue ;; esac
  k="${line%%=*}"; v="${line#*=}"
  grep -qx "$k" "$LIVE" || { echo "DEAD wiring: $k is declared but $FLAGS never reads it"; drift=$((drift + 1)); }
  [ "$v" = "true" ] || [ "$v" = "false" ] || { echo "BAD value for $k: '$v' (must be true or false)"; drift=$((drift + 1)); }
done < "$FILE"
[ "$drift" -eq 0 ] || { echo "prod-flag-parity ✗ — $drift drift(s)"; exit 1; }
# `|| true` is load-bearing: grep -c exits 1 when it counts zero, and under
# `set -e` that kills the script mid-summary with no output at all.
on=$(grep -cE '^[A-Z0-9_]+=true$' "$FILE" || true)
off=$(grep -cE '^[A-Z0-9_]+=false$' "$FILE" || true)
echo "prod-flag-parity ✓ — $((on + off)) flags declared ($on on, $off off)"
```

- [ ] **Step 3: Run both**

```bash
bash scripts/ci/test-prod-flag-parity.sh && bash scripts/ci/check-prod-flag-parity.sh
```

Expected: `PASS` (four cases) then `prod-flag-parity ✓ — 45 flags declared (36 on, 9 off)`. Both numbers are checked, not decorative: 45 is every name `feature-flags.ts` reads through `envFlag()`, and 36 is staging's ON set intersected with it. Read the 45 as accessor-declared names; direct `process.env` reads are outside this gate — one money-path name today (`FEATURE_UTILITY_CARD_LEDGER`), recorded in the ledger §10.3 — so green here is not "the whole BFF gate surface is declared".

- [ ] **Step 4: Wire the job into `ci.yml` and `Makefile`**

Mirror `secret-hygiene` (`ci.yml:135`) exactly in shape — same `runs-on`, same checkout, no secrets, and add the job name to every `needs:` list that gates a deploy so `deploy-production` cannot pass without it:

```yaml
  prod-flag-parity:
    name: prod-flag-parity
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check production module flags cover every BFF gate
        run: bash scripts/ci/check-prod-flag-parity.sh
```

Makefile:

```make
flag-parity: # fail if a BFF feature gate is not declared in the prod flag file
	@bash scripts/ci/check-prod-flag-parity.sh
```

- [ ] **Step 5: Verify the gate bites — on a copy, never on the committed file**

```bash
cd /Users/paymax/Documents/spotlight/main
make flag-parity; echo "clean exit=$?"
/bin/mkdir -p /tmp/parity && /usr/bin/grep -v '^FEATURE_WALLET_ENABLED=' frontend-web/config/production-module-flags.env > /tmp/parity/bitten.env
bash scripts/ci/check-prod-flag-parity.sh --file /tmp/parity/bitten.env; echo "bite exit=$?"
/bin/rm -rf /tmp/parity
```

Measured on 2026-11-12 against the Task 7 file exactly as this plan writes it: the clean run prints `prod-flag-parity ✓ — 45 flags declared (36 on, 9 off)` and exits 0; the copy with `FEATURE_WALLET_ENABLED` removed prints `UNDECLARED in /tmp/parity/bitten.env: FEATURE_WALLET_ENABLED (write =true to serve it, =false to refuse it)` then `prod-flag-parity ✗ — 1 drift(s)` and exits 1. The wording is `UNDECLARED in`, not `MISSING from` — an earlier draft of this step quoted the wrong string, and matching on it would have read a real bite as a broken gate.

- [ ] **Step 6: Commit**

```bash
git add scripts/ci/check-prod-flag-parity.sh scripts/ci/test-prod-flag-parity.sh .github/workflows/ci.yml Makefile
git commit -m "ci(prod): gate production module-flag parity in CI

staging served every module while production's runtime env carried no FEATURE_*
at all, and nothing in the repo could tell us — the drift is only visible by
probing the live site. This makes the committed flag file the checked source."
```

### Task 10: Record the money-path flags prod stays OFF on — on *both* planes

Copying staging flag-for-flag is the wrong rule for money paths, and one name in that set needs a decision recorded before Task 8 ships. This task also settles what `=false` means, because the two planes read the same name in two different ways:

- **Web (`.env.production.local`, Tasks 7–9):** `featureFlags.restaurantPaystackCheckout()` is a strict `=== 'true'` test, so `=false` and absent behave identically at runtime — the BFF returns 503. Writing it `=false` is a *declaration of intent* (and what `make flag-parity` counts), not a functional difference.
- **Backend (Railway env, Task 13):** the Go flag decides whether the route group is **mounted at all** (`finance_routes.go:1915`: `if paystackClient != nil && cfg.FeatureRestaurantPaystackCheckoutEnabled` → `RegisterRestaurantPaystackCheckout`, plus the webhook order-confirmer and food-chargeback handlers). Unset ⇒ `getEnvBool(..., false)` (config.go:1138) ⇒ "no route exists to reach PlaceOrderPaystackFunded at all", per the code's own comment.

**A web 503 does not mean the rail is dark.** `backend-production-1b33d.up.railway.app` is publicly reachable and takes its own routes directly — that is how this plan probes it in Task 11 and Task 13 Step 5. So arming the backend mount while the web flag reads `=false` would leave a real card/bank-transfer checkout reachable by any authenticated member who calls the API host itself, with the escrow path explicitly documented as wallet-free and **not** KYC-tier-gated (config.go:354-362). Both planes therefore stay OFF, which is what Task 13's write list reflects.

**Files:**
- Modify: `docs/devops/production-migration-ledger.md` (append `## Deliberate exclusions — money paths`)

**Interfaces:**
- Consumes: the nine `=false` names Task 7 writes, `finance_routes.go:1915`, `config.go:1138`.
- Produces: the ruling Task 13 Step 1 must obey (restaurant paystack checkout absent from the backend write list) and the ledger's `## Deliberate exclusions — money paths` section.

- [ ] **Step 1: Probe the current state on all three hosts**

```bash
for H in www.spotlightng.com frontend-web-production-9259.up.railway.app backend-production-1b33d.up.railway.app; do
  printf "%-52s " "$H"
  /usr/bin/curl -s -o /tmp/x.txt -w "%{http_code} " --max-time 25 "https://$H/api/v1/restaurant/1/like"
  /usr/bin/head -c 70 /tmp/x.txt; echo
done
```

Expected: the web hosts answer 503 (BFF gate closed) and the backend answers 401-or-404 for the same path — the two planes disagree by design, which is the point of recording both. Do not read the backend's 404 as proof the checkout rail is unmounted: the mount test is the *paystack checkout* route, not `/like`, and the only proof of a mount is a 401 from the route the flag registers.

- [ ] **Step 2: Apply these rulings and write them down**

- `FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED` — **OFF on both planes.** On the web it is one of Task 7's nine `=false` lines; on the backend Task 13 deliberately omits it from its write list. Flipping it arms a live Paystack capture, so it needs its own go/no-go with three things proven first: which key set prod's backend actually holds (test vs live `PAYSTACK_SECRET_KEY` — never print the value, name and length only), a sandbox order that settles through `settlement.EscrowExternal`, and the webhook confirmer handling a real `charge.success`. Per `docs/runbooks/restaurant-paystack-checkout.md`.
- `FEATURE_CRYPTO_ENABLED` / `FEATURE_CRYPTO_SWAPS_ENABLED` — **left OFF in prod** (prod has `FEATURE_CRYPTO_ENABLED=false`, staging `true`). These are backend-only names — they are not in the web's 45 `envFlag()` set, so they never appear in `.env.production.local` and are out of scope for Tasks 7–9. Crypto is a second money path and the audit record carries open Quidax gaps; do not promote it as a side effect of this migration. `QUIDAX_WEBHOOK_SECRET` is copied in Task 13 for the *inbound* signature check, which does not arm swaps.
- `FEATURE_CHECKOUT_TOPUP_TIER0` — **OFF, and not this plan's decision to revisit.** It is one of the nine `=false` lines, and the backend comment names it the *rejected* top-up-then-spend design that the restaurant rail was audited as an alternative to. Recording it here stops a later reader from mistaking its presence in the flag file for an unfinished migration.

Expected in the ledger: one paragraph per name with the reason, which plane reads it, and the probe that would flip it.

---

## Phase 4 — Ship the code, then the planes behind it

### Task 11: Bring the production Go API to the release SHA

> **Mechanism superseded 2026-11-16 — read this before executing.** Steps 1-2 of
> this task are written against the promotion-branch model: pushing
> `RELEASE_SHA` to `refs/heads/prod` and dispatching `ci.yml` with
> `deploy_environment=production, confirm_deploy=DEPLOY`. Neither works any more.
> `ci.yml`'s three deploy jobs were deleted, `prod`/`staging`/`develop` are frozen
> with their tips archived as `archive/prod-2026-11-15` and
> `archive/staging-2026-11-15`, and the dispatch now fails on unknown inputs.
>
> What replaces it: `release.yml` deploys on every push to `main` — see
> [docs/devops/deployment-matrix.md](../../devops/deployment-matrix.md)'s
> `release.yml` row, its Promotion-model section, and the Probe contract. The goal
> below is unchanged (`/api/v1/public/build` reporting `RELEASE_SHA` on both
> backends), and the procedure that reaches it is now "get `RELEASE_SHA` onto
> `main`" — which it already is: `git merge-base --is-ancestor c49b395643473ba6ff7a225d7a7a339a41eddfe6 origin/main`
> exits 0, measured 2026-11-16. **Do not read that as Task 11 being closed.**
> Production currently serves `585bd2ca7`, and `git rev-list --count 585bd2ca7
> ^origin/main` is **7** — those seven commits exist only on the prod-serving side,
> so the first `main` deploy replaces them with `main`'s version of the same area;
> the matrix's `backend` row owns that comparison and its re-read requirement
> (`/api/v1/public/build` at execution time, never a figure quoted from a doc).


Production's API is 710 commits / 239 backend commits behind `main` and has not been redeployed since 2026-10-17; staging is 224 behind. Both must land on the same SHA or the two planes diverge again.

**Files:**
- Modify: `docs/devops/production-migration-ledger.md` (append `## Backend release`)

**Interfaces:**
- Consumes: `RELEASE_SHA`, a green Phase 2/3 (prod schema reconciled, flags committed), `refs/heads/prod` pointing at `RELEASE_SHA`.
- Produces: `GET /api/v1/public/build` reporting `RELEASE_SHA` on both prod and staging backends.

- [ ] **Step 1: Move the `prod` branch pointer by plumbing, not by touching the dirty worktree** *(retired — `prod` is frozen; see the banner)*

`ci.yml:687` requires `github.ref == 'refs/heads/prod'`, plus `inputs.deploy_environment == 'production'`, `confirm_deploy == 'DEPLOY'`, `vars.RAILWAY_DEPLOY_ENABLED == 'true'` (it is) and every one of the 22 `needs` jobs non-failing.

```bash
cd /Users/paymax/Documents/spotlight/main
RELEASE_SHA="$(cat /tmp/RELEASE_SHA)"; [ "${#RELEASE_SHA}" = 40 ] || { echo "FATAL: RELEASE_SHA missing"; exit 1; }
git cat-file -e "${RELEASE_SHA}^{commit}" || { echo "FATAL: ${RELEASE_SHA} is not a commit in this repo"; exit 1; }
git -c credential.helper='!gh auth git-credential' push origin "${RELEASE_SHA}:refs/heads/prod"
```

Expected: the push updates `prod` and nothing else — `git rev-parse origin/prod` afterwards prints `RELEASE_SHA`. **There is no second push here:** do not push to `refs/heads/staging`. The repo's policy forbids staging-branch releases, staging's Railway git source tracks `main` rather than that branch, and an earlier draft of this step carried a `push … :refs/heads/staging || echo "SKIP"` line that a shell would have *executed* — `|| echo` skips the echo, not the push.

- [ ] **Step 2: Dispatch the production deploy and watch it** *(retired — see the banner; `ci.yml` has no deploy job to dispatch and `Production` has no reviewers)*

```bash
gh workflow run ci.yml --repo paymax2022/spotlight-latest1 --ref prod \
  -f deploy_environment=production -f confirm_deploy=DEPLOY
gh run list --repo paymax2022/spotlight-latest1 --workflow ci.yml --limit 3 --json databaseId,status,conclusion
```

Expected: the run first reports `waiting` at `deploy-production` (its `environment: production` has required reviewers). A named reviewer approves it; then the matrix uploads `backend`, `frontend-web`, `frontend-admin` with `railway up`.

- [ ] **Step 3: Prove the binary changed — the only probe that can**

`/public/health` returns identical bytes on every build, which is why `BUILD_COMMIT` is baked via ldflags and reported by `/public/build`:

```bash
for H in backend-production-1b33d.up.railway.app backend-staging-new.up.railway.app; do
  printf "%-42s " "$H"
  /usr/bin/curl -s --max-time 25 "https://$H/api/v1/public/build" | /usr/bin/head -c 150; echo
done
```

Expected: prod reports `RELEASE_SHA`. Staging will still report `886d857f1…` — if staging must move too, it is a separate `deploy_environment=staging` dispatch from `--ref staging`… which Step 1 forbids. Use the Railway-native git deploy on `main` for staging instead, or leave staging where it is and record that prod is now ahead of staging — that inversion is worth one ledger line because it changes which plane is the test bed.

- [ ] **Step 4: Confirm the API is healthy on the new binary**

```bash
/usr/bin/curl -s --max-time 25 "https://backend-production-1b33d.up.railway.app/api/v1/public/health"; echo
/usr/bin/curl -s -o /dev/null -w "%{http_code}\n" --max-time 25 -X POST \
  "https://www.spotlightng.com/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"nobody@spotlightng.com","password":"wrong-password-on-purpose"}'
```

Expected: health `200 {"status":"ok"…}`; the login probe **401** `invalid credentials`. A 504 there means `GO_BACKEND_URL` regressed (the 2026-11-08 outage signature) — use bad credentials only, never a real account.

### Task 12: Release the frontend-web and admin planes' config

**Files:**
- Modify: `docs/devops/production-migration-ledger.md` (append `## Frontend release`)
- Reference: `paymax2022/spotlight-latest:.github/workflows/deploy-cpanel.yml`, `docs/devops/deployment-matrix.md:14,17`

- [ ] **Step 1: Land the lane change and the flag file**

Task 8's lane edit lives in `spotlight-latest` (no PR can be opened from `spotlight-latest1` for it — the lane is that repo's file). Push it on a branch there, open a PR **in `spotlight-latest`**, and merge only after Step 2's file has landed in `spotlight-latest1` so the validator never sees a missing file. Order: Task 7 file → `spotlight-latest1` main push → sync copies it across → Task 8 lane merge.

- [ ] **Step 2: Push the frontend-web changes and follow the chain, reading conclusions rather than assuming them**

```bash
cd /Users/paymax/Documents/spotlight/main
git -c credential.helper='!gh auth git-credential' push origin HEAD:refs/heads/main
gh run list --repo paymax2022/spotlight-latest1 --workflow sync-frontend-web.yml --limit 3 \
  --json databaseId,headSha,status,conclusion
gh run list --repo paymax2022/spotlight-latest --workflow "Deploy to Namecheap cPanel (SSH)" --limit 3 \
  --json databaseId,headSha,status,conclusion,createdAt
```

Expected: a sync run at your sha (`success`) **and** a cPanel run in the destination repo at the merged sha (`success`). Tell the user plainly that this push is a production release. A `cancelled` cPanel run usually means a concurrent session's sync superseded it.

- [ ] **Step 3: Verify serving by chunk href, not colour**

```bash
/usr/bin/curl -s --max-time 25 "https://www.spotlightng.com/login" \
  | grep -oE '/_next/static/chunks/[^"]*\.js' | sort > /tmp/live_chunks.txt
wc -l < /tmp/live_chunks.txt
```

Expected: the live set equals the build's own `.next/server/app/login.html` href set for that commit (the lane purges `.next/server/route-cache`, so a mismatch now means the purge or restart failed, not the upload). Then re-run Task 8 Step 5's 503→401 probe.

### Task 13: Close the backend and admin env-var gaps that flags alone cannot close

Twelve backend flags and seven non-flag keys are missing on `production`, and five of those keys are secrets that must never appear in a dispatch input.

**Files:**
- Modify: `docs/devops/production-migration-ledger.md` (append `## Backend env parity`)
- Modify: `.github/workflows/ops-railway-copy-vars.yml` (add `source_environment`)

**Interfaces:**
- Consumes: staging's `backend` var set, `RAILWAY_TOKEN_STAGING` + `RAILWAY_TOKEN_PRODUCTION` (both exist as repo secrets), the `if:` guard `inputs.source_service != inputs.target_service` (line 63).
- Produces: `ops-railway-copy-vars.yml` with a `source_environment` choice defaulting to the target environment, so same-service cross-environment copies are permitted.

- [ ] **Step 1: Set nine of the twelve missing backend flags with the existing guarded writer**

The arithmetic to keep straight: twelve `FEATURE_*` names are on staging's backend and absent from prod's; three of those are excluded by Task 10's money-path rulings (`FEATURE_CRYPTO_ENABLED`, `FEATURE_CRYPTO_SWAPS_ENABLED`, `FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED`), leaving the nine below. `ops-railway-vars.yml` refuses unless `confirm=SET`, never echoes values, and restarts the service by default. Booleans are safe as inputs.

```bash
gh workflow run ops-railway-vars.yml --repo paymax2022/spotlight-latest1 \
  -f environment=production -f service=backend -f confirm=SET -f restart=true \
  -f vars="FEATURE_ADMIN_USER_MODULES_ENABLED=true
FEATURE_BANK_TRANSFERS_ENABLED=true
FEATURE_COMMISSION_ENABLED=true
FEATURE_INSURANCE_ENABLED=true
FEATURE_INSURANCE_PROVIDER_IMPORT_ENABLED=true
FEATURE_ONBOARDING_ENABLED=true
FEATURE_PLACEMENT_ENABLED=true
FEATURE_PROPERTY_ROLES_ENABLED=true
FEATURE_REFERRAL_COMMISSION_SPLIT_ENABLED=true"
```

Each of these nine was checked against `backend/internal/config/config.go` — every name appears there exactly once, so none of these writes is a typo that Go silently ignores (an unknown `FEATURE_*` in a Railway env has no reader and no effect, and the lane would still report success). `FEATURE_CRYPTO_ENABLED`, `FEATURE_CRYPTO_SWAPS_ENABLED` and `FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED` are omitted **on purpose**, per Task 10: the last one is a Go config name like these nine, and adding it here would mount the live card/bank checkout route group and its webhook confirmer on a directly-reachable API host — arming the money path through the back door while the web flag reads `=false`. The ledger records that omission as a decision, not an oversight.

Expected: 9 writes + restart, then a verify step reading them back.

- [ ] **Step 2: Write the failing test for the copy-lane extension**

`ops-railway-copy-vars.yml:63` currently makes same-service cross-environment copying impossible. Prove it:

```bash
gh workflow view .github/workflows/ops-railway-copy-vars.yml 2>/dev/null || \
  sed -n '18,70p' .github/workflows/ops-railway-copy-vars.yml
```

Expected: `confirm == 'COPY' && source_service != target_service` and a single `environment:` input — so `staging/backend → production/backend` is unreachable today.

- [ ] **Step 3: Add `source_environment` and relax the guard to compare the pair**

```yaml
      source_environment:
        description: 'Railway environment to READ from (defaults to the target)'
        type: choice
        required: false
        options: [production, staging, development]
        default: ''
```

```yaml
    if: ${{ inputs.confirm == 'COPY' && (inputs.source_environment == '' || inputs.source_environment != inputs.environment) && !cancelled() }}
```

and inside the step, resolve the token by `source_environment || environment` for reads and `environment` for writes, keeping the existing `production) tok="$TOK_PRODUCTION" ;;` case shape (this is a workflow shell, not ssh-action, so `case` is safe there). Refuse the copy outright when the *target* is not `production`-parity-checked: keep the lane's existing APP_ENV assertion and add `if [ "$TARGET_APP_ENV" != "production" ]; then echo "::error::target env is not production"; exit 1; fi`.

- [ ] **Step 4: Copy the five provider keys without ever printing them**

```bash
gh workflow run ops-railway-copy-vars.yml --repo paymax2022/spotlight-latest1 \
  -f environment=production -f source_environment=staging \
  -f source_service=backend -f target_service=backend -f confirm=COPY -f restart=true \
  -f keys="DOJAH_BASE_URL
DOJAH_PUBLIC_KEY
R2_ENDPOINT
R2_BUCKET_NAME
QUIDAX_WEBHOOK_SECRET
ADMIN_SIGNUP_CODE
AUTH_IDENTITY_CACHE_TTL_SECONDS"
```

Expected: the run reports names and lengths only (the doctrine `staging-inspect.yml` established — `--json`, never `--kv`), and the target service redeploys.

- [ ] **Step 5: Prove the reads work in production**

```bash
/usr/bin/curl -s -o /tmp/k.txt -w "%{http_code}\n" --max-time 30 \
  "https://backend-production-1b33d.up.railway.app/api/v1/property/roles"
/usr/bin/head -c 80 /tmp/k.txt; echo
```

Expected: **401** `missing bearer token` — proof the `propertyroles` group is registered (this is the exact failure mode this session fixed locally in `docker-compose.yml`: unset flag ⇒ `rolesTablesReady()` never runs ⇒ the whole group is absent and mobile `POST /api/finance/property/roles/estate_manager` 404s). A 404 here means the flag did not take.

- [ ] **Step 6: Admin plane keys and its base URL — decision, then write**

`frontend-admin`'s production env lacks `PAYSTACK_PUBLIC_KEY`/`PAYSTACK_SECRET_KEY` that staging holds, and its `WEB_API_BASE_URL` points at `frontend-web-production-9259.up.railway.app` while members browse `https://www.spotlightng.com`. Record the choice in the ledger (public site vs the Railway prod BFF the mobile build already uses), then set it:

```bash
gh workflow run ops-railway-vars.yml --repo paymax2022/spotlight-latest1 \
  -f environment=production -f service=frontend-admin -f confirm=SET -f restart=true \
  -f vars="WEB_API_BASE_URL=<the URL chosen in the ledger>
NEXT_PUBLIC_WEB_APP_BASE_URL=<the same host a member is actually on>"
```

Expected: the write and verify steps pass. The two secret keys go through Task 13 Step 4's copy lane with `source_service=frontend-admin target_service=frontend-admin`, never as inputs.

---

## Phase 5 — Acceptance and the mobile plane

### Task 14: Run the production acceptance matrix

Every row states its expected value before it is run. Anything else is a defect, and the row below it names what to look at.

**Files:**
- Create: `scripts/flagprobe.sh` (the wrapper-aware flag→route probe Step 1 writes and runs)
- Modify: `docs/devops/production-migration-ledger.md` (append `## Acceptance`, one line per probe with its measured value)

- [ ] **Step 1: Gates — every declared flag must pass the same test, on a route the code actually gates**

The first draft of this step guessed URLs from flag names (`FEATURE_X_ENABLED` → `/api/v1/x/healthz`) and reported every flag green, because no route in the BFF is named that way — a guessed 404 proves nothing about a gate, exactly as a 405 does. So this step ships a probe that derives flag → route from the source instead, in the same two shapes the code uses. Create it:

- Create: `scripts/flagprobe.sh`

```bash
#!/usr/bin/env bash
# flagprobe.sh — for every flag declared in a prod flag file, find a REAL gated
# route in the BFF source and report its live status code. Derives flag -> route
# from the code, never from a guessed URL slug. Run from a clean release checkout.
set -uo pipefail
HOST="${1:-www.spotlightng.com}"
FILE="${2:-frontend-web/config/production-module-flags.env}"
FF="frontend-web/src/lib/feature-flags.ts"
APIROOT="frontend-web/app/api"
DUMMY="00000000-0000-0000-0000-000000000000"
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue ;; esac
  env_name="${line%%=*}"; env_val="${line#*=}"
  key="$(grep -E "\(\) =>" "$FF" | grep -F "envFlag('${env_name}')" | head -1 | sed -E 's/^ *([a-zA-Z0-9]+):.*/\1/')"
  [ -n "$key" ] || { printf '%-46s %-6s %s\n' "$env_name" "$env_val" "NO-KEY-IN-CODE"; continue; }
  # Two shapes reach a flag: the route file names it, or the route file calls a
  # wrapper that does. Missing the second shape once reported a live flag as
  # "no route" (utilityBillsGoProxy gates three real routes through
  # utilityGoProxyEnabled in app/api/v1/utility/_utils.ts).
  files="$(grep -rlE "featureFlags\.${key}([^a-zA-Z0-9_]|$)|requireFeature\('${key}'" "$APIROOT" 2>/dev/null | grep '/route.ts$')"
  for w in $(grep -rlE "featureFlags\.${key}([^a-zA-Z0-9_]|$)" "$APIROOT" 2>/dev/null | grep -v '/route.ts$'); do
    for fn in $(grep -oE "export (async )?function [a-zA-Z0-9_]+" "$w" | awk '{print $NF}'); do
      g="$(grep -rlE "\b${fn}\(" "$APIROOT" 2>/dev/null | grep '/route.ts$' | grep -v "$w")"
      [ -n "$g" ] && files="${files}
${g}"
    done
  done
  files="$(printf '%s\n' "$files" | grep -v '^$' | sort -u | head -3)"
  [ -n "$files" ] || { printf '%-46s %-6s %s (key=%s)\n' "$env_name" "$env_val" "NO-ROUTE-IN-app/api" "$key"; continue; }
  for f in $files; do
    url="${f#"$APIROOT"}"; url="${url%/route.ts}"
    url="$(printf '%s' "$url" | sed -E "s/\[+(\.\.\.)?[a-zA-Z0-9_]+\]+/${DUMMY}/g")"
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://${HOST}/api${url}")"
    printf '%-46s %-6s %-58s %s\n' "$env_name" "$env_val" "/api${url}" "$code"
  done
done < "$FILE"
```

```bash
cd /Users/paymax/Documents/spotlight/main
/bin/chmod +x scripts/flagprobe.sh
/bin/bash scripts/flagprobe.sh www.spotlightng.com frontend-web/config/production-module-flags.env > /tmp/prod_gates.txt
/usr/bin/awk '{print $NF}' /tmp/prod_gates.txt | /usr/bin/sort | /usr/bin/uniq -c | /usr/bin/sort -rn
```

Measured at baseline (2026-11-12, 85 route lines over the 45 declared names): **48×503, 25×405, 1×401, 10 NO-ROUTE** (the four buckets total 84; the capture does not record the 85th line's class). Of the 36 flags declared `true`, **28 answer 503 on at least one real gated route** (prod's web runtime carries zero `FEATURE_*` — this is the defect Tasks 11–13 remove), **5 have no BFF route at all** (the other two this line once put in that class are provable by an HTTP flip), and only `FEATURE_REALTOR_ENABLED` is clean. Read the three result classes as rules, not noise:

- `=true` → **not-503** is the pass condition. 405/404 on a *different* route of the same flag is fine; one 503 anywhere is a fail.
- `=false` → 503 is the **expected** answer (the rail is deliberately dark; Task 10).
- `NO-ROUTE-IN-app/api` → the flag is inert in the web plane, so no HTTP probe can prove it. The 5 `=true` names in that class (`FEATURE_ESTATE_ENABLED`, `FEATURE_HEALTH_LAB_ENABLED`, `FEATURE_HEALTH_PHARMACY_ENABLED`, `FEATURE_HEALTH_VET_ENABLED`, `FEATURE_OTP_EMAIL_ENABLED`) are why: their only reader is `isModuleVisible` in `frontend-web/src/server/modules/visibility.ts:59-66`, which has zero callers. The two names an earlier draft filed here are not inert: `FEATURE_VOTE_BRIDGE_ENABLED` gates `app/api/v2/votes/wallet/route.ts:78` (403 while off, so a flip is observable) and `VOTES_BRIDGE_ENABLED` is read at runtime by `isBridgeEnabled()` (`frontend-web/src/server/voting-bridge/feature-flag.ts:14`), not only in a unit test; the probe missed both because it follows `featureFlags.X(` and `requireFeature('X')` but neither direct `process.env` reads nor helpers a route calls (here `isBridgeEnabled()`). Do not report the 5 as passing — record them as "not HTTP-provable; nav visibility comes from the Go backend's own flag". The three `=false` names in that class are equally inert and equally dark, so nothing to fix.

Then run the three named probes that were red at baseline and require the exact flip:

```bash
for P in "/api/v1/restaurant/00000000-0000-0000-0000-000000000000" "/api/v1/referral/my-rewards" "/api/v1/association/mine"; do
  printf "%-58s " "$P"; /usr/bin/curl -s -o /tmp/a.txt -w "%{http_code} " --max-time 25 "https://www.spotlightng.com$P"; /usr/bin/head -c 60 /tmp/a.txt; echo
done
```

Expected: **401 Unauthorized** on all three (baseline: 503 on all three).

- [ ] **Step 2: Money paths stay dark**

```bash
# Prod's Go API host directly, on the paths crypto.Register actually mounts
# (backend/internal/crypto/handler.go:274-324 — assets, portfolio, eligibility),
# plus a control that proves the host and its not-found handler are both alive.
for P in /api/v1/crypto/assets /api/v1/crypto/portfolio /api/v1/crypto/eligibility /api/v1/public/build; do
  printf '%-32s ' "$P"
  /usr/bin/curl -s -o /tmp/b.txt -w "%{http_code} " --max-time 25 "https://backend-production-1b33d.up.railway.app$P"
  /usr/bin/head -c 70 /tmp/b.txt; echo
done
```

Expected: the three crypto leaves **404 `No API route matches`** and the control **200**. Crypto is dark exactly when its group is unmounted, and the group is mounted only inside `if cfg.FeatureCryptoEnabled` (`backend/internal/app/finance_routes.go:3638-3656`, skip log at `:3708`), so 404-vs-401 on a *registered* leaf is the whole test. Re-measured 2026-11-16 unauthenticated: all three leaves → **404**, control → **200** with `commit` = `5ab7c9cc0…` → **crypto is not reachable on prod, as Task 10 ruled.** Ledger §10.3 already prescribed this probe and recorded the same 404/401 pair on 2026-11-13.

**Do not probe the web host for this flag.** `https://www.spotlightng.com/api/v1/crypto/<anything>` answers **401** to an anonymous request whether or not the Go group exists: the catch-all proxy authenticates before it forwards — `app/api/v1/crypto/[...path]/route.ts:13` calls `requireRequestUser`, which throws `UNAUTHORIZED` at `src/lib/auth/request.ts:14` for a missing bearer token, and `handleApiError` maps that to `errorResponse('Unauthorized', 401)` at `src/lib/api/responses.ts:50`. The flag cannot "leak into production" through the web plane either: zero case-insensitive `crypto` hits in `src/lib/feature-flags.ts`, so `FEATURE_CRYPTO_ENABLED` is not in the 45-name surface and can never appear in `.env.production.local` (§9.7).

An earlier draft of this step probed `www.spotlightng.com/api/v1/crypto/balances` and declared a 401 to mean "`FEATURE_CRYPTO_ENABLED` leaked into production and the ledger needs an entry explaining who set it." Two defects, the same class §10.3 already names for the `/api/finance/crypto` guess: `balances` is not in `crypto.Register`'s list, so the path 404s on prod Go regardless of the flag, and on www the guard answers before the proxy runs, so the 401 is a fact about `requireRequestUser` and carries no information about the gate. As written the assertion could not have failed for the right reason — it would have demanded a leak entry for a leak that had not happened. The 401 seen on 2026-11-16 during the post-lane probe round is that guard, not a gate.

- [ ] **Step 3: Data plane — the two counts mean different things, so read them separately**

```bash
cd /Users/paymax/Documents/spotlight/main
gh workflow run ops-db-push-scoped.yml --repo paymax2022/spotlight-latest1 -f mode=plan -f versions="20271409000000"
gh run view <run-id> --repo paymax2022/spotlight-latest1 --log | grep -E 'remote history rows|CLI migration list'
```

Expected, per the Task 6 Step 2 table: `remote history rows: N` where **N is applied versions**, so N must equal the `recorded:` value the classifier wrote for prod and nothing more; and `CLI migration list: M rows carrying a version`, which is **applied + local-only** and therefore tracks the repo's migration-file count at the release SHA, not N. Assert `M ≥ N` and `M − N ≤ 100` (local-only files are the not-yet-pushed ones), and `N >` the ledger's pre-cutover `recorded:` value. Never compare `remote history rows` with a file count from a *different* checkout: prod's 663 applied rows sat under a 749-row `migration list` on 2026-11-12, and treating 749 as "applied" is the false green that would have cancelled this migration in Task 2.

```bash
cd /Users/paymax/Documents/spotlight/main
/bin/bash scripts/db/list-pending.sh --remote-table /tmp/prod_versions_final.txt | /usr/bin/tail -20
```

Expected: **0 pending**. `/tmp/prod_versions_final.txt` is the post-cutover production read that Task 6 Step 5 captures from `ops-db-push.yml mode=list` (the scoped lane prints no CLI table, so filtering its log yields an empty file and `list-pending.sh` refuses it with exit 2 — if `grep -c '|'` on that file prints `0`, the read is empty, not clean). Do not substitute a re-derived number sweep, for the reason measured in Task 2 Step 5.

- [ ] **Step 4: Runtime identity and serving**

Expected together: `/api/v1/public/build` on prod backend == `RELEASE_SHA`; `/login` chunk hrefs == the build's; `POST /api/auth/login` with bad credentials == **401** (never 504, which is `GO_BACKEND_URL`); the academy service page renders with **0** "could not be read right now" banners and `area-tab-0` present; `GET /api/academy/apply` and `GET /api/v1/contests` both **200**.

- [ ] **Step 5: Commit the probe and the ledger together**

```bash
cd /Users/paymax/Documents/spotlight/main
git add scripts/flagprobe.sh docs/devops/production-migration-ledger.md
git commit -m "feat(scripts): probe module flags through their real gated routes, and record the acceptance matrix"
git show --stat --format=%s HEAD | /usr/bin/head -5
```

Expected: the stat lists **only** those two paths — and note that from 2026-11-16 the answer to "does this release anything?" comes from a different place than the two filters this step used to cite. `release.yml` landed as `ef97ec64b` ("every push to main releases itself", `on: push: branches: [main]`, no `paths` filter, no approval), so a push to `main` now runs gates → migrate-staging → deploy-staging → smoke-staging → migrate-production → deploy-production → smoke-production. It stays inert for a **docs-only** commit because `ci.yml:69-71` and `integration-verify.yml:15-17` carry `paths-ignore: ['**.md','docs/**']`, which makes the gate classify the SHA `noop_docs_only` (`scripts/ci/release-gates.py:108-114`) and every deploy/migrate job tests `verdict == 'proceed'`. Measured on this exact commit's own SHA in the ledger's "Task 14 (partial)" section (2026-11-16). The consequence for the rest of this plan is the other half: **any push that is not docs-only is aimed at production, migrations included.** Measured 2026-11-16, though, none of the three non-docs pushes that day got there: `migrate staging database` succeeded each time, all three `deploy Staging (…)` jobs failed on Railway's upload-decode error, and `smoke Staging` → `migrate production database` → `deploy Production` cascade-skipped behind them. So production is currently shielded by a defect rather than by a gate, and that shield ends the moment the staging leg goes green — which is why Task 3's dump has to precede any staging-leg fix. Task 16 Step 2's command list is where to check it; measure before pushing, not after, and read the ledger's release-lane section for today's run ids.

### Task 15: Reconcile the mobile production plane with the web plane

The `eas.json` `production` profile is already correct, and `node scripts/export-eas-profile-env.mjs production` projects it as six `KEY=value` lines (`EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_SENTRY_ENVIRONMENT`, `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME`). The hazard is that `build-aab.sh:109-120` auto-selects `ENV_FILE=".env.production"` whenever that file exists, and the **untracked local** `.env.production` (`git check-ignore` → `.gitignore:12` `.env.*`) is fully staging-wired: all six profile keys plus `EXPO_PUBLIC_SITE_URL` and `EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL` still name `frontend-web-staging-new…` / `wnic…` / `staging`. So a "production" build reads a staging-wired file, and the tracked example that shows what the file should say — `.env.production.example`, which has zero staging refs and `EXPO_PUBLIC_SITE_URL=https://www.spotlightng.com` — cannot save it because the build never reads the example.

Two consequences that decide the shape of this task. First, **the file cannot simply be moved aside**: `build-aab.sh:122-128` exits 1 when `ENV_FILE` is absent ("a release build has no API URLs to bake in"), so deleting or renaming `.env.production` breaks the release lane rather than fixing it. Second, **the release script cannot catch this class of error**: `EXPECTED_HOST` is derived from the same env file it later greps the bundle for (`:133` → `:278`), so a staging-wired `.env.production` produces a build that prints `✅ API host present: frontend-web-staging-new.up.railway.app`, and `EXPECTED_SUPABASE` is only ever echoed (`:134` → `:197`), never checked. Step 4 adds the one assertion that is not self-referential.

Measured here, today, on the artifact already on disk — `release-artifacts/app-release-production.aab` (41 MB, built 2026-11-10 per the ledger), JS bundle at `base/assets/index.android.bundle` (18 MB):

```
staging refs:  1 frontend-web-staging-new.up.railway.app   1 wnicsubiznmishkmunsv
prod refs:     1 www.spotlightng.com
prod hosts:    0 frontend-web-production-9259…   0 nmseefdlliejmdbxytej…
```

So the file named `app-release-production.aab` is staging-wired end to end, and `www.spotlightng.com` appears only from a source constant — not as the API base. This is not a hypothetical about a future build; it is what the last "production" artifact contains.

Why Step 2 touches eight keys and not six: `EXPO_PUBLIC_SITE_URL` is the one that actually ships a user-visible bug beyond the API base — Metro inlines every `EXPO_PUBLIC_*` at build time, and `src/features/voting/api/voting.api.ts` and `src/features/filmAcademy/api.ts` read that name, so a prod build calls the staging web host for voting and academy. `EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL` is not read anywhere in `src/` or `app/`, but the tracked `.env.production.example:26` states the prod value, so leaving a staging URL there only re-creates the drift. The three non-`EXPO_PUBLIC_` keys (`SUPABASE_URL`, `DATABASE_URL`, `SUPABASE_JWKS_URL`) are never inlined, have zero readers in `src/`, `app/`, `scripts/`, `eas.json` or either build script, and appear in no tracked example — they are backend-plane keys that drifted into a mobile env file, and one of them is a live pooler DSN with a password.

**Files:**
- Modify (untracked, local only): `mobile-app/reactnative/.env.production`
- Modify (tracked): `mobile-app/reactnative/build-aab.sh` — the Step 4 assertion, and `build-apk.sh` if it carries the same env-selection block
- Modify: `docs/devops/production-migration-ledger.md` (append `## Mobile plane`)
- Reference: `mobile-app/reactnative/eas.json` (`build.production.env`), `mobile-app/reactnative/.env.production.example` (tracked, correct), `build-aab.sh:109-128` (file selection + exit-1 guard), `build-aab.sh:255-284` (bundle verification), `Makefile:60-69`

**Interfaces:**
- Consumes: `node scripts/export-eas-profile-env.mjs production` (exit 0, six lines — verified) — the same projection the tracked profile is authoritative for.
- Produces: a `.env.production` that passes `node scripts/check-env-mocks.mjs` (the gate `build-aab.sh:155` runs) and whose only Supabase ref is `nmseefdlliejmdbxytej`; a pre-cutover backup the guard can be demonstrated against; and a tracked refusal in both release scripts that makes the staging-wired prod build impossible rather than merely documented.

- [ ] **Step 1: Prove which file a build reads, and what it currently says**

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
/bin/ls -1 .env.production .env.staging .env .env.local .env.production.local 2>&1
git -C /Users/paymax/Documents/spotlight/main check-ignore -v mobile-app/reactnative/.env.production
/usr/bin/grep -cE 'wnic|ptcz|frontend-web-staging|staging' .env.production
```

Expected: both shadow files absent — so `build-aab.sh:142-149`'s refusal will not fire and `.env.production` is the file a release build reads. `check-ignore` prints the `.gitignore:12` rule, which is why Step 2's edit is unreviewable in a diff and Step 3's artifact grep is the only proof that survives. Report the staging-ref count; do not silently rewrite.

- [ ] **Step 2: Re-point the local file at the tracked profile, without deleting it**

Apply the six profile values generically (never hand-typed, so a future `eas.json` edit is picked up), then fix the two `EXPO_PUBLIC_*` URLs the profile does not carry and drop the three backend keys it never should:

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
node scripts/export-eas-profile-env.mjs production > /tmp/eas_prod.env || exit 1
[ "$(/usr/bin/grep -c . /tmp/eas_prod.env)" = 6 ] || { echo "REFUSE: profile emitted $(/usr/bin/grep -c . /tmp/eas_prod.env) keys"; exit 1; }
/bin/cp .env.production .env.production.pre-cutover.2026-11-12
while IFS='=' read -r k v; do
  case "$k" in ''|'#'*) continue ;; esac
  [ -n "$v" ] || { echo "REFUSE: empty value for $k"; exit 1; }
  if /usr/bin/grep -q "^${k}=" .env.production; then
    /usr/bin/sed -i '' -E "s#^${k}=.*#${k}=${v}#" .env.production
  else
    printf '%s=%s\n' "$k" "$v" >> .env.production
  fi
done < /tmp/eas_prod.env
/usr/bin/sed -i '' -E \
  -e 's#^EXPO_PUBLIC_SITE_URL=.*#EXPO_PUBLIC_SITE_URL=https://www.spotlightng.com#' \
  -e 's#^EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL=.*#EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL=https://www.spotlightng.com/login#' \
  -e '/^(SUPABASE_URL|DATABASE_URL|SUPABASE_JWKS_URL)=/d' .env.production
```

Verified on a copy before writing this step: 6 keys applied, 0 appended, 247 → 244 lines, the three dropped keys are the only keys removed, `node scripts/check-env-mocks.mjs` still exits 0 (69/70 derived flags live). The two URL values come from the tracked `.env.production.example:19,26`, not from invention. Do **not** `mv .env.production` aside — that trips `build-aab.sh:123`.

- [ ] **Step 3: Verify the shipped artifact, using the check the release script already performs**

`build-aab.sh` already extracts the JS bundle and greps it (`:267-284`: `*/assets/index.android.bundle`, then `EXPECTED_HOST` derived from `EXPECTED_API` at `:278`), so building through it reports ✅/❌ on the API host. What it does **not** do is verify Supabase: `EXPECTED_SUPABASE` is read at `:134` and only echoed at `:197` — a bundle carrying the staging project ref would pass every gate. Add the negative check by hand to the same artifact after the build succeeds:

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
AAB="$(/usr/bin/find release-artifacts android/app/build/outputs/bundle/release -name '*.aab' -type f -newer .env.production 2>/dev/null | /usr/bin/head -1)"
[ -n "$AAB" ] || { echo "REFUSE: no AAB newer than the env edit — build first, then re-run this"; exit 1; }
echo "verifying: $AAB"
W="$(/usr/bin/mktemp -d)"; /usr/bin/unzip -o -q "$AAB" '*assets/index.android.bundle' -d "$W"
B="$(/usr/bin/find "$W" -name 'index.android.bundle' | /usr/bin/head -1)"
[ -n "$B" ] || { echo "REFUSE: no JS bundle entry in $AAB"; exit 1; }
echo "staging refs in shipped bundle:"; /usr/bin/grep -aoE 'wnic[a-z0-9]{4,}|ptcz[a-z0-9]{4,}|frontend-web-staging[a-z0-9.-]*' "$B" | /usr/bin/sort -u
echo "prod refs in shipped bundle:";   /usr/bin/grep -aoE 'nmseef[a-z0-9]{4,}|frontend-web-production-[a-z0-9]+|www\.spotlightng\.com' "$B" | /usr/bin/sort -u
/bin/rm -rf "$W"
```

`build-aab.sh:246` reads the bundle from `android/app/build/outputs/bundle/release` and `:416-418` copies it to `release-artifacts/app-release-${NODE_ENV}.aab`, so both paths are searched and the newest is verified.

Expected: the staging line prints **nothing**, and all three prod forms appear. The artifact grep — not the env file, not `eas.json`, and not a build log — is the tiebreaker that has already overturned two runbooks; the local project memory `rn-prod-release-staging-plane.md` records the 2026-11-10 decision to ship staging wiring deliberately, so it is this grep, not that note, that settles what the installed app talks to.

- [ ] **Step 4: Make the release lane refuse a staging-wired prod build (test first)**

The guard has to be a refusal, not a fact in a doc, because the file it checks is gitignored and the existing checks are self-referential. Write the failing case against the real files first:

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative
cat > /tmp/guard-case.sh <<'EOS'
#!/usr/bin/env bash
set -uo pipefail
ENV_FILE="$1"; NODE_ENV="${2:-production}"
declared="$(grep -E '^EXPO_PUBLIC_APP_ENV=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
if [[ "$NODE_ENV" == "production" && "${declared:-}" != "production" ]]; then
  echo "❌ $ENV_FILE declares EXPO_PUBLIC_APP_ENV=${declared:-<unset>}; a production release must declare production." >&2
  echo "   Regenerate it from the tracked profile: node scripts/export-eas-profile-env.mjs production" >&2
  exit 1
fi
echo "✅ $ENV_FILE declares EXPO_PUBLIC_APP_ENV=${declared:-<unset>} for NODE_ENV=$NODE_ENV"
EOS
/bin/bash /tmp/guard-case.sh .env.production.pre-cutover.2026-11-12 production; echo "exit=$?"
/bin/bash /tmp/guard-case.sh .env.production production; echo "exit=$?"
/bin/bash /tmp/guard-case.sh .env.staging staging; echo "exit=$?"
```

Expected: **1** for the pre-cutover backup (the bug, caught — Step 2 made that copy before editing), **0** for the corrected file, **0** for a staging build, where declaring staging is legitimate. All three outcomes verified on 2026-11-12 against the real staging-wired file, a corrected copy, and `.env.staging`.

Then paste the same six-line guard into both release scripts, immediately after the `ENV_FILE` existence check and before the `EXPECTED_API` read — `build-aab.sh:129` (after its `fi`) and `build-apk.sh:132`:

```bash
# This guard cannot be derived from the bundle check below: EXPECTED_HOST is read
# from $ENV_FILE, so a staging-wired .env.production makes that check green on the
# wrong host. Assert the declaration itself instead.
_declared_env="$(grep -E '^EXPO_PUBLIC_APP_ENV=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
if [[ "$NODE_ENV" == "production" && "${_declared_env:-}" != "production" ]]; then
  echo "❌ $ENV_FILE declares EXPO_PUBLIC_APP_ENV=${_declared_env:-<unset>}; a production release must declare production." >&2
  echo "   Regenerate it from the tracked profile: node scripts/export-eas-profile-env.mjs production" >&2
  exit 1
fi
```

```bash
cd /Users/paymax/Documents/spotlight/main
/bin/bash -n mobile-app/reactnative/build-aab.sh && /bin/bash -n mobile-app/reactnative/build-apk.sh && echo "syntax ok"
/usr/bin/git diff --stat mobile-app/reactnative/build-aab.sh mobile-app/reactnative/build-apk.sh
git add mobile-app/reactnative/build-aab.sh mobile-app/reactnative/build-apk.sh
git commit -m "fix(mobile): refuse a production build whose env file declares staging

The last app-release-production.aab baked frontend-web-staging-new and the wnic
Supabase ref: build-aab.sh derives EXPECTED_HOST from the same env file it greps
the bundle with, so a staging-wired .env.production verifies green."
```

- [ ] **Step 5: Record both user-visible consequences in the ledger**

`EXPO_PUBLIC_APP_ENV=staging` is what makes `isSwitchAvailable()` show the Remote/Local switch to end users; with the corrected wiring the switch disappears from prod builds. State that in the ledger as a user-visible change, not a cleanup, and alongside it two facts the next session cannot derive from the repo: `.env.production` is gitignored, so this fix exists only on this machine and must be re-applied on any new build host (until it is, `.env.production.pre-cutover.2026-11-12` is the staging-wired backup — keep it, do not restore it); and the staging pooler DSN that was in it (`DATABASE_URL`) surfaced in tool output during this planning session, so that password is to be treated as exposed and rotated by whoever owns the `wnic…` project before this plan is considered closed.

---

## Phase 6 — Closeout

### Task 16: Correct the docs the cutover just outdated, and name what is still open

**Files:**
- Modify: `docs/devops/deployment-matrix.md` — its §Authoritative paths rows for `backend` (last prod dispatch 2026-10-17 → now the release SHA) and its line 19 Postgres row ("`db-migrate.yml` is dormant by design")
- Modify: `docs/devops/backup-restore-runbook.md:37` ("not yet scheduled") — either schedule it or state who owns the manual cadence
- Modify: `docs/runbooks/referral-gate-parity.md` — generalize it: the 503 class is not referral-specific, and `frontend-web/config/production-module-flags.env` + `make flag-parity` are now the fix
- Modify: `docs/devops/staging-environment-setup.md` §"Remaining manual steps" — check off what this cutover completed

**Interfaces:**
- Produces: no new mechanism; the plan's last act is to leave the docs true, because three of them already argued wrongly about production in this session's evidence gathering.

- [ ] **Step 1: Write the "still open" list into the ledger, with owners**

At minimum, from this session's measurements: `SPOTLIGHT/Banners/*` art — 9 of the 13 publicIds in `frontend-web/app/api/media/banners/[slug]/route.ts` return 404 from the `paymax` Cloudinary cloud (a provisioning task needing Cloudinary credentials, not a code fix; `SpotlightBanner` already collapses them); the `Production` GitHub environment's `SUPABASE_PROJECT_ID` may still hold the staging ref, which only a dispatched `ops-db-push.yml` link-step log can settle; `integration-verify.yml`'s red module lanes left red by choice; and the `docs/devops/GO-LIVE-CHECKLIST.md` pre-dates this architecture (`VIDEOSDK_*`, "fill deploy.yml TODOs with your cloud") and should be marked historical.

- [ ] **Step 2: Push the doc set and say what it does and does not release**

```bash
cd /Users/paymax/Documents/spotlight/main
git -c credential.helper='!gh auth git-credential' push origin HEAD:refs/heads/main
gh run list --repo paymax2022/spotlight-latest1 --workflow sync-frontend-web.yml --limit 2 --json headSha,status,conclusion
gh run list --repo paymax2022/spotlight-latest1 --workflow release.yml --limit 2 --json headSha,status,conclusion,event,createdAt
```

Expected, as re-measured 2026-11-16: **no** `sync-frontend-web.yml` run for a docs-only push (that lane really is filtered to `frontend-web/**`), and **yes** a `Release (main → development, staging, production)` run for every push to `main`, docs included — `release.yml` (`ef97ec64b`) has no `paths` filter at all. The push is still inert for a docs-only commit, but read the reason from the gate rather than from a filter: `ci.yml:69-71` and `integration-verify.yml:15-17` ignore `**.md` and `docs/**` on push, so the gate classifies the SHA `noop_docs_only` (`scripts/ci/release-gates.py:108-114`) and each deploy/migrate job requires `verdict == 'proceed'`. Observed on the docs-only merge `479bcd10b`: push run `43887543175` at 14:36:47Z ended with **zero jobs** and conclusion `cancelled`, and the re-dispatch `43893246842` at 15:08:55Z printed `### Release gate: **failed**` with all eight downstream jobs skipped — `noop_docs_only` is valid only for a push (`release-gates.py:115-119`), so a red gate on a docs SHA is the classifier refusing to infer silence from a dispatch, not evidence that docs deploy. The positive case arrived with the next docs-only merge: `f90b3ef30` (#1043) produced push run `43905831788`, whose gate printed `### Release gate: **noop_docs_only**` after ten polls and skipped all eight downstream jobs, cPanel run `43905831719` skipped too. What this step must now say plainly: **a non-docs push to `main` releases itself toward production, migrations included**, with no dispatch, no typed `DEPLOY`, no promotion branch and no approval — and as of 2026-11-16 it stops short of arriving, because the staging deploy leg is red on Railway's upload-decode error and `migrate-production` sits behind `smoke-staging` in the `needs` chain. Treat that as luck, not as a control: fix the staging leg and the claim becomes live, so Task 3 must be closed first.

Before pushing, list what the commit touches (`git diff --name-only origin/main..HEAD`); if any path is not under `docs/` or a `.md`, treat the push as the release it is. Then read the run page rather than its colour: `gh run view <id> --json jobs`. Checking `gh api "repos/paymax2022/spotlight-latest1/actions/runs?status=waiting"` for a parked approval that must be **declined**, not deferred, is still the right reflex — quote the URL or zsh globs the `?` — but `release.yml` removed the approval from the automatic path, so what sits in `waiting` now is other workflows' dispatch gates.

- [ ] **Step 3: Declare the migration done only against this checklist**

Every row is a command someone ran, with the value it returned written in the ledger beside it. No row may be closed on recollection, and the migration is not done while any row is unverified — this list exists because each of these was separately wrong in an earlier draft of this plan.

| # | Done means | Verified by |
|---|---|---|
| 1 | `RELEASE_SHA` is pinned and read back at 40 hex chars | Task 1 Step 2's guard |
| 2 | `list-pending.sh` and its test are committed; the test prints `PASS` | Task 2 Step 7 |
| 3 | A prod dump exists **and** restores, with `supabase_migrations` rows equal to the baseline | Task 3 Steps 2–3 |
| 4 | The release SHA's migrations replay from zero on `postgis/postgis:17-3.4`, `rls-check` clean | Task 4 Step 2 |
| 5 | Staging reconciled to **0 pending** before any prod write | Task 5 Step 4's re-read |
| 6 | Prod at **0 pending** on a fresh `mode=list` table, not a number sweep | Task 6 Step 5 |
| 7 | `production-module-flags.env` committed: 45 lines, 36 `=true`, 9 `=false` | Task 7 Step 4's counts |
| 8 | The cPanel runtime env carries those 45 keys and **no** `FEATURE_*` in the process env | Task 8 Step 3 + Task 9 Step 4's probe re-read |
| 9 | `make flag-parity` green locally **and** in CI, and proven to bite | Task 9 Steps 5–6 |
| 10 | The money-path rulings recorded per name, both web planes plus the Go route group | Task 10 Step 2 |
| 11 | The nine missing backend flags set; the five provider keys copied without ever printing a value | Task 13 Steps 1 and 5 |
| 12 | Prod Go reports `/public/build` == `RELEASE_SHA`; the login page's chunk hrefs match the build | Task 11 Step 3, Task 12 Step 3 |
| 13 | The acceptance matrix committed, with `scripts/flagprobe.sh` beside it, and no `=true` flag answering 503 on a real gated route | Task 14 Steps 1–5 |
| 14 | The shipped AAB contains zero `wnic…` / `frontend-web-staging…` strings, and `build-aab.sh` now refuses a prod build whose env file declares staging | Task 15 Steps 3 and 4 |
| 15 | The four outdated docs corrected, and the still-open list named with owners | Task 16 Steps 1–2 |

---

## Deferred by design

Explicitly **not** in this plan, each because it is a separate subsystem with its own risk:

- Consolidating the five parallel deployment stacks (`render.yaml`, `railway.json`, terraform/Cloud Run, cPanel Passenger, EAS) into the matrix's one-writer rule. `deploy.yml`'s jobs are all skipped while `vars.GCP_PROJECT_ID` is unset; deleting or enabling anything there is a separate decision.
- Splitting the Supabase free-plan 2-project limit so local dev stops sharing the staging database — the reason "validate on staging" mutates the dev DB.
- Making frontend-web production canary-gated (Cloud Run's 10% canary → human promote) instead of push-to-main.
- The cross-repo configuration merge: `spotlight-latest` now holds a lane step that reads a file owned by `spotlight-latest1`; a single config repo is the better shape but is a re-plumbing of the sync lane.
