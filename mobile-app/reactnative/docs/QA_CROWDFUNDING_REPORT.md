# QA Report — Crowdfunding Mobile Module (Contributor MVP)

**Scope reviewed:** Sections C (Discovery), D (Campaign Detail), E (Contribution / Donation flow)
**Date:** 2026-06-19
**Reviewer role:** QA Agent (review-only — no feature code edited)
**Build target:** `mobile-app/reactnative` (Expo Router, React Native 0.81, React Query)

---

## 1. Summary

| Area | Result |
|------|--------|
| TypeScript compile (scoped `tsc`) | ✅ Pass — 0 errors across 44 files |
| Design-token compliance | ✅ Pass (1 documented, codebase-consistent exception) |
| Component reuse (no duplication) | ✅ Pass |
| Screen states (loading/empty/error/success) | ✅ Pass |
| Navigation flow end-to-end | ✅ Pass |
| Accessibility (labels, roles, hit targets) | ✅ Pass |
| Lucide icon validity | ✅ Pass (all names verified against installed v0.525) |

**31 screen routes + 7 new components + API/hooks layer** delivered. All typecheck clean.

---

## 2. Reused vs. new (component inventory)

### Reused (no new variant built)
- `ScreenHeader` — 21 screens
- `StateView` — 23 screens (every loading/empty/error state)
- `PrimaryButton` — 11 screens
- `SearchBar` — home + search
- `SectionHeader` — home dashboard
- `PAYMENT_METHODS` constant + `computeFees` / formatters (existing backend contract)
- `generateIdempotencyKey` util (money-path, per iron rule)

### New (justified — nothing suitable existed)
| Component | Why new |
|-----------|---------|
| `CampaignCard` | No campaign list-item existed; mirrors `ContestCard` structure/props exactly. |
| `CampaignProgress` | Funding bar + raised/goal/backers/days-left; no equivalent. |
| `CampaignStatusBadge` | 8 campaign statuses; `ContestStatusBadge` covers contest states only. |
| `VerificationBadge` | KYC/KYB trust badge; no equivalent. |
| `CategoryTile` | Cause category grid/chip; no equivalent. |
| `ContributorRow` | Backer list row with anonymity masking; no equivalent. |
| `SegmentedTabs` | Implements DESIGN-Mobile.md "Segmented Control"; reused for filter rows. |

**Verdict:** No duplication of existing buttons, inputs, cards, headers, or state views.

---

## 3. Design-token compliance

All colors, spacing, radius, typography, and shadows reference `@/constants/*` tokens.

**One documented exception (acceptable):** the accent colors `#B65A00` (reward orange) and
`#0F7A37` (community green) are written as raw hex. This is **consistent with the existing
codebase** — `src/constants/modules.ts` already uses raw hex for the same accent family
(`#EAB308`, `#16A34A`, `#F97316`, `#A855F7`) because the design-token palette defines no
orange/green semantic slots. Crowdfunding follows the established convention rather than
inventing a divergent one.

> **Recommendation (non-blocking):** add `warning`/`success-green` semantic tokens to
> `colors.ts` and migrate both the crowdfunding accents and the pre-existing `modules.ts`
> hex values together in a follow-up.

---

## 4. Screen-state coverage

Every data screen renders four states via the shared `StateView`:

- **Loading** — `ActivityIndicator` + message (home, lists, detail, all sub-pages).
- **Empty** — contextual icon + copy + action (no campaigns found, empty saved, no
  contributions, no backers, no documents, no milestones, no updates, no rewards).
- **Error** — retry action wired to React Query `refetch` on every query screen.
- **Success** — primary content.

Flow-specific states also covered: **payment processing** (animated), **payment success**,
**payment failed** (declined / network / init reasons), **payment pending** (bank/USSD →
receipt), **refund submitted**, **refund not eligible**, and all five **campaign status
notices** (frozen / completed / expired / cancelled / rejected) on the detail page.

---

## 5. Navigation flow (verified against `_layout.tsx`)

```
Services grid → /crowdfunding (home)
  ├─ search → campaign detail
  ├─ category tile / "See all" → campaigns (parametrised list) → filter ⇆ sort modals
  ├─ saved / recently-viewed
  └─ campaign/[id] (detail)
       ├─ media · story · budget · creator · contributors · updates
       │   · milestones · documents · faq · rewards
       ├─ report (form → confirmation) · share (modal)
       └─ Contribute CTA →
            contribute/[id] (amount + anon + message + reward)
              → summary (method + fee breakdown + refund accept)
                → processing → success | failed | (pending → receipt)
                  → receipt → contributions (history)
                       → contributions/[id] → refund (form → confirmation)
```

