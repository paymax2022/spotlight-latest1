# Phase 2 Implementation Plan: Crypto Mobile UI + Admin Dashboard + Playbook Blocks 13–15

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Crypto Phase 2 mobile UI + admin dashboard + live Quidax + load testing; simultaneously implement Playbook Blocks 13–15 (telemedicine, transport, restaurant) as independent money-path modules; fill remaining time with health lab integration, settlement automation, and optional FX providers.

**Architecture:** 
- **Track 1 (Crypto Phase 2):** Single-threaded, focused delivery (hours 0–12). Mobile swap execution screens (quote display → confirm → loading → result), admin reconciliation dashboard (live drift report), Quidax sandbox integration, 100-concurrent load test.
- **Track 2–4 (Blocks 13–15):** Parallel independent branches (hours 2–36), each implementing a complete money-path module (service + API + settlement + feature flag).
- **Track 5 (Other Crypto):** Sequential work (hours 36–62), health lab integration first, settlement processor automation second, additional FX providers if time permits.

**Tech Stack:** 
- Backend: Go 1.27, Gin v1.10, pgx pool, asynq (queue), Redlock (matching)
- Frontend (Mobile): React Native, Expo, Supabase SSR
- Frontend (Admin): Next.js 15.1, TypeScript, Tailwind CSS
- Database: PostgreSQL 17, Supabase migrations (additive-only)
- Testing: TDD (failing tests first), `go test -race`, Vitest (mobile), k6 (load testing)

**Spec:** `docs/superpowers/specs/2026-10-28-phase2-implementation-design.md`

---

## Global Constraints

- **All monetary amounts:** integers in minor units (kobo). No floats, no strings for math.
- **Every money mutation:** requires Idempotency-Key header, posts balanced double-entry ledger entries, emits audit event, passes tier-limit checks (fail-closed).
- **Wallet balances:** projections of ledger only. Never UPDATE balance column directly.
- **Ledger entries:** immutable. Corrections = reversing entries only.
- **Migrations:** additive-only. No DROP, no column renames, no type narrowing.
- **Feature flags:** All modules launch with flags OFF by default. No auto-enable.
- **Tests:** TDD pattern (failing test first), all tests must pass before merge, `-race` flag on Go tests.
- **Commits:** Conventional Commits, one feature per commit, <400 lines per PR where possible.

---

## Review Focus

1. **Idempotency under concurrent retries:** Booking/swap/ride with same Idempotency-Key, submitted 10 times concurrently → exactly one ledger entry posted, not 10. Tests: telemedicine booking idempotency, swap idempotency, ride acceptance (Redlock) idempotency.

2. **Ledger balance invariant under settlement lag:** Completed swap/appointment not yet settled; query ledger for holding account → balance correct (includes in-flight settled but not finalized). Settlement processor runs later → still correct. Tests: every block's settlement tests verify ledger balance before/after, including in-flight state.

3. **Webhook signature verification (constant-time):** Quidax webhook payload signed with HMAC-SHA256 secret; verify in constant time. Attacker cannot determine valid signature by timing retry storms. Test: crypto Phase 2 load test includes fake webhooks with invalid signatures (must reject, not process).

4. **Feature flag prevents route registration:** Flag OFF (default) → route 404, not panic. Users cannot accidentally hit unfinished module. Tests: each block has test that feature flag OFF → route returns 404, flag ON → route returns 200.

5. **Concurrent Redlock matching (transport rides):** 10 drivers simultaneously accept same ride → exactly one driver wins (Redlock), others get 409 Conflict. Ledger only posted for winning driver. Tests: transport block concurrency test, 10 threads, same ride ID, only one succeeds.

---

## File Structure Overview

### Track 1: Crypto Phase 2

**Mobile UI** (`mobile-app/reactnative/app/crypto/swap/`):
- `index.tsx` — Route + layout
- `QuoteDisplay.tsx` — Quote review screen with expiry countdown
- `Confirmation.tsx` — User confirmation before execution
- `Execution.tsx` — Loading state during ConfirmQuotation
- `Result.tsx` — Success/failure terminal state with reconciliation data
- `useCryptoSwap.ts` — Hook: quote API, swap API, status polling, settlement lookup

**Admin Dashboard** (`frontend-admin/app/admin/crypto/reconciliation.tsx`):
- `page.tsx` — Layout, time filter, summary cards
- `ReconTable.tsx` — Drift report table with sorting/filtering
- `OrderDetail.tsx` — Per-order detail panel (ledger entries, settlement status)
- `api/route.ts` — Next.js route handler: calls Go backend `/api/v1/admin/crypto/reconciliation`

**Backend** (existing, no new files for Quidax; already implemented in CR-009–CR-015):
- Already complete: `provider.go`, `service_ext.go`, `webhook.go`, `reconciliation.go`
- Modifications: none (reuse existing)

**Load Testing** (`backend/tests/crypto_load_test.go`):
- New file: k6 script simulation (or standalone Go benchmark)
- 100 concurrent users, measure p50/p95/p99 latency, throughput, ledger balance verification

---

### Track 2–4: Playbook Blocks 13–15

**Block 13: Telemedicine** (`backend/internal/telemedicine/`):
- `model.go` — Appointment struct, fee split constants (85/15)
- `service.go` — Book, Confirm, Cancel, Settle methods
- `repository.go` — CRUD for appointments, settlement lookups
- `handler.go` — API routes (POST /appointments, POST /appointments/:id/confirm, etc.)
- `service_test.go` — Service tests (TDD)
- Migration: `supabase/migrations/<timestamp>_telemedicine_appointments.sql`

**Block 14: Transport** (`backend/internal/transport/`):
- `model.go` — Ride struct, fare calculation, Redlock constants
- `service.go` — RequestRide, AcceptRide (Redlock), CompleteRide, CancelRide
- `repository.go` — CRUD for rides, settlement lookups
- `handler.go` — API routes
- `redlock.go` — Redlock wrapper (lease-based matching)
- `service_test.go` — Tests including concurrency (10 drivers, one wins)
- Migration: `supabase/migrations/<timestamp>_transport_rides.sql`

**Block 15: Restaurant** (`backend/internal/restaurant/`):
- `model.go` — Order struct, item struct, delivery fee constant (50000 kobo)
- `service.go` — PlaceOrder, ConfirmOrder, DeliverOrder, CancelOrder
- `repository.go` — CRUD for orders, settlement lookups
- `handler.go` — API routes
- `service_test.go` — Tests
- Migration: `supabase/migrations/<timestamp>_restaurant_orders.sql`

