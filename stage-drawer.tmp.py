import subprocess, sys, re

ROOT = '/Users/paymax/Documents/spotlight/main'

def sh(*args, **kw):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, **kw)

def stage_whole(paths):
    r = sh('git', 'add', '--', *paths)
    if r.returncode:
        sys.exit('git add failed: ' + r.stderr)

def stage_hunks(path, drop_if):
    diff = sh('git', 'diff', '--', path).stdout
    if not diff.strip():
        print(f'  (no diff for {path})')
        return 0
    lines = diff.splitlines(keepends=True)
    header, hunks, cur = [], [], None
    for ln in lines:
        if ln.startswith('@@'):
            if cur: hunks.append(cur)
            cur = [ln]
        elif cur is not None:
            cur.append(ln)
        else:
            header.append(ln)
    if cur: hunks.append(cur)

    kept, dropped = [], []
    for h in hunks:
        body = ''.join(h)
        (dropped if any(k in body for k in drop_if) else kept).append(body)

    print(f'  {path}: {len(kept)} hunks staged, {len(dropped)} left for their author')
    for d in dropped:
        print('     dropped ->', d.splitlines()[0], '|', next((l.strip() for l in d.splitlines()[1:] if l.startswith(('+','-'))), '')[:78])
    if not kept:
        sys.exit(f'refusing to stage nothing for {path}')

    patch = ''.join(header) + ''.join(kept)
    r = sh('git', 'apply', '--cached', '--recount', '--unified=3', '-', input=patch)
    if r.returncode:
        sys.exit('git apply --cached failed for ' + path + ': ' + r.stderr)
    return len(dropped)

MINE_WHOLE = [
    'frontend-web/app/service-details/film-academy/ApplyDrawer.tsx',
    'frontend-web/app/service-details/film-academy/ApplyForm.tsx',
    'frontend-web/app/service-details/film-academy/apply.module.css',
    'frontend-web/app/service-details/film-academy/AreaExplorer.tsx',
    'frontend-web/app/service-details/film-academy/TuitionPlanner.tsx',
    'frontend-web/app/film-academy/apply/page.tsx',
    'frontend-web/app/apply/film-academy/page.tsx',
]
stage_whole(MINE_WHOLE)
print('staged 7 files wholesale')

stage_hunks('frontend-web/app/service-details/film-academy/page.tsx',
            drop_if=['Illustrative image'])
stage_hunks('frontend-web/app/service-details/film-academy/academy.module.css',
            drop_if=['Price your training", "Choose a', '.viewfinder small'])
