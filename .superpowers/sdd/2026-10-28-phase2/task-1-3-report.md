# Task 1.3 report: Admin reconciliation UI

Status: DONE (9/9 tests pass; tsc clean for new files).

Files (frontend-admin/):
- src/lib/api.ts: ReconciliationReport/OrderReconciliationRow types + fetchReconciliation (GET /admin/crypto/reconciliation with details, start_date, end_date).
- app/admin/crypto/reconciliation.tsx: summary cards, date range, 30s auto-refresh, error alert.
- app/admin/crypto/ReconTable.tsx: sortable (asc/desc, aria-sort), row tones green/yellow/orange/red, row click expands detail.
- app/admin/crypto/OrderDetail.tsx: order info, settled-at, ledger entries section, drift, Drift Note textarea.
- tests/admin/crypto/reconciliation.test.tsx.

Deviations / notes:
- Existing route app/admin/crypto/reconciliation/page.tsx (per-asset on-chain drift) is untouched. The new component is not yet routed; mounting it needs a separate page decision.
- The report payload has no per-leg ledger entries or raw provider webhook data, so OrderDetail shows settlement state and states that legs are not in the payload.
- Drift Note is session-local state; no persistence endpoint exists yet.
- Tone rules: failed/error = red; drift present = orange; executing/processing/pending = yellow; else green.
- Test imports jest-dom explicitly (vitest.setup.ts does not).

## Fix round: review findings (missing endpoint, missing auth)

Finding 1 (endpoint): added `GET /api/v1/admin/crypto/reconciliation/swaps`, RBAC `PermAdmin`, handler `AdminSwapReconciliation` (backend/internal/crypto/admin_service.go) calling `Service.ReconcileSwapOrders(ctx, details)`; route in handler.go. Returns the flat `ReconciliationReport` ({run_at,total_orders,reconcilled_orders,drift_orders,failed_orders,orders,summary}). The existing per-asset `/reconciliation` is untouched. `details=true` adds per-order rows.

Finding 2 (auth): frontend-admin/src/lib/api.ts fetchReconciliation now calls the new `/reconciliation/swaps` path with `credentials: 'include'` and `adminAuthHeaders()`. This is the repo pattern (adminApiClient.ts): the HttpOnly `sb-admin-token` cookie goes to the same-origin proxy, which attaches `Authorization: Bearer` server-side. A client-side Authorization header is deliberately not used (config/env.ts, adminApiClient.test.ts).

Verification:
- frontend-admin `tsc --noEmit`: clean. `vitest tests/admin/crypto`: 9/9 pass.
- mobile `npm run test:crypto`: 16/16 pass.
- backend `go vet ./internal/crypto/`: clean. `go test ./internal/crypto/`: FAILS in TestCryptoTransfer_* (transfer_wallet_test.go), identical failure set with my changes stashed, so pre-existing and unrelated. `internal/crypto/deposit` passes. Repo-wide `go build ./...` hit a Windows file lock on cmd/fxsmoke (environmental); crypto and cmd packages compile.

Known gaps:
- start_date/end_date are sent by the UI but ignored by the service (ReconcileSwapOrders has no date filter).
- No Go test for the new handler: the Service holds a concrete *Repository (needs a live DB), so no unit seam exists.
