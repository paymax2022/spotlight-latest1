# Runbook — Leaked `.env` Snapshots: Purge & Rotate

**Severity:** High (real credentials were committed to git history).
**Owner:** repo maintainer (must be run from a trusted local clone with push rights).
**Status:** Step 1 (untrack) has been staged in-session. Step 4 is now partly
implemented (see the 2026-11-19 section). Steps 2–3 — history purge and credential
rotation — remain the maintainer's, and Step 3 is the only step that remediates a leak.

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
- Payment/rails providers: Paystack (`sk_*`), Monnify, Eversend, VertoFX.
- KYC providers: Dojah, Smile ID, Youverify keys.
- Messaging/media: Resend, Termii, Cloudflare R2 (`R2_*`), VideoSDK.
- AI: `ANTHROPIC_API_KEY`.
- Signing seeds / PII key: any Arena Ed25519 seeds, `KYC_PII_ENC_KEY` (re-key + re-encrypt affected blobs).

For each: generate a new value in the provider console, update the deployment
secret store, redeploy, then revoke the old value. **Rotate before or immediately
after the history purge — do not wait.**

## Step 4 — Prevent recurrence

- `.gitignore` already blocks `.history/`, `.agentwork/`, `.env`, `.env_*` (verified).
- **DONE 2026-11-19:** `scripts/check-client-secrets.sh` now fails on this, in three
  places rather than the one the bullet asked for:
  1. any env file (template or not) holding a console-minted provider token
     (`rlwy_proj_`, `rkt_`, `github_pat_`, `gh[pousr]_`);
  2. **any tracked file at all** holding one, which is what catches a token pasted
     into a doc, a script, or a workflow instead of an env file;
  3. any tracked file that is a live env snapshot — `.env`, `.env.local`, the
     timestamped `.env_YYYYMMDDHHMMSS[.local]` artifacts this runbook was written
     about — while `*.example` / `*.sample` / `*.template` / `*.enc` stay exempt.
  Both shapes are `****`-mask-tolerant, so `docs/devops/deployment-matrix.md`, which
  publishes `rlwy_proj_****wtix` previews on purpose, stays green. Rules 2 and 3 use
  git's tracked-file walk (`git grep -IE`, `git ls-files`), never a filesystem walk,
  so `node_modules` and gitignored scratch dirs cannot slow or pollute the scan;
  on this repo the whole guard runs in about 18 s. `scripts/ci/test-check-client-secrets.sh`
  gates all seven behaviours against a throwaway git repo and is a step in the
  `secret-hygiene` job; the rules were mutation-checked (feed them `/dev/null` and
  four cases go red), because a guard that only ever prints ✓ is not a guard.
- Add a pre-commit hook (e.g. `gitleaks`) to block secret commits locally.
  `.githooks/pre-commit` already calls `scripts/check-client-secrets.sh`, so the
  rules above apply locally **only if the hook is installed**:
  `git config core.hooksPath .githooks`. It was not set on the machine where the
  2026-11-19 incident below happened.
- Configure the "Local History" extension to write outside the repo, or ensure the
  worktree/agent tooling never runs inside a tracked path.

## 2026-11-19 — Railway project tokens in a tracked template

Two live `rlwy_proj_…` values were pasted into the tracked root template
`.env.dev.example` as `railway_toke_staging=` and `railway_toke_staging_old=` —
lower-case keys no code reads, added as a note. They were **never committed**, so
nothing shipped; the file was restored from `origin/main`. What the incident
actually exposed is that no control would have noticed had they been committed:
the CI hygiene lane and the pre-commit hook both passed them (fixed above).

Verification performed, all read-only, no value printed:

| Where a credential could sit | Result |
|---|---|
| `git log --all -G 'rlwy_proj_[A-Za-z0-9]{30,}'` (every local + remote ref) | 0 commits |
| GitHub code search, this repo + `spotlight-latest` + `spotlight-new` | 1 file: the masked matrix doc |
| Issue / PR / comment search for `rlwy_proj` | 0 |
| Job logs of the three token-probe runs (`44345729380`, `44351036777`, `44406178859`) | 0 hits in 18 job logs |
| Actions **variables** (plaintext) | 0 token-shaped values; the four values are `true`/`True` |
| Actions **secrets** | `RAILWAY_TOKEN_DEVELOPMENT` / `_STAGING` / `_PRODUCTION` exist — the correct home |

So no usable token value reached GitHub. What did reach GitHub is the *masked*
preview of each bound token in `docs/devops/deployment-matrix.md` (prefix + last 4),
which is what made the identification below possible.

**Which token is which, without reading a secret:** compare last 4 characters.
The matrix records that the 2026-11-16 re-mint bound `…wtix` to development,
`…FCjl` to staging and `…zr4I` to production, and that `…xU87` was revoked. The two
pasted values ended `…rK04` and `…Y8xn` — **none of the four**. Either they are
post-2026-11-16 re-mints that the matrix does not list yet, or they are older
credentials that Railway still considers live. Only the Railway dashboard answers
that, so the maintainer action is unchanged:

1. Railway dashboard → project → Deploy → Tokens (or `railway token list` with an
   admin token): revoke any project token not accounted for by the matrix table.
2. Re-mint per environment and update `RAILWAY_TOKEN_DEVELOPMENT`,
   `RAILWAY_TOKEN_STAGING`, `RAILWAY_TOKEN_PRODUCTION` via
   `gh secret set RAILWAY_TOKEN_STAGING --repo paymax2022/spotlight-latest1`.
3. Add the new last-4 previews back to `docs/devops/deployment-matrix.md` so the
   next paste can be identified the same way.
4. Install the hook: `git config core.hooksPath .githooks`.

Secret scanning is **disabled** on `paymax2022/spotlight-latest1` (the API answers
404 "Secret scanning is disabled on this repository"), which is why no alert ever
existed for the historical `.env` snapshots either. Enabling it — and then push
protection — is the cheapest remaining prevention step and needs repo admin rights.

---

*Untracking is staged. History purge + credential rotation are the remediation and
must be performed by the maintainer. Nothing in this repo automates rotation, and
no secret values were read or printed during this work.*
