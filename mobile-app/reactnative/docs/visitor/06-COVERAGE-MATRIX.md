# Visitor Module — PRD Coverage Matrix (100% of Sections E & F)

Maps every screen in PRD `docs/prd/Visitor.md` §18 (Screen Inventory) to an implemented route. Dependency sections (I, W, X) covered for the parts the Visitor module owns.

## Section E — Resident (Visitor) ✅

| PRD inventory item | Route | Notes |
|---|---|---|
| Visitor management dashboard | `/visitor` | + notifications bell, analytics/event links |
| Create visitor access code | `/visitor/create` | type selector + details + validity |
| Single / One-time / Time-limited / Date-specific / Multi-day / Recurring | `/visitor/create` | via `CodeTypeSelector` (VM-102) |
| Delivery / Ride-hailing / Domestic staff / Contractor / Family permanent / VIP / Emergency | `/visitor/create` | purpose-specific code types (VM-103) |
| Visitor details form (phone, vehicle, purpose, arrival) | `/visitor/create` | VM-104 |
| Visitor QR & numeric code | `/visitor/code/[id]` | QR + grouped numeric (VM-101/122) |
| Share via WhatsApp / SMS / email | `/visitor/code/[id]` | `Linking` deep links (VM-121) |
| Active / Expired / Revoked codes | `/visitor/active` | segmented (VM-141) |
| Cancel / revoke | `/visitor/code/[id]` | VM-142 |
| Extend | `/visitor/extend/[id]` | VM-143 |
| Visitor access history | `/visitor/history` | VM-144 |
| Arrival / Checked-in / Checked-out / Overstayed / Denied notifications | `/visitor/notifications` | Section W, VM-161–166 |
| Event guest list & bulk upload | `/visitor/event-guests` | VM-107 |
| Visitor denied access | `/visitor/notifications` + guard deny | logged + notified (VM-165/243) |

## Section F — Guard ✅

| PRD inventory item | Route | Notes |
|---|---|---|
| Guard dashboard / assigned gate | `/guard` | shift card, online state, panic |
| Scan QR / manual code | `/guard/scan` | demo scans + manual (VM-202/203) |
| Visitor & resident lookup | `/guard/lookup` | code/name/phone/plate + resident (VM-204) |
| Expected visitors list | `/guard/expected` | today's valid codes (VM-205) |
| Visitor details confirmation | `/guard/confirm/[code]` | VM-206 |
| Call resident for approval | `/guard/walkin` + lookup tel | walk-in approval (VM-207) |
| Approve / Deny entry (reason) | `/guard/confirm/[code]` | VM-208 |
| Capture photo / ID / plate | `/guard/confirm/[code]` | capture toggles (VM-209) |
| Vehicle entry log | `/guard/vehicles` | VM-210 |
| Delivery/ride/contractor/staff verification | `/guard/confirm/[code]` | purpose banner adapts (VM-211) |
| Check-in success / Check-out | `/guard/confirm/[code]`, `/guard/checkout` | VM-212 |
| Overstay monitoring | `/guard/checkout` (durations) + notifications | VM-213/164 |
| Gate activity log | `/guard/log` | VM-214 |
| Offline gate mode / Sync pending logs | `/guard/log`, `/guard` | pending-sync badge + sync (VM-261/262) |
| Walk-in & emergency entry | `/guard/walkin` | VM-215 |
| Blacklisted & suspicious alerts | `/guard/confirm/[code]`, `/guard/blacklist`, `/guard/suspicious` | VM-241/242/244 |
| Shift handover | `/guard/handover` | VM-216 |
| Incident report | `/guard/incident` | VM-217 |
| Panic / security escalation | `/guard` (panic) | VM-217 P0 |
| Gate analytics | `/guard/analytics` | Section X / §14 |

## Dependency sections (Visitor-owned parts)

| Section | Coverage |
|---|---|
| **I — Payment restriction** | `/visitor/restricted` (soft/hard/pending/restored states), `/visitor/restriction/proof` (VM-303), `/visitor/restriction/appeal` (VM-304); restriction read on dashboard + at create (VM-301/302/108). |
| **W — Notifications** | `/visitor/notifications` with all visitor notification types + unread badge on dashboard (VM-161–166). |
| **X — Analytics** | `/visitor/analytics` (resident/admin) + `/guard/analytics` (gate) covering §14 metrics. |
| **Z — Edge/error states** | QR expired / invalid / already-used handled inline in `/guard/confirm/[code]`; no-internet/empty/error via shared `StateView` everywhere. |

## Totals
- **30 screens** (18 prior + 12 this increment) across `app/visitor` (13) and `app/guard` (15) incl. layouts.
- **9 visitor components** + **3 shared components** (`ScreenHeader`, `StateView`, multiline-capable `TextInputField`).
- **Data layer:** 1 type contract, 2 mock seed files, 1 api surface (~30 functions), 1 hooks file (~30 hooks).

## Out of scope (other modules per PRD §5.2)
Subscription/dues collection mechanics (Payments), resident onboarding/approval (Auth), admin web configuration of visitor rules. The Visitor module *consumes* restriction status and *surfaces* admin-owned analytics, as specified.

## Production hardening still required (not feature gaps)
Real QR encoder (`react-native-qrcode-svg`), `expo-camera` scanner, live API behind the existing hook contract, Plus Jakarta Sans loaded in `_layout.tsx`, push-notification delivery wiring, and a formal `tsc`/CI pass.
