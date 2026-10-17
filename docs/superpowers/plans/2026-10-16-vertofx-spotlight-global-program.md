# Spotlight Global on VertoFX — Program Plan & Gap Analysis

> **For agentic workers:** this is the PROGRAM-level plan. It decomposes the spec into sub-projects (SP-0…SP-7), records the code-grounded reality, and locks the business decisions. Each sub-project gets its own detailed, executable plan under `docs/superpowers/plans/`. The first, SP-1, is written: [`2026-10-16-sp1-vertofx-provider-default.md`](2026-10-16-sp1-vertofx-provider-default.md).

**Goal:** Add VertoFX (Atlas for Platform) as the default cross-border FX/payments provider inside Spotlight, earning Paymax a platform fee + FX spread on every transaction, posted into the existing commission module — built as an extension of the FX feature that already exists, not a greenfield subsystem.

**Architecture:** VertoFX is a new adapter behind the existing `internal/orchestration` provider interface (mirroring Eversend). A new config-driven "default/preferred provider" mechanism makes Verto win routing with Eversend/MapleRad as fallback. Per-user Verto sub-accounts (KYB/KYC submission) and the Platform Fee + commission wiring are net-new; the ~50 existing mobile FX screens and the admin FX section are wired to the new real endpoints.

**Tech Stack:** Go 1.27 / Gin (module `spotlight/backend`); PostgreSQL 17 via Supabase (additive-only migrations); React Native / Expo Router (`mobile-app/reactnative/`); Next.js admin (`frontend-admin/`).

**Spec:** [`docs/superpowers/specs/2026-10-16-vertofx-spotlight-global-design.md`](../specs/2026-10-16-vertofx-spotlight-global-design.md)

---

## Resolved decisions (from product owner, 2026-10-16)

| # | Decision | Impact |
|---|---|---|
| D1 | **One entity — Paymax** contracts with Verto, earns the fee, invoices users | Spotlight is the app brand; Paymax is the contracting/fee entity. Fee revenue posts under Paymax in the commission module. |
| D2 | **Build against Verto sandbox now**; counsel clearance + individual-onboarding (V1) remain **go-live gates**, not build blockers | SP-0 gates tracked in parallel; nothing in SP-1–SP-7 is blocked from sandbox build. |
| D3 | **Both** individuals and businesses | Onboarding supports a sole-proprietor variant for individuals (spec §6.5 option B) plus the full business/UBO path. |
| D4 | Platform fee = **flat AND %**, **customer pays** by default; **single fee schedule** at launch | No plans engine in v1 (spec §7.10 deferred). Fee numbers are admin config; placeholders until the Verto rate card lands (V4). |
| D5 | **FX spread targets per corridor/tier with hard floor/cap** — numbers TBD (rate card) | Spread engine already exists (`orchestration.NewSpreadEngine`, `fx_markup_rates`); floor/cap guardrail is net-new config. |
| D6 | Fee collection = **ledger-charge + daily sweep**, with NGN-wallet/spread fallback | `FeeCollector` strategy; sweep gated on Verto V5/V18 approval. |
| D7 | **Pre-fund master wallet in NGN**, monitored by Paymax/Admin | Treasury module tracks NGN master; other currencies funded via collections/conversion. |
| D8 | Priority §20 extras: **X1 Invoice, X5 Family allowance, X6 Auto-convert, X8 Target-rate** | Scheduled into SP-6. Others deferred. |
| D9 | Regulated-adjacent **X19 escrow / X20 savings circles / X7 DCA → counsel**, out of build scope until cleared | Not planned; tracked as counsel items. |
| D10 | **Routing default = VertoFX, preferred-with-score-fallback** | SP-1 mechanism: Verto tried first / wins when it covers the corridor; score-based routing + Eversend/MapleRad only on no-coverage or runtime failover. |
| D11 | **English only** for v1 | No i18n work; Pidgin/French deferred. |
| D12 | Timeline **aggressive (1 day / ~10 workstreams)** | Honest note below: the full program cannot land in one calendar day. SP-1 (foundation) is the immediately shippable unit. Sub-projects map to parallel workstreams. |

