# QA Report — Association / Group Membership module (mobile)

**Date:** 2026-06-20
**Scope this session:** Member vertical slice (discovery → join → dashboard → card → directory → dues → pay → receipt), feature scaffold, edge states.
**Verification:** scoped `tsc --noEmit` (tsconfig.assoccheck.json) → **0 errors**; token-compliance grep; reuse audit.

---

## 1. Reused existing components / patterns

| Shared asset | Used in | Notes |
|---|---|---|
| `PrimaryButton` | 8 screens | All CTAs, footers, dual-button rows (via `fullWidth={false}` + flex). |
| `StateView` | 10 screens | Every loading / empty / error state — no bespoke state UI. |
| `ScreenHeader` | 8 screens | Standard back-nav header. |
| `SearchBar` | discovery, directory | Controlled `value`/`onChangeText`. |
| `SegmentedControl` | directory, dues | Filter rows (status / dues). |
| `SelectField` | join | Category + chapter pickers. |
| `TextInputField` | join | Sponsor field. |
| `PaymentMethodSelector` | pay | Wallet/Paystack selection + insufficient-balance flag. Naira (not kobo) per its API. |
| `SectionHeader` | discovery, home | Section titles + actions. |
| Feature pattern (`api`+`mock`+`hooks`+`types`+`constants`+`utils`) | whole module | Mirrors `crowdfunding`/`voting`. |
| React Query hooks + `USE_MOCK` flag + `delay()` | data layer | Identical to `voting.api.ts` / `crowdfunding.api.ts`. |
| `generateIdempotencyKey` (`@/utils/idempotency`) | apply + payInvoice | IRON RULE: idempotency on money/apply mutations. |
| Stack `_layout` w/ `slide_from_right`, modal/`fade` overrides | navigation | Matches crowdfunding layout conventions. |

### Components built new (justified — nothing suitable existed)

| New component | Why | Conforms to |
|---|---|---|
| `src/components/QrCodeView.tsx` (**promoted shared**) | Membership card needs a QR. Identical copies existed only inside `visitor`/`doctor` features; promoting avoids cross-feature coupling. | Same precedent as the `SegmentedControl` promotion note. |
| `MembershipCardView` | Digital ID card (gradient glass surface) — no existing card matched. | `BalanceCard` gradient/glass pattern + `shadow3`. |
| `OrganisationCard`, `MemberRow`, `DuesInvoiceRow` | Domain list items with no analogue. | Card/row style of `CampaignCard`/`ContributorRow`. |
| `MembershipStatusBadge` (+ `PaymentStandingBadge`, `InvoiceStatusBadge`) | Status chips. | Pill style of `CampaignStatusBadge` (dot + 10% tint). |

---

## 2. Screen-state coverage

| Screen | Loading | Empty | Error | Success/primary |
|---|---|---|---|---|
| Discovery (`index`) | ✅ | ✅ (no results / none) | ✅ retry | ✅ list |
| Organisation detail | ✅ | n/a | ✅ retry | ✅ + sticky join CTA |
| Join | ✅ | n/a | ✅ retry | ✅ validation + submit states |
| Application submitted | n/a | n/a | n/a | ✅ approved / pending / payment variants |
| Member home | ✅ | n/a | ✅ retry | ✅ + restriction banner |
| Membership card | ✅ | n/a | ✅ retry | ✅ active / suspended-dimmed |
| Directory | ✅ | ✅ (filter/search) | ✅ retry | ✅ list + filters |
| Member detail | ✅ | n/a | ✅ retry | ✅ + privacy-restricted state |
| Dues | ✅ | ✅ (filter) | ✅ retry | ✅ summary + invoices |
| Pay | ✅ | n/a | ✅ invalid invoice | ✅ pay → receipt / pending / failed |
| Receipt | ✅ | n/a | ✅ retry | ✅ |
| Edge `[type]` | n/a | covers 8 states | ✅ error | ✅ routed CTAs |

---

## 3. Design-token compliance — **PASS**

- **Colors:** zero hardcoded hex in screens/components (grep clean). Added `Colors.gradientMuted` token for the suspended-card gradient rather than inlining hex.
- **`rgba(...)` literals (9):** all are white/error glass overlays *on the gradient membership card* (e.g. `rgba(255,255,255,0.14)`). This matches the shipped `BalanceCard` pattern and DESIGN-Mobile.md §Elevation (glass = white fill at opacity). Acceptable / consistent.
- **Spacing / Radius / Typography:** all via `Spacing`, `Radius`, `Typography` tokens. No magic numbers except intrinsic sizes (icon px, avatar/photo dimensions) — consistent with existing components.
- **Shadows:** `shadow1` / `shadow3` tokens only.

## 4. Accessibility — **PASS (slice level)**

- Back buttons, icon buttons, cards, rows: `accessibilityRole` + `accessibilityLabel`.
- Rules consent is a real `accessibilityRole="checkbox"` with `accessibilityState`.
- Segmented controls expose `role="tab"`/selected (inherited from shared component).
- Hit targets ≥ 40×40 (icon buttons 40, primary buttons 56, pay button 44).
- Status conveyed by **label text + colour** (not colour alone).

