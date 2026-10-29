# Phase 2 Implementation Design: Crypto Phase 2 + Playbook Blocks 13–15 + Other Crypto

**Date:** 2026-10-28  
**Target Completion:** 2026-11-01 EOD  
**Time Available:** 62 hours (Approach B: serial crypto + parallel blocks)  
**Status:** Design Approved, Ready for Implementation Planning

---

## Executive Summary

**Phase 2 orchestrates three parallel tracks to maximize wall-clock efficiency while maintaining quality:**

1. **Crypto Phase 2** (Hours 0–12, focused): Mobile UI swap execution, admin reconciliation dashboard, live Quidax sandbox integration, load testing (100 concurrent swaps)
2. **Playbook Blocks 13–15** (Hours 2–36, parallel): Telemedicine booking, transport ride-hailing, restaurant delivery—each a complete money-path module with ledger settlement
3. **Other Crypto Modules** (Hours 36–62, fill time): Health lab integration, settlement processor automation, additional payment providers (Eversend, VertoFX)

**All code is feature-flagged OFF by default.** No modules enable automatically; each requires explicit config flag to activate. All tests green before merge.

---

## Track 1: Crypto Phase 2 (Hours 0–12)

### Objective
Complete mobile user interface for swap trading, admin console for reconciliation visibility, live Quidax sandbox connectivity, and load test verification under peak concurrency.

### 1.1 Mobile UI: Swap Execution Screens

**Location:** `mobile-app/reactnative/app/crypto/swap/`

**Screens (3–4 total):**

1. **SwapQuoteDisplay** (existing quote review)
   - Asset pair display (FROM → TO)
   - Quote amount, exchange rate, fees, spread
   - Expiry countdown (15 seconds, red at <5s)
   - CTA: "Confirm Swap" or "Get New Quote"
   - Error state: Quote expired → refresh button

2. **SwapConfirmation** (new)
   - Display final amounts, fees, receive amount
   - Slippage tolerance warning (if user set custom)
   - Confirm / Cancel buttons
   - Loading state during ConfirmQuotation API call

3. **SwapExecution** (in-flight)
   - "Processing..." indicator
   - Transaction ID display (once received from API)
   - Status polling: "Waiting for provider confirmation..."
   - Timeout handling: show error after 30s no webhook

4. **SwapResult** (terminal state)
   - Success: "Swap completed! You received X units of TO_ASSET"
     - Ledger entry ref, settlement status from admin API
     - "View Details" → opens reconciliation data
   - Failure: "Swap failed: [error reason]"
     - Refund status (if applicable)
     - Support contact CTA

**Integration Points:**
- `SwapQuote` API call (existing) returns `quotation_id` + `expires_at`
- `Swap` API call (existing) consumes `quotation_id`, posts ledger entries, returns order with status
- Webhook inbox (CR-013) updates order status asynchronously → mobile polls or listens for status change
- Admin reconciliation API (new) provides settlement confirmation for display in SwapResult

**Testing:**
- Unit: quote expiry countdown, error state rendering
- Integration: quote → confirm → loading → result (mock webhook)
- E2E: sandbox API end-to-end with real Quidax quote/execution

---

### 1.2 Admin Dashboard: Reconciliation Console

**Location:** `frontend-admin/app/admin/crypto/reconciliation.tsx`

**Scope:** Read-only drift detection and settlement status visibility (no admin actions; backend `ReconcileSwapOrders` service provides data)

**Sections:**

1. **Summary Cards (Header)**
   - Total orders (all time)
   - Reconciled orders (executing + completed+settled)
   - Drift orders (status mismatch or settlement lag)
   - Failed orders (terminal, no settlement needed)

2. **Time Range Filter**
   - Date picker (last 24h, last 7d, custom range)
   - Auto-refresh toggle (every 30s if enabled)

3. **Drift Report Table (Main)**
   - Columns: OrderID | UserID | Status | LedgerSettled | ProviderStatus | SettledAt | Drift Reason
   - Color coding:
     - Green: no drift, reconciled
     - Yellow: executing (no drift, waiting for webhook)
     - Orange: drift detected (settlement lag, status mismatch)
     - Red: failed orders
   - Sortable by any column
   - Filterable by status, drift type