### Honest timeline note
The full spec (U1–U24, X1/X5/X6/X8, mobile M1–M13, admin A1–A12, ledger/commission/recon/treasury) is a multi-sprint program. It cannot be completed, tested and made production-safe in one calendar day — these are money-movement paths that require tests-first, ledger-auditor review and reconciliation proof before go-live (CLAUDE.md iron rules). What *is* achievable quickly is **SP-1**: the VertoFX adapter + default-provider mechanism + feature flag, fully tested against the fake rail/sandbox, shipped dark behind `FEATURE_VERTOFX`. The decomposition below assigns the rest to parallel workstreams so ~10 teams can proceed concurrently where dependencies allow.

---

## Repo grounding & gap analysis

The spec assumed greenfield. The repo already contains a substantial FX feature. Legend: **[HAVE]** exists and reused as-is · **[EXTEND]** exists, needs additions · **[NEW]** net-new.

### Backend
| Area | Reality | Status |
|---|---|---|
| FX orchestration engine | `backend/internal/orchestration/` (ADR-051): provider-agnostic router, spread engine, treasury float buckets, own double-entry book (`orch_ledger_entries`), per-currency balances (`orch_balances`), webhooks on `POST /api/v1/fx/webhooks/:provider`. Flag `FEATURE_FX_ORCHESTRATION_ENABLED`. | [HAVE] |
| Provider interface | `orchestration.Provider` — `routing.go:40` (Name/Supports/Quote/ExecuteConversion/ExecuteTransfer/CreateCollection/VerifyWebhookSignature). | [HAVE] |
| Eversend adapter (the model for Verto) | `provider/eversend/eversend.go` (OAuth-ish token, major-unit amounts) + `orchestration/adapters/eversend.go`. | [HAVE] |
| MapleRad | FX adapter + WaaS domain (`finance/maplerad`) + bills + **virtual cards** + bank payout rails + NGN VAs. Broader than spec assumed. | [HAVE] |
| **VertoFX adapter** | Does not exist. New client `provider/vertofx/` + adapter `orchestration/adapters/vertofx.go`. | **[NEW] — SP-1** |
| **Default/preferred provider mechanism** | Does not exist. Routing is pure best-score; collections hardcode `"maplerad"`/`"eversend"` (`service.go:503`). | **[NEW] — SP-1** |
| Ledger | `internal/finance/ledger/` double-entry, **int64 kobo**, append-only; `AccountType` is a **closed enum + DB CHECK**; corrections = reversals only. Posting: `Credit/Debit(+Gated)/PostJournal/PostReversal/Posted`. | [HAVE] |
| New ledger accounts (`revenue:platform_fee`, `revenue:fx_markup`, `receivable:verto_markup`, `fees_unswept`, `tax_payable:vat`) | Do not exist. Need Go `AccountType` constants + a CHECK-widening migration. Closest existing: `fx_spread_income`, `paymax_spread`, `paymax_revenue`, `commission`. | **[NEW] — SP-3** |
| Commission module | `internal/finance/commission/` central realized-profit registry. `RecordExact(...)`/`Recorder` is the `CommissionPort` target; idempotent; posts DR `provider_clearing` → CR `commission`. **But orchestration FX does not call it yet.** | [EXTEND] — SP-3 |
| Transactional outbox | **None** on the money path. Repo uses in-tx atomicity + idempotency keys + PENDING-row retries. Spec's outbox assumption is dropped. | n/a |
| KYC | Tiers **T0–T3** (hardcoded limits map, fail-closed `EnforceWalletDebitLimitTx`); ADR-013 multi-provider gateway (Dojah/Smile/Youverify, BVN/NIN/liveness/doc/AML); `kyc.Service.Approve` elevates tier + auto-provisions NGN VA. | [HAVE] |
| **Verto KYB / sub-account onboarding** | Does not exist (no KYB/Verto code anywhere). New backend domain + a KYB submission port on the existing provider pattern; reuse the Spotlight KYC layer as tier-2 pre-gate. | **[NEW] — SP-2** |
| Wallet | NGN main wallet = ledger projection; multi-currency via `orchestration` (`orch_balances` + NGN in main ledger). No bare balance updates. | [HAVE] |
| Feature flags | `getEnvBool("FEATURE_*")` on `config.Config` + conditional route mount in `finance_routes.go`. `FEATURE_VERTOFX` / `FEATURE_SPOTLIGHT_GLOBAL` are new. | [EXTEND] |
| Migrations | `supabase/migrations/`, 14-digit timestamp, additive-only, collision guard (`check-migration-versions.sh`). No Go-side runner. | [HAVE] |