## 5. Navigation flow — **PASS**

Discovery → Organisation detail → Join → Submitted → Home → {Card, Directory→Member detail, Dues→Pay→Receipt}. `pay` is a bottom-sheet modal; `submitted`/`success` disable the back gesture (matches crowdfunding success screens). All `router.push`/`replace` targets resolve to created routes registered in `_layout.tsx`.

---

## 6. Conflicts: DESIGN-Mobile.md vs. actual codebase

1. **Fonts not actually loaded.** `DESIGN-Mobile.md` mandates *Plus Jakarta Sans*, but `src/constants/typography.ts` sets `fontFamily: undefined` (system font) with a TODO to wire `@expo-google-fonts`. New screens follow the code (tokens), so they inherit whatever the app later loads. **Pre-existing**, not introduced here.
2. **Tailwind class names in the doc are aspirational.** The doc references `rounded-lg`, `rounded-xl`, etc.; the RN app uses numeric `Radius` tokens. The numeric values match the doc's px (16/24), so visual intent is preserved.
3. **Glassmorphism = simulated.** Doc specifies `backdrop-filter` blur; RN has no backdrop blur here, so `BalanceCard` and the new `MembershipCardView` approximate "glass" with gradient + white-opacity overlays + tinted shadow. Consistent with shipped code.

## 7. Known limitations (carried to pending tasks)

- `QrCodeView` renders a deterministic branded QR-style matrix, **not** a spec-compliant QR. Swap in `react-native-qrcode-svg` behind the same props before production.
- Data layer is `USE_MOCK = true`. Wallet balance on the pay screen is a mock constant; wire to the real wallet API + `/associations` endpoints (spec-PR `contracts/openapi.yaml` first, per CLAUDE.md).
- Share / download actions on card & receipt are stubbed with `Alert` placeholders.

## 8. Bugs found & fixed during the pass

- Dues list rows had no horizontal inset (list had no padding) → wrapped rows in `rowInset`.
- Receipt footer had two full-width buttons in a row → switched to `fullWidth={false}` + `flex:1`.
- `pay` screen imported an unused constant → removed.
- API import used a non-existent `newIdempotencyKey` → corrected to `generateIdempotencyKey`.
- Suspended-card gradient was inline hex → moved to `Colors.gradientMuted`.

**Result: no open blockers in the delivered slice.**

---

# Addendum — Session 2 (engagement modules)

**Added:** Announcements (feed + detail + acknowledge), Notifications center, Meetings (dashboard + detail w/ RSVP + QR/manual check-in + minutes link), Tasks (list + detail w/ checklist, comments, status progression), Documents vault (list + viewer w/ AI summary, version history, restricted state, acknowledge). Dashboard shortcuts + bell now wired to these routes.

**New files**
- Contract: `types/engagement.types.ts`, `api/engagement.mock.ts`, `api/engagement.api.ts`, `hooks/useEngagement.ts`, `constants/engagement.constants.ts`.
- Screens: `app/association/announcements/{index,[id]}.tsx`, `notifications.tsx`, `meetings/{index,[id]}.tsx`, `tasks/{index,[id]}.tsx`, `documents/{index,[id]}.tsx`.
- Edits: `app/association/_layout.tsx` (+10 routes), `app/association/home.tsx` (shortcuts/bell wired, quick-action grid wraps to 6).

**Verification**
- Scoped `tsc -p tsconfig.assoccheck.json --noEmit` → **0 errors** (covers session 1 + 2).
- Hardcoded-hex grep across `app/association` + `src/features/association` → **NONE**.
- Reuse: `StateView`, `ScreenHeader`, `SegmentedControl`, `SearchBar`, `PrimaryButton`, `QrCodeView` (meeting check-in) all reused; no new shared primitives needed. Task/meeting status pills reuse the established dot+10%-tint pattern via `engagement.constants` style maps.

**State coverage (all new screens):** loading / error+retry / empty handled; plus domain states — announcement urgent + ack-required/acknowledged; meeting upcoming/past/cancelled + RSVP + checked-in; task overdue/awaiting-review/completed + next-status CTA; document restricted (access-gated) + ack-required.

**A11y:** all rows/cards/RSVP buttons have `accessibilityRole`+`accessibilityLabel`; RSVP exposes selected state; notifications auto-mark-read on open.

**New known limitations (added to pending):** chat module not yet built; meeting "join virtual" / document download / share are stubbed; AI-notes capture pipeline (L) not yet built; admin-side approve/publish for these modules pending.

---

# Addendum — Session 3 (Group chat, I)

**Added:** Chat inbox (thread list across org / chapter / committee / executive / direct, with unread badges, mute, scope icons) and the message screen (grouped author labels, pinned + system messages, optimistic send, `KeyboardAvoidingView` composer). Posting-block handling for announcement-only, role-restricted, payment-restricted (with inline "Pay" → dues), and archived. Dashboard quick-actions now include Chat (7 tiles).

