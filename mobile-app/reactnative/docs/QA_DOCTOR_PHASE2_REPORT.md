# QA — Doctor Telemedicine PHASE 2 Review

Reviewer: QA Agent (read-only; no feature code edited)
Scope: 10 new screens (15 route files) + 3 new components (`StatusBadge`,
`StatusTimeline`, `ReviewCard`) + additive nav wiring on the Records/Earnings/
Dashboard/Settings hubs. Phase 1 already passed QA (see
`docs/QA_DOCTOR_MVP_REPORT.md`).

---

## Summary verdict: **PASS-WITH-NOTES**

| Severity | Count |
|----------|-------|
| Blocker  | 0 |
| Major    | 0 |
| Minor    | 5 |

| Check | Result |
|-------|--------|
| 1. Reuse vs duplication | PASS (3/3 new components justified; screens reuse shared primitives) |
| 2. Design-token compliance | PASS (only acceptable rgba overlays + 2 justified font overrides) |
| 3. Screen states | PASS (all 10 screens wire loading/empty/error/success per contract) |
| 4. Navigation flow | PASS (no orphans, no dead links; pharmacy `[id].tsx`+`[id]/` coexistence is SAFE) |
| 5. Accessibility | PASS-WITH-NOTES (1 icon-only Pressable missing label — Minor) |
| 6. Contract adherence | PASS-WITH-NOTES (`useSubmitClaim` wired but no submit-claim UI — Minor) |
| 7. Typecheck (`tsc --noEmit`) | PASS — exit 0, zero errors |
| 8. Ownership boundaries | PASS (Frontend & Backend stayed in lane; additive only) |

**tsc result:** `npx tsc --noEmit` completes with **exit code 0** (no type errors).
This is notably cleaner than Phase 1.

---

## 1. Reuse vs Duplication — PASS

### 1a. The 3 new components (each justified — PASS)

| Component | New? | Verdict | Evidence / reasoning |
|-----------|------|---------|----------------------|
| `StatusBadge` | Yes | **PASS — justified** | `src/features/doctor/components/StatusBadge.tsx:1`. A generic tone-driven pill (`neutral/info/success/warning/danger/brand`) consumed by 8 Phase 2 status unions. The existing `ConsultStatusBadge` (`src/features/telemedicine/components/ConsultStatusBadge.tsx`) is typed strictly to `ConsultStatus` and renders a dot, so it cannot be reused for pharmacy/refill/referral/claim/follow-up/licence/alert statuses. No duplication. |
| `StatusTimeline` | Yes | **PASS — justified** | `StatusTimeline.tsx:1`. A connected node-and-rail vertical timeline used by drug delivery (`pharmacy/[id]/delivery.tsx`) and HMO claim history (`claims/[id].tsx`). No existing component renders a stepper/rail. |
| `ReviewCard` | Yes | **PASS — justified** | `ReviewCard.tsx:1`. Free-text patient review (avatar + stars + comment + doctor reply + inline report). Correctly **reuses** `DoctorAvatar` and `RatingStars` from telemedicine (`ReviewCard.tsx:9`). No existing row renders a review with a report action. |

### 1b. Screens reuse shared primitives (PASS)

- `StateView` reused for loading/error/empty on every Phase 2 screen (e.g.
  `pharmacy/index.tsx:35-44`, `claims/[id].tsx:62-65`, `compliance/index.tsx:60-63`).
- `SectionCard` reused as the card wrapper across detail screens
  (`pharmacy/[id].tsx`, `referrals/[id].tsx`, `records/[patientId].tsx`,
  `claims/[id].tsx`, `compliance/index.tsx`, `earnings/report.tsx`).
- `InfoRow` reused for all label/value rows
  (`pharmacy/[id].tsx`, `claims/[id].tsx`, `earnings/report.tsx`,
  `compliance/index.tsx`, `referrals/[id].tsx`).
