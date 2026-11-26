#!/usr/bin/env python3
"""Render the status-decode cells into one comparison table and one verdict line.

Split out of ``ci-railway-token-class.yml`` for the same reason
``f2-token-class-verdict.py`` was: a rule that lives in a workflow heredoc can
only ever be exercised on a runner that holds three live credentials, and this
job's entire output is a choice between four explanations. Here the cells are
text files, so ``scripts/ci/test-f2-token-probe.sh`` can feed it recorded
shapes — including the shape that must NOT read as a clean bill of health: a
run whose third credential cell never arrived, which would otherwise look like
"the tokens behave" because nothing refused.

It does not classify. Every verdict word comes from
``scripts/ci/f2-probe-verdict.py status``; this file only compares cells that
already exist, so the taxonomy stays in one place.
"""
import glob
import re
import sys

ORDER = ("anonymous", "development", "staging", "production")
# The three cells the question is actually about. `anonymous` is the control,
# and a conclusion about credentials requires all three of these to have run.
REQUIRED = ("development", "staging", "production")
CELL_RE = re.compile(r"^STATUS_CELL (\w+)=(.*)$")
BEGIN_RE = re.compile(r"^STATUS_CELL_BEGIN label=(\S+)")
# The probe puts four fields on one line (`cli=… rc=… bytes=… verdict=…`), so a
# single-key regex reads that whole line as the value of `cli` and reports every
# cell as `verdict=missing` — which this file's own rules then call "shapes
# outside the taxonomy". Split every cell line into its pairs.
PAIR_RE = re.compile(r"(\w+)=([^\s]+)")
# Fields whose value legitimately contains spaces (the CLI's own sentence).
REST_KEYS = ("first", "caveat")


def parse_cell_line(line):
    """Return [(key, value)] for one `STATUS_CELL …` line, [] if not one."""
    stripped = line.strip()
    if not stripped.startswith("STATUS_CELL "):
        return []
    body = stripped[len("STATUS_CELL "):]
    for key in REST_KEYS:
        if body.startswith(key + "="):
            return [(key, body[len(key) + 1:].strip())]
    return [(k, v) for k, v in PAIR_RE.findall(body)]


# Railway's credential prefixes. The probe reads them from nowhere, and its
# `first=` field is a line of the CLI's own stderr, which should never contain
# one -- but this summary lands in $GITHUB_STEP_SUMMARY, visible to everyone
# who can read the run, so the guarantee is made here rather than trusted three
# files away. Same reasoning as f2-status-probe.sh's `masked=yes` banner.
SECRET_RE = re.compile(r"\b(ra_|rlwy_|pv-|rt-)[A-Za-z0-9_\-]{6,}")


def sanitize(text):
    """Neutralise anything shaped like a Railway token before it is written."""
    return SECRET_RE.sub(r"\1[redacted]", text or "")


def read_cells(paths):
    """Return {label: {field: value}} for status-probe transcripts."""
    cells = {}
    for path in paths:
        label = None
        fields = {}
        try:
            lines = open(path, errors="replace").read().splitlines()
        except OSError:
            continue
        for line in lines:
            m = BEGIN_RE.match(line)
            if m:
                label = m.group(1)
            for key, value in parse_cell_line(line):
                fields[key] = value
        if label:
            cells[label] = fields
    return cells


def _split(tokens):
    """Bucket token verdicts into (decoded, refused, other)."""
    decoded = sorted(k for k, v in tokens.items() if v.startswith("decoded"))
    refused = sorted(k for k, v in tokens.items() if v == "decode-refused")
    other = sorted(set(tokens) - set(decoded) - set(refused))
    return decoded, refused, other


def _coverage_note(missing):
    if not missing:
        return ""
    return ("\n> **Coverage:** no cell arrived for %s, so this table cannot "
            "generalise about CI credentials — the rows that did arrive are the "
            "only evidence.\n" % ", ".join(missing))


def _control_caveat(anon, decoded):
    """The control row is only broken when it agrees with the refusal."""
    if anon == "decode-refused" and decoded:
        return ("\n> **CONTROL BROKEN** - the credential-less call was refused "
                "with the same words this probe attributes to credentials, so "
                "`decode-refused` is not evidence about tokens in this run. "
                "The rows that decoded still stand; the refusal rows do not.\n")
    return ""


