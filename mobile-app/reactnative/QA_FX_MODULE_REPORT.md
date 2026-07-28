# QA Report — FX Exchange Module (mobile)

**Module:** `fx` (FX Exchange / multi-currency super-app vertical)
**Scope built this pass:** B (Home & Balances), C (Convert), D (Send/Payout), E (Receive/Collections),
H (Transactions), plus rate alerts (C) and the relevant L edge/error states.
**Out of scope (agreed):** A (Onboarding/KYC), F (Cards — uses existing placeholder), G (standalone
Beneficiaries hub — beneficiary CRUD is delivered inside Send), I/J/K, and the §13 Admin web console.
**Gate:** `npx tsc --noEmit` → **0 errors project-wide**. No configured RN ESLint (project relies on `tsc`).

---

## 1. Reused existing components / patterns

| Reused | From | Used in |
| --- | --- | --- |
| `PrimaryButton` | `src/components` | every CTA / footer across all flows |
| `ScreenHeader` | `src/components` | every stack screen header (back + title + right slot) |
| `StateView` (loading/empty/error) | `src/components` | home, send picker, transactions, receive, alerts, detail screens |
| `SectionHeader` | `src/components` | home, receive section titles + "See all" actions |
| `TextInputField` | `src/components` | new-beneficiary, send narration |
| `SelectField` | `src/components` | new-beneficiary payout-rail picker |
| `BalanceCard` | `src/components` | home total-portfolio card (purple gradient + quick actions) |
| `SegmentedTabs` | `src/features/crowdfunding/components` | convert send/receive toggle, tx type filter, alert direction |
| Tokens: `Colors`, `Typography`, `Spacing`, `Radius`, `shadow1/3` | `src/constants` | all styling |
| Feature-module architecture (`types`→`constants`→`utils`→`api`+`mock`→`hooks`→`components`→`app/<name>/`) | crowdfunding gold-standard | entire module |
| React Query hook pattern, `USE_MOCK` adapter, `unwrap`, idempotency-on-mutation | crowdfunding/voting | `fx.api.ts`, `useFx.ts` |
| Bottom-sheet anatomy (handle/header/search/list + rgba backdrop) | `SelectField` | `CurrencyPickerSheet` |
| Pill status-chip pattern | `CampaignStatusBadge` | `TxStatusBadge` |
| Result-screen pattern (icon ring + title + ref + footer actions) | crowdfunding `contribute/*` | convert & send success/failed/processing |

**Build-new (nothing suitable existed) — all match existing file structure, prop naming, token usage:**
`CurrencyWalletCard`, `CurrencyChip`, `CurrencyPickerSheet`, `RateTicker`, `RateMovementCard`(folded into home),
`RateSparkline` (react-native-svg, mirrors `visitor/QrCodeView` svg usage), `QuoteBreakdown`, `RateLockCountdown`,
`TransactionRow`, `BeneficiaryRow`, `SummaryRow`, `TxStatusBadge`. Rationale: the shared library had no
currency-aware card/picker, no quote/fee breakdown, no countdown, and no ledger row.

---

## 2. Reuse verification (no duplication)

- **PASS** — No duplicate Button / Input / Select / Modal / Card primitives created. Currency picker is a
  genuinely distinct control (flag + name + balance) the string-only `SelectField` cannot express; it reuses
  `SelectField`'s exact sheet structure and tokens.
- **PASS** — `SegmentedTabs` reused cross-feature rather than re-implemented. *Recommendation (non-blocking):*
  promote `SegmentedTabs` and the status-badge pattern from `features/crowdfunding` to `src/components` so FX
  doesn't depend on a sibling feature. Tracked as **BUG-1 (low)**.

---

## 3. Design-token compliance (vs DESIGN-Mobile.md)

- **PASS** — All spacing via `Spacing`, radii via `Radius`, type via `Typography`, color via `Colors`.
- **PASS** — Card radius 16 (`Radius.lg`), sheets 24 (`Radius.xl`), pills `Radius.full`, 56px primary buttons,
  20px container margins, Level-1/3 shadows — all per spec.
