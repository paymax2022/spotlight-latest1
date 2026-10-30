# CR-011: Quote Service & TTL Enforcement Plan

**Status:** Implementation in progress  
**Dependency:** CR-009 (Quidax adapter) ✅, CR-010 (asset mapping) ✅  
**Unblocks:** CR-012 (Swap confirmation)  
**Estimated effort:** 2–3 days  

---

## Overview

CR-011 integrates the Quidax Instant Swap provider (CR-009) and asset mapping (CR-010) into the SwapQuote handler. The goal is to replace internal pricing with live Quidax quotes and enforce the 15-second quotation TTL.

**Key changes:**
1. SwapQuote handler → call Quidax API instead of internal pricing
2. Add QuotationID and ExpiresAt to SwapQuote response
3. Enforce TTL before Swap execution (reject if expired)
4. Map internal asset IDs ↔ Quidax currency codes
5. Cache quotations for fast refresh (optional; not in R1 scope)

---

## Current State (CR-010 Complete)

### SwapQuote Handler (handler_ext.go:17–39)
```
POST /swap/quote → h.SwapQuote(c)
  ↓ h.svc.SwapQuote(userID, fromAssetID, toAssetID, fromUnits)
  ↓ (calls internal pricing, returns SwapQuote)
  ↓ c.JSON(200, {quote: ...})
```

### SwapQuote Service (service_ext.go:23–26)
```go
func (s *Service) SwapQuote(ctx, userID, fromAssetID, toAssetID, fromUnits) → *SwapQuote
  ↓ s.priceSwap() // uses s.price.PriceKobo (internal provider)
  ↓ returns SwapQuote with pricing
```

### Current SwapQuote Response
```json
{
  "success": true,
  "quote": {
    "from_asset_id": "...",
    "from_symbol": "BTC",
    "to_asset_id": "...",
    "to_symbol": "NGN",
    "from_units": 100000000,
    "to_units": 1500000000000,
    "from_price_kobo": 15000000000,
    "to_price_kobo": 1,
    "cash_kobo": 1500000000000,
    "spread_kobo": 30000000000,
    "spread_bps": 200,
    "source": "quidax",  // will be "quidax" after integration
    "as_of": "2026-10-29T..."
  }
}
```

---

## Design: Quidax Integration

### New Response Type (Option 1: Extend SwapQuote)
```go
type SwapQuote struct {
    // ... existing fields ...
    QuotationID string    `json:"quotation_id,omitempty"`  // from Quidax
    ExpiresAt   time.Time `json:"expires_at,omitempty"`   // quote TTL
    Provider    string    `json:"provider"`               // "quidax" or "internal"
}
```

### New Response Type (Option 2: Wrapper)
```go
type QuoteResponse struct {
    Quote       *SwapQuote `json:"quote"`
    QuotationID string     `json:"quotation_id,omitempty"`
    ExpiresAt   time.Time  `json:"expires_at,omitempty"`
}
```

**Decision:** Use Option 1 (extend SwapQuote). Cleaner, no wrapper needed.

---

## Implementation Steps

### Step 1: Add Fields to SwapQuote Model
**File:** `model.go`

```go
type SwapQuote struct {
    // ... existing fields ...
    QuotationID string    `json:"quotation_id,omitempty"`  // Quidax quote ID
    ExpiresAt   time.Time `json:"expires_at,omitempty"`   // Quote expiry (15 sec TTL)
    Provider    string    `json:"provider"`               // "quidax" or "internal"
}
```

### Step 2: Create Quidax Quote Service Method
**File:** `service_ext.go`

