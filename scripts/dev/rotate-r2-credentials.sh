#!/usr/bin/env bash
#
# Swap a rotated Cloudflare R2 key across every local file that holds the old
# one — in one pass, without ever printing a credential.
#
# WHY THIS EXISTS
# ---------------
# The R2 access key id AND its 64-character secret were committed to this
# repository and pushed (reachable on old-origin/chore/launch-infra-foundations
# via editor .history/ snapshots and .agentwork/ copies of
# frontend-web/.env.local). A later commit "untracked" the file, which removed
# it from HEAD and did nothing to history. Treat that key as compromised.
#
# The same value had also spread to ~21 files across the checkouts: live config,
# editor-history snapshots, .bak files and sibling git worktrees. Hand-editing
# that many places is how one gets missed and quietly keeps working with a
# revoked key — or worse, keeps a live one lying around.
#
# WHAT IT DOES
#   • finds every file under every git worktree holding the OLD key or secret
#   • LIVE config (.env / .env.local)      → rewritten to the new values
#   • STALE copies (.history/, .agentwork/,
#     *.bak*, *-backup-*)                  → DELETED, not rewritten; they are
#                                            snapshots, and rewriting them just
#                                            preserves the sprawl
#   • verifies afterwards that the old value survives nowhere
#
# It is a DRY RUN unless you pass --apply. Nothing is printed but file paths,
# counts and sha256 prefixes.
#
# ORDER OF OPERATIONS (important)
#   1. Revoke the old key in Cloudflare FIRST. It has been public for months;
#      the exposure outweighs the few minutes of downtime.
#   2. Mint the replacement, scoped to just the bucket it needs.
#   3. Run this to fix local checkouts.
#   4. Set the new values in the staging/production secret stores by hand —
#      this script deliberately does not touch deployed environments.
#
# USAGE
#   NEW_R2_ACCESS_KEY_ID=...  NEW_R2_SECRET_ACCESS_KEY=...  \
#     scripts/dev/rotate-r2-credentials.sh            # dry run
#   NEW_R2_ACCESS_KEY_ID=...  NEW_R2_SECRET_ACCESS_KEY=...  \
#     scripts/dev/rotate-r2-credentials.sh --apply
#
# Pass the values as ENVIRONMENT VARIABLES, never as arguments: arguments land
# in your shell history and in the process list, where other users can read them.
set -euo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

if [ -z "${NEW_R2_ACCESS_KEY_ID:-}" ] || [ -z "${NEW_R2_SECRET_ACCESS_KEY:-}" ]; then
  echo "error: set NEW_R2_ACCESS_KEY_ID and NEW_R2_SECRET_ACCESS_KEY in the environment." >&2
  echo "       (as env vars, not arguments — arguments leak via history and ps)" >&2
  exit 2
fi

# The old values are read from a reference file rather than typed, so a typo
# cannot cause a partial, half-rotated tree.
REF="${OLD_REF_FILE:-$(git rev-parse --show-toplevel)/frontend-web/.env.local}"
if [ ! -f "$REF" ]; then
  echo "error: reference file not found: $REF" >&2
  echo "       set OLD_REF_FILE to a file still holding the OLD credentials." >&2
  exit 2
fi

# Every checkout of this repo, so sibling worktrees are covered automatically.
ROOTS=$(git worktree list --porcelain | awk '/^worktree /{print $2}')

echo "roots:"; echo "$ROOTS" | sed 's/^/  /'
echo
[ "$APPLY" = "1" ] && echo "MODE: APPLY (files will be modified and deleted)" || echo "MODE: dry run — pass --apply to make changes"
echo

REF="$REF" ROOTS="$ROOTS" APPLY="$APPLY" python3 <<'PY'
import hashlib, os, re, shutil, sys, time

ref   = os.environ['REF']
roots = [r for r in os.environ['ROOTS'].split('\n') if r.strip()]
apply_ = os.environ['APPLY'] == '1'

new_id     = os.environ['NEW_R2_ACCESS_KEY_ID'].strip()
new_secret = os.environ['NEW_R2_SECRET_ACCESS_KEY'].strip()

def read_var(path, name):
    for line in open(path, errors='ignore'):
        if line.startswith(name + '='):
            return line.split('=', 1)[1].strip()
    return None

