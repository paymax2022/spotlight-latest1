# CR-012: Trade State Machine & Confirmation Plan

**Status:** Implementation starting  
**Dependency:** CR-009 (Quidax adapter) ✅, CR-010 (asset mapping) ✅, CR-011 (quote service) ✅  
**Unblocks:** CR-013 (Webhook inbox)  
**Estimated effort:** 2–3 days  

---

## Overview

CR-012 integrates the **Quidax ConfirmQuotation** call into the Swap handler and implements a **state machine** for tracking swap execution across async Quidax completion.

**Key changes:**
1. Swap handler accepts quotationID from request
2. Service calls `s.swap.ConfirmQuotation(userID, quotationID)` → swapTransactionID
3. Store swapTransactionID in trade record for polling (CR-013 webhook)
4. Implement state machine: pending → executing → completed/failed
5. TTL enforcement: Quidax rejects expired quotations (422)

---

## Current State (CR-011 Complete)

### SwapQuote Response (from CR-011)
```json
{
    "success": true,
    "quote": {
        "quotation_id": "q_abc123",
        "expires_at": "2026-10-28T16:45:30Z",  // 15-sec TTL
        "provider": "quidax",
        ...
    }
}
```

### Swap Handler (current)
```go
func (h *Handler) Swap(c *gin.Context) {
    // ... request parsing ...
    var req struct {
        FromAssetID string `json:"from_asset_id"`
        ToAssetID   string `json:"to_asset_id"`
        FromUnits   int64  `json:"from_units"`
        QuotationID string `json:"quotation_id,omitempty"`  // ← CR-011 added this
    }
    
    o, err := h.svc.Swap(c.Request.Context(), uid, req.FromAssetID, 
                         req.ToAssetID, req.FromUnits, key)
    // ... response ...
}
```

### Swap Service Method (current)
```go
func (s *Service) Swap(ctx context.Context, userID, fromAssetID, toAssetID string, 
                       fromUnits int64, idemKey string) (*SwapOrder, error) {
    // 1. Validate idempotency key (check for replay)
    // 2. Validate holdings (user has enough to sell)
    // 3. Price the swap (internal pricing)
    // 4. Record order + move holdings (atomically)
    // 5. Post ledger journals (cash legs)
    // 6. Return SwapOrder
}
```

---

## Design: Quidax Trade Confirmation

### New Fields in SwapOrder
```go
type SwapOrder struct {
    // ... existing fields ...
    
    // CR-012: Quidax integration
    QuotationID      string    `json:"quotation_id,omitempty"`    // from SwapQuote
    SwapTransactionID string    `json:"swap_transaction_id,omitempty"` // from ConfirmQuotation
    Status           string    `json:"status"`                   // "pending" → "executing" → "completed"/"failed"
    ProviderStatus   string    `json:"provider_status,omitempty"` // raw status from Quidax
}
```

### State Machine Transitions
```
SwapQuote received (quotation_id, expires_at)
  ↓
Swap handler accepts quotation_id
  ↓
Swap service calls ConfirmQuotation(quotation_id)
  ↓
  ├─ Success (2xx) → swap_transaction_id returned
  │    ↓
  │    Order status = "executing" (async Quidax execution)
  │    Store swap_transaction_id for polling
  │    ↓
  │    [Webhook arrives with status update] (CR-013)
  │    ↓
  │    Order status = "completed" or "failed"
  │
  └─ Error (422 expired, 4xx invalid, 5xx provider error)
       ↓
       Order status = "failed"
       Reason = error message
       No swap_transaction_id (never sent to Quidax)
```

---

## Implementation Steps

### Step 1: Update SwapOrder Model
**File:** `model.go`

Add Quidax fields:
```go
type SwapOrder struct {
    // ... existing fields ...
    QuotationID       string    `json:"quotation_id,omitempty"`
    SwapTransactionID string    `json:"swap_transaction_id,omitempty"`
    ProviderStatus    string    `json:"provider_status,omitempty"`
}
```

### Step 2: Update Swap Service Signature
**File:** `service_ext.go`

Add quotationID parameter:
```go
func (s *Service) Swap(ctx context.Context, userID, fromAssetID, toAssetID string, 
                       fromUnits int64, quotationID string, idemKey string) (*SwapOrder, error)
```

### Step 3: Implement ConfirmQuotation Call
**File:** `service_ext.go`

