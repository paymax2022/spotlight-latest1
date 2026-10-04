# Agent 4 — mobile-app/reactnative lane notes

Worktree audit/fix pass against `origin/main` (c37a1562). Scope: open mobile
audit findings plus a fresh static sweep for dead routes, error/offline states,
and duplicate-submission gaps.

## Verified already-fixed (no action taken)

- AUD-FE-001 (fail-loud part), AUD-FE-002, AUD-FE-007, AUD-FE-008 (web half),
  AUD-TEST-007, balance-masking (#392), seam/modules suites (#386), E2E matrix
  (#384) — all confirmed merged on main.
- `check:confirm` green on HEAD; `tsc --noEmit` clean (0 errors) on HEAD.

## Fixed this pass

| Item | Change |
|------|--------|
| Dead route `/connect/wallet` | `app/connect/wallet/` has no `index.tsx`; `fund.tsx`'s duplicate-replay path called `router.replace('/connect/wallet')` → `+not-found`. Repointed to `/connect/wallet/home` (the path every sibling screen uses). |
| Dead route `/health/consult` | `app/health/consult/` has only `lobby.tsx` + `room.tsx` (both need an existing `consultId`). The lab-results "Book a consult" button pushed `/health/consult` → `+not-found`. Repointed to `/services/telemedicine`, the booking hub (`app/services/telemedicine/index.tsx`). |
| `usePurchasePayment` re-entry | `runPay` / `submitPin` had no in-flight guard. The sheet only swaps the rail chooser for a spinner after a re-render, so two taps in the same frame ran the launch/charge path twice: double-tapping "Pay with Card" could start two server-side top-ups; double-tapping "Confirm & pay" could debit the wallet twice. Added `payInflight` / `pinInflight` ref locks, released in `finally` so failed/cancelled attempts stay retryable. |
| eas.json residual (AUD-FE-001) | `production.env` still lacked `EXPO_PUBLIC_API_BASE_URL` after #311 — release builds fell back to `localhost:3000` with only a `console.error`. Set to `https://www.spotlightng.com` (canonical host per `docs/devops/deployment-matrix.md` / `next.config.mjs` apex→www redirect). `preview` profile carried no API/Supabase env at all (same failure class for QA builds) — now mirrors the staging env. |
| Stale `check:confirm` exclusion | `app/crowdfunding` was excluded from the no-`Alert.alert` gate "while migrating on a separate branch" — that migration has landed (zero `Alert.alert` calls remain under `app/crowdfunding`). Exclusion removed; `npm run check:confirm` still green. |

## Findings noted, not fixed

- **`/association/member/m1` hardcoded member id** — `app/association/profile/index.tsx`
  "View public profile" pushes a literal demo id (`m1`) rather than the signed-in
  member's id. `member/[id].tsx` renders an error StateView on unknown ids, so the
  blast radius is a dead-end screen, not a crash — but the button is wrong. Needs
  the caller's own member id plumbed in; left for an owner who knows the intended
  behavior.
- **`useMember`-style feature screens rely on mock adapters** in several modules;
  out of scope for a config-level pass.
- AUD-FE-008 (wallet `getWalletAccountId` ordering) remains open as documented —
  deferred pending a decision on how sweep DEBIT/CREDIT pairs should appear in
  totals; not a safe drive-by fix.
- AUD-FE-003 residuals (academy tuition/apply, reality-TV/contest-registration
  gateway fulfilment) remain open as documented — each needs a server-side
  pending record keyed by reference; not a mobile-side fix.

## Verification

- `npm ci` clean.
- `npm run typecheck` — 0 errors.
- `npm run check:confirm` — pass.
- `npm run test:payments` — 44/44 pass (suite covering the touched
  `src/features/payments/` module).
- Dead-link sweep: script extracted every literal `router.push|replace|navigate`
  / `href=` target under `app/` + `src/` (1507 valid routes). 7 candidates
  reviewed; 2 were real dead targets (fixed above), the rest resolve through
  dynamic segments or expo-router's `/index` normalization.
