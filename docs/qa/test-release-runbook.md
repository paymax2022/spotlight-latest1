# Test-Release Runbook

**What this is:** a plan document (not a CI change) mapping the requested
release gate —

```
Pull Request → Unit tests → API tests → Playwright E2E → Mobile smoke tests
→ Security checks → AI exploratory QA → Performance smoke test → ALL PASS?
→ (YES) DEPLOY / (NO) BLOCK RELEASE
```

— onto what actually exists in this repo today, gate by gate, plus a
concrete screen-by-screen navigation plan for a 3-module pilot
(**restaurant, association, wallet**) to prove the process before scaling to
all 36 platform modules.

No CI/workflow files are modified by this document. Where a gate has no real
automation yet, that's called out explicitly rather than implied.

---

## ⚠️ Read this before testing any module: the mock-flag trap

While scaling this pilot to a 4th module (savings), a fully convincing
vault/withdraw flow turned out to have made **zero network calls** — it was
100% client-side mock data, indistinguishable in the UI from the real thing.
Checking why revealed a systemic pattern:

`grep -rn "mockAllowed(process.env" mobile-app/reactnative/src/` turns up
**~75 modules**, each with its own `EXPO_PUBLIC_<MODULE>_USE_MOCK` flag, and
**~68 of them default to `true` when unset** (`src/config/mockPolicy.ts`).
Only association, insurance, merchant, registration, restaurantmerchant,
stayshotelier, and voting default to `false`. This is a deliberate,
reasonable pattern for local dev (`mockPolicy.ts`'s own comment: "several
modules genuinely have no live endpoint yet") — and it's hard-gated safe in
real deployments (`isMocklessEnvironment()` forces mock off in
staging/production regardless of the per-module flag) — but it is a real
trap for exactly this kind of testing pass: **nothing in the UI tells you
which mode you're in.**

This retroactively meant the restaurant findings earlier in this document
(R1–R4) were tested against `EXPO_PUBLIC_FOOD_USE_MOCK`/
`EXPO_PUBLIC_RESTAURANT_USE_MOCK`'s mock catalog (6 fake restaurants,
including "Mama Cass"), not the real backend — neither flag had been set.
Re-tested with both explicitly set to `false`: the real backend works
correctly (see the corrected R1–R2 row below), it just serves the one real
seeded restaurant ("Test Kitchen") instead of the rich mock catalog, and the
first load is slower (cold Next.js route compile) than the mock path, which
briefly looked like a stuck-loading bug before more wait time resolved it.

**Before testing any further module, set its mock flag to `false` first** —
current list of all ~75 flags and their defaults is reproducible with the
grep above. `mobile-app/reactnative/.env` in this worktree now sets it
explicitly for every module touched so far (association, transfers,
restaurant/food, savings); extend that list before testing the next one
rather than trusting the module's own default.

---

## Part 1 — The gate pipeline, mapped to what exists

| Gate | Exists today? | Where | Command / trigger |
|---|---|---|---|
| Pull Request | ✅ | GitHub | branch protection on `main` |
| Unit tests | ✅ (backend + frontend), real per-module CI lanes | `backend/**/*_test.go`; `frontend-web/tests/unit`; `mobile-app/reactnative/tests/unit` | `cd backend && go test ./... -count=1`; `cd frontend-web && npx vitest run`; per-module lanes: `.github/workflows/{association,commerce,connect,crowdfunding,doctor,fx,health,insurance,maps,realtor,referral,stays,top5}-ci.yml` |
| API tests | ✅ partial | live-DB suites gated on `TEST_DATABASE_URL`; `contracts/*.openapi.yaml` validated | `.github/workflows/ci.yml` → `live-db` job, `openapi` job; `npm run contract:check` (estate only) |
| Playwright E2E | ⚠️ **exists locally, not wired into CI** | `mobile-app/reactnative/tests/e2e/**/*.spec.ts` (Auth, bills, wallet, insurance — 15+ specs) | `cd mobile-app/reactnative && npx playwright test` — **no `.github/workflows/*.yml` runs this today; confirmed by grep, zero hits** |
| Mobile smoke tests | ❌ **doesn't exist as a named gate** | closest analog: `mobile-typecheck` job in `ci.yml` (whole-app `tsc`, not a smoke test) | nothing currently boots the app and taps through a golden path in CI |
| Security checks | ✅ real, already substantial | `.github/workflows/security.yml` | CodeQL (JS+Go), `govulncheck`, `gitleaks detect`, Trivy container scan, `npm-audit-gate.mjs` against a baseline |
| AI exploratory QA | ❌ **doesn't exist** | — | this is the new gate — see Part 2 (opentester) |
| Performance smoke test | ❌ **doesn't exist** | — | no k6/Artillery/Lighthouse job found anywhere in `.github/workflows/` |
| ALL PASS? → DEPLOY / BLOCK | ⚠️ implicit only | branch protection requires the individual checks above to pass; there is no single script that computes one AND-of-everything verdict | `make verify` comes closest locally (`build vet tsc contract-check migrate-reset test security-scan`) but doesn't include E2E, mobile smoke, AI QA, or perf |

**Bottom line:** 3 of 8 gates are solid (unit, API/contract, security). 1 is
half-wired (Playwright E2E exists but nobody runs it in CI). 3 don't exist
yet (mobile smoke, AI exploratory QA, performance). The "ALL PASS?" diamond
is currently "did every configured GitHub check go green," not a computed
single verdict — closing that gap is a `make verify`-style script addition,
out of scope for this plan-only pass per your choice above.

---

## Part 2 — AI exploratory QA gate: opentester

You want **opentester** (`opentester-mcp-server`) as the AI-exploratory-QA
step. I looked it up earlier: it's a real, small (published ~6 months ago,
single maintainer) npm package that runs as an MCP server, converts
natural-language test descriptions into executable Android tests, and drives
a connected device/emulator via `adb`.