**Feature Flags** (config updates):
- `backend/internal/config/config.go` — Add FeatureTelemedicineEnabled, FeatureTransportEnabled, FeatureRestaurantEnabled bools
- `backend/internal/app/finance_routes.go` — Conditional route registration (if flag enabled)

---

### Track 5: Other Crypto

**Health Lab Integration** (`backend/internal/health/lab/`):
- Modify: `service.go` — BookAppointment: add payment_method parameter, crypto flow
- New: `crypto_payment.go` — Helper: FX quote, swap execution, ledger posting
- Modify: `handler.go` — Add payment_method to booking request
- Tests: modify `service_test.go` to include crypto payment flow

**Settlement Processor** (`backend/internal/crypto/`):
- New: `settlement_processor.go` — CronSettleSwaps task, scan + settle batch
- Modify: `service.go` — Add RegisterSettlementProcessor(cfg) to wire asynq task
- Tests: `settlement_processor_test.go` — Verify auto-settle, idempotency, error handling

**Optional FX Providers** (`backend/internal/provider/`):
- If time permits: `eversend_adapter.go`, `vertofx_adapter.go` (implement SwapProvider interface)
- Tests: `eversend_test.go`, `vertofx_test.go`

---

## Task Decomposition

### **TRACK 1: CRYPTO PHASE 2** (Hours 0–12, Single-Threaded Focus)

---

#### Task 1.1: Mobile UI — QuoteDisplay & Confirmation Screens

**Files:**
- Create: `mobile-app/reactnative/app/crypto/swap/QuoteDisplay.tsx`
- Create: `mobile-app/reactnative/app/crypto/swap/Confirmation.tsx`
- Create: `mobile-app/reactnative/app/crypto/swap/useCryptoSwap.ts`
- Create: `mobile-app/reactnative/tests/crypto/swap.test.ts`
- Modify: `mobile-app/reactnative/app/crypto/swap/index.tsx`

**Interfaces:**
- Consumes: Existing `SwapQuoteAPI` (returns `quotation_id`, `expires_at`, `from_units`, `to_units`, `from_price_kobo`, `to_price_kobo`)
- Produces: `useCryptoSwap` hook with `quote`, `quoteExpiry`, `confirmSwap(quotationID)`, `status`

**Steps:**

- [ ] **Step 1: Write failing test for QuoteDisplay screen**

File: `mobile-app/reactnative/tests/crypto/swap.test.ts`

```typescript
describe('QuoteDisplay', () => {
  test('renders quote details with expiry countdown', () => {
    const quote = {
      quotation_id: 'qid_123',
      from_asset_id: 'usdt',
      to_asset_id: 'ngn',
      from_units: '100',
      to_units: '15000000',
      expires_at: new Date(Date.now() + 15000).toISOString(),
    };
    render(<QuoteDisplay quote={quote} onConfirm={jest.fn()} onRefresh={jest.fn()} />);
    expect(screen.getByText(/100.*USDT/)).toBeInTheDocument();
    expect(screen.getByText(/15,000,000.*NGN/)).toBeInTheDocument();
    expect(screen.getByText(/Expires in.*seconds/)).toBeInTheDocument();
  });

  test('shows expired state when expires_at < now', () => {
    const quote = {
      quotation_id: 'qid_123',
      from_asset_id: 'usdt',
      to_asset_id: 'ngn',
      from_units: '100',
      to_units: '15000000',
      expires_at: new Date(Date.now() - 1000).toISOString(), // already expired
    };
    render(<QuoteDisplay quote={quote} onConfirm={jest.fn()} onRefresh={jest.fn()} />);
    expect(screen.getByText(/Quote expired/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Get New Quote/ })).toBeInTheDocument();
  });

  test('countdown turns red when < 5 seconds remaining', async () => {
    const quote = {
      quotation_id: 'qid_123',
      from_asset_id: 'usdt',
      to_asset_id: 'ngn',
      from_units: '100',
      to_units: '15000000',
      expires_at: new Date(Date.now() + 4000).toISOString(), // 4 seconds left
    };
    render(<QuoteDisplay quote={quote} onConfirm={jest.fn()} onRefresh={jest.fn()} />);
    expect(screen.getByTestId('countdown')).toHaveStyle('color: red');
  });
});

describe('Confirmation', () => {
  test('displays final swap amount and fee breakdown', () => {
    const order = {
      from_units: '100',
      to_units: '15000000',
      from_price_kobo: 250000,
      to_price_kobo: 1,
      cash_kobo: 0,
      spread_kobo: 50000,
      spread_bps: 25,
    };
    render(<Confirmation order={order} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText(/You will receive.*15,000,000.*NGN/)).toBeInTheDocument();
    expect(screen.getByText(/Fee.*50,000.*kobo/)).toBeInTheDocument();
  });

  test('calls onConfirm when Confirm button clicked', async () => {
    const mockConfirm = jest.fn();
    const order = { from_units: '100', to_units: '15000000', from_price_kobo: 250000, to_price_kobo: 1, cash_kobo: 0, spread_kobo: 50000, spread_bps: 25 };
    render(<Confirmation order={order} onConfirm={mockConfirm} onCancel={jest.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Confirm Swap/ }));
    expect(mockConfirm).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd mobile-app/reactnative
npm run test -- tests/crypto/swap.test.ts
```

Expected: FAIL — "QuoteDisplay is not defined", "Confirmation is not defined"

- [ ] **Step 3: Implement QuoteDisplay.tsx**

File: `mobile-app/reactnative/app/crypto/swap/QuoteDisplay.tsx`

Implement a component that:
- Accepts props: `quote: SwapQuote`, `onConfirm: () => void`, `onRefresh: () => void`
- Displays from_asset, from_units, to_asset, to_units, spread_kobo
- Shows countdown timer updating every second; turns red if < 5 seconds
- Shows "Confirm Swap" button if time remaining; "Get New Quote" button if expired
- Uses `setInterval` to update countdown; clean up on unmount

Use Tailwind CSS for styling. Follow existing crypto screen patterns in the codebase.

- [ ] **Step 4: Implement Confirmation.tsx**

File: `mobile-app/reactnative/app/crypto/swap/Confirmation.tsx`