**New files**
- Contract: `types/chat.types.ts`, `api/chat.mock.ts`, `api/chat.api.ts`, `hooks/useChat.ts`, `constants/chat.constants.ts`.
- Components: `components/ChatThreadRow.tsx`, `components/MessageBubble.tsx`.
- Screens: `app/association/chat/{index,[id]}.tsx`.
- Edits: `_layout.tsx` (+2 routes), `home.tsx` (Chat shortcut).

**Verification**
- Scoped `tsc` → **0 errors** (covers sessions 1–3). Hardcoded-hex grep → **NONE** (message-bubble timestamp uses `rgba(255,255,255,0.7)` glass overlay on the primary bubble, consistent with `BalanceCard`).
- Reuse: `ScreenHeader`, `StateView` reused; composer uses the same input tokens as `TextInputField`/`SearchBar`. Two new components justified (no existing chat row/bubble).
- States: loading / error+retry / empty inbox; message screen handles all four posting blocks + optimistic send (disabled when empty/pending).
- A11y: thread rows, send button, pay button all labelled; send disabled state reflected.

**Known limitations (added to pending):** attachments / images / voice notes, reactions, mentions, pin/mute actions, and search-in-chat are not yet wired (the data contract anticipates pinned/system messages and mute flags). Real-time transport (WebSocket events from the PRD) is mocked via React Query; swap to a socket layer when the backend lands.

---

# Addendum — Session 4 (AI note-taking, L)

**Added:** AI-notes dashboard (history + status), new-note source picker (record / upload audio / video / transcript), processing screen (staged progress → auto-routes to review or error edge), and the review screen — segmented tabs (Summary / Minutes / Decisions / Actions / People), editable executive summary, unresolved + financial-commitment callouts, attendance + transcript preview, **human approve → publish gate** (AI draft never auto-final, per PRD §17.5), and **convert action item → task**. Past meetings without minutes now link to "Generate AI minutes". Dashboard gains an AI-notes shortcut (8 tiles).

**New files**
- Contract: `types/ainotes.types.ts`, `api/ainotes.mock.ts`, `api/ainotes.api.ts`, `hooks/useAiNotes.ts`, `constants/ainotes.constants.ts`.
- Screens: `app/association/ai-notes/{index,new}.tsx`, `app/association/ai-notes/[id]/{processing,index}.tsx`.
- Edits: `_layout.tsx` (+4 routes), `home.tsx` (AI-notes shortcut), `meetings/[id].tsx` (generate-minutes link + `router` import).

**Verification**
- Scoped `tsc` → **0 errors** (sessions 1–4). Hardcoded-hex grep → **NONE**. 28 association screens total.
- Reuse: `ScreenHeader`, `StateView`, `SegmentedControl`, `TextInputField`, `PrimaryButton` reused; convert-to-task invalidates the Tasks query (cross-module wiring). No new shared components.
- States: loading / error+retry / empty (with CTA); processing (gesture-disabled, failure → `edge/error`); status-gated footer (READY→approve, APPROVED→publish, PUBLISHED→confirmation).
- Money: financial commitments use kobo + `formatNaira`. Mutations carry idempotency keys.
- A11y: source cards expose selected state; edit/convert/approve/publish controls labelled.

**Known limitations (added to pending):** real audio capture/upload + live transcription + speaker diarisation are stubbed (mock processing); regenerate-summary and export-PDF/share of minutes not yet wired; AI history filters minimal.

---

# Addendum — Session 5 (Join variants, B)

**Added:** Invite-code entry, group/chapter access-code entry (both via a shared `CodeEntryView` with valid/expired/invalid result states), QR invite scan (viewfinder UI + "simulate scan" + manual-entry fallback), and required-document upload (`expo-image-picker`, per-requirement pick/preview/remove, required-vs-optional gating). Discovery screen now has Invite / Access / Scan entry chips; the join form links to the documents step when the org requires uploads.

**Note:** `src/components/QrCodeView.tsx` was upgraded by a parallel session to a real `react-native-qrcode-svg` encoder (same props) — this resolves the prior "swap QR encoder" INFRA item; membership card + meeting check-in now render real QR codes.

**New files**
- Contract: `types/join.types.ts`, `api/join.api.ts`, `hooks/useJoin.ts`, `utils/docPicker.ts`.
- Component: `components/CodeEntryView.tsx` (shared by invite + access screens).
- Screens: `app/association/join/{invite,access-code,scan}.tsx`, `app/association/join/[id]/documents.tsx`.
- Edits: `_layout.tsx` (+4 routes), `index.tsx` (code/scan entry chips), `join/[id]/index.tsx` (documents link).

**Verification**
- Scoped `tsc` → **0 errors** (sessions 1–5). Hardcoded-hex grep → **NONE**. 32 association screens total.
- Reuse: `ScreenHeader`, `StateView`, `TextInputField`, `PrimaryButton` reused; one shared `CodeEntryView` removes duplication across the two code screens; local `docPicker` mirrors the crowdfunding media-picker pattern (no cross-feature import).
- Mock codes for testing: invite `NMA2026`, access `IKOYI`, `EXPIRED` → expired, anything else → invalid.
- States: validating / valid / expired / invalid result; documents required-gating; empty "no documents required".
- A11y: code chips, dropzones, remove buttons, manual-entry all labelled; code input auto-capitalises.

