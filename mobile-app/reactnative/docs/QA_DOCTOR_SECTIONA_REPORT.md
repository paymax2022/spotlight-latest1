# QA Report — Doctor Section A (Splash, Onboarding & Authentication)

**Scope:** 20 entries — splash/welcome, intro carousel, merchant upgrade, provider-type
choice, three builder hand-offs (REUSE), five legal consents, four OS permissions,
four account states (REUSE Batch 7). Consolidated build with heavy reuse.
**Reviewer:** QA agent (evidence-based, read-only).
**Date:** 2026-06-21.

---

## Summary verdict

**PASS — ship-ready.** All 20 entries are covered (full screen / consolidated screen /
documented reuse). Backend contract is honoured (hooks-only in screens, mutations omit
`idempotencyKey`, no direct api imports, no new deps). Provider-type routing, consent
versioning, and the reserved-`ref` sweep all pass. Navigation is fully connected with no
orphans, no dead links, and no Expo Router collisions. The few findings are Minor (one raw
`fontSize`, two cosmetic UX nits).

| Severity | Count |
|----------|-------|
| Blocker  | 0 |
| Major    | 0 |
| Minor    | 3 |

**Coverage: 20/20.**
**Doctor-scoped tsc grep:** `npx tsc --noEmit 2>&1 | grep -iE "doctor|onboarding|\(doctor\)"`
→ **empty, process exit 0 within the 40s bound = PASS** (not a timeout; full run completed
clean for doctor scope). Pre-existing unrelated `src/features/fx/**` error not in doctor
scope. Inert empty `tsdoctor*.tmp.json` files at app root = cleanup note, not a defect.
**Provider-type routing: PASS. Consent versioning: PASS. Reserved-`ref` sweep: PASS.
All 6 new components used: YES. Nav orphans / dead links / collisions: NONE.**

---

## Per-entry coverage table (20 entries)

| # | Entry | How covered | Verdict |
|---|-------|-------------|---------|
| 1 | Splash + Welcome | `onboarding/index.tsx` — timed splash→welcome phase, two CTAs (lines 16–60) | PASS |
| 2 | App intro carousel | `onboarding/intro.tsx` + `OnboardingSlidePager` (paged ScrollView, `pagingEnabled`, `onMomentumScrollEnd` index tracking) + `CarouselDots`; data from `useOnboardingSlides` | PASS |
| 3 | Upgrade to Merchant | `onboarding/upgrade-merchant.tsx` — `useMerchantUpgradeStatus` + `useRequestMerchantUpgrade` (lines 44–56) | PASS |
| 4 | Choose provider type | `onboarding/provider-type.tsx` — selectable `ProviderTypeCard` list over `PROVIDER_TYPE_OPTIONS`, `useSelectProviderType` (lines 36–50) | PASS |
| 5 | Doctor profile update | REUSE — `onboarding/builder.tsx` routes `doctor` → `/(doctor)/profile/setup` (Section B), file exists | PASS |
| 6 | Specialist doctor | REUSE — `builder.tsx` routes `specialist` → same Section B builder; meta copy notes specialty is mandatory (lines 30–34, 47–56) | PASS |
| 7 | Veterinary doctor | REUSE — `builder.tsx` routes `veterinarian` → `/(doctor)/vet/profile/setup` (Section C/Batch 1), file exists (lines 51–53) | PASS |
| 8 | Terms of service | One consent screen `consent/[kind].tsx`, keyed by `LegalDocKind`; versioned acceptance | PASS |
| 9 | Medical privacy | Same `consent/[kind].tsx` (kind=`medical_privacy`) | PASS |
| 10 | HIPAA / data protection | Same `consent/[kind].tsx` (kind=`hipaa_data_protection`) | PASS |
| 11 | Professional conduct | Same `consent/[kind].tsx` (kind=`professional_conduct`) | PASS |
| 12 | Telemedicine policy | Same `consent/[kind].tsx` (kind=`telemedicine_policy`); hub `consents.tsx` lists all 5 from `useConsentStatus` | PASS |
| 13 | Notification permission | One primer `permissions/[kind].tsx`, keyed by `AppPermissionKind`; `useRecordPermissionDecision` | PASS |
| 14 | Camera permission | Same `permissions/[kind].tsx` (kind=`camera`, required) | PASS |
| 15 | Microphone permission | Same `permissions/[kind].tsx` (kind=`microphone`, required) | PASS |
| 16 | Location permission | Same `permissions/[kind].tsx` (kind=`location`) | PASS |
| 17 | Account pending | REUSE — `onboarding/submit.tsx` via `useOnboardingAccountStatus` (Batch 7 alias) + link to `/(doctor)/account-status` | PASS |
| 18 | Account rejected | REUSE — same `submit.tsx`, `AccountState='rejected'` | PASS |
| 19 | Account suspended | REUSE — same `submit.tsx`, `AccountState='suspended'` | PASS |
| 20 | Account under review | REUSE — same `submit.tsx`, `AccountState='under_review'` | PASS |