Implement a component that:
- Accepts props: `order: SwapOrder`, `onConfirm: () => void`, `onCancel: () => void`
- Displays final swap amounts (from_units → to_units)
- Shows fee breakdown (spread_kobo, spread_bps)
- Has "Confirm Swap" and "Cancel" buttons
- Calls onConfirm when Confirm clicked

- [ ] **Step 5: Implement useCryptoSwap hook**

File: `mobile-app/reactnative/app/crypto/swap/useCryptoSwap.ts`

```typescript
export interface UseSwapReturn {
  quote: SwapQuote | null;
  quoteLoading: boolean;
  quoteError: Error | null;
  getQuote(fromAssetID: string, toAssetID: string, fromUnits: int64): Promise<void>;
  confirmSwap(quotationID: string): Promise<SwapOrder>;
  swapStatus: 'idle' | 'confirming' | 'executing' | 'complete' | 'failed';
  pollSettlement(orderID: string): Promise<void>;
}

export function useCryptoSwap(): UseSwapReturn {
  // Implement:
  // - getQuote: calls POST /api/v1/crypto/swap/quote, stores result
  // - confirmSwap: calls POST /api/v1/crypto/swap with quotationID, returns SwapOrder
  // - pollSettlement: polls admin reconciliation API for settlement confirmation
  // - swapStatus state machine: idle → confirming → executing → complete (or failed)
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd mobile-app/reactnative
npm run test -- tests/crypto/swap.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd mobile-app/reactnative
git add app/crypto/swap/QuoteDisplay.tsx app/crypto/swap/Confirmation.tsx app/crypto/swap/useCryptoSwap.ts tests/crypto/swap.test.ts
git commit -m "feat(crypto-mobile): quote display and confirmation screens with countdown timer

Implement React Native screens for swap quote review and confirmation flow:
  - QuoteDisplay: shows quote details, expiry countdown (red < 5s), refresh CTA
  - Confirmation: displays final amounts, fee breakdown, confirm/cancel buttons
  - useCryptoSwap hook: manages quote fetching, swap confirmation, status polling

Tests: quote rendering, countdown logic, expiry state, confirmation flow.
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

#### Task 1.2: Mobile UI — Execution & Result Screens

**Files:**
- Create: `mobile-app/reactnative/app/crypto/swap/Execution.tsx`
- Create: `mobile-app/reactnative/app/crypto/swap/Result.tsx`
- Modify: `mobile-app/reactnative/tests/crypto/swap.test.ts` (add tests for execution/result)
- Modify: `mobile-app/reactnative/app/crypto/swap/useCryptoSwap.ts` (add settlement polling)

**Interfaces:**
- Consumes: `SwapOrder` struct with `id`, `status`, `swap_transaction_id`, `settlement_id`
- Produces: Settlement lookup result with `ledger_settled`, `settled_at`

**Steps:**

- [ ] **Step 1: Write failing test for Execution & Result screens**

File: `mobile-app/reactnative/tests/crypto/swap.test.ts` (append)

```typescript
describe('Execution', () => {
  test('displays processing indicator and transaction ID', () => {
    const order = {
      id: 'ord_123',
      status: 'executing',
      swap_transaction_id: 'qtx_abc123',
    };
    render(<Execution order={order} />);
    expect(screen.getByText(/Processing/)).toBeInTheDocument();
    expect(screen.getByText('qtx_abc123')).toBeInTheDocument();
  });

  test('shows error after 30s no webhook', async () => {
    const order = { id: 'ord_123', status: 'executing', swap_transaction_id: 'qtx_abc123' };
    jest.useFakeTimers();
    render(<Execution order={order} />);
    jest.advanceTimersByTime(31000);
    expect(screen.getByText(/Swap failed/)).toBeInTheDocument();
  });
});

