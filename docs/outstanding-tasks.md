# Outstanding tasks — Referral & Stays (remaining only)

Updated 2026-07-06. Everything that was buildable **and** verifiable in the dev
sandbox (Go 1.25 + local pgserver Postgres, no PostGIS/root) has been CLOSED — see
`docs/referral-stays-handoff.md` for the full closed list. What follows is only
what genuinely cannot be finished here, grouped by the specific blocker and what
would unblock it.

---

## A. Needs a PostGIS-enabled Postgres
The stays supply schema (`stays_property`, `stays_room_type`, `stays_rate_plan`)
uses `geometry`/`ST_Y`/`ST_X`; it will not migrate on vanilla Postgres, so the
supply-gateway + reservation-content paths can't be exercised in the sandbox.
Unblock with a `postgis/postgis` Docker image or a real Supabase branch.

- **Stays booking saga integration tests** — search → prebook → book → confirm,
  and the auto-release (409 `state=VOID`) path. The code is wired; needs live
  supply + wallet to assert the hold-release-no-debit invariant.
- **prebook/book field-semantics** — confirm `property_id/room_type_id/
  rate_plan_id` (supplier refs vs internal mapped ids); thread
  `offer.mapped_property_id` if mapped supply needs it. (`src/features/stays/api.ts`
  `prebook()`.)
- **Reservation room/rate content enrichment** — extend the reservation `content`
  block with room/rate display names (needs `stays_room_type`/`stays_rate_plan`).
- **`nearby`** — additionally needs device coordinates plumbed through the mobile
  screen/store into `getNearbyStays`, plus geo-distance in the search handler.
- **Trips refund-preview + modify-quote** — refund-policy interpretation +
  delta-repricing against live supply.

## B. Needs a human sign-off (money-path)
- **ledger-auditor review** of: the referral **withdraw** endpoint, and the
  **`20260912000000_ledger_accounts_reconcile`** migration (widens type CHECK,
  drops `user_id` NOT NULL, adds `(user_id,type)` unique). Both are DB-test-green
  here, but constraint changes on the ledger warrant human review before merge.

## C. Needs a product decision / larger build
- **R6 referral earnings extras** — vesting schedule, reward-currency selection,
  redemption catalog + redeem (money-path), statement export. Each needs a data
  model + policy decisions; catalog/redeem is a money mutation (tests + auditor).
- **S6 stays agent-assisted flow** — the entire `/agent/*` surface (customer
  lookup, agent search/quote/collect/book/commission). Large; money-path; also
  depends on the PostGIS supply gateway.
- **Invite contact-matching** — requires the device address book (client-side
  permission + native picker) before a backend match endpoint adds value.

## D. Blocked on a missing data source (schema gap, not a task)
- **R5 referrer display-name** — the attribution API returns `referrer_id`, but
  there is **no name column** on `user_profiles` (or `profiles`/`platform_users`)
  to resolve it to a display name. Requires adding a name field upstream before
  this can be surfaced at all.

---

_Nothing in this list is closeable without the infra (PostGIS), a human reviewer,
or a product/schema decision noted above._
