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

A third way in was found that no route string reveals: the Records hub renders
its "By category" grid from data, and `RecordCategory` carried a `pets` member
whose label is "Pet records". `DOCTOR_USE_MOCK` defaults to true, so the demo
dashboard's `{category:'pets'}` row renders that chip to a human doctor — a vet
affordance inside the doctor plane, invisible to checks 1 and 2 and only visible
on screen.

A fourth: the doctor Reviews screen split itself into two channels, "Patient
reviews" and "Vet clients", and filtered `ConsultationFeedback` by
`channel === 'vet'`. That tab routes nowhere, so check 1 never saw it, but for a
human doctor it is a permanently empty tab whose existence says one credential
set answers to both registers. The Vet module has its own reviews screen
(`app/health/vet/provider/reviews.tsx`).

FIVE CHECKS
  1. No screen under `app/(doctor)/` outside that legacy subtree routes to it.
  2. `PROVIDER_TYPE_OPTIONS` offers no `veterinarian` choice.
  3. The landing-page vet onboarding route still exists. Without this the guard
     could be satisfied by deleting the vet plane wholesale, which is the
     opposite of the rule.
  4. `RecordCategory` carries no `pets` member, so the records plane cannot offer
     a pet category — as data or as a type. While the member is absent, a pets
     fixture row is a tsc error (the mobile lane compiles the whole app), so this
     check guards the type that guards the data.
  5. No doctor screen selects or renders a vet *channel* — a `'vet'` compared,
     passed, or unioned, or the "vet client" copy that labels it. This is the
     class checks 1 and 2 cannot see because it appears nowhere in a route.
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
RECORDS_TYPES = os.path.join(RN, 'src', 'types', 'doctor.batch6.ts')
CANONICAL_VET_ROUTE = '/health/vet/provider/onboarding'

VET_ROUTE_RE = re.compile(r"['\"`]/\(doctor\)/vet")
VET_OPTION_RE = re.compile(r"type:\s*'veterinarian'")
# A union MEMBER, not any mention of the word: the comment that explains why a
# member is gone must not trip the check it documents.
PET_CATEGORY_RE = re.compile(r"\|\s*'pets'")
RECORD_CATEGORY_ANCHOR = 'export type RecordCategory ='
# Check 5 looks at where a vet channel is *used*: compared, passed as an
# argument, or unioned in — plus the copy that labels it on screen. String
# literals stay visible to it (that is where the copy lives); comments do not.
VET_CHANNEL_RE = re.compile(r"[=!]==?\s*'vet'|\(\s*'vet'|\|\s*'vet'")
VET_COPY_RE = re.compile(r"\bvet client", re.IGNORECASE)


def strip_comments(src):
    """Blank out // and /* */ comments, keeping every other character in place.

    Line numbers and offsets survive, so a hit still reports the right line. The
    guard reads code, not prose: a screen may explain the vet rule in a comment,
    and a wire payload may legitimately carry 'vet', but neither is a doctor-side
    affordance. String contents are left alone because that is where on-screen
    copy lives.
    """
    out = []
    i, n = 0, len(src)
    while i < n:
        two = src[i:i + 2]
        if two == '//':
            j = src.find('\n', i)
            j = n if j == -1 else j
            out.append(' ' * (j - i))
            i = j
        elif two == '/*':
            j = src.find('*/', i + 2)
            j = n if j == -1 else j + 2
            out.append(''.join(c if c == '\n' else ' ' for c in src[i:j]))
            i = j
        elif src[i] in '\'"`':
            quote = src[i]
            j = i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == '\n' and quote != '`':
                    break
                if src[j] == quote:
                    j += 1
                    break
                j += 1
            out.append(src[i:j])
            i = j
        else:
            out.append(src[i])
            i += 1
    return ''.join(out)


def doctor_screens():
    for dirpath, dirnames, filenames in os.walk(DOCTOR_APP):
        if os.path.join(dirpath, '') == LEGACY_VET or dirpath.startswith(LEGACY_VET):
            dirnames[:] = []
            continue
        for name in sorted(filenames):
            if name.endswith(('.tsx', '.ts')):
                yield os.path.join(dirpath, name)


