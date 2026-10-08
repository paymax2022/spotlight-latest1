#!/usr/bin/env python3
"""build-inventory.py — machine-build the e2e screen/route inventory CSVs.

Read-only on source. Writes:
  docs/e2e/inventory-web-screens.csv
  docs/e2e/inventory-admin-screens.csv
  docs/e2e/inventory-mobile-screens.csv
  docs/e2e/screen-api-map.csv

Re-run any time: python3 scripts/e2e/build-inventory.py
"""
import os
import re
import csv
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, "docs", "e2e")
os.makedirs(OUT, exist_ok=True)

PAGE_RE = re.compile(r"^page\.(tsx|ts|jsx|js)$")
SEG_GROUP_RE = re.compile(r"^\(.*\)$")          # (group) route segments
SEG_DYN_RE = re.compile(r"^\[.+\]$")            # [param] / [...catchall]
LOAD_ERR_RE = {"loading": re.compile(r"^loading\.(tsx|ts|jsx|js)$"),
               "error":   re.compile(r"^error\.(tsx|ts|jsx|js)$")}


def rel(p):
    return os.path.relpath(p, REPO)


def route_from_page(app_dir, page_path):
    """app/.../x/page.tsx -> /x  (route groups stripped from URL)"""
    d = os.path.dirname(page_path)
    rel_d = os.path.relpath(d, app_dir)
    if rel_d == ".":
        return "/"
    segs = [s for s in rel_d.split(os.sep) if not SEG_GROUP_RE.match(s)]
    return "/" + "/".join(segs) if segs else "/"


def group_of(app_dir, page_path):
    """First route group, else first URL segment, else '(root)'."""
    d = os.path.dirname(page_path)
    rel_d = os.path.relpath(d, app_dir)
    if rel_d == ".":
        return "(root)"
    for s in rel_d.split(os.sep):
        if SEG_GROUP_RE.match(s):
            return s
    for s in rel_d.split(os.sep):
        if not SEG_GROUP_RE.match(s):
            return s
    return "(root)"


def sibling_state(page_path, kind):
    d = os.path.dirname(page_path)
    try:
        for f in os.listdir(d):
            if LOAD_ERR_RE[kind].match(f):
                return "yes"
    except OSError:
        pass
    return "no"


def is_dynamic(app_dir, page_path):
    d = os.path.dirname(page_path)
    rel_d = os.path.relpath(d, app_dir)
    if rel_d == ".":
        return "no"
    return "yes" if any(SEG_DYN_RE.match(s) for s in rel_d.split(os.sep)) else "no"


def find_pages(app_dir):
    out = []
    for root, _dirs, files in os.walk(app_dir):
        for f in files:
            if PAGE_RE.match(f):
                out.append(os.path.join(root, f))
    return sorted(out)


def write_web_like(app_dir, csv_name):
    rows = []
    for p in find_pages(app_dir):
        rows.append([
            route_from_page(app_dir, p),
            rel(p),
            group_of(app_dir, p),
            sibling_state(p, "loading"),
            sibling_state(p, "error"),
            is_dynamic(app_dir, p),
        ])
    rows.sort(key=lambda r: r[0])
    with open(os.path.join(OUT, csv_name), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["route_path", "file", "layout_group",
                    "has_loading_state", "has_error_state", "dynamic"])
        w.writerows(rows)
    return rows


# ---------------- mobile ----------------