```go
// SwapQuoteQuidax requests a quote from Quidax Instant Swap.
// Replaces the internal pricing path for external quotes.
func (s *Service) SwapQuoteQuidax(ctx context.Context, userID, fromAssetID, toAssetID string, fromUnits int64) (*SwapQuote, error) {
    // 1. Validate inputs
    if fromUnits <= 0 {
        return nil, ErrBadRequest
    }
    if fromAssetID == toAssetID {
        return nil, ErrSameAsset
    }
    
    // 2. Get asset objects
    from, err := s.repo.GetAsset(ctx, fromAssetID)
    if err != nil {
        return nil, err
    }
    to, err := s.repo.GetAsset(ctx, toAssetID)
    if err != nil {
        return nil, err
    }
    
    if !from.IsActive || !to.IsActive {
        return nil, ErrAssetInactive
    }
    
    // 3. Ensure Quidax subaccount exists
    quidaxUserID, err := s.EnsureQuidaxSubaccount(ctx, userID)
    if err != nil {
        return nil, err
    }
    
    // 4. Call Quidax CreateQuotation with mapped currency codes
    quotationID, expiresAt, err := s.provider.CreateQuotation(
        ctx,
        quidaxUserID,
        from.Symbol,  // "NGN" (fiat leg)
        to.Symbol,    // "BTC" (crypto leg)
        fromUnits,
    )
    if err != nil {
        return nil, err
    }
    
    // 5. Compute effective rates from Quidax response
    // (Quidax tells us the conversion; we derive the rates)
    // For R1: fetch current prices to compute rates (fallback)
    fromPrice, _ := s.price.PriceKobo(ctx, from.Symbol)
    toPrice, _ := s.price.PriceKobo(ctx, to.Symbol)
    
    // 6. Build response
    q := &SwapQuote{
        FromAssetID:   from.ID,
        FromSymbol:    from.Symbol,
        ToAssetID:     to.ID,
        ToSymbol:      to.Symbol,
        FromUnits:     fromUnits,
        ToUnits:       toUnits,  // from Quidax response
        FromPriceKobo: fromPrice,
        ToPriceKobo:   toPrice,
        CashKobo:      ...       // computed from response
        SpreadKobo:    0,        // Quidax handles spread internally (for R1)
        SpreadBps:     0,
        QuotationID:   quotationID,
        ExpiresAt:     expiresAt,
        Provider:      "quidax",
        AsOf:          time.Now().UTC(),
    }
    
    return q, nil
}
```

### Step 3: Update SwapQuote Handler to Use Quidax
**File:** `handler_ext.go` — no changes needed (calls service method)

### Step 4: Add TTL Enforcement to Swap
**File:** `service_ext.go`

In the Swap method (before execution):
```go
func (s *Service) Swap(ctx context.Context, userID, fromAssetID, toAssetID, fromUnits int64, quotationID string, idemKey string) (*SwapOrder, error) {
    // ... existing checks ...
    
    // TTL enforcement: validate quotationID is still valid
    if quotationID != "" {
        // Check if quote is still within TTL (not expired)
        // Get quote from cache or DB (need to store quotes for this)
        // For R1: implicit in Quidax call → if expired, ConfirmQuotation fails 422
    }
    
    // ... rest of Swap logic ...
}
```

### Step 5: Add Tests
**File:** `service_test.go` or `service_ext_test.go`

Test cases:
- `TestSwapQuoteQuidax` — valid quote from Quidax
- `TestSwapQuoteQuidax_InvalidAsset` — inactive/missing asset
- `TestSwapQuoteQuidax_InvalidAmount` — zero/negative units
- `TestSwapQuoteQuidax_SameAsset` — from == to
- `TestSwapQuoteQuidax_SubaccountCreated` — account provisioning
- `TestSwapQuoteQuidax_TTLEnforcement` — expired quote rejected
- `TestSwapWithQuotationID` — confirm with quotation ID
- `TestSwapWithExpiredQuotation` — reject after TTL

---

## Request/Response Changes

### Request (SwapQuote)
```json
POST /swap/quote
{
    "from_asset_id": "...",
    "to_asset_id": "...",
    "from_units": 100000000
}
```
No changes.

### Response (SwapQuote) — NEW
```json
{
    "success": true,
    "quote": {
        "from_asset_id": "...",
        "from_symbol": "BTC",
        "to_asset_id": "...",
        "to_symbol": "NGN",
        "from_units": 100000000,
        "to_units": 1500000000000,
        "from_price_kobo": 15000000000,
        "to_price_kobo": 1,
        "cash_kobo": 1500000000000,
        "spread_kobo": 0,           // NEW: Quidax handles internally
        "spread_bps": 0,            // NEW
        "quotation_id": "q_xyz123", // NEW: Quidax quotation ID
        "expires_at": "2026-10-29T16:45:30Z",  // NEW: TTL (15 sec from now)
        "provider": "quidax",       // NEW: "quidax" or "internal"
        "source": "quidax",
        "as_of": "2026-10-29T..."
    }
}
```

### Request (Swap) — UPDATED
```json
POST /swap
{
    "from_asset_id": "...",
    "to_asset_id": "...",
    "from_units": 100000000,
    "quotation_id": "q_xyz123"  // NEW: from SwapQuote response
}
```

