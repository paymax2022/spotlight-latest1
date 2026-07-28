# Runbook — Leaked `.env` Snapshots: Purge & Rotate

**Severity:** High (real credentials were committed to git history).
**Owner:** repo maintainer (must be run from a trusted local clone with push rights).
**Status:** Step 1 (untrack) has been staged in-session. Steps 2–4 must be done by you.

---

## What happened

The editor "Local History" extension and agent worktrees wrote real `.env`
snapshots (`.env_YYYYMMDDHHMMSS.local`) under `.history/` and `.agentwork/`, and
these were committed **before** `.gitignore` was hardened. Git kept tracking them.

- **59** tracked secret/`.env` snapshot files (plus the surrounding stale worktree
  trees: `.agentwork/` = 5,688 files, `.history/` = 293 files).
- `.gitignore` already ignores `.history/`, `.agentwork/`, `.env`, `.env_*` — but
  ignore rules do not untrack already-committed files, and do not remove them from
  history.

Untracking (done) removes them from the working tree going forward. **The secrets
still exist in every historical commit** until history is rewritten, and any secret
that was ever committed must be **rotated** — rewriting history does not un-leak a
value that was already pushed.

---

## Step 1 — Untrack (DONE in-session, commit it)

Already staged (files remain on disk, now gitignored):

```bash
git rm -r --cached --quiet .agentwork .history
git commit -m "chore(security): untrack .history/.agentwork stale worktrees + leaked .env snapshots"
```

Verify no secret snapshots remain tracked:

```bash
git ls-files | grep -E '\.env_' | wc -l   # expect 0
```

## Step 2 — Purge from history (destructive — rewrites history)

> Rewriting history changes commit SHAs. Coordinate with everyone who has a clone
> (they must re-clone or hard-reset). Do this on a quiet branch window.

Preferred tool: `git filter-repo` (install via `pip install git-filter-repo`):

```bash
# From a FRESH mirror clone (safest):
git clone --mirror <repo-url> spotlight-purge && cd spotlight-purge

# Remove the artifact trees and any .env snapshot from ALL history:
git filter-repo --path .history --path .agentwork --invert-paths
git filter-repo --path-glob '**/.env_*.local' --invert-paths
git filter-repo --path-glob '**/.env' --path-glob '**/.env.*.local' --invert-paths

# Push the rewritten history:
git push --force --mirror
```

(Alternative: BFG — `bfg --delete-folders '{.history,.agentwork}' --delete-files '.env_*.local'`.)

After the force-push, every collaborator runs:

```bash
git fetch --all && git reset --hard origin/<branch>   # or re-clone
```

## Step 3 — ROTATE every credential that was ever in those files

**This is the only step that actually remediates the leak.** Treat every secret
that appeared in a committed `.env`/snapshot as compromised and rotate it at the
source. Based on the config surface, rotate at minimum:

- Supabase: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, anon key, DB password (`DATABASE_URL`).
- Payment/rails providers: Paystack (`sk_*`), Maplerad (`mpr_*`), Monnify, Eversend.
- KYC providers: Dojah, Smile ID, Youverify keys.
- Messaging/media: Resend, Termii, Cloudflare R2 (`R2_*`), Agora/VideoSDK.
- AI: `ANTHROPIC_API_KEY`.
- Signing seeds / PII key: any Arena Ed25519 seeds, `KYC_PII_ENC_KEY` (re-key + re-encrypt affected blobs).

For each: generate a new value in the provider console, update the deployment
secret store, redeploy, then revoke the old value. **Rotate before or immediately
after the history purge — do not wait.**

## Step 4 — Prevent recurrence

- `.gitignore` already blocks `.history/`, `.agentwork/`, `.env`, `.env_*` (verified).
- CI already runs `scripts/check-client-secrets.sh` — extend it to also fail if any
  `.env`/`.env_*.local` becomes tracked (`git ls-files | grep -E '\.env(_.*)?$'`).
- Add a pre-commit hook (e.g. `gitleaks`) to block secret commits locally.
- Configure the "Local History" extension to write outside the repo, or ensure the
  worktree/agent tooling never runs inside a tracked path.

---

*Untracking is staged. History purge + credential rotation are the remediation and
must be performed by the maintainer. Nothing in this repo automates rotation, and
no secret values were read or printed during this work.*