### Mobile (`mobile-app/reactnative/`)
| Area | Reality | Status |
|---|---|---|
| FX screens (~50) | `app/fx/*`: convert, send (+bulk/recurring), receive, beneficiaries, cards, transactions (+dispute), **kyc/KYB**, business, settings, rate-alerts. | [HAVE] |
| Design tokens + FX component library | `src/constants/tokens.ts` (Material-3, Plus Jakarta Sans); `src/features/fx/components/*` (RateTicker, QuoteBreakdown, RateLockCountdown, etc.). No literal `MoneyText`; formatting in `fxFormatters.ts`. | [HAVE] |
| API layer | `src/features/fx/api/fx.api.ts` hits `GET/POST /api/v1/fx/*` with `Idempotency-Key`; **mock-by-default** via `EXPO_PUBLIC_FX_USE_MOCK`. React Query v5 + Zustand; no XState. | [EXTEND] — flip to real VertoFX-backed endpoints |
| Global-account activation + Platform-fee breakdown | Activation flow + fee-breakdown line (platform fee/spread/tax) not present as a Verto flow. | **[NEW] — SP-4** |
| "Global" tab | Only 4 bottom tabs by deliberate choice; FX is reached via module registry `src/constants/modules.ts`. A 5th tab is a design departure. | decision — SP-4 |

### Admin (`frontend-admin/`)
| Area | Reality | Status |
|---|---|---|
| FX Orchestration section (15 pages) | `app/admin/fx/*` + sidebar section — but **almost entirely mock**; `fxAdminService.ts` throws `NO_BACKEND_YET` for most mutations. | [EXTEND] — make real |
| Real backend admin surface | Only `GET/PUT /api/finance/admin/fx/markup` (+audit), permissioned `finance.admin.fx_markup`, backed by `fx_markup_rates` (ADR-030/032). This is where the Platform-Fee/rate-card console extends. | [HAVE] |
| RBAC | Permission-string based (`hasPermission`, `routeGuard.ts`, backend `middleware.RequirePermission`); **not** a 5-role enum. The spec's Admin/Finance/Compliance/Support/Read-only must be defined as **permission bundles**. | [EXTEND] — SP-5 |
| Shared UI | `components/ui/vuexy.tsx` + `app/admin/fx/_ui.tsx` (`Badge`/status chips, `money()`/`moneyFull()` cells, `FxTabs`). | [HAVE] |

---

## Decomposition (sub-projects)

Each is its own spec→plan→implement cycle. Dependencies in brackets.

| SP | Name | Scope | Depends on | Phase | Status |
|---|---|---|---|---|---|
| **SP-0** | Commercial & compliance gates | Verto Atlas-for-Platform agreement, FX markup enabled by AM, rate card (V4), markup settlement terms (V2), individual onboarding path (V1), sweep policy (V5/V18), webhook signing (V6), production hosts (V9), counsel sign-off (V27). **External — not code.** | — | P0 | Open (tracked below) |
| **SP-1** | VertoFX adapter + default-provider mechanism + flag | New Verto client + orchestration adapter; config + `FEATURE_VERTOFX`; preferred-with-fallback routing; treasury buckets; webhook vocabulary. Dark behind flag. | SP-0 (sandbox creds only) | P1 | **Plan written** |
| **SP-2** | Verto sub-accounts + KYB onboarding + wallet provisioning | Backend crossborder onboarding domain; KYB submission port; sub-account state machine; wallet + funding-details provisioning; reuse Spotlight KYC T2 pre-gate; sole-prop + business variants. | SP-1, V1 | P1 | Spec→plan next |
| **SP-3** | Platform Fee + commission wiring + ledger accounts + recon/treasury | New `AccountType` constants + CHECK-widening migration; `FeeCollector` (ledger-charge + sweep); quote line-items; wire orchestration FX → `commission.RecordExact`; receivable/fees_unswept accounting; 3-way recon; NGN master treasury. | SP-1, SP-2 | P1 | Spec→plan next |
| **SP-4** | User flows (mobile): activation, receive, convert, send, receipts | Global-account activation; flip `EXPO_PUBLIC_FX_USE_MOCK` off against real endpoints; Platform-fee breakdown; Verto status mapping (§23.3); Global entry point. | SP-1, SP-2, SP-3 | P1 | Spec→plan next |
| **SP-5** | Admin "Global Control Tower" | Make mock FX pages real (backend routes); Platform-Fee/rate-card console extending `/markup`; KYC queue; txn explorer; recon/treasury/profit; RBAC permission bundles. | SP-3 | P1–P2 | Spec→plan next |
| **SP-6** | Priority extras (D8) | X1 Invoice-to-cash, X5 Family allowance (scheduled), X6 Auto-convert on inbound, X8 Target-rate orders; rate alerts; Smart Flow Router. | SP-2, SP-3, SP-4 | P2 | Spec→plan later |
| **SP-7** | Breadth & scale | African corridors (manual wallets), mobile money, bulk payouts/approvals, fund-later/held-rate, ambassador share, multi-provider smart failover. | SP-1–SP-5 | P2–P3 | Spec→plan later |