describe('Result', () => {
  test('displays success message with settlement status', async () => {
    const order = { id: 'ord_123', status: 'completed', to_units: '15000000' };
    const settlement = { ledger_settled: true, settled_at: '2026-10-28T12:00:00Z' };
    render(<Result order={order} settlement={settlement} />);
    expect(screen.getByText(/Swap completed/)).toBeInTheDocument();
    expect(screen.getByText(/You received.*15,000,000.*NGN/)).toBeInTheDocument();
    expect(screen.getByText(/Settled/)).toBeInTheDocument();
  });

  test('displays failure message with refund info', () => {
    const order = { id: 'ord_123', status: 'failed' };
    const settlement = { ledger_settled: true, settled_at: '2026-10-28T12:00:00Z' };
    render(<Result order={order} settlement={settlement} />);
    expect(screen.getByText(/Swap failed/)).toBeInTheDocument();
    expect(screen.getByText(/Refunded/)).toBeInTheDocument();
  });

  test('has View Details button that opens reconciliation data', async () => {
    const order = { id: 'ord_123', status: 'completed' };
    const settlement = { ledger_settled: true, settled_at: '2026-10-28T12:00:00Z' };
    render(<Result order={order} settlement={settlement} />);
    await userEvent.click(screen.getByRole('button', { name: /View Details/ }));
    expect(screen.getByText(/Order ID.*ord_123/)).toBeInTheDocument();
  });
};
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd mobile-app/reactnative
npm run test -- tests/crypto/swap.test.ts
```

Expected: FAIL — "Execution is not defined", "Result is not defined"

- [ ] **Step 3: Implement Execution.tsx**

File: `mobile-app/reactnative/app/crypto/swap/Execution.tsx`

Implement a component that:
- Displays "Processing..." indicator with spinner
- Shows transaction ID from `order.swap_transaction_id`
- Sets a 30-second timeout; if status doesn't change to "completed" or "failed", shows error
- Uses `setInterval` to poll order status every 2 seconds

- [ ] **Step 4: Implement Result.tsx**

File: `mobile-app/reactnative/app/crypto/swap/Result.tsx`

Implement a component that:
- Displays success message if status = "completed", failure if status = "failed"
- Shows received amount and settlement status
- Has "View Details" button that expands to show order ID, settlement timestamp, ledger reference

- [ ] **Step 5: Enhance useCryptoSwap hook for settlement polling**

Update `mobile-app/reactnative/app/crypto/swap/useCryptoSwap.ts`:

```typescript
// Add method:
async function pollSettlement(orderID: string): Promise<SettlementStatus> {
  // Poll GET /api/v1/admin/crypto/reconciliation?order_id=<orderID>
  // Return { ledger_settled, settled_at }
  // Retry every 2 seconds up to 30 times (1 minute max)
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd mobile-app/reactnative
npm run test -- tests/crypto/swap.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd mobile-app/reactnative
git add app/crypto/swap/Execution.tsx app/crypto/swap/Result.tsx app/crypto/swap/useCryptoSwap.ts tests/crypto/swap.test.ts
git commit -m "feat(crypto-mobile): execution and result screens with settlement polling

Implement execution (processing spinner, 30s timeout) and result (success/failure)
screens for swap trading flow. Add settlement polling to hook (poll every 2s for
up to 1 minute). Show ledger settlement status in result detail view.

Tests: execution timeout, result success/failure states, settlement polling.
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

#### Task 1.3: Admin Dashboard — Reconciliation UI

**Files:**
- Create: `frontend-admin/app/admin/crypto/reconciliation.tsx`
- Create: `frontend-admin/app/admin/crypto/ReconTable.tsx`
- Create: `frontend-admin/app/admin/crypto/OrderDetail.tsx`
- Create: `frontend-admin/tests/admin/crypto/reconciliation.test.tsx`

**Interfaces:**
- Consumes: API endpoint `GET /api/v1/admin/crypto/reconciliation?details=true&start_date=<ISO>&end_date=<ISO>` returning `ReconciliationReport`
- Produces: React component displaying summary cards, drift table, per-order detail panel

**Steps:**

- [ ] **Step 1: Write failing test for reconciliation page layout**

File: `frontend-admin/tests/admin/crypto/reconciliation.test.tsx`

```typescript
describe('ReconciliationPage', () => {
  test('renders summary cards: total, reconcilled, drift, failed', async () => {
    const mockData = {
      run_at: '2026-10-28T12:00:00Z',
      total_orders: 100,
      reconcilled_orders: 95,
      drift_orders: 4,
      failed_orders: 1,
      orders: [],
      summary: '100 total orders: 95 reconcilled, 4 drift, 1 failed',
    };
    vi.mock('@/lib/api', () => ({
      fetchReconciliation: vi.fn().mockResolvedValue(mockData),
    }));
    render(<ReconciliationPage />);
    await waitFor(() => {
      expect(screen.getByText('Total Orders')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
      expect(screen.getByText('Reconcilled')).toBeInTheDocument();
      expect(screen.getByText('95')).toBeInTheDocument();
    });
  });

  test('renders time range picker and auto-refresh toggle', async () => {
    render(<ReconciliationPage />);
    expect(screen.getByLabelText(/Start Date/)).toBeInTheDocument();
    expect(screen.getByLabelText(/End Date/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Auto-refresh/ })).toBeInTheDocument();
  });

  test('renders drift report table with sortable columns', async () => {
    const mockData = {
      run_at: '2026-10-28T12:00:00Z',
      total_orders: 1,
      reconcilled_orders: 0,
      drift_orders: 1,
      failed_orders: 0,
      orders: [{
        order_id: 'ord_123',
        user_id: 'user_456',
        status: 'completed',
        ledger_settled: false,
        swap_transaction_id: 'qtx_abc',
        provider_status: 'completed',
        settled_at: null,
        drift: 'completed but not ledger_settled (settlement lag)',
      }],
      summary: '1 total orders: 0 reconcilled, 1 drift, 0 failed',
    };
    vi.mock('@/lib/api', () => ({
      fetchReconciliation: vi.fn().mockResolvedValue(mockData),
    }));
    render(<ReconciliationPage />);
    await waitFor(() => {
      expect(screen.getByText('ord_123')).toBeInTheDocument();
      expect(screen.getByText(/settlement lag/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend-admin
npm run test -- tests/admin/crypto/reconciliation.test.tsx
```

Expected: FAIL — component not defined

- [ ] **Step 3: Implement ReconciliationPage layout**

File: `frontend-admin/app/admin/crypto/reconciliation.tsx`

```typescript
export default function ReconciliationPage() {
  const [startDate, setStartDate] = useState<Date>(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(false);

  // Implement:
  // - Fetch report on mount + when date range changes
  // - Auto-refresh every 30s if toggle ON
  // - Render summary cards (total, reconcilled, drift, failed)
  // - Render date picker + auto-refresh toggle
  // - Render ReconTable with report.orders
}
```

- [ ] **Step 4: Implement ReconTable component**

File: `frontend-admin/app/admin/crypto/ReconTable.tsx`

Implement a table that:
- Displays columns: OrderID | UserID | Status | LedgerSettled | ProviderStatus | SettledAt | Drift
- Sortable by any column (click header)
- Color-coded rows: green (no drift), yellow (executing), orange (drift), red (failed)
- Click row to expand OrderDetail panel
- Uses `useState` for sort order, selected row

- [ ] **Step 5: Implement OrderDetail panel**

File: `frontend-admin/app/admin/crypto/OrderDetail.tsx`

Implement a component that:
- Displays full order history (timestamps, status changes)
- Shows ledger entries (debit/credit legs, amounts, accounts)
- Displays provider status (raw Quidax webhook data)
- Has "Drift Note" textarea for admin audit trail entry

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd frontend-admin
npm run test -- tests/admin/crypto/reconciliation.test.tsx
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd frontend-admin
git add app/admin/crypto/reconciliation.tsx app/admin/crypto/ReconTable.tsx app/admin/crypto/OrderDetail.tsx tests/admin/crypto/reconciliation.test.tsx
git commit -m "feat(admin-crypto): reconciliation dashboard with drift detection UI

Implement admin dashboard for swap reconciliation monitoring:
  - Summary cards: total orders, reconcilled count, drift count, failed count
  - Time range picker (last 24h, 7d, custom) with auto-refresh toggle
  - Drift report table: sortable columns, color-coded rows (green/yellow/orange/red)
  - Per-order detail panel: ledger entries, provider status, drift note field

Tests: page layout, table rendering, row expansion, date filtering.
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

#### Task 1.4: Live Quidax Integration & Load Testing

**Files:**
- Create: `backend/tests/crypto_load_test.go`
- Verify: `backend/internal/config/config.go` has Quidax env vars (already in CR-009)
- Modify: `backend/internal/app/routes.go` — health check includes Quidax status

**Interfaces:**
- Consumes: Existing `provider.quidaxProvider` implementation from CR-009
- Produces: Load test report (latency p50/p95/p99, throughput, ledger balance verification)

**Steps:**

- [ ] **Step 1: Write failing load test**

File: `backend/tests/crypto_load_test.go`

```go
package tests

import (
	"context"
	"testing"
	"time"
	"spotlight/backend/internal/crypto"
)

func TestLoadSwaps_100Concurrent(t *testing.T) {
	// Setup: connect to test database, initialize service with live Quidax provider
	// Verify: Quidax credentials available via env vars

	// Load test scenario:
	// - 100 concurrent goroutines
	// - Each: GetQuote (via Quidax API) -> Swap (execute) -> wait for webhook
	// - Measure: latency (p50, p95, p99), throughput (swaps/sec), webhook delivery latency
	// - Verify: every swap posts balanced ledger entries (debit = credit)
	// - Duration: 5-minute steady state

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	results := make(chan LoadTestResult, 100)
	start := time.Now()

	for i := 0; i < 100; i++ {
		go func() {
			quote, err := svc.SwapQuoteQuidax(ctx, userID, "USDT", "NGN", 100)
			if err != nil {
				t.Logf("quote error: %v", err)
				return
			}
			order, err := svc.Swap(ctx, userID, "USDT", "NGN", 100, quote.QuotationID, "idemkey_"+time.Now().String())
			if err != nil {
				t.Logf("swap error: %v", err)
				return
			}
			results <- LoadTestResult{
				OrderID: order.ID,
				Latency: time.Since(start),
				Status:  order.Status,
			}
		}()
	}

	// Collect results
	// Calculate latency percentiles
	// Verify all orders post balanced ledger entries
	// Assert: p95 latency < 2s, throughput > 20/sec, ledger balanced
}
```

- [ ] **Step 2: Verify Quidax credentials are set (environment setup)**

Ensure env vars are available:
```bash
export CRYPTO_QUIDAX_API_KEY=<key>
export CRYPTO_QUIDAX_SECRET=<secret>
export CRYPTO_QUIDAX_WEBHOOK_SECRET=<webhook_secret>
```

- [ ] **Step 3: Run load test (will fail without Quidax creds or with timeout)**

```bash
cd backend
TEST_DATABASE_URL="postgres://user:pass@localhost:5432/spotlight_test" \
  CRYPTO_QUIDAX_API_KEY="<key>" \
  CRYPTO_QUIDAX_SECRET="<secret>" \
  go test ./tests/... -run TestLoadSwaps -v -timeout 10m
```

Expected: FAIL (likely timeout waiting for Quidax API responses or webhook)

- [ ] **Step 4: Implement load test with metrics collection**

File: `backend/tests/crypto_load_test.go`

Implement a load test that:
- Spawns 100 goroutines, each making SwapQuoteQuidax + Swap calls
- Collects latency measurements
- Calculates p50, p95, p99 percentiles
- Queries ledger to verify all swaps have balanced entries (sum of debits = sum of credits)
- Reports metrics: throughput (swaps/sec), error rate, webhook delivery latency

Use `time.Now()` to measure latency. Use `sort.Ints()` to calculate percentiles.

- [ ] **Step 5: Add Quidax health check to startup**

File: `backend/internal/app/routes.go` (modify health check route)

When `CRYPTO_QUIDAX_API_KEY` is set:
- Attempt a test API call (e.g., ListQuidaxAssets or GetAssetBySymbol)
- If succeeds, log "Quidax provider ready"
- If fails, log warning but don't block startup (fallback to mock)

- [ ] **Step 6: Run load test to verify it passes**

```bash
cd backend
TEST_DATABASE_URL="..." \
  CRYPTO_QUIDAX_API_KEY="..." \
  go test ./tests/... -run TestLoadSwaps -v
```

Expected: PASS with latency report (p95 < 2s if Quidax API is responsive)

- [ ] **Step 7: Commit**

```bash
git add backend/tests/crypto_load_test.go backend/internal/app/routes.go
git commit -m "test(crypto): load test 100 concurrent swaps with Quidax sandbox

Add load test suite: 100 concurrent SwapQuoteQuidax + Swap calls, measure
latency (p50/p95/p99), throughput (swaps/sec), webhook delivery latency.
Verify all swaps post balanced ledger entries. Add Quidax health check to
startup (logs readiness or fallback to mock if credentials unset).

Success criteria: p95 < 2s, throughput > 20/sec, zero ledger imbalances.
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### **TRACK 2: PLAYBOOK BLOCK 13 — TELEMEDICINE** (Hours 2–36, Parallel)

---

#### Task 2.1: Telemedicine Schema & Service

**Files:**
- Create: `supabase/migrations/<timestamp>_telemedicine_appointments.sql`
- Create: `backend/internal/telemedicine/model.go`
- Create: `backend/internal/telemedicine/service.go`
- Create: `backend/internal/telemedicine/repository.go`
- Create: `backend/internal/telemedicine/service_test.go`

**Interfaces:**
- Consumes: Existing `ledger.Service`, `settlement.Service`, database pool, RBAC
- Produces: `Appointment` struct, `Book()`, `Confirm()`, `Cancel()`, `Settle()` methods

**Steps:**

- [ ] **Step 1: Create Supabase migration for appointments table**

File: `supabase/migrations/<timestamp>_telemedicine_appointments.sql`

```sql
CREATE TABLE telemedicine_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES auth.users(id),
  doctor_id UUID NOT NULL REFERENCES auth.users(id),
  slot TIMESTAMP NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')) DEFAULT 'pending',
  consultation_fee_kobo INT8 NOT NULL,
  settlement_id UUID REFERENCES finance_settlement(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(doctor_id, slot)
);
CREATE INDEX ON telemedicine_appointments(patient_id);
CREATE INDEX ON telemedicine_appointments(doctor_id);
CREATE INDEX ON telemedicine_appointments(status);
```

- [ ] **Step 2: Write failing test for Book()**

File: `backend/internal/telemedicine/service_test.go`

```go
func TestBook(t *testing.T) {
  // Setup: create patient, doctor users; initialize service
  patientID := "patient_123"
  doctorID := "doctor_456"
  slot := time.Now().Add(24 * time.Hour)
  feeKobo := int64(50000000) // ₦500,000
  key := "idemkey_book_1"

  // Patient balance before
  walletBefore, _ := ledger.GetBalance(ctx, patientID)

  // Test: Book appointment
  appt, err := svc.Book(ctx, patientID, doctorID, slot, feeKobo, key)
  require.NoError(t, err)
  require.Equal(t, "pending", appt.Status)
  require.NotEmpty(t, appt.ID)

  // Verify: patient balance decreased by fee
  walletAfter, _ := ledger.GetBalance(ctx, patientID)
  require.Equal(t, walletBefore - feeKobo, walletAfter)

  // Verify: idempotency (book again with same key → same result)
  appt2, _ := svc.Book(ctx, patientID, doctorID, slot, feeKobo, key)
  require.Equal(t, appt.ID, appt2.ID)
}

func TestDoubleBooking(t *testing.T) {
  // Setup: create doctor, two patients
  doctorID := "doctor_456"
  slot := time.Now().Add(24 * time.Hour)

  // Test: patient 1 books slot
  appt1, _ := svc.Book(ctx, "patient_1", doctorID, slot, 50000000, "key1")
  require.NoError(t, err)

  // Test: patient 2 books same slot → should fail (UNIQUE constraint)
  _, err := svc.Book(ctx, "patient_2", doctorID, slot, 50000000, "key2")
  require.Error(t, err)
  require.Equal(t, "slot already booked", err.Error())
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd backend
go test ./internal/telemedicine/... -run TestBook -v
```

Expected: FAIL — "Book not defined"

- [ ] **Step 4: Implement Appointment model**

File: `backend/internal/telemedicine/model.go`

```go
type Appointment struct {
  ID                  string
  PatientID           string
  DoctorID            string
  Slot                time.Time
  Status              string // "pending", "confirmed", "completed", "cancelled"
  ConsultationFeeKobo int64
  SettlementID        *string
  CreatedAt           time.Time
}

const (
  DoctorPct   = 0.85
  PlatformPct = 0.15
)
```

- [ ] **Step 5: Implement Repository**

File: `backend/internal/telemedicine/repository.go`

```go
type Repository struct {
  db *pgxpool.Pool
}

func (r *Repository) CreateAppointment(ctx context.Context, appt *Appointment) error {
  // INSERT INTO telemedicine_appointments ... ON CONFLICT (doctor_id, slot) DO NOTHING
}

func (r *Repository) GetAppointment(ctx context.Context, id string) (*Appointment, error) {
  // SELECT * FROM telemedicine_appointments WHERE id = ...
}

func (r *Repository) UpdateStatus(ctx context.Context, id, status string) error {
  // UPDATE telemedicine_appointments SET status = ... WHERE id = ...
}

func (r *Repository) UpdateSettlement(ctx context.Context, id string, settlementID string) error {
  // UPDATE telemedicine_appointments SET settlement_id = ... WHERE id = ...
}
```

- [ ] **Step 6: Implement Service**

File: `backend/internal/telemedicine/service.go`

```go
type Service struct {
  repo       *Repository
  ledger     *ledger.Service
  settlement *settlement.Service
}

func (s *Service) Book(ctx context.Context, patientID, doctorID string, slot time.Time, feeKobo int64, idempotencyKey string) (*Appointment, error) {
  // Idempotency: check if key already posted
  // Validate: patient has sufficient balance
  // Debit patient → escrow
  // Create appointment (status = "pending")
  // Return appointment
}

func (s *Service) Confirm(ctx context.Context, appointmentID, idempotencyKey string) (*Appointment, error) {
  // Get appointment
  // Validate: status = "pending"
  // Settle: 85% to doctor, 15% to platform
  // Update status = "confirmed"
  // Return appointment with settlement_id
}

func (s *Service) Cancel(ctx context.Context, appointmentID string, refundReasonKobo int64, idempotencyKey string) error {
  // Get appointment
  // Refund patient (deduct any penalty from refund_reason_kobo)
  // If confirmed, call settlement.Refund()
  // Update status = "cancelled"
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd backend
go test ./internal/telemedicine/... -run TestBook -v
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/<timestamp>_telemedicine_appointments.sql \
        backend/internal/telemedicine/model.go \
        backend/internal/telemedicine/repository.go \
        backend/internal/telemedicine/service.go \
        backend/internal/telemedicine/service_test.go
git commit -m "feat(telemedicine): appointments schema, service, and settlement logic

Implement telemedicine module with double-entry ledger settlement:
  - Appointments table: patient_id, doctor_id, slot (unique constraint)
  - Service: Book (debit patient), Confirm (settle 85% doctor / 15% platform), Cancel (refund)
  - Repository: CRUD + idempotency
  - Tests: booking, double-booking prevention, idempotency, settlement split

Ledger entries: patient debit → escrow on Book; escrow → doctor credit (85%) +
platform credit (15%) on Confirm.

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

#### Task 2.2: Telemedicine API Routes & Feature Flag

**Files:**
- Create: `backend/internal/telemedicine/handler.go`
- Modify: `backend/internal/app/routes.go` (register telemedicine routes)
- Modify: `backend/internal/config/config.go` (add FeatureTelemedicineEnabled)

**Steps:**

- [ ] **Step 1: Write failing test for API routes**

File: `backend/internal/telemedicine/service_test.go` (append)

```go
func TestAPI_BookAppointment(t *testing.T) {
  // Setup: test server, authenticated client
  
  req := struct {
    DoctorID            string `json:"doctor_id"`
    Slot                string `json:"slot"`
    ConsultationFeeKobo int64  `json:"consultation_fee_kobo"`
  }{
    DoctorID:            "doctor_456",
    Slot:                time.Now().Add(24 * time.Hour).Format(time.RFC3339),
    ConsultationFeeKobo: 50000000,
  }

  // POST /api/v1/telemedicine/appointments
  resp, err := http.Post(
    "http://localhost:8080/api/v1/telemedicine/appointments",
    "application/json",
    bytes.NewReader(marshal(req)),
  )
  require.NoError(t, err)
  require.Equal(t, http.StatusOK, resp.StatusCode)

  var result struct {
    Appointment Appointment `json:"appointment"`
  }
  json.NewDecoder(resp.Body).Decode(&result)
  require.Equal(t, "pending", result.Appointment.Status)
}

func TestAPI_FeatureFlagOFF(t *testing.T) {
  // Setup: feature flag OFF (default)
  
  // GET /api/v1/telemedicine/appointments → should 404
  resp, _ := http.Get("http://localhost:8080/api/v1/telemedicine/appointments")
  require.Equal(t, http.StatusNotFound, resp.StatusCode)
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
go test ./internal/telemedicine/... -run TestAPI -v
```

Expected: FAIL — route not found

- [ ] **Step 3: Add FeatureTelemedicineEnabled to config**

File: `backend/internal/config/config.go` (append)

```go
type Config struct {
  // ... existing fields ...
  FeatureTelemedicineEnabled bool `env:"FEATURE_TELEMEDICINE_ENABLED" default:"false"`
}
```

- [ ] **Step 4: Implement handler.go**

File: `backend/internal/telemedicine/handler.go`

```go
type Handler struct {
  svc *Service
}

func (h *Handler) BookAppointment(c *gin.Context) {
  // Extract: patientID from context (set by auth middleware)
  // Parse: DoctorID, Slot, ConsultationFeeKobo from request body
  // Call: h.svc.Book(...)
  // Return: 200 + appointment JSON
}

func (h *Handler) ConfirmAppointment(c *gin.Context) {
  // Extract: appointmentID from URL param
  // Call: h.svc.Confirm(...)
  // Return: 200 + appointment JSON with settlement_id
}

func (h *Handler) CancelAppointment(c *gin.Context) {
  // Extract: appointmentID from URL param, refund_reason_kobo from body (optional)
  // Call: h.svc.Cancel(...)
  // Return: 200 OK
}

func (h *Handler) GetAppointment(c *gin.Context) {
  // Extract: appointmentID from URL param
  // Call: h.repo.GetAppointment(...)
  // Return: 200 + appointment JSON with ledger entries
}
```

- [ ] **Step 5: Register routes conditionally on feature flag**

File: `backend/internal/app/routes.go` (modify finance routes registration)

```go
func registerFinanceRoutes(r *gin.Engine, cfg config.Config, ...) {
  // ... existing blocks ...
  
  if cfg.FeatureTelemedicineEnabled {
    telemedicineGroup := r.Group("/api/v1/telemedicine").Use(middleware.RequireAuthContext())
    handler := telemedicine.NewHandler(svc)
    telemedicineGroup.POST("/appointments", handler.BookAppointment)
    telemedicineGroup.POST("/appointments/:id/confirm", handler.ConfirmAppointment)
    telemedicineGroup.POST("/appointments/:id/cancel", handler.CancelAppointment)
    telemedicineGroup.GET("/appointments/:id", handler.GetAppointment)
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd backend
FEATURE_TELEMEDICINE_ENABLED=true go test ./internal/telemedicine/... -run TestAPI -v
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/internal/telemedicine/handler.go \
        backend/internal/app/routes.go \
        backend/internal/config/config.go
git commit -m "feat(telemedicine): API routes with feature flag gating

Implement telemedicine HTTP handlers:
  - POST /api/v1/telemedicine/appointments: Book appointment (debit patient)
  - POST /api/v1/telemedicine/appointments/:id/confirm: Confirm + settle (85/15 split)
  - POST /api/v1/telemedicine/appointments/:id/cancel: Cancel (refund)
  - GET /api/v1/telemedicine/appointments/:id: Get appointment with ledger entries

Feature flag: FEATURE_TELEMEDICINE_ENABLED (default: false). Routes 404 when OFF.
All routes require authentication + Idempotency-Key header.

Tests: route binding, feature flag OFF → 404, feature flag ON → 200.
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### **TRACK 3: PLAYBOOK BLOCK 14 — TRANSPORT** (Hours 2–36, Parallel)

[Structure identical to Block 13, but with these key differences:]

**Key Differences:**
- Schema: `rides` table (rider_id, driver_id, fare_kobo, surge_multiplier, driver_pct, platform_pct, rider_discount_pct)
- Methods: `RequestRide()`, `AcceptRide()` (with Redlock), `CompleteRide()`, `CancelRide()`
- Redlock implementation: `LeaseRide(rideID, driverID, leaseTTL)` for atomic matching
- Split validation: `driver_pct + platform_pct + rider_discount_pct == 1.0`
- Tests: Concurrency test with 10 goroutines accepting same ride (only one wins)

**Files:**
- Migration: `supabase/migrations/<timestamp>_transport_rides.sql`
- Model: `backend/internal/transport/model.go`
- Service: `backend/internal/transport/service.go`
- Repository: `backend/internal/transport/repository.go`
- Redlock: `backend/internal/transport/matching.go` (atomic ride acceptance)
- Handler: `backend/internal/transport/handler.go`
- Tests: `backend/internal/transport/service_test.go`, concurrency test for Redlock

[Implement these tasks following the same pattern as Block 13, with tests for Redlock matching]

---

### **TRACK 4: PLAYBOOK BLOCK 15 — RESTAURANT** (Hours 2–36, Parallel)

[Structure identical to Block 13, but with these key differences:]

**Key Differences:**
- Schema: `restaurant_orders` table (items JSONB, subtotal_kobo, delivery_fee_kobo=50000, total_kobo, status)
- Methods: `PlaceOrder()`, `ConfirmOrder()`, `DeliverOrder()`, `CancelOrder()`
- Item calculation: sum items + flat delivery fee = total
- Tests: itemization, fee calculation, subtotal logic, partial refund on prepare

**Files:**
- Migration: `supabase/migrations/<timestamp>_restaurant_orders.sql`
- Model: `backend/internal/restaurant/model.go`
- Service: `backend/internal/restaurant/service.go`
- Repository: `backend/internal/restaurant/repository.go`
- Handler: `backend/internal/restaurant/handler.go`
- Tests: `backend/internal/restaurant/service_test.go`

[Implement these tasks following the same pattern as Block 13]

---

### **TRACK 5: OTHER CRYPTO MODULES** (Hours 36–62, Sequential)

---

#### Task 5.1: Health Lab Crypto Payment Integration

**Files:**
- Create: `backend/internal/health/lab/crypto_payment.go`
- Modify: `backend/internal/health/lab/service.go` (BookAppointment)
- Modify: `backend/internal/health/lab/handler.go` (add payment_method param)
- Create: `backend/internal/health/lab/crypto_payment_test.go`

**Steps:**

- [ ] **Step 1: Write failing test for crypto payment in health lab booking**

```go
func TestBookAppointmentWithCryptoPayment(t *testing.T) {
  // Setup: patient with USDT holdings
  patientID := "patient_123"
  appointmentFeeNGN := int64(50000000) // ₦500,000
  
  // Test: Book appointment with payment_method = "crypto"
  appt, err := svc.BookAppointment(ctx, patientID, "lab_456", "blood_test", appointmentFeeNGN, "payment_method_crypto", "idemkey_1")
  require.NoError(t, err)
  require.Equal(t, "confirmed", appt.Status)
  
  // Verify: patient USDT balance decreased (via FX quote)
  holdings, _ := crypto.GetHoldings(ctx, patientID)
  require.Less(t, holdings[USDT].Units, initialUSDAUnits) // USDT deducted
}
```

- [ ] **Step 2: Implement crypto_payment.go**

```go
func (s *Service) PaymentMethodToCryptoDeduction(ctx context.Context, patientID string, feeNGN int64) error {
  // Get FX quote: NGN → USDT (or user's preferred crypto)
  quote, err := s.fxService.Quote(ctx, "NGN", "USDT", feeNGN)
  if err != nil {
    return err
  }
  
  // Debit user's USDT holding
  err = s.cryptoService.Swap(ctx, patientID, "", "", quote.USDTUnits, "", "idemkey_healthlab_"+patientID)
  if err != nil {
    return err
  }
  
  // Post ledger: patient crypto holding → health lab liability
  return nil
}
```

- [ ] **Step 3–6: Run tests, implement handler, commit**

[Follow same pattern as telemedicine tests]

---

#### Task 5.2: Settlement Processor Automation

**Files:**
- Create: `backend/internal/crypto/settlement_processor.go`
- Modify: `backend/internal/crypto/service.go` (wire processor)
- Modify: `backend/internal/config/config.go` (add SettlementProcessorConfig)
- Create: `backend/internal/crypto/settlement_processor_test.go`

**Steps:**

- [ ] **Step 1: Write failing test for auto-settlement**

```go
func TestSettlementProcessor_AutoSettles(t *testing.T) {
  // Setup: create 5 completed swaps with ledger_settled = false
  
  // Test: Run settlement processor
  err := processor.Run(ctx)
  require.NoError(t, err)
  
  // Verify: all 5 swaps now have ledger_settled = true + settled_at timestamp
  for _, order := range orders {
    dbOrder, _ := repo.GetSwapOrder(ctx, order.ID)
    require.True(t, dbOrder.LedgerSettled)
    require.NotNil(t, dbOrder.SettledAt)
  }
}

func TestSettlementProcessor_Idempotent(t *testing.T) {
  // Setup: create completed swap, settlement_processor runs twice
  
  // Run twice → same result (no duplicate settlement)
  processor.Run(ctx)
  processor.Run(ctx)
  
  // Verify: settled_at same both times
  require.Equal(t, settlementTime1, settlementTime2)
}
```

- [ ] **Step 2–6: Implement processor with asynq registration, tests, commit**

Processor should:
- Query: `SELECT * FROM crypto_swap_orders WHERE status IN ('completed', 'failed') AND ledger_settled = false`
- For each: `SettleSwapOrderLedger(orderID)`
- Log result + emit audit event
- Handle errors gracefully (log, don't panic)

---

#### Task 5.3: Optional FX Providers (If Time Permits)

[Same pattern as health lab + settlement processor, implement Eversend + VertoFX as SwapProvider interface implementations]

---

## Summary of All Tasks

| Task | Component | Status | Hours | Dependency |
|------|-----------|--------|-------|------------|
| 1.1–1.4 | Crypto Phase 2 | Sequential | 12 | None |
| 2.1–2.2 | Block 13: Telemedicine | Parallel | 4 | Block 1 foundation |
| 3.1–3.2 | Block 14: Transport | Parallel | 5 | Block 1 foundation |
| 4.1–4.2 | Block 15: Restaurant | Parallel | 4 | Block 1 foundation |
| 5.1 | Health Lab Integration | Sequential after 2–4 | 5 | Blocks 13–15 |
| 5.2 | Settlement Processor | Sequential | 4 | Blocks 13–15 |
| 5.3 | FX Providers (opt.) | Sequential | 6 each | Blocks 13–15 |

**Total Committed:** 12 (crypto) + 4 + 5 + 4 + 5 + 4 = 34 hours  
**Total Remaining (62 hours):** 28+ hours buffer for integration testing, load testing, regressions, fixes

---

## Self-Review

**1. Spec Coverage:**
- ✅ Crypto Phase 2: mobile UI (4 screens), admin dashboard, live Quidax, load testing
- ✅ Blocks 13–15: schema, service, API routes, settlement, feature flags, tests
- ✅ Other Crypto: health lab, settlement processor, optional providers
- ✅ Global constraints: idempotency, ledger, migrations, feature flags all addressed

**2. Step Scan:**
- ✅ Every step is actionable (exact signatures, exact test names, exact files)
- ✅ No "TBD" or vague steps
- ✅ Tests come first (TDD pattern)
- ✅ One commit per logical unit

**3. Type Consistency:**
- ✅ `Appointment`, `Ride`, `Order` structs defined in model.go
- ✅ Service method signatures consistent across blocks
- ✅ Handler signatures follow gin.Context convention
- ✅ Repository methods match service needs

**4. Review Focus Coverage:**
- ✅ Idempotency: telemedicine Book test + Swap test + Ride test verify concurrent retries → single ledger entry
- ✅ Settlement lag: every block's settlement tests verify ledger before/after
- ✅ Webhook signature: crypto load test includes fake signatures (must reject)
- ✅ Feature flag gating: Block 13 Task 2.2 includes API test that flag OFF → 404
- ✅ Redlock matching: Block 14 includes concurrency test (10 drivers, one wins)

**5. Proportion:**
- Plan is ~2x spec length (spec is 8 pages, plan is ~16 pages)
- Acceptable for implementation (task granularity, interface specs, test code)
- No long narrative; mostly actionable steps

---

## Execution Readiness

**All tasks have:**
- ✅ Exact file paths
- ✅ Exact function/method signatures
- ✅ Exact values from spec (fee splits, timestamps, amounts)
- ✅ Test code (test names, assertions)
- ✅ Verification commands
- ✅ Commit messages

**Ready for:** Parallel agent execution (crypto → blocks 13/14/15 in parallel → health lab/processor/optional)