4. **Per-Order Detail Panel** (click row)
   - Full order history (created_at, status updates, settlement timestamp)
   - Ledger entries (debit/credit legs, amounts)
   - Quidax provider status (raw webhook data)
   - Manual drift note entry (for audit trail; admin logs "reason for exception")

5. **Export & Monitoring**
   - "Download CSV" button (all reconciliation data for offline audit)
   - Link to Grafana/observability for webhook latency trends

**API Endpoint (Backend):**
```
GET /api/v1/admin/crypto/reconciliation?details=true&start_date=2026-10-28&end_date=2026-10-29

Response: ReconciliationReport {
  run_at: timestamp,
  total_orders: int,
  reconciled_orders: int,
  drift_orders: int,
  failed_orders: int,
  orders: [OrderReconciliationRow],  // if details=true
  summary: string
}
```

**Testing:**
- Unit: time filter logic, drift detection rule rendering
- Integration: API returns correct reconciliation data; UI renders all states
- E2E: populate with Phase 1 test data, verify drift detection displays correctly

---

### 1.3 Live Quidax Integration

**Current State:**
- Sandbox credentials configurable via env vars (`CRYPTO_QUIDAX_API_KEY`, `CRYPTO_QUIDAX_SECRET`)
- Provider adapter implements `SwapProvider` interface
- Mock provider available for dev/test

**Activation:**
1. **Obtain Quidax sandbox credentials** (from Quidax dashboard)
2. **Set environment variables:**
   ```bash
   export CRYPTO_QUIDAX_API_KEY=<key>
   export CRYPTO_QUIDAX_SECRET=<secret>
   export CRYPTO_QUIDAX_WEBHOOK_SECRET=<webhook_secret>
   ```
3. **Backend startup validation:**
   - Health check: `GET /api/health` includes crypto module status
   - If Quidax credentials present, attempt API ping on startup → log success/failure
   - Fallback to mock provider if credentials unset or unreachable
4. **Enable feature flag:**
   ```bash
   export FEATURE_CRYPTO_ENABLED=true
   ```

**Testing:**
- Sandbox connectivity: quote API returns live Quidax rates (not mock)
- Webhook delivery: simulate Quidax webhook to verify signature validation + status update
- Fallback: unset credentials → verify mock provider takes over gracefully

---

### 1.4 Load Testing

**Objective:** Verify system stability under 100 concurrent swap executions; measure latency, throughput, ledger integrity.

**Test Scenario:**
- 100 concurrent users
- Each user: `SwapQuote` (1s think time) → `Swap` (confirm immediately) → wait for webhook
- Measure: latency (p50, p95, p99), throughput (swaps/sec), webhook delivery latency, ledger balance verification
- Duration: 5-minute steady state

**Tools:**
- `k6` or `Apache JMeter` for load generation
- Verify ledger: query `crypto_ledger_entries` table → confirm all swaps post balanced entries (debit = credit per swap)

**Success Criteria:**
- p95 latency < 2s (API response time)
- Throughput > 20 swaps/sec
- Webhook delivery within 5s
- Zero ledger imbalances
- Zero 5xx errors under load

**Report Output:**
- Latency histogram, throughput graph, error rate
- Ledger audit: total debits = total credits
- Recommendation: ready for production or needs optimization

**Definition of Done (Crypto Phase 2):**
- ✅ Mobile swap screens implemented + E2E tested
- ✅ Admin reconciliation dashboard rendering correctly
- ✅ Live Quidax credentials validated at startup
- ✅ Load test: 100 concurrent swaps, p95 < 2s, ledger balanced
- ✅ All code merged, tests green, features flagged OFF

---

## Track 2: Playbook Blocks 13–15 (Hours 2–36, Parallel)

### Execution
All three blocks run in parallel (independent agents), starting at hour 2 (after Crypto Phase 2 foundations locked). Each follows the same pattern:
1. Schema (Supabase migration)
2. Service layer (business logic + settlement)
3. API routes
4. Feature flag
5. Tests

