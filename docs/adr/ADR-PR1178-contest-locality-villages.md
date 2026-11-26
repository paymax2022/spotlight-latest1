# ADR-PR1178: Locality below the state — curated quarters, and a flag that gates writes only

Status: implemented on `feat/contest-locality-villages` (PR #1178), not merged.

## Context

`contests.region_scope` could already say `state`, `regional`, `national`, `international`. That
was the whole geography a contest could claim: "a local contest" meant a state, which for Nigeria
is the wrong size — Anambra is not Onitsha, and an organizer running a quarter-level talent hunt
had no way to say so.

Three pieces existed and did not connect:

1. **A reference table.** `frontend-web/src/features/registration/reference-data.ts` held the
   state → local-government list under the name `NIGERIA_CITIES_BY_STATE` (37 rows, 773 entries).
   The values were always LGAs — Anambra → `Onitsha North`, `Onitsha South` — but the key and the
   wizard label said "city", so the only thing the cascade could derive was a town picker for
   *residence*. The mobile app carried its own copy in `src/data/nigeria.ts`.
2. **Cascade code on both clients.** The web wizard (`locality-picker.ts`) and the phone
   (`localityOptions.ts`) implemented state → LGA → village, and a village tier that degrades to a
   text box.
3. **Nothing to hang it on.** Six builders each hand-wrote their own `personal_information` step.
   Two listed `personal.stateOfOrigin`; **none** listed `personal.localGovernment` or
   `personal.village`. There was no `public.villages` table either.

So the feature was configurable in the console and invisible at the point of entry: locality
filters on rosters and leaderboards ran on columns nobody was asked to fill.

## Decision

**1. The village tier is curated content, with a free-text floor.**
`public.villages (state, lga, name)`, RLS public-read / admin-manage, editable from
`/admin/competitions/villages` so publishing a quarter is a row, not a redeploy. Seeded with the
fifteen quarters of **Onitsha North** and nothing else, because those fifteen are the ones a human
supplied; inventing the rest of the country's wards would have made the table confidently wrong.
Every read path answers `mode: 'curated' | 'free_text'`. A static list was rejected — 773 LGAs
have no published quarter list to copy, and curation would need a release per ward. A select-only
control was rejected — it boxes out an applicant whose quarter is unlisted, which is the opposite
of the second decision below. The input stays a text box with tappable chips over it, so a quarter
spelled differently at home still gets in.

**2. Locality displays and filters; it never gates entry or voting.**
No `required` is added anywhere by this arc: the injected fields are optional, `stateOfOrigin`
keeps whatever requiredness its template already chose (reality-TV and film-academy require it, and
that stays), and an uncurated or unreadable village list yields a text box rather than an error.
The admin-side refusals are the one place locality is enforced, and they are about a *contest's*
configuration, not a person's eligibility: an `lga`/`village` scope without its levels is a contest
that cannot be filtered, so it is refused with the missing level named —
`A village contest needs its village.` — never a bare 400.

**3. Injected at the choke point, not per template.**
`ensureLocalityFields` runs on the output of `buildStepsForContest` for the template and
capability-driven branches, and not on the `derived.formSchema` branch. One place to keep the rule,
and a new template inherits it. The BFF returns the same `steps` object to the web wizard and the
Expo wizard, so a single server-side injection fixes both planes. Idempotent and non-mutating,
because the builder output is cacheable.

**4. An operator's mapped form stays theirs.**
When `derived.formSchema` is set, that field list is a decision made in the console; completing it
here would silently re-add a question someone switched off. The field catalog already offers all
three locality keys, so the schema path is supported — just not by surprise. This mirrors the
existing rule at the store's title-matched site, which deliberately does not write
`derived.formSchema`: a coincidental match must not overwrite an operator's choice.

**5. Origin drives the locality cascade; residence keeps driving cities.**
Two different geographies answering two different questions. The LGA list is derived from
`personal.stateOfOrigin`, and locality filters are built from origin, so the city pickers stay on
residence untouched. Within the cascade, moving a level clears everything below it — a stored row
must never read "Onitsha North / Ikeja", because that village would be counted under the wrong
locality on every filter and leaderboard. Re-selecting the same value clears nothing.

**6. Mirrored once, read everywhere.**
`locality_*` on `contests` is copied to `connect_contests` by `sync_connect_contest()`, and the
applicant's `lga`/`village` are carried to `contestants` by `promote_registration_to_contestant()`.
Voting and the admin roster then read locality without a second write path, and the trigger keeps
the two tables from drifting when an editor changes their mind.

**7. `derived.*` is the only channel, and all four keys are always written.**
A draft carries `formData` plus `contestSlug`, so contest locality reaches the form as
`derived.localityScope/State/Lga/Village`. `saveRegistrationStep` merges rather than replaces, so a
key that is omitted when a contest is demoted from village to national would keep its old value on
every draft of that contest forever — an empty string is the answer that clears.

**8. The flag gates the admin curation surface, and it is a strict `'true'`.**
`FEATURE_LOCALITY_VILLAGES_ENABLED` wraps all four handlers of `/api/admin/villages*` — the writes
and the list read the console needs to show them — and nothing else. The public pickers,
`/api/registration/villages`, `/api/registration/lgas`, and the locality columns are ungated: they
widen surfaces that are already live and unflagged, and a default-off gate on an applicant-facing
read would reproduce the E2E-SOC-036 class of bug — a 503 handed to a contestant because of a
variable only an admin feature needs. With the flag off an environment simply keeps whatever
`public.villages` already holds, and uncurated LGAs answer `mode=free_text`, so nothing anywhere can
be blocked by it; only the curation page has nothing to show.

The name matters operationally: `envFlag()` in `frontend-web/src/lib/feature-flags.ts` is
`process.env[varName] === 'true'`, while `envFlagDefaultTrue()` mirrors the Go backend's
`getEnvBool` and also accepts `1`/`yes`. Setting this flag to `1` reads as off and produces
`Feature 'localityVillages' is not available in this environment.` on every write, which is why the
admin console surfaces the flag name in its own banner instead of a generic failure.

**9. The roster filter runs on rows in hand.**
Go's roster endpoint returns the whole roster and ignores query parameters; only
`/connect/villages` reads them. A locality sent as a query string would look wired while doing
nothing — the trap this screen's search box already avoids. The option lists come from the roster
too, not from the bundled LGA table: a panel offering a ward with nobody in it reads as "nobody from
here entered" rather than "this contest has nobody here".

## Consequences

- Every hand-built registration form gained up to three optional fields, and `locality-fields.ts`
  is the file to read before adding a template.
- Village values typed where nothing is curated are free text, so a village-level filter can show
  spelling variants as separate chips. Curation is the fix, and the console page exists for it.
- The reference table keeps its misleading key for eight older readers; `NIGERIA_LGAS_BY_STATE` is
  an honest alias, and new locality code imports that.
- Merging is a release: `release.yml` has no `paths-ignore`, and the staging transport fault is
  fixed, so `main` now deploys dev → staging → production by itself.
- The phone's chip and filter-panel rendering has no automated proof — the RN package has no
  component-test harness — so it needs one live tap-through on Metro.