def records_categories():
    """(union_found, pets_offered) for the `RecordCategory` union."""
    if not os.path.exists(RECORDS_TYPES):
        return False, False
    src = strip_comments(open(RECORDS_TYPES, encoding='utf-8').read())
    start = src.find(RECORD_CATEGORY_ANCHOR)
    if start == -1:
        return False, False
    union = src[start:src.find(';', start)]
    return True, bool(PET_CATEGORY_RE.search(union))


def scan():
    """The raw facts this guard reports on."""
    routes = []
    channels = []
    screens = 0
    for path in doctor_screens():
        screens += 1
        rel = os.path.relpath(path, ROOT)
        code = strip_comments(open(path, encoding='utf-8').read())
        for lineno, line in enumerate(code.splitlines(), 1):
            if VET_ROUTE_RE.search(line):
                routes.append(f'{rel}:{lineno}')
            if VET_CHANNEL_RE.search(line) or VET_COPY_RE.search(line):
                channels.append(f'{rel}:{lineno}')
    option_offered = False
    if os.path.exists(OPTIONS):
        src = strip_comments(open(OPTIONS, encoding='utf-8').read())
        start = src.find('export const PROVIDER_TYPE_OPTIONS')
        array = src[start:src.find('];', start)] if start != -1 else ''
        option_offered = bool(VET_OPTION_RE.search(array))
    landing_present = os.path.exists(LANDING) and CANONICAL_VET_ROUTE in open(
        LANDING, encoding='utf-8').read()
    union_found, pets_offered = records_categories()
    return {
        'routes': routes,
        'channels': channels,
        'screens': screens,
        'option_offered': option_offered,
        'landing_present': landing_present,
        'union_found': union_found,
        'pets_offered': pets_offered,
    }


def main():
    if not os.path.isdir(DOCTOR_APP):
        print(f'::error::{os.path.relpath(DOCTOR_APP, ROOT)} is missing — this guard '
              'silently passing would be meaningless')
        return 1

    facts = scan()
    routes, channels, screens = facts['routes'], facts['channels'], facts['screens']
    option_offered, landing_present = facts['option_offered'], facts['landing_present']
    union_found, pets_offered = facts['union_found'], facts['pets_offered']
    failed = False

    if screens == 0:
        failed = True
        print(f"::error::no .ts/.tsx screen was found under "
              f"{os.path.relpath(DOCTOR_APP, ROOT)}")
        print('  Checks 1 and 5 scan that tree, so an empty walk would pass them')
        print('  without protecting anything. Update this guard with the tree.')

    if routes:
        failed = True
        print('::error::The Doctor app offers a way into Veterinary onboarding:')
        for r in routes:
            print(f'  {r}')
        print(f'  A vet onboards from the landing page Vet module ({CANONICAL_VET_ROUTE}),')
        print('  not from inside the doctor screens. Remove the entry point.')

    if channels:
        failed = True
        print('::error::A Doctor screen presents veterinary feedback as its own channel:')
        for c in channels:
            print(f'  {c}')
        print('  A human doctor has no vet clients, so that tab is always empty and')
        print('  implies one credential set answers in both registers. Vet reviews live')
        print('  in the Vet module, which has its own reviews screen.')

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

    if not union_found:
        failed = True
        print(f"::error::{RECORD_CATEGORY_ANCHOR!r} was not found in "
              f"{os.path.relpath(RECORDS_TYPES, ROOT)}")
        print('  Check 4 scans that union, so a rename or a move turns it green')
        print('  without protecting anything. Update this guard with the type.')

    if pets_offered:
        failed = True
        print(f"::error::RecordCategory still carries 'pets' — "
              f"{os.path.relpath(RECORDS_TYPES, ROOT)}")
        print('  The Records hub renders its category grid from data, so that member')
        print('  puts a "Pet records" affordance in front of a human doctor. Pets are')
        print('  the Vet module\'s records, reached from the landing page Vet icon.')

    if not failed:
        print('doctor/vet boundary OK: no vet entry point in the Doctor app, '
              'no vet channel in its screens, '
              'vet onboarding reachable from the landing page, '
              'no pet category in the records plane')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
