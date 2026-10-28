# CR-010: Asset Catalogue & Subaccount Mapping Plan

**Status:** Design phase  
**Estimated effort:** 1–2 days  
**Dependency:** CR-009 complete (Quidax adapter ready)  
**Blocks:** CR-011 (quote service needs mapped assets)  

---

## Overview

CR-010 implements **Quidax account provisioning** (per-user subaccounts) and **asset discovery** (supported coins/pairs). The work ensures:

1. **Account management:** One Quidax subaccount per user (1:1 mapping)
2. **Asset discovery:** Query Quidax for supported assets/networks
3. **Asset mapping:** Internal asset IDs ↔ Quidax currency codes

---

## Implementation Started ✅

### 1. CryptoAccount Model (Done)
```go
type CryptoAccount struct {
    ID                string    // UUID
    UserID            string    // User's ID
    Provider          string    // "quidax"
    ProviderAccountID string    // Quidax subaccount ID
    CreatedAt         time.Time
    UpdatedAt         time.Time
}
```

### 2. Repository Methods (Done)
```go
// GetOrCreateAccount - Idempotent provision of user's Quidax account
// Uses: INSERT ... ON CONFLICT (user_id, provider) DO UPDATE
// Result: One row per (user, provider) pair guaranteed

func (r *Repository) GetOrCreateAccount(
    ctx context.Context,
    userID, provider, providerAccountID string,
) (*CryptoAccount, error)

// GetAccount - Retrieve existing account, ErrNotFound if missing
func (r *Repository) GetAccount(
    ctx context.Context,
    userID, provider string,
) (*CryptoAccount, error)
```

---

## Remaining Work

### 3. Service Layer Methods (To Do)

**EnsureQuidaxSubaccount:**
```go
func (s *Service) EnsureQuidaxSubaccount(ctx context.Context, userID string) (subaccountID string, err error) {
    // 1. Try GetAccount → if exists, return providerAccountID
    // 2. If not, call Quidax API to provision new subaccount (if required)
    //    (Some providers may use pooled accounts; verify with Quidax)
    // 3. Call GetOrCreateAccount to persist the mapping
    // 4. Return the subaccount ID for use in quote/confirm calls
}
```

**ListQuidaxAssets (or UpdateAssetCatalogue):**
```go
func (s *Service) ListQuidaxAssets(ctx context.Context) ([]Asset, error) {
    // 1. Call Quidax API (if available) or hardcode supported assets
    // 2. Discover supported pairs, networks, precisions
    // 3. Upsert to crypto_assets table (safe for idempotent re-run)
    // 4. Return list for client UI
    // Note: May be a scheduled job (sync assets on boot)
}
```

### 4. Database Migrations (If Needed)

The **`crypto_accounts`** table already exists (migration 20271031).  
Check if asset tables need:
- Network/blockchain support (if not already there)
- Quidax-specific metadata columns (optional)

### 5. Tests (To Do)

**Test cases:**
- `TestEnsureQuidaxSubaccount` — First call creates account, retry returns same
- `TestListQuidaxAssets` — Asset discovery, filtering by active flag
- `TestAssetMapping` — Internal ID ↔ Quidax currency code

---

## Quidax Integration Details

### Subaccount Model
Per Quidax docs and Workplan §5.1:
- **Per-user subaccounts** (1:1 user:subaccount model) — recommended for isolation
- Alternative: **Pooled account** (N:M user:provider) — single Quidax account, track balances internally

**Action:** Verify with Quidax sandbox which model the merchant account supports.

### Supported Assets
Quidax Instant Swap supports:
- Common cryptocurrencies: BTC, ETH, USDT, USDC, SOL, etc.
- NGN ↔ crypto pairs only (no crypto↔crypto via Quidax, unless separate API)

**Action:** Call Quidax discovery endpoint (if available) or hardcode from merchant dashboard.

### Currency Code Mapping
- Quidax uses uppercase 3–6 char codes: "BTC", "ETH", "USDT", "BUSD", "SOL", "NGN"
- Internal assets.symbol field should match (case-insensitive lookup)

