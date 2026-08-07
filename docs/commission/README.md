# Commission & Profit Management

The central system that governs what Spotlight/Paymax earns on every service. It replaces
the fragmented, per-module fee logic (utility markup, marketplace `commission_bps`, invest
`invest_fee_config`, doctor/stays/transport/insurance/creators fees…) with one admin-managed
source of truth, one calculator, one append-only profit ledger, and one profit dashboard.

## Revenue mechanics (from the business commission workbook)

| Lever | Column in sheet | Who bears it | Stored as |
|---|---|---|---|
| Provider commission | `%` | 3rd-party provider (discount to Spotlight) | `commission_bps` |
| Platform charge / take-rate | `Platform_Charge` | merchant or customer | `platform_charge_bps` |
| Convenience fee | `ConvenienceFee` | customer (on top) | `convenience_fee_kobo` |
| Fixed fee | `Fixed` | customer / margin | `fixed_fee_kobo` |

`fee_model` classifies each row: `commission`, `platform_charge`, `fixed`,
`commission_plus_fee`, or `none`. `fee_payer` records who bears it
(`customer` / `provider` / `merchant` / `none`) and the calculator honours it when deciding
whether a platform charge is added to the customer total or deducted from a merchant payout.

All money is **integer kobo**; all rates are **basis points** (bps = %×100). Never floats.

## Data model (migration `20260926000000`)

- **`commission_config`** — the rate registry. One row per
  `(service_category, service, service_subtype)`; `service_subtype=''` is the service-level
  default. Mutable via admin; every change is audited. Seeded with 57 rows from the workbook.
- **`commission_config_audit`** — before/after JSON of every rate change + who changed it.
- **`commission_earnings`** — **append-only** ledger of realized profit per transaction
  (immutable trigger; corrections = new reversing rows). Feeds the profit dashboard.

## Backend (`backend/internal/finance/commission/`)

- `Calculate(category, service, subtype, grossKobo)` → breakdown
  (`commission_kobo`, `platform_charge_kobo`, `convenience_fee_kobo`, `fixed_fee_kobo`,
  `spotlight_revenue_kobo`, `customer_total_kobo`). Resolution: exact subtype → service-level
  (`subtype=''`) → not found. Integer floor division.
- `RecordEarning(input, idempotencyKey)` — idempotent insert into `commission_earnings`; when a
  ledger service is wired and revenue > 0, posts a balanced double-entry
  (DR `provider_clearing` → CR `commission`) and stores the `ledger_ref`.
- Config CRUD (RBAC `finance.commission.manage`, audited), reporting
  (RBAC `finance.commission.read`).

### Two recording paths: `RecordFor` (%-take) vs `RecordExact` (exact fee)

The `Recorder` seam (`commission/recorder.go`) exposes two ways to record realized profit,
and picking the right one is what keeps the profit dashboard honest:

- **`RecordFor(category, service, subtype, grossKobo, …)`** — the **%-take** path. Recorded
  profit is DERIVED server-side from the active rate card (`config% × gross` + fixed/convenience
  levers via `computeBreakdown`). Use this whenever the platform's real earning genuinely IS a
  percentage of the transaction gross. Modules: restaurant, stays, transport, marketplace boost,
  crowdfunding, creators, events, health (lab / vet / pharmacy / doctor), utility, voting.