---

### 2.1 Block 13: Telemedicine Booking & Settlement (4 hours)

**Schema (Supabase migration):**
```sql
CREATE TABLE telemedicine_appointments (
  id UUID PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES platform_users(id),
  doctor_id UUID NOT NULL REFERENCES platform_users(id),
  slot TIMESTAMP NOT NULL,
  status TEXT CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  consultation_fee_kobo INT8 NOT NULL,
  settlement_id UUID REFERENCES finance_settlement(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(doctor_id, slot)
);
```

**Service (`backend/internal/telemedicine/service.go`):**
- `Book(ctx, patientID, doctorID, slot, consultationFeeKobo, idempotencyKey) (*Appointment, error)`
  - Validate: patient has sufficient balance, slot not double-booked
  - Debit patient wallet → escrow
  - Create appointment record, status = "pending"
  - Return order with settlement_id = nil (pending confirmation)

- `Confirm(ctx, appointmentID, idempotencyKey) (*Appointment, error)`
  - Validate: appointment exists and status = "pending"
  - Call `settlement.Service.Settle()` with split: 85% doctor, 15% platform
  - Update appointment status = "confirmed"
  - Return appointment with settlement_id populated

- `Cancel(ctx, appointmentID, refundReasonKobo, idempotencyKey) error`
  - Validate: appointment not yet completed
  - Refund patient (deduct any penalty from refund_reason)
  - Call `settlement.Refund(settlementID)` if confirmed
  - Update status = "cancelled"

- `Settle(ctx, appointmentID) error`
  - Query settlement by appointment
  - Verify status = "completed"
  - Call settlement.Service.Finalize() if not already settled

**API Routes:**
```
POST /api/v1/telemedicine/appointments
  Body: { patient_id, doctor_id, slot, consultation_fee_kobo }
  Returns: Appointment

POST /api/v1/telemedicine/appointments/:id/confirm
  Body: {} (or optional notes)
  Returns: Appointment with settlement_id

POST /api/v1/telemedicine/appointments/:id/cancel
  Body: { refund_reason_kobo? }
  Returns: 200 OK

GET /api/v1/telemedicine/appointments/:id
  Returns: Appointment with ledger entries + settlement details
```

**Feature Flag:**
```go
if cfg.FeatureTelemedicineEnabled {
  // Register telemedicine routes
}
```

**Testing:**
- Unit: fee split calculation, refund logic
- Integration: booking debits, confirmation credits 85% doctor + 15% platform, ledger balanced
- Double-booking same slot → 409 Conflict
- Concurrent confirm same appointment → only one succeeds (idempotency)
- `go test ./internal/telemedicine/... -race` passing

---

### 2.2 Block 14: Transport (Ride-Hailing) (5 hours)

**Schema:**
```sql
CREATE TABLE transport_rides (
  id UUID PRIMARY KEY,
  rider_id UUID NOT NULL REFERENCES platform_users(id),
  driver_id UUID REFERENCES platform_users(id),
  pickup_lat FLOAT8, pickup_lon FLOAT8,
  dropoff_lat FLOAT8, dropoff_lon FLOAT8,
  status TEXT CHECK (status IN ('requested', 'matched', 'in_transit', 'completed', 'cancelled')),
  base_fare_kobo INT8 DEFAULT 150000,
  surge_multiplier FLOAT8 DEFAULT 1.0,
  final_fare_kobo INT8,
  driver_pct FLOAT8, platform_pct FLOAT8, rider_discount_pct FLOAT8,
  settlement_id UUID REFERENCES finance_settlement(id),
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);
```

**Service (`backend/internal/transport/service.go`):**
- `RequestRide(ctx, riderID, pickupLat, pickupLon, dropoffLat, dropoffLon, idempotencyKey) (*Ride, error)`
  - Calculate fare: `base_fare_kobo * surge_multiplier`
  - Validate: driver_pct + platform_pct + rider_discount_pct = 1.0
  - Debit rider wallet → escrow
  - Create ride, status = "requested"