- Gesture-back disabled on `processing` / `success` / `failed` (prevents mid-payment escape).
- `router.dismissTo` used to collapse the flow stack back to the campaign after completion.
- `[id]/index.tsx` restructure under `contributions/` avoids the Expo Router
  `[id].tsx` + `[id]/` ambiguity. ✅

---

## 6. Accessibility

- All icon-only controls have `accessibilityLabel` (back, save, share, close, channels).
- `accessibilityRole` set: `button`, `radio`, `switch`, `checkbox`, `tab`.
- `accessibilityState` reflects `selected` / `checked` / `expanded`.
- Touch targets: back/icon buttons 40×40; primary buttons 56 high; `hitSlop` on small taps.
- Card labels combine title + context (e.g. "Help Baby Zara. Medical campaign").

---

## 7. Money-path adherence (iron rules)

- ✅ All amounts integer **kobo**; display-only conversion in formatters.
- ✅ Contribution initiation sends an **`Idempotency-Key`** (`generateIdempotencyKey`).
- ✅ Failed/pending payments **do not** mutate campaign raised totals (mock respects this;
  contract leaves the write to the server).
- ✅ Fee model is transparent (campaign receives full intended amount; fees added on top).
- ✅ Investment campaigns hidden in discovery while `INVESTMENT_ENABLED === false`.

---

## 8. Defects / follow-ups

| # | Severity | Item |
|---|----------|------|
| 1 | Low | Orange/green accent hex not tokenised (codebase-wide; see §3). |
| 2 | Info | `Share`/`Clipboard`/QR in the share sheet are stubbed (native share works; copy + QR are placeholders pending Clipboard + a QR lib). |
| 3 | Info | `getCampaignContributors` and refund/verify are mock-backed; flip `USE_MOCK=false` in `crowdfunding.api.ts` when real endpoints land. |
| 4 | Info | Two scratch `tsconfig.cf*.json` files remain in the RN root (mount-permission prevented cleanup; harmless, mirrors existing `tsconfig.inc*.json` scratch configs). |

No blocking defects.

---

# Addendum — Creator Dashboard (F) + Campaign Creation (G)

**Date:** 2026-06-19 (second pass)
**Scope:** Section F (creator dashboard) and Section G (multi-step creation wizard).

## A. Summary

| Area | Result |
|------|--------|
| TypeScript compile (scoped `tsc`) | ✅ Pass — 0 errors |
| Lucide icons (15 new) | ✅ All verified against v0.525 |
| Design-token compliance | ✅ Pass (same documented orange/green exception) |
| Component reuse | ✅ Pass |
| Wizard flow + per-step validation | ✅ Pass |
| Screen states | ✅ Pass |
| Accessibility | ✅ Pass |

**16 new files** — 15 routes + the Zustand draft store. Plus 1 mock dataset, creator
API functions, `useCreator` hooks, and 2 new components (`WizardHeader`, `CreatorCampaignRow`).

## B. Reuse (F + G)

Reused: `ScreenHeader` (4), `StateView` (5), `PrimaryButton` (12), `TextInputField` (3),
`SectionHeader` (1), `SegmentedTabs` (1, the component built in the first pass),
`CampaignProgress`, `CampaignStatusBadge`, `formatters`, `generateIdempotencyKey`.

New (justified): `WizardHeader` (step counter + progress bar; no equivalent),
`CreatorCampaignRow` (manage-oriented row with status + progress; the contributor
`CampaignCard` has save/flags semantics unsuited to creator management).

## C. Creation wizard — flow & validation

9 steps share one Zustand draft store (`campaignDraftStore.ts`), so back/forward
navigation preserves all input. Each step gates "Continue" on its own validity:

1. **Type** — must pick a type. 2. **Category** — must pick one. 3. **Details** — title ≥ 8
& summary ≥ 20 chars. 4. **Story** — ≥ 80 chars (with writing prompts). 5. **Media** — cover
required (gallery optional). 6. **Goal & funding** — goal ≥ ₦1,000, location set,
disbursement model chosen; deadline presets. 7. **Beneficiary** — name + relationship.
8. **Use of funds** — ≥ 1 budget item; **conditionally** shows milestone adder
(disbursement = milestone) and reward-tier adder (type = reward), with live budget-vs-goal
total. 9. **Preview** — editable summary rows (jump back to any step), refund policy,
policy-acceptance checkbox gating submit.

Submit → `useSubmitCampaign` (sends `Idempotency-Key`) → **success** screen with
draft-vs-review variants; draft store reset on success; `gestureEnabled:false` on success.

## D. Money-path / iron rules (F + G)

- ✅ Goal/budget/withdrawal amounts all integer kobo.
- ✅ Submission carries an `Idempotency-Key`.
- ✅ Withdrawals surface KYC + admin-approval requirement; escrow shown separately and
  described as milestone-gated.