### Sequencing & parallelism (for ~10 workstreams)
- **Critical path:** SP-1 → SP-2 → SP-3 → SP-4. Start here.
- **Can start in parallel once SP-1 lands:** SP-2 (onboarding), SP-3 ledger/commission groundwork (account constants + migration + `FeeCollector` interface), SP-5 admin shell/RBAC bundles, SP-4 mobile component/activation scaffolding against mocked endpoints.
- **One writer per file set:** SP-3 and SP-1 both touch `orchestration` — SP-3's ledger/commission wiring must land after SP-1's adapter to avoid overlap; coordinate on `service.go`/`finance_routes.go`.
- **Money-path gate (CLAUDE.md):** every SP that moves money is tests-first (delegate to `test-engineer`), `ledger-auditor` review before "done", `security-reviewer` before any auth/PII PR, feature-flagged, PRs < 400 lines, ADR per non-obvious choice named `ADR-PR<pr#>-<slug>`.

---

## Verification register — gate status (spec §24, updated with decisions)

| # | Item | Gate? | Status after decisions |
|---|---|---|---|
| V1 | Individual onboarding path under Platform | **Gate** | OPEN — D3 says both user types; need Verto's written individual/sole-prop schema. SP-2 designed with sole-prop variant; blocks SP-2 go-live, not build. |
| V2 | Markup revenue settlement terms | **Gate** | OPEN — commercial. Shapes SP-3 accrued→settled lifecycle. |
| V3 | Markup sign convention & caps | **Gate** | OPEN — resolve in sandbox; lock in a golden test (SP-1/SP-3). |
| V4 | Paymax rate card | **Gate** | OPEN — fee/spread numbers are placeholders in admin until this lands (D4/D5). |
| V5 / V18 | Sweep to parent + partner fee deduction | **Gate** | OPEN — fallback designed (NGN-wallet/spread) per D6. |
| V6 | Webhook signature scheme | High | OPEN — until known: IP allowlist + GET-confirm every event before applying state (SP-1). |
| V7 | Event names (3 vocabularies) | High | OPEN — `EventParser` maps all known names, logs unknown (SP-1). |
| V8 | Sub-account scoping (companyId vs header) | High | OPEN — verify per service in sandbox (SP-1/SP-2). |
| V9 | Production hosts + cert auth | High | OPEN — go-live. |
| V19 | Markup on Inline FX / Flow 1 / Fund Later | **Gate** | OPEN — affects spread revenue on non-instant flows. |
| V27 | Contracting entity | **Gate** | RESOLVED — Paymax (D1). |
| others | V10–V17, V20–V26 | Med/Low | Tracked; mostly SP-2/SP-3/SP-6 inputs. |

**Build rule:** SP-1 proceeds against sandbox now (D2). SP-2/SP-3 go-live each depend on their listed gates being resolved or consciously accepted.

---

## Next artifacts
1. **SP-1 detailed plan** — written: [`2026-10-16-sp1-vertofx-provider-default.md`](2026-10-16-sp1-vertofx-provider-default.md).
2. SP-2…SP-7 — each needs its own brainstorm→spec→plan cycle before implementation. Recommend doing SP-2 and SP-3 specs next (they share the ledger/commission surface).