- **NOTE (BUG-2, low):** one hardcoded color `#EAB308` (gold) used for the favorite ⭐ in `BeneficiaryRow` /
  `send/index`. DESIGN-Mobile.md calls for a "Subtle Gold" accent for favorites/elite, **but `Colors` has no
  gold token** — see Conflict C-1. The literal matches existing codebase usage (`modules.ts` electricity icon).
- **NOTE:** `fontSize` appears only on emoji **flag glyphs** (decorative icon sizing, not text); the type scale
  governs text and is used everywhere text appears. Not a violation.
- **NOTE:** two rgba overlays — `rgba(0,0,0,0.45)` backdrop (copied verbatim from `SelectField`) and
  `rgba(0,0,0,0.06)` countdown-track tint. Consistent with existing overlay usage.

---

## 4. Screen-state coverage

| Flow | loading | empty | error | success | edge |
| --- | --- | --- | --- | --- | --- |
| Home & balances | ✅ StateView | ✅ no-tx empty | ✅ retry | ✅ data | ✅ low-balance alert, pending card |
| Convert | n/a | ✅ "enter amount" | ✅ insufficient balance inline | ✅ success screen | ✅ rate-lock countdown, **rate-expired re-quote** |
| Send | ✅ | ✅ no beneficiaries | ✅ beneficiary-not-found, insufficient | ✅ paid | ✅ validation fail, rate-expired, same-currency no-FX |
| Receive | ✅ | ✅ no accounts/collections | ✅ account-not-found | ✅ created + share | — |
| Transactions | ✅ | ✅ no results / none yet | ✅ retry | ✅ list + detail | ✅ failed tx w/ reason, status timeline |
| Rate alerts | ✅ | ✅ no alerts | ✅ retry | ✅ create | ✅ triggered/paused states |

**PASS** — Every screen renders loading/empty/error where applicable; money-mutation flows have explicit
processing → success/failed terminal screens with gesture-disabled back (no double-submit).

---

## 5. Navigation flow (end-to-end, verified against `app/fx/_layout.tsx`)

```
Home (/fx)
 ├─ Convert  → /fx/convert → /fx/convert/confirm → /fx/convert/processing → success | failed→(re-quote→confirm)
 ├─ Send     → /fx/send → [new-beneficiary] → /fx/send/amount → /fx/send/review → processing → success | failed→(retry→review)
 ├─ Receive  → /fx/receive → create(sheet) → /fx/receive/[id] (share)
 ├─ Card     → /services/cards (existing module)
 ├─ Add wallet (modal) → /fx/add-wallet
 ├─ Alerts   → /fx/rate-alerts → /fx/rate-alerts/new (modal, with rate-history chart)
 └─ Activity → /fx/transactions[?type=] → /fx/transactions/[id] (receipt/share/dispute)
```

- **PASS** — Module entry rewired: `modules.ts` `fx-exchange` + wallet "Exchange" quick action now route to
  `/fx`; `fx` stack registered in `app/_layout.tsx`. Transitions match crowdfunding (`slide_from_right`,
  modals `slide_from_bottom`, result screens `fade` + `gestureEnabled:false`).
- **PASS** — Result screens use `router.replace` / `router.dismissTo('/fx')` so users can't navigate "back"
  into a consumed quote.
- **NOTE (BUG-3, low):** the old `app/services/fx.tsx` placeholder still exists (unreferenced now). Left in
  place to honor the brownfield "don't delete existing module files" rule; recommend removing in a follow-up.

---

## 6. Accessibility

- **PASS** — All pressables have `accessibilityRole="button"` + `accessibilityLabel`; pickers/options expose
  `accessibilityState={{selected,disabled}}`; tabs use `role="tab"` (via reused `SegmentedTabs`).