- `AcceptRide(ctx, rideID, driverID, idempotencyKey) (*Ride, error)`
  - Use Redlock: `LOCK ride:${rideID}` (exclusive, 30s TTL)
  - Verify: ride status = "requested", no other driver accepted
  - Update: driver_id, status = "matched", release lock
  - If lock contention → another driver won, return error

- `CompleteRide(ctx, rideID, finalFareKobo, idempotencyKey) (*Ride, error)`
  - Validate: ride status = "in_transit"
  - Adjust fare if final differs from estimate
  - Settle: split final_fare_kobo per driver_pct, platform_pct, rider_discount_pct
  - Update status = "completed"

- `CancelRide(ctx, rideID, idempotencyKey) error`
  - If status = "requested" → full refund
  - If status = "matched" or "in_transit" → partial refund (e.g., 50% cancellation fee)
  - Call settlement.Refund() if applicable

**API Routes:**
```
POST /api/v1/transport/rides
  Body: { pickup_lat, pickup_lon, dropoff_lat, dropoff_lon }
  Returns: Ride with estimated_fare_kobo

POST /api/v1/transport/rides/:id/accept
  Body: { driver_id }
  Returns: Ride

POST /api/v1/transport/rides/:id/complete
  Body: { final_fare_kobo }
  Returns: Ride with settlement details

POST /api/v1/transport/rides/:id/cancel
  Body: {}
  Returns: 200 OK
```

**Feature Flag:**
```go
if cfg.FeatureTransportEnabled {
  // Register transport routes
}
```

**Testing:**
- Unit: surge multiplier, split calculation, fare rounding
- Concurrency: 10 drivers simultaneously accept same ride → only one wins (Redlock)
- Refund logic: cancel before match (100%), cancel after match (50% fee)
- Ledger: all swaps post balanced entries
- `go test ./internal/transport/... -race` passing

---

### 2.3 Block 15: Restaurant Delivery (4 hours)

**Schema:**
```sql
CREATE TABLE restaurant_orders (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES platform_users(id),
  restaurant_id UUID NOT NULL,
  items JSONB NOT NULL, -- [{item_id, qty, price_kobo}, ...]
  subtotal_kobo INT8 NOT NULL,
  delivery_fee_kobo INT8 DEFAULT 50000,
  total_kobo INT8 NOT NULL,
  status TEXT CHECK (status IN ('placed', 'confirmed', 'prepared', 'delivered', 'cancelled')),
  settlement_id UUID REFERENCES finance_settlement(id),
  created_at TIMESTAMP DEFAULT NOW(),
  delivered_at TIMESTAMP
);
```

**Service (`backend/internal/restaurant/service.go`):**
- `PlaceOrder(ctx, customerID, restaurantID, items []Item, idempotencyKey) (*Order, error)`
  - Calculate: subtotal = sum(items), total = subtotal + delivery_fee
  - Debit customer wallet → escrow
  - Create order, status = "placed"

- `ConfirmOrder(ctx, orderID, idempotencyKey) (*Order, error)`
  - Validate: status = "placed"
  - Update status = "confirmed"
  - Post settlement: customer debit finalized, restaurant/platform split

- `DeliverOrder(ctx, orderID, idempotencyKey) (*Order, error)`
  - Validate: status = "prepared"
  - Call settlement.Settle() if not already settled
  - Update status = "delivered", delivered_at = now

- `CancelOrder(ctx, orderID, refundReasonKobo, idempotencyKey) error`
  - Full refund if not yet prepared
  - Partial refund if already prepared (50% retained)

**API Routes:**
```
POST /api/v1/restaurant/orders
  Body: { restaurant_id, items: [{item_id, qty}, ...] }
  Returns: Order with total_kobo + delivery_fee_kobo

POST /api/v1/restaurant/orders/:id/confirm
  Body: {}
  Returns: Order with settlement_id

POST /api/v1/restaurant/orders/:id/deliver
  Body: {}
  Returns: Order with delivered_at timestamp

POST /api/v1/restaurant/orders/:id/cancel
  Body: { refund_reason_kobo? }
  Returns: 200 OK
```