**Known limitations (added to pending):** QR scan camera capture is not wired (no camera dependency) — viewfinder is UI-only with a simulate/manual fallback; document uploads are local (not yet posted to storage); select-local-branch and select-committee-interest sub-steps (B12/B13) not yet built.

---

# Addendum — Session 6 (Member profile C + Committees N + Events O)

**Added (closing pending priorities 1 & 2):**
- **Member profile (C):** dashboard (completion checklist + progress + detail), edit (photo via picker, all fields, DOB via shared `DatePickerField`, emergency + next-of-kin), privacy settings (Switch toggles, optimistic), activity history (timeline). In-memory persistence in mock so saves reflect immediately.
- **Committees (N):** list (my vs. discover, role/pending/join chips) + detail (leadership, member roster, member-only stats linking to meetings/tasks/docs + committee chat, request-to-join → pending).
- **Events & attendance (O):** list (upcoming/past, free/paid, registered) + detail (RSVP for free, register for paid, **ticket QR**, check-in state, star feedback for past events, documents).

**New files**
- Contract: `types/profile.types.ts` + `api/profile.{mock,api}.ts` + `hooks/useProfile.ts`; `types/community.types.ts` + `api/community.{mock,api}.ts` + `hooks/useCommunity.ts`.
- Screens: `app/association/profile/{index,edit,privacy,activity}.tsx`, `committees/{index,[id]}.tsx`, `events/{index,[id]}.tsx`.
- Edits: `_layout.tsx` (+8 routes), `home.tsx` (profile header button + Events/Committees tiles, 10-tile grid).

**Verification**
- Scoped `tsc` → **0 errors** (sessions 1–6). Hardcoded-hex grep → **NONE**. **40** association screens total.
- Reuse: `ScreenHeader`, `StateView`, `SegmentedControl`, `SectionHeader`, `TextInputField`, `DatePickerField`, `PrimaryButton`, `QrCodeView` (ticket), `docPicker` (photo), RN `Switch` (privacy). No new shared components; committee detail links into existing chat/meetings/tasks/documents (cross-module).
- States: every screen has loading / error+retry / empty; committees join→pending; events RSVP / register / registered / checked-in / past / feedback-submitted; profile completion 0–100 + complete banner.
- Money: event fees in kobo via `formatNaira`; register mutation carries idempotency key.
- A11y: photo picker, switches, stars, RSVP/register, join all labelled.

**Known limitations (added to pending):** paid-event registration simulates payment (does not yet route through the dues/Paystack flow); profile photo + documents are local URIs (not uploaded to storage); committee create/manage (admin) and add/remove members are admin-side (not in this member slice).

---

# Addendum — Session 7 (Admin-lite: Q/R/S/T)

**Added:** an admin console for chapter/finance officers —
- **Dashboard (Q1):** KPI grid (total/active/pending/unpaid), dues collected vs. outstanding, action links with pending-count badges.
- **Approvals (Q2–Q6):** queue (All/Chapter/National segments, paid + info-requested + SLA chips) → application detail (applicant info, SLA countdown/breach, payment status, document verification) with **Approve / Reject / Request more info** (confirm dialog, idempotent decision).
- **Finance/treasurer (S):** collected/outstanding, paid vs. unpaid, revenue-by-chapter and by-category bar breakdowns, offline-payment approvals (approve/reject proof, idempotent).
- **Bulk upload (R):** intro (steps + template) → preview (valid/duplicate/invalid summary, per-row issue chips, send-invites toggle) → import result. Duplicates/invalid auto-skipped.

Admin console reachable via a `ShieldCheck` header button on the member dashboard (role-gating is a placeholder — see limitations).

**New files**
- Contract: `types/admin.types.ts` + `api/admin.{mock,api}.ts` + `hooks/useAdmin.ts`.
- Screens: `app/association/admin/index.tsx`, `admin/approvals/{index,[id]}.tsx`, `admin/finance/{index,offline}.tsx`, `admin/import/{index,preview}.tsx`.
- Edits: `_layout.tsx` (+7 routes), `home.tsx` (admin header button).

**Verification**
- Scoped `tsc` → **0 errors** (sessions 1–7). Hardcoded-hex grep → **NONE**. **47** association screens total.
- Reuse: `ScreenHeader`, `SectionHeader`, `StateView`, `SegmentedControl`, `PrimaryButton`, RN `Switch`; KPI/finance bars built from tokens (no chart lib). No new shared components.
- Money: all figures kobo via `formatNaira`/`formatNairaCompact`; approval + offline-payment + import-confirm mutations carry idempotency keys (IRON RULE).
- States: every screen loading / error+retry / empty (queue-clear, all-clear, results); SLA breach styling; import results screen.
- A11y: queue cards, decision buttons, approve/reject, invite toggle, admin entry all labelled.

**Known limitations (added to pending):** admin access is not yet role-gated (any member sees the console — needs an RBAC/role check from the dashboard payload); member admin actions (suspend/restore/transfer/assign-role) and chapter-vs-national scoping of data are stubbed; bulk-upload file selection is mocked (no real document picker / column-mapping step yet); finance export not wired.

