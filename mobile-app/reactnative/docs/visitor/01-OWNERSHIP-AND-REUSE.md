# Visitor Module — Ownership Map & Reuse Inventory

App: `mobile-app/reactnative` (Expo Router, React 19, RN 0.81, react-query, zustand, lucide-react-native).
Anchored by `docs/prd/Visitor.md` (Sections E & F) and `mobile-app/reactnative/DESIGN-Mobile.md`.

This slice implements the **MVP / P0** resident + guard vertical flow end-to-end (create → share → verify → admit/deny → log), with loading/empty/error/success states throughout.

---

## 1. Three-role ownership map (no file touched by two roles)

### Backend (data layer — typed contract first)
| File | Purpose |
|---|---|
| `src/features/visitor/types/visitor.types.ts` | Source-of-truth types: AccessCode, VisitorDetails, VisitEvent, GateSession, RestrictionStatus, inputs, LookupOutcome. |
| `src/features/visitor/constants/visitor.constants.ts` | `VisitorColors` (module semantic colors), `CODE_TYPES` metadata, status/labels/styles, restriction copy, deny reasons. |
| `src/features/visitor/utils/visitorFormatters.ts` | Money (kobo), code grouping, time, effective-status helpers, share-message builder. |
| `src/features/visitor/api/visitor.mock.ts` | In-memory seed data (codes, events, restriction, gate session). |
| `src/features/visitor/api/visitor.api.ts` | API surface (mock-backed, simulated latency, `VisitorApiError`). Signatures are the contract; swapping to HTTP touches only these bodies. |
| `src/features/visitor/hooks/useVisitor.ts` | react-query hooks + centralized `visitorKeys`. The interface the screens code against. |

### Frontend (UI — consumes hooks/types only, never the mock)
| File | Purpose |
|---|---|
| `src/components/ScreenHeader.tsx` | **Shared** back+title header (new — see §3). |
| `src/components/StateView.tsx` | **Shared** loading/empty/error block (new — see §3). |
| `src/features/visitor/components/StatusPill.tsx` | Code status chip. |
| `src/features/visitor/components/CodeTypeSelector.tsx` | Horizontal code-type selector. |
| `src/features/visitor/components/AccessCodeCard.tsx` | Code summary card. |
| `src/features/visitor/components/VisitEventRow.tsx` | Gate-log / history row. |
| `src/features/visitor/components/QrCodeView.tsx` | Branded QR-style visual (see limitations). |
| `src/features/visitor/components/RestrictionBanner.tsx` | Payment-restriction banner. |
| `app/visitor/{_layout,index,create,active,history,restricted}.tsx`, `app/visitor/code/[id].tsx` | Resident screens (Section E). |
| `app/guard/{_layout,index,scan,expected,log}.tsx`, `app/guard/confirm/[code].tsx` | Guard screens (Section F). |
| `app/_layout.tsx` (2-line edit) | Register `visitor` + `guard` stack groups. |
| `src/constants/modules.ts` (2-line edit) | Add Visitors + Gate entry points to the module grid. |

### QA (review only — files no feature code)
| File | Purpose |
|---|---|
| `docs/visitor/03-QA-REPORT.md` | Independent review: reuse, token compliance, state coverage, nav, a11y, bugs. |

**Coordination:** Backend types/hooks were defined first; the two edited shared files (`app/_layout.tsx`, `src/constants/modules.ts`) are additive only. No existing screen was modified, satisfying the brownfield rule.

---

## 2. Existing components/patterns REUSED (not rebuilt)

| Reused | From | Where |
|---|---|---|
| `PrimaryButton` | `src/components` | create, restricted, code detail, confirm success, scan |
| `TextInputField` | `src/components` | create (name/phone/purpose/plate), scan (manual code), confirm (plate) |
| `SectionHeader` | `src/components` | dashboard sections |
| Design tokens `Colors/Typography/Spacing/Radius/shadows` | `src/constants` | every file |
| `features/<module>` structure (types/constants/utils/api/hooks/components) | `src/features/voting` | entire visitor module mirrors it |
| Module-scoped color constants (`VotingColors`) | `src/features/voting/constants` | precedent for `VisitorColors` |
| react-query hook pattern + `generateIdempotencyKey` | `src/features/voting/hooks`, `src/utils/idempotency` | `useVisitor.ts` |
| Expo Router stack-group pattern | `app/services/_layout.tsx` | `app/visitor/_layout.tsx`, `app/guard/_layout.tsx` |
| `ModuleCard`/`SERVICE_MODULES` grid | `src/constants/modules.ts` | entry points |

---

## 3. Built NEW (nothing suitable existed) — with rationale

| New | Why nothing fit | Convention matched |
|---|---|---|
| `ScreenHeader` (shared) | No back-navigation header existed; `AppHeader` is the home greeting bar. services/voting/doctor each re-implemented an inline `ArrowLeft` header. | Default export, token-based styles, `lucide` icons — identical to other components. Promotes shared reuse across modules (per your guidance). |
| `StateView` (shared) | No generic loading/empty/error block existed (screens styled states inline). | Wraps `PrimaryButton`; token-based. Reusable by any module. |
| Visitor-specific components (StatusPill, CodeTypeSelector, AccessCodeCard, VisitEventRow, QrCodeView, RestrictionBanner) | Domain-specific to visitor codes; no equivalents. | File structure, prop naming, and styling mirror existing components; module-scoped (live under `features/visitor/components`, like `features/voting/components`). |

Per your direction ("each module may have its own component, but identify reusable shared components"): **ScreenHeader** and **StateView** were deliberately placed in the shared `src/components` so other modules (telemedicine, restaurant, etc.) can adopt them; everything visitor-specific stays inside `features/visitor`.
