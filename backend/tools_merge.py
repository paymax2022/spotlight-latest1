#!/usr/bin/env python3
"""Go helpers:
  merge.py merge target.go src1.go [src2.go ...]  — union imports, concat decls
  merge.py sortimports file.go [file.go ...]      — group+sort the import block
"""
import re
import sys

IMPORT_BLOCK = re.compile(r'import\s*\(\s*\n(.*?)\n\)', re.S)
IMPORT_SINGLE = re.compile(r'^import\s+((?:[\w\.]+\s+)?"[^"]+")\s*$', re.M)


def parse(text):
    m = re.search(r'^package\s+\w+\s*\n', text, re.M)
    head = text[:m.end()]
    rest = text[m.end():]
    imports = []
    bm = IMPORT_BLOCK.search(rest)
    if bm:
        for line in bm.group(1).splitlines():
            if line.strip():
                imports.append(line.rstrip())
        body = rest[:bm.start()] + rest[bm.end():]
    else:
        sm = IMPORT_SINGLE.search(rest)
        if sm:
            imports = [sm.group(1)]
            body = rest[:sm.start()] + rest[sm.end():]
        else:
            body = rest
    return head, imports, body.strip('\n')


def is_std(spec):
    # spec like `"fmt"` or `name "path"` or `. "path"` or `_ "path"`
    m = re.search(r'"([^"]+)"', spec)
    if not m:
        return False
    path = m.group(1)
    return '.' not in path.split('/')[0]


def spec_key(spec):
    m = re.search(r'"([^"]+)"', spec)
    return m.group(1) if m else spec


def render_imports(imports):
    seen = {}
    for i in imports:
        i = i.strip()
        if not i:
            continue
        seen[spec_key(i)] = i  # last wins; identical paths merge
    std = sorted(v for k, v in seen.items() if is_std(v))
    ext = sorted(v for k, v in seen.items() if not is_std(v))
    lines = ['import (']
    for i in std:
        lines.append('\t' + i)
    if std and ext:
        lines.append('')
    for i in ext:
        lines.append('\t' + i)
    lines.append(')')
    return '\n'.join(lines)


def cmd_merge(target, sources):
    thead, timps, tbody = parse(open(target).read())
    allimps = list(timps)
    bodies_src = []
    for s in sources:
        _, imps, sbody = parse(open(s).read())
        allimps.extend(imps)
        bodies_src.append(sbody)
    out = thead + '\n' + render_imports(allimps) + '\n\n' + tbody
    for b in bodies_src:
        out += '\n\n' + b
    open(target, 'w').write(out + '\n')


def cmd_sort(paths):
    for p in paths:
        head, imps, body = parse(open(p).read())
        if not imps:
            continue
        open(p, 'w').write(head + '\n' + render_imports(imps) + '\n\n' + body + '\n')


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'merge':
        cmd_merge(sys.argv[2], sys.argv[3:])
    elif cmd == 'sortimports':
        cmd_sort(sys.argv[2:])