---

# Addendum — Session 8 (Organisation creation wizard, U)

**Added:** a 6-step founder wizard backed by a Zustand draft store (mirrors the crowdfunding campaign-draft pattern):
1. **Basics** — name, acronym, category, description.
2. **Branding** — logo upload + group type (Open/Closed/Invite-only/Code/Paid).
3. **Structure** — approval rule (auto / admin / multi-level / payment-first) + add/remove chapters (region/state/local).
4. **Membership** — add/remove categories with dues (₦→kobo) + cadence.
5. **Access** — registration fee, grace period, and per-feature unpaid-member restrictions (toggles).
6. **Review** — editable summary of every section (deep-links back to each step) + terms consent → **publish** → success.

Reachable via a "Create" FAB on the discovery screen; success routes into the admin console or the new org's public page.

**New files**
- Contract: `types/orgDraft.types.ts`, `store/orgDraftStore.ts`, `api/orgCreate.api.ts`, `hooks/useCreateOrganisation.ts`, `constants/orgWizard.constants.ts`.
- Component: `components/WizardProgress.tsx` (step indicator).
- Screens: `app/association/create/{index,basics,branding,structure,membership,access,preview,success}.tsx`.
- Edits: `_layout.tsx` (+8 routes), `index.tsx` (Create FAB).

**Verification**
- Scoped `tsc` → **0 errors** (sessions 1–8). Hardcoded-hex grep → **NONE**. **55** association screens total.
- Reuse: `ScreenHeader`, `TextInputField`, `SelectField`, `PrimaryButton`, RN `Switch`, `docPicker` (logo). Draft store mirrors `campaignDraftStore`; only one small new `WizardProgress` component.
- Money: dues + registration fee captured in ₦ and stored as kobo; publish mutation carries an idempotency key.
- States: per-step validation gating (touched-aware), publish loading, success screen; review shows empty-state hints for skipped optional sections.
- A11y: radios expose selected state, toggles/checkboxes/edit affordances labelled.

**Known limitations (added to pending):** org-level admin-role assignment (PRD U13) and committee/department creation are not in the wizard yet; logo is a local URI (not uploaded); the draft is in-memory (no resume-after-close persistence).

---

# Addendum — Session 9 (Settings V + Support W)

**Added:**
- **Settings (V):** hub (grouped Account / Security / Support + log-out & delete-account confirms), notification preferences (6 toggles), security & login (biometric + 2FA toggles, change-password form), device management (list + revoke non-current sessions).
- **Support (W):** help center (FAQ accordion + contact/my-tickets actions), ticket list (status chips), create ticket (subject + category chips + message), ticket detail (message thread + reply composer; locked when resolved).

Reachable from the profile dashboard (new "Help & support" and "Settings" rows).

**New files**
- Contract: `types/settings.types.ts`, `api/settings.{mock,api}.ts`, `hooks/useSettings.ts`, `constants/support.constants.ts`.
- Screens: `app/association/settings/{index,notifications,security,devices}.tsx`, `app/association/support/{index,tickets,new,[id]}.tsx`.
- Edits: `_layout.tsx` (+8 routes), `profile/index.tsx` (support + settings links).

**Verification**
- **Hardcoded-hex grep → NONE** across new files. **63** association screens total.
- **Import-symbol sanity check passed**: all 11 `useSettings` hooks imported by the screens resolve to real exports (1:1 match); `support.constants` and `settings.types` exports line up with usage.
- **tsc note:** a full scoped `tsc -p tsconfig.assoccheck.json` could not complete within the workspace's 45s shell cap this session — the shared sandbox was saturated by concurrent agent sessions (the sibling FX / Doctor / Crowdfunding trackers record the same constraint). All new code follows the exact patterns that passed scoped tsc with 0 errors in sessions 1–8 (same hook signatures, shared-component props, token usage); re-run `npx tsc -p tsconfig.assoccheck.json --noEmit` on an unloaded machine to confirm.
- Reuse: `ScreenHeader`, `StateView`, `TextInputField`, `PrimaryButton`, RN `Switch`, dynamic `lucide` icon lookup; support ticket thread reuses the chat-bubble layout pattern. No new shared components.
- States: loading / error+retry / empty (no tickets); resolved-ticket composer lock; password-match validation; destructive confirms for logout/delete/revoke.
- A11y: every toggle, FAQ accordion (expanded state), category chip, send/revoke control labelled.

**Known limitations (added to pending):** change-password / biometric / 2FA are UI-only against mock state (no real auth backend); language & theme settings (V18/V19) not built; delete-account is a stubbed request.

---

# Addendum — Session 10 (Governance & elections, Y — integration)

**Approach:** a complete generic `election` feature already exists (`app/election/*` + `src/features/election/*`: active election, voter eligibility, ballot, cast vote, candidate detail, results, receipt, admin setup, list). Per reuse-first + brownfield safety, this session **integrates** rather than rebuilds — no election screens were duplicated.

