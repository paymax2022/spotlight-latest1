# Agent 3 notes — frontend-web open audit findings (re-verified on `origin/main` @ c37a1562)

Scope: FULL_AUDIT.md Frontend + Security findings. Verified which items are still
open on current main and which are safely fixable in this lane.

## Already fixed on main (verified, not redone)

| ID | Evidence on main |
|----|------------------|
| AUD-FE-001 | `mobile-app/reactnative/eas.json` prod profile carries the `EXPO_PUBLIC_*` vars (PR #311) |
| AUD-FE-002 | single `staging-aab` profile (PR #295) |
| AUD-FE-003 | `src/server/payments/gateway-fulfil.ts` fulfils server-side; `openmic_vote_paystack_intents` covers Open Mic (PRs #336/#393/#401). Residual deferred: academy tuition instalments / application fee / reality-TV votes — each needs a server-side pending record keyed by reference; not a safe cleanup |
| AUD-FE-004 | dispatcher surfaces handler rejections 500/400 (PR #310) |
| AUD-FE-005 | `SPOTLIGHT_ADMIN_API_KEY_ROLE` env ceiling (PR #328) |
| AUD-FE-006 | `handleApiError` logs + `Sentry.captureException` (PR #287) |
| AUD-FE-007 | verify route resolves `transactionId` from `payment_reference` (PR #308) |
| AUD-FE-008 | utility beneficiaries dual-path (PR #291) |
| AUD-BILL-001 | server-quoted OpenMic price + amount reconcile (PR #401) |
| AUD-SEC-001 | partial — bucket cap + proxy-aware keys (#327), `proxyToGoBackend` ceiling (#346). Residual: per-replica in-memory reset (architectural); `votes/paid/*` limiters blocked by protected legacy paths — left documented-blocked per lane rules |
| AUD-SEC-002/002b | dependabot covers all manifests (#342); prod advisories cleared (#323/#378). Residual: 3 dev-tooling highs needing `eslint-config-next` major — out of scope (no major upgrades) |
| AUD-SEC-003 | `grep -rn NEXT_PUBLIC_ADMIN_API_KEY frontend-web` → 0 hits; 7 dead service modules were deleted (PR #300). Only doc comments remain in `frontend-admin` |

## Still open — fixed in this lane (audit "hygiene" row, dead code)

The mock-exams **web** app was removed (`app/academy/mock-exams` deleted in
`80c97820`; live API surface is `/api/v1/academy/mock-exams` via
`src/lib/api/mockExamClient.ts`, PR #389), but its PWA/offline scaffold was left
behind. Verified zero live importers for every file below (static + dynamic
import sweep, tests included):

- `frontend-web/hooks/useBackgroundSync.ts` — posts to **deleted**
  `/api/mock-exams/progress` + `/api/mock-exams/submit` (no `app/api/mock-exams`
  tree exists). Audit-flagged.
- `frontend-web/public/service-worker.js` — precaches dead
  `/academy/mock-exams*` pages + caches dead `/api/mock-exams/` pattern;
  registered only via dead `useServiceWorker` → dead `PWAProvider`.
  Audit-flagged.
- `frontend-web/public/manifest.json` — `start_url` + all shortcuts point at
  deleted `/academy/mock-exams*` routes; linked only by dead `PWAMetaTags`.
- Orphans: `app/academy/compliance/{automation,notifications,analytics,predictions}-page.tsx`
  — not routable in app router (`page.tsx` only), zero importers. Audit-flagged.
- Transitively dead (only consumed by the above or nothing):
  `hooks/{useExamAnalytics,useNetworkStatus,useServiceWorker,usePerformanceDashboard,useAuditLogging,useConsentManagement}.ts`,
  `components/{PWAProvider,PWAMetaTags}.tsx`,
  `lib/db/examDatabase.ts`, `lib/analytics/encryptedAnalytics.ts`,
  `lib/monitoring/performanceMetrics.ts`, `lib/audit/auditLogger.ts`
  (event enums are exam-scaffold specific: `exam_submitted`, `offline_sync`,
  `biometric_auth_attempt`, `gesture_used`).

## Still open — NOT fixed (left for owners / other lanes)

- `hooks/{useAdvancedGestures,useBiometric,useMediaQuery,usePasskey,useSwipeGesture}.ts`
  — also zero importers, but generic-purpose utilities (mobile UX / passkey auth)
  rather than mock-exams-specific. Kept; optional follow-up deletion.
- `app/academy/compliance/{automation,notifications,analytics,predictions}.tsx`
  + `src/hooks/{useComplianceAutomation,useNotificationEngine,usePredictiveCompliance,useComplianceAnalytics,useComplianceReporting}.ts`
  — become fully orphaned once the `-page.tsx` shells are removed, but they are
  flag-gated scaffolding for the planned `/api/compliance/*` feature
  (`layout.tsx` gates the segment behind `FEATURE_ACADEMY_COMPLIANCE_ENABLED`).
  Kept pending a keep/delete decision tied to that feature's build.
- AUD-FE-003 residuals (academy/reality-TV pending records) — real feature work.
- AUD-FE-008 (mobile `getWalletAccountId` ordering) — needs product decision.
- AUD-SEC-001 residuals — protected legacy voting paths; documented-blocked.
- AUD-DB-006 (`update_contestant_vote_stats` repurposed body breaks
  `contestant_votes` trigger path) — DB lane, touches protected voting triggers.

## Fixes shipped from these notes

- **PR #404** (branch `fix/agent3-frontend-findings`): deleted the 4 orphaned
  `compliance/*-page.tsx` files + this notes file. Verified: `tsc --noEmit`
  clean, `npm run lint` 0 errors, `npm run test:regression` 131/131 green.
- **PR #406** (branch `fix/agent3-dead-pwa-scaffold`): deleted the dead
  mock-exams PWA/offline-sync cluster listed above (15 files, ~3,880 lines).
  Verified: `tsc --noEmit` clean, `npm run lint` 0 errors,
  `npm run test:regression` 131/131 green, zero remaining references via grep.
