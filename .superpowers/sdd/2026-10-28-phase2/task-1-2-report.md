# Task 1.2 report
- Added Execution.tsx, Result.tsx; pollSettlement in useCryptoSwap (GET /api/v1/admin/crypto/reconciliation?order_id=, 2s x 30).
- Pure logic in src/features/crypto/utils/swapDisplay.ts (pollUntilSettled, labels); SettlementStatus type in swapWire.ts.
- Tests: tests/crypto/swap.test.ts, 17 pass (node:test; repo has no RNTL/jest, so render behaviour is pinned via pure helpers, as in Task 1.1).
- Execution timeout uses a 30s setTimeout; not covered by a render test.
- Components not yet wired into routing.

## Fix: member-scoped settlement endpoint (critical finding)
- Problem: pollSettlement called admin-only GET /api/v1/admin/crypto/reconciliation (summary, not per-order; members get 403).
- Spec first: contracts/openapi.yaml adds GET /crypto/swaps/{id}/settlement (200/401/403/404/500).
- Backend: route `member.GET("/swaps/:id/settlement", crypto.view)` in handler.go; Handler.SwapSettlement (handler_ext.go); Service.SwapSettlement + pure swapSettlementFor (service_ext.go) using Repository.GetSwapOrder. Returns {success, settlement:{ledger_settled, settled_at|null}}; nil order -> 404, other user's order -> 403, any other error -> 500 (logged, not leaked).
- Mobile: swapDisplay.ts adds settlementPath + fetchSettlementOnce (unwraps envelope); useCryptoSwap.pollSettlement now uses them. SettlementStatus.settled_at is `string | null`.
- Tests (written first, seen failing): backend TestSwapSettlementFor (5 cases) pass; mobile tests/crypto/swap.test.ts 21/21 pass (4 new: path is non-admin, encoded, GETs new route + unwraps, null settled_at). tsc clean for touched files.
- Pre-existing, unrelated: TestCryptoTransfer_* (~30) fail in backend/internal/crypto (transfer_wallet_stub.go stub); `go build ./internal/app` fails on missing package internal/health/portal. Neither touches this change.
- Note: 403 for foreign orders (per ruling) reveals order-id existence; id is a UUID so low risk.
- Not covered: no HTTP-level/live-DB test of the route (repo.GetSwapOrder needs Postgres).