**Added:** `app/association/governance.tsx` — an association-scoped governance landing that:
- computes **payment-gated voter eligibility** (PRD §23 + §13) from the member's dues standing (overdue/restricted → blocked, with a "Pay to restore eligibility" CTA into dues);
- surfaces the **active election** (title, close time, position count) via the shared `useActiveElection` hook and deep-links into `/election?id=…` (locked when ineligible);
- links to `/election/list` (all elections & results) and `/election/admin/setup` (electoral committee).

**Edits:** `_layout.tsx` (+1 route), `home.tsx` (Voting tile → governance).

**Verification**
- Scoped `tsc -p tsconfig.assoccheck.json --noEmit` → **rc=0, 0 errors** (sandbox freed up this session; this also re-confirms the session-9 settings/support code that was deferred). Hardcoded-hex grep on the new screen → **NONE**. Cross-feature imports (`useActiveElection`, `Election.positions`) resolve.
- Reuse: links into the existing election feature; `ScreenHeader`, `StateView`, `PrimaryButton` reused; eligibility derived from the association dashboard hook. No new shared components, no election duplication.
- States: eligibility loading; eligible vs. restricted; no-active-election empty; ineligible lock on the election card.
- A11y: eligibility card, election card (disabled state when locked), all links labelled.

**Known limitations (added to pending):** the eligibility check is client-side from dues standing — the authoritative voter-eligibility gate lives in the election backend; chapter/category voter-scoping and the dispute screen (Y14) are owned by the election feature, not re-implemented here.

---

# Addendum — Session 11 (Admin depth: RBAC + member actions, Q)

**Added:**
- **RBAC gating:** `useAdminAccess` (role, jurisdiction, capability flags). The dashboard's admin (`ShieldCheck`) entry now only renders for admins; `admin/index` shows an "Admin access only" state for non-admins; the admin member screen blocks actions when `can.manageMembers` is false.
- **Member management:** `admin/members/index` (reuses `useDirectory` + `MemberRow`, admin-routed) and `admin/members/[id]` — suspend, restore, transfer-to-chapter, and assign-role, each with a confirm dialog and idempotent mutation; audit-log note.

**New files**
- Contract: `types/adminRole.types.ts`, `api/adminMembers.api.ts`, `hooks/useAdminMembers.ts`.
- Screens: `app/association/admin/members/{index,[id]}.tsx`.
- Edits: `_layout.tsx` (+2 routes), `admin/index.tsx` (RBAC gate + "Manage members" link), `home.tsx` (admin entry gated on role).

**Verification**
- Scoped `tsc -p tsconfig.assoccheck.json --noEmit` → **rc=0, 0 errors**. Hardcoded-hex grep on new files → **NONE**. **66** association screens.
- Reuse: `useDirectory`, `MemberRow`, `useMember`, `MembershipStatusBadge`/`PaymentStandingBadge`, `SelectField`, `PrimaryButton`, `StateView`. No new shared components; admin member list is the directory pattern re-pointed.
- Money/safety: member mutations carry idempotency keys; destructive actions (suspend/transfer/role) require confirm; audit-log note surfaced.
- States: loading / error+retry; RBAC access-denied (console + per-action); suspend↔restore reflects status.
- A11y: all action buttons + selects + admin entry labelled.

**Resolved from pending:** admin console is now role-gated (was open to any member); member admin actions (suspend/restore/transfer/assign-role) are implemented.

**Known limitations (added to pending):** capability flags are mock (`CHAPTER_ADMIN` with all caps) — real RBAC must come from the backend `me/admin-access`; suspend reason is a fixed string (no reason-entry modal); the admin audit-log screen (Q20) itself is not yet built.

---

# Addendum — Session 12 (Backend contract + go-live wiring)

**Goal:** make the module switchable from mock to a real backend, spec-first per CLAUDE.md — without clobbering shared files (module-scoped artefacts, mirroring `contracts/doctor.openapi.yaml` / `invest.openapi.yaml`).

**Delivered**
- **Env-driven `USE_MOCK`:** `association.constants.ts` now reads `EXPO_PUBLIC_ASSOCIATION_USE_MOCK` (default mock); `.env.example` documents it. No screen/code changes needed to go live.
- **`contracts/associations.openapi.yaml`** — OpenAPI 3.1, **68 paths / 76 operations / 70 schemas**, every `$ref` resolves (validated via PyYAML). Bearer auth + required `Idempotency-Key` on all mutations; money typed as kobo. Covers the exact 68 endpoints the `*.api.ts` live branches call.
- **`supabase/migrations/20260628000000_association_module.sql`** — **29 additive tables** (`assoc_*`): organisation graph, memberships + profiles + roles, applications, dues/payments/revenue-split (money path → ledger via `ledger_txn_id` + unique idempotency index), announcements, notifications, meetings, tasks, documents, chat, AI notes, events, support, devices, import batches, and an `assoc_audit_log`. Additive-only (no DROP/rename/narrowing), all `_kobo` columns BIGINT.
- **`docs/association/GO_LIVE.md`** — flip-the-switch runbook + grouped endpoint inventory + RBAC + money-path notes.

