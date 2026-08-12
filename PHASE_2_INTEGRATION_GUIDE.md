# Phase 2 Integration Guide — Complete Implementation Roadmap

**Status**: Planning phase  
**Duration**: 3-4 hours estimated  
**Coverage**: 66+ endpoints across 8 handlers  

---

## Overview

This guide provides the complete roadmap for Phase 2 service integration — connecting all 66+ scaffolded endpoints to:
1. **Supabase persistence** (registrations, applications, contests, payments)
2. **Ledger double-entry** (wallet mutations)
3. **Audit events** (all state changes)
4. **Idempotency-Key replay detection** (money mutations)

---

## Existing Infrastructure Available

### 1. Ledger Service (`backend/internal/finance/ledger/service.go`)
```go
// Core methods available:
svc.Credit(ctx, userID, reference, idempotencyKey, debitAccountID, amountKobo)
svc.Debit(ctx, userID, reference, idempotencyKey, creditAccountID, amountKobo)
svc.PostJournal(ctx, entry JournalEntry)
svc.GetBalance(ctx, userID) (int64, error)
svc.GetOrCreateUserWallet(ctx, userID)
svc.Posted(ctx, baseIdempotencyKey) (bool, error)  // Check if already posted
```

**Usage pattern:**
1. Check `svc.Posted(ctx, idemKey)` — if true, return cached result (idempotent)
2. Post ledger entry via `svc.Credit/Debit/PostJournal`
3. Emit audit event
4. Return result

### 2. Audit Service (`backend/internal/services/audit_service.go`)
```go
// Core method:
svc.LogAction(
  actorUserID,      // who did it
  targetUserID,     // who it was done to (may be empty)
  action,           // "create", "submit", "pay", etc.
  module,           // "registration", "wallet", "kyc"
  resourceType,     // "application", "payment", "tier"
  resourceID,       // UUID of the resource
  oldValues,        // map[string]any of before
  newValues,        // map[string]any of after
  ipAddress,        // from request
  userAgent,        // from request
  severity,         // "info", "warning", "critical"
)
```