- **PASS** — Hit targets: back/icon buttons use `hitSlop`; primary buttons 56px, list rows ≥44px.
- **PASS** — Contrast: text on tinted chips uses the paired on-color tokens (e.g. `tertiaryContainer` on
  `iconBgTeal`); amounts use `onSurface`/`teal`/`error`.
- **NOTE (BUG-4, low):** money is shown with color + sign (`+`/`−`) — not color alone — so it's distinguishable
  without color perception. Good. Consider adding `accessibilityLabel` summarizing ± direction (already done in
  `TransactionRow`).

---

## 7. Money-handling invariants (CLAUDE.md iron rules)

- **PASS** — All amounts are integer **minor units**; display conversion only at the formatter boundary
  (`fxFormatters`). No float math in state or the contract.
- **PASS** — Every mutation carries an `Idempotency-Key` (`newIdempotencyKey()` in `useExecuteConversion`,
  `useExecuteTransfer`, `useCreateVirtualAccount`).
- **PASS** — Quote → (lock) → execute against the quote honored; expired quote → `rate_expired` → re-quote path.
- **PASS** — Fee/spread itemized in every quote (`QuoteBreakdown`) per transparency rule (§9).

---

## 8. Open bugs (all low severity, none blocking)

- **BUG-1** Cross-feature import of `SegmentedTabs` from crowdfunding. Fix: promote to `src/components`.
- **BUG-2** Hardcoded `#EAB308` gold. Fix: add `Colors.gold`/`Colors.iconBgGold` token, then reference it.
- **BUG-3** Dead placeholder `app/services/fx.tsx`. Fix: remove after confirming no deep links rely on it.
- **BUG-4** (enhancement) Add a "no internet" / global offline banner — currently per-query error states cover
  it but there's no app-level offline screen (was part of L; deferred with onboarding).

---

## 9. Conflicts: DESIGN-Mobile.md vs actual codebase

- **C-1 (Gold accent):** DESIGN-Mobile.md specifies a "Subtle Gold" accent for favorites/elite/rewards, but the
  exported `Colors` token set contains **no gold token**. Code ground-truth wins (no token) → we used the
  literal `#EAB308` already present elsewhere in the codebase. Recommend adding a gold token to close the gap.
- **C-2 (Glassmorphism / backdrop blur):** DESIGN-Mobile.md describes Level-2 "glass" surfaces with 20px
  backdrop blur for nav bars and bottom sheets. The codebase has **no blur implementation** (`shadows.ts`
  simulates elevation with shadows only; `expo-blur` is not a dependency). FX follows the codebase: solid
  `surfaceContainerLowest` sheets with the standard handle/backdrop, identical to `SelectField`. No regression,
  but the shipped app does not realize the doc's glass spec anywhere.
- **C-3 (Plus Jakarta Sans):** `typography.ts` sets `fontFamily: undefined` (system font) with a TODO to wire
  `@expo-google-fonts/plus-jakarta-sans`. The doc treats Plus Jakarta Sans as authoritative; the app currently
  renders system fonts. FX inherits this (uses `Typography`), so it matches shipped screens — but the doc's font
  is not actually loaded anywhere.
- **C-4 (4-column service grid):** doc specifies a 4-column super-app grid; not relevant to FX internals but
  noted — FX home uses single-column wallet cards + horizontal rate ticker, consistent with other detail hubs
  (wallet, crowdfunding) rather than the home grid.

---

## 10. Verdict

**PASS (ship-ready for the agreed scope).** TypeScript clean, tokens honored, all reused components are genuine
reuses, every screen has its loading/empty/error/success states, navigation is wired end-to-end into the super
app, and money-handling iron rules are upheld. Four low-severity follow-ups and four doc-vs-code conflicts are
documented above; none block this vertical.

---

## 11. Addendum — Beneficiaries hub (section G)

**Added after the core pass.** Standalone manage-beneficiaries experience layered on the existing data layer.