**Example:**
```
Internal Asset: symbol="BTC", minor_unit_scale=100_000_000
Quidax Currency: "BTC"
Pair: NGN → BTC via CreateQuotation(fromCurrency="NGN", toCurrency="BTC")
```

---

## Implementation Checklist

### Code Changes
- [ ] Add CryptoAccount model to model.go ✅
- [ ] Add GetOrCreateAccount + GetAccount to repository.go ✅
- [ ] Add EnsureQuidaxSubaccount to service.go (or service_accounts.go)
- [ ] Add ListQuidaxAssets to service.go (or service_assets.go)
- [ ] Add asset mapping helper (internal ID ↔ Quidax code)

### Tests
- [ ] TestEnsureQuidaxSubaccount (create, retry-safe)
- [ ] TestListQuidaxAssets (discovery, filtering)
- [ ] TestAssetMapping (bidirectional lookup)

### Verification
- [ ] Quidax sandbox test: verify subaccount creation flow
- [ ] Quidax sandbox test: verify supported assets list
- [ ] Integration: CR-011 can call these methods

### Documentation
- [ ] Asset table schema (networks, precision, mapping)
- [ ] Account provisioning flow diagram
- [ ] Asset discovery logic (batch vs. on-demand)

---

## Integration with CR-011 (Quote Service)

Once CR-010 is done:
1. **`SwapQuote` handler** calls `EnsureQuidaxSubaccount(userID)` to get subaccount ID
2. Maps internal `fromAssetID` → Quidax currency code via asset table
3. Calls `quidaxProvider.CreateQuotation(userID, fromCurrency, toCurrency, amount)`
4. Returns quote + TTL for client display

---

## Deployment Notes

### Asset Sync Strategy
- **On boot:** Load assets once from DB (or call Quidax if empty)
- **Periodic refresh:** Optional: sync every 24 hours (if Quidax adds new pairs)
- **On-demand:** If asset not found, fetch from Quidax (fail-safe)

### Account Provisioning
- **Lazy creation:** Create subaccount on first trade/quote (not on sign-up)
- **Idempotent:** Retry-safe via unique (user_id, provider) constraint

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Subaccount creation fails | Fail-closed: error returned, no ledger posted until account exists |
| Asset list out of sync | On-demand fetch as fallback; scheduled refresh |
| Currency code mismatch | Case-insensitive lookup, unit tests verify mapping |
| Multiple subaccounts per user | DB unique constraint prevents duplicates |

---

## Files to Modify

| File | Changes | Lines |
|------|---------|-------|
| `model.go` | Add CryptoAccount struct | +15 ✅ |
| `repository.go` | Add GetOrCreateAccount, GetAccount | +50 ✅ |
| `service.go` (or new `service_accounts.go`) | Add EnsureQuidaxSubaccount, ListQuidaxAssets | +80 |
| `service_test.go` | Add account + asset tests | +150 |
| `provider.go` (CR-009) | SwapProvider.ListAssets() (optional) | — |

---

## Next Step: CR-011

Once CR-010 is merged:
- **CR-011: Quote Service & TTL** integrates these methods
- `SwapQuote` handler calls `EnsureQuidaxSubaccount` + `ListQuidaxAssets`
- Calls `quidaxProvider.CreateQuotation()` with mapped currencies
- Tests CR-T026–T029 (expiry, refresh, confusable pairs)

---

## Reference

- **Quidax docs:** https://docs.quidax.io/ (check for supported assets, networks, subaccount API)
- **Workplan:** Crypto_Quidax_Brownfield_Implementation_Workplan.md §5
- **Prior work:** CR-009 (adapter) is ready; database schema (crypto_accounts table) exists
- **Next:** CR-011 (quote handler), CR-012 (confirm), CR-013 (webhooks)

---

**Status:** Ready for implementation. CR-009 unblocked the provider work; CR-010 unblocks CR-011 quote service.