- `StatCard` reused for metric tiles (`reviews/index.tsx:71-72`,
  reused from dashboard/earnings).
- `RatingStars` / `DoctorAvatar` reused (`reviews/index.tsx`, `ReviewCard.tsx`,
  every list row).
- `PrimaryButton`, `SelectField`, `TextInputField`, `DatePickerField`,
  `SoapSection`, `TeleHeader` all reused rather than re-implemented.

### 1c. Minor duplication flagged

- **Minor #1 — duplicated status-pill StyleSheet instead of `StatusBadge`.**
  Two Phase 2 screens hand-roll a payout-status pill block rather than using the
  new `StatusBadge`:
  - `app/(doctor)/earnings/report.tsx:16-20` (`PAYOUT_STATUS_COLOR` map) +
    `:121-123` / styles `statusPill`/`statusText` at `:128-129`.
  - The same pattern is mirrored from Phase 1's `(tabs)/earnings.tsx:18-22`.
  `PayoutItem.status` (`paid|pending|processing`) maps cleanly onto
  `StatusBadge` tones (`success|neutral|info`). Using `StatusBadge` would remove
  ~8 lines of duplicated style per screen. Cosmetic — not blocking.

- **Minor #2 — `CountTile` / `Metric` re-implement `StatCard`.**
  `records/[patientId].tsx:131-141` defines a local `CountTile`, and
  `reviews/index.tsx:163-173` defines a local `Metric`. Both are
  icon + value + label tiles structurally identical to `StatCard`
  (`StatCard.tsx`). `StatCard` takes `value: string`, so `CountTile` would just
  pass `String(value)`. Minor duplication; the bespoke versions drop the
  `shadow1` and accept a numeric value, so this is a soft flag.

---

## 2. Design-Token Compliance — PASS

- **Raw hex in Phase 2 screens + 3 new components:** NONE. Grep of
  `#[0-9a-fA-F]{3,8}` across all Phase 2 route files and the 3 new components
  returned zero matches. All colors come from `@/constants/colors`.
- **Acceptable inline `rgba(...)` overlays (not violations):**
  - `reviews/index.tsx:151` `rgba(0,0,0,0.45)` — modal backdrop scrim.
  - `earnings/report.tsx:103` `rgba(255,255,255,0.7)` and `:105`
    `rgba(255,255,255,0.85)` — translucent text **on the brand gradient hero**.
  These match the Phase-1-accepted pattern (gradient/scrim overlays) and the
  dashboard/earnings heroes already in the codebase. Acceptable.
- **`fontSize:` overrides (2, both justified):**
  - `reviews/index.tsx:135` `avg: { ...Typography.displayLg, fontSize: 48, lineHeight: 52 }`
    — oversized hero average-rating numeral.
  - `earnings/report.tsx:104` `heroValue: { ...Typography.displayLg, fontSize: 36, lineHeight: 44 }`
    — hero amount, matching the identical override already accepted in Phase 1
    `(tabs)/earnings.tsx`.
  Both spread a Typography token first, then override only the display size for a
  hero numeral. Same justification logged as the single Phase-1 minor; not a new
  defect.
- **Magic spacing / radius:** all paddings/margins/radii use `Spacing.*` /
  `Radius.*`. The only bare numerics are sub-token micro-values (`gap: 2`,
  `gap: 4`, `hitSlop={8}`, badge `height: 26`, `width: 2` rail, `width: 24` node,
  `paddingHorizontal: 10` pill) — these are the same sub-`xs` conventions used
  throughout Phase 1 components (`StatusBadge.tsx:34`, `StatusTimeline.tsx`,
  badge geometry). Consistent with existing code; not flagged.

Verdict: **PASS** (clean — no raw hex; overlays/font overrides all justified).

---

## 3. Screen States — PASS