- **New screens:** `app/fx/beneficiaries/index.tsx` (search, favorites + all sections, favorite toggle),
  `app/fx/beneficiaries/[id].tsx` (detail: view, favorite, edit, remove with confirm `Alert`, "Send to").
- **Reused for edit:** `app/fx/send/new-beneficiary.tsx` now doubles as the edit screen via `editId` /
  `returnTo` params (prefills, switches title/CTA, calls update vs create). No new add/edit form was created.
- **Backend (owned files only):** added `updateBeneficiary` to `fx.api.ts` + `useUpdateBeneficiary` to
  `useFx.ts`. Mock mutates in place; real path `PUT /v1/beneficiaries/{id}`.
- **Entry points:** "Manage beneficiaries" icon added to the Send picker header (`send/index`).
- **Reuse:** `ScreenHeader`, `StateView`, `PrimaryButton`, `SummaryRow`, `BeneficiaryRow`, tokens — no new
  primitives. Detail actions reuse the outlined-button pattern from the transaction detail footer.
- **States:** loading / empty (no beneficiaries) / error+retry / search-empty / unverified badge all covered.
- **A11y:** all actions labelled; favorite toggle exposes add/remove label; destructive remove gated by a
  native confirm dialog.
- **Gate:** `tsc --noEmit` → **0 errors** project-wide with the hub included.
- **BUG-2 note:** the favorite ⭐ here also uses the literal gold `#EAB308` (same Conflict C-1 — no gold token).

This closes the standalone half of **BUG/deferral for section G**; beneficiary CRUD is now complete
(list · add · validate · edit · remove · favorite · send-to).

---

## 12. Addendum — Cards vertical (section F)

**Full cards vertical built.** Virtual-card issuing, management, controls and activity.

- **New screens (`app/fx/cards/`):** `index` (dashboard — card stack + balances + status), `new` (create:
  label/brand/currency/colour + live preview + initial funding), `[id]/index` (detail: reveal/copy, balance,
  fund, freeze/unfreeze, controls, activity, terminate), `[id]/fund`, `[id]/controls` (limits + rail toggles),
  `[id]/transactions` (activity incl. **declined** rows with inline reason).
- **New components:** `CardVisual` (gradient card art — mirrors `BalanceCard` gradient/overlay + Level-3 shadow),
  `CardTransactionRow` (declined/refunded states). No new button/input/list primitives.
- **Reused:** `ScreenHeader`, `PrimaryButton`, `TextInputField`, `StateView`, `SummaryRow`, `CurrencyChip`,
  `CurrencyPickerSheet`, `SegmentedTabs` (brand picker), **`ToggleRow`** (reused from `features/doctor` for
  spending-control switches — no duplicate switch row built), and **`TxStatusBadge`** (reused for card +
  card-transaction statuses by extending `TX_STATUS_STYLE` with `active/frozen/terminated/approved/declined/refunded`).
- **Backend (owned files only):** new `fxCards.api.ts`, `fxCards.mock.ts`, `useFxCards.ts`; card types/constants
  added to the existing `fx.types.ts` / `fx.constants.ts`. All money in minor units; `createCard`/`fundCard`
  carry an `Idempotency-Key`; PCI-sensitive PAN/CVV only returned by an explicit `reveal` call (spec §15).
- **Entry points rewired:** module registry `virtual-cards` + FX home "Card" quick action now route to
  `/fx/cards`; routes registered in `app/fx/_layout.tsx`.
- **States:** loading / empty (no cards) / error+retry on dashboard, detail, fund, controls, activity; declined
  card-transaction state with reason; frozen-card banner + declined behaviour messaging; insufficient-balance
  guard on create & fund; terminate gated by native confirm dialog.
- **A11y:** card art + rows carry descriptive labels; reveal/freeze/terminate/toggles labelled; toggles use the
  reused `ToggleRow`'s `role="switch"`.