- **`RecordExact(category, service, subtype, grossKobo, recordedRevenueKobo, …)`** — the
  **exact-fee** path. Recorded profit is the caller's ACTUAL realized fee
  (`recordedRevenueKobo`), written verbatim to `spotlight_revenue_kobo` and attributed to
  `platform_charge_kobo`; the amount NEVER depends on the config %. `grossKobo` is still passed
  (the principal / throughput) for dashboard context, and `config_id` is still resolved for
  reporting joins, but a missing config is not an error. Use this for modules whose real fee is a
  FIXED-kobo tier or a provider spread, where `config% × gross` would grossly mis-state profit.
  Modules: **Money Transfer, FX / Currency Exchange, Jobs, Association, Savings early-withdrawal
  penalty**. Both paths are idempotent on `idempotency_key` and share the same immutable-insert
  plumbing (`RecordEarning`'s repo insert); the shared `commissionRecorderAdapter` implements
  BOTH methods, and each of those five modules' local `CommissionRecorder` interface declares both.

### HTTP endpoints (under `/api/finance`)
```
GET  /commission/config                 list configs (+ grouped by category)
POST /commission/config                 create
PUT  /commission/config/:id             update rates
POST /commission/config/:id/toggle      activate / deactivate
POST /commission/calculate              {serviceCategory,service,serviceSubtype,amountKobo} → breakdown
GET  /commission/report?from&to&groupBy=category|service|day
GET  /commission/earnings?from&to&category&limit
```
Gated by `FEATURE_COMMISSION_ENABLED` (default off).

## Admin console

- `/admin/commission` — rate card grouped by category: adjust any lever (entered as % and ₦,
  converted to bps/kobo on save), toggle active, and **add new services/subtypes** as the
  platform scales.
- `/admin/commission/profit` — date-range profit dashboard: revenue KPIs, category/service
  breakdown, day time series, recent earnings.

## Onboarding a new service (the pattern to scale)

1. **Add the rate** in `/admin/commission` (or a seed migration): create a
   `commission_config` row for the `(category, service, subtype)` with the right levers.
2. **Record earnings at settlement.** After a transaction is *successfully settled* (never on
   failure/reversal), record one earning, keyed idempotently by the transaction id.

   **Go modules** — inject the reusable recorder seam (nil-safe; no-op when commission is
   disabled), then call it best-effort so a recorder failure never breaks settlement:
   ```go
   // wiring (composition root), gated on cfg.FeatureCommissionEnabled:
   svc.SetCommissionRecorder(commissionRecorderAdapter{commission.NewService(commission.NewRepository(pool), nil)})

   // at the settlement point:
   s.recordCommissionSafe(ctx, "<Category>", "<Service>", "<subtype-or-empty>",
       grossKobo, txnID /* source_ref & idempotency key */, &userRef)
   ```
   See `backend/internal/marketplace/service_boost.go` + `marketplace_routes.go` for a live
   example (the recorder interface lives in `commission/recorder.go`).

   **frontend-web (TS) modules** — read the rate via
   `frontend-web/src/server/commission/config.ts` and insert a `commission_earnings` row with
   `idempotency_key = <txn id>` inside a try/catch. See the utility integration in
   `frontend-web/src/server/utility/service.ts` (`recordUtilityCommissionEarning`).
3. **Verify** it appears on `/admin/commission/profit`.

### Reference integrations wired so far
- **Utility bills** (`frontend-web/src/server/utility/service.ts`) — reads convenience/commission
  from config, records earnings on every successful bill payment.
- **Marketplace boost** (`backend/internal/marketplace/service_boost.go`) — records the ad sale
  under the `Lifestyle / Marketplace / boost` config (100% platform charge, migration
  `20260927000000`).
- **Transport / mobility** (`backend/internal/transport/{service,parcel,bus,car_hire}.go`) —
  records realized profit at each mode's settlement point: ride-hailing → `Lifestyle / Taxi -
  Ride Hailing`, parcel delivery → `Lifestyle / Delivery - Rider`, bus booking → `Lifestyle /
  Bus Booking`, car hire → `Lifestyle / Car Hire`. Earning-row only (transport's own settlement
  split already posts the platform cut to the ledger); idempotency key = trip/booking id. Wired
  in `backend/internal/app/finance_routes.go` behind `FEATURE_COMMISSION_ENABLED`. NOTE: the
  central config's 10% is the RECORDED profit; transport's own split still charges its per-tier
  platform % (standard 20% / low 12% / fleet 15%) — the split is untouched by this integration.
- **Restaurant / food delivery** (`backend/internal/restaurant/service.go`) — records realized
  profit at the DELIVERED order's settlement point (`settleOrder`, right after the escrow
  `settlement.Settle` posts the platform cut to the ledger; shared by the live
  `UpdateStatus(delivered)` path AND the crash-recovery reconciler) under `Lifestyle /
  Restaurant`. gross = the full order value the customer paid (`orders.total_kobo` = food
  subtotal + delivery fee) — the SAME basis restaurant's own split is computed on. Earning-row
  only (restaurant's own settle already posts the platform cut to the ledger); idempotency key =
  order id. Wired in `backend/internal/app/finance_routes.go` (restaurant block) behind
  `FEATURE_COMMISSION_ENABLED`, reusing the shared `commissionRecorderAdapter`. RATE ALIGNMENT:
  restaurant's own escrow split charges a 10% platform cut of the escrowed total (80% restaurant
  / 10% rider / 10% platform; 90/10 when no rider) — which matches the central `Lifestyle /
  Restaurant` config's 10% RECORDED profit. The restaurant split is UNTOUCHED by this
  integration; only the earning row is added.
- **Stays / hotels & shortlets** (`backend/internal/stays/reservation/service.go`) — records
  realized profit at the CONFIRMED booking's charge/settle point (right after `settleConfirmed`
  in `Book`, once the escrow split has posted the platform cut to the ledger) under `Property /
  Hotel`. gross = the full booking value the guest is charged (`res.GrossAmountKobo`) — the same
  basis stays' own commission split is computed on. Earning-row only (stays' own settle already
  posts the commission to the ledger); idempotency key = reservation id. Wired in
  `backend/internal/app/stays_routes.go` (`RegisterStays`) behind `FEATURE_COMMISSION_ENABLED`,
  reusing the shared `commissionRecorderAdapter`. RATE DIVERGENCE: stays' own split charges its
  configured rail rate — Rail-B `directCommissionBps` = 1500 (15% of net rate) or Rail-A markup
  (12% default) — while the central `Property / Hotel` config RECORDS 10% of gross as profit.
  The stays split is UNTOUCHED by this integration; only the earning row is added. Hotel vs
  shortlet are both recorded under `Hotel` (no `shortlet` subtype config row exists yet — a
  follow-up migration could add one for finer granularity; until then subtype is left '' so it
  resolves the service-level Property/Hotel config).
- **Doctor / telemedicine** (`backend/internal/doctor/service_clinical_tail.go` — `EndAppointment`)
  — records realized profit at the CONSULT settlement point: when a consultation transitions to
  `completed`, one earning is recorded under `Health / Doctor`. gross = the appointment's
  `FeeKobo` (the consult fee, the same basis the doctor's own per-consult commission is withheld
  on). Earning-row only (the recorder is constructed with a nil ledger — no double-post; the
  doctor module already withholds its own commission into `doctor_invoices`); idempotency key =
  appointment id. Wired in `backend/internal/app/finance_routes.go` behind
  `FEATURE_COMMISSION_ENABLED`, reusing the shared `commissionRecorderAdapter`. The seam
  (`CommissionRecorder` + `SetCommissionRecorder` + `recordCommissionSafe`) lives in
  `backend/internal/doctor/service.go`, mirroring transport/stays. RATE DIVERGENCE: the doctor's
  own split uses the per-doctor `doctor_commission_config.commission_bps` (with a SEPARATE
  `vat_bps` for VAT) — this rate is per-doctor and configurable, NOT a fixed platform 10% — while
  the central `Health / Doctor` config RECORDS 10% of gross as profit. The doctor split is
  UNTOUCHED by this integration; only the earning row is added. VAT is tracked separately by the
  doctor module (`vat_bps` / `doctor_invoices.vat_kobo`) and is NOT part of the central earning
  recording (gross = the consult fee before the doctor's own commission/VAT breakdown).
- **Health / Lab** (`backend/internal/health/lab/service.go` — `Release`) — records realized profit
  at the LAB-ORDER settlement point: when a scientist signs off and RELEASES the result, the held
  patient payment is released to the lab (escrow `Release`) and one earning is recorded under
  `Health / Lab`. gross = the full order total the patient paid (`o.TotalKobo` = sum of the priced
  test lines, the same basis the escrow settles on); source ref + idempotency key = the order id;
  user = the patient (`o.PatientID`). Earning-row only (the recorder is constructed with a nil
  ledger — no double-post). The seam (`CommissionRecorder` + `SetCommissionRecorder` +
  `recordCommissionSafe`) lives in `backend/internal/health/lab/service.go`, mirroring
  transport/doctor. Wired in `backend/internal/app/health_lab_routes.go` (`RegisterHealthLab`, `cfg`
  threaded from `finance_routes.go`) behind `FEATURE_COMMISSION_ENABLED`, reusing the shared
  `commissionRecorderAdapter`. RATE DIVERGENCE: the central `Health / Lab` config RECORDS 10% of
  gross (`platform_charge_bps=1000`, fee_payer=merchant, migration `20260926000000`). NOTE ON THE
  ACTUAL SPLIT: the lab's own escrow `Release` credits the FULL `total_kobo` to the lab payee — there
  is NO in-module platform cut on lab orders (0% in-module) — while the central registry RECORDS 10%
  of gross as the attributed commission. The lab money path is UNTOUCHED by this integration; only
  the earning row is added. NOTE ON DELIVERY: the phlebotomist/results-courier legs route through the
  transport module as separate parcel jobs — those are NOT recorded here; only the lab test's own
  order settlement is.
- **Health / Veterinary** (`backend/internal/health/vet/service.go` — `CompleteConsult`) — records
  realized profit at the VET-APPOINTMENT settlement point: when the verified vet completes the
  consult, the appointment moves → COMPLETED and the held owner payment is RELEASED to the vet
  (escrow `Release`, KYC-gated HL-10), and one earning is recorded under `Health / Veterinary`.
  gross = the full appointment total the owner paid (`a.TotalKobo` = the pinned service price, the
  same basis the escrow settles on); source ref + idempotency key = the appointment id; user = the
  pet owner (`a.OwnerID`). Recorded inside the `HELD → RELEASED` guard so it fires exactly once per
  appointment. Earning-row only (nil-ledger recorder — no double-post). The seam lives in
  `backend/internal/health/vet/service.go`. Wired in `backend/internal/app/health_vet_routes.go`
  (`RegisterHealthVet`, `cfg` threaded from `finance_routes.go`) behind `FEATURE_COMMISSION_ENABLED`,
  reusing the shared `commissionRecorderAdapter`. RATE DIVERGENCE: the central `Health / Veterinary`
  config RECORDS 10% of gross (`platform_charge_bps=1000`, fee_payer=merchant, migration
  `20260926000000`). NOTE ON THE ACTUAL SPLIT: the vet's own escrow `Release` credits the FULL
  `total_kobo` to the vet payee — there is NO in-module platform cut on vet appointments (0%
  in-module) — while the central registry RECORDS 10% of gross. The vet money path is UNTOUCHED by
  this integration; only the earning row is added. (The optional home-visit dispatch is a separate
  transport parcel job and is NOT recorded here.)
- **Health / Pharmacy** (`backend/internal/health/pharmacy/service.go` — `Complete`) — records
  realized profit at the PHARMACY-ORDER settlement point: when an order transitions IN_DELIVERY →
  DELIVERED or READY_FOR_PICKUP → COLLECTED and the held patient payment is RELEASED to the pharmacy
  (escrow `Release`, KYC-gated HL-10), one earning is recorded under `Health / Pharmacy`. gross = the
  full order total the patient paid (`o.TotalKobo` = sum of the priced order lines, the same basis
  the escrow settles on); source ref + idempotency key = the order id; user = the patient
  (`o.PatientID`). Recorded once at `Complete`; the subsequent CLOSED-retry re-invokes `Complete`
  idempotently (order id key ⇒ no double-count). Earning-row only (nil-ledger recorder — no
  double-post). The seam lives in `backend/internal/health/pharmacy/service.go`. Wired in
  `backend/internal/app/health_pharmacy_routes.go` (`RegisterHealthPharmacy`, `cfg` threaded from
  `finance_routes.go`) behind `FEATURE_COMMISSION_ENABLED`, reusing the shared
  `commissionRecorderAdapter`. RATE DIVERGENCE: the central `Health / Pharmacy` config RECORDS 10% of
  gross (`platform_charge_bps=1000`, fee_payer=merchant, migration `20260926000000`). NOTE ON THE
  ACTUAL SPLIT: the pharmacy's own escrow `Release` credits the FULL `total_kobo` to the pharmacy
  payee — there is NO in-module platform cut on pharmacy orders (0% in-module) — while the central
  registry RECORDS 10% of gross. IMPORTANT SCOPE: this records the VERTICAL's own order settlement
  (the medication sale), NOT the separate transport delivery leg (a distinct parcel job that is not
  recorded here). The pharmacy money path is UNTOUCHED by this integration; only the earning row is
  added.
- **Creators / talent monetization** (`backend/internal/creators/service.go`) — records realized
  profit at the single monetization realization point (`recordEarning`, called exactly once per
  tip, paid-content sale, subscription first-charge, and recurring subscription charge — right
  after `creditCreator` posts the money + platform fee through the finance ledger; NOT on payout
  withdrawal of already-earned balance) under `Lifestyle / Creators`. gross = the amount the
  platform fee is computed on (the SAME basis `applyFee` uses: tip amount / content price / tier
  price). Earning-row only (the recorder is constructed with a nil ledger — no double-post;
  `creditCreator` already moves the platform fee to `AccountPaymaxRevenue`); idempotency key = the
  per-event reference (`tip:<id>` / `content:<id>` / `sub:<idemKey>`). Wired in
  `backend/internal/app/top5_p3_routes.go` (`RegisterCreators`, `cfg` threaded from
  `finance_routes.go`) behind `FEATURE_COMMISSION_ENABLED`, reusing the shared
  `commissionRecorderAdapter`. The seam (`CommissionRecorder` + `SetCommissionRecorder` +
  `recordCommissionSafe`) lives in `backend/internal/creators/service.go`, mirroring
  transport/stays/doctor. RATE ALIGNMENT: creators' own fee is a fixed `platformFeeBps = 1000`
  (10% of gross, taken on every tip/sale/subscription) — which EXACTLY matches the central
  `Lifestyle / Creators` config's 10% RECORDED profit. The creators fee/split is UNTOUCHED by this
  integration; only the earning row is added.
- **Crowdfunding** (`backend/internal/crowdfunding/service.go` — `Release`) — records realized
  profit at the campaign RELEASE/disbursement point: when a funded campaign's escrowed
  contributions are settled, one earning is recorded PER settled contribution under `Community /
  Crowdfunding`. This is the realization point (chosen over the raw CONTRIBUTION escrow and over
  the admin `ApproveWithdrawal` payout, neither of which takes a fee: `Contribute` only escrows
  the full amount, and `ApproveWithdrawal` moves the full `amount_kobo` escrow→clearing with no
  cut). At `Release` the 90/10 `settlement.Split` (`ProviderPct 0.90` creator / `PlatformPct 0.10`
  platform) posts the 10% platform cut to the ledger. gross = each contribution's `amount_kobo`
  (the basis the 10% fee applies to); userRef = the contributor. Earning-row only (the recorder is
  constructed with a nil ledger — no double-post; the release split already posts the platform cut
  to the ledger); idempotency key = contribution id. Wired in
  `backend/internal/app/finance_routes.go` (crowdfunding block) behind `FEATURE_COMMISSION_ENABLED`,
  reusing the shared `commissionRecorderAdapter`. The seam (`CommissionRecorder` +
  `SetCommissionRecorder` + `recordCommissionSafe`) lives in
  `backend/internal/crowdfunding/service.go`, mirroring transport/restaurant/stays/doctor. RATE
  ALIGNMENT: crowdfunding's own release split charges 10% platform (90% creator / 10% platform) —
  which MATCHES the central `Community / Crowdfunding` config's 10% (`platform_charge_bps=1000`,
  migration `20260926000000`) RECORDED profit. The release split is UNTOUCHED by this integration;
  only the earning row is added. NOTE: the crowdfunding admin fee schedule (`cf_fee_config`,
  `platform_fee_bps` default 2.5%) and the creator dashboard's indicative `platformFeeBps=250`
  (2.5%) are DISPLAY/config surfaces that do NOT move money on the release money-path — the
  money-moving split is the 10% one in `Release`, which is what is recorded.

- **Paid voting / contests** (`backend/internal/connect/voting/service.go` — `PaidVote`) —
  records realized profit at the paid-vote settlement point (right after the wallet debit
  posts the balanced double-entry into `paymax_revenue` and the immutable vote row is
  persisted, past the audit + AML hooks) under `Contest / Voting`. gross = the full amount the
  voter paid (`price_per_unit × quantity` = `totalKobo`); source ref + idempotency key = the
  vote id (`v.ID`); user = the voter. Earning-row only (the recorder is constructed with a nil
  ledger — no double-post; voting's own debit already books the revenue). The seam
  (`CommissionRecorder` + `SetCommissionRecorder` + `recordCommissionSafe`) lives in
  `backend/internal/connect/voting/service.go`, mirroring transport/events. Wired in
  `backend/internal/app/connect_money_routes.go` (`RegisterConnectMoney`, `cfg` threaded from
  `connect_routes.go`) behind `FEATURE_COMMISSION_ENABLED`, reusing the shared
  `commissionRecorderAdapter`. RATE ALIGNMENT: the central `Contest / Voting` config RECORDS
  10% of gross (`platform_charge_bps=1000`, fee_payer=merchant). NOTE ON THE ACTUAL SPLIT:
  voting's own money path books the ENTIRE paid-vote amount into `paymax_revenue` (there is no
  per-vote split — the whole `totalKobo` is platform revenue), so the module's realized take on
  the ledger is effectively 100% of gross, while the central profit registry RECORDS 10% of
  gross as the attributed commission. The voting debit is UNTOUCHED by this integration; only
  the earning row is added.
- **Event ticketing** (`backend/internal/top5events/service.go` — `finalizePurchase`) — records
  realized profit at the ticket-purchase settlement point (money durably in escrow, order
  flipped `PAID`, ticket issued) under `Lifestyle / Event Tickets`. Shared by the live
  `Purchase` path AND the crash-recovery `ReconcilePendingOrders` re-drive; also covers the
  already-ticketed resume branch. gross = the full amount the buyer paid (order `total_kobo`,
  net of any applied promo = `o.payable`); source ref + idempotency key = the order id
  (`o.id`); user = the buyer. Earning-row only (the recorder is constructed with a nil ledger —
  no double-post; the ticket debit already posts the money into escrow). The seam
  (`CommissionRecorder` + `SetCommissionRecorder` + `recordCommissionSafe`) lives in
  `backend/internal/top5events/service.go`. Wired in `backend/internal/app/top5_p2_routes.go`
  (`RegisterEvents`, `cfg` threaded from `finance_routes.go`) behind `FEATURE_COMMISSION_ENABLED`,
  reusing the shared `commissionRecorderAdapter`. RATE ALIGNMENT: the central `Lifestyle / Event
  Tickets` config RECORDS 10% of gross (`platform_charge_bps=1000`, fee_payer=merchant). NOTE ON
  THE ACTUAL SPLIT: the ticket checkout itself takes NO platform cut in-module (the full payable
  is escrowed pending organiser payout); the events module's own `fee_bps` platform fee is
  charged only on the SEPARATE cashless-wallet vendor-float settlement (`SettleVendor`), NOT on
  ticket sales — so ticket sales carry a 0% in-module cut while the central registry RECORDS 10%
  of ticket gross. The ticket money path is UNTOUCHED by this integration; only the earning row
  is added. (Vendor-float settlement is a distinct money path and is NOT recorded here.)

- **Association / Group Membership** (`backend/internal/association/service.go` — `PayInvoice`)
  — records realized profit at the dues-settlement point (right after the payment tx commits:
  the balanced ledger debit posted, the `assoc_revenue_splits` rows written, the invoice marked
  PAID) under `Community / Group Membership`, via **`RecordExact`**. Recorded profit = the module's
  ACTUAL platform cut: the `RevenueSplit` **"Platform fee" line = 5% of the dues amount** (National
  50 / State 30 / Local 15 / Platform 5 — see `association/model.go` `RevenueSplit`, extracted by
  `platformShareKobo`). gross = the full dues amount the member paid
  (`assoc_dues_invoices.amount_kobo`) is passed for throughput context only; source ref +
  idempotency key = the invoice id; user = the payer. Earning-row only (the recorder is constructed
  with a nil ledger — no double-post; the dues debit already routes the money via `settlement`, and
  the `RevenueSplit` rows record the internal allocation). The seam (`CommissionRecorder` +
  `SetCommissionRecorder` + `recordCommissionSafe`) lives in
  `backend/internal/association/service.go`, mirroring transport. Wired in
  `backend/internal/app/finance_routes.go` (association block) behind `FEATURE_COMMISSION_ENABLED`,
  reusing the shared `commissionRecorderAdapter`. The 5% platform line is UNTOUCHED by this
  integration; only the earning row is added. The dashboard now reflects the REAL 5% take — no
  config reconcile needed (the `RecordExact` amount is independent of the config %).
- **Connect / Jobs (paid postings)** (`backend/internal/connect/networking/jobs/service.go` —
  `ActivateJob`) — records realized profit at the paid job-posting settlement point (right after
  the fee wallet debit `DR poster wallet → CR paymax_revenue` succeeds and the job is advanced to
  ACTIVE + audited) under `Community / Job`, via **`RecordExact`**. Recorded profit = the module's
  ACTUAL take = **100% of `job.FeeKobo`** (the whole posting fee is booked into `paymax_revenue` —
  there is no counterparty payout). gross = `job.FeeKobo` is also passed for context; source ref +
  idempotency key = the job id; user = the poster (`actorID`). Earning-row only (the recorder is
  constructed with a nil ledger — no double-post; the fee debit already books the full fee into
  `paymax_revenue`). FREE POSTS ARE SKIPPED: when `FeeKobo==0` `ActivateJob` moves NO money, and
  `recordCommissionSafe`'s `earnedKobo<=0` guard records nothing — no fabricated profit. The seam
  (`CommissionRecorder` + `SetCommissionRecorder` + `recordCommissionSafe`) lives in
  `jobs/service.go`, mirroring transport; it is threaded through `jobs.Register` (new trailing
  `commission CommissionRecorder` param) and wired in
  `backend/internal/app/connect_network_routes.go` behind `FEATURE_COMMISSION_ENABLED`, reusing the
  shared `commissionRecorderAdapter`. The fee debit is UNTOUCHED; only the earning row is added. The
  dashboard now reflects the REAL 100%-of-fee take — no config reconcile needed.

### Modules studied but SKIPPED (no realized Spotlight fee — nothing recorded)
- **Estate dues / rent** (`backend/internal/estate/service_dues.go` — `PayDues`) — SKIP. The dues
  money path is a full **pass-through**: `DR payer wallet → CR settlement (standing account)` for
  the WHOLE invoice amount; the estate operator settles out-of-band and receives the full sum.
  There is no platform fee retained (no split, no cut), so `Property / Estate` (10% config row) has
  NO realized profit to record. The same applies to estate **rent** (billed via the same
  `estate_dues_invoices` / `PayDues` path with `category='rent'`) and to the estate **vendor
  payout** (`CompleteVendorJob`/payout: `Credit` pays the vendor the full `amount_kobo` from the
  settlement account — an expense, not a fee). Recording here would fabricate profit that Spotlight
  never earns. If estate dues are ever repriced to carry a platform convenience/service fee, add the
  seam at the `PayDues` commit point (mirroring association) and record gross = the invoice amount.
- **Property Suite** (`backend/internal/property/`, `Property / Property` 10% config row) — SKIP.
  The suite "Owns NO money path" (per `finance_routes.go`): it is read-mostly cross-module glue
  (role/context switch, portable rent passport, landlord/agency screening lookup). No fee, no
  charge, no settlement — nothing to record. (Property/rent collection actually happens inside the
  estate dues path above, which is itself a pass-through.)

- **Money transfer** (`backend/internal/finance/transfers/service.go`) — records realized profit
  at the two transfer settlement points under `Finance / Money Transfer`: wallet-to-wallet at the
  `tx.Commit` in `InitiateWalletToWallet` (status `'successful'`, fee already credited to
  `AccountPaymaxRevenue`), and wallet-to-bank / bank-to-bank in `settleTransfer` on the
  `BankTransferSuccessful` branch (after the fee is recognized into `paymax_revenue`, NOT on
  failed/reversed settlements which refund the fee). Recording is GATED on a real fee being
  charged (`fee > 0` / `bt.FeeKobo > 0`): small wallet transfers ≤ ₦5,000 are FREE (`fee == 0`) so
  they earn nothing and record nothing. Recording uses **`RecordExact`**: recorded profit = the
  ACTUAL fee charged (`wt.FeeKobo` / `bt.FeeKobo`), a small FIXED-kobo tier — wallet: ₦0 / ₦10 / ₦25;
  bank: ₦10 / ₦25 / ₦50 (`WalletTransferFee` / `BankTransferFee` in `model.go`). gross = the transfer
  PRINCIPAL (`AmountKobo`) is passed for throughput context only; source ref + idempotency key = the
  transfer id (`wt.ID` / `bt.ID`); user = sender / initiator. Earning-row only (recorder built with a
  nil ledger — the transfer's own fee credit already posts to `paymax_revenue`). The seam
  (`CommissionRecorder` + `SetCommissionRecorder` + `recordCommissionSafe`) lives in
  `transfers/service.go`; wired in `backend/internal/app/finance_routes.go` (right after
  `transfers.NewService`) behind `FEATURE_COMMISSION_ENABLED`, reusing the shared
  `commissionRecorderAdapter`. The dashboard now records the EXACT fixed fee (e.g. a ₦50,000 bank
  transfer records the ₦50 fee, not a fabricated ₦5,000); the config % is no longer used for the
  amount. The transfer's own fee/money-path is UNTOUCHED — only the earning row is added.
- **Currency exchange / FX** (`backend/internal/finance/fx/service.go` — `Convert`) — records realized
  profit at the single successful-conversion point (right after `tx.Commit` persists the
  `fx_conversions` row + mirrors the currency wallet; NOT on the idempotent replay short-circuits
  which return earlier) under `Finance / Currency Exchange`, via **`RecordExact`**. Recorded profit
  = the conversion's realized **`conv.FeeKobo`** (the provider spread / fee), GATED on `FeeKobo > 0`.
  gross = the source/principal amount (`conv.SourceAmountKobo`) is passed for throughput context
  only; source ref + idempotency key = the conversion id (`conv.ID`); user = `conv.UserID`.
  Earning-row only (recorder built with a nil ledger — the conversion's own legs already move money).
  The seam lives in `fx/service.go`; wired in `finance_routes.go` (inside the `maplerадClient != nil`
  block, right after `fx.NewService`) behind `FEATURE_COMMISSION_ENABLED`, reusing the shared
  `commissionRecorderAdapter`. The dashboard now records the EXACT `FeeKobo` spread rather than an
  attributed 10% of the source principal; the config % is no longer used for the amount. NOTE: this
  is the `Finance / Currency Exchange` config row — DISTINCT from
  the seeded `Finance / FX Exchange` row whose `fee_model='none'` (no fee, SKIPPED). The separate FX
  orchestration module (`backend/internal/orchestration`, `/api/v1/fx`) has its own spread engine and
  is NOT covered by this integration.
- **Savings** (`backend/internal/savings/member_reads.go` — `VaultService.EarlyWithdraw`) — records
  realized profit ONLY at the early-withdrawal PENALTY point (the sole Spotlight-earned fee in the
  savings module) under `Finance / Savings`, GATED on `penalty > 0` (right after the penalty is
  debited from the member's wallet into `AccountPaymaxRevenue`), via **`RecordExact`**. Recorded
  profit = the EXACT `penalty` amount already computed and debited (`penaltyBps × amountKobo`), the
  module's true realized fee. All other savings money moves are FEE-FREE and record NOTHING: vault
  deposits/normal withdrawals, group-target contributions/releases, and ALL Ajo/Esusu contributions
  & payouts (NL-2 forbids yield; matured/FLEX withdrawals have `penalty == 0`). gross = the
  withdrawal PRINCIPAL (`amountKobo`) is passed for throughput context only; source ref + idempotency
  key = `idemKey+":penalty"` (matches the penalty ledger leg key); user = `ownerID`. Earning-row only
  (recorder built with a nil ledger — the penalty debit already posts to `paymax_revenue`). The seam
  lives on `VaultService` in `savings/vault_service.go` (`AjoService` / `TargetService` have no fee
  and get NO recorder); wired in `backend/internal/app/top5_p1_routes.go` (`RegisterSavings`, `cfg`
  threaded from `finance_routes.go`) behind `FEATURE_COMMISSION_ENABLED`, reusing the shared
  `commissionRecorderAdapter`. The dashboard now records the EXACT penalty rather than a flat 10% of
  the principal; the config % is no longer used for the amount. The penalty money-path is UNTOUCHED;
  only the earning row is added.
- **Social pay — SKIPPED (no fee).** `backend/internal/social/` is pure, free P2P/social money
  movement (send, pay-request, split-bill share, group-pool contribute/payout). Every leg is a 1:1
  wallet→wallet transfer routed through the neutral `AccountEscrow` standing account with
  `Debit(amount) == Credit(amount)` and ZERO platform cut, spread, or commission (stated in-code:
  "commission account is NOT used — this is a pure peer transfer"; "net zero, no float retained, no
  yield — NL-2"). No `CommissionRecorder` is wired: recording anything here would book profit that is
  never earned. The seeded `Finance / Social Pay` (10%) config row exists but has NO realization point
  in the current money path — it stays dormant until a social-pay fee is actually introduced.
- **Referral rewards — SKIPPED (payout, not revenue).** `Finance / Referral rewards` is a reward
  PAYOUT to users, not a Spotlight revenue point, so no earning is recorded.

## Iron rules

- Additive-only migrations; `commission_earnings` is append-only (reversing rows, never UPDATE).
- Integer kobo/bps, floor division, never floats.
- Earnings recording is **idempotent** (unique `idempotency_key`) and **best-effort** — it must
  never fail or reverse the customer's transaction.
- Every rate change is RBAC-guarded and audited.

## Activation

```
cd backend && go build ./... && go vet ./...
supabase db push        # applies 20260926000000 + 20260927000000
# set FEATURE_COMMISSION_ENABLED=true in the backend env
# admin UI: NEXT_PUBLIC_COMMISSION_USE_MOCK=false
```