No entry is unimplemented.

---

## Check 1 — Spec coverage
**PASS (20/20).** Verified against `DOCTOR_SECTIONA_OWNERSHIP_MAP.md`:
- Entry 2 carousel genuinely pages slides: `OnboardingSlidePager.tsx:41–60` uses a
  horizontal `pagingEnabled` ScrollView and computes the active index from
  `contentOffset.x` on `onMomentumScrollEnd`.
- Entries 8–12 are the single `consent/[kind].tsx`; acceptance passes the live document
  version: `accept.mutateAsync({ kind, version: doc.version })` (`consent/[kind].tsx:48`).
- Entries 13–16 are the single `permissions/[kind].tsx`; outcome recorded via
  `record.mutateAsync({ kind, state })` (`permissions/[kind].tsx:63`).
- Entries 5/6/7 route into the existing builders (`builder.tsx:51–55`), both targets exist.
- Entries 17–20 link to the existing `account-status` screen (`submit.tsx:92`).

## Check 2 — Provider-type routing
**PASS.** `builder.tsx:47–56` `openBuilder(t)`: `veterinarian` →
`/(doctor)/vet/profile/setup`; `doctor`/`specialist` → `/(doctor)/profile/setup`. The type
is persisted by `useSelectProviderType` (`provider-type.tsx:43`) onto
`MerchantUpgradeStatus.selectedType` and read back in `builder.tsx:45`. Note (by design):
`provider-type.tsx` does NOT route straight to a builder — it advances to the consent gate
first; the doctor/specialist-vs-vet split happens at `builder.tsx` after permissions, which
matches the documented flow order.

## Check 3 — Consent versioning
**PASS.** `acceptConsent` is called with `doc.version` (not hardcoded) at
`consent/[kind].tsx:48`. The checkbox label surfaces the version (`...(v{doc.version})`,
line 101) and `alreadyAccepted` compares against `r.version === doc?.version` (line 35–37),
so a superseded version re-prompts. The hub reflects accepted/outstanding from
`useConsentStatus` (`consents.tsx:23–28`, progress + per-row "Accepted"/"Tap to review").

## Check 4 — Reserved-prop sweep
**PASS.** No prop named `ref` in any of the 6 new components (grep returned none), and no
`ref={` call site in the onboarding screens. `ProviderTypeCard` intentionally uses
`selected` (documented at line 22).

## Check 5 — Reuse vs duplication
**PASS.** All 6 new components are genuinely new and all are used:
- `OnboardingSlidePager` — used in `intro.tsx:57`. New (no existing paged carousel).
- `CarouselDots` — used inside `OnboardingSlidePager:62`. New (WizardProgress is a fill bar).
- `ProviderTypeCard` — used in `provider-type.tsx:67`. New (radio-style selectable surface).
- `ConsentDocView` — used in `consent/[kind].tsx:82`. New (multi-section legal doc renderer).
- `PermissionPrimer` — used in `permissions/[kind].tsx:107`. New (rationale primer block).
Screens correctly reuse shared primitives — `StateView`, `SectionCard`, `StatusBadge`,
`WizardProgress`, `DisclaimerBanner`, `InfoRow`, `PrimaryButton`, `TeleHeader` — rather than
re-implementing them. The profile builders and account-status screen are linked, not
recreated (`builder.tsx`, `submit.tsx`). No duplicates found.

