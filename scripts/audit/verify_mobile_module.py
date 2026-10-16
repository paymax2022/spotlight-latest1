#!/usr/bin/env python3
"""Verify a mobile feature module against frontend-web route handlers.

usage: python3 scripts/audit/verify_mobile_module.py <repo-root> <feature-dir-name> [more feature dirs...]
  e.g. python3 scripts/audit/verify_mobile_module.py . announcements

For every api.<method>(...) call in the feature's TS files (outside components/mocks/tests):
  - resolves *_API_BASE style constants,
  - maps the URL to a route.ts under frontend-web/app/api/**,
  - checks the HTTP method is exported,
then reports the tables the matched handlers query (and whether migrations create them),
stub indicators, handlers with no DB access, and read-side traps in the client.

Used by docs/audit/MOBILE_SIMULATED_WRITES.md to decide whether a module's mock default can flip
to live.

CAVEATS - a match here only proves a *frontend-web* route file exists. A call that matches only the
app/api/v1/[...path] catch-all (shown as "CATCH-ALL") is proxied to the Go backend and is NOT proof
the route exists: check the Go routes yourself (backend/internal/**/handler.go; note estate routes
live under /api/finance/estate, not /api/v1/estate). It does not read response shapes, and it cannot
tell you whether a handler's authorization is right.
"""
import glob
import os
import re
import subprocess
import sys

if len(sys.argv) < 3:
    print(__doc__)
    sys.exit(2)

root = sys.argv[1]
features = sys.argv[2:]
feat_root = os.path.join(root, 'mobile-app/reactnative/src/features')
web_api = os.path.join(root, 'frontend-web/app/api')


def read(p):
    try:
        return open(p, errors='ignore').read()
    except OSError:
        return ''


# ---- collect client source
files = []
for f in features:
    for p in glob.glob(os.path.join(feat_root, f, '**/*.ts'), recursive=True):
        if '/components/' in p or p.endswith('.test.ts') or '.mock.' in p:
            continue
        files.append(p)
src = {p: read(p) for p in files}
alltext = '\n'.join(src.values())

# ---- constants: NAME = '/api/...'
consts = {}
for m in re.finditer(r"(?:export\s+)?const\s+(\w+)\s*=\s*([`'\"])(/api/[^`'\"]*)\2", alltext):
    consts[m.group(1)] = m.group(3)
for _ in range(3):  # constants built from other constants
    for m in re.finditer(r"(?:export\s+)?const\s+(\w+)\s*=\s*`([^`]*)`", alltext):
        v = m.group(2)
        for k, val in consts.items():
            v = v.replace('${%s}' % k, val)
        if v.startswith('/api/'):
            consts[m.group(1)] = v


def resolve(arg):
    arg = arg.strip()
    if arg and arg[0] in '`\'"':
        arg = arg[1:-1]
    elif arg in consts:
        arg = consts[arg]
    else:
        m = re.match(r"(\w+)\s*\+\s*[`'\"]([^`'\"]*)[`'\"]", arg)  # BASE + '/x'
        if m and m.group(1) in consts:
            arg = consts[m.group(1)] + m.group(2)
        else:
            return None
    for k, v in consts.items():
        arg = arg.replace('${%s}' % k, v)
    arg = re.sub(r"\$\{[^}]*\}", ':p', arg)
    return arg.split('?')[0]


calls = {}
call_re = (r"\bapi\.(get|post|put|patch|delete)(?:<[^()]*>)?\(\s*"
           r"(`[^`]*`|'[^']*'|\"[^\"]*\"|[\w.]+(?:\s*\+\s*[`'\"][^`'\"]*[`'\"])?)")
for p, s in src.items():
    for m in re.finditer(call_re, s):
        calls.setdefault((m.group(1).upper(), resolve(m.group(2))), os.path.relpath(p, feat_root))

# ---- routes
routes = {}
for f in glob.glob(web_api + '/**/route.ts', recursive=True):
    rel = '/api' + f[len(web_api):-len('/route.ts')]
    pat = re.sub(r"\[\.\.\.[^\]]+\]", ':rest', rel)
    pat = re.sub(r"\[[^\]]+\]", ':p', pat)
    text = read(f)
    meths = set(re.findall(r"export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b", text))
    meths |= set(re.findall(r"export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b", text))
    routes[pat] = (f, meths)