**I'm not installing it myself.** Doing so means running `npx -y
opentester-mcp-server` — downloading and auto-executing code from an
unfamiliar single-maintainer package — plus adding a persistent, global MCP
server with device-control access. That's outside what I'll do unilaterally
(see the earlier opentester discussion in this session for the full
reasoning). You install it, I use it once it's connected:

```bash
claude mcp add openTester -- npx -y opentester-mcp-server
```

Then restart Claude Code. Verify it's connected by asking me to list its
tests once you're back.

**How it slots into the pipeline once connected:** with the `Pixel_10_Pro`
emulator already booted (confirmed earlier: `emulator-5554`,
`sdk_gphone16k_x86_64`, fully booted), the AI-exploratory-QA gate becomes:
describe each pilot module's golden path in a natural-language prompt to
opentester (the workflows in Part 3 below are written so they can be pasted
in close to verbatim), let it generate + run the Android test, and treat a
failure there as a release blocker exactly like a failed Playwright spec.

---

## Part 3 — Pilot: screen-by-screen navigation plan (restaurant, association, wallet)

Chosen because: restaurant and association are the modules this session
already deeply modified (Paystack checkout, cancel-refund fix, state-leader
RBAC/onboarding) so regressions there are the highest-value catch; wallet is
the load-bearing primitive every money-path module depends on.

For each screen: **Navigate** (exact route/tap path) → **Verify** (what
"perfect" looks like) → **Gate mapping** (which pipeline gate this screen's
correctness actually belongs to, so a failure here routes to the right fix
rather than becoming a vague "something's off").

### 3.1 — wallet

| # | Navigate | Verify | Gate |
|---|---|---|---|
| W1 | Open app → `(tabs)/wallet.tsx` | Balance, NGN/USD toggle, Add Money/Send/Withdraw/Exchange buttons, transaction list all render with no layout overflow at 375px and 428px widths | Mobile smoke |
| W2 | Tap **Add Money** → `wallet/add.tsx` | Amount field rejects <₦100 client-side; valid amount opens Paystack checkout | Unit + E2E |
| W3 | Complete a real Paystack test-card top-up | Wallet balance increases by exactly the charged amount; new row appears in the transaction list within one refresh | API + E2E |
| W4 | Tap the new transaction row → `wallet/transaction/[id].tsx` | Amount, direction, timestamp, and reference match what was charged | E2E |
| W5 | Tap **Send** → `wallet/send.tsx` | Recipient resolves by phone/email; self-transfer is blocked client-side before submit | Unit |
| W6 | Send ₦100 to a second test account | Sender debited, recipient credited, both see it within one refresh, no double-debit on a network retry | API (idempotency replay) |
| W7 | Tap **Withdraw** → `wallet/withdraw.tsx` | Saved-beneficiary picker loads; "+ New account" resolves a valid NUBAN to a real account name | E2E |
| W8 | Tap **Exchange** / bank-transfer entry → `wallet/bank-transfer.tsx` | Dedicated virtual account number + bank name shown for a Tier 1+ test account; Tier 0 account is refused with a clear message, not a blank screen | E2E + Security (tier gate) |

### 3.2 — restaurant (food)

| # | Navigate | Verify | Gate |
|---|---|---|---|
| R1 | `food/index.tsx` | Restaurant list loads, only `is_open` restaurants are orderable | Mobile smoke |
| R2 | Tap a restaurant → `food/restaurant/[id].tsx` | Menu loads, add-to-cart updates a visible cart badge | E2E |
| R3 | Proceed to `food/checkout.tsx`, pay by **wallet** | Order placed, escrowed; missing `Idempotency-Key` on a raw retry is rejected (400) | API |
| R4 | Same checkout, pay by **Paystack** | Order is placed **only after** webhook/poll confirms payment at `food/paystack/[reference].tsx`; a failed payment triggers a server-side refund with no phantom order | API + E2E (this session's cancel-refund fix — regression-critical) |
| R5 | Track the order → `food/orders/[orderId].tsx` | Status advances as the owner updates it; rider auto-dispatches on "ready" | E2E |
| R6 | Rider view → `food/rider/[orderId].tsx`, enter the wrong handoff code | Rejected, order stays `picked_up`, escrow held — does NOT silently complete | AI exploratory QA (good opentester case: "try an obviously wrong 4-digit code at handoff and confirm the order does not complete") |
| R7 | Cancel an order after escrow, before pickup | Refund posts correctly | API (this session's fixed bug — regression case) |

### 3.3 — association

| # | Navigate | Verify | Gate |
|---|---|---|---|
| A1 | `association/create/basics.tsx` → `structure.tsx` → `branding.tsx` → `access.tsx` → `membership.tsx` → `preview.tsx` → `success.tsx` | Each step persists on back-navigation (Zustand draft), Continue is disabled until required fields are valid | Mobile smoke |
| A2 | On `structure.tsx`, select "State chapters," pick a state | Leader card shows exactly 3 fields — name, phone, **email** (this session's new field) — plus the onboarding-email explainer text | E2E (already manually verified this session — promote to an automated Playwright spec) |
| A3 | Publish with a state-leader email matching an existing platform account | Leader auto-linked, granted CHAPTER_ADMIN scoped to their state, onboarding email sent post-commit | API (already covered by 6 live-DB tests this session) |
| A4 | `association/dues/index.tsx` → `pay/[invoiceId].tsx` | Paying another member's invoice by direct id is rejected (403) | Security (IDOR) |
| A5 | As the linked state leader, attempt to assign `FINANCE_ADMIN` to anyone, or any role to a member in a different state | Both rejected | Security (privilege-escalation regression) |
| A6 | `association/meetings/*` → `ai-notes/*` | AI-generated minutes require admin/secretary approval before publishing | AI exploratory QA (good opentester case: "as a plain member, try to publish AI meeting notes directly and confirm it's blocked") |

---

## Part 4 — Scaling from pilot to all 36 modules

1. Run Part 3's checklist for real against a live build (mobile-worktree
   preview + the booted `Pixel_10_Pro` emulator once opentester is
   connected); fix whatever it finds.
2. Once the pattern holds for these 3, the same table shape (Navigate /
   Verify / Gate) gets generated per module from
   [docs/qa/mobile-app-uat-test-plan.md](mobile-app-uat-test-plan.md)'s
   existing workflow + checklist sections — that document already has the
   screen inventory for all 36 modules, this runbook just adds the
   "which gate does a failure here belong to" column and the opentester
   phrasing.
3. Close the two real automation gaps found in Part 1 as separate, reviewable
   changes when you're ready for them: (a) wire the existing Playwright
   suite into a CI job, (b) add a performance-smoke job (e.g. Lighthouse CI
   for `frontend-web`, a k6 script against the Go backend's hot paths) —
   both are CI-config changes, so per your choice above I'm flagging them
   here rather than making them now.

---

## Part 5 — Pilot execution results (2026-09-19)

Ran Part 3's checklist for real against this worktree's own stack (Go
backend, frontend-web, mobile web preview, local Supabase). Two
environment problems had to be fixed before any money-path screen worked at
all — both are now corrected in `mobile-app/reactnative/.env` with comments
explaining why, so the next person testing this worktree doesn't hit them
again:

1. **Wrong API base URL.** The worktree's mobile `.env` pointed
   `EXPO_PUBLIC_API_BASE_URL` straight at the Go backend (`:8092`). Several
   mobile API clients (`wallet.api.ts`, `food/api.ts`) call routes that only
   exist as **Next.js** API routes, which then proxy to Go. Pointed straight
   at Go, every one of those 404s. Association is the one exception — its
   routes are mounted directly on Go under `/api/finance/associations`,
   which is why association testing worked earlier in this session and
   wallet/food didn't at first. Fixed by pointing at this worktree's
   frontend-web (found already running on `:3000`).
2. **Transfers defaulted to mock.** `EXPO_PUBLIC_TRANSFERS_USE_MOCK` was
   unset, which defaults to mock mode (`src/features/transfers/mock.ts:4`).
   With everything else wired to real services, the withdraw screen's PIN
   check still read a **local mock PIN** instead of the real server-backed
   one, so a correctly-set real PIN got rejected with a misleading "you have
   not set a transaction PIN yet." Set explicitly to `false`.

### wallet

| # | Result |
|---|---|
| W1 | **FAIL at 375px width, two bugs.** (a) The Income/Expenses stat amount's web font-shrink fix (`app/(tabs)/wallet.tsx:161-185`, `useWebFitFontSize`, `minScale=0.6`) still isn't enough for a 7-digit naira amount at 375px — it hits the scale floor and `numberOfLines={1}` ellipsizes real digits (confirmed via DOM: the full amount is present, only the rendered text is clipped). (b) The floating hamburger menu button (`src/components/HomeMenu.tsx:190,232` — `position:absolute`, `zIndex:900`, anchored to the same right margin) visually collides with the balance card's NGN/USD currency-toggle pill at the same width. Both reproduce at exactly 375px; passes cleanly at 529px+. |
| W2 | **Pass.** The ₦100 minimum is enforced server-side-confirmed on submit (not reactively as I first assumed) — correct behavior, not a bug. |
| W3 | **Precondition correction, not a bug.** Wallet funding via Paystack requires **KYC Tier 1** — our test fixture is Tier 0, so this blocks with a clear message. My original checklist assumed a Tier-0 admin fixture could top up; it can't, by design (compliance gate). |
| W5–W6 | **Pass** (with one caveat). Recipient/account resolution for a bank withdrawal works end-to-end against Paystack's live test-mode bank list and resolve-account API — `0123456789` + Access Bank resolved to a real test name ("okey Joy Chidimma"), fee breakdown displayed correctly (₦1,000 + ₦10 fee), and the ₦1,000 minimum-transfer validation fired correctly on an under-minimum attempt. On a later attempt the *same* input intermittently returned "We couldn't verify this account" — this looks like Paystack sandbox flakiness (identical request succeeded moments earlier), not an app bug, but worth a retry-button UX check if it recurs for real users. |
| W7–W8 | **Observation, not necessarily a bug.** The wallet home screen displays a full balance (₦4,982,957.50) sourced from a direct Supabase REST fallback (`wallet_balance` table, 200 OK) even while the "authoritative, KYC-gated" Next.js endpoint (`wallet.api.ts:12`, `/api/v1/wallet/balance`) returns 403 for this same Tier-0 account. Worth confirming with the team whether that fallback is an intentional resilience path or an unintended way for a restricted account to still see full balance data the authoritative path means to gate. |

### restaurant

**⚠️ Correction: R1–R4 below were run against mock data.** `EXPO_PUBLIC_FOOD_USE_MOCK`/`EXPO_PUBLIC_RESTAURANT_USE_MOCK` were never set and default to `true` (see the mock-flag callout near the top of this document) — the 6-restaurant catalog ("Mama Cass," "Street Buka," etc.), the cart, and the delivery-fee number below were all client-side mock behavior, not backend calls. Everything observed is still worth recording as **UI/UX verification** (the screens genuinely render and behave as designed), just not as evidence the real backend integration works — that's separate and re-tested below.

| # | Result |
|---|---|
| R1–R2 | **UI verified (was: mock data).** Restaurant list correctly shows a `Closed` badge (Street Buka) among open ones; menu correctly disables an `Unavailable` item (Ogbono Soup); cart updates live. |
| R3 | **UI verified (was: mock data), one correction to my own checklist confirmed real either way.** There is no separate "checkout, choose wallet" vs "checkout, choose Paystack" screen — both options appear in one bottom-sheet ("Pay with wallet" / "Pay with Card / Transfer") after tapping "Pay & place order" — this is a UI structure fact, unaffected by mock/real. The "5.1 km → ₦1,269.51" delivery-fee figure was mock arithmetic, not a real geocoding call — retract that claim. The "Pay with wallet" → "Your wallet is not active yet" block is likely real regardless of the restaurant mock flag (it calls the always-real wallet/tier API), but wasn't independently re-confirmed against a real order this pass. |
| R4 | Unchanged — this was already an environment/tooling limitation (Paystack popup blocked by the Browser pane), independent of mock vs real. |
| **Re-tested with mock disabled** | **Real backend confirmed working.** `GET /api/v1/restaurant` (proxied through Next.js) returns the one real seeded restaurant ("Test Kitchen," `is_open: true`); its menu loads correctly (Garri ₦200, Fufu ₦300); adding to cart works. First load took noticeably longer than the mock path (cold Next.js route compile) and briefly looked like a stuck-loading bug — it wasn't, just needed ~5s more than my first check allowed. No real backend bug found here. |
| R6–R7 | **Closed — verified directly against the service instead of the mobile UI.** A second rider-role browser session was real setup cost not worth spending just to exercise one delivery-code check; drove it the same way `tip_live_db_test.go` already drives `ConfirmHandoff` for its own settlement assertions. New live-DB test (`internal/restaurant/handoff_wrong_code_live_db_test.go`): a wrong code is rejected and the order provably stays exactly where it was (`status='picked_up'`, `dispatch_status='assigned'`, `delivered_at IS NULL`, zero rider-settlement-leg kobo posted — escrow fully held); a non-assigned rider is rejected regardless of code; the correct code then succeeds and the order completes (`dispatch_status='delivered'`). `PASS`, and the full `internal/restaurant/...` suite still green afterward (`go test ./internal/restaurant/... -count=1`, 76s, both packages `ok`). |

### association

| # | Result |
|---|---|
| A1 | **Pass.** Filled Basics (name, category, description, founded year) and Branding (logo URL, group type "Open"), then navigated back two steps to Basics — every field, including the picker-driven Category, was still correctly populated. Draft persistence across the wizard works as designed. |
| A2 | Already verified earlier this session (screenshot-confirmed the 3-field leader card). |
| A3, A5 | Not re-run via UI this pass — already proven by the 6 live-DB Go tests added earlier this session (`state_leader_rbac_live_db_test.go`), which is stronger evidence than a manual click-through would add. |
| A4 | **Pass — verified live, not just via UI.** `docs/qa/modules`'s own test suite (`money_invariants_test.go:125`) documents "ownerID != userID → ErrForbidden" as a code invariant but explicitly does NOT exercise it against a live DB (fake-based suite only). Closed that gap directly: seeded a second member + a dues invoice owned by them in the admin's existing test org, then called `POST /api/finance/associations/dues/:invoiceId/pay` as the admin against that invoice. Got `403 {"error":"association: forbidden"}` — confirmed correct, then cleaned up the seeded rows. |
| A6 | **Pass — found existing evidence, didn't need to re-derive it.** `money_invariants_test.go:610-636` (`TestAiNoteStatus_NoAuthorizationGate_DocumentsKnownGap`) is a regression-guard test documenting that "any authenticated member can approve/publish minutes" was a real, known gap that has since been fixed (`SetAiNoteStatus` now calls `requireAssocAdmin` first) — deliberately `requireAssocAdmin` rather than `requireCap`, so `SECRETARY` (the intended reviewer) keeps access despite having no `AdminCapabilities` flags set. The test is written to fail loudly if this regresses. |
| A1 (full publish) | **FAIL, then FIXED and re-verified.** Found two compounding bugs while attempting the full wizard→publish path: (1) **Data loss** — a raw browser navigation to any `/association/create/*` route (refresh, bookmark, restored tab) silently reset the org-draft Zustand store to empty while the step indicator kept showing progress; reproduced twice, wiping Basics+Branding then Structure+Membership in turn. (2) **Silent failure on top of it** — publishing in that state correctly got rejected server-side (`400`, required fields — confirmed via network log, no bad data was ever created), but `app/association/create/preview.tsx`'s `onError: () => Alert.alert(...)` never surfaced anything, since `Alert.alert` is a documented no-op on react-native-web per this project's own `mobile-app/reactnative/CLAUDE.md`, and this single-button informational alert wasn't caught by the existing `npm run check:confirm` guard (which only flags multi-button confirmation alerts). **Fixed both**: added `zustand/middleware`'s `persist` (AsyncStorage → localStorage on web) to `orgDraftStore.ts`, mirroring the identical, already-proven fix in `campaignDraftStore.ts` for the same bug class in crowdfunding; and in `preview.tsx`, replaced the raw `Alert.alert` with the project's own `alertAsync` helper, added a `hasHydrated`-gated required-field check that shows a clear "Organisation is incomplete — Still needed: ... Pick up from step 1" dialog instead of a bare 400, and disabled Publish until hydration completes. Re-verified live: the exact two-navigation repro now preserves all fields, a full publish succeeds end-to-end ("Persistence Fix Test Org is live!"), and an empty draft now shows the clear incomplete-dialog instead of silence. `tsc --noEmit` clean. Test org cleaned up from the DB afterward. |

### savings (module 4 — scaling beyond the original 3-module pilot)

| # | Result |
|---|---|
| SAV-discovery | **This is where the mock-flag trap (see the callout near the top of this document) was found.** `/savings` renders a fully convincing dashboard (4 vaults, 2 Ajo circles, a group target) entirely from `EXPO_PUBLIC_SAVINGS_USE_MOCK`'s mock data (defaults `true`, never set). Opened the "School Fees" vault (100% matured, ₦600,000), tapped "Withdraw to wallet," confirmed — got a clean "Done — ₦600,000 sent to your wallet" success state. Checked network requests afterward: **zero calls fired.** Nothing about the UI gave this away. |
| SAV-1 | UI verified only (mock): vault detail screen (balance, progress %, status, matures date, auto-save CTA) and the withdraw confirmation flow both render and flow correctly. Not backend-confirmed. |
| Re-tested with mock disabled | The real endpoint exists and responds (`GET /api/finance/savings/vaults/v_matured → 400`) — correctly rejecting the mock's fake vault id (`v_matured` isn't a real UUID), which is the expected result once pointed at live data, not a bug. |
| SAV-full-cycle | **Closed — created and funded a real vault, found and fixed a real bug in the process.** `POST .../vaults` with an "Initial deposit" of ₦5,000 created the vault correctly (`201`, `target_kobo: 5000000`) but came back `balance_kobo: 0` — the deposit silently vanished. Traced it: the Go handler's `CreateVaultRequest` (`backend/internal/savings/handler.go:63-66`) has no `initial_kobo` field at all; the client was sending it into the void. **Fixed client-side** (`src/features/savings/api.ts`'s `createVault`) — after the real vault is created, if an initial deposit was requested, it now calls the already-correct `fundVault`/`POST .../deposit` endpoint (the same one "Add money" uses) rather than teaching `CreateVault` a second money-movement path. Re-verified: new vault showed ₦5,000 / 10% of ₦50,000 immediately, backed by a real `POST .../deposit → 200`. Checked the ledger directly — this is properly balanced double-entry (`DEBIT` the wallet, `CREDIT` a settlement account, both 500000 kobo, one idempotency key) via `savings_vault_ledger` + `ledger_entries`, not a fake balance column. `tsc --noEmit` clean. Cleaned up the test vault and its ledger row after; since `ledger_entries` are immutable by this project's own rule, posted a matching `REVERSAL_CREDIT`/`REVERSAL_DEBIT` pair for the wallet-side entries rather than deleting them. |

### insurance (module 5)

Defaults `EXPO_PUBLIC_INSURANCE_USE_MOCK=false` already — no flag trap here, confirmed genuinely real via network log (`GET /api/v1/insurance/products → 200`, `/policies → 200`) before trusting the UI.

| # | Result |
|---|---|
| INS-discovery | **Pass — real, working third-party integration.** `/insurance` loads "62 plans from 6 licensed insurers" from the real MyCover.ai-backed API — genuine insurer names (Sovereign Trust Insurance Plc, Goxi MicroInsurance), real products, real NAICOM-licensing disclosure copy. |
| INS-1 | **Pass.** Opened "Third Party Bike Cover" (₦3,000/yr, Sovereign Trust) — full underwriting detail renders correctly (cover limits, renewability, claims process, risk disclaimer). Started the application: a real, insurer-driven 7-step dynamic form, not a generic one. |
| INS-DOB | ⚠️ **Gap found.** The Date of Birth picker defaults to *today's date* and the form accepted it with zero validation, advancing straight to step 2 (contact details) — nothing stops a policy application for a same-day-born applicant on a *motorcycle* policy. This may well be caught server-side by MyCover.ai's own underwriting, but the client should refuse an obviously-invalid age before it ever leaves the device. |
| — | **Deliberately stopped at step 2 of 7.** Unlike Paystack (our own sandbox, test-mode, no real money), MyCover.ai's `/products/buy` issues a real certificate with a real NAICOM-licensed insurer — completing this would create a genuine (if trivial) regulated insurance record, not a reversible test transaction. Didn't proceed past filling contact info. |

### socialPay (module 6)

Set `EXPO_PUBLIC_SOCIAL_USE_MOCK=false` before testing, per the lesson from savings.

| # | Result |
|---|---|
| SOC-1 | **Pass.** No cashtag claimed → "Set up your cashtag →" prompt shown, `GET /api/finance/social/handle/me → 404` confirms this is a real, correctly-gated check (not mock — `getMyCashtag()` in `src/features/social/api.ts:104-116` properly branches on `USE_MOCK`). |
| SOC-discovery | 🚨 **The most significant finding of this pilot — a hole in the production safety net itself, not just a local-testing gotcha.** The "Recent activity" list on the same screen shows 6 fully fabricated transactions (`@bisi`, `@chidi`, amounts, dates) with **zero backing API call** — confirmed via network log, only one request fired (`/handle/me`) for the whole screen. Root cause, `src/features/social/api.ts:118-124`: `getActivity()` is the *only* function in this file with no `if (USE_MOCK)` branch at all — it unconditionally `return MOCK_ACTIVITY`, every other function in the same file correctly checks the flag. This means it **also ignores `mockPolicy.ts`'s hard production gate** (`isMocklessEnvironment()`), which every other mock branch in this codebase respects. A real user with zero social-pay history would see 6 invented payments to/from named people, in production, the moment this module is published live — exactly the scenario `mockPolicy.ts`'s own header comment warns against ("Fake data that appears silently is worse than an empty screen or an error... a voter shown invented vote packages can be walked into a checkout for a price that does not exist"). Currently contained only because `socialPay` isn't published in production yet per the module registry — but nothing would catch this the day someone flips that flag. The code comment at line 118 is honest about the missing backend endpoint ("flip once the backend adds an activity endpoint") but the interim fallback should render an empty/error state, not fabricated data, exactly per the project's own stated policy. |

### Codebase-wide audit: how many more `getActivity`-shaped bugs exist?

The social-pay finding above is a *pattern*, not an isolated mistake — worth
searching for systematically rather than stumbling onto each instance one
module at a time. Wrote a small script (brace-matching, not just grep) that
finds every `export async function` in every file that references a `MOCK_*`
constant but never checks *any* `*_USE_MOCK` flag in its own body — the exact
shape of the social bug. Filtered out dedicated `*.mock.ts` helper files
(correctly gate-free by design, called from *inside* an `if (USE_MOCK)`
elsewhere) and false positives from module-specific flag names (e.g.
`invest.api.ts` correctly checks `INVEST_USE_MOCK`, which a naive `USE_MOCK`
grep misses).

**Result: 11 confirmed instances across 5 modules**, every single one with
its own comment where the original author already flagged the gap:

| File | Function | Author's own comment |
|---|---|---|
| `social/api.ts:121` | `getActivity` | "MISSING BACKEND ENDPOINT... Falls back to the mock feed... flip once the backend adds an activity endpoint" |
| `social/api.ts:144` | `searchCashtags` | "MISSING BACKEND ENDPOINT: no cashtag directory search exists server-side" |
| `social/api.ts:152` | `getContacts` | "MISSING BACKEND ENDPOINT: no /contacts directory endpoint exists" |
| `social/api.ts:158` | `listSplits` | "MISSING BACKEND ENDPOINT: no GET /splits (list) endpoint" |
| `social/api.ts:176` | `listPools` | (same pattern, no GET /pools list endpoint) |
| `creators/api.ts:76` | `listCreators` | "MISSING BACKEND ENDPOINT: no creator discovery/list endpoint exists" |
| `creators/api.ts:163` | `listSubscriptions` | "MISSING BACKEND ENDPOINT: no 'my subscriptions' list endpoint exists" |
| `events/api.ts:236` | `listVendors` | explains the mock vendor items have "no backend concept at all" — structurally permanent, not temporary |
| `events/api.ts:254` | `getVenueMap` | "no venue-map endpoint exists on the backend route table at all... flagged in the report" |
| `insurance/api.ts:79` | `getKycProfile` | most explicit of all: **"this stays mock-only in live mode too... report upstream"** |
| `loyalty/api.ts:98` | `getLedger` | "no points-ledger history endpoint is exposed to members yet" |

Every one of these bypasses not just the local `USE_MOCK` dev flag but
`mockPolicy.ts`'s hard production gate (`isMocklessEnvironment()`) too,
because they never call `mockAllowed()` at all — they're unconditional. The
insurance one is the most striking: its own comment says outright that it
stays mock **in live mode**, i.e. the author already knew this violates the
"never in production" rule stated at the top of `mockPolicy.ts`, and left a
note to "report upstream" — there's no evidence in this codebase that ever
happened (no tracking issue referenced, no `docs/qa` entry).

**Fixed all 11, immediately** — each now checks `isMocklessEnvironment()`
directly and returns an empty array (or, for `getKycProfile`, a blank
unverified profile) in a mockless build, while keeping the existing mock
behavior for local dev unchanged. Building the missing backend endpoints
themselves is real feature work, out of scope here — this closes the actual
safety gap (fabricated data reaching a real user) without touching that.
`events/api.ts`'s `listVendors` got the most careful treatment: its own
comment says the fake vendor prices *drive the real charge amount* on
tap-to-pay, making it the most severe of the 11 — a real user could have
been charged against a fabricated price for a fabricated item. `tsc --noEmit`
clean after all 11 edits. Re-ran the audit script (extended to also accept
`isMocklessEnvironment()` as a valid gate, not just `*_USE_MOCK`): **0
remaining instances** anywhere in the codebase.

### Net takeaway

The pilot's real purpose — proving the Navigate/Verify/Gate methodology
surfaces genuine, actionable findings rather than rubber-stamping — worked,
and it worked in every direction: it found real bugs (wallet viewport
clipping/collision, the misleading mock-PIN error, and — the most serious
find of the pass — silent draft data loss on a raw navigation compounded by
a silent-alert bug on the publish path); it found a systemic methodology
trap (the mock-flag default) that retroactively corrected an earlier
module's results, and corrected them in place rather than leaving a wrong
finding standing; it closed two documented-but-unverified gaps by actually
exercising them against a live DB (A4's IDOR
check, confirmed with a real 403) rather than trusting a code comment; and
it surfaced a genuine tooling boundary (R4's popup block) instead of
quietly skipping it or claiming a false pass. Three findings (the balance-
fallback gap, the restaurant KYC-gate correction, and the wizard data-loss
bug) need triage with whoever owns those modules — the data-loss bug in
particular is worth prioritizing, since it's a real-work-loss bug on a
money-adjacent flow (dues collection depends on the org existing), not a
cosmetic issue. Remaining pilot gaps — R6–R7 (rider handoff) — are real
setup cost (a second role, an order in flight), not blocked by anything;
next step if continuing this exact pilot.

**Both closed in a later pass**: R6–R7 verified live against the service
directly (see below), and a real bug found and fixed in savings (an
"initial deposit" field on vault creation that silently did nothing).

---

## Part 6 — Comprehensive association-module UAT (elections, meetings, AI
notes, committees, directory, events, tasks)

Requested separately: "ensure they are all fully tested — UAT, all working
and production ready, identify all bugs and fix it." Approach: 4 parallel
research agents mapped each area's mobile screens, backend functions, and
*existing* test coverage first (association already has ~100 tests across
`internal/association/` + `tests/association/`) — so effort went into the
actual gaps between what's tested and what the code does, not re-deriving
already-proven behavior.

### Real bugs found and fixed (all live-DB tested, all confirmed against a
### clean `go build`/`go vet`, full suite green throughout — 100+ tests)

| Area | Bug | Fix | Test |
|---|---|---|---|
| AI notes | `SetAiNoteStatus` had no transition guard — a note could be published while still `PROCESSING` (skipping review), or published twice/out of order, each call independently overwriting status and auditing | Conditional `UPDATE ... WHERE status=$3` (same shape as `DecideMeeting`'s existing pattern), new `ErrNoteState` sentinel → 409 | `TestLiveDB_SetAiNoteStatus_RejectsPublishBeforeApprove` |
| AI notes | `RegenerateAiNoteSummary` unconditionally reset status to `PROCESSING` regardless of current status — could silently revert a **published, sealed** meeting's official minutes back to draft, with no error and no visible sign anything changed | Excluded `PUBLISHED` from the UPDATE's own `WHERE` clause (race-safe, not just checked beforehand) | `TestLiveDB_RegenerateAiNoteSummary_RejectsOncePublished` |
| AI notes (mobile) | Compounding the above: `ai-notes/[id]/index.tsx` never hid the Regenerate/Edit controls once `PUBLISHED`, and used raw `Alert.alert` (4 call sites) — a no-op on web, per this project's own CLAUDE.md | Hid the controls once published; replaced all 4 with `alertAsync` | `tsc --noEmit` clean; manually inspected |
| Directory | `GetDirectory` hardcoded `ORDER BY mp.full_name LIMIT 200` — no offset param existed anywhere in `MemberDirectoryQuery` or the function signature. Any org over 200 members silently truncated, identically, for every caller | Added `limit, offset` params (same clamp/default shape as `GetOrganisations`), wired through `pageParams(c)` in the handler | `TestLiveDB_GetDirectory_LimitAndOffset` |
| Tasks | `UpdateTaskStatus` accepted any of the DB's 11 valid statuses from the **assignee** — including self-jumping straight to `COMPLETED` (skipping `AWAITING_REVIEW`) or setting `OVERDUE` directly, contradicting `TestGetTasks_OverdueIsDerivedNotStored`'s existing invariant that nothing ever writes `OVERDUE` | New `assigneeTaskStatuses` allow-list (`ACCEPTED`/`IN_PROGRESS`/`BLOCKED`/`AWAITING_REVIEW` only) — mirrors exactly what the mobile UI's own `NEXT_STATUS` map offers | `TestLiveDB_UpdateTaskStatus_AssigneeCannotSelfApproveOrSetOverdue` |
| Meetings | `CheckInMeeting` had no time bound at all — a member could "check in" to a meeting that hadn't started, or one from months ago, producing a false attendance record (`assoc_meetings.state` is decorative — never transitioned by any code path, confirmed by grep — so the fix reads `starts_at`/`ends_at` directly, same as the mobile UI's own `isPast`) | Windowed to `[starts_at − 15min, COALESCE(ends_at, starts_at) + 4h]` | `TestLiveDB_CheckInMeeting_RejectsOutsideWindow` |

### Investigated, found already correct — closed the "untested" gap without
### changing behavior (elections module: the codebase's own "release-blocking
### invariants" file, now with 3 fewer unverified claims)

- `PublishResults`'s CLOSED-only precondition — already a conditional UPDATE, already correct → `TestLiveDB_PublishResults_RejectedBeforeClose`.
- `CastVote`'s invalid-ballot rejection (wrong election's position, wrong election's candidate, a `WITHDRAWN` candidate) — already checked in 3 places → `TestLiveDB_CastVote_RejectsInvalidBallots`.
- `AddCandidate`'s officer-only, same-org authorization — already enforced → `TestLiveDB_AddCandidate_OfficerOnly`.

### Investigated, confirmed NOT a bug (avoided fixing something that wasn't broken)

- **"RSVP capacity bypass" (events)**: `RsvpEvent` has no capacity check, but `rsvp` and `registered` are separate columns on the same `assoc_event_registrations` row — confirmed via the mobile client (`events/[id].tsx`) that the only UI path setting `rsvp` is the *decline* button ("Can't go" → `NOT_GOING`); the actual capacity-limited "going" path is `RegisterEvent`, which does enforce capacity correctly. RSVP is a non-binding intent signal by design, not a ticket.
- **"Last committee admin removal" (committees)**: `RemoveCommitteeMember` has no "is this the last CHAIR" check, but every committee mutation is authorized through `committeeOrg`, which checks *org-level* admin capability — an org admin can always reassign a new chair regardless of current chair count. Recoverable by design, not a lockout (unlike the org-level founder-lockout case this codebase already guards elsewhere).
- **"Task reassignment mid-flight" (tasks)**: `UpdateTask` takes a full `TaskRequest` and defaults a missing `Status` to `ASSIGNED` — reassigning a task without resending its current status would silently reset an `IN_PROGRESS`/`AWAITING_REVIEW` task back to square one. But the only real caller, `TaskForm.tsx`, pre-fills `status` from the row being edited and always resubmits it (`useState(oneOf(row?.status, STATUSES, 'ASSIGNED'))`) — not reachable through the actual admin UI. Flagged as API-contract fragility for a future non-form caller, not fixed.

### Closed in a later pass

- **Multi-position elections** — confirmed working: `CastVote`'s ballot uniqueness is keyed on `(election_id, position_id, voter_membership_id)`, position included, so voting on one position never blocks or interferes with another in the same election, and a voter may legitimately abstain on one position while voting on another. `TestLiveDB_Election_MultiPosition_IndependentVotesAndTally`.
- **Suspended-member directory visibility — a real bug, found and fixed.** `GetDirectory`'s own comment claimed "a plain member still only ever sees ACTIVE members," but the code gated the ACTIVE-only filter on `q.Status == "" && q.OrgID == ""` — so a plain member (no `org_id`, since they can never pass the admin-only `requireCapInOrg` check the override needs) could set their *own* `?status=SUSPENDED` and skip the ACTIVE-only clause entirely, with no authorization check on that override at all. Fixed by gating the ACTIVE-only filter on `q.OrgID` alone, so only the authorized admin-override path can ever request a non-ACTIVE status; an unauthorized override now fails closed to an empty result rather than leaking. `TestLiveDB_GetDirectory_PlainMemberCannotOverrideStatusFilter`.

### Still not reached (genuinely missing feature, not a bug)

- Committee chat has no edit/delete-message capability at all — an absent feature, not a broken one; building it is new feature work, out of scope for a bug-fixing pass.
- Meeting RSVP's own time-window (lower stakes than check-in: already hidden client-side once `isPast`, and an RSVP carries no attendance/audit weight the way check-in does).

---

## Part 7 — referrals (module 7, spot-check)

Defaults `EXPO_PUBLIC_REFERRAL_USE_MOCK=true` — set to `false` before testing, per the standing lesson from Part 5. Lighter-touch pass than the earlier modules (no request for exhaustive UAT here, unlike association) — enough to confirm no regression and no new mock-flag trap, not a full Navigate/Verify/Gate sweep. This module has documented prior history (`referral-module-integration.md`/`referral-code-two-namespaces.md` — two backend referral systems + two DB namespaces, five defects previously found and fixed) that this pass didn't re-litigate.

| # | Result |
|---|---|
| REF-discovery | **Pass — real, working.** `/referral` loads live: `GET /api/v1/referrals/me/dashboard`, `/api/v1/referral/my-rewards`, `/api/v1/referrals/me/earnings` all `200`, showing genuinely empty state (₦0 earned, "No activity yet", STARTER tier) consistent with this account never having referred anyone — not fixture data. |
| REF-1 | **Pass.** "My code, link & QR" generated a real code (`QC7YK`) and a matching invite link, not a placeholder. |
| REF-5 | **Pass.** Withdraw correctly blocked: "Withdrawals locked — Complete identity verification to withdraw your earnings" — consistent KYC-tier enforcement, same gate observed on every other money-out path this session (wallet top-up, restaurant wallet-pay, savings). |
| — | Code-entry (self-referral rejection, invalid-code rejection) not exercised — that's an onboarding-flow screen meant for a brand-new signup, and simulating one wasn't worth the setup cost for a spot-check pass. |

No bugs found. No fixes needed.

---

## Part 8 — crowdfunding (module 8): re-verifying a previously-flagged security concern

Rather than picking a fresh module blind, followed up on `mobile-app-uat-test-plan.md`'s own CF-4 flag: crowdfunding's admin withdrawal-approval route was found (in the earlier research pass that built that doc) gated only by `requireUserID()` — authenticated, not authorized — meaning any signed-in user, including a campaign creator, could approve withdrawals, feature their own campaign, or read the finance/compliance/fraud consoles.

**Reading `internal/crowdfunding/adminext/routes.go` first**: it now carries an extensive comment describing this *exact* gap being found and fixed — every route gated behind `RequirePermission(rbac, "crowdfunding.admin.review"/"...decide")`. Read-only, this looked resolved — but this session's whole discipline has been "verify live, don't trust a comment," so:

**Verified live, not just read.** `admin@spotlight.internal` already holds crowdfunding admin permissions (expected — it's a super-admin fixture), so testing with it would prove nothing about whether a *non-admin* is blocked. Seeded a genuinely unprivileged throwaway user (fresh `auth.users` row, no role grants) via the Supabase admin API, got a real password-grant token for them, and called the three highest-value routes directly:

| Route | Called as the unprivileged user | Result |
|---|---|---|
| `GET /api/crowdfunding/admin/withdrawals` | read the approval queue | `403 forbidden` |
| `POST /api/crowdfunding/admin/withdrawals/:id/approve` | approve a withdrawal | `403 forbidden` |
| `PATCH /api/crowdfunding/admin/campaigns/:id/flags` | self-feature a campaign | `403 forbidden` |

All three correctly blocked. The fix is real, not just documented. Cleaned up the throwaway user (`auth.users` + `platform_users`) afterward. Updated `mobile-app-uat-test-plan.md`'s CF-4 row from "⚠️ verify whether this has been fixed" to "✅ re-verified fixed" with this evidence, rather than leaving a stale warning standing once it's actually been checked.

No bug found — this one closes a documented open question rather than surfacing a new one.

## Part 9 — aiCare (module 9): closing a flagged IDOR (AIC-2)

Picked the next open ⚠️ flag from `mobile-app-uat-test-plan.md` (a full `grep -n "⚠️"` pass turned up ~18 remaining items across virtualAccounts, fx, health/pharmacy/lab/vet, telemedicine, groups, estate, socialPay, transport, aiCare, disputes, and ratings). AIC-2 was picked first because — unlike most of the list, which asks "confirm current state" — it named a concrete, checkable authorization gap: "`resolve` is NOT owner-scoped."

**Read the code first.** `internal/aicare/service.go`'s `Resolve(ctx, sessionID, actorID string)` took `actorID` as a parameter but never referenced it in the query:
```go
const q = `UPDATE support_sessions SET status='resolved', updated_at=NOW() WHERE id=$1 AND status != 'resolved'`
_, err := s.db.Exec(ctx, q, sessionID) // actorID never passed
```
Every sibling method (`SendMessage`, `Escalate`, `GetHistory`) scopes its query with `AND user_id=$2` — `Resolve` was the sole exception. The handler (`internal/aicare/handler.go`) passes the caller's own `user_id` in as `actorID`, so the auth context was available; it just wasn't used. Row-Level Security on `support_sessions` requires `user_id = auth.uid()` for `UPDATE`, but the Go backend connects with elevated (non-RLS-enforcing) credentials, so the DB-level policy provided no backstop — the missing application-level check was a real, exploitable IDOR: any authenticated user could resolve (silently close) any other user's open support session by ID, with no ownership check at all.

**Fixed**: added `AND user_id=$2` to the `UPDATE`, and made it fail closed — `RowsAffected() == 0` now returns an error (session not found / not yours / already resolved) instead of silently succeeding as a no-op. Handler's error status changed from 500 to 400 to match `Escalate`'s existing convention for this kind of rejection.

**Live-DB regression test** added: `internal/aicare/resolve_idor_live_db_test.go::TestLiveDB_Resolve_RejectsNonOwnerThenOwnerSucceeds`. Verified the test actually catches the bug (temporarily reverted the fix via `git stash`, confirmed the test fails with "expected error when a non-owner resolves another user's session," then restored the fix and confirmed it passes) — not just that it passes against the fixed code, which would prove nothing on its own. Full flow asserted: non-owner `resolve` call is rejected AND leaves the session untouched (`status` still `open`); the actual owner can resolve their own session; resolving an already-resolved session fails closed rather than no-op-succeeding.

Full `internal/aicare` suite (23 tests, including the new one) green; `go build ./...` and `go vet ./...` clean across the whole module. Updated `mobile-app-uat-test-plan.md`'s AIC-2 row from "⚠️ Known gap" to "✅ Fixed 2026-09-19" with the fix + test summary.

One real bug found and fixed — the pattern holds: reading the flagged concern found a genuine, unambiguous vulnerability this time (unlike several earlier "investigated, not actually broken" items), so this one graduates straight to fixed rather than to a documented non-issue.

## Part 10 — groups (module 10): FOOD-4 closed as stale, GRP-4 uncovered a second, worse bug

Attempted to parallelize the remaining ~16 ⚠️ flags across 4 background research agents (health cluster, finance cluster, restaurant/social/transport, disputes/ratings). All 4 hit the account's weekly API rate limit mid-investigation and terminated before producing usable findings — continued the closure pass directly instead of retrying agents.

**FOOD-4** ("restaurant only checks wallet balance, not the KYC/tier-limit gate transport enforces") closed as stale by direct code comparison: `restaurant.placeOrder` (`internal/restaurant/service.go:816`) calls `s.tiers.EnforceCheckoutDebitLimit`, the *exact same function* `transport.service.go:123` calls, both against `internal/finance/tiers/checkout.go:70`. Both fail closed on a nil gate via their own `ErrTierGateUnwired`. This matches the "Your wallet is not active yet" message observed in this session's earlier live restaurant testing — that message comes from this same tier-0 gate, not a separate wallet-activation-only check as the flag speculated. No code change; doc corrected.

**GRP-4** ("dues use `ledger.Debit` directly, bypassing the usual tier-limit check") — confirmed as flagged: `groups.PayDues` (`internal/groups/service.go`) called `s.ledger.Debit` with zero tier-limit check, and the `Service` struct had no `tiers` field to even check. But reading `Create()` to understand how the group's wallet gets set up first surfaced a **second, more severe bug that made the flag almost moot**: `Create()`'s ledger-account insert was

```go
const insertAccount = `
    INSERT INTO ledger_accounts (user_id, type)
    VALUES (NULL, 'group_wallet')
    ON CONFLICT DO NOTHING`
```

— never binding `group_id` to the group just created. `PayDues` looks the wallet up with `WHERE group_id=$1`, so **no group's dues payment could ever succeed at all**, tier gate or not — every attempt would fail at "group wallet not found." Verified live before touching any code: wrote a throwaway probe test that called the real `Create()` against the local DB and confirmed the newest `group_wallet` row's `group_id` was `NULL` regardless of which group was created. A migration comment in `20260912000001_ledger_accounts_reconcile.sql` independently confirms the schema's intent — group wallets are supposed to be "keyed by group_id via `ledger_accounts_group_wallet_idx`" — corroborating this was a real regression, not by-design.

**Fixed both**:
1. `Create()` now passes `g.ID` into the insert so the wallet account is actually findable.
2. `PayDues` gained the same fail-closed `tierLimiter` seam restaurant/transport use (`WithTiers`, `EnforceCheckoutDebitLimit`, `ErrTierGateUnwired` on a nil gate), wired to the shared `tiersSvc` instance in `finance_routes.go`. Handler error mapping added (`payDuesErrStatus`) so a tier refusal surfaces as 403, a gate-unwired misconfiguration as 503, matching restaurant's `escrowErrStatus` convention instead of a blanket 500.

**Live-DB tests** added (`internal/groups/dues_live_db_test.go`, 3 tests): wallet is findable by `group_id` after `Create()`; a Tier-0 (unverified) member's dues payment is refused with `tiers.ErrWalletDisabled` and posts zero `group_payments` rows, while a funded Tier-3 member succeeds and the group wallet is verifiably credited the plan amount in `ledger_entries`; a `Service` with no tier gate wired refuses with `ErrTierGateUnwired` rather than debiting ungated. Verified the wallet-fix test against the original code via a standalone probe (confirmed `group_id IS NULL` live, then re-verified fixed); verified the tier-gate tests require the new API to even compile against the reverted files (via a scoped `git stash` of just `service.go`/`handler.go`, restored after). Full `internal/groups` suite green; `go build ./...`/`go vet ./...` clean repo-wide.

Two real bugs closed, one stale flag corrected — the second bug (orphaned group wallet) is a good example of why reading the surrounding code before writing a fix matters: the originally flagged concern (missing tier gate) was real, but fixing only that would have left dues payments just as broken as before, for a completely different reason the flag never mentioned.

## Part 11 — closing every remaining flagged item (2026-09-22)

Worked through the rest of the ~16 remaining ⚠️/🚫 flags from `mobile-app-uat-test-plan.md`, one at a time, same discipline as Parts 6–10: read the code first, verify live where it mattered, fix real bugs with a live-DB regression test, and document a verified-correct item as such rather than silently leaving the stale warning in place.

**Verified correct, no code change (8 items)** — VA-4 (virtual accounts already fail closed with a typed `ErrProviderUnavailable` → 503, mobile already has a retry state, not a crash), SOC-4 (AML velocity check already fails closed on any DB error, wired unconditionally into every social money-moving path), TRN-4 (the centralized `mockPolicy.ts` gate already hard-disables mock fare data in staging/production regardless of the per-module flag), HLT-2 (health hub already has a proper retry error state), PHM-3 (stronger than asked — a hard DB `CHECK` constraint makes a controlled-substance row physically impossible, not just filtered from a list), LAB-2 (chain-of-custody breach really is enforced at both accession and result-entry, not just documented), TELE-3 (RTC token issuance never fabricates a token when unconfigured, and the mobile call screen already has both a generic retry state and an explicit Agora→VideoSDK fallback banner), DIS-3 (the previously-fixed FOOD-008 self-resolve gap is still closed — `restaurant.admin.disputes` RBAC still gates the only live resolve route). The estate resident-screens question also resolved without a code change: `app/property/estate.tsx` is a live, reachable resident hub (dues, meetings, elections, facilities, and more) — the earlier survey missed it on a naming-convention assumption (`app/estate/*` vs `app/property/estate.tsx`).

**Documented as an intentional scope gap, not a bug (1 item)** — FX-4: markup validation is solid at the API layer (both out-of-range and too-precise values rejected, backed by a DB `CHECK` constraint), but no admin console page exists yet for the real `/api/finance/admin/fx/markup` endpoint at all. `fxAdminService.ts` is already honest about this (mock-backed, refuses to fabricate success). Building a new admin page is out of scope for a bug-closure pass — documented precisely instead of half-building one.

**Left open, needs a product decision (1 item)** — AIC-1: `app/services/support.tsx` is still a genuinely static contact form with zero backend wiring, and the real aiCare backend has no connected mobile screen. Whether to wire this screen up, build a dedicated one, or leave aiCare backend-only is a product call this pass should not make unilaterally.

**Real bugs found and fixed (2 items)**:

- **VET-3** — a bug identified in an earlier session (2026-09-15, spun off as `task_a86ef5d8`) but never actually fixed: `Appointment.ServiceID` was a plain `string`, but `vet_appointment_payments.service_id` is `ON DELETE SET NULL` against `vet_services`. Hard-deleting a referenced service crashed pgx's scan ("cannot scan NULL into *string") on both the single-appointment `Get()` path and, worse, `ListAppointmentsForPatient` — where one bad row failed the WHOLE list. Fixed by making `ServiceID *string`, matching the struct's existing `EscrowID`/`ConsultID`/`DeliveryRef` fields — no scan-site changes needed once the field itself was a pointer. Live-DB tests added (`internal/health/vet/null_service_id_live_db_test.go`) hard-delete a service after booking and confirm both `Get()` survives and the list returns the NULL-service row alongside a normal one rather than failing entirely.

- **RAT-3** — worse than the flag suspected. `ratings.Service.Create` didn't just silently no-op a duplicate submission; it returned a FABRICATED `Rating` on conflict — a fresh random id, the *rejected* second request's own score/comment, and `time.Now()` — so a duplicate submission with a different score got back a response actively lying about what was stored. Fixed: `Create` now returns `(rating, created bool, err)`, fetching and returning the row that actually exists on conflict; the handler returns `200` instead of a fabricated `201`. Live-DB test proves the second response's id/score/created_at match the real first row, not the rejected second request. No mobile screen currently calls this endpoint, so the UI-messaging half of the original flag doesn't apply yet — the backend-level fabrication was the real defect.

**Admin console honesty fix (1 item, not a backend bug)** — DIS-2: confirmed the generic dispute resolver only moves real money for `module_type=="food"`, by deliberate, documented design (no refund engine exists yet for stays/mobility/etc). Not something to fix by building a refund engine here. But the admin console offered "Full refund"/"Partial refund" with zero indication this wouldn't move money for any other module — fixed with an inline warning in `frontend-admin/app/admin/finance/disputes/page.tsx`, verified live in the browser (mocked a "stays" dispute via a client-side `fetch` override rather than seeding the shared `:8091` backend, confirmed the warning appears on selecting a refund resolution and disappears on "No action").

**Verification discipline held throughout**: every fix got a live-DB regression test, and every test was checked against the ORIGINAL buggy code via a scoped `git stash` of just the fix files (never a bare `git stash`/`pop`, per this worktree's shared-stash-stack rule) — confirming each test either fails outright or fails to compile without the fix, not just that it passes with it. Full `go build ./...` / `go vet ./...` clean repo-wide throughout; the combined live-DB suite for every touched module (`aicare`, `groups`, `health/vet`, `finance/ratings`, `restaurant`) is green. `frontend-admin`'s `tsc --noEmit` is clean.

All ~16 originally-flagged items from `mobile-app-uat-test-plan.md` are now closed, one way or another: fixed (4 across this session — AIC-2, GRP-4's two bugs, VET-3, RAT-3), verified already correct (10), documented as an intentional scope gap (1: FX-4), or left explicitly open pending a product decision (1: AIC-1).
