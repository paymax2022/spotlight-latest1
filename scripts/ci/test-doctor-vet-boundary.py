#!/usr/bin/env python3
"""Pins check-doctor-vet-boundary.py. Runs in ci.yml's hygiene job.

The guard is a text scan over a fixed set of paths, which is exactly the shape
of checker that goes green by matching nothing — the tree moves, the regex stops
resolving, and the rule it protects silently dies. So every direction is pinned
here: it must fire on each violation, stay quiet on a clean tree, keep ignoring
the legacy subtree it deliberately excludes, and fail loudly if the tree it
scans is gone.
"""

import importlib.util
import io
import os
import pathlib
import tempfile
from contextlib import redirect_stdout

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "cvb", ROOT / "scripts/ci/check-doctor-vet-boundary.py")
cvb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cvb)

failures = []


def check(name, got, want):
    if got != want:
        failures.append(f"{name}: got {got!r}, want {want!r}")


CLEAN_SCREEN = "export default function Home() { return null; }\n"
VET_LINK_SCREEN = "export default function Home() {\n  const go = () => router.push('/(doctor)/vet');\n}\n"
OPTIONS_WITH_VET = (
    "export const PROVIDER_TYPE_OPTIONS: ProviderTypeOption[] = [\n"
    "  { type: 'doctor', label: 'Doctor', routesTo: 'doctor_profile_builder' },\n"
    "  { type: 'veterinarian', label: 'Vet', routesTo: 'vet_profile_builder' },\n"
    "];\n")
OPTIONS_CLEAN = (
    "export const PROVIDER_TYPE_OPTIONS: ProviderTypeOption[] = [\n"
    "  { type: 'doctor', label: 'Doctor', routesTo: 'doctor_profile_builder' },\n"
    "];\n"
    "// a vet onboards via the landing module; the wire union keeps its member\n"
    "const LABEL = { veterinarian: 'Veterinary' };\n")
LANDING_OK = "export default function Onboard() {\n  return route('/health/vet/provider/onboarding');\n}\n"
LANDING_MISSING = "export default function Onboard() {\n  return route('/health/vet/home');\n}\n"
UNION_CLEAN = (
    "export type RecordCategory =\n"
    "  | 'consultations'\n"
    "  | 'dependents';\n")
UNION_WITH_PETS = (
    "export type RecordCategory =\n"
    "  | 'consultations'\n"
    "  | 'pets';\n")
UNION_PETS_IN_COMMENT = (
    "export type RecordCategory =\n"
    "  | 'consultations'\n"
    "  // No 'pets' member: pets belong to the Vet module.\n"
    "  | 'dependents';\n")
UNION_RENAMED = (
    "export type RecordsCategory =\n"
    "  | 'consultations';\n")


def build(tmp, *, screen=CLEAN_SCREEN, options=OPTIONS_CLEAN, landing=LANDING_OK,
          legacy_body=VET_LINK_SCREEN, union=UNION_CLEAN):
    """Lay out a fixture doctor plane and point the guard at it."""
    doctor = os.path.join(tmp, 'app', '(doctor)', '(tabs)')
    os.makedirs(doctor)
    os.makedirs(os.path.join(tmp, 'app', 'health'))
    os.makedirs(os.path.join(tmp, 'src', 'features', 'doctor', 'constants'))
    os.makedirs(os.path.join(tmp, 'src', 'types'))
    with open(os.path.join(doctor, 'index.tsx'), 'w') as fh:
        fh.write(screen)
    with open(os.path.join(tmp, 'app', 'health', 'provider-onboarding.tsx'), 'w') as fh:
        fh.write(landing)
    with open(os.path.join(tmp, 'src', 'types', 'doctor.batch6.ts'), 'w') as fh:
        fh.write(union)
    with open(os.path.join(tmp, 'src', 'features', 'doctor', 'constants', 'onboarding.ts'), 'w') as fh:
        fh.write(options)
    legacy = os.path.join(tmp, 'app', '(doctor)', 'vet')
    os.makedirs(legacy)
    with open(os.path.join(legacy, 'index.tsx'), 'w') as fh:
        fh.write(legacy_body)
    root = pathlib.Path(tmp)
    cvb.ROOT = root
    cvb.RN = root / 'mobile-app'  # unused by scan(), pinned so the relpaths read sanely
    cvb.DOCTOR_APP = os.path.join(tmp, 'app', '(doctor)')
    cvb.LEGACY_VET = os.path.join(cvb.DOCTOR_APP, 'vet') + os.sep
    cvb.OPTIONS = os.path.join(tmp, 'src', 'features', 'doctor', 'constants', 'onboarding.ts')
    cvb.LANDING = os.path.join(tmp, 'app', 'health', 'provider-onboarding.tsx')
    cvb.RECORDS_TYPES = os.path.join(tmp, 'src', 'types', 'doctor.batch6.ts')


