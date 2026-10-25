# Platform (cross-cutting) — UAT consolidation summary

**Date:** 2026-10-21  |  **Runbook:** `docs/qa/UAT-OCT-2026-RUNBOOK.md`  |  **RTM rows:** 68

## Roll-up by lane

| Lane | Main commit | Rows | Passed | Failed | Blocked | Not run | Needs manual | N/A | Other | Defects (S1/S2/S3/S4) | Fixed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| platform | `2ab54fdb5` | 68 | 53 | 0 | 6 | 0 | 5 | 0 | 4 | 4 (0/1/2/1) | 2 |
| **Total** | | **68** | **53** | **0** | **6** | **0** | **5** | **0** | 4 | 4 | |

`Passed` means an executed check (unit / live-DB integration / live API) per the runbook's evidence rule; code reading alone never yields `Passed`. `Other` = non-schema result values kept verbatim from the lane (`PARTIAL`, `PASSED_D<n>` = passed after that lane's defect fix).

## Open S1/S2 defects (not fixed by any lane)

None.

## Pending schema changes (NOT applied)

Per runbook rule 5, lanes wrote no migrations. These drafts still need review (additive-only, version-collision check) before being promoted into `supabase/migrations/` and replayed with `supabase db reset`:

- `platform-uat/migrations-platform/user_roles_nulls_not_distinct.pending.sql`

Per-module narrative and evidence: `cluster-<lane>.md`; ledgers: `rtm-/defects-/exec-<lane>.csv` in this directory.