### Response (Swap)
```json
{
    "success": true,
    "swap": {
        "id": "...",
        "user_id": "...",
        "status": "filled",
        "from_asset_id": "...",
        "from_symbol": "BTC",
        ...
        "swap_transaction_id": "tx_abc456"  // NEW: from Quidax ConfirmQuotation
    }
}
```

---

## Quidax Integration Points

### 1. Currency Code Mapping
- Internal: `from_asset_id` (UUID) + lookup symbol in crypto_assets
- Quidax: `fromCurrency` (uppercase code, e.g., "BTC", "NGN")
- Mapping: Use `GetAssetBySymbol()` from CR-010

Example:
```
fromAssetID "a1b2c3d4" → GetAsset() → Symbol "BTC" → CreateQuotation(..., "BTC", ...)
```

### 2. Subaccount Management
- CR-010 `EnsureQuidaxSubaccount(userID)` ensures one account per user
- Returns Quidax subaccount ID (userID, per design)
- Used in all Quidax calls

### 3. Quote TTL
- Quidax returns 15-second TTL (ExpiresAt = now + 15 sec)
- Client must call Swap with same quotationID within TTL
- Quidax ConfirmQuotation rejects if expired (422)

### 4. Idempotency
- SwapQuote: No idempotency key (display-only, no side effect)
- Swap: Idempotency-Key required (money mutation)
- Quidax ConfirmQuotation is idempotent by quotationID

---

## Phase 1 R1 Scope

### In Scope ✅
- [ ] SwapQuote calls CreateQuotation (Quidax live prices)
- [ ] Add QuotationID + ExpiresAt to response
- [ ] Map internal assets to Quidax currency codes
- [ ] TTL enforcement (reject if expired)
- [ ] Swap calls ConfirmQuotation with quotationID
- [ ] Tests CR-T026–T029

### Out of Scope (Phase 2)
- Quote caching (re-quote on refresh)
- Quote request deduplication
- Ledger integration (CR-014)
- Advanced error recovery

---

## Files to Modify

| File | Changes | Scope |
|------|---------|-------|
| `model.go` | Add QuotationID, ExpiresAt, Provider to SwapQuote | +10 lines |
| `service_ext.go` | Add SwapQuoteQuidax method + TTL enforcement | +50 lines |
| `service_test.go` | Add 8 test cases | +150 lines |
| `handler_ext.go` | Minor: pass quotationID in Swap request | ±5 lines |

**Total implementation:** ~215 lines of code

---

## Testing Strategy

### Unit Tests (service layer)
- Happy path: valid quote from Quidax
- Error paths: invalid assets, inactive assets, zero units, expired quote
- Idempotency: same quotationID → same transaction
- TTL: reject if now > expiresAt

### Integration Tests (handler layer)
- SwapQuote → Quidax → response includes quotationID + expiresAt
- Swap with valid quotationID → ConfirmQuotation succeeds
- Swap with expired quotationID → ConfirmQuotation fails (422)

### Contract Tests (Quidax adapter)
- Already done in CR-009 (19 tests passing)

---

## Deployment Notes

### Feature Flag
- Enable via feature flag (same gate as CR-009)
- Default: off (fall back to internal pricing)
- Config key: `CRYPTO_QUIDAX_ENABLED` (boolean)

### Database
- No schema changes required (CR-010 complete)
- Quotations stored in Quidax (not durably in our DB for R1)

### Fallback
- If Quidax unavailable: fall back to internal pricing
- Handler detects provider in response (source field)

---

## Success Criteria

- [ ] SwapQuote returns quotationID + expiresAt from Quidax
- [ ] TTL enforced before Swap execution
- [ ] All tests passing (unit + integration)
- [ ] Quidax sandbox verification (live test with real API)
- [ ] No regressions in existing Swap flow

---

## Next Step: CR-012

Once CR-011 completes:
- CR-012 integrates ConfirmQuotation call into Swap execution
- Binds swapTransactionID to trade record
- Implements state machine for swap status tracking

---

## Reference

- **Quidax docs:** CreateQuotation, ConfirmQuotation (15-sec TTL)
- **Workplan:** Crypto_Quidax_Brownfield_Implementation_Workplan.md §5.2–5.3
- **Prior work:** CR-009 (adapter), CR-010 (asset mapping)
- **Test cases:** CR-T026–T029 (quote expiry, refresh, confusable pairs)
