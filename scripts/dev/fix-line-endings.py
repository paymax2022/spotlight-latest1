"""Restore a file's original line endings after an editor normalised the whole file.

Usage:
    git show HEAD:path/to/File.js > /tmp/head.js
    python3 scripts/dev/fix-line-endings.py path/to/File.js /tmp/head.js

Unchanged lines are copied byte-for-byte from the HEAD copy and only inserted or
replaced lines take CRLF, so a one-line edit stays a one-line diff.
"""

import difflib
import sys

path, head_path = sys.argv[1], sys.argv[2]


def lines(p):
    with open(p, 'rb') as f:
        data = f.read()
    return data.splitlines(keepends=True)


head = lines(head_path)
cur = lines(path)


def content(l):
    return l.rstrip(b'\r\n')


sm = difflib.SequenceMatcher(a=[content(l) for l in head], b=[content(l) for l in cur])
out = []
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag == 'equal':
        out.extend(head[i1:i2])          # keep the original bytes, ending and all
    elif tag == 'delete':
        pass
    else:                                # insert / replace: new lines take CRLF
        for l in cur[j1:j2]:
            out.append(content(l) + b'\r\n')

with open(path, 'wb') as f:
    f.write(b''.join(out))
print('rewrote', path)
