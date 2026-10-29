# Payment Method Tracking in Commission/Profit Dashboard

## Overview

Enhanced the admin commission/profit dashboard and backend to track and display payment methods (card, wallet, transfer, etc.) for each earning and referral commission. This enables better visibility into how customers are funding purchases and which payment methods drive different services.

## Components

### 1. Frontend Enhancements

**File:** `frontend-admin/src/services/commissionService.ts`

#### New Types
- `CategoryPaymentBreakdown`: Aggregated earnings grouped by category, service, and payment method
  ```typescript
  export interface CategoryPaymentBreakdown {
    category: string;
    service: string;
    paymentMethod: string;
    count: number;
    grossAmountKobo: number;
    commissionKobo: number;
    spotlightRevenueKobo: number;
    referralCommissionKobo?: number;
  }
  ```

#### New Functions
- `buildCategoryPaymentBreakdown(earnings, referralRewards)`: Aggregates earnings data grouped by payment method and links referral commissions

#### Updated Types
- `Earning`: Added `paymentMethod?: string` field

#### Mock Data
- Updated `MOCK_EARNINGS` with sample payment methods (wallet, card, transfer)

**File:** `frontend-admin/app/admin/commission/profit/page.tsx`

#### New Sections
1. **"Breakdown by category, service & payment method"** table showing:
   - Service name
   - Payment method (badge-styled)
   - Transaction count
   - Gross amount
   - Commission
   - Spotlight revenue
   - Referral commission (if any)

#### Updated Sections
1. **"Recent earnings"** table now includes:
   - Payment method column (instead of Source)
   - Commission column (new)
   - Better column layout

#### Features
- Real-time aggregation of earnings by payment method
- Automatic linking of referral commissions to source transactions
- Color-coded payment method badges for visual distinction

### 2. Backend Enhancements

**File:** `backend/internal/finance/commission/payment_enricher.go` (NEW)

#### PaymentMethodResolver Service
- Resolves payment methods for source transactions based on module and reference
- Supports multiple modules:
  - `utility` / `bills`: Checks `utility_transactions.payment_source`
  - `restaurant` / `orders`: Placeholder (pending schema review)
  - `contest` / `voting`: Assumes wallet (most common)
  - `health` / `pharmacy`: Placeholder (pending implementation)
  - Others: Returns `unknown`

#### Supported Payment Methods
- `wallet`: Funds from user's wallet balance
- `card`: Paystack/debit card payment
- `transfer`: Bank transfer
- `cash`: Cash on delivery/payment
- `unknown`: Undetermined method

#### Key Functions
- `ResolvePaymentMethod(ctx, module, ref)`: Determines payment method for a transaction
- `EnrichEarning(ctx, earning)`: Adds payment method to a single earning
- `EnrichEarnings(ctx, earnings)`: Batch enriches multiple earnings

**File:** `backend/internal/finance/commission/service.go`

#### Changes
- Added `paymentEnricher *PaymentMethodResolver` field to `Service` struct
- Added `SetPaymentEnricher(e)` method to wire resolver
- Updated `ListEarnings()` to enrich earnings with payment method data before returning
- Updated `Earning` struct to include `PaymentMethod *string` field

**File:** `backend/internal/finance/commission/handler.go`

#### Changes
- Updated `RegisterCommission()` to instantiate and wire `PaymentMethodResolver`
- Payment enricher is automatically initialized with the database pool

**File:** `supabase/migrations/20271099000002_expand_payment_sources.sql` (NEW)

#### Database Changes
1. Expanded `utility_transactions.payment_source` check constraint to accept:
   - `'wallet'`
   - `'paystack'` (card)
   - `'transfer'`
   - `'cash'`

2. Added PostgreSQL helper function `get_earning_payment_method()`:
   - Resolves payment method from source transaction data
   - Can be used in advanced queries or future admin endpoints

3. Added database index for efficient payment method lookups

## Data Flow

```
Commission Earning Created
  ↓
commission_earnings table (no payment method stored here)
  ↓
[Admin requests earnings via /api/finance/commission/earnings]
  ↓
Repository queries commission_earnings
  ↓
Service.ListEarnings() calls PaymentMethodResolver.EnrichEarnings()
  ↓
Resolver joins with source transactions (e.g., utility_transactions)
  ↓
Enriched earnings returned to frontend with paymentMethod field
  ↓
Frontend aggregates by category/service/paymentMethod
  ↓
Dashboard displays breakdown with referral commission linking
```

## Deployment Steps

1. **Database Migration**
   ```bash
   supabase db push
   ```
   This will:
   - Expand the payment_source enum in utility_transactions
   - Create the helper function
   - Add the lookup index

2. **Backend Build & Deploy**
   - The commission service now automatically wires the payment enricher
   - No changes needed in main.go or app wiring
   - Code is backwards compatible

3. **Frontend Deployment**
   - New payment method breakdown will appear on profit dashboard
   - Existing sections remain unchanged

## Testing

### Frontend
- Dashboard shows payment method badges for recent earnings
- Breakdown table aggregates transactions correctly
- Referral commissions are linked to source transactions
- Mock data uses various payment methods

### Backend
- `PaymentMethodResolver` queries utility_transactions correctly
- Earnings are enriched only when resolver is wired
- Unknown transactions return `"unknown"` payment method
- Error handling is graceful (logs error, returns unknown)

## Future Enhancements

1. **Module Coverage**
   - Add payment method resolution for restaurant orders
   - Add for health/pharmacy transactions
   - Add for contest voting payments
   - Add for transfer/FX transactions

2. **Advanced Filtering**
   - Add payment method filter to profit dashboard
   - Show payment method-specific KPIs
   - Payment method comparison reports

3. **Daily Cap Exclusion** (from ADR-PR697)
   - Exclude card-funded utility debits from tier daily-cap sums
   - Requires SQL changes to `debit_wallet_atomic` RPC
   - TS changes to `enforceWalletLimit`

4. **Reconciliation Reports**
   - Payment method breakdown for reconciliation
   - Card vs wallet revenue analysis
   - Payment method health metrics

## Files Modified

### Frontend
- `frontend-admin/src/services/commissionService.ts`
- `frontend-admin/app/admin/commission/profit/page.tsx`

### Backend
- `backend/internal/finance/commission/payment_enricher.go` (NEW)
- `backend/internal/finance/commission/service.go`
- `backend/internal/finance/commission/handler.go`

### Database
- `supabase/migrations/20271099000002_expand_payment_sources.sql` (NEW)

## Notes

- Payment method data is enriched at query time (no storage in ledger)
- Gracefully handles missing source transactions (returns unknown)
- Backwards compatible: existing earnings without payment method info still work
- Frontend mock data demonstrates all payment method types
- Mock earnings automatically grouped by payment method in UI