In Swap method:
```go
// 1. Validate inputs + idempotency (existing)
// 2. Validate holdings (existing)
// 3. Price the swap (internal or Quidax-based)
// 4. Call ConfirmQuotation if quotationID provided
if quotationID != "" {
    swapTxID, err := s.swap.ConfirmQuotation(ctx, userID, quotationID)
    if err != nil {
        // TTL expired (422) or invalid quotation
        // Fail-closed: don't record order, return error
        return nil, err
    }
    o.SwapTransactionID = swapTxID
    o.Status = "executing"  // Async Quidax execution
} else {
    // Internal swap (backward compatibility)
    o.Status = "completed"  // Synchronous
}
// 5. Record order + holdings (existing)
// 6. Post ledger journals (existing)
// 7. Return SwapOrder
```

### Step 4: Update Handler
**File:** `handler_ext.go`

Pass quotationID to service:
```go
o, err := h.svc.Swap(c.Request.Context(), uid, req.FromAssetID, req.ToAssetID, 
                     req.FromUnits, req.QuotationID, key)
```

### Step 5: Add Tests
**File:** `service_test.go`

Test cases:
- `TestSwapWithValidQuotation` — happy path (ConfirmQuotation succeeds)
- `TestSwapWithExpiredQuotation` — TTL enforcement (422 error)
- `TestSwapWithoutQuotation` — backward compatibility (internal pricing)
- `TestSwapIdempotency` — duplicate request returns same result
- `TestSwapConcurrency` — race condition safety (holdings CHECK)
- `TestSwapInvalidQuotation` — malformed quotation ID

---

## Request/Response Changes

### Request: POST /swap
```json
{
    "from_asset_id": "...",
    "to_asset_id": "...",
    "from_units": 100000000,
    "quotation_id": "q_abc123"  // ← from SwapQuote response
}
```

**No breaking changes** — quotation_id is optional (for backward compatibility)

### Response: POST /swap — UPDATED
```json
{
    "success": true,
    "swap": {
        "id": "order_123",
        "user_id": "user_456",
        "from_asset_id": "...",
        "from_symbol": "BTC",
        "to_asset_id": "...",
        "to_symbol": "NGN",
        "status": "executing",  // ← NEW: "executing" for async, "completed" for sync
        "quotation_id": "q_abc123",        // ← NEW: from request
        "swap_transaction_id": "tx_xyz789", // ← NEW: from ConfirmQuotation
        "provider_status": "pending",       // ← NEW: raw Quidax status
        ...
    }
}
```

---

## Error Handling

### TTL Expired (422 from Quidax)
```go
if err != nil && err.Error() contains "422" {
    return nil, fmt.Errorf("crypto: quotation expired — request new quote")
}
```
**Result:** Error returned, no order recorded

### Invalid Quotation (4xx)
```go
if err != nil && strings.HasPrefix(err.Error(), "4") {
    return nil, fmt.Errorf("crypto: invalid quotation — %w", err)
}
```
**Result:** Error returned, no order recorded

### Provider Error (5xx)
```go
if err != nil && strings.HasPrefix(err.Error(), "5") {
    return nil, fmt.Errorf("crypto: provider unavailable — retry later — %w", err)
}
```
**Result:** Error returned, no order recorded, safe to retry

### All paths fail-closed
- No partial state (order never recorded if ConfirmQuotation fails)
- Idempotency key prevents replay (retry-safe)
- No ledger posted until order is durable

---

## State Machine Details

### Swap with Quidax Quote
```
Timeline (example):
  T+0s    User calls POST /swap with quotation_id
  T+0.1s  Service calls ConfirmQuotation → swapTransactionID returned
  T+0.2s  Order recorded: status = "executing"
  T+0.3s  Ledger journals posted (cash + holdings)
  T+0.4s  Handler returns 200 OK with swap_transaction_id
  
  [User's browser closes]
  
  T+5s    Quidax processes swap (async)
  T+6s    Quidax sends webhook: swap completed
  [CR-013 webhook handler receives event]
  [Updates order status: "executing" → "completed"]
```

### Swap with Internal Quote (backward compatibility)
```
  T+0s    User calls POST /swap (no quotation_id)
  T+0.1s  Service prices swap internally
  T+0.2s  Order recorded: status = "completed" (synchronous)
  T+0.3s  Ledger journals posted (cash + holdings)
  T+0.4s  Handler returns 200 OK (no swap_transaction_id)
```

---

## Idempotency Enforcement

### Existing: Duplicate Idempotency-Key
```
POST /swap with key="key_123"
  ↓
Service finds existing order with key_123
  ↓
Returns existing order (no duplicate ledger post)
```

