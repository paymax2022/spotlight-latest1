# Integration Contract — Reuse, Don't Recreate

> Paymax Mobility installs **inside the existing Paymax/Spotlight codebase**. Treat the surrounding app as a platform to build *on*, not around. The default answer to "should I build X?" for auth, design, wallet, notifications, and profile is **no — reuse what exists.**

## 1. Design system (read before every UI task)
**Path:** `/Users/paymax/Desktop/wordpress/spotlight/new/mobile-app/reactnative/DESIGN-Mobile.md`

Before generating any screen or component:
1. Open and read `DESIGN-Mobile.md`.
2. Build using its design tokens (color, spacing, typography, radius, elevation), its component inventory, and its layout/navigation patterns.
3. Do **not** introduce new colors, fonts, spacing scales, or bespoke components when the system already defines an equivalent. Match the existing visual language exactly.
4. If a needed pattern isn't in the design system, compose it from existing primitives and flag it — don't fork the system.

If the file isn't found at build time, **stop and ask** for the correct path instead of inventing a style.

## 2. Authentication — consume, never rebuild
- The user is **already authenticated** as a Paymax user when they enter Mobility. There is no separate Mobility login.
- Use the existing **auth context / hooks / token handling / session + refresh / biometric** flows. Do not implement login, registration, OTP, password reset, or session management inside this module.
- Mobility's own onboarding (rider trust levels, driver onboarding) layers *on top of* the existing identity — it adds verification + role data, it does not replace auth. See `onboarding.md`.
- Driver/partner app auth also rides on the existing system; the driver role is an authorization concern, not a new auth stack.

## 3. Shared components — reuse before you create
Reach for existing shared UI first: buttons, inputs, selects, bottom sheets, modals, toasts, list rows, section headers, avatars, badges, map views, and any wallet/payment widgets. Only create a new component when nothing existing fits, and build it from design-system primitives so it's visually indistinguishable from the rest of the app.

**Heuristic:** if you're about to write a styled `<View>`/`<Pressable>` that looks like something already in the app, you're probably duplicating — search the shared library first.

## 4. Platform infrastructure to reuse (integrate, don't reimplement)
| Concern | Reuse |
|---|---|
| Auth / session / biometrics | Existing Paymax auth system |
| Wallet, balances, payment methods, top-up | Existing Paymax wallet (Mobility adds ledger entries for trip/job flows via the wallet-payment service) |
| Notifications (push/SMS/email/in-app) | Existing notification infrastructure + templates |
| Profile / saved addresses where they already exist | Existing profile module; extend, don't fork |
| Navigation shell / tab bar / deep links | Existing app navigation — Mobility registers its routes into it |
| Admin shell, RBAC, audit plumbing | Existing Paymax admin console |

## 5. Where new mobility code lives
New code is isolated to its module folders and **imports** shared infra rather than copying it:
```
/apps/mobile/src/modules/mobility/...      (imports: auth, wallet, ui/design-system, profile)
/apps/driver/src/modules/...               (imports: auth, wallet, ui/design-system)
/apps/admin/src/modules/{mobility,...}     (imports: existing admin shell + RBAC + audit)
```
Backend mobility services are new (see `architecture.md`) but call the existing wallet/auth/notification services through their established interfaces — they do not embed copies of that logic.

## 6. Definition of done for integration
- No duplicated auth, design tokens, or shared components.
- Every new screen visually matches `DESIGN-Mobile.md`.
- Mobility entry assumes an authenticated user and pulls identity from the existing auth context.
- Wallet movements flow through the existing wallet via the wallet-payment service with double-entry ledger records.
- New routes are registered into the existing navigation shell; nothing re-implements app chrome.