## Check 6 — Design-token compliance
**Mostly clean — 1 Minor violation.** No raw hex (excluding rgba) in any new screen or
component. All colour tokens used resolve in `src/constants/colors.ts`. Spacing/radius use
`Spacing.*`/`Radius.*`. Icon-box `width`/`height` use raw px (e.g. 56/40/96/112) — this is
the established pattern across all prior passed batches (square icon containers), so not a
new violation.
- **MINOR:** `onboarding/index.tsx:66` `brand: { ...Typography.displayLg, ..., fontSize: 36, lineHeight: 44 }` — a raw `fontSize`/`lineHeight` override of the typography token.

## Check 7 — Screen states
**PASS.** Every data-backed screen gates loading/error and renders content/empty:
- `intro.tsx:49–54` loading / error / empty (empty when no slides) / success.
- `upgrade-merchant.tsx:62–66`, `provider-type.tsx:56–59`, `consents.tsx:36–39`,
  `permissions/index.tsx:63–66`, `submit.tsx:59–62` — loading + error with `onRetry`.
- `consent/[kind].tsx` — invalid-kind empty (55–62), loading/error (68–71), `allAccepted`
  reflected via `alreadyAccepted` button state.
- `permissions/[kind].tsx` — invalid-kind empty (85–92), loading/error (100–103).
- Consent "all done" handled as a success banner (`consents.tsx:52–57`), not an empty list,
  per the contract convention.

## Check 8 — Navigation
**PASS — orphans: NONE; dead links: NONE; collisions: NONE.**
- Every onboarding route in `_layout.tsx:11–20` has ≥1 caller:
  `onboarding/index` ← `signup/index.tsx:62`; `intro`, `upgrade-merchant`, `provider-type`,
  `consents`, `consent/[kind]`, `permissions/index`, `permissions/[kind]`, `builder`,
  `submit` all reached via `router.push` (verified by grep of push targets).
- Every `router.push/replace` target resolves to a registered route or existing screen
  (`profile/setup`, `vet/profile/setup`, `account-status` all exist).
- Flow connects: splash → intro → upgrade → provider-type → consents → consent/[kind] →
  permissions → permissions/[kind] → builder → (profile/setup | vet/profile/setup) →
  submit → account-status. `signup/index.tsx` links into onboarding (line 62) and also
  retains its direct `profile/setup` link.
- No Expo Router collisions: `permissions/index.tsx` + `permissions/[kind].tsx` are an
  index + dynamic sibling (valid); `consent/[kind].tsx` is a lone dynamic route (valid).
  Both `permissions/index` and `permissions/[kind]` are registered distinctly in
  `_layout.tsx:18–19`.

## Check 9 — Accessibility
**PASS (sampled).** Icon-only Skip is wrapped in a labelled `Pressable`
(`intro.tsx:47`, role button). Selectable cards expose `accessibilityRole="radio"` +
`accessibilityState` + `accessibilityLabel` (`ProviderTypeCard.tsx:29–31`). Consent
checkbox uses role `checkbox` + checked state + label (`consent/[kind].tsx:93–95`).
Permission/consent list rows are labelled buttons. `CarouselDots` exposes
`accessibilityRole="adjustable"` with min/max/now value (`CarouselDots.tsx:17`).
`numberOfLines` present on truncatable card titles/descriptions (ProviderTypeCard, row
labels). Touch targets: list rows and CTAs meet ≥44 via padding/`PrimaryButton`; the
provider-type icon box and signup doc rows use 44/56 min heights.

## Check 10 — Contract adherence
**PASS.** Screens consume hooks only — no `from '@/api/doctor.onboarding.api'` anywhere in
`app/(doctor)/` (grep: none; only `formatKobo`-style pure helpers would be allowed and none
are imported). No `idempotencyKey` referenced in any onboarding screen (grep: none) — the
hooks generate it. Mutations use `mutateAsync` + `isPending` for button state
(`upgrade-merchant.tsx:51/105`, `provider-type.tsx:43/84`, `consent/[kind].tsx:48/112`,
`permissions/[kind].tsx:63/120`). OS permission prompts are SIMULATED via `Alert`
(`permissions/[kind].tsx:72–83`) — no `expo-*` permission deps added. No new npm deps.