**Verification**
- OpenAPI parses; 76 ops / 70 schemas; **0 unresolved refs**.
- Migration: destructive-statement grep → none (only the comment mentions DROP); 29 `CREATE TABLE IF NOT EXISTS`; all `_kobo` BIGINT.
- Env flag matches the sibling-module convention (`EXPO_PUBLIC_*_USE_MOCK`).

**Known limitations (added to pending):** the Go backend handlers + route wiring under `/associations` are not implemented here (contract + schema only) — that's the remaining backend build; merge `associations.openapi.yaml` into the shared `contracts/openapi.yaml` at integration time; run the additive-only migration guard + full tsc in CI.

---

# Addendum — Session 13 (Go backend — money-path MVP)

**Goal:** stand up the Go backend money path for the module, mirroring the existing `internal/groups` pattern (pgx pool + shared `ledger.Service` double-entry), behind a feature flag.

**Delivered (`backend/internal/association/`)**
- `model.go` — request/response structs + pure `RevenueSplit(amountKobo)` (National 50 / State 30 / Local 15 / Platform 5; remainder lands on National so parts always sum exactly).
- `service.go` — `GetDues`, **`PayInvoice`** (money path: fail-closed Idempotency-Key → `ledger.Debit` member→settlement double-entry → `assoc_payments` + `assoc_revenue_splits` + invoice→PAID + `assoc_audit_log`, all in one tx), `GetReceipt`, `DecideApplication` (approve/reject/request-info → activates membership on approve + audit).
- `handler.go` — Gin handlers; domain-error→HTTP mapping (idempotency→400, forbidden→403). Idempotency-Key read from header.
- `routes.go` — `RegisterRoutes(group, handler)` mounting dues/receipt/approval endpoints.
- `model_test.go` — revenue-split sums-exactly + proportions + PayInvoice-requires-idempotency-key.

**Wiring**
- `internal/config/config.go` — `FeatureAssociationsEnabled` (`FEATURE_ASSOCIATIONS_ENABLED`, default false).
- `internal/app/finance_routes.go` — additive block after the groups block: builds the service from the in-scope `pool` + `ledgerSvc`, mounts `finance.Group("/associations")` when the flag is on (auth + `user_id` context inherited from the finance group).

**Verification (static — no Go toolchain in sandbox, per sibling sessions)**
- Brace/paren balance even across all 5 files; imports all used; `pgx.Tx` + `pgx/v5` + `google/uuid` match repo usage and `go.mod`.
- Ledger contract confirmed: `AccountSettlement`, `GetOrCreateStandingAccount`, `Debit`, `Account.ID` all exist; `ledger.Debit(ctx,userID,ref,idemKey,creditAcctID,amount)` signature matched.
- Money rules: kobo ints; idempotency fail-closed + carried to `ledger.Debit`; balanced double-entry via ledger (no balance columns touched); audit row per mutation.

**Known limitations (added to pending):** **not compiled** — run `cd backend && go build ./... && go vet ./internal/association/... && go test ./internal/association/...` in CI. This is the money-path + approvals MVP; the read endpoints (dashboard, directory, meetings, chat, etc. — already in the OpenAPI) are subsequent backend waves or frontend-web handlers. Path base is `/api/v1/finance/associations` (Go) vs the mobile client's bare `/associations` — reconcile via a frontend-web proxy or align the client base before flipping `EXPO_PUBLIC_ASSOCIATION_USE_MOCK=false`.

---

# Addendum — Session 14 (UI depth batch)

**Delivered seven depth items; scoped `tsc -p tsconfig.assoccheck.json` → 0 errors; hardcoded-hex grep → NONE; 70 screens.**

1. **Admin audit-log (Q20)** — `admin/audit.tsx` timeline (action-typed icons, segmented filter) + `getAuditLog`/`useAuditLog` + `AuditEntry` type/mock; linked from admin dashboard.
2. **Settings language + theme (V18/V19)** — `settings/language.tsx`, `settings/theme.tsx` (radio), `Preferences` type + `getPreferences`/`updatePreferences` + `usePreferences`/`useUpdatePreferences`; Preferences group on the settings hub.
3. **Org-wizard committees** — `DraftCommittee` + store add/remove; committees add-UI in the structure step; shown in preview.
4. **Join sub-steps (B12/B13)** — `Organisation.branches` + `committeeOptions` (mock populated); `JoinDraft.localBranch` + `committeeInterests`; optional branch select + committee-interest chips in the join form.
5. **Paid-event payment (O)** — `event-pay/[id].tsx` reuses `PaymentMethodSelector` → `registerEvent`; event detail routes paid registration to it (replaces the simulated register).
6. **Chat depth** — `ChatMessage.imageUrl` + `reactions`; `MessageBubble` renders images + reaction chips + quick-react; thread screen adds image attach (`docPicker`), tap-to-react (optimistic), in-chat search, and mute toggle. New `muteThread`/`reactToMessage` api + `useMuteThread`/`useReactMessage`.
7. **AI-notes depth** — `regenerateSummary` api + `useRegenerateSummary`; review screen adds a Regenerate control on the summary tab + Export-PDF/Share header actions (export/share stubbed for preview).

