#!/usr/bin/env python3
"""Fail the build when the Doctor app offers a way into Veterinary onboarding.

Project rule: a human doctor who also treats animals onboards as a vet through
the Vet module on the landing page (`app/health/provider-onboarding.tsx` ->
`/health/vet/provider/onboarding`), NOT from inside the Doctor app. Two things
made vet an option of the doctor plane, and both read as "Vet is a sub-feature
of being a doctor":

  * `Vet mode` / `Pet health records` links on the doctor tabs, records hub and
    patient record screen, pushing into `/(doctor)/vet`;
  * a `veterinarian` card in `PROVIDER_TYPE_OPTIONS`, which two doctor
    onboarding screens render, so a person onboarding as a doctor met "I'm a
    veterinarian" as one of their own provider types.

The `app/(doctor)/vet/**` subtree itself is legacy and stays registered — this
guards the ENTRY POINTS, not the screens, because removing screens a live
account may still be inside is a separate, data-aware change.

THREE CHECKS
  1. No screen under `app/(doctor)/` outside that legacy subtree routes to it.
  2. `PROVIDER_TYPE_OPTIONS` offers no `veterinarian` choice.
  3. The landing-page vet onboarding route still exists. Without this the guard
     could be satisfied by deleting the vet plane wholesale, which is the
     opposite of the rule.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RN = os.path.join(ROOT, 'mobile-app', 'reactnative')
DOCTOR_APP = os.path.join(RN, 'app', '(doctor)')
LEGACY_VET = os.path.join(DOCTOR_APP, 'vet') + os.sep
OPTIONS = os.path.join(RN, 'src', 'features', 'doctor', 'constants', 'onboarding.ts')
LANDING = os.path.join(RN, 'app', 'health', 'provider-onboarding.tsx')
CANONICAL_VET_ROUTE = '/health/vet/provider/onboarding'

VET_ROUTE_RE = re.compile(r"['\"`]/\(doctor\)/vet")
VET_OPTION_RE = re.compile(r"type:\s*'veterinarian'")


def doctor_screens():
    for dirpath, dirnames, filenames in os.walk(DOCTOR_APP):
        if os.path.join(dirpath, '') == LEGACY_VET or dirpath.startswith(LEGACY_VET):
            dirnames[:] = []
            continue
        for name in sorted(filenames):
            if name.endswith(('.tsx', '.ts')):
                yield os.path.join(dirpath, name)


def scan():
    """(routes, vet_option_offered, landing_route_present) — the three raw facts."""
    routes = []
    for path in doctor_screens():
        with open(path, encoding='utf-8') as fh:
            for lineno, line in enumerate(fh, 1):
                if VET_ROUTE_RE.search(line):
                    routes.append(f'{os.path.relpath(path, ROOT)}:{lineno}')
    option_offered = False
    if os.path.exists(OPTIONS):
        src = open(OPTIONS, encoding='utf-8').read()
        start = src.find('export const PROVIDER_TYPE_OPTIONS')
        array = src[start:src.find('];', start)] if start != -1 else ''
        option_offered = bool(VET_OPTION_RE.search(array))
    landing_present = os.path.exists(LANDING) and CANONICAL_VET_ROUTE in open(
        LANDING, encoding='utf-8').read()
    return routes, option_offered, landing_present


def main():
    if not os.path.isdir(DOCTOR_APP):
        print(f'::error::{os.path.relpath(DOCTOR_APP, ROOT)} is missing — this guard '
              'silently passing would be meaningless')
        return 1

    routes, option_offered, landing_present = scan()
    failed = False

    if routes:
        failed = True
        print('::error::The Doctor app offers a way into Veterinary onboarding:')
        for r in routes:
            print(f'  {r}')
        print(f'  A vet onboards from the landing page Vet module ({CANONICAL_VET_ROUTE}),')
        print('  not from inside the doctor screens. Remove the entry point.')

    if option_offered:
        failed = True
        print(f"::error::PROVIDER_TYPE_OPTIONS still offers 'veterinarian' — "
              f"{os.path.relpath(OPTIONS, ROOT)}")
        print('  Doctor onboarding must present doctor/specialist only; a veterinarian')
        print('  arrives through the Vet module, which runs its own provider onboarding.')

    if not landing_present:
        failed = True
        print(f"::error::{CANONICAL_VET_ROUTE} is no longer reachable from "
              f"{os.path.relpath(LANDING, ROOT)}")
        print('  The vet entry point moved OUT of the Doctor app, it did not disappear.')
        print('  Restore the landing-page Vet module before removing doctor-side links.')

    if not failed:
        print('doctor/vet boundary OK: no vet entry point in the Doctor app, '
              'vet onboarding reachable from the landing page')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