## Check 11 — Typecheck
**PASS (doctor scope).** Doctor-scoped grep over `tsc --noEmit` returned empty with the
process completing (exit 0) inside the 40s bound — not a timeout. Cross-checked by
inspection: all imports resolve to barrels; all consumed prop shapes match
(`StateView` discriminated `variant` union, `StatusBadge` `StatusTone`, `PrimaryButton`
`variant: primary|secondary|ghost`, `WizardProgress`, `DisclaimerBanner`, `InfoRow`,
`TeleHeader.right`); `AccountState = 'unsubmitted'|'pending'|'approved'|'rejected'|
'under_review'|'suspended'` exactly matches the exhaustive `STATE_ICON`/`STATE_TONE`/
`STATE_BG` Records in `submit.tsx`; all lucide icon names used exist in the installed
`lucide-react-native`. The unrelated `src/features/fx/**` error is out of scope. Inert
empty `tsdoctor*.tmp.json` files at app root are a cleanup note only.

## Check 12 — Ownership / no new deps
**PASS.** New/edited frontend files are confined to `app/(doctor)/onboarding/**`,
`app/(doctor)/_layout.tsx`, `app/(doctor)/signup/index.tsx`, and
`src/features/doctor/components/**`. Backend-owned files
(`doctor.onboarding.ts/.api.ts/useOnboarding.ts/onboarding.ts`) plus the two additive
barrel lines (`hooks/index.ts:68`, `constants/index.ts:169`, and components barrel
lines 86–91) match the ownership map. `package.json` unchanged (no new deps).

---

## Prioritized defect list

### Minor
1. **Raw `fontSize`/`lineHeight` override** — `app/(doctor)/onboarding/index.tsx:66`
   `brand: { ...Typography.displayLg, fontSize: 36, lineHeight: 44 }`. Recommended fix:
   drop the raw overrides and use the appropriate `Typography.*` token (e.g.
   `Typography.displayLg` as-is, or add/extend a display token if 36/44 is intended), to
   keep the splash brand size token-driven.

2. **Intro "Next" CTA skips remaining slides** — `app/(doctor)/onboarding/intro.tsx:41–63`.
   The footer button label flips to "Get started" on the last slide, but its `onPress` is
   always `finish` (navigates to upgrade-merchant) regardless of `isLast`. Tapping "Next"
   on slide 1 leaves the carousel instead of advancing. Recommended fix: when `!isLast`,
   advance the pager (drive the ScrollView to the next index, e.g. via a ref/`scrollTo` or a
   controlled index prop) and only call `finish` on the last slide. Non-blocking — swipe
   paging and Skip both work.

3. **WizardProgress shows "Step 0 of N" on the consent/permission hubs** —
   `consents.tsx:50` and `permissions/index.tsx:77` pass `current = acceptedCount /
   decidedCount`, which is 0 before any action; `WizardProgress` renders "Step 0 of 5".
   Cosmetic only (the custom `label` "0/5 accepted" carries the real meaning). Recommended
   fix: either suppress the "Step X of Y" line when used as a completion meter, or pass a
   1-based step; or use a plain progress bar variant for these hubs.

---

## Notes
- `tsdoctor*.tmp.json` inert empty files at app root — cleanup only, not a defect.
- The pre-existing `src/features/fx/**` tsc error is unrelated to Doctor Section A.
- Demo legal copy is explicitly labelled "Demo legal copy" in the consent hub
  (`consents.tsx:47`) — appropriate for the mock phase.

---

## Post-review fix applied

**Minor #2 (intro "Next" finished instead of advancing) — FIXED.** `OnboardingSlidePager`
now accepts an optional host-controlled `activeIndex` prop and scrolls to it via an
internal ScrollView ref (no `ref` component-prop). `onboarding/intro.tsx` passes
`activeIndex={index}` and the "Next" button now advances
(`setIndex(i => min(i+1, last))`), only calling `finish()` on the last slide.
Swipe paging + Skip still work.

Remaining 2 minors left as non-blocking: splash brand `fontSize: 36` override
(consistent with the accepted hero-text override pattern elsewhere) and the
consent/permission hubs passing `current=0` to WizardProgress (cosmetic; the custom
label carries the real count). No raw hex; doctor-tsc scope clean.
