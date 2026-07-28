# Visitor Module — Increment 2 (Phase-2 / P1 depth)

Builds on the MVP slice. Adds the most-used P1 flows from `docs/prd/Visitor.md` so the module covers a full shift, not just the happy path. No existing screen was rewritten; only additive files + small wires into owned files.

## New screens (5)

| Screen | Route | PRD | States |
|---|---|---|---|
| Walk-in / Emergency entry | `app/guard/walkin.tsx` | VM-215 | S; validation error; submit loading; walk-in vs emergency success variants |
| Open visits + Check-out | `app/guard/checkout.tsx` | VM-212 | L,E,R,S; per-row check-out confirm |
| Shift handover | `app/guard/handover.tsx` | VM-216 | L,R,S; pending-sync warning; success |
| Extend validity | `app/visitor/extend/[id].tsx` | VM-143 | L,R,S; "can't extend" guard for inactive codes |
| (wire) Extend action on code detail | `app/visitor/code/[id].tsx` | VM-143 | active codes now show Extend + Revoke |

## Data-layer additions (contract-first, owned by Backend role)
`visitor.types.ts`: `OpenVisit`, `CheckOutInput`, `WalkInInput`, `HandoverInput`.
`visitor.api.ts`: `listOpenVisits`, `checkOutVisit`, `createWalkIn`, `getOpenVisitCount`, `submitHandover` (gate session is now mutable for handover); reset helper updated.
`useVisitor.ts`: `useOpenVisits`, `useCheckOutVisit`, `useCreateWalkIn`, `useSubmitHandover` + `openVisits` query key.

Open-visit derivation: a `check_in`/`walk_in`/`emergency` event with no later `check_out` for the same visitor+unit. Approving an entry (increment 1) therefore now also creates an open visit that appears in Check-out.

## Flows added
- **Guard walk-in (PRD §7.4):** dashboard → Walk-in → toggle Walk-in/Emergency → details → submit → walk-in requests resident approval / emergency fast-tracks & flags for review (pending-sync).
- **Check-out (VM-212):** dashboard → Check out → open-visits list → confirm → `check_out` event logged, resident notified, gate log + history updated.
- **Shift handover (VM-216):** dashboard → Shift handover → summary of open visits + pending sync → notes → complete → shift end time + notes saved for next guard.
- **Extend (VM-143):** code detail (active) → Extend → pick added time → before/after preview → confirm → expiry moves, code value & QR unchanged.

## Shared-component improvement
`TextInputField` gained **backward-compatible `multiline` support** (used by handover notes): when `multiline` is passed, the container grows (minHeight + stretch + vertical padding) instead of the fixed 56px row. Zero impact on existing single-line usages. This is the kind of shared-component reuse you asked for — improved once, available to every module.

## QA (increment 2)
- No hardcoded colors in any new/edited file (grep-verified); module hexes remain only in `visitor.constants.ts`.
- All `lucide` icon names used verified present in `lucide-react-native@0.525`.
- All new routes registered in `app/guard/_layout.tsx` and `app/visitor/_layout.tsx`; every `router` target resolves to a real file.
- States covered on every new screen (loading/empty/error/success as applicable).
- Reuse: `ScreenHeader`, `StateView`, `TextInputField`, `PrimaryButton` reused throughout; bespoke layouts only where the shared button can't express them (mode toggle, check-out row).

## Cumulative module total
**18 screens** (13 increment 1 + 5 increment 2) + 2 shared components + 8 visitor-feature files + 5 docs.

## Still open (next increments, by PRD phase)
- P1 remaining: recurring/multi-day schedule editor, ID/plate OCR, blacklist management screen, suspicious-visitor alert, soft-restriction proof-of-payment/appeal full flow, visitor & gate analytics dashboards (Section X), notification center wiring (Section W).
- P2: bulk event guest upload & manifests, VIP fast-track, plate ANPR, advanced offline staleness controls.
- Production hardening: real QR encoder (`react-native-qrcode-svg`), `expo-camera` scanner, live API behind the existing hook contract, Plus Jakarta Sans loaded app-wide.
