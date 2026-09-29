# ADR-PR-: Paystack Bank Account Verification in Restaurant Onboarding

**Status:** Proposed  
**Date:** 2026-09-29  
**Deciders:** Paymax fintech team

## Context

Restaurant owners must provide and validate settlement bank accounts for payouts. Currently, the `AddBankAccount` flow captures the account details but **does not verify** them against the actual banking system. This creates friction:

- Restaurant owners may enter incorrect account numbers or names
- Invalid accounts are only discovered when a payout attempts to process (settlement failure → support ticket)
- No real-time feedback during onboarding means customers leave the flow uncertain

Paystack provides a NUBAN account verification API (`/bank/resolve`) that performs synchronous name-enquiry on the banking network. The backend already has a `DisbursementProvider.ResolveAccount()` method (implemented in `backend/internal/provider/paystack/paystack.go:203`) that wraps this endpoint. **The capability exists but is unused.**

### Key constraints
- Account verification is **optional** on add (not fail-closed) — legacy or manual accounts may skip it
- The existing database schema already has `is_verified` boolean on `restaurant_bank_accounts`
- Restaurant payout runs currently use the first (default) account; if unverified, the payout attempt will fail
- The money-path pattern requires idempotent requests; bank-account add is already idempotent on `(user_id, bank_code, account_number)`

## Decision

Add **real-time account verification** to the `AddBankAccount` flow:

1. **Backend (`service.go::AddBankAccount`)**  
   - After validating the account-number format (10 digits), call `s.disbursement.ResolveAccount(ctx, bankCode, accountNumber)` 
   - If the call succeeds, store the verified account and set `is_verified=true`
   - If the call fails (Paystack returns non-2xx, network timeout, or invalid account), **still save the account** but set `is_verified=false`
   - Return the account with `is_verified` status to the client

2. **Frontend (admin onboarding + merchant dashboard)**  
   - Add a "Verify account" button or auto-trigger after bank/account fields are filled
   - Call a new `/api/v1/restaurant/bank-accounts/verify` endpoint (POST) with `bankCode` + `accountNumber`
   - Display real-time feedback:
     - ✅ "Account verified: [AccountName]" if Paystack confirms the name
     - ⚠️ "Could not verify. Check details or save and verify later." if the API fails
     - 🔒 "Account saved but not verified" as a fallback state
   - Show the verified account name from Paystack, allowing the user to confirm it matches their records

3. **New `/verify` endpoint (optional POST)**  
   - Allow re-verification of a previously-saved (but unverified) account
   - Endpoint: `POST /api/v1/restaurant/bank-accounts/:accountID/verify`
   - Body: empty (use account details from the stored record)
   - Response: updated `BankAccount` with `is_verified` flag

4. **Audit & Monitoring**  
   - Emit a `bank_account_verified` audit event when `is_verified` transitions from false → true
   - Log payout-readiness warnings in admin if the default account is unverified

## Options Considered

### Option A: Verify on Add (Chosen)
| Dimension | Assessment |
|-----------|------------|
| User friction | Low — real-time feedback during form fill |
| Complexity | Medium — requires Paystack API call in the add flow |
| Reliability | Medium — Paystack API can timeout; must fail gracefully |
| Team familiarity | High — reuses existing `DisbursementProvider.ResolveAccount()` |

**Pros:**
- Catches errors immediately while the user is still onboarding
- Reduces support tickets from failed payouts due to bad accounts
- Leverages existing Paystack integration

**Cons:**
- Adds latency to the add operation (Paystack API round-trip)
- If Paystack is down, prevents account adds (must have fallback)

### Option B: Verify on First Payout (Rejected)
| Dimension | Assessment |
|-----------|------------|
| User friction | High — error discovered days after onboarding, requires follow-up |
| Complexity | Low — no new endpoints |
| Reliability | High — verification only attempted when payout is ready |
| Team familiarity | High — existing settlement flow |

**Pros:**
- No latency on account add
- Only verifies accounts that will actually be used

**Cons:**
- Restaurant owner discovers bad account mid-settlement
- Support burden shifts to the payout flow
- Bad UX: "Your payout failed, please update your bank account"

### Option C: Optional Manual Verification Button (Rejected)
| Dimension | Assessment |
|-----------|------------|
| User friction | Very High — depends on user action, many skip it |
| Complexity | Medium — new button + endpoint |
| Reliability | High — no mandatory latency |
| Team familiarity | Medium — adds UI complexity |

**Pros:**
- No forced latency
- User controls when verification happens

**Cons:**
- Most owners will skip it
- Reverts to "discover error at payout time" failure mode
- Support burden unchanged

## Trade-off Analysis

**Latency vs. UX:** Option A adds ~200–500ms per add (Paystack API call), but catches errors in the moment when the user can fix them. This is worth the latency cost because:
- Account add is not a high-frequency operation (typically 1–3 per restaurant owner)
- The improvement in UX and support efficiency outweighs the latency
- Paystack's timeout is 30s (generous for a name enquiry), and failures fall back gracefully

**Fail-open strategy:** If Paystack is unreachable, the account is still saved with `is_verified=false`. This is intentional:
- Accounts are still usable for payouts (the payout flow will attempt disbursement)
- Operators can manually verify accounts in the admin console later
- Does not block restaurant owner onboarding
- Aligns with the existing resilience pattern: verification is "nice to have," not "required to operate"

**Backwards compatibility:** The database already has `is_verified`; no migration required. Existing unverified accounts stay as-is.

## Consequences

**What becomes easier:**
- Restaurant owners receive immediate feedback on bad account details during onboarding
- Support can spot unverified accounts in the admin console and flag them proactively
- Payout runs can log warnings/metrics when using unverified accounts

**What becomes harder:**
- Onboarding flow now depends on Paystack availability (mitigated by fail-open)
- Account add latency increases by ~200–500ms (negligible for a low-frequency operation)

**What we'll need to revisit:**
1. **Paystack availability SLA**: If Paystack becomes unreliable, re-evaluate the fail-open strategy vs. requiring verification
2. **Other banks/providers**: If supporting disbursement providers beyond Paystack (Monnify, Flutterwave), each must implement `ResolveAccount()` or add a fallback
3. **Account update flow**: Currently, restaurants cannot update an account (only add/delete). If we add account updates, we should re-verify on update
4. **Verification retry**: Consider exposing a "retry verification" endpoint in the admin for stuck unverified accounts

## Action Items

1. [ ] Add `disbursement.ResolveAccount()` call to `AddBankAccount()` in `backend/internal/restaurant/service.go`
2. [ ] Return `is_verified` status in `AddBankAccount` response and `BankAccount` model
3. [ ] Create `/api/v1/restaurant/bank-accounts/:id/verify` POST endpoint for manual re-verification
4. [ ] Emit `bank_account_verified` audit event when verification completes
5. [ ] Frontend: Add real-time verify button to restaurant onboarding flow (admin + merchant dashboard)
6. [ ] Frontend: Display verified account name + verification status badge
7. [ ] Admin console: Add "Unverified accounts" indicator in payout-readiness warnings
8. [ ] Add integration test: verify a good account, verify a bad account, verify with Paystack timeout (fail-open)
9. [ ] Metrics: Log `restaurant.bank_account.verified` and `restaurant.bank_account.verify_failed` events
10. [ ] Documentation: Update CLAUDE.md restaurant section with "Account verification is automatic; failures fall back gracefully"