**Usage pattern:**
1. Call after each state-changing operation
2. Nil-safe (no-op if repo is nil)
3. Fire-and-forget (doesn't block)

### 3. Idempotency-Key Pattern
**All money mutations MUST:**
1. Read header: `idemKey := c.GetHeader("Idempotency-Key")`
2. Return 400 if missing: `if idemKey == "" { return 400 }`
3. Check if already posted: `if posted, _ := svc.Posted(ctx, idemKey); posted { return cached }`
4. Post ledger entry with key
5. Return result

---

## Supabase Schema Available

### Registrations Table
```sql
registrations (
  id UUID,
  user_id UUID (FK auth.users),
  contest_slug TEXT,
  reference TEXT UNIQUE,
  status TEXT (draft|submitted|awaiting_payment|...),
  form_data JSONB,
  current_step TEXT,
  completion_percent INTEGER,
  fraud_flags JSONB,
  created_at, updated_at, submitted_at, withdrawn_at
)

registration_status_events (
  id UUID,
  registration_id UUID,
  old_status TEXT,
  new_status TEXT,
  note TEXT,
  actor_role TEXT,
  created_at
)
```

RLS policies handle user-scoped access automatically.

---

## Implementation Checklist by Handler

### 1. AdminConsoleHandler (23 endpoints)

**All endpoints are read-only (GET). No money mutations, no RLS bypass needed.**

Pattern per endpoint:
```go
func (h *Handler) GetDashboard(c *gin.Context) {
  userID := c.GetString("user_id")
  
  // Phase 2: Query Supabase
  // SELECT ... FROM admin_dashboard_view WHERE ...
  // WHERE role = user's admin role (from RBAC middleware)
  
  // Return results
}
```

**No ledger posts needed (no money path).** No audit events needed (read-only).

**Supabase queries needed:**
- Dashboard aggregates (count users, KYC pending, orders, etc.)
- User list (paginated)
- KYC queue
- Asset controls
- Orders
- Withdrawals
- Reconciliation view
- Providers
- Risk limits
- Fees
- Feature flags
- Approvals
- Audit logs
- Admin list

**Total endpoints**: 23 (all read-only)

---

### 2. WalletConnectHandler (4 endpoints)

| Endpoint | Type | Ledger | Audit | Idempotency |
|----------|------|--------|-------|-------------|
| GET /wallet/summary | Read | NO | NO | NO |
| POST /wallet/fund | Write | YES (Credit from Paymax revenue) | YES | YES |
| GET /wallet/history | Read | NO | NO | NO |
| GET /wallet/history/:id | Read | NO | NO | NO |

**fundWallet implementation:**
```go
func (h *Handler) FundWallet(c *gin.Context) {
  idemKey := c.GetHeader("Idempotency-Key")
  if idemKey == "" {
    return 400  // Idempotency-Key required
  }
  
  // Phase 2: Check if already posted
  if posted, _ := ledger.Posted(ctx, idemKey); posted {
    return cached_result
  }
  
  // Phase 2: Post ledger entry
  ledger.Credit(ctx, userID, reference, idemKey, 
    AccountPaymaxRevenue, amountKobo)
  
  // Phase 2: Emit audit
  audit.LogAction(userID, "", "fund_wallet", "wallet", "wallet", 
    userID, nil, map[string]any{"amount": amountKobo}, ...)
  
  // Return new balance
}
```

**Total endpoints**: 4 (3 read + 1 write with ledger)

---

### 3. GiftingConnectHandler (8 endpoints)

| Endpoint | Type | Ledger | Audit | Idempotency |
|----------|------|--------|-------|-------------|
| GET /gifting/catalog | Read | NO | NO | NO |
| GET /gifting/catalog/:id | Read | NO | NO | NO |
| GET /gifting/recipients | Read | NO | NO | NO |
| GET /gifting/quote | Read | NO | NO | NO |
| POST /gifting/send | Write | YES (sender DEBIT, recipient CREDIT) | YES | YES |
| GET /gifting/sent | Read | NO | NO | NO |
| GET /gifting/received | Read | NO | NO | NO |
| GET /gifting/transactions/:id | Read | NO | NO | NO |

**sendGift implementation:**
```go
func (h *Handler) SendGift(c *gin.Context) {
  idemKey := c.GetHeader("Idempotency-Key")
  if idemKey == "" {
    return 400
  }
  
  // Check tier limit (sender must be Tier 1+)
  tier := get_user_tier(ctx, senderID)
  if tier < 1 {
    return 403  // Tier required
  }
  
  // Check daily limit
  if daily_spent + amount > tier_daily_limit {
    return 403  // Daily limit exceeded
  }
  
  // Check if already posted
  if posted, _ := ledger.Posted(ctx, idemKey); posted {
    return cached_result
  }
  
  // Post double-entry: sender DEBIT, recipient CREDIT
  ledger.Debit(ctx, senderID, ref, idemKey, walletAcct, amount)
  ledger.Credit(ctx, recipientID, ref, idemKey, senderAcct, amount)
  
  // Emit audit
  audit.LogAction(senderID, recipientID, "send_gift", "wallet", 
    "gift", transactionID, nil, newValues, ...)
  
  return success
}
```

**Total endpoints**: 8 (7 read + 1 write with ledger)

---

### 4. KYCConnectHandler (6 endpoints)

| Endpoint | Type | Ledger | Audit | Idempotency |
|----------|------|--------|-------|-------------|
| GET /kyc/status | Read | NO | NO | NO |
| GET /kyc/limits | Read | NO | NO | NO |
| POST /kyc/tier1 | Write | NO | YES | YES |
| POST /kyc/tier2 | Write | NO | YES | YES |
| POST /kyc/tier3 | Write | NO | YES | YES |
| GET /me/tier | Read | NO | NO | NO |

**submitTier1 implementation:**
```go
func (h *Handler) SubmitTier1(c *gin.Context) {
  idemKey := c.GetHeader("Idempotency-Key")
  if idemKey == "" {
    return 400
  }
  
  // Check if already posted
  posted, _ := ledger.Posted(ctx, idemKey)
  if posted {
    return cached_result
  }
  
  // Phase 2: Call KYC provider to validate BVN/NIN
  result, err := kyc_provider.VerifyIDNumber(identifier, idType)
  if err != nil || !result.Valid {
    return 422  // Invalid identifier
  }
  
  // Phase 2: Insert into kyc_profiles table
  // UPDATE kyc_profiles SET bvn = 'passed', tier = 1, ...
  
  // Emit audit
  audit.LogAction(userID, "", "submit_kyc", "kyc", "kyc_profile", 
    profileID, oldValues, newValues, ...)
  
  return success
}
```

**Total endpoints**: 6 (3 read + 3 write with audit only, no ledger)

---

### 5. PayoutsConnectHandler (3 endpoints)

| Endpoint | Type | Ledger | Audit | Idempotency |
|----------|------|--------|-------|-------------|
| GET /payouts/eligibility | Read | NO | NO | NO |
| POST /payouts/request | Write | YES (DEBIT earnings, record payout) | YES | YES |
| GET /payouts/history | Read | NO | NO | NO |

**requestPayout implementation:**
```go
func (h *Handler) RequestPayout(c *gin.Context) {
  idemKey := c.GetHeader("Idempotency-Key")
  if idemKey == "" {
    return 400
  }
  
  // Verify Tier 2+
  tier := get_user_tier(ctx, userID)
  if tier < 2 {
    return 403  // Tier 2+ required
  }
  
  // Check if already posted
  if posted, _ := ledger.Posted(ctx, idemKey); posted {
    return cached_result
  }
  
  // Phase 2: Post double-entry
  // DEBIT user's earnings account (creator_earnings standing account)
  // CREDIT user's wallet
  ledger.Debit(ctx, "", ref, idemKey, creatorEarningsAcct, amount)
  ledger.Credit(ctx, userID, ref, idemKey, earningsAcct, amount)
  
  // Phase 2: Create payout_request record
  // INSERT INTO payout_requests (user_id, amount_kobo, status, ...)
  
  // Emit audit
  audit.LogAction(userID, "", "request_payout", "wallet", 
    "payout", payoutID, nil, newValues, ...)
  
  return success
}
```

**Total endpoints**: 3 (2 read + 1 write with ledger and audit)

---

### 6. RegistrationHandler (10 endpoints)

| Endpoint | Type | Ledger | Audit | Idempotency |
|----------|------|--------|-------|-------------|
| GET /contests | Read | NO | NO | NO |
| GET /applications | Read | NO | NO | NO |
| POST /applications | Write | NO | YES | NO |
| GET /applications/:id | Read | NO | NO | NO |
| PATCH /applications/:id | Write | NO | YES | NO |
| POST /applications/:id/submit | Write | NO | YES | NO |
| GET /applications/:id/status | Read | NO | NO | NO |
| POST /applications/:id/withdraw | Write | NO | YES | NO |
| POST /applications/:id/payment/initiate | Write | YES (if WALLET method) | YES | YES |
| POST /applications/:id/payment/verify | Write | YES (if Paystack verified) | YES | NO |

**createApplication implementation:**
```go
func (h *Handler) CreateApplication(c *gin.Context) {
  userID := c.GetString("user_id")
  contestSlug := body.ContestSlug
  
  // Phase 2: Generate reference ID
  reference := generateReference(contestSlug)
  
  // Phase 2: Insert into registrations table
  registration := Registrations{
    ID: uuid.New(),
    UserID: userID,
    ContestSlug: contestSlug,
    Reference: reference,
    Status: "draft",
    FormData: {},
    CreatedAt: now,
    UpdatedAt: now,
  }
  
  // INSERT INTO registrations (user_id, contest_slug, ...) VALUES (...)
  
  // Emit audit
  audit.LogAction(userID, "", "create_application", "registration",
    "application", registration.ID, nil, newValues, ...)
  
  return registration
}
```

**initiatePayment implementation (WALLET method):**
```go
func (h *Handler) InitiatePayment(c *gin.Context) {
  idemKey := c.GetHeader("Idempotency-Key")
  if idemKey == "" {
    return 400
  }
  
  if method == "WALLET" {
    // Check if already posted
    if posted, _ := ledger.Posted(ctx, idemKey); posted {
      return cached_result
    }
    
    // Phase 2: Post ledger entry (DEBIT wallet)
    ledger.Debit(ctx, userID, ref, idemKey, registrationFeesAcct, amount)
    
    // Phase 2: Update registration status + form_data
    // UPDATE registrations SET form_data.payment.status = 'paid', ...
    
    // Emit audit
    audit.LogAction(userID, "", "pay_registration", "registration",
      "payment", registrationID, oldValues, newValues, ...)
    
    return success
  } else if method == "PAYSTACK" {
    // Phase 2: Call Paystack provider
    // No ledger entry yet (will post on verify)
    
    return {authorizationUrl: "...", transactionId: "..."}
  }
}
```

**Total endpoints**: 10 (3 read + 7 write, 2 with ledger)

---

## Summary of Phase 2 Work

**Total endpoints**: 66+

### Ledger-touching (money mutations)
- fundWallet (1)
- sendGift (1)
- requestPayout (1)
- initiatePayment (WALLET) (1)
- verifyPayment (1)
- **Total**: 5 endpoints

### Audit-emitting (all mutations)
- All 10 registration endpoints (creates, updates, status changes)
- sendGift (1)
- All KYC endpoints (3)
- requestPayout (1)
- Payment operations (2)
- **Total**: 18 endpoints with audit

### Read-only (no ledger, no audit)
- All admin endpoints (23)
- Wallet history reads (3)
- Gifting reads (7)
- KYC status reads (3)
- Payout eligibility (1)
- Contest list (1)
- Application list (1)
- **Total**: 39+ read-only endpoints

---

## Implementation Sequence (Recommended)

### Phase 2A: Admin API (23 endpoints, ~30 minutes)
- All read-only
- Just add Supabase queries
- No ledger, no audit needed
- **PR Size**: Small

### Phase 2B: Registration (10 endpoints, ~60 minutes)
- 7 mutations → audit events
- 2 mutations → ledger entries (money path)
- Create registrations table queries
- Emit status timeline events
- **PR Size**: Medium

### Phase 2C: Wallet & Gifting (7 endpoints, ~45 minutes)
- 2 endpoints → ledger entries
- 1 endpoint → gifting double-entry
- Emit gift transaction events
- **PR Size**: Small

### Phase 2D: KYC & Payouts (9 endpoints, ~45 minutes)
- 3 KYC endpoints → audit only
- 1 payout endpoint → ledger entry
- Call KYC provider
- **PR Size**: Medium

---

## Testing Checklist

For each money-path endpoint (5 total):
- [ ] Normal path: idempotency-key new → ledger entry posted
- [ ] Replay path: same idempotency-key → cached result returned
- [ ] Missing key: no idempotency-key → 400 error
- [ ] Tier check: insufficient tier → 403 error
- [ ] Limit check: over daily limit → 403 error
- [ ] Balance check: insufficient funds → 402 error
- [ ] Audit event: correct fields logged

For each audit-emitting endpoint (18 total):
- [ ] State change triggers audit log
- [ ] User ID and resource ID captured
- [ ] Old/new values logged

For each read-only endpoint (39+ total):
- [ ] Returns mock data currently
- [ ] Query executes after Phase 2
- [ ] RLS policies enforced by Supabase

---

## PR Strategy

**Recommendation**: 4 small PRs per 2B/2C/2D sections, 1 large PR for 2A:

1. **PR-1**: Admin API (23 endpoints, read-only, lowest risk)
2. **PR-2**: Registration (10 endpoints, complex, needs review)
3. **PR-3**: Wallet + Gifting (7 endpoints, money path, needs careful review)
4. **PR-4**: KYC + Payouts (9 endpoints, tier-gated, needs compliance review)

Each PR:
- Has test coverage (money-path operations)
- Includes documentation (ledger flow, audit events)
- Passes CI (build, type-check, existing tests)
- Can be reviewed independently

---

## Next Steps

1. Pick a handler to implement first (recommend Admin API — lowest risk, full coverage)
2. Create a feature branch per handler
3. Follow the implementation checklist above
4. Create PR with test coverage
5. Merge when tests pass
6. Repeat for next handler

Total estimated time: **3-4 hours** for all Phase 2 work across all 66+ endpoints.

---

**Ready to start implementation. Which handler should I tackle first?**