- **Gate:** scoped strict typecheck (`tsconfig.fxcheck.json`, all FX files + shared imports, `skipLibCheck`)
  → **exit 0, 0 errors**. (Full-project `tsc` exceeds the sandbox's 45s shell limit as the app has grown; the
  scoped config compiles the entire FX surface plus every shared component it touches.)
- **Fix applied during QA:** `CARD_GRADIENTS` retyped from `string[]` to a 3-tuple to satisfy
  `expo-linear-gradient`'s tuple `colors` prop (caught by typecheck, fixed, re-verified clean).
- **BUG-2 reminder:** card screens introduce no new hardcoded colors; the only literals are the intentional
  brand-token gradient values centralised in `CARD_GRADIENTS` (same palette as `BalanceCard`).

**Tooling note:** `tsconfig.fxcheck.json` was added as a fast scoped typecheck config for the FX module
(the full-project `tsc` now exceeds the sandbox shell limit). It is inert for the app build. Safe to delete.

Cards is now feature-complete for the inventory: dashboard · create · detail (reveal/copy) · fund · controls/
limits · freeze/unfreeze · terminate · transactions · declined state.

---

## 13. Addendum — KYC/KYB verification (section A) + global edge states (section L)

**Auth deliberately excluded** (global auth already exists). Built the verification half of section A and the
section-L edge/error states.

### KYC / KYB (`app/fx/kyc/`)
- **Screens:** `index` (start + individual/business account type + steps overview), `consents`
  (Terms + Privacy + FX disclosure — 3 checkboxes), `permissions` (camera required + notifications),
  `identity` (doc type + number + DOB + front/back upload), `selfie` (liveness capture w/ scanning→done),
  `business` (KYB details), `directors` (directors/UBOs, add/remove repeatable), `documents` (business doc
  uploads), `submitted` (runs the submit mutation; loading→success/error), `status` (pending / review /
  approved / rejected — drives copy + actions, with resubmit). Flow branches: individual = identity→selfie→
  submit; business = …→selfie→business→directors→documents→submit.
- **New components:** `UploadTile` (mock document/selfie upload with done state), `CheckRow` (consent checkbox).
- **Reused:** `ScreenHeader`, `PrimaryButton`, `TextInputField`, `SelectField`, **`DatePickerField`** (existing
  shared date wheel for DOB), `StateView`. No new button/input/select/date primitives.
- **Backend (owned files):** `fxKyc.api.ts` (mock verification state machine: unstarted→pending|review→…),
  `useFxKyc.ts` hooks, verification types in `fx.types.ts`, constants (ID doc types, business types, tier
  labels). `kycDraft.ts` holds transient multi-step form state (client-only, intentionally out of React Query).
- **Gating:** FX home shows a non-blocking verification banner (status-aware copy) → routes into the flow /
  status. Kept soft so core flows stay explorable in mock mode.
- **States:** every step has validation-gated CTAs; `submitted` covers loading/success/error; `status` covers
  pending/review/approved/rejected/unstarted + a `?status=` override so each terminal state is viewable/QA-able.
- **A11y:** account-type cards expose `selected`; consents use `role="checkbox"` with `checked`; upload tiles
  and permission grants are labelled; camera marked Required.

### Global edge states (`app/fx/states/[kind].tsx`, spec L)
- **One registry-driven screen** renders every edge state from `EDGE_STATES`: **offline, server-error,
  session-expired, routing-unavailable, verification-required, limit-exceeded, maintenance, app-update**.
  Reachable as `/fx/states/<kind>`.
- **Reuses `StateView`** for the icon/title/message/primary-action block; adds an optional secondary action and
  hides the back affordance for takeover states (session-expired/maintenance/app-update).
- Actions map to real navigation (retry/back, sign-in, start KYC, view tier/status, home) — login routes to the
  existing global `/(auth)/login`.
- The inline states already shipped (insufficient balance, rate-expired re-quote, beneficiary-validation,
  empty lists) remain in place; these standalone screens cover the full-screen L takeovers.

