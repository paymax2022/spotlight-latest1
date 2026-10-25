# Stays — Hotels & Short-lets (365) — UAT consolidation summary

**Date:** 2026-10-21  |  **Runbook:** `docs/qa/UAT-OCT-2026-RUNBOOK.md`  |  **RTM rows:** 365 / 365 source cases

## Roll-up by lane

| Lane | Main commit | Rows | Passed | Failed | Blocked | Not run | Needs manual | N/A | Other | Defects (S1/S2/S3/S4) | Fixed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| stays-a | `b80e23258` | 179 | 31 | 0 | 1 | 146 | 1 | 0 | — | 14 (2/5/6/1) | 4 |
| stays-b | `1c433106b` | 186 | 74 | 0 | 49 | 29 | 16 | 18 | — | 12 (0/2/8/2) | 0 |
| **Total** | | **365** | **105** | **0** | **50** | **175** | **17** | **18** | — | 26 | |

`Passed` means an executed check (unit / live-DB integration / live API) per the runbook's evidence rule; code reading alone never yields `Passed`. `Other` = non-schema result values kept verbatim from the lane (`PARTIAL`, `PASSED_D<n>` = passed after that lane's defect fix).

## Open S1/S2 defects (not fixed by any lane)

| Defect | Sev | Lane | Title | Status | Platform-owned |
|---|---|---|---|---|---|
| STYA-D005 | S2 | stays-a | realtor booking RPCs accept forged input: no client_ref dedup, no capacity check, no past-date guard, hardcoded cleaning fee | RECORDED (pending sql) | no |
| STYA-D010 | S2 | stays-a | No request-to-book lifecycle (pending/accept/reject/expire/withdraw) | RECORDED | no |
| STYA-D011 | S2 | stays-a | No multi-line reservation: mixed room types / mixed rate plans cannot book in one order | RECORDED | no |
| STYB-D001 | S2 | stays-b | Stay-operations fulfillment layer absent (check-in/out, room assignment, housekeeping, turnover buffer, damage claims) | pending migration authored | no |
| STYB-D002 | S2 | stays-b | Caution-deposit feature absent (no liability tracking, deduction, or separate refund) | pending migration authored (stays_deposit+stays_damage_claim) | no |

## Pending schema changes (NOT applied)

Per runbook rule 5, lanes wrote no migrations. These drafts still need review (additive-only, version-collision check) before being promoted into `supabase/migrations/` and replayed with `supabase db reset`:

- `stays-uat-365/migrations-stays-a/realtor_rpc_hardening.pending.sql`
- `stays-uat-365/migrations-stays-a/stays_supplier_refs_backfill.pending.sql`
- `stays-uat-365/migrations-stays-b/20270000000001_stays_ops_fulfillment.pending.sql`

Per-module narrative and evidence: `cluster-<lane>.md`; ledgers: `rtm-/defects-/exec-<lane>.csv` in this directory.
