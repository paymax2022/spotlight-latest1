# ADR (draft): Module readiness as a second axis, and a client that fails closed

Status: implemented on `feat/module-readiness`; server enforcement flag
`FEATURE_MODULE_GATE_ENFORCE` still defaults to observe-only.

## Context

The platform module registry (`platform_modules` × `platform_module_environments`) could
already say what to **show** — `hidden | coming_soon | visible` per environment — and the
owner's instruction was specific: an admin marks each module's *readiness* and its
*availability*, and while a product is still under development or testing it must be
invisible on the production APK/AAB so live users cannot use it until the admin publishes
it from the portal.

Four things stood between that sentence and the running system:

1. **No readiness.** "Finished, choosing not to launch" and "still being built" were the
   same value (`hidden`). The console could not answer "is this safe to publish?", and the
   publish button did not know either.
2. **No HTTP surface.** `GET /api/v1/modules/visibility` existed in Go's registry package
   but was never routed, and the frontend-web BFF route the clients already called had no
   handler behind it. Every client was reading a 404.
3. **The client failed open.** On any fetch failure the mobile grid treated every module as
   visible, so the gate could be bypassed by a bad network — and a 404 *is* a bad network.
4. **Seven surfaces had no row at all.** Marketplace, Crypto, Learn/StudyHub, Film Academy,
   Contest, Arena and Connect were never in `feature-flags.ts`, which is what the 36-key seed
   was generated from, so the portal had no control over them and the mobile mapping tables
   (where "no entry" means "not registry-gated, always render") left them unconditionally on.

## Decision

1. **Readiness is a third, independent axis** on `platform_modules`:
   `in_development → testing → ready`, product-wide, while availability stays the
   per-environment publication decision and lifecycle stays active/archived. Neither is
   derived from the other: a `ready` module is not live anywhere by itself, and a module
   live in staging is not ready.
2. **Enforced in two places, not one.** `AssertPublishableIn` refuses the *publish click*
   into production below `ready`, and `VisibleIn` refuses the *serve path*, so demoting
   readiness withdraws a live module without editing its tier rows. That reversibility is
   the point: publication decisions survive an emergency un-publish, exactly as
   archive/restore preserves them.
3. **`coming_soon` is exempt from the readiness gate.** A teaser is inert, and gating it
   would train operators to mark things ready to get the banner up. A gate people lie to
   get past is not a gate.
4. **The migration backfills from publication history** — production-visible → `ready`,
   staging-visible → `testing`, otherwise `in_development` — and reads the column with
   `COALESCE(readiness,'in_development')`. Without the backfill, applying the migration
   would have pulled every live production module off the app on the next read.
5. **The tier is the server's, not the build's.** `/api/v1/modules/visibility` answers for
   the backend's own `APP_ENV`; the client renders what it is told. So the store build that
   is wired to staging today is governed by staging's publication, and the same build moves
   to the production tier the moment it is pointed at the production backend. No client
   change is required to switch planes, which is deliberate.
6. **The client fails closed with a memory.** A successful read is persisted to
   AsyncStorage and replayed when the network cannot answer (`bestAnswer`), so an offline
   user keeps the grid they had instead of losing everything nobody unpublished. Only the
   money rails in `STABLE_MODULE_KEYS` render with no answer at all; the list is chosen by
   consequence — hiding those strands a user who already has money behind them — and is not
   a place to fix a visibility complaint.
7. **One guard, not 36 per-screen checks.** `routeModuleKeys.ts` maps Expo Router segments
   to registry keys, longest-prefix-first, and the root layout refuses a deep link to a
   hidden module. The map is partial on purpose: an unmapped route is never gated, because
   gating a working screen by mistake is worse than leaving an undiscoverable one reachable.
   Tile ids and route segments are separate id-spaces and are mapped separately.
8. **The seven unregistered surfaces are now rows with `env_flag NULL`.** NULL is an
   explicit statement that the registry alone decides; inventing a `FEATURE_*` name would
   have made each permanently unpublished, since Go reads an undefined flag as OFF. They
   seed development-visible and staging/production-hidden at `in_development`.
9. **Server-side enforcement stays where it is.** `modulegate` is mounted on the finance
   group only and defaults to observe-only; the seven new surfaces are recorded as
   deliberately unmapped rather than added as rows that cannot fire.

## Consequences

- **Deploy order is load-bearing**: apply the migrations, publish the intended set from the
  portal, *then* ship a build carrying the new mappings. A build that gates a module the
  registry still says `hidden` for that tier simply hides it.
- **Staging loses seven tiles until someone publishes them.** That is the instruction
  applied consistently, not an oversight, and it is reversible per module in one click.
- **`modulegate`'s `/api/v1/*` rows do not currently enforce anything** — those requests
  never reach the middleware. Widening the mount is not a one-liner: the gate must run
  after authentication, and a router-level `Use()` runs before it.
- **`/api/finance/academy` is inside the mount and was still left ungated**: it is Film
  Academy's tuition rails, paid on today by production users under builds that predate the
  registry. Enforcing it before an operator has been asked to publish would refuse real
  payments.
- **There is no production counterpart to `staging-module-flags.yml`.** When the production
  plane is taken off hold it needs a lane that sets `APP_ENV=production` and the ops flags;
  until then nobody can switch the production tier on from CI. Out of scope here, and
  deliberately not built for a plane that does not run.
- The registry is now the authority on *discoverability*. It is not authorisation: each
  module's own auth/RBAC/tier checks still decide what a caller may do, and the API gate is
  the layer that makes hiding an icon more than decoration.
