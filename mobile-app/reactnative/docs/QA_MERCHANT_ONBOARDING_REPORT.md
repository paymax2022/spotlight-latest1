# QA Report — Merchant Onboarding & Role-Upgrade (Mobile)

**Feature:** "One identity, many capabilities" — Customer → Merchant/Provider upgrade flow
**Spec:** `Spotlight-Paymax-Onboarding-PRD.md` · **Design source of truth:** `mobile-app/reactnative/DESIGN-Mobile.md`
**Reviewed:** 19 Jun 2026 · **Verdict:** ✅ PASS (mobile) — 1 unverified item is backend-only (no Go toolchain in CI sandbox)

---

## 1. Ownership map (no file touched by two roles)

| Role | Owns (created) | Edited (shared wiring) |
|---|---|---|
| **Backend (data contract)** | `src/types/merchant.ts`, `src/features/merchant/{constants,api,store,hooks}/*` | — |
| **Frontend (screens/nav)** | `app/(merchant)/**`, `src/features/merchant/components/*` | `app/_layout.tsx`, `app/(tabs)/profile.tsx` (nav wiring only) |
| **Backend (Go)** | `backend/internal/onboarding/**`, `supabase/migrations/20260619000000_merchant_onboarding.sql` | `backend/internal/app/{router,finance_routes}.go`, `config/config.go` (router registration) |
| **Admin** | `frontend-admin/app/admin/merchant-onboarding/**`, `src/types/onboarding.ts`, `src/services/onboarding*.ts` | `AdminSidebar.tsx`, `routeGuard.ts` (nav + RBAC registration) |

No two roles edited the same file. ✅

## 2. Reused vs. built-new (mobile)

**Reused as-is (zero duplication):**
- Core: `PrimaryButton`, `TextInputField`, `SelectField`, `DatePickerField`, `ScreenHeader`, `SectionHeader`, `StateView`.
- Doctor feature (generic atoms): `SectionCard`, `InfoRow`, `WizardProgress`, `UploadField`, `ChipMultiSelect`, `ToggleRow`, `StatusBadge` (+ `StatusTone`).
- Tokens: `Colors`, `Typography`, `Spacing`, `Radius`, `shadow1`. Utils: `generateIdempotencyKey`. State: zustand + react-query (same providers).

**Built new (justified — nothing suitable existed):**
- `DynamicField` — schema→input dispatcher (FR-8/9). Builds nothing itself; every branch delegates to a reused input.
- `MerchantTypeCard` — rich selection card with requirements checklist + KYC/SLA meta footer (FeaturedServiceCard is a single-line row; insufficient).
- `CapabilityRow` — switcher row with embedded `StatusBadge` + active-context ring (ProfileMenuItem has no badge/active state).

**Verification:** grep across `app/(merchant)` found **no** locally re-implemented button, input, or card — all delegate to shared components. ✅

## 3. Design-token compliance (vs DESIGN-Mobile.md)

| Check | Result |
|---|---|
| Hardcoded font sizes (`fontSize:`) in new files | **NONE** — all type via `Typography.*` ✅ |
| Hardcoded hex in screens/components | **NONE** ✅ |
| Hex in `merchant.constants.ts` (`#EF4444`,`#F97316`) | **Accepted** — identical to existing `src/constants/modules.ts` module-accent convention (food/ride/telemedicine use the same literals; these accents are intentionally outside the core `Colors` palette) |
| `rgba(255,255,255,0.16)` glass overlay on brand CTA | **Accepted** — matches `BalanceCard.tsx` (`rgba(255,255,255,0.15)` etc.), the established translucent-overlay pattern on primary-filled cards, per DESIGN-Mobile "white fill at opacity" |
| Radius (lg 16 / xl 24 / md 12), Spacing (containerMargin 20, 4px grid) | Match tokens ✅ |

## 4. Screen-state coverage

| Screen | loading | empty | error | success | other states |
|---|---|---|---|---|---|
| Capabilities dashboard | ✅ StateView | ✅ "you're a Customer" hint | ✅ StateView+Retry | ✅ list + switcher | in-flight apps section |
| Module picker | ✅ | ✅ (no open modules) | ✅+Retry | ✅ | closed module = locked/disabled |
| Type picker | ✅ | ✅ (no open types) | ✅+Retry | ✅ | — |
| Onboarding wizard | ✅ "preparing" | — | ✅ start-failed | ✅ submit→status | **duplicate-profile block (FR-7)**, per-field validation, conditional fields, save-draft, multi-step |
| Application status | ✅ | — | ✅+Retry | ✅ | all 6 lifecycle states: DRAFT/SUBMITTED/UNDER_REVIEW/NEEDS_MORE_INFO/APPROVED/REJECTED |

## 5. Navigation flow (end-to-end, static-verified)

`Profile ▸ Become a Merchant` **or** `Capabilities CTA` → `/(merchant)` → `modules` → `types?moduleId=` → `apply/[typeId]` (create draft → steps → submit) → `application/[id]` (polls SUBMITTED→UNDER_REVIEW; APPROVED → back to capabilities, switcher now shows the new provider workspace). `(merchant)` registered in root `app/_layout.tsx`; all 5 routes registered in `app/(merchant)/_layout.tsx`. Every `router.push/replace` target resolves to an existing route. ✅

## 6. Accessibility

