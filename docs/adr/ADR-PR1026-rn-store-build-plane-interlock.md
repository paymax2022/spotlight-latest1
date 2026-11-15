# ADR-PR1026 — eas.json is the reference plane for React Native store builds

**Date:** 2026-11-15  
**Status:** Accepted  
**Deciders:** Engineering (senior technical officer), on the module-readiness requirement

## Context

The product requirement is that an admin marks each service module ready/available, and until they do it stays invisible on the **production APK / AAB** so live users cannot use it. The backend and the app both honour it: `GET /api/v1/modules/visibility` answers per tier (production: 31 modules served from 36 published-and-ready rows), and `mobile-app/reactnative` consumes that response to filter the services grid, home, the property hub and every deep link (`src/features/modules/visibility.ts`, `rules.ts`, `routeModuleKeys.ts`).

What was unverified was *which backend a store build asks*. `build-aab.sh` and `build-apk.sh` run local Gradle (`expo prebuild` → `gradlew bundleRelease`), not `eas build`. Expo selects its env file from `NODE_ENV`, so the plane of a store artifact is decided entirely by `mobile-app/reactnative/.env.production` — a file that is **gitignored** (`.gitignore:12` covers `.env.*`), so nothing tracked could ever contradict it. The `production` profile in the tracked `eas.json` sets `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_APP_ENV` too, but on this build path it is never read; `mobile-eas.yml` documents the same split for the OTA path and says so at its line 61-65.

The file on disk was a copy of the staging config:

| marker | `.env.production` held | `eas.json` `production` profile |
|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | `frontend-web-staging-new.up.railway.app` | `frontend-web-production-9259.up.railway.app` |
| `EXPO_PUBLIC_SUPABASE_URL` | `wnicsubiznmishkmunsv.supabase.co` | `nmseefdlliejmdbxytej.supabase.co` |
| `EXPO_PUBLIC_APP_ENV` | `staging` | `production` |

Two consequences, neither of which fails a build. The app would read the **staging** module registry, so admin publication on production would govern nothing a store user sees — the requirement met in the database and unmet on the device. And `EXPO_PUBLIC_APP_ENV=staging` is a member of `SWITCH_ENVIRONMENTS` in `src/lib/serverProfile.ts`, so the artifact — stamped `app-release-production.aab` either way — would have shipped with the on-device Remote/Local server switch **enabled**, which is the fail-open that file's own comment was written to prevent.

## Decision

1. **`eas.json` is the single source of truth for what a plane means.** It is tracked, it already names the full production plane, and a service being renamed on Railway is a one-file edit there. A second statement of the same facts is allowed only where it must be (the operator's local env file), and it is then *derived and checked*, never trusted.
2. **The check is `mobile-app/reactnative/scripts/check-env-plane.mjs`, called by both build scripts before any Gradle work.** It compares the profile's markers against the env file whose name matches `NODE_ENV`, so it enforces both planes symmetrically and survives a plane rename without an edit.
3. **URLs compare on host; `EXPO_PUBLIC_APP_ENV` compares exactly, after trimming.** A trailing slash is not a plane change; `prd` is not `production`. This mirrors `serverProfile.ts`, whose matcher is exact and case-sensitive precisely so that a near-miss can only hide the switch, never expose it.
4. **Credentials are out of the comparison set.** `EXPO_PUBLIC_SUPABASE_ANON_KEY` is the strongest remaining plane signal, but the Supabase URL already names the project, and a guard that reads secrets is a guard that eventually prints one.
5. **An absent reference is a skip stated aloud, not a silent pass.** If `eas.json` has no profile by that name, or it declares none of the markers, the guard prints what it did not compare and exits 0; if it cannot read the env file it exits 1. A check that cannot see must not report success.
6. **The regression test lives in `scripts/ci/`, not in the RN suite**, and runs in the `hygiene` job. The RN specs require `--experimental-strip-types` (Node 22+) against CI's pinned Node 20, and no RN unit spec runs in CI today; a guard nobody executes is a guard that rots until the next store build.
7. **`.env.production.example` states the real production markers.** `cp .env.staging .env.production` produces a file with every `CHANGE_ME` already replaced, which is why the placeholder convention failed to catch this; the test pins the template's three markers to `eas.json` so the default cannot drift.
8. **The operator's file is not this repo's to write.** The PR ships the interlock and stops the build; setting the three values is the person running the release, from `eas.json`, in a file git cannot see.

## Consequences

### Positive
- A store artifact can no longer be built against a plane other than the one its filename and stamped output claim.
- Admin module readiness now actually reaches the device: the plane the app asks is the plane the portal governs.
- The server switch cannot be re-enabled in a production build by a stale env value.
- The failure is one actionable message at the point of the mistake, not a post-incident grep of a shipped bundle.

### Negative / trade-offs
- Release builds now depend on `eas.json` staying accurate. If a profile's markers are removed, the comparison silently narrows; a test asserts all three remain present.
- Legitimate cross-plane experiments ("build the production bundle against staging data for a demo") now need a deliberate path — a `.env.<profile>` edit or `NODE_ENV=staging` — rather than happening by accident.
- CI executes this one guard but still runs no RN unit spec, so the app's own logic remains dev-verified.

### Risks
- The guard validates the *file*, not the bundle. Metro inlining or a new shadowing file could still diverge; the pre-existing bundle scan in both scripts remains the backstop, and it is deliberately unchanged.
- `eas.json` and `.env.production` can both be wrong together — copying staging into both. Nothing in-repo detects that; only the reachability and signature checks downstream would surface it.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Commit `.env.production` with the prod values | It also carries non-public keys in practice; and the interlock would then be unnecessary only until the next local edit reintroduces the fork. |
| Make the build scripts use `eas build --profile production` | Replaces a working local artifact with a cloud round-trip and a queue, for a check that costs one file read. Out of scope for a bug fix. |
| Assert `EXPO_PUBLIC_APP_ENV != staging` in isolation | Fixes symptom 2 and leaves the module registry on the wrong plane. |
| Diff every shared `EXPO_PUBLIC_*` key | Noisy and pulls credential values into a log path for no additional signal. |
| Put the test in `tests/unit/lib/envPlane.spec.ts` | No CI lane runs RN specs, so the guard would be unenforced — the exact condition that let this sit. |

## Related

- `mobile-app/reactnative/scripts/check-env-plane.mjs`, `scripts/ci/check-rn-env-plane.mjs`
- `mobile-app/reactnative/src/lib/serverProfile.ts` (`SWITCH_ENVIRONMENTS`, the reason `APP_ENV` matters)
- `mobile-app/reactnative/src/features/modules/{visibility,rules,routeModuleKeys}.ts` (what consumes the plane)
- ADR-PR996 (module readiness and publication), ADR-PR1019 (the production `FEATURE_*` ops lane)
- `docs/GO-LIVE-CONFIG.md`
