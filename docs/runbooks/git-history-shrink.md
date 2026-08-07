# Runbook — shrink git history (remove committed build artifacts)

**Status:** ready to execute; **do NOT run ad-hoc.** This is a coordinated, destructive,
one-shot operation that rewrites every commit hash in the repo. Schedule it, freeze the
repo, and make sure every collaborator re-clones afterward.

**Owner:** _(assign before running)_ · **Repo:** `paymax2022/spotlight-latest1` (remote `origin`)

---

## 1. Why

Build artifacts were committed before `.gitignore` covered them. They live in **history**, so
untracking them going-forward (already done for `backend/server` in #68) does **not** reclaim
the space — only a history rewrite does.

Current `.git` ≈ **858 MB**. Largest blobs still in history (`>15 MB`):

| Path | Size in history | Currently tracked on `main`? |
|---|---|---|
| `backend/server` | 53.8 MB | No (untracked in #68) — history only |
| `frontend-web/.next/**` (webpack packs) | ~147 MB across packs | No (gitignored) — history only |
| `frontend-web/.npm-cache/**` (cacache) | ~110 MB across blobs | No (gitignored) — history only |
| `backend/marketplace-cron` | 16.7 MB | **YES — still tracked** (see §8) |

**Reclaimable: ~330 MB+** (plus pack/delta savings on top).

## 2. Impact — read before scheduling

- **Every commit SHA changes.** All branches, tags, and open PRs are rebuilt on new hashes.
- **Everyone must re-clone** (or hard-reset — §7). Anyone who merges an *old* clone afterward
  **reintroduces the deleted blobs** and undoes the work.
- **Open PRs** built on old history will show as diverged after the force-push. Merge or close
  them **before** the rewrite (§4), then recreate any that are still needed.
- **⚠ Concurrent automation:** `main` in this repo is advanced by concurrent sessions/agents.
  A rewrite while something else is pushing is a guaranteed mess. **Hard-freeze all automation
  and human pushes for the whole window.**

## 3. Prerequisites

- `git-filter-repo` installed (verified present at `/usr/local/bin/git-filter-repo`;
  else `brew install git-filter-repo` or `pip install git-filter-repo`).
- Admin rights on the GitHub repo (to relax branch protection for the force-push).
- A machine with ~3 GB free disk and a good network.

---

## 4. Step 1 — Announce freeze & drain PRs

1. Announce the maintenance window; **stop all CI, cron agents, and human pushes.**
2. Merge or close **every open PR** (`gh pr list` / the PRs UI). Delete merged branches.
   Rewriting with open PRs around means recreating them afterward anyway.
3. Confirm `origin/main` is at the SHA you expect and nothing is mid-flight.

## 5. Step 2 — Full backup (rollback insurance)

```bash
# A complete mirror of every ref — this is your rollback point (§10). Keep it until verified.
git clone --mirror https://github.com/paymax2022/spotlight-latest1.git spotlight-backup.git
du -sh spotlight-backup.git   # sanity: should be ~0.9 GB
```

## 6. Step 3 — Rewrite on a fresh mirror

`git filter-repo` refuses to run on a non-fresh repo by design. Operate on a **fresh mirror**,
never your working clone.

```bash
git clone --mirror https://github.com/paymax2022/spotlight-latest1.git spotlight-rewrite.git
cd spotlight-rewrite.git

# Remove the artifact paths from ALL history. --invert-paths = "delete these, keep everything else".
# --path matches a file OR any path beneath a directory.
git filter-repo \
  --path backend/server \
  --path backend/marketplace-cron \
  --path frontend-web/.next \
  --path frontend-web/.npm-cache \
  --invert-paths

# Optional belt-and-suspenders — catch the same artifact types anywhere in the tree
# (uncomment if the blob scan in §9 shows stragglers under other paths):
#   --path-glob '**/.next/**' \
#   --path-glob '**/.npm-cache/**' \
#   --path-glob '**/node_modules/**'
```

Re-run the blob scan (§9) *inside* `spotlight-rewrite.git` to confirm the big blobs are gone
before you push anything.

```bash
git reflog expire --expire=now --all && git gc --prune=now --aggressive
du -sh .   # expect a large drop from ~0.9 GB
```

## 7. Step 4 — Force-push the rewritten history

`filter-repo` removes the `origin` remote as a safety measure. Re-add and push.

1. **Relax branch protection** on GitHub: Settings → Branches → the `main` rule → temporarily
   enable "Allow force pushes" (or use an admin override). Re-enable immediately after.
2. Push all refs:

```bash
git remote add origin https://github.com/paymax2022/spotlight-latest1.git
git push --force --mirror origin
```

> `--mirror` force-updates **all** refs and deletes remote refs absent locally. That's the
> intended clean-slate behavior here **because the repo is frozen** — do not run it if anyone
> pushed during the window (re-do from §5 if so). If you prefer surgical control, push each
> active branch with `git push --force origin <branch>` instead.

3. **Re-enable branch protection** (and the "block force pushes" setting).

## 8. Step 5 — Stop the bleeding (prevention)

- `backend/server` is already gitignored (#68).
- **`backend/marketplace-cron` is still tracked** — untrack + ignore it in the same spirit
  (mirror the #68 change): `git rm --cached backend/marketplace-cron`, add `/backend/marketplace-cron`
  to the AUTO-MANAGED block in `scripts/update-gitignore.sh`, run `--write`. Do this as a normal
  PR **before or right after** the rewrite so the freshly-cleaned history never regains it.
- `.next/` and `.npm-cache/` are already in the managed `.gitignore` — no code change needed.

## 9. Step 6 — Verify

```bash
# In a FRESH clone taken after the force-push:
git clone https://github.com/paymax2022/spotlight-latest1.git verify && cd verify
du -sh .git                                  # expect a few hundred MB, down from ~858 MB
git rev-list --objects --all | grep -E 'backend/server$|marketplace-cron$' && echo "STILL PRESENT ✗" || echo "gone ✓"

# Largest remaining blobs (same scan used to build this runbook):
git rev-list --objects --all \
 | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
 | awk '/^blob/ {print $3, $4}' | sort -rn | head -12 \
 | awk '{ printf "  %7.1f MB  %s\n", $1/1048576, $2 }'
```

**GitHub server-side note:** GitHub does not immediately reclaim the old blobs — they linger as
unreachable objects until GitHub's own GC runs, and any ref still pointing at old history
(a stale branch, an un-closed PR) keeps them reachable and blocks shrinkage. Ensure every stale
ref is gone; to force server-side repacking sooner, open a GitHub Support request referencing this
cleanup. Local clones taken after the push are already small regardless.

## 10. Step 7 — Everyone re-syncs

**Simplest (recommended): delete the old clone and re-clone.** Broadcast this.

For anyone with un-pushed local work they must keep:

```bash
git fetch origin
git checkout main && git reset --hard origin/main
# For each local feature branch, replay its commits onto the rewritten main:
git rebase --onto origin/main <old-base-sha> <feature-branch>
# If a rebase drags the old blobs back in, cherry-pick the wanted commits into a fresh clone instead.
```

Delete-and-reclone avoids every foot-gun; prefer it unless someone genuinely can't.

## 11. Rollback

If anything goes wrong before you're satisfied, restore from the §5 mirror:

```bash
cd spotlight-backup.git
git push --force --mirror https://github.com/paymax2022/spotlight-latest1.git
```

Then re-enable branch protection. Because the backup is a full mirror, this returns the remote
to its exact pre-rewrite state (all refs, all objects).

---

## Appendix — BFG alternative

[BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) is faster for pure "delete these
files/blobs" jobs but less flexible than filter-repo:

```bash
# operates on a --mirror clone, like §6
bfg --delete-files server --delete-files marketplace-cron spotlight-rewrite.git
bfg --delete-folders '{.next,.npm-cache}' spotlight-rewrite.git
cd spotlight-rewrite.git && git reflog expire --expire=now --all && git gc --prune=now --aggressive
```

BFG never touches the most-recent commit's tree (it protects `HEAD`), which is fine here since
the artifacts are already untracked at `HEAD`. filter-repo (§6) is the recommended path.