def verdict_line(cells):
    """One markdown paragraph: what the table means, or why it says nothing."""
    anon = (cells.get("anonymous") or {}).get("verdict")
    tokens = {k: v.get("verdict", "missing") for k in REQUIRED
              for v in [cells.get(k) or {}] if k in cells}
    missing = [k for k in REQUIRED if k not in cells]
    if not tokens:
        return ("- **No token cells were collected.** The four `status decode - "
                "*` steps produced nothing, so nothing here measures anything. "
                "Check the `Install the pinned Railway CLI` step first.\n")
    decoded, refused, other = _split(tokens)
    complete = not missing

    if complete and len(refused) == len(REQUIRED):
        # The headline the support thread has been missing, and it does not need
        # the control to be discriminating: with a project token in a runner, a
        # plain read returns the same undecodable body that an upload does.
        note = ""
        if anon == "decode-refused":
            note = ("\n> The credential-less control refused identically, so this "
                    "run cannot separate the project-token class from an "
                    "edge-wide fault on runners. It still proves F2 is not "
                    "upload-specific.\n")
        elif anon == "decoded":
            note = ("\n> The credential-less control decoded, so the refusal is "
                    "specific to calling with a project token.\n")
        return ("- F2 reproduces on a plain read for **every** CI credential, "
                "including development's, whose upload legs are green. Not the "
                "upload endpoint, not staging's data: the support thread gets a "
                "two-line repro.\n" + note)

    if complete and refused == ["staging"] and decoded == ["development", "production"]:
        return ("- Only staging refuses to decode while the other project "
                "tokens decode. The variable is staging's environment payload, "
                "not the credential class — which re-opens the rotate-the-"
                "secret option this probe was written to retire.\n" + _control_caveat(anon, decoded))

    if complete and len(decoded) == len(REQUIRED):
        return ("- Every CI credential decoded `railway status --json` inside a "
                "runner. F2 stays confined to the upload request path after "
                "all, and the pre-flight deaths in ops-railway-upload.yml must "
                "be re-read as a different fault (link state first: that step "
                "runs before any `railway link`).\n" + _control_caveat(anon, decoded))

    if anon == "decode-refused" and decoded:
        # Only reachable on an incomplete run: a full set where some tokens
        # decode and the control refuses is the two branches above.
        return ("- **CONTROL BROKEN** — the credential-less call was refused in "
                "the same words this probe attributes to credentials, while "
                "some credential cells decoded. Read the raw cells; do not act "
                "on the table.\n")

    if refused and not complete:
        return ("- Some credentials were refused the undecodable body "
                "(`%s`), but %s never answered, so neither the class fault nor "
                "the staging-only reading is available. Re-dispatch.\n"
                % (", ".join(refused), ", ".join(missing)))

    if missing and not refused:
        # The dangerous direction: three decoded rows and one absent row reads,
        # at a glance, like "the tokens behave". An unmeasured cell is not a
        # passing cell, so this branch exists to keep the clean sentence
        # unreachable without all three credentials.
        return ("- The credentials that answered all decoded, but %s never "
                "answered. The clean reading is not available: an unmeasured "
                "cell is not a passing cell.\n" % ", ".join(missing) + _control_caveat(anon, decoded))

    if other and not refused:
        return ("- No decode refusal anywhere, but cells came back in shapes "
                "outside the taxonomy (`%s`). That is a new observation, not a "
                "clean run.\n" % ", ".join(other) + _control_caveat(anon, decoded))

    return ("- Mixed shapes: no rule covers this combination. The table is the "
            "result; do not act on a summary line that had to guess.\n" + _control_caveat(anon, decoded))


def render(cells, out):
    out.write("## Status decode verdict (pinned CLI, `railway status --json`)\n\n")
    if not cells:
        # A run that collects nothing because the install step died is the
        # failure mode this job most needs to catch, so it gets its own line
        # rather than an empty table a reader could mistake for agreement.
        out.write("\n**No status cells were collected.** Check the "
                  "`Install the pinned Railway CLI` step and the four "
                  "`status decode - *` steps — an empty table here means the "
                  "probe never ran, not that the CLI behaved.\n")
        return
    out.write("| credential | token | rc | bytes | CLI | verdict | CLI's first line |\n")
    out.write("|---|---|---|---|---|---|---|\n")
    # A step that crashed before its `tee` wrote leaves no file. Rendered from
    # three rows, a four-row comparison reads like a four-row result, so the gap
    # has to be visible as a row.
    labels = list(ORDER)
    labels += sorted(set(cells) - set(ORDER))
    for label in labels:
        c = cells.get(label)
        if c is None:
            out.write(f"| {label} | - | - | - | - | **cell missing** | - |\n")
            continue
        first = sanitize(c.get("first") or "-").replace("|", "\\|")
        out.write("| {} | {} | {} | {} | {} | `{}` | {} |\n".format(
            label, c.get("credential", "?"), c.get("rc", "?"),
            c.get("bytes", "?"), c.get("cli", "?"),
            c.get("verdict", "missing"), first))
    for label in sorted(cells):
        caveat = cells[label].get("caveat")
        if caveat:
            out.write(f"\n> `{label}` caveat: {sanitize(caveat)}\n")
    out.write("\n" + verdict_line(cells))
    note = _coverage_note([k for k in REQUIRED if k not in cells])
    if note:
        out.write(note)


class Sink:
    """Write to a path, or to stdout when no --out is given."""

    def __init__(self, path):
        self.fh = open(path, "w") if path else None

    def write(self, s):
        if self.fh:
            self.fh.write(s)
        else:
            sys.stdout.write(s)

    def close(self):
        if self.fh:
            self.fh.close()


def main(argv):
    args = list(argv)
    out_path = None
    if "--out" in args:
        i = args.index("--out")
        out_path = args[i + 1]
        del args[i:i + 2]
    if args and args[0] == "--glob":
        # QUOTED in the workflow. Sort so the table order is stable and so a
        # quoted glob and an already-expanded argument list agree.
        paths = sorted(glob.glob(args[1]))
    else:
        # Backstop: tolerate the expanded spelling, because the class verdict
        # (run 45024735432) died exactly there when its glob expanded.
        paths = [a for a in args if not a.startswith("--")]
    sink = Sink(out_path)
    render(read_cells(paths), sink)
    sink.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
