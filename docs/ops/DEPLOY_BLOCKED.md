# ⚠️ CI + Deploy blocked by GitHub Actions billing (not a code problem)

**Status:** all GitHub Actions runs on this repo are failing — **this is a billing block, not a
code or migration regression.** The code on `main` is verified green locally.

## Symptom
Every workflow run (CI — CLAUDE.md gates, integration-verify, module CIs, **Deploy to Namecheap
cPanel (SSH)**) fails within a few seconds with **no steps executed**. Sampling the last 100 runs:
**100/100 failed, 0 succeeded**, across every branch and commit.

## Root cause (confirmed)
Each failed check-run carries the identical GitHub annotation:

> The job was not started because recent account payments have failed or your spending limit
> needs to be increased. Please check the 'Billing & plans' section in your settings.

GitHub is refusing to allocate GitHub-hosted `ubuntu-latest` runners (all 76 jobs use them), so
jobs are rejected at dispatch — before checkout or any step runs. That's why every workflow fails
identically in ~4 s. It is **account-wide**, unrelated to any commit, merge, or migration.

## The fix (account owner, in GitHub settings — cannot be done from code)
GitHub → **Settings → Billing and plans**:
1. Fix the failed payment method / pay the outstanding balance, **and/or**
2. Raise the Actions spending limit (if capped and exhausted).

## Re-trigger after billing is cleared (no new commit needed)
Re-run the existing runs at the current `main` tip via the API (or the "Re-run all jobs" button in
the Actions UI):

```bash
# needs a GitHub token with actions:write
REPO=paymax2022/spotlight-latest
for wf in ci.yml integration-verify.yml deploy.yml; do
  gh workflow run "$wf" --repo "$REPO" --ref main 2>/dev/null || true
done
# or re-run the latest failed runs on main:
gh run list --repo "$REPO" --branch main --limit 5
gh run rerun <run-id> --repo "$REPO"
```

## Proof the code itself is fine (verified locally, independent of CI)
- `go build ./...` — clean.
- Full backend `go test ./...` **with a live Postgres** — **134 ok / 0 FAIL / 0 build failures**
  (includes every money-path package: settlement, ledger, tiers, invoice, crypto, restaurant,
  restaurantpayout).
- The additive-only **migration guard**, run with its exact CI logic over all 244 migrations the
  golive merge brought to `main` — **PASS** (no destructive/narrowing DDL).
- Deploy is a GitHub-Actions SSH job; it is blocked solely because Actions can't start, not because
  of anything in the build.

**Do not read the red CI/deploy checks as a code failure.** Clear the billing, re-trigger, and the
pipeline (including the cPanel deploy) will execute normally.
