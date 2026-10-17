# ADR-PR799: Runtime Remote/Local server switch in non-production mobile builds

## Status
Proposed

## Context
The mobile app's API, Connect and Supabase endpoints are fixed at build time. An APK cannot reach a developer machine (`localhost` is the phone), and Expo web at `localhost:8083` pointed at the remote server fails on CORS, surfacing as "No internet connection". Developers need one build that can use either stack.

## Decision
- A Remote/Local switch on the login screen, available only when `EXPO_PUBLIC_APP_ENV` is in a fail-closed allowlist (`development|dev|staging|test|local`). Unset or any other value is treated as production: hidden, and any stored override is ignored.
- Local profile = `EXPO_PUBLIC_LOCAL_*` templates plus a user-editable host. API, Connect and Supabase (URL and anon key) switch together; the anon key comes only from env.
- The choice applies on restart (persist, clear session, reload) rather than hot-swapping, because axios clients, the Supabase singleton and sockets hold the old server.
- The startup read is synchronous (SecureStore.getItem / localStorage) since most consumers resolve their base URL at module load; any failure falls back to Remote.
- The typeable host is validated strictly (localhost, loopback, RFC1918, `*.local`, `::1`; no ports, schemes, userinfo, uppercase, trailing dot or numeric tricks) at entry and again at read, because a hostile host would receive user tokens.
- `eas.json` carries the templates only in non-production profiles; CI runs `export-eas-profile-env.mjs production` and fails if any `EXPO_PUBLIC_LOCAL_*` is present.

## Consequences
- Default behavior is unchanged when nothing is stored.
- `*.local` names can be spoofed on a hostile LAN (accepted for dev convenience).
- `staging` and `staging-aab` APKs expose the switch.
- Cleartext HTTP to LAN hosts depends on the existing app.json configuration.
- UI and reload behavior are unit-tested only at the logic level; not yet exercised on a device.