- ✅ Investment category excluded from the creation category picker while flagged off.

## E. Defects / follow-ups (F + G)

| # | Severity | Item |
|---|----------|------|
| 5 | Info | `expo-image-picker` not yet a dependency — the media step attaches sample images in mock mode (documented inline). Wire the picker when the package is added. |
| 6 | Info | Withdrawal-request button on the withdrawals screen is a placeholder (request flow belongs to Section I, not in this F/G scope). |
| 7 | Low | Currency is fixed to NGN in the funding step (multi-currency is a later-phase concern per the playbook). |

No blocking defects in F or G.

---

# Addendum 2 — Sections I, J, K, N, O, P, Q (app completion)

**Date:** 2026-06-19 (third pass)
**Scope:** Wallet/withdrawal (I), Milestones & impact (J), Reward fulfilment (K),
Notifications (N), Support & disputes (O), Settings (P), Edge/error states (Q).

## A. Summary

| Area | Result |
|------|--------|
| TypeScript compile (scoped `tsc`) | ✅ Pass — 0 errors across **96** crowdfunding files |
| Lucide icons (all new names) | ✅ Verified (incl. dynamic alias lookups `ArrowUpCircle`, `FileQuestion`) |
| Design-token compliance | ✅ Pass (same documented `#B65A00` orange exception, 2 uses) |
| Component reuse | ✅ Pass — `ScreenHeader` 26×, `StateView` 17×, `PrimaryButton` 12× in scope |
| Screen states | ✅ Pass |
| Money-path (kobo, idempotency) | ✅ Pass |

**Mobile total: 96 files, 73 routes** across sections C–Q.

## B. What shipped this pass

- **Backend:** extended types + 2 mock files + `crowdfundingExtras.api.ts` + `useExtras.ts`
  hooks (wallet/ledger/banks/withdrawal, tickets/help, notifications, reward backers, prefs).
- **I — Wallet:** campaign wallet dashboard (available/pending/escrow + frozen notice),
  ledger with type filters, transaction detail (immutable-ledger note), withdrawal request
  flow (amount + MAX, bank select, reason, evidence) → pending status. Idempotency key sent.
- **J — Milestones:** milestone dashboard (timeline), milestone detail with evidence upload +
  request-disbursement, impact report creation.
- **K — Rewards:** fulfilment dashboard (status tabs), fulfilment detail with a status
  progress tracker + status update.
- **N — Notifications:** contributor notification center with mark-all-read + deep links.
- **O — Support:** help center (searchable FAQ), ticket list, create ticket, ticket chat
  (bubble thread + reply, reopen-on-reply).
- **P — Settings:** settings hub (grouped rows + logout confirmation) and sub-screens —
  profile, verification, bank accounts, payment methods, notification prefs (live toggles),
  language, theme, security (biometric/2FA/devices), privacy, data export, delete account.
- **Q — Edge:** one parametrised `edge/[type]` screen + `EdgeState` component covering no-internet,
  server-error, maintenance, app-update, session-expired, access-denied, account-suspended,
  kyc-required, kyb-required, not-found.

## C. New components (justified)

- `CreatorCampaignRow`, `WizardHeader` (prior pass), `OptionList` (DRY radio list reused by
  language + theme), `EdgeState` (full-screen error surface). All match existing token usage.

## D. Consolidations (faithful to spec, fewer thin files)

Per the spec's long screen lists, several near-identical variants were consolidated into one
parametrised screen rather than duplicated: discovery collections → `campaigns.tsx`; all
edge/error states → `edge/[type]`; "withdrawal submitted/approved/processing" surfaced as
ledger statuses rather than separate screens. This mirrors the existing codebase's approach
and keeps the design system consistent. Noted for transparency.

## E. Follow-ups (info)

