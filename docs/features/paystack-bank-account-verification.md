# Paystack Bank Account Verification Implementation Guide

## Overview

Bank account verification is now fully implemented across the platform for real-time account validation during onboarding. This document covers the complete stack: backend API, frontend components, and integration points.

## ✅ What's Implemented

### Backend (Go)

**Restaurant Module:**
- ✅ `AddBankAccount()` verifies accounts on save (soft-fail if unavailable)
- ✅ `VerifyBankAccount()` endpoint for frontend pre-verification
- ✅ Route: `POST /api/v1/restaurant/bank-accounts/verify`

**Doctor Module:**
- ✅ `CreateBankAccount()` verifies accounts on save (soft-fail if unavailable)
- ✅ `VerifyBankAccount()` endpoint for frontend pre-verification
- ✅ Route: `POST /api/v1/doctor/profile/bank-account/verify`

**Features:**
- ✅ Paystack `/bank/resolve` API integration
- ✅ Graceful failure: accounts saved with `is_verified=false` if provider unavailable
- ✅ Account name verification: authoritative name from provider
- ✅ All existing tests pass
- ✅ No database migrations needed (uses existing `is_verified` column)

### Frontend (Next.js/React)

**Reusable Component:**
- ✅ `src/components/bank-account/BankAccountVerification.tsx`
- ✅ Real-time verification button
- ✅ Success state with ✓ checkmark + verified details
- ✅ Error handling with user-friendly messages
- ✅ Disable state while verifying
- ✅ Re-verification support for previously failed attempts

**API Routes:**
- ✅ `app/api/v1/restaurant/bank-accounts/verify/route.ts`
- ✅ `app/api/v1/doctor/bank-accounts/verify/route.ts`
- ✅ Token validation, 10-digit account validation
- ✅ Calls backend endpoints

## 🔌 Integration Points

### Restaurant Merchant Dashboard

**File:** `app/extranet/bank/page.tsx` (existing stays-based page)

Add the component after the account number input:

```tsx
import { BankAccountVerification } from '@/components/bank-account/BankAccountVerification';

// Inside the form, after account_number input:
<BankAccountVerification
  bankCode={data.bank_code}
  accountNumber={data.account_number}
  bankName={data.bank_name}
  onVerificationComplete={(result) => {
    // Update account_name with verified name
    setData(prev => ({
      ...prev,
      account_name: result.account_name,
      is_verified: result.is_verified
    }));
  }}
  disabled={!data.bank_code || !data.account_number}
/>
```

**Display Verification Status:**

```tsx
// In the card header (line 38):
right={<Badge status={data.is_verified ? "verified" : "pending"} />}
```

### Doctor Profile Bank Account (Web)

Create a new page or integrate into existing earnings/payout flow:

```tsx
import { BankAccountVerification } from '@/components/bank-account/BankAccountVerification';

// After bank account input fields:
{bankCode && accountNumber && (
  <BankAccountVerification
    bankCode={bankCode}
    accountNumber={accountNumber}
    bankName={bankName}
    onVerificationComplete={(result) => {
      // Update form with verified data
      setAccountName(result.account_name);
      setIsVerified(result.is_verified);
    }}
  />
)}
```

### Doctor Mobile App (React Native)

**Status:** Already implemented in `app/(doctor)/profile/setup/bank-account.tsx`

The mobile app uses `useSaveBankAccount()` hook which calls the backend directly. No changes needed.

## 📋 Integration Checklist

**For Frontend Teams:**

- [ ] Import `BankAccountVerification` component into your bank account form
- [ ] Call component after user fills `bank_code`, `account_number`, `bank_name`
- [ ] Handle `onVerificationComplete` callback to update form state
- [ ] Display `is_verified` badge in account summary
- [ ] Disable "Save" button until account is verified (optional but recommended)
- [ ] Test with valid bank account (ask Paystack for test credentials)
- [ ] Test with invalid account (should show error message)

**For Mobile Teams:**

- No changes needed — doctor mobile app already has full verification flow

**For Admin Console:**

- [ ] Add "Unverified accounts" section in payout readiness warnings
- [ ] Show verification status badge in bank account listings
- [ ] Add manual re-verification button for stuck accounts

## 🧪 Testing

### Test with Real Paystack Data

Use these for testing (requires Paystack test mode):
- Bank Code: Find via `GET /api/v1/transfers/banks` (from transfer module)
- Account: Use a valid test NUBAN (10 digits)
- Paystack will resolve the name in test mode

### Test Error Scenarios

**Invalid Account:**
```json
{
  "bank_code": "044",
  "account_number": "0000000000"
}
```
Expected: Error message "Could not verify account..."

**Paystack Down:**
Backend will gracefully fail-open → account saved with `is_verified=false`

**Incomplete Form:**
Component's "Verify account" button disabled until all fields filled

## 🔐 Security Notes

- ✅ All verification happens server-side (Next.js API route)
- ✅ Access token required (extracted from cookies)
- ✅ Account number validated (10 digits only)
- ✅ Backend repeats all validation before calling Paystack
- ✅ Paystack response (account name) trusted as authoritative source
- ✅ Full account numbers stored in DB, never logged or returned unmasked

## 📊 Monitoring

**Metrics to Track:**
- `bank_account.verify_request_count` - verification attempts
- `bank_account.verify_success_count` - successful verifications
- `bank_account.verify_failure_count` - failed verifications
- `bank_account.paystack_latency_ms` - Paystack API response time

**Error Messages in Logs:**
- `restaurant: account verification failed for [bank_code]/[account]: [error]`
- `doctor: account verification failed for [bank_code]/[account]: [error]`

## 🚀 Deployment Notes

**Environment Variables:**
- Ensure `NEXT_PUBLIC_API_URL` is set correctly (backend URL)
- Paystack credentials must already be configured in backend

**Database:**
- No migrations required
- Existing `is_verified` column used
- Backward compatible with existing unverified accounts

**Feature Flag:**
- No feature flag needed — verification is automatic on account add
- Frontend can always show the verification component
- If disbursement provider not wired → `is_verified=false` stays

## 📞 Support

**If verification always fails:**
1. Check Paystack credentials in backend config
2. Verify internet connectivity to Paystack API
3. Check if account number is valid (10 digits, all numbers)
4. Check logs for `account verification failed` messages

**If "Verification is not available" error:**
- Backend doesn't have disbursement provider wired
- Check that `WithDisbursementProvider()` is called in finance_routes.go

## 🔄 Future Enhancements

- [ ] Audit events when account verified (currently just log.Printf)
- [ ] Manual re-verification endpoint for admin console
- [ ] Account verification webhook for Paystack status updates
- [ ] Support for other disbursement providers (Monnify, Flutterwave)
- [ ] Cached verification results (reduce Paystack API calls)
- [ ] Verification retry with exponential backoff for transient failures