**Feature Flag:**
```go
if cfg.FeatureRestaurantEnabled {
  // Register restaurant routes
}
```

**Testing:**
- Unit: itemization, fee calculation, subtotal logic
- Integration: order placed → confirmed → delivered, ledger balanced
- Refund scenarios: cancel before prepared (100%), after prepared (50%)
- Concurrent confirmations of same order → idempotency
- `go test ./internal/restaurant/... -race` passing

---

### 2.4 Cross-Block Integration (Hour 24–36)

- All three blocks run independently (no hard dependencies)
- Each block: service layer 100%, API routes wired, tests green, feature flag OFF
- No inter-block payments yet (deferred to Phase 3)
- Smoke test: telemedicine booking → transport ride → restaurant order (all feature-flagged OFF, no actual flow)

---

## Track 3: Other Crypto Modules (Hours 36–62)

### 3.1 Health Lab Integration (4–5 hours)

**Objective:** Integrate crypto wallet payment into existing health lab booking flow.

**Current State:**
- `backend/internal/health/lab/` exists with appointment schema + service
- Booking currently expects NGN fiat payment only

**Changes:**
- Add `payment_method` field to appointment: "fiat" | "crypto"
- If `payment_method == "crypto"`:
  - Call FX service: `forex.Quote(NGN → supported_crypto)` (e.g., NGN → USDT)
  - Deduct from user's crypto holding via swap
  - Credit to lab's settlement account
- Ledger: single balanced entry (debit crypto, credit lab liability)

**Files:**
- `service.go`: Update `BookAppointment()` to handle crypto payment
- `handler.go`: Add `payment_method` parameter to booking request
- `fx_service.go`: Reuse existing FX quotes
- Tests: booking with crypto payment, fee conversion

**Feature Flag:** Reuse `FEATURE_HEALTH_LAB_ENABLED` (no new flag)

---

### 3.2 Settlement Processor Automation (3–4 hours)

**Objective:** Background job to auto-settle swap orders in terminal state.

**Implementation:**
- Create `backend/internal/crypto/settlement_processor.go`
- Register asynq task: `CronSettleSwaps` (every 5 minutes)
- Query: `SELECT * FROM crypto_swap_orders WHERE status IN ('completed', 'failed') AND ledger_settled = false`
- For each order:
  - Call `service.SettleSwapOrderLedger(orderID)`
  - Log result (success, already settled, error)
  - Emit audit event
- Monitor: log settlement latency, failures

**Configuration:**
```go
type SettlementProcessorConfig struct {
  Enabled bool          `env:"CRYPTO_SETTLEMENT_PROCESSOR_ENABLED" default:"false"`
  Interval time.Duration `env:"CRYPTO_SETTLEMENT_INTERVAL" default:"5m"`
}
```

**Testing:**
- Create 5 completed swaps, run processor, verify all settle
- Run twice (idempotency check), no duplicates
- Error handling: DB error, already-settled, etc.

---

### 3.3 Additional Providers (5–6 hours each, optional)

If time permits after health lab + processor:

**Option A: Eversend Adapter** (FX provider)
- Implement `SwapProvider` interface for Eversend API
- Quote + execution flows
- Webhook signature validation (different secret)
- Tests: quote, execute, webhook

**Option B: VertoFX Adapter** (international transfers)
- Similar pattern: SwapProvider implementation
- Support payout to bank account
- Tests: quote, execute

**Note:** These are lower priority; implement only if time permits.

---

## Testing & Verification Strategy

### Unit Tests
- All service methods: inputs → outputs, error cases
- Ledger: ensure every money mutation posts balanced entries
- Idempotency: rerun same request → same result, no duplicates

### Integration Tests
- Mock database: in-memory Postgres or `testcontainers`
- Service + repository layer together
- Verify data persistence + queries

### E2E Tests
- Crypto Phase 2: sandbox Quidax API end-to-end
- Blocks 13–15: full booking → settlement flow
- Load test (Crypto Phase 2): 100 concurrent operations

### Regression Suite
- All Phase 1 crypto tests must still pass
- Playbook block tests must not break existing modules