old_id     = read_var(ref, 'R2_ACCESS_KEY_ID')
old_secret = read_var(ref, 'R2_SECRET_ACCESS_KEY')
if not old_id or not old_secret:
    sys.exit(f'error: could not read old R2 credentials from {ref}')

def h(v): return hashlib.sha256(v.encode()).hexdigest()[:16]
print(f'old key id  sha256 {h(old_id)}  ({len(old_id)} chars)')
print(f'new key id  sha256 {h(new_id)}  ({len(new_id)} chars)')
if old_id == new_id:
    sys.exit('error: the new key id is identical to the old one — nothing to rotate.')
if len(new_secret) < 32:
    sys.exit(f'error: new secret looks too short ({len(new_secret)} chars); refusing.')
print()

SKIP_DIRS = {'node_modules', '.git', '.next', 'build', 'dist', 'vendor', '.expo'}
# Snapshots and backups. Rewriting these would preserve the sprawl that caused
# the leak, so they are removed instead.
STALE = re.compile(r'(/\.history/|/\.agentwork/|\.bak|-backup-|\.localdb-backup)')

live, stale = [], []
seen = set()
for root in roots:
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in SKIP_DIRS]
        for f in fn:
            p = os.path.realpath(os.path.join(dp, f))
            if p in seen:
                continue
            base = os.path.basename(p)
            if not (base.startswith('.env') or '.env' in base):
                continue
            try:
                body = open(p, errors='ignore').read()
            except Exception:
                continue
            if old_id not in body and old_secret not in body:
                continue
            seen.add(p)
            (stale if STALE.search(p) else live).append(p)

print(f'{len(live)} live config file(s) to rewrite:')
for p in sorted(live):  print('   ', p)
print(f'\n{len(stale)} stale copy/copies to DELETE:')
for p in sorted(stale): print('   ', p)

if not live and not stale:
    print('\nnothing holds the old credentials — already rotated.')
    sys.exit(0)

if not apply_:
    print('\ndry run — nothing changed. Re-run with --apply.')
    sys.exit(0)

stamp = time.strftime('%Y%m%d-%H%M%S')
changed = 0
for p in sorted(live):
    body = open(p, errors='ignore').read()
    # Back up OUTSIDE the tree: a .bak beside it would be a fresh copy of the
    # very sprawl this is cleaning up, and would be picked up by the next run.
    bdir = os.path.join(os.path.expanduser('~'), '.r2-rotation-backups', stamp)
    os.makedirs(bdir, exist_ok=True)
    shutil.copy2(p, os.path.join(bdir, p.replace(os.sep, '_').lstrip('_')))
    body = body.replace(old_id, new_id).replace(old_secret, new_secret)
    open(p, 'w').write(body)
    os.chmod(p, 0o600)
    changed += 1
    print(f'  rewrote {p}')

removed = 0
for p in sorted(stale):
    os.remove(p)
    removed += 1
    print(f'  deleted {p}')

print(f'\nrewrote {changed}, deleted {removed}; backups in ~/.r2-rotation-backups/{stamp}')

# Verify: the old values must survive nowhere, and live files must carry the new.
leftover = []
for root in roots:
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in SKIP_DIRS]
        for f in fn:
            p = os.path.join(dp, f)
            base = os.path.basename(p)
            if not (base.startswith('.env') or '.env' in base):
                continue
            try:
                body = open(p, errors='ignore').read()
            except Exception:
                continue
            if old_id in body or old_secret in body:
                leftover.append(p)

if leftover:
    print('\n  ⚠️ OLD CREDENTIAL STILL PRESENT IN:')
    for p in leftover: print('     ', p)
    sys.exit(1)

missing = [p for p in live if new_id not in open(p, errors='ignore').read()]
if missing:
    print('\n  ⚠️ NEW CREDENTIAL MISSING FROM:')
    for p in missing: print('     ', p)
    sys.exit(1)

print('\nverified: the old credential is gone from every env file; live files carry the new one.')
print('\nSTILL TO DO BY HAND:')
print('  • set the new values in the staging and production secret stores')
print('  • the leaked commits remain in history — rewriting or burning that')
print('    branch is a separate decision (old-origin/chore/launch-infra-foundations)')
PY