def run():
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = cvb.main()
    return code, buf.getvalue()


# --- it fires on a doctor screen that routes into the vet subtree ------------
with tempfile.TemporaryDirectory() as tmp:
    build(tmp, screen=VET_LINK_SCREEN)
    code, out = run()
    check('vet link fires the guard', code, 1)
    check('vet link names the file', 'index.tsx:2' in out, True)

# --- it fires on a veterinarian option in the doctor chooser -----------------
with tempfile.TemporaryDirectory() as tmp:
    build(tmp, options=OPTIONS_WITH_VET)
    code, out = run()
    check('vet option fires the guard', code, 1)
    check('vet option explains the rule', 'PROVIDER_TYPE_OPTIONS' in out, True)

# --- a clean tree passes -----------------------------------------------------
with tempfile.TemporaryDirectory() as tmp:
    build(tmp)
    code, out = run()
    check('clean tree is quiet', code, 0)
    check('clean tree reports OK', 'boundary OK' in out, True)

# --- the legacy subtree itself stays allowed --------------------------------
# The guard scopes to entry points; the screens remain reachable for any account
# already inside them, so its own files referencing the route must not fail it.
with tempfile.TemporaryDirectory() as tmp:
    build(tmp, legacy_body=VET_LINK_SCREEN)
    check('legacy subtree excluded', run()[0], 0)

# --- the alternative must stay reachable ------------------------------------
# Deleting the vet plane wholesale would also satisfy checks 1 and 2, and is the
# opposite of the project rule.
with tempfile.TemporaryDirectory() as tmp:
    build(tmp, landing=LANDING_MISSING)
    code, out = run()
    check('missing landing vet route fires', code, 1)
    check('missing landing route says so', 'did not disappear' in out, True)

# --- a pets member in the records union fires -------------------------------
# The Records hub renders its category grid from `categoryCounts`, so the union
# member is what lets a demo fixture put "Pet records" in front of a doctor.
with tempfile.TemporaryDirectory() as tmp:
    build(tmp, union=UNION_WITH_PETS)
    code, out = run()
    check('pets union member fires', code, 1)
    check('pets union member names the file', 'doctor.batch6.ts' in out, True)

# --- prose about the absence is not the presence ----------------------------
# The shipped source carries a comment naming 'pets' to explain why the member is
# gone. A check that matched the word anywhere would fail its own rationale.
with tempfile.TemporaryDirectory() as tmp:
    build(tmp, union=UNION_PETS_IN_COMMENT)
    code, out = run()
    check('pets in a comment stays quiet', code, 0)

# --- a renamed union fails loudly rather than passing -----------------------
# Check 4 anchors on `export type RecordCategory =`; if the type moves, the scan
# matches nothing and the rule it protects dies quietly.
with tempfile.TemporaryDirectory() as tmp:
    build(tmp, union=UNION_RENAMED)
    code, out = run()
    check('renamed union fails the guard', code, 1)
    check('renamed union says why', 'not found' in out, True)

# --- a moved tree fails loudly rather than passing --------------------------
code, out = '', ''
with tempfile.TemporaryDirectory() as tmp:
    cvb.ROOT = pathlib.Path(tmp)
    cvb.DOCTOR_APP = os.path.join(tmp, 'nowhere', '(doctor)')
    code, out = run()
check('absent doctor tree fails', code, 1)
check('absent doctor tree says why', 'missing' in out, True)

if failures:
    print('FAIL')
    for f in failures:
        print(f'  {f}')
    raise SystemExit(1)
print(f'check-doctor-vet-boundary self-test OK ({len(failures)} failures)')