- `accessibilityRole`/`accessibilityLabel` on every Pressable (cards, CTA, capability rows, type cards, doc slots, switcher).
- `accessibilityState` for disabled (closed module), selected (active context), checked (multiselect chips).
- Hit targets ≥ 44×44 (CTA 48, rows 44, buttons 56). Back button uses shared `ScreenHeader` (hitSlop 10).
- Status conveyed by **label + tone**, not colour alone (StatusBadge renders text).

## 7. TypeScript

`npx tsc --noEmit -p tsconfig.json` → **EXIT 0, zero errors** across the whole RN app (no regressions from the two wiring edits).

## 8. Pass/Fail summary

| Item | Status |
|---|---|
| Reused components actually reused (not duplicated) | ✅ PASS |
| Design-token compliance | ✅ PASS |
| Each screen state implemented | ✅ PASS |
| Navigation flow end-to-end | ✅ PASS |
| Accessibility (labels/targets/contrast) | ✅ PASS |
| Mobile TypeScript clean | ✅ PASS |
| Admin console type-check | ✅ PASS (reported by admin role) |
| **Go backend `go build`/`go vet`** | ⚠️ **UNVERIFIED** — no Go toolchain + network blocked in sandbox. Code manually reviewed (imports/signatures/braces). **Run `cd backend && go build ./... && go vet ./...` locally to confirm.** |

---

## 9. Design-spec ↔ codebase conflicts (flagged, not "fixed")

1. **Doc filename mismatch.** Brief references `design-mobile.md`; the actual authoritative file is `mobile-app/reactnative/DESIGN-Mobile.md` (different case/location). A separate `DESIGN.md` referenced by `src/constants/colors.ts` is **deleted** in the working tree — that header comment is now stale.
2. **Font not actually loaded.** DESIGN-Mobile.md mandates *Plus Jakarta Sans*, but `src/constants/typography.ts` sets `FONT_FAMILY = undefined` (system font) with a TODO to wire `@expo-google-fonts`. **Code is ground truth** → we consume the `Typography` tokens, which currently render in the system font. Whole app is affected, not just this feature.
3. **Background colour drift inside the doc.** DESIGN-Mobile prose says background `#F8FAFC`; its own YAML frontmatter and `colors.ts` use `#F8F9FF`. We used the token (`Colors.background = #F8F9FF`).
4. **"No hardcoded colors" vs. module accents.** The hard rule conflicts with the shipped `src/constants/modules.ts`, which hardcodes module-accent hex (`#EF4444`, `#F97316`, `#EAB308`) because these sit outside the core token palette. We followed the **existing code convention** for the 2 new module accents; flag for a future "extend the token set" cleanup if strict compliance is desired.
5. **Cross-feature reuse.** Generic wizard atoms (`WizardProgress`, `UploadField`, `ChipMultiSelect`, `StatusBadge`, `SectionCard`, `InfoRow`) live under `src/features/doctor/components`, not a shared dir. We **reused** them (per the no-duplication rule) by importing from the doctor barrel. Consider promoting them to `src/components/` so the coupling reads as intentional shared infrastructure.

---

## 10. Automated tests (added post-review)

Critical pure-logic was extracted into dependency-free modules and unit-tested
(executed, not just authored):

- `src/features/merchant/lib/validation.ts` — form-schema validator (FR-12).
- `src/features/merchant/lib/applicationStateMachine.ts` — guarded transitions (PRD §7.2).
- `src/features/merchant/lib/__tests__/merchant.logic.test.ts` — 9 tests.

**Run:** `npm run test:merchant` (uses Node's native TS type-stripping; no extra deps).

**Result:** `# tests 9 · # pass 9 · # fail 0` ✅

Coverage: required-field enforcement, number range, multiselect cap, email
format, **conditional-visibility gating** (hidden field not required / shown
field required), the full legal transition path, the needs-info loop, and
rejection of illegal transitions (`DRAFT→approve`, `SUBMITTED→approve`,
`APPROVED→reject`). The mock API and the screens now consume these same modules,
so the tested rules are the shipped rules.

> The equivalent Go service tests (state machine + approve→role-grant idempotency)
> remain the one outstanding artifact — deferred only because no Go toolchain is
> available in this environment to execute them.

---

## 11. Go-live wiring + contract alignment (this pass)

- **Flags flipped to live (house convention):** mobile `EXPO_PUBLIC_MERCHANT_USE_MOCK=false`,
  admin `NEXT_PUBLIC_ONBOARDING_ADMIN_USE_MOCK=false`. Both code sites now read the env
  (default mock) exactly like fx/doctor/realtor/mobility. Reversible in one var.
- **Integration bug found & fixed:** onboarding admin routes were under `/api/v1/admin/onboarding`
  but the admin console (per `usersService` convention) calls `/api/admin/onboarding`. Moved the
  Go admin group to `r.Group("/api/admin/onboarding")` and updated the OpenAPI spec. Now aligned.
- **Contract alignment (executed):** 10/10 mobile customer/me endpoints ↔ Go routes ↔ OpenAPI; all
  admin client paths ↔ Go admin routes. Result: **ALIGNED**.
- **Go static verification (executed):** signatures match real middleware/services/domain; braces
  balanced; **no unused imports**; handler→service→repo calls all resolve. Formal `go build`/`go vet`
  still pending a Go toolchain (unavailable in sandbox) — see `docs/merchant-onboarding-golive.md`.
- **Blocked here (no toolchain/CLI/network):** `go build`/`go vet`, `supabase db push`, live e2e —
  runbook provided with exact commands and the canonical approve→role-grant scenario.
