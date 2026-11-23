#!/usr/bin/env python3
"""Compare what the SAME credential can read through TWO clients.

WHY THIS EXISTS
Run 45171097305 (2026-11-23 12:07Z) put the two halves of the F2 story next to
each other and they disagreed:

  * `railway status --json` with each CI project token exited 0 and returned
    43,753 / 52,349 / 36,979 bytes of parseable JSON, while the credential-less
    control failed. The tokens are real, valid, and authorizing.
  * `f2-token-probe.sh` with `PROBE_TRANSPORT=curl`, the very same runner, POSTed
    `query($p:String!){ project(id:$p){ id name } }` to
    `https://backboard.railway.com/graphql/v2` with `Authorization: Bearer` and
    got HTTP 200 + `Not Authorized` — nine out of nine, for every project token,
    and for the token-less control too.

The class verdict's rule read that as **CLASS**: "all three tokens 0/3". But an
all-refused set that the control matches is only evidence about the credential if
the request itself is capable of authenticating. So one cell was measured on the
laptop first, with the owner's user token, whose authority is not in question
(2026-11-23, same document, same endpoint, `User-Agent` set like curl's):

    Authorization: Bearer <token>   http=200  name=spotlight-platform
    X-Railway-Token: <token>        http=200  errors=['Not Authorized']
    no credential at all            http=200  errors=['Not Authorized']

`Authorization: Bearer` is therefore the working surface and `Not Authorized` is
precisely what an unauthenticated call looks like there. That does not clear the
project tokens either — it means the runner's refusal says something about the
credential, but WHICH something (a class-wide GraphQL ban, or a scope that only
covers the CLI's own queries) can still not be told apart from a curl-only table.

The discriminator is the client, not the credential: `railway api` sends the
identical document with the identical token in its environment, and it demonstrably
works — locally it resolves BOTH documents the sampler uses, including from a
directory with no `railway link` at all (`link_state=no-config` in the runner is
therefore not a blocker). Only a runner holds a project token, so this file reads
both cell sets and renders the one line the release wall needs:

  curl refused + cli refused  → the credential class really is the variable. No CI
                                script change can obtain the ids or reach the
                                mutation; the ask goes to Railway for a scope grant,
                                and owner-side sha promotion stays the staging path.
  curl refused + cli ok       → the sampler, not the token. The CLASS sentence is
                                void, and the mutation cell becomes re-measurable
                                with PROBE_TRANSPORT=cli.

Like ``f2-status-verdict.py`` this file only compares cells that already exist.
The verdict WORDS come from ``f2-probe-verdict.py read`` via
``scripts/ci/f2-token-probe.sh``, so the taxonomy stays in one place, and the rules
live here rather than in a workflow heredoc so
``scripts/ci/test-f2-token-probe.sh`` can drive them from recorded shapes.

Usage:
    f2-transport-verdict.py --curl-glob "/tmp/class-*.txt" \
                            --cli-glob  "/tmp/cli-*.txt" [--out FILE]

Both globs are QUOTED at the call site. Run 45024735432 died when an unquoted
`--glob /tmp/class-*.txt` expanded into a dozen words and argparse swallowed the
first as the pattern, so an already-expanded argument list has to reach the same
answer as a quoted pattern — which is what the offline test asserts.
"""
import glob
import os
import re
import sys
from collections import defaultdict

ORDER = ("anonymous", "development", "staging", "production")
TOKENS = ("development", "staging", "production")

# Body-level verdicts that mean "this credential was not allowed to read this
# field", as opposed to "the call never got an answer". Invented here, kept short,
# and matched only against words f2-probe-verdict.py actually emits.
REFUSED = ("token-rejected", "token-not-permitted")
# Words that mean "this call did not produce an answer about the credential".
# `body-undecodable` is F2's own fingerprint (measured 2026-11-22 on job
# 137230172408: the identical sentence, on a read that contains no archive and
# no upload), and a table of them cannot be allowed to resolve to CLASS: the
# sampler's old text reasoned "no `Not Authorized` in it, so not an auth
# failure", which is precisely how a decode fault hides inside a credential
# probe. The prefixes cover classify_read()'s status-shaped f-strings.
SILENCE = ("body-undecodable", "query-error", "no-output")
SILENCE_PREFIX = ("transport-error", "edge-rejected")
# Everything classify_read() can print. A value outside this set is a new
# observation and must not be folded into either bucket.
KNOWN = set(REFUSED) | {
    "ok", "body-undecodable", "query-error", "no-output",
    "transport-error-no-response",
}
AUTH_KEYS = ("auth", "baseline")

# Railway's credential prefixes. Nothing in this table should ever contain one,
# and the CLI's own sentences are echoed into $GITHUB_STEP_SUMMARY, so the
# guarantee is made here instead of trusting three files away. Same reasoning as
# f2-status-verdict.py's sanitize().
SECRET_RE = re.compile(r"\b(ra_|rlwy_|pv-|rt-)[A-Za-z0-9_\-]{6,}")