All 17 query-backed views correctly branch on `isLoading && !data` →
`isError || !data` → empty → success, using `StateView`. Single-item reads
(`undefined` when missing) are folded into the error branch
(`isError || !fulfilment`), satisfying the "not-found" contract.

| # | Screen (file) | Loading | Empty | Error | Success |
|---|---------------|:------:|:-----:|:-----:|:-------:|
| 1 | `pharmacy/index.tsx` | ✓ `:35` | ✓ `:40` | ✓ `:37` | ✓ |
| 1d| `pharmacy/[id].tsx` | ✓ `:63` | ✓ (not-found via error branch `:65`) | ✓ `:65` | ✓ |
| 2 | `pharmacy/[id]/delivery.tsx` | ✓ `:34` | ✓ timeline-empty `:60` + not-found `:37` | ✓ `:37` | ✓ |
| 3 | `refills/index.tsx` | ✓ `:55` | ✓ `:63` | ✓ `:57` | ✓ |
| 4 | `referrals/index.tsx` | ✓ `:41` | ✓ `:48` | ✓ `:43` | ✓ |
| 4n| `referrals/new.tsx` | ✓ (specialists `:80`) | ✓ `:84` | ✓ `:82` | ✓ |
| 4d| `referrals/[id].tsx` | ✓ `:44` | ✓ attachments-empty `:91` + not-found `:46` | ✓ `:46` | ✓ |
| 5 | `records/[patientId].tsx` | ✓ `:42` | ✓ per-section muted empties (`:67`,`:84`,`:101`) + not-found `:44` | ✓ `:44` | ✓ |
| 6 | `claims/index.tsx` | ✓ `:38` | ✓ `:45` | ✓ `:40` | ✓ |
| 6d| `claims/[id].tsx` | ✓ `:62` | ✓ (not-found `:64`) | ✓ `:64` | ✓ |
| 7 | `follow-ups/index.tsx` | ✓ `:64` | ✓ `:72` | ✓ `:66` | ✓ |
| 7n| `follow-ups/new.tsx` | N/A (form) | N/A | N/A | ✓ (validated submit) |
| 8 | `reviews/index.tsx` | ✓ `:48` | ✓ reviews-empty `:81` + not-found `:50` | ✓ `:50` | ✓ |
| 9 | `earnings/report.tsx` | ✓ `:32` | ✓ per-section muted empties (`:56`,`:65`) + not-found `:34` | ✓ `:34` | ✓ |
| 10| `compliance/index.tsx` | ✓ `:58` | ✓ per-section muted empties (`:80`,`:101`,`:130`,`:139`) + not-found `:60` | ✓ `:60` | ✓ |

Note: list screens use `isLoading && data.length === 0` so the demo
`placeholderData` shows immediately and the spinner only flashes on true cold
load — exactly the Phase 2 contract §5 instruction. Forms (`referrals/new`,
`follow-ups/new`) legitimately have no read states (N/A) but validate before
submit and surface failures via `Alert`.

---

## 4. Navigation Flow — PASS (incl. the Expo Router coexistence question)

### 4a. Registration vs Ownership Map — PASS
All 15 Phase 2 route files are registered in `app/(doctor)/_layout.tsx:22-36`
and the route names match `DOCTOR_PHASE2_OWNERSHIP_MAP.md` exactly
(`pharmacy/index`, `pharmacy/[id]`, `pharmacy/[id]/delivery`, `refills/index`,
`referrals/{index,new,[id]}`, `records/[patientId]`, `claims/{index,[id]}`,
`follow-ups/{index,new}`, `reviews/index`, `earnings/report`,
`compliance/index`).

### 4b. Every screen reachable from a hub — PASS
- Records tab (`(tabs)/records.tsx:55-58`): pushes `/pharmacy`, `/refills`,
  `/referrals`, `/claims`.
- Patient profile (`patient/[id].tsx:48-50`): pushes `/records/{id}`,
  `/referrals/new?...`, `/follow-ups/new?...`.
