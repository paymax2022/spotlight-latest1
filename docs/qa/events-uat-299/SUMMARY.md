# Events & Tickets (299) — UAT consolidation summary

**Date:** 2026-10-21  |  **Runbook:** `docs/qa/UAT-OCT-2026-RUNBOOK.md`  |  **RTM rows:** 299 / 299 source cases

## Roll-up by lane

| Lane | Main commit | Rows | Passed | Failed | Blocked | Not run | Needs manual | N/A | Other | Defects (S1/S2/S3/S4) | Fixed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| events-a | `68977ad98` | 98 | 44 | 34 | 8 | 0 | 1 | 10 | 1 | 12 (2/7/3/0) | 5 |
| events-b | `672ccc610` | 109 | 18 | 7 | 51 | 32 | 1 | 0 | — | 14 (3/7/4/0) | 5 |
| events-c | `d979e0b5d` | 92 | 37 | 32 | 7 | 1 | 14 | 1 | — | 14 (1/3/7/3) | 2 |
| **Total** | | **299** | **99** | **73** | **66** | **33** | **16** | **11** | 1 | 40 | |

`Passed` means an executed check (unit / live-DB integration / live API) per the runbook's evidence rule; code reading alone never yields `Passed`. `Other` = non-schema result values kept verbatim from the lane (`PARTIAL`, `PASSED_D<n>` = passed after that lane's defect fix).

## Open S1/S2 defects (not fixed by any lane)

| Defect | Sev | Lane | Title | Status | Platform-owned |
|---|---|---|---|---|---|
| EVTA-D001 | S1 | events-a | No organiser-upgrade pipeline for events; any authenticated user can create/manage events | recorded | yes |
| EVTB-D013 | S1 | events-b | No external payment rail for tickets (card/VA/webhook) — checkout is wallet-debit only | RECORDED | no |
| EVTC-D003 | S1 | events-c | No organiser payout/settlement rail — ticket-sale escrow is never disbursed to organisers | OPEN | no |
| EVTA-D002 | S2 | events-a | Organiser sets platform fee: fee_bps accepted from client on event create | recorded | yes |
| EVTA-D008 | S2 | events-a | No aggregate venue capacity — tier capacities can over-allocate any intended venue total | recorded | no |
| EVTA-D009 | S2 | events-a | No organiser profile/compliance entity (public page, slug, payout account, business contact, terms) | recorded | yes |
| EVTA-D010 | S2 | events-a | No venue/seat-map/geolocation model (assigned seating, accessible seats, seat labels, venue tz/geo, map links) | recorded | no |
| EVTB-D006 | S2 | events-b | No per-order or per-buyer ticket limit exists | RECORDED | no |
| EVTB-D009 | S2 | events-b | Offline scan acceptance/reconcile is unwired (server has the functions; nothing calls them) | RECORDED | no |
| EVTB-D010 | S2 | events-b | No transactional notifications on purchase/cancel/refund/reschedule | RECORDED | no |
| EVTB-D011 | S2 | events-b | No customer-initiated refund flow (request/policy/cutoff/partial) | RECORDED | no |
| EVTC-D006 | S2 | events-c | Dispute resolve claims 'refunded' but moves no money for non-food module types | OPEN | yes |
| EVTC-D007 | S2 | events-c | Dispute 'reference' accepts any free-text id — foreign order ownership not validated | OPEN | yes |

## Pending schema changes (NOT applied)

Per runbook rule 5, lanes wrote no migrations. These drafts still need review (additive-only, version-collision check) before being promoted into `supabase/migrations/` and replayed with `supabase db reset`:

- `events-uat-299/migrations-events-a/20261021000001_events_venue_capacity.pending.sql`
- `events-uat-299/migrations-events-b/per-buyer-ticket-limits.pending.sql`

Per-module narrative and evidence: `cluster-<lane>.md`; ledgers: `rtm-/defects-/exec-<lane>.csv` in this directory.
