#!/usr/bin/env bash
#
# Swap a rotated Mailgun API key across every local file that holds the old
# one — in one pass, without ever printing a credential.
#
# WHY THIS EXISTS
# ---------------
# MAILGUN_API_KEY has been live in pushed git history since June 3rd
# (reachable on old-origin/chore/launch-infra-foundations via editor .history/
# snapshots and .agentwork/ copies of frontend-web/.env.local, the same leak
# that exposed the R2 credentials — see rotate-r2-credentials.sh). Treat that
# key as compromised.
#
# The same value has spread to every live checkout of this repo (main tree,
# sibling worktrees) plus editor-history snapshots, .agentwork/ copies and
# .bak files. Hand-editing that many places is how one gets missed and
# quietly keeps working with a revoked key — or worse, keeps a live one
# lying around. Mirrors rotate-r2-credentials.sh's approach; see that script
# for the fuller rationale. Mailgun is a single key, not a key+secret pair,
# so this is the same shape with one value instead of two.
#
# WHAT IT DOES
#   • finds every file under every git worktree holding the OLD key
#   • LIVE config (.env / .env.local)      → rewritten to the new value
#   • STALE copies (.history/, .agentwork/,
#     *.bak*, *-backup-*)                  → DELETED, not rewritten; they are
#                                            snapshots, and rewriting them just
#                                            preserves the sprawl
#   • verifies afterwards that the old value survives nowhere
#
# It is a DRY RUN unless you pass --apply. Nothing is printed but file paths,
# counts and a sha256 prefix.
#
# ORDER OF OPERATIONS (important)
#   1. Regenerate the key in Mailgun FIRST (Settings → API Keys → regenerate).
#      It has been public for months; the exposure outweighs the few minutes
#      of downtime on transactional email.
#   2. Run this to fix local checkouts.
#   3. Set the new value in the staging/production secret stores by hand —
#      this script deliberately does not touch deployed environments.
#
# USAGE
#   NEW_MAILGUN_API_KEY=...  scripts/dev/rotate-mailgun-credentials.sh            # dry run
#   NEW_MAILGUN_API_KEY=...  scripts/dev/rotate-mailgun-credentials.sh --apply
#
# Pass the value as an ENVIRONMENT VARIABLE, never as an argument: arguments
# land in your shell history and in the process list, where other users can
# read them.
set -euo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

if [ -z "${NEW_MAILGUN_API_KEY:-}" ]; then
  echo "error: set NEW_MAILGUN_API_KEY in the environment." >&2
  echo "       (as an env var, not an argument — arguments leak via history and ps)" >&2
  exit 2
fi

# The old value is read from a reference file rather than typed, so a typo
# cannot cause a partial, half-rotated tree.
REF="${OLD_REF_FILE:-$(git rev-parse --show-toplevel)/frontend-web/.env.local}"
if [ ! -f "$REF" ]; then
  echo "error: reference file not found: $REF" >&2
  echo "       set OLD_REF_FILE to a file still holding the OLD credential." >&2
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

new_key = os.environ['NEW_MAILGUN_API_KEY'].strip()

def read_var(path, name):
    for line in open(path, errors='ignore'):
        if line.startswith(name + '='):
            return line.split('=', 1)[1].strip()
    return None

old_key = read_var(ref, 'MAILGUN_API_KEY')
if not old_key:
    sys.exit(f'error: could not read old MAILGUN_API_KEY from {ref}')

def h(v): return hashlib.sha256(v.encode()).hexdigest()[:16]
print(f'old key  sha256 {h(old_key)}  ({len(old_key)} chars)')
print(f'new key  sha256 {h(new_key)}  ({len(new_key)} chars)')
if old_key == new_key:
    sys.exit('error: the new key is identical to the old one — nothing to rotate.')
if len(new_key) < 16:
    sys.exit(f'error: new key looks too short ({len(new_key)} chars); refusing.')
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
            if old_key not in body:
                continue
            seen.add(p)
            (stale if STALE.search(p) else live).append(p)

print(f'{len(live)} live config file(s) to rewrite:')
for p in sorted(live):  print('   ', p)
print(f'\n{len(stale)} stale copy/copies to DELETE:')
for p in sorted(stale): print('   ', p)

if not live and not stale:
    print('\nnothing holds the old credential — already rotated.')
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
    bdir = os.path.join(os.path.expanduser('~'), '.mailgun-rotation-backups', stamp)
    os.makedirs(bdir, exist_ok=True)
    shutil.copy2(p, os.path.join(bdir, p.replace(os.sep, '_').lstrip('_')))
    body = body.replace(old_key, new_key)
    open(p, 'w').write(body)
    os.chmod(p, 0o600)
    changed += 1
    print(f'  rewrote {p}')

removed = 0
for p in sorted(stale):
    os.remove(p)
    removed += 1
    print(f'  deleted {p}')

print(f'\nrewrote {changed}, deleted {removed}; backups in ~/.mailgun-rotation-backups/{stamp}')

# Verify: the old value must survive nowhere, and live files must carry the new.
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
            if old_key in body:
                leftover.append(p)

if leftover:
    print('\n  ⚠️ OLD CREDENTIAL STILL PRESENT IN:')
    for p in leftover: print('     ', p)
    sys.exit(1)

missing = [p for p in live if new_key not in open(p, errors='ignore').read()]
if missing:
    print('\n  ⚠️ NEW CREDENTIAL MISSING FROM:')
    for p in missing: print('     ', p)
    sys.exit(1)

print('\nverified: the old credential is gone from every env file; live files carry the new one.')
print('\nSTILL TO DO BY HAND:')
print('  • set the new value in the staging and production secret stores')
print('  • the leaked commits remain in history — rewriting or burning that')
print('    branch is a separate decision (old-origin/chore/launch-infra-foundations)')
PY
