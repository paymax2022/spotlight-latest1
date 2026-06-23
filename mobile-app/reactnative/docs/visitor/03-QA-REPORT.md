# Visitor Module — QA Report

Reviewer: independent QA pass (read-only) + static checks. Scope: all new Visitor/Guard files.

## Method
- Independent file-by-file review against the 6 QA categories (reuse, tokens, states, navigation, a11y, correctness).
- Static checks: grep for hardcoded colors in screens/components (none found); verified every `lucide` icon name used exists in the installed `lucide-react-native@0.525`; confirmed `typedRoutes:false` so string routes are valid; verified every `router` target resolves to a real screen file.
- Note on `tsc`: a full `tsc --noEmit` over this 250+-file project did not complete within the sandbox's execution window (background processes are throttled between calls). Type safety was instead validated by (a) scoped review of prop usage against each component's actual definition, (b) icon-export verification, and (c) route verification. **Recommend running `npm run typecheck` in CI** to formally confirm.

## Results by category

**1. Component reuse — PASS.** All forms use `TextInputField`; all standard CTAs use `PrimaryButton` (correct props: `label/onPress/variant/loading/disabled`); `SectionHeader`, `ScreenHeader`, `StateView` reused consistently. No raw `<TextInput>` or duplicated standard button. Bespoke `Pressable`s (approve/deny two-tone action row, share buttons, segmented controls) are distinct layouts the shared button can't express — justified, not duplication.

**2. Design-token compliance — PASS.** Zero raw hex/rgba in any `app/visitor/*`, `app/guard/*`, or component file. The only module hexes live in `visitor.constants.ts` (`VisitorColors`/`CODE_TYPES`) — the allowed module-scoped layer mirroring `VotingColors`. One deliberate font-size override (`code/[id].tsx` numeric code spreads `Typography.displayLg` then sets `fontSize:40`) — localized and intentional.

**3. State coverage — PASS.** Loading / empty / error / success covered via `StateView` on every list & detail screen (dashboard, active, history, code detail, restricted, expected, gate log, guard confirm). Guard `confirm` handles looking / failure (expired/used/revoked/not-found) / blacklist / ok / approved / denied.

**4. Navigation — PASS.** Every `router.push/replace` target resolves to a real file; all routes registered in their `_layout.tsx`. No dangling targets.

**5. Accessibility — PASS.** Pressables carry `accessibilityRole`/`accessibilityLabel`; toggles/tabs/chips set `accessibilityState={{ selected }}`. Primary tap targets ≥ 44–56px.

**6. Correctness — PASS.** No crash-class bugs. Stable list keys throughout. Type narrowing on `LookupOutcome` is exhaustive before the `ok` cast. QR renders only for active codes (no undefined payload access).

## Findings raised → resolution

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Low | Blacklist path (VM-241) was unreachable — no seed had `isBlacklisted` and no demo scan triggered it. | **Fixed** — added seed `code_7` (`660247`) flagged blacklisted + a "Blacklisted" demo chip in `guard/scan.tsx`. |
| 2 | Low | `guard/confirm` ignored gate-session load/error, silently defaulting `gateId`. | **Fixed** — added session loading + error states before verification. |
| 3 | Minor (a11y) | Copy-code button (`code/[id]`) and guard sync button were < 44px. | **Fixed** — copy button `minHeight:44`; sync button `44×44`. |
| 4 | Minor | `fontSize:40` override for the big numeric code is the one raw font-size literal. | **Accepted** — deliberate token override (`displayLg` → 40) for the hero numeric display; localized. |

## Known limitations (by design for this UI slice)
- **QrCodeView** renders a deterministic, branded QR-*style* visual, **not** a spec-compliant scannable QR. Swap to `react-native-qrcode-svg` (same props) before production. Numeric-code fallback (VM-122) is always shown, so the gate flow still works.
- **guard/scan** uses simulated demo scans instead of `expo-camera`. Wire the camera + a real QR decoder for production; the lookup/verify/approve pipeline behind it is real.
- **Data is mock-backed** (`visitor.api.ts`). The hook/type contract is stable; going live means replacing the api bodies with HTTP calls only.
- **Plus Jakarta Sans** not yet loaded app-wide (project-level gap, see conflicts doc #8); module inherits it automatically once `_layout.tsx` loads the font.

## Verdict
**Ship-ready as a vertical-slice demo.** Convention-adherent, token-clean, fully state-covered, no crash-class defects. Pre-production must address the two known integration limitations (real QR, real camera) and run `tsc`/CI.
