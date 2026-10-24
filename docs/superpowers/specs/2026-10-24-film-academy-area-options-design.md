# Film Academy — priced options per area of interest

Date: 2026-10-24 · Status: design approved in chat, spec awaiting review

## Intent

Tuition belongs to **options under an area of interest**, not to the batch and not to the area.
Example: Acting → Weekdays / Weekend / 4 weeks, each available with or without boarding, each
with its own all-in price. An applicant picks up to 2 areas and one option (and a boarding
choice) per area; tuition is the sum of the chosen options. Admins create and price the options;
the mobile app presents them clearly.

Decisions taken with the product owner:
- Boarding is priced as **two all-in prices per option** (without / with boarding). There is no
  separate boarding-cost field; the app shows the difference.
- The **option defines the schedule**. Batches are start date + intake only; batch schedule,
  duration and fee are no longer shown or used for pricing.
- Unchanged: max 2 areas per application, tuition payable only on acceptance and refundable,
  ₦5,000 application fee charged at submit, whole naira (academy tables predate kobo).

## Data (additive migration)

New table `academy_area_options`:

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| area_id | uuid fk → academy_interest_areas | |
| label | text not null | schedule name, e.g. "Weekend" |
| duration_label | text null | e.g. "4 weeks" |
| price_no_boarding_ngn | bigint not null, ≥ 0 | whole naira |
| price_with_boarding_ngn | bigint null, ≥ 0 | NULL = boarding not offered |
| is_active | bool default true | |
| sort_order | int default 0 | |
| created_at / updated_at | timestamptz | |

`academy_applications.selected_options jsonb` (nullable): snapshot array of
`{area_slug, option_id, label, duration_label, boarding, price_ngn}`. Snapshot so later price
edits never change a quote. `tuition_total_ngn` = sum of `price_ngn`.

Not touched: `academy_interest_areas.fee_ngn` (stays, unused), `academy_batches.training_fee_ngn`,
settings `tuition_fee`, `areas_of_interest` (still written, derived from selections). RLS follows
the pattern in `20261222000000_academy_interest_areas_rls.sql`. Migration version must be unique
(`scripts/ci/check-migration-versions.sh`); re-check immediately before merge.

## API (contract first: `contracts/academy.openapi.yaml`)

`GET /api/academy/apply` — each entry of `interestAreas` gains `options: [{id, label,
duration_label, price_no_boarding_ngn, price_with_boarding_ngn}]` (active only, ordered). Areas
with no active options are still returned with `options: []`.

`POST /api/academy/apply` — accepts `selections: [{area, option_id, boarding: boolean}]`.
Server rules (all fail closed, 400):
- 1–2 selections; no duplicate area.
- Area active and offered by the batch (existing rule).
- Option exists, active, belongs to that area.
- `boarding=true` requires `price_with_boarding_ngn` not null.
- Price is read from the DB row; any client-supplied price is ignored.
- `areas_of_interest` derived from selections; legacy clients sending only `areas_of_interest`
  get 400 "choose an option" when the area has options, and legacy behaviour when it has none.

Admin routes (`/api/admin/academy/area-options`, permission `programs:manage`, GET/POST/PUT):
create/update option fields above; no hard delete (deactivate). Audit event on each write.

## Admin (frontend-admin Settings → Areas of interest)

Each area row expands to an options table: Schedule, Duration, Price without boarding, Price with
boarding (blank = not offered), Active, Save; plus an "Add option" row. The old per-area fee input
is replaced by a read-only "from ₦X" summary. Batch form area checkboxes drop the price suffix.

## Mobile (frontend UX per mobile-app-design guidance)

- Cohort card: area cards show "from ₦X" (lowest active price) or "Pricing coming soon" (disabled)
  when no options. No tuition total until areas are chosen.
- Apply: tapping an area opens a bottom sheet — segmented control Without / With boarding, one
  selectable card per option (label, duration, exact price for the chosen boarding setting, "+₦X
  with boarding" hint). One primary action ("Select"). 48dp targets, 8pt grid.
- Sticky summary: each pick, running "Tuition if accepted", "Pay now ₦5,000" (application fee).
- States: loading skeleton, empty (no options), limit reached (2 of 2), error + retry, dark-mode
  token pairs, screen-reader labels incl. price and boarding.
- Status screen lists chosen option + boarding per area. Tokens from `design.md`; no new colours.

## Testing

Tests first (`test-engineer`): server pricing — with/without boarding, boarding not offered,
wrong-area option, inactive option, >2 areas, duplicate area, tampered client price, snapshot
immutability after a price edit, legacy payload. Admin route permission + validation. Mobile unit
tests for price/summary helpers; golden-path regression (`npm run test:regression`) must stay green
before and after. `ledger-auditor` review before completion (tuition computation); `security-
reviewer` not required (no auth/PII change). Feature-flag: existing academy flag covers it.
ADR named `ADR-PR<pr-number>-academy-area-options.md` (number assigned on merge).

## Out of scope

Batch-level option availability, discounts/one-off discount changes, instalment-plan changes,
removing legacy columns, kobo conversion.