- Earnings tab (`(tabs)/earnings.tsx:103`): pushes `/earnings/report`.
- Settings (`settings.tsx`): pushes `/reviews`, `/follow-ups`, `/compliance`.
- Pharmacy detail (`pharmacy/[id].tsx:130`): pushes `/pharmacy/{id}/delivery`.
- List rows push their detail (`pharmacy/[id]`, `referrals/[id]`, `claims/[id]`).
- Create flows `replace()` to the resulting record/list
  (`referrals/new.tsx:54`, `follow-ups/new.tsx:58`).

### 4c. Orphans / dead links — NONE
Cross-referenced every `router.push`/`router.replace` target against the file
tree. Every target resolves to an existing route file. No registered screen
lacks a caller; no caller points at a missing file.

### 4d. **Expo Router `pharmacy/[id].tsx` + `pharmacy/[id]/delivery.tsx` coexistence — SAFE** ✅
This is the headline check (Phase 1's main defect class was nav).
- Directory listing confirms BOTH exist: `pharmacy/[id].tsx` (leaf, 7.5 KB) and
  `pharmacy/[id]/delivery.tsx`.
- Phase 1's `consult/[id]/` is **directory-only** (there is no
  `consult/[id].tsx` leaf — confirmed `ls` returns "No such file"), so the
  doctor side had not previously exercised the leaf+dir pattern. Phase 2 is the
  first place it appears.
- **This is a valid, supported Expo Router v6 pattern** (`expo-router ~6.0.23`,
  `expo ^54`). A `[id].tsx` file and an `[id]/` directory at the same level do
  **not** collide: `[id].tsx` matches the segment leaf (`/pharmacy/123`) and
  `[id]/delivery.tsx` matches the nested route (`/pharmacy/123/delivery`). They
  produce distinct, non-overlapping route nodes. Expo Router only errors on two
  files resolving to the **same** path (e.g. `[id].tsx` and `[id]/index.tsx`
  together) — that is NOT the case here (`pharmacy/index.tsx` is the list, and
  there is no `pharmacy/[id]/index.tsx`).
- Both routes are independently registered in `_layout.tsx:24-25` and tsc passes.
- **Conclusion: no router conflict. Safe.**

---

## 5. Accessibility — PASS-WITH-NOTES

Sampled all icon-only / image-only Pressables and truncatable text.

- **Icon-only Pressables WITH labels (good):** new-referral "+" add button
  (`referrals/index.tsx:33`, `accessibilityLabel="New referral"`), follow-ups
  "+" (`follow-ups/index.tsx:60`), all list-row Pressables carry descriptive
  `accessibilityRole="button"` + `accessibilityLabel` (e.g.
  `pharmacy/index.tsx:57-60`, `claims/index.tsx:60-62`,
  `referrals/index.tsx:67-70`). `ReviewCard.tsx:51` report button has both.
- **Minor #3 — one icon-only Pressable missing a label.** The "X" close button
  in the report-review bottom sheet, `reviews/index.tsx:92`:
  `<Pressable onPress={closeReport} hitSlop={8}>` wraps only an `<X>` icon with
  no `accessibilityLabel`/`accessibilityRole`. (The modal backdrop Pressable at
  `:87` is decorative dismiss — acceptable to leave unlabeled.) Recommend adding
  `accessibilityRole="button" accessibilityLabel="Close"`.
- **Touch targets:** the X button relies on `hitSlop={8}` around a 20px icon
  (≈36px effective) — under the 44px guideline. The add "+" buttons are
  40×40 (`addBtn`), also slightly under 44 but consistent with Phase 1's pattern
  (logged there). Folded into Minor #3 as a soft note.
- **`numberOfLines` on truncatable text:** consistently applied on names/refs/
  metas across all list rows and cards (e.g. `pharmacy/index.tsx` rows,
  `compliance/index.tsx` policy/alert titles, `ReviewCard.tsx` name/meta).
  Long free-text bodies (review comment, claim line desc, referral reason) are
  intentionally un-truncated, which is correct for readable content.

