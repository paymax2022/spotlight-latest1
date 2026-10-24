# Task 3 report
Changed frontend-web/app/api/academy/apply/route.ts (GET nests active options; POST `selections` path via priceSelections, snapshot `selected_options`, tuition_total_ngn from DB-priced total; legacy payload 400 when an area has active options; no legacy schema-mismatch fallback on the selections path so the snapshot is never silently dropped). New spec tests/unit/academy/apply-area-options.spec.ts (13 tests, table-aware fake).
Fail-first: with route reverted, 5 of 13 failed (GET nesting, DB pricing, snapshot, legacy-400, snapshot-unchanged); the 400-validation cases pass trivially pre-change. After: 13/13.
Also: golden-path academy-apply + tests/unit/academy: 102 passed, 1 skipped; test:regression: 10 files, 138 tests passed.
Note: route was edited before the spec was written; red was demonstrated by reverting the route via patch and reapplying.

## Fix round 1
- route: 42P01 on academy_area_options tolerated only on the legacy (no selections) POST path; selections path still throws (500). GET already ignores the query error, so a missing table yields options: [] (now tested).
- spec: stronger two-application snapshot test, corrected fake comment, added 42P01 x3, other-area option, boarding-null, duplicate area, paid-registration tests (20 tests total).
- Results: apply-area-options 20/20; academy-apply + tests/unit/academy: see commit; test:regression 10 files / 138 tests green.