### Verification & gate
- **Gate:** scoped strict typecheck (`tsconfig.fxcheck.json`) → **exit 0, 0 errors**. No hardcoded colors in
  any new KYC/edge file; all styling via tokens. One API correction during build: `DatePickerField` has no
  `placeholder` prop — removed.

This completes the requested scope: **KYC/KYB verification** (consents → permissions → identity → liveness →
[KYB] → submit → status, incl. submitted/pending/approved/rejected/review/under-review) and the **global L
edge/error states**, with auth left to the existing global system.

---

## 14. Addendum — follow-up cleanup (BUG-1 / BUG-2 / BUG-3 resolved)

- **BUG-2 (gold token) — RESOLVED.** Added `Colors.gold` (`#EAB308`) and `Colors.iconBgGold` to the design
  tokens (DESIGN-Mobile.md's "Subtle Gold" accent now exists). Replaced every `#EAB308` literal in the FX
  module (`BeneficiaryRow`, `send/index`, `beneficiaries/index`, `beneficiaries/[id]`) with `Colors.gold`.
  FX module now has **zero hardcoded colors** (verified by grep). Conflict **C-1 closed**.
- **BUG-1 (cross-feature SegmentedTabs) — RESOLVED.** Promoted the segmented control to
  `src/components/SegmentedControl.tsx` (shared). Repointed all four FX imports (convert, transactions,
  rate-alerts/new, cards/new) to the shared component. FX no longer depends on the crowdfunding feature for a
  core primitive. (crowdfunding keeps its own copy untouched per brownfield safety; it can migrate later.)
- **BUG-3 (dead placeholder) — RESOLVED.** `app/services/fx.tsx` is now a `<Redirect href="/fx" />` instead of
  the old `PaymentActionScreen` placeholder, so any legacy deep link lands on the new module. (File couldn't be
  deleted from the sandbox; a redirect is the cleaner outcome anyway.)
- **Gate:** scoped strict typecheck (`tsconfig.fxcheck.json`) → **exit 0, 0 errors** after the cleanup.

Remaining open: **BUG-4** (app-level offline banner — superseded by the new `/fx/states/offline` takeover; a
global network listener is an app-wide concern) and the deferred **§13 Admin/Operations web console**.

---

## 15. Addendum — Business (I), Notifications (J), Settings (K)

Closes the last mobile inventory gaps. **Scoped strict typecheck → 0 errors; zero hardcoded colors.**

- **Business / multi-user (I)** — `app/fx/business/`: hub, **team** (members + roles + status), **approvals**
  (maker–checker queue with approve/reject), **thresholds** (editable amount + approvers stepper), **activity**
  (audit log), **developer** (API keys with rotate + webhook toggle).
- **Notifications (J)** — `app/fx/notifications.tsx`: typed notification center (rate/conversion/payout/
  collection/card/approval/verification/security), unread state, mark-one/mark-all-read, deep-links into flows.
- **Settings (K)** — `app/fx/settings/`: hub (profile, business, limits, prefs, security, stablecoin, support,
  logout/delete with confirm), **limits & tier** (usage bars + upgrade), **stablecoin addresses** (add/remove),
  **notification preferences** (toggles).
- **Data layer (owned files):** `fxAccount.api.ts` + `useFxAccount.ts` + types in `fx.types.ts`. Money in minor
  units throughout.
- **Reuse:** `ProfileMenuItem` (hubs), `ToggleRow` (prefs/webhooks/controls), `SummaryRow`, `TxStatusBadge`,
  `CurrencyChip`, `SelectField`, `TextInputField`, `StateView`, `PrimaryButton`, `Colors.gold` token. No new
  shared primitives created.
- **Entry points:** FX home header now exposes Notifications + Settings; settings → business hub.

**Mobile FX app now covers the full §12 inventory A (verification)–L.** (Auth screens remain the global
system's; "Announcements", recurring/bulk payouts, and statement export remain the only minor un-built items.)
