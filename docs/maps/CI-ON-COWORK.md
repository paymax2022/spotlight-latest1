# Running CI on this platform (Cowork)

Goal: run the Maps verification gate from within Cowork so product development is
end-to-end on one platform, not dependent on external GitHub Actions.

## TL;DR

```bash
# Fast gate (no toolchain needed beyond python) — runs in seconds:
bash scripts/ci/maps-ci-local.sh

# Add web + mobile TypeScript (installs npm deps; slower):
RUN_TS=1 bash scripts/ci/maps-ci-local.sh

# Add the PostGIS integration tests (needs Go + a Postgres+PostGIS DB):
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  bash scripts/ci/maps-ci-local.sh
```

The runner reports a `SUMMARY` (`PASS`/`FAIL`/`SKIP`) and exits non-zero if any
**runnable** check fails. Checks it can't run (missing toolchain) are reported as
`SKIP`, never silent.

## What runs on Cowork today

The Cowork sandbox can reach the **npm registry** and **PyPI**, so these run here:

| Check | Status on Cowork |
|-------|------------------|
| OpenAPI + workflow YAML parse | ✅ runs |
| Additive-only migration guard | ✅ runs |
| JSON config + dependency sanity | ✅ runs |
| Web TypeScript (scoped `tsconfig.mapscheck.json`) | ✅ runs with `RUN_TS=1` (deps installed; fast) |
| Mobile TypeScript (scoped `tsconfig.mapscheck.json`) | ✅ runs with `RUN_TS=1` |
| **Go build / vet / test** | ⛔ blocked — see below |
| PostGIS integration tests | ⛔ needs Go + a DB |

> The on-platform TypeScript gate has already earned its keep: it caught two real
> type errors (an RN `WebSocket` 3-arg call and a missing `*.css` ambient
> declaration), both fixed. Latest full run: `PASS=5 FAIL=0 SKIP=1` (only Go skipped).

## Why Go can't run here yet (and how to enable it)

The sandbox egress proxy allowlists npm + PyPI + `github.com` (web/atom) but
**blocks every Go toolchain host**. Verified `000`/`403` from:

- `go.dev/dl`, `dl.google.com`, `storage.googleapis.com/golang`
- `proxy.golang.org`
- `release-assets.githubusercontent.com` (GitHub release binaries → `403 from proxy`)

So a Go 1.25.x toolchain cannot be downloaded in-sandbox, and Go is not
preinstalled. To make the **full** gate run on Cowork, an admin needs to add the
Go distribution host(s) to the workspace network allowlist (Team/Enterprise:
Admin settings → Capabilities → network access). Allowlist any one of:

```
go.dev                       (and dl.google.com — official tarballs)
# or, if you prefer the GitHub-hosted builds setup-go uses:
release-assets.githubusercontent.com
```

Once reachable, install locally (no root needed) and re-run — the script picks Go
up automatically:

```bash
cd ~ && curl -sL https://go.dev/dl/go1.25.11.linux-amd64.tar.gz | tar -xz
export PATH="$HOME/go/bin:$PATH"
bash scripts/ci/maps-ci-local.sh
```

Until then, **GitHub Actions `maps-ci.yml` remains the authoritative Go gate** —
it has a Go toolchain and boots Supabase for the integration job. The on-platform
runner mirrors the same checks for everything that doesn't need Go.

## Scheduled CI

A scheduled task ("Run Maps CI") executes `scripts/ci/maps-ci-local.sh` on a
cadence and reports the summary back in chat. It runs the reachable checks today;
the moment the Go host is allowlisted (and Go installed in the image), the same
task runs the full build/test gate with no change. Adjust or remove it anytime
from the schedule list.

## How this maps to the GitHub workflow

`scripts/ci/maps-ci-local.sh` and `.github/workflows/maps-ci.yml` run the same
logical checks. The workflow is the canonical gate for PRs (full Go + Supabase);
the local runner is the on-platform mirror so you can verify continuously inside
Cowork without leaving the platform.