def match(url):
    """Return (pattern, via_catch_all). Exact/dynamic matches win over catch-alls."""
    best = None
    for pat in routes:
        a = pat.split('/')
        b = url.split('/')
        if ':rest' in a:
            i = a.index(':rest')
            if len(b) > i and all(x == y or x == ':p' or y == ':p' for x, y in zip(a[:i], b[:i])):
                if best is None:
                    best = (pat, True)
        elif len(a) == len(b) and all(x == y or x == ':p' or y == ':p' for x, y in zip(a, b)):
            return pat, False
    return best if best else (None, False)


print(f"features: {features}   files: {len(files)}   client calls: {len(calls)}")
missing = []
catch_all = []
handler_files = set()
for (meth, url), where in sorted(calls.items(), key=lambda x: (str(x[0][1]), x[0][0])):
    if url is None:
        print(f"UNRESOLVED {meth:6} (dynamic URL in {where})")
        missing.append((meth, url))
        continue
    pat, via_catch_all = match(url)
    if pat and via_catch_all:
        print(f"CATCH-ALL {meth:6} {url}   (proxied to Go - verify the Go route)")
        catch_all.append((meth, url))
        continue
    ok = bool(pat) and meth in routes[pat][1]
    if ok:
        handler_files.add(routes[pat][0])
    else:
        missing.append((meth, url))
    print(f"{'OK       ' if ok else 'MISSING  '} {meth:6} {url}")
print(f"\nTOTAL {len(calls)}  matched {len(calls) - len(missing) - len(catch_all)}  "
      f"catch-all-only {len(catch_all)}  missing {len(missing)}")

# ---- handler analysis
tables = {}
stubs = []
nodb = []
for f in sorted(handler_files):
    t = read(f)
    for m in re.finditer(r"\.from\(\s*['\"]([a-z_0-9]+)['\"]", t):
        tables[m.group(1)] = tables.get(m.group(1), 0) + 1
    if re.search(r"not implemented|TODO|stub|hard-?coded", t, re.I):
        stubs.append(os.path.relpath(f, root))
    if not re.search(r"\.from\(|\.rpc\(|[A-Za-z]+Service\.|svc\.|from '@/src/server", t):
        nodb.append(os.path.relpath(f, root))
svc = set()
for f in handler_files:
    for m in re.finditer(r"from '@/src/server/([^']+)'", read(f)):
        svc.add(m.group(1))
for s in svc:
    for p in glob.glob(os.path.join(root, 'frontend-web/src/server', s + '*')):
        if os.path.isfile(p):
            for m in re.finditer(r"\.from\(\s*['\"]([a-z_0-9]+)['\"]", read(p)):
                tables[m.group(1)] = tables.get(m.group(1), 0) + 1
print("\nstub indicators in matched handlers:", stubs or 'none')
print("matched handlers with no obvious DB/service access:", nodb or 'none')
print("\ntables queried -> created in migrations?")
for t in sorted(tables):
    r = subprocess.run(
        ['git', '-C', root, 'grep', '-liE', rf'create table( if not exists)? +(public\.)?"?{t}"?[ (]',
         '--', 'supabase/migrations'], capture_output=True, text=True).stdout.split()
    print(f"  {t:32} {'OK  ' + r[0].split('/')[-1] if r else 'NOT FOUND'}")

# ---- client read-side traps
print("\nclient read-side traps:")
n = 0
for p, s in src.items():
    for i, line in enumerate(s.splitlines(), 1):
        if re.search(r"if \(!USE_MOCK\) return|MISSING BACKEND|not wired|falls? back to (the )?mock|from the mock", line):
            print(f"  {os.path.relpath(p, feat_root)}:{i}: {line.strip()[:120]}")
            n += 1
if not n:
    print("  none")
w = [(m, u) for (m, u) in calls if m != 'GET']
print(f"\nclient write calls ({len(w)}):", ', '.join(f"{m} {u}" for m, u in sorted(w, key=str)))
