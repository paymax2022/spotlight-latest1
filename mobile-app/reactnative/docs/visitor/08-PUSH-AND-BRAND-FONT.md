# Push Notifications + Brand Font (P5)

Delivers visitor & election notifications via push and loads Plus Jakarta Sans app-wide.

## One-time install (required)

The sandbox can't run installs; on a normal machine run:

```bash
npx expo install expo-notifications expo-device expo-constants expo-font expo-splash-screen @expo-google-fonts/plus-jakarta-sans
```

These are already declared in `package.json` (best-effort SDK-54 pins) and the `app.json` plugins; `expo install` reconciles exact versions. Until installed, the app still runs: typography falls back to the system font and push is a no-op (every native call is guarded).

## Brand font

- `src/constants/fonts.ts` — weight → Plus Jakarta Sans family-name map (`brandFont(weight)`).
- `src/constants/typography.ts` — every token's `fontFamily` now uses `brandFont(weight)`; `fontWeight` is kept for fallback. No screen changes were needed — the whole app inherits the font.
- `src/lib/brandFonts.ts` — `useBrandFonts()` loads the five weights via `@expo-google-fonts/plus-jakarta-sans`; returns `true` once ready (or on error → system-font fallback, never blocks).
- `app/_layout.tsx` — holds the native splash (`expo-splash-screen`) until fonts resolve, then renders.

## Push notifications (client)

`src/lib/push.ts`:
- **Foreground handler** — shows banner + sound while the app is open.
- **`registerForPushNotificationsAsync()`** — physical-device check, Android channel (`estate`, HIGH importance), permission request, returns the Expo push token (uses EAS `projectId` from `expo-constants`).
- **`sendPushTokenToBackend(token)`** — `POST /notifications/push-token { token, platform }` (best-effort).
- **`routeFromPush(data)`** — deep-links a tapped notification to the right screen.
- **`presentLocalNotification(title, body, data)`** — shows an on-device notification (foreground/fallback).
- **`usePushNotifications(enabled)`** — mounted once in the root `AuthGate` when signed in: registers the token, wires the tap listener, and handles cold-start taps.

### Client bridges (foreground delivery / fallback)
The backend sends the real pushes; these client hooks also surface alerts locally so nothing is missed while the app is open:
- `src/features/election/hooks/useElectionPushBridge.ts` — fires once when an election becomes live.
- `src/features/visitor/hooks/useVisitorPushBridge.ts` — polls visitor notifications (20s) and mirrors new ones; primes silently on first load to avoid a startup burst.

Both are mounted in `AuthGate` and gated on `signedIn`.

## Backend payload contract

The backend sends pushes whose `data` drives routing (`routeFromPush`):

| `data.type` | extra | routes to |
|---|---|---|
| `visitor_arrival` / `visitor_checked_in` / `visitor_checked_out` / `visitor_overstayed` | `accessCodeId?` | `/visitor/code/{id}` (else `/visitor/notifications`) |
| `visitor_denied` | — | `/visitor/notifications` |
| `visitor_restriction` / `visitor_access_restored` | — | `/visitor/restricted` |
| `election_live` / `election_reminder` / `election_results` | `electionId?` | `/election?id={id}` (else `/election/list`) |

The visitor/election API mocks already create matching in-app notifications on these events; the backend should emit a push with the same shape when the live endpoints land. Register the device token via the `POST /notifications/push-token` endpoint the client calls on sign-in.

## Resilience / blast radius
- `src/constants/fonts.ts` and `typography.ts` have **no** native imports — safe with or without the packages.
- Native imports are confined to `lib/push.ts`, `lib/brandFonts.ts`, the two bridges, and `app/_layout.tsx`; all native calls are wrapped in try/catch and the app renders even if fonts/push are unavailable.