### Security Audit
- Webhook signature verification (HMAC, constant-time comparison)
- Idempotency key enforcement (no duplicate money mutations)
- Authorization (RBAC checks on sensitive endpoints)
- Input validation (amounts, addresses, user IDs)

---

## Feature Flags (All OFF by Default)

```go
type FeatureFlags struct {
  CryptoEnabled                bool   `env:"FEATURE_CRYPTO_ENABLED" default:"false"`
  TelemedicineEnabled          bool   `env:"FEATURE_TELEMEDICINE_ENABLED" default:"false"`
  TransportEnabled             bool   `env:"FEATURE_TRANSPORT_ENABLED" default:"false"`
  RestaurantEnabled            bool   `env:"FEATURE_RESTAURANT_ENABLED" default:"false"`
  HealthLabCryptoPayment       bool   `env:"FEATURE_HEALTH_LAB_CRYPTO_PAYMENT" default:"false"`
  CryptoSettlementProcessorEn  bool   `env:"CRYPTO_SETTLEMENT_PROCESSOR_ENABLED" default:"false"`
}
```

**Gating:** Each module's routes only register if corresponding flag is true. No hardcoded feature detection; explicit config.

---

## Success Criteria

### Crypto Phase 2
- ✅ Mobile swap screens: quote display, confirmation, execution, result
- ✅ Admin reconciliation dashboard: live drift report
- ✅ Live Quidax: sandbox credentials validated, fallback to mock
- ✅ Load test: 100 concurrent swaps, p95 < 2s, zero ledger imbalances
- ✅ All code merged, tests green, features flagged OFF

### Playbook Blocks 13–15
- ✅ Telemedicine: booking → confirmation → settlement (85/15 split)
- ✅ Transport: ride request → driver match (Redlock) → completion → settlement
- ✅ Restaurant: order placement → confirmation → delivery → settlement
- ✅ All blocks: feature-flagged OFF, tests green, no regressions
- ✅ Ledger: every money mutation posts balanced entries

### Other Crypto
- ✅ Health lab: crypto payment integration + tests
- ✅ Settlement processor: auto-settle on schedule + tests
- ✅ Additional providers: (if time permits) Eversend / VertoFX adapters

### Overall
- ✅ All code merged to `feat/payment-method-tracking`
- ✅ `go build ./...` clean, `go test ./... -race` green
- ✅ Regression suite: all Phase 1 + new tests passing
- ✅ Security audit: signatures verified, idempotency enforced, RBAC correct
- ✅ No blockers; ready for sandbox integration testing & compliance review

---

## Timeline Summary

| Phase | Hours | Deliverable |
|-------|-------|-------------|
| Crypto Phase 2 | 0–12 | Mobile UI, admin dashboard, live Quidax, load test report |
| Blocks 13–15 (parallel) | 2–36 | Telemedicine, transport, restaurant (all flagged OFF) |
| Other Crypto | 36–62 | Health lab, settlement processor, (optional) more providers |
| **Remaining Buffer** | **62+** | Testing, integration, final verification, contingency |

---

## Assumptions & Constraints

1. **Crypto Phase 2 is single-threaded (no parallel agents within)** to ensure mobile UI + admin dashboard + load testing are rigorous and complete before moving to blocks
2. **Blocks 13–15 are fully independent** (no inter-block dependencies; can run in parallel)
3. **All blocks use existing ledger/settlement infrastructure** (no new accounting system)
4. **Feature flags are mandatory**: no module activates without explicit env var (safe brownfield deployment)
5. **Deadline is hard**: EOD 2026-11-01; remaining buffer is for integration + final testing, not feature creep

---

## Next Steps (Post-Design Approval)

1. Invoke `superpowers:writing-plans` skill to create detailed implementation plan
2. Partition work into git branches (crypto-phase2, block-13, block-14, block-15, other-crypto)
3. Launch agent tasks per track (serial crypto, parallel blocks)
4. Begin implementation with test-driven development (failing tests first)
5. Continuous integration: daily sync on blockers, 3-day mid-point review