def mobile_rows():
    rows = []
    rn = os.path.join(REPO, "mobile-app", "reactnative")
    app_dir = os.path.join(rn, "app")
    if os.path.isdir(app_dir):
        for root, _dirs, files in os.walk(app_dir):
            for f in sorted(files):
                if not f.endswith((".tsx", ".ts", ".jsx", ".js")):
                    continue
                if f == "_layout.tsx" or f == "+html.tsx":
                    continue  # layouts / html shell are not screens
                p = os.path.join(root, f)
                rel_d = os.path.relpath(root, app_dir)
                segs = [] if rel_d == "." else [
                    s for s in rel_d.split(os.sep) if not SEG_GROUP_RE.match(s)]
                stem = re.sub(r"\.(tsx|ts|jsx|js)$", "", f)
                if stem == "index":
                    name = "/" + "/".join(segs)
                    name = name if name != "/" else "/"
                else:
                    name = "/" + "/".join(segs + [stem])
                rows.append(["reactnative", name or "/", rel(p)])
    # src/features/**/screens/*.tsx — supporting screen components
    src = os.path.join(rn, "src")
    if os.path.isdir(src):
        for root, _dirs, files in os.walk(src):
            if os.path.basename(root) != "screens":
                continue
            for f in sorted(files):
                if f.endswith((".tsx", ".jsx")):
                    p = os.path.join(root, f)
                    rows.append(["reactnative-src",
                                 re.sub(r"\.(tsx|jsx)$", "", f), rel(p)])
    # vue-quasar: scaffold-only (no src/) — record that fact as a comment row
    # so the CSV documents coverage rather than silently omitting the app.
    vq = os.path.join(REPO, "mobile-app", "vue-quasar")
    if os.path.isdir(vq):
        vq_src = os.path.join(vq, "src")
        if os.path.isdir(vq_src):
            for root, _dirs, files in os.walk(vq_src):
                for f in sorted(files):
                    if f.endswith(".vue"):
                        rows.append(["vue-quasar",
                                     re.sub(r"\.vue$", "", f),
                                     rel(os.path.join(root, f))])
        else:
            rows.append(["vue-quasar",
                         "(none — scaffold only, no src/ directory)",
                         "mobile-app/vue-quasar/"])
    rows.sort(key=lambda r: (r[0], r[1]))
    with open(os.path.join(OUT, "inventory-mobile-screens.csv"),
              "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["app", "screen_name", "file"])
        w.writerows(rows)
    return rows


# ---------------- screen -> api map ----------------

IMPORT_RE = re.compile(
    r"""(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]""")
DYN_IMPORT_RE = re.compile(r"""import\(\s*['"]([^'"]+)['"]\s*\)""")
FETCH_RE = re.compile(r"""fetch\(\s*[`'"]([^`'"]+)""")
STR_API_RE = re.compile(r"""[`'"](/api/[^`'"$]*)""")
SWR_RE = re.compile(r"""useSWR(?:Immutable)?\s*(?:<[^>]*>)?\(\s*[`'"]([^`'"]+)""")
APICLIENT_RE = re.compile(r"""apiClient\.[a-zA-Z]+\(\s*[`'"]([^`'"]+)""")
GENERIC_STR = re.compile(r"""[`'"](/(?:rest|auth|storage)/v1/[^`'"$]*)""")

RESOLVE_EXTS = [".tsx", ".ts", ".jsx", ".js"]


def resolve_import(spec, from_file, fe_root):
    """Resolve a local import specifier to a repo file, or None."""
    if spec.startswith("@/"):
        # '@/*' -> ['./*', './src/*']; try root first then src/
        tail = spec[2:]
        bases = [os.path.join(fe_root, tail),
                 os.path.join(fe_root, "src", tail)]
    elif spec.startswith("."):
        bases = [os.path.normpath(
            os.path.join(os.path.dirname(from_file), spec))]
    else:
        return None  # package import
    for base in bases:
        for ext in RESOLVE_EXTS:
            cand = base + ext
            if os.path.isfile(cand):
                return cand
        for ext in RESOLVE_EXTS:
            cand = os.path.join(base, "index" + ext)
            if os.path.isfile(cand):
                return cand
        if os.path.isdir(base):
            # page/component dirs: look for a same-named file
            name = os.path.basename(base)
            for ext in RESOLVE_EXTS:
                cand = os.path.join(base, name + ext)
                if os.path.isfile(cand):
                    return cand
    return None


def extract_apis(text):
    hits = set()
    for rx in (FETCH_RE, STR_API_RE, SWR_RE, APICLIENT_RE, GENERIC_STR):
        for m in rx.finditer(text):
            v = m.group(1)
            # keep static prefix for template literals
            v = v.split("${")[0].rstrip("/") or v.split("${")[0]
            if v.startswith("/"):
                hits.add(v)
    return hits


def screen_api_map(fe_root):
    app_dir = os.path.join(fe_root, "app")
    rows = []
    for p in find_pages(app_dir):
        route = route_from_page(app_dir, p)
        scan = {p}
        try:
            text = open(p, encoding="utf-8").read()
        except OSError:
            text = ""
        # directly imported local files only (one level)
        for m in list(IMPORT_RE.finditer(text)) + \
                list(DYN_IMPORT_RE.finditer(text)):
            r = resolve_import(m.group(1), p, fe_root)
            if r:
                scan.add(r)
        for f in sorted(scan):
            try:
                ftext = text if f == p else open(f, encoding="utf-8").read()
            except OSError:
                continue
            for api in sorted(extract_apis(ftext)):
                rows.append([route, api, rel(f)])
    rows.sort(key=lambda r: (r[0], r[1]))
    with open(os.path.join(OUT, "screen-api-map.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["screen_route", "api_path_called", "call_site_file"])
        w.writerows(rows)
    return rows


def main():
    web = write_web_like(os.path.join(REPO, "frontend-web", "app"),
                         "inventory-web-screens.csv")
    adm = write_web_like(os.path.join(REPO, "frontend-admin", "app"),
                         "inventory-admin-screens.csv")
    mob = mobile_rows()
    api = screen_api_map(os.path.join(REPO, "frontend-web"))
    print(f"web screens:    {len(web)}")
    print(f"admin screens:  {len(adm)}")
    print(f"mobile screens: {len(mob)}")
    print(f"api map rows:   {len(api)}")
    print(f"screens with api calls: {len(set(r[0] for r in api))}")


if __name__ == "__main__":
    main()