---

## 6. Contract Adherence — PASS-WITH-NOTES

- **Screens consume hooks, not the API directly — PASS.** Every
  `from '@/api/doctor.phase2.api'` import in `app/(doctor)` imports **only**
  `formatKobo` (6 files; grep confirms nothing else is pulled from the api
  module). All data access goes through `@/features/doctor/hooks`. Matches the
  ownership rule.
- **Mutations omit `idempotencyKey` & use `isPending`/`mutateAsync` — PASS.**
  Screens call `.mutateAsync({...})` with inputs that never include
  `idempotencyKey` (the hooks inject it via `generateIdempotencyKey()`, e.g.
  `usePharmacy.ts:52`). Button state is driven by `review.isPending` /
  `create.isPending` / `dispute.isPending` / `acknowledge.isPending`
  (`pharmacy/[id].tsx:120`, `refills/index.tsx:101`, `referrals/new.tsx:139`,
  `claims/[id].tsx:140`, `compliance/index.tsx:121`, `reviews/index.tsx:121`).
  Create flows await `mutateAsync` before navigating (`referrals/new.tsx:48-55`,
  `follow-ups/new.tsx:43-59`). Correct.
- **Money via `formatKobo`, no float kobo math — PASS.** All amounts render
  through `formatKobo` (claims, payout report, follow-up fee, delivery fee,
  pharmacy price delta). The only naira→kobo conversion is the follow-up fee
  input `Math.round((Number(feeNaira) || 0) * 100)` (`follow-ups/new.tsx:33`),
  which rounds to an integer kobo amount before passing to the hook — correct
  (no float kobo stored or math'd).
- **Negative `priceDeltaKobo` rendered sensibly — PASS (with Minor cosmetic).**
  `pharmacy/[id].tsx:99-101` renders sign + `formatKobo(Math.abs(...))` and
  colours positive deltas red (more expensive) / non-positive teal. Handles
  negative correctly.
  - **Minor #4 — zero price-delta cosmetics.** When `priceDeltaKobo === 0`,
    line `:100` prints `"+₦0.00"` (the `>= 0` branch chooses `+`) coloured teal
    (the `> 0 ? error : teal` branch). "+₦0.00" in green is mildly odd. Recommend
    a 3-way: `=== 0` → render `"No change"` (neutral colour). Cosmetic only.
- **Minor #5 — `useSubmitClaim` is wired but has no UI / claims cannot be
  created in-app.** `useRecords.ts:60` exports `useSubmitClaim` and the
  Ownership Map row 6 describes `claims/[id]` as "detail; **submit**/dispute",
  but no screen imports or calls `useSubmitClaim` (grep across `app/(doctor)`
  finds zero callers). `claims/[id].tsx` only implements **dispute**. New claims
  arrive pre-populated from demo data; there is no "submit claim" entry point
  (the consult HMO screen `consult/[id]/hmo.tsx` does not call it either).
  This is a contract/Ownership-Map-vs-implementation gap. Likely intentional for
  Phase A (submission deferred to Phase C / the patient or consult side), but it
  should be confirmed or documented. The hook is correctly written and
  invalidates `hmo-claims`, so it is forward-compatible; flagging as Minor for
  traceability, not a functional break.

---

## 7. Typecheck — PASS

`cd mobile-app/reactnative && npx tsc --noEmit` → **exit 0, zero diagnostics.**
All Phase 2 status-tone maps are exhaustive `Record<Status, ...>` (compiler would
have flagged a missing union member), confirming the label/tone maps stay in sync
with the type unions. `typedRoutes` is `false` (`app.json experiments`), so the
string route literals are not type-checked — they were instead verified manually
in §4 against the file tree (all resolve).

---

## 8. Ownership Boundaries — PASS

`git status` / `git diff --stat` confirm the worktree changes stay in lane:
- **Frontend** touched only `app/(doctor)/**` (new route files + additive hub
  edits to `(tabs)/records.tsx`, `(tabs)/earnings.tsx`, `(tabs)/index.tsx`,
  `settings.tsx`, `patient/[id].tsx`) and `src/features/doctor/components/**`
  (3 new components + additive `components/index.ts` exports).
- **Backend** additions are additive: new files `doctor.phase2.ts`,
  `doctor.phase2.api.ts`, `usePharmacy/useReferrals/useRecords/useReputation/
  useCompliance.ts`, `constants/phase2.ts`, and **additive-only** export lines in
  `hooks/index.ts` and `constants/index.ts` (`export * from './phase2'`). Phase 1
  files (`doctor.ts`, `doctor.api.ts`, other hooks) are not modified by Phase 2.
- No QA-owned or protected Spotlight files were touched by the feature roles.

---

## Prioritized Defect List

### Blocker — none
### Major — none

### Minor
1. **Duplicated payout-status pill instead of `StatusBadge`** —
   `app/(doctor)/earnings/report.tsx:16-20,121-123,128-129`.
   *Fix:* map `PayoutItem.status` (`paid|pending|processing`) to
   `StatusBadge` tones (`success|neutral|info`) and delete the local pill
   styles. Reduces duplication; no behaviour change.
2. **`CountTile` / `Metric` re-implement `StatCard`** —
   `app/(doctor)/records/[patientId].tsx:131-141`,
   `app/(doctor)/reviews/index.tsx:163-173`.
   *Fix (optional):* replace with `<StatCard value={String(n)} ... />`; or
   leave if the no-shadow numeric variant is deliberate.
3. **Icon-only close button missing a11y label (+ <44px target)** —
   `app/(doctor)/reviews/index.tsx:92`.
   *Fix:* add `accessibilityRole="button" accessibilityLabel="Close"`; consider
   bumping the effective hit area toward 44px.
4. **Zero price-delta renders "+₦0.00" in green** —
   `app/(doctor)/pharmacy/[id].tsx:99-101`.
   *Fix:* add an `=== 0` case rendering "No change" with a neutral colour.
5. **`useSubmitClaim` wired but no submit-claim UI; Ownership Map says
   `claims/[id]` should submit** — hook at `src/features/doctor/hooks/useRecords.ts:60`;
   no caller in `app/(doctor)`.
   *Fix:* either add the submit-claim entry point (likely from
   `consult/[id]/hmo.tsx` or claims list), or annotate the Ownership Map /
   contract that submission is deferred to Phase C so the unused hook is
   intentional.

---

## New design-doc-vs-codebase conflicts (beyond Phase 1)

The Phase 1 report already logged: screens not reusing shared `AppHeader`
(doctor side uses `TeleHeader` instead), the back-button-missing-label minor,
and the single justified `fontSize` hero override + accepted rgba overlays.
Those are **not** re-listed here.

New to Phase 2:
- **(Contract gap — see Minor #5)** `DOCTOR_PHASE2_OWNERSHIP_MAP.md` row 6
  lists `useSubmitClaim` for `claims/[id]` ("submit/dispute"), but the
  implemented detail screen only disputes and no screen calls `useSubmitClaim`.
  Surface area is wired for Phase C but the doc currently over-promises a
  submit flow that does not exist in Phase A. Recommend reconciling the doc or
  adding the entry point.
- **(Informational, not a defect)** `typedRoutes` is disabled in
  `app.json`, so the many template-literal route strings (`/(doctor)/...`) are
  unverified by the compiler. Phase 2 added no broken links (verified manually),
  but enabling `typedRoutes` would let the compiler guard this defect class —
  which was Phase 1's most damaging category. Worth considering as a
  cross-cutting hardening item (not Phase 2's responsibility to fix).