| Severity | Item |
|----------|------|
| Info | All new data is mock-backed (`USE_MOCK`/mock files). Real endpoints wired but inactive. |
| Info | `change password`, `add card`, `add bank`, `revoke device` are entry points with the destination forms left as the next increment (out of this pass's scope). |
| Info | Image/file uploads (evidence, impact photos, KYB docs) simulate attachment pending `expo-image-picker`/document-picker. |

No blocking defects.

---

# Addendum 3 — Section H (Updates & Communication) + image upload

## A. Real image upload
- Added `expo-image-picker@17.0.11` (SDK 54-matched) + config plugin/permissions in `app.json`.
- `mediaPicker` util centralises permission/cancel/error handling. Campaign creation media step
  now picks a real cover (library or camera, 16:9), a multi-select gallery (≤6), and a video.
- `videoUri` added to the draft + submit mapping.

## B. Bug fix — created campaign missing from "In review"
- `submitCampaign` (mock) now builds a real `Campaign` from the draft and inserts it into the
  creator list with `PENDING_REVIEW` (or `DRAFT`); `useSubmitCampaign` invalidates the
  creator-campaigns + stats queries so it appears immediately under My campaigns.

## C. Section H — Updates & Communication
- Backend: `CampaignComment`/reply/report, `PostUpdateInput`, `BroadcastInput` types + mock +
  api + `useExtras` hooks (invalidate-on-mutate).
- Screens: **Comments & Q&A** (all/questions tabs, post comment or question, creator reply,
  report abusive comment), **Post an update** (title/body + real photo → notify backers),
  **Message contributors** (subject/body + push/email channels → recipient count).
- Wired from detail (Comments & Q&A row), updates (+ Post update), performance (Post update +
  Message contributors).

**Result:** TypeScript clean across the full tree; icons verified. No blocking defects.

---

# Addendum 4 — Section L (Investment crowdfunding, feature-flagged)

**Date:** 2026-06-19 (later)

Regulated module, **gated behind `INVESTMENT_ENABLED`** (currently `false`). The module entry
renders a "coming soon when licensed" `EdgeState`; the home banner only appears when the flag
is on. This mirrors the admin Configuration page where the investment feature flag is **locked**.

- Backend: `investment.types.ts`, `investment.api.ts` (mock-backed, idempotency key on
  subscribe, mutable in-session investor profile), `useInvestment.ts` hooks.
- Screens (9): onboarding hub (KYC / education / quiz / risk-profile checklist), investor
  **education** (lessons → mark complete), **knowledge quiz** (must pass all → unlock),
  **risk profile** (scored questionnaire → Conservative/Balanced/Aggressive), **offers** list,
  **offer detail** (terms, lock-in, cooling-off, prominent risk warnings, offer document,
  use-of-proceeds), **invest** (amount + min-ticket + **annual-limit warning** + risk &
  subscription-agreement acceptance), **certificate** (confirmation + investment certificate),
  **portfolio** (holdings with invested vs current value).

Compliance acceptance criteria honored: module can't be used without onboarding; investor must
pass education + quiz before investing; risk warnings shown prominently; annual investment
limit enforced; cooling-off period surfaced; all amounts in kobo; subscribe carries an
idempotency key.

**TypeScript clean (scoped `tsc`); icons verified (`AlertTriangle` resolves as alias). No blocking defects.**

> Section M built — see Addendum 5.

---

# Addendum 5 — Section M (Corporate CSR / matching, feature-flagged)

**Date:** 2026-06-20

Regulated-style partner module, **gated behind `CSR_ENABLED`** (currently `false`, matching the
admin `corporate_csr` feature flag). Entry renders a "partner onboarding" `EdgeState`; the home
banner only appears when the flag is on.

- Backend: `csr.types.ts`, `csr.api.ts` (mock-backed, idempotency key on match setup),
  `useCsr.ts` hooks.
- Screens (8): **sponsor dashboard** (CSR budget remaining + committed/matched, active matches,
  quick links), **browse impact campaigns**, **CSR campaign detail** (with match CTA), **match
  setup** (ratio 0.5×/1×/2×, cap, anonymous toggle, message → budget/VAT summary →
  pending-approval), **my matches** (with corporate **approval** action), **impact report**
  (lives impacted, by-category bars, monthly chart), **receipts & invoices** (VAT breakdown),
  **employee giving** campaign.

Acceptance criteria honored: matches require internal approval before activating; cap reserved
from CSR budget; invoices show VAT; anonymous-match visibility option; all amounts in kobo;
match setup carries an idempotency key.

**TypeScript clean (scoped `tsc`); icons verified. No blocking defects.**

This completes every spec section (mobile A–Q incl. L & M; admin B–J). The two feature-flagged
modules (Investment, CSR) ship OFF by default and are admin-controllable.

---

# Addendum 6 — Pending-items completion (real uploads, settings forms)

**Date:** 2026-06-20

- **Real file uploads:** installed `expo-document-picker@14.0.8`; `mediaPicker` gained
  `pickDocument()`. Milestone **evidence** now picks real PDF/image files (name + size shown);
  impact-report **photos** now use the real multi-image picker.
- **Settings destination forms (deferred → built):** `change-password` (strength rules +
  match), `add-card` (formatted number/expiry/CVV, tokenisation note), `add-bank` (bank +
  10-digit NUBAN with name-resolution), and **functional device revoke** in Security. Wired
  from Bank accounts / Payment methods / Security.

TypeScript clean (scoped `tsc`). KYB document review remains on the admin web side (not a
mobile upload). No blocking defects.