def sanitize(text):
    return SECRET_RE.sub(r"\1[redacted]", text or "")


def cell(text, key):
    hits = re.findall(r"PROBE_CELL %s=(\S+)" % key, text)
    return hits[-1] if hits else "no-output"


def label_from(path, prefixes=("class-", "cli-")):
    name = os.path.basename(path)
    for pref in prefixes:
        if name.startswith(pref):
            name = name[len(pref):]
            break
    if name.endswith(".txt"):
        name = name[:-4]
    label, _, attempt = name.rpartition("-")
    if label and attempt.isdigit():
        return label
    return name


def read_set(words):
    """Return {label: [[auth, baseline], …]} from probe transcripts.

    `words` is whatever the caller collected for one side: a quoted glob pattern,
    or the files a shell expanded from it. Both spellings have to reach the same
    answer (run 45024735432 died on exactly this distinction in the class
    verdict), so a word that is not a pattern is treated as a path.
    """
    paths = []
    for w in words:
        hits = glob.glob(w)
        paths += hits if hits else [w]
    found = defaultdict(list)
    for path in sorted(set(paths)):
        try:
            txt = open(path, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        label = label_from(path)
        if not label:
            continue
        found[label].append([cell(txt, k) for k in AUTH_KEYS])
    return dict(found)


def collapse(rows):
    """Summarise N attempts for one credential as (verdict, agreement)."""
    if not rows:
        return None
    firsts = [r[0] for r in rows]
    common = max(set(firsts), key=firsts.count)
    agree = "%d/%d %s" % (firsts.count(common), len(firsts), common)
    return {"auth": common, "baseline": rows[-1][1], "agree": agree, "n": len(rows)}


def classify_token(curl, cli):
    """One credential's reading, or None when a side has no cell to compare."""
    if curl is None or cli is None:
        return None
    return curl["auth"], cli["auth"]


def is_refused(v):
    return v in REFUSED


def is_ok(v):
    return v == "ok"


def unknown(v):
    # A word classify_read() can emit but that is not an answer about a
    # credential: the call either got no body at all, or a body no client could
    # parse. `body-undecodable` is the F2 fingerprint itself, seen from a read,
    # and a table of those must not be allowed to resolve to CLASS — the old
    # sampler said "no `Not Authorized` text, so not a token problem", which is
    # exactly how a decode fault hides inside a credential probe.
    return v in SILENCE or v.startswith(SILENCE_PREFIX) or v not in KNOWN


def verdict_line(per_token, anon_curl, anon_cli):
    """One paragraph: what the two tables mean together, or why they say nothing."""
    missing = [k for k in TOKENS if per_token[k] is None]
    if missing:
        return ("- **The comparison is not available.** No CLI-transport cell (or "
                "no curl cell) arrived for %s, so this table cannot separate the "
                "credential class from the sampler's own transport. Re-dispatch; "
                "an unmeasured cell is not a passing cell.\n" % ", ".join(missing))

    refused_curl = [k for k in TOKENS if is_refused(per_token[k][0])]
    refused_cli = [k for k in TOKENS if is_refused(per_token[k][1])]
    ok_curl = [k for k in TOKENS if is_ok(per_token[k][0])]
    ok_cli = [k for k in TOKENS if is_ok(per_token[k][1])]

    if is_ok(anon_cli or "") or is_ok(anon_curl or ""):
        side = "CLI" if is_ok(anon_cli or "") else "curl"
        return ("- **CONTROL BROKEN** — the credential-less call resolved a "
                "credential-only field through the %s client, so an `ok` row here "
                "is not evidence about tokens. Read the raw cells; do not act on "
                "the table.\n" % side)

    unknowns = sorted({v for k in TOKENS for v in per_token[k] if unknown(v)})
    if unknowns:
        return ("- Cells came back in shapes outside the taxonomy (`%s`). That is a "
                "new observation, not a verdict — and a `body-undecodable` on the "
                "CLI side is the F2 fingerprint seen from a read, which is worth "
                "its own look before anything is concluded.\n" % ", ".join(unknowns))

    complete_curl = len(refused_curl) == len(TOKENS)
    if complete_curl and len(refused_cli) == len(TOKENS):
        return ("- **Class, confirmed across both clients.** Every CI project "
                "token is refused `project(id)` and `serviceInstance` through raw "
                "curl AND through `railway api`, while the same tokens decode "
                "`railway status --json`. The token authenticates; the GraphQL "
                "surface it is allowed to ask about does not include the fields "
                "that resolve a deployment target. So the sampler was not the "
                "broken instrument, no CI script change can obtain the ids, and "
                "the mutation lane stays shut until Railway grants project tokens "
                "that scope. Owner-side sha-pinned `serviceInstanceDeploy` remains "
                "the staging path.\n")

    if complete_curl and len(ok_cli) == len(TOKENS):
        return ("- **The sampler, not the token.** The identical document, with the "
                "identical token, resolves through `railway api` and is refused "
                "through the raw curl call — so the earlier `Verdict: CLASS` was "
                "read from a request that could not authenticate on that surface. "
                "Retire the CLASS sentence, and re-measure the mutation cell with "
                "`PROBE_TRANSPORT=cli`: CI can probably obtain the ids and call "
                "`serviceInstanceDeploy` after all, which moves the release wall.\n")

    if ok_curl and ok_cli and len(ok_curl) == len(TOKENS):
        return ("- Both transports authenticate for all three project tokens. That "
                "contradicts 12:07Z's all-refused curl set, so something changed "
                "between runs (secret rotation, or an edge state) — re-read the "
                "raw bodies before repeating any class claim.\n")

    parts = []
    for k in TOKENS:
        cv, kv = per_token[k]
        if cv != kv:
            parts.append("`%s`: curl `%s` vs cli `%s`" % (k, cv, kv))
    same = [k for k in TOKENS if per_token[k][0] == per_token[k][1]]
    if parts:
        agreement = ("while %s behave identically on both clients"
                     % ", ".join("`%s`" % s for s in same) if same
                     else "and no credential behaves identically on both clients")
        return ("- **Per-credential, not per-class:** the two clients disagree for "
                "%s, %s. The variable is each secret's own scope or value, so the "
                "fix is scoped to those credentials and is not a blanket statement "
                "about project tokens.\n" % ("; ".join(parts), agreement))
    return ("- All three tokens answered the same way on both clients, but not in "
            "any shape the rules above cover (`%s` on curl, `%s` on cli). The table "
            "is the result; do not act on a summary line that had to guess.\n"
            % (", ".join(per_token[k][0] for k in TOKENS),
               ", ".join(per_token[k][1] for k in TOKENS)))


def render(curl_set, cli_set, out):
    out.write("## Transport x credential (same document, two clients)\n\n")
    anon_curl = collapse(curl_set.get("anonymous") or [])
    anon_cli = collapse(cli_set.get("anonymous") or [])
    per_token = {k: classify_token(collapse(curl_set.get(k) or []),
                                   collapse(cli_set.get(k) or []))
                 for k in TOKENS}

    if not curl_set and not cli_set:
        out.write("\n**No cells at all.** Neither the curl steps nor the CLI steps "
                  "wrote a transcript, so nothing was measured. Check the `Install "
                  "the pinned Railway CLI` step and `PROBE_TRANSPORT`.\n")
        return

    out.write("| credential | curl `auth` | curl `baseline` | cli `auth` | cli `baseline` |\n")
    out.write("|---|---|---|---|---|\n")
    labels = list(ORDER)
    labels += sorted((set(curl_set) | set(cli_set)) - set(ORDER))
    for label in labels:
        c = collapse(curl_set.get(label) or []) if curl_set else None
        k = collapse(cli_set.get(label) or []) if label in cli_set else None
        if label == "anonymous" and c is None and k is None:
            continue
        row = [label]
        for side, src in (("curl", c), ("cli", k)):
            if src is None:
                if side == "curl":
                    row += ["**cell missing**", "-"]
                else:
                    row += ["-", "**cell missing**"]
            elif side == "curl":
                row += [sanitize(src["agree"]), sanitize(src["baseline"])]
            else:
                row += [sanitize(src["auth"]), sanitize(src["baseline"])]
        out.write("| " + " | ".join(row) + " |\n")

    out.write("\n> curl = `POST https://backboard.railway.com/graphql/v2` with "
              "`Authorization: Bearer`. Verified against a credential of known "
              "authority on 2026-11-23: that header resolves `project(id)`, while "
              "`X-Railway-Token` and no credential at all both come back "
              "`Not Authorized`.\n"
              "> cli = the same document through `railway api`, which reads "
              "`RAILWAY_TOKEN` from the environment and needs no `railway link`.\n")

    out.write("\n" + verdict_line(per_token,
                                  (anon_curl or {}).get("auth"),
                                  (anon_cli or {}).get("auth")))


def grab(argv, flag):
    """Return (words_for_that_flag, rest_of_argv), tolerating both spellings.

    Quoted, the workflow hands over one word: an unexpanded glob pattern.
    Unquoted, the runner's shell hands over every file the pattern matched.
    `read_set` resolves either, because a word that matches nothing is treated
    as a path — which is what run 45024735432 needed and did not get.
    """
    if flag not in argv:
        return [], argv
    i = argv.index(flag)
    words = [argv[i + 1]] if i + 1 < len(argv) else []
    j = i + 2
    while j < len(argv) and not argv[j].startswith("--"):
        words.append(argv[j])
        j += 1
    return words, argv[:i] + argv[j:]


def main(argv):
    args = list(argv)
    out_path = None
    if "--out" in args:
        i = args.index("--out")
        out_path = args[i + 1]
        del args[i:i + 2]
    curl_words, args = grab(args, "--curl-glob")
    cli_words, args = grab(args, "--cli-glob")
    sink = open(out_path, "w") if out_path else sys.stdout
    render(read_set(curl_words), read_set(cli_words), sink)
    if out_path:
        sink.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