### New: Same Quote, Different Amounts
```
POST /swap with quotation_id="q_1", key="key_123"
  ↓
Quidax: quotation_id="q_1" matched to from_units=100
  ↓
User sends: from_units=200 (different amount, same quote!)
  ↓
Quidax rejects: "quotation amount mismatch" (422)
```
**Mitigation:** Client MUST use same quotation for same amount, or request new quote

---

## Testing Strategy

### Unit Tests (no DB)
- Mock provider returns success/error
- Verify status transitions (pending → executing → completed)
- Verify error handling (TTL expired, invalid quote, provider error)

### Integration Tests (with DB)
- Verify order recorded with quotation_id + swap_transaction_id
- Verify idempotency (duplicate key returns same order)
- Verify holdings moved (before ConfirmQuotation)
- Verify ledger posted (after ConfirmQuotation)

### E2E Tests (mock provider)
- Quote → Confirm → Webhook → Status update flow
- TTL expiry: quote → wait 16 sec → confirm fails (422)
- Race condition: concurrent swaps on same holdings

---

## Quidax Integration Points

### ConfirmQuotation Signature (from CR-009)
```go
func (q *quidaxProvider) ConfirmQuotation(ctx context.Context, userID, quotationID string) (string, error)
```
- Input: userID (Quidax subaccount ID), quotationID (from quote)
- Output: swapTransactionID (for polling), error
- Error cases: 422 (expired), 4xx (invalid), 5xx (provider error)

### Status Polling (for CR-013)
```go
func (q *quidaxProvider) GetSwapTransaction(ctx context.Context, userID, swapTransactionID string) (string, map[string]any, error)
```
- Input: userID, swapTransactionID
- Output: status ("pending", "completed", "failed"), raw metadata
- Used by webhook handler to fetch final status

---

## Files to Modify

| File | Changes | Scope |
|------|---------|-------|
| `model.go` | Add QuotationID, SwapTransactionID, ProviderStatus to SwapOrder | +3 |
| `service_ext.go` | Update Swap method signature + add ConfirmQuotation call | +30 |
| `handler_ext.go` | Pass quotationID to Swap service | +1 |
| `service_test.go` | Add 6 test cases | +120 |

**Total implementation:** ~154 lines of code

---

## Dependencies

### Must Have
- ✅ CR-009: Quidax adapter (ConfirmQuotation method)
- ✅ CR-010: Asset mapping (for Swap validation)
- ✅ CR-011: Quote service (quotation_id in request)

### Can Defer to CR-013+
- CR-013: Webhook handler (for status updates)
- CR-014: Ledger settlement (async state updates)

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| TTL expires between quote + confirm | Fail-closed: ConfirmQuotation rejects with 422 |
| Concurrent swaps race condition | DB CHECK (holdings >= amount) prevents oversell |
| Partial state (order recorded, ledger fails) | Transaction boundary: order + ledger atomically |
| Duplicate confirms | Idempotency-Key prevents replay |
| Provider unavailable | Error propagated, order never recorded, safe to retry |

---

## Success Criteria

- [ ] SwapOrder model extended with quotation_id + swap_transaction_id
- [ ] Swap service accepts quotationID parameter
- [ ] ConfirmQuotation called on Quidax quotes
- [ ] TTL enforcement (Quidax rejects expired quotes)
- [ ] State machine: "executing" status for async swaps
- [ ] Idempotency verified (duplicate key returns same order)
- [ ] All tests passing (6 new test cases)
- [ ] No regressions in CR-009, CR-010, CR-011

---

## Timeline

**Today estimate:** 2–3 hours  
- Implementation: 1.5 hours
- Testing: 1 hour
- Integration verification: 0.5 hours

**Quidax sandbox test (optional):** 1–2 hours (can be parallel with CR-013)

---

## Next Step: CR-013 (Webhook Inbox)

Once CR-012 completes:
- Swap handler returns swapTransactionID
- Status = "executing" (waiting for Quidax webhook)
- CR-013 webhook handler receives Quidax event
- Updates order status: "executing" → "completed"/"failed"
- CR-014 posts final ledger journals

---

## Reference

- **Workplan:** Crypto_Quidax_Brownfield_Implementation_Workplan.md §5.3–5.4
- **Prior work:** CR-009 (adapter), CR-010 (mapping), CR-011 (quote service)
- **Next:** CR-013 (webhook inbox), CR-014 (ledger settlement)