**Routing fix:** event payment lives at `event-pay/[id]` (not `events/[id]/pay`) to avoid an Expo Router leaf-vs-folder collision with `events/[id].tsx`.

**Reuse:** `PaymentMethodSelector`, `SegmentedControl`, `SelectField`, `StateView`, `ScreenHeader`, `docPicker`, RN `Switch` all reused; no new shared components.

**Known limitations (added to pending):** export-PDF/share and attachments are local/stubbed (no storage/native share); theme/language are persisted to mock state (no actual i18n/theming engine yet); chat realtime/WS still pending.

---

# Addendum — Session 15 (Go backend — wire reads + add write-path)

**Context:** a parallel session had added 23 read handlers + service methods to `internal/association` but left `routes.go` wiring only the original 4 endpoints. This session closes that gap and adds the mutation surface, in **separate files** (`*_actions.go`) to minimise merge conflict with the concurrently-edited `handler.go`/`service.go`.

**Delivered**
- **`service_actions.go`** — 16 write-path methods: `AcknowledgeAnnouncement`, `MarkNotificationsRead`, `RsvpMeeting`, `CheckInMeeting` (idempotent), `UpdateTaskStatus` (assignee-guarded), `AcknowledgeDocument`, `RequestJoinCommittee`, `RsvpEvent`, `RegisterEvent` (ticket issue), `SubmitEventFeedback`, `DecideOfflinePayment` (admin + audit), `SuspendMember`/`RestoreMember`/`TransferMember`/`AssignRole` (admin + audit), + a `primaryMembership` helper. Sensitive actions go through `requireAssocAdmin` and write `assoc_audit_log`.
- **`handler_actions.go`** — 15 Gin handlers with request binding + `statusFor` error mapping.
- **`routes.go`** — expanded from 4 to **41 routes** wiring every read handler the other session wrote plus the new mutations.

**Routing decision:** org detail is mounted at `GET /orgs/:id`, not a root-level `GET /:id` — gin's radix tree conflicts a root param with the many static siblings (`/me`, `/members`, `/meetings`, …), and no existing module mixes them. The mobile client's bare `GET /associations/:id` maps here via the documented path reconciliation.

**Verification (static — no Go toolchain in sandbox)**
- Brace/paren balance even across all new files; **every routed `h.*` handler is defined; every `h.svc.*` method exists; no duplicate handler/service method names** (script-checked).
- All param segments use consistent names; no static-vs-root-param sibling conflicts; request structs don't clash with `model.go` types.
- Money/sensitive rules: admin gate + `assoc_audit_log` row per sensitive action; check-in/payment idempotent; kobo throughout.

**Known limitations (added to pending):** **not compiled** — CI must run `go build/vet/test ./internal/association/...`; committee-join is audit-only pending a `committee_members` table; offline-payment approval marks the invoice paid + audits but doesn't yet post a ledger entry for the externally-received funds (later wave); a few long-tail endpoints (chat persistence, AI-notes, support tickets, settings prefs, bulk import, org publish, code validation) remain for subsequent backend waves.

---

# Addendum — Session 16 (Go backend — remaining endpoint groups wired)

**Closed the ~34-endpoint gap.** Added settings, support, chat, AI-notes, join, bulk import, and org-publish endpoints — in new files (`model_ext.go`, `service_ext.go`, `handler_ext.go`) to avoid colliding with the concurrently-edited core files — and wired them in `routes.go` (**42 → 71 routes**).

**New files**
- `supabase/migrations/20260629000000_association_settings.sql` — additive jsonb columns (`notification_prefs`, `security`, `preferences`) on `assoc_member_profiles`.
- `model_ext.go` — ~25 DTOs (none collide with `model.go`).
- `service_ext.go` — SQL-backed methods: settings get/update (jsonb) + devices; support faqs/tickets/create/reply; chat threads/thread/send; AI-notes list/get/status/create/approve/publish/convert-to-task; join code-validate + apply (status by group type); admin import preview/confirm (audit); founder org-publish (org+chapters+committees+categories in one tx + audit).
- `handler_ext.go` — 30 Gin handlers.

**Routing notes (gin-safe):** AI-notes convert uses the consistent `:id` param (`/ai-notes/:id/action-items/:itemId/convert`) to avoid a param-name conflict; `apply` is `POST /apply` and org detail stays `GET /orgs/:id` to avoid static-vs-root-param conflicts — both flagged for client/proxy reconciliation.

**Verification (static — no Go toolchain)**
- Brace/paren balance even across all new files; **every routed handler defined; every `h.svc.*` resolves; no duplicate types, methods, or package funcs** (`nz`/`scanJSONB` defined once) — script-checked.
- Money/sensitive rules preserved: admin gate + `assoc_audit_log` on publish/import/AI-status/offline; jsonb via marshaled bytes; kobo ints.

**Known limitations (added to pending):** still **not compiled** (CI gate); import preview returns empty rows (real file parse pending); chat unread/mute + member counts not persisted; AI-notes processing is status-only (no real transcription); committee-join audit-only.
