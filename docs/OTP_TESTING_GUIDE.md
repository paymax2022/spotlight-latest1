# OTP 2FA Testing Guide
**Testing the Complete Email Verification & 2FA Flow**

---

## Prerequisites

- Local environment running: Backend (Go), Frontend (Next.js), Supabase
- Test account credentials ready
- Brevo API key configured
- OTP feature flag enabled: `FEATURE_OTP_EMAIL_ENABLED=true`

---

## Test Scenario 1: Complete Signup with Email Verification

### Setup
```bash
# Verify environment variables
export FEATURE_OTP_EMAIL_ENABLED=true
export OTP_PEPPER="test-pepper-12345-min-32-bytes"
export BREVO_API_KEY="<your-key>"

# Ensure Supabase is running
supabase start

# Start backend
cd backend && go run cmd/api/main.go

# Start frontend
cd frontend-web && npm run dev
```

### Test Steps

**Step 1: Open signup page**
1. Go to `http://localhost:3000/auth/signup` (web) or mobile app
2. Form visible with: Full Name, Email, Phone, Password, Referral Code

**Expected:** ✅ Form loads without errors

---

**Step 2: Enter valid credentials**
```
Full Name:     "Test User"
Email:         "testuser+otp1@example.com"
Phone:         "+2348012345678"
Password:      "Test@1234"
Referral Code: (leave empty)
```

**Expected:** ✅ Form validates locally without errors

---

**Step 3: Submit signup**
1. Click "Create Account" button
2. Network request: `POST /api/auth/register`

**Expected:**
- ✅ Network tab shows 201 status
- ✅ Response contains:
  ```json
  {
    "user": {
      "id": "uuid-xxx",
      "email": "testuser+otp1@example.com",
      "fullName": "Test User"
    },
    "needsVerification": true
  }
  ```
- ✅ No `accessToken` or `refreshToken` in response

**Backend logs should show:**
```
[otp] issued verify_email code (purpose=verify_email, email=...)
```

---

**Step 4: Verify page loads**
1. Mobile: `/verify-otp` screen should appear
2. Web: Should show code input interface
3. Display shows: "Enter the 6-digit code sent to testuser+otp1@example.com"

**Expected:** ✅ OTP entry screen visible with 6 input boxes

---

**Step 5: Check email received**
1. Check email inbox for testuser+otp1@example.com
2. Subject: "Verify your Paymax email" (or similar)
3. Body contains: 6-digit code (e.g., "482913")

**Expected:** ✅ Email received within 10 seconds

---

**Step 6: Enter OTP code**
1. Look at email and copy the 6-digit code
2. On verify screen, enter digits one by one
3. Each box auto-focuses after digit entry

**Expected:**
- ✅ Input boxes show digits as typed
- ✅ Auto-focus works between boxes
- ✅ All 6 boxes filled

---

**Step 7: Submit OTP**
1. Click "Verify Code" button
2. Network request: `POST /api/auth/otp/verify`

**Expected:**
- ✅ Network shows 200 status
- ✅ Response:
  ```json
  {
    "success": true,
    "verified": true,
    "purpose": "verify_email"
  }
  ```
- ✅ No `accessToken` in response (not auto-signed-in)

**Backend logs:**
```
[otp] verified verify_email code (purpose=verify_email, email=...)
```

---

**Step 8: Redirected to login**
1. Mobile: Router should navigate to `/login` with notice: "Email verified. Please sign in."
2. Web: Login form appears

**Expected:** ✅ User sees login screen

---

**Step 9: Login with credentials**
1. Enter email: `testuser+otp1@example.com`
2. Enter password: `Test@1234`
3. Click "Sign In"

**Expected:**
- ✅ Network shows 200 status
- ✅ Response contains `accessToken` and `refreshToken`
- ✅ User logged in → Home screen
- ✅ Secure storage contains tokens

---

### Database Verification

After completing test, verify database state:

```sql
-- Check OTP code is consumed
SELECT key, attempts, expires_at FROM otp_codes 
WHERE key LIKE 'verify_email:%' 
ORDER BY created_at DESC LIMIT 1;
-- Expected: attempts should be 1 (consumed)

-- Check user was confirmed
SELECT email, email_confirmed FROM auth.users 
WHERE email = 'testuser+otp1@example.com';
-- Expected: email_confirmed = true

-- Check profile created
SELECT id, email, full_name FROM public.user_profiles 
WHERE email = 'testuser+otp1@example.com';
-- Expected: row exists with correct data
```

---

## Test Scenario 2: OTP Expiry

### Setup
```
Use same environment as Scenario 1
Set: OTP_TTL_MINUTES=0.5  (30 seconds for testing)
```

### Test Steps

1. **Signup and request OTP** (same as Scenario 1, steps 1-4)
2. **Wait for code to expire**
   - Default: 10 minutes
   - Test mode: wait for configured TTL
3. **Attempt to verify expired code**
   ```
   POST /api/auth/otp/verify
   {
     "email": "testuser+otp2@example.com",
     "code": "482913",
     "purpose": "verify_email"
   }
   ```

**Expected:**
- ✅ Status: 400
- ✅ Response:
  ```json
  {
    "success": false,
    "error": "code expired, request a new code"
  }
  ```
- ✅ User sees error message

---

## Test Scenario 3: Wrong OTP Code

### Test Steps

1. **Signup and get code** (steps 1-5)
2. **Enter wrong code**
   ```
   Correct: 482913
   Enter:   123456  (first attempt)
   ```
3. Click "Verify Code"

**Expected:**
- ✅ Status: 400
- ✅ Response:
  ```json
  {
    "success": false,
    "error": "invalid code"
  }
  ```
- ✅ Error message shown to user

4. **Try again with wrong code** (2nd, 3rd, 4th attempts)
   - Enter different wrong codes
   - Each attempt shows same error

5. **5th attempt (max reached)**
   - Enter 5th wrong code
   - Expected:
     ```json
     {
       "success": false,
       "error": "too many attempts, request a new code"
     }
     ```
   - User must request new code

---

## Test Scenario 4: Resend OTP

### Test Steps

1. **Signup and reach verify screen** (steps 1-4)
2. **Wait 60+ seconds**
3. **Request code again before submitting wrong one**
   - Click "Didn't receive it? Resend code"
   - Button shows "Sending…"

**Expected:**
- ✅ Network: `POST /api/auth/otp/request`
- ✅ Response: `{ "success": true, "expiresInSeconds": 600 }`
- ✅ User sees "A new code has been sent."
4. **Check email for new code**
   - Should receive new email within 10 seconds
   - Code will be different from first

**Expected:** ✅ New 6-digit code in inbox

5. **Enter new code and verify**

**Expected:** ✅ Verification succeeds

---

## Test Scenario 5: Resend Rate Limiting

### Test Steps

1. **Request code**
   ```
   POST /api/auth/otp/request
   { "email": "testuser+limit@example.com", "purpose": "verify_email" }
   ```
   Response: `{ "success": true }`

2. **Immediately request again (within 60 seconds)**
   ```
   POST /api/auth/otp/request (same email)
   ```

**Expected:**
- ✅ Status: 429
- ✅ Response:
  ```json
  {
    "success": false,
    "error": "please wait before requesting another code"
  }
  ```

3. **Wait 60 seconds, resend succeeds**

---

## Test Scenario 6: Per-IP Rate Limiting

### Test Steps

1. **Request codes from same IP, 5 different emails**
   ```
   for i in {1..5}:
     POST /api/auth/otp/request
     { "email": "testuser+$i@example.com" }
   ```

All succeed (per-address: 5/hour, per-IP: 20/hour)

2. **Request code 16th time from same IP within hour**

**Expected:**
- ✅ Status: 429
- ✅ Response: `{ "error": "please wait before requesting another code" }`

---

## Test Scenario 7: User Enumeration Prevention

### Test Steps

**Goal:** Verify that response is identical for existing and non-existing emails

1. **Request code for real account**
   ```
   POST /api/auth/otp/request
   { "email": "testuser+real@example.com", "purpose": "verify_email" }
   ```
   Response time: T₁, Status: 200

2. **Request code for non-existent email**
   ```
   POST /api/auth/otp/request
   { "email": "definitely.not.real+12345@example.com", "purpose": "verify_email" }
   ```
   Response time: T₂, Status: 200

**Expected:**
- ✅ Same HTTP status (200)
- ✅ Same response body: `{ "success": true, "message": "...", "expiresInSeconds": 600 }`
- ✅ Response times are similar (difference < 100ms)
- ✅ No error or confirmation that address exists/doesn't exist

**Why?** Prevents attacker from enumerating valid email addresses

---

## Test Scenario 8: Two-Factor Login

### Prerequisites
1. User already has verified email
2. User can login normally

### Test Steps

1. **Regular login succeeds if OTP not required**
   - Enterprise: Some users may not have OTP enabled

2. **If OTP enabled on login**
   ```
   POST /api/auth/login
   { "email": "testuser+verified@example.com", "password": "Test@1234" }
   ```
   Response:
   ```json
   {
     "success": false,
     "error": "mfa_required",
     "email": "testuser+verified@example.com"
   }
   ```

3. **Request login OTP code**
   - Code is issued by login endpoint itself (not via /request)
   - Email received with code

4. **Verify login code**
   ```
   POST /api/auth/otp/verify
   {
     "email": "testuser+verified@example.com",
     "code": "482913",
     "purpose": "login"
   }
   ```

**Expected:**
- ✅ Status: 200
- ✅ Response contains `accessToken` and `refreshToken`
- ✅ User logged in immediately
- ✅ Home screen appears

---

## Test Scenario 9: Invalid Requests

### Test 9a: Missing Email
```
POST /api/auth/otp/verify
{ "code": "482913", "purpose": "verify_email" }
```
**Expected:** ✅ 400, `{ "error": "invalid request" }`

### Test 9b: Invalid Email
```
POST /api/auth/otp/request
{ "email": "not-an-email", "purpose": "verify_email" }
```
**Expected:** ✅ 400, `{ "error": "invalid request" }`

### Test 9c: Invalid Purpose
```
POST /api/auth/otp/request
{ "email": "test@example.com", "purpose": "invalid_purpose" }
```
**Expected:** ✅ 400, `{ "error": "invalid request" }`

### Test 9d: Wrong Purpose on Verify
```
POST /api/auth/otp/verify
{ "email": "test@example.com", "code": "482913", "purpose": "password_reset" }
(when code was issued for "verify_email")
```
**Expected:** ✅ 400, `{ "error": "invalid code" }`

---

## Test Scenario 10: Feature Disabled

### Setup
```bash
export FEATURE_OTP_EMAIL_ENABLED=false
# Restart backend
```

### Test Steps

```
POST /api/auth/otp/request
{ "email": "test@example.com", "purpose": "verify_email" }
```

**Expected:**
- ✅ Status: 503
- ✅ Response:
  ```json
  {
    "success": false,
    "error": "feature_disabled",
    "feature": "otp_email"
  }
  ```

---

## Test Scenario 11: Missing Configuration

### Setup
```bash
# Unset required env var
unset OTP_PEPPER
# Restart backend
```

### Test Steps

```
POST /api/auth/otp/request
```

**Expected:**
- ✅ Status: 503
- ✅ Response: `{ "error": "misconfigured_no_pepper", "feature": "otp_email" }`
- ✅ Backend logs show ERROR message

---

## Test Scenario 12: Autofill & Paste

### Setup
- Mobile device or browser with autofill enabled

### Test 12a: Autofill
1. Complete signup to OTP screen
2. Receive code: "482913"
3. Browser/device offers autofill of code
4. Accept autofill

**Expected:**
- ✅ All 6 boxes filled: "4 8 2 9 1 3"
- ✅ Submit button enabled
- ✅ Verification succeeds

### Test 12b: Paste
1. Complete signup to OTP screen
2. Receive code: "482913"
3. Copy code from email
4. Tap first input box, paste ("482913")

**Expected:**
- ✅ Paste distributes across all boxes: "4 8 2 9 1 3"
- ✅ All 6 boxes filled
- ✅ No overflow in single box
- ✅ Verification succeeds

---

## Test Scenario 13: Concurrent Requests

### Test Steps

1. **Request OTP**
   ```
   POST /api/auth/otp/request
   { "email": "testuser+concurrent@example.com", "purpose": "verify_email" }
   ```
   Response: `{ "success": true }`

2. **Immediately make 2 verify requests simultaneously**
   ```
   Request A: POST /api/auth/otp/verify with code "482913"
   Request B: POST /api/auth/otp/verify with code "482913"  (same request)
   ```

**Expected:**
- ✅ Request A: 200, `{ "verified": true }`
- ✅ Request B: 400, `{ "error": "invalid code" }`
- ✅ Only first request succeeds (single-use)

---

## Manual Verification Checklist

After running all tests, verify manually:

```
✅ Email formatting looks good
✅ Code expiry time is accurate
✅ Resend link is clickable
✅ Error messages are user-friendly
✅ No OTP code visible in logs/errors
✅ No secrets visible in network tab
✅ Loading states display correctly
✅ Success state shows confirmation
✅ Back button works at each step
✅ Screen rotation handled (mobile)
✅ Keyboard dismisses on submit
✅ Accessibility labels present
```

---

## Performance Benchmarks

Target metrics:

| Operation | Target | Status |
|-----------|--------|--------|
| Request OTP | < 500ms | Measure |
| Verify OTP | < 200ms | Measure |
| Email delivery | < 5s | Measure |
| Database queries | < 50ms | Measure |
| Brevo API call | < 5s | Measure |

---

## Logging Checklist

After tests, verify logs:

**Backend should show:**
```
[otp] issued verify_email code
[otp] verified verify_email code
[otp] rate limit hit: send budget exceeded
[otp] rate limit hit: verify budget exceeded
```

**Logs should NOT contain:**
```
❌ Plaintext OTP codes
❌ User email addresses
❌ Hash digests
❌ API keys or secrets
```

---

## Cleanup After Testing

```bash
# Delete test OTP codes
DELETE FROM otp_codes 
WHERE key LIKE 'verify_email:%'
AND created_at > now() - interval '1 hour';

# Delete test user profiles
DELETE FROM public.user_profiles 
WHERE email LIKE 'testuser+%@example.com';

# Delete test auth.users (if needed)
DELETE FROM auth.users 
WHERE email LIKE 'testuser+%@example.com';
```

---

## Troubleshooting During Testing

| Problem | Solution |
|---------|----------|
| Email not received | Check Brevo credentials, check spam folder |
| Code always wrong | Check OTP_LENGTH matches (default 6) |
| Rate limit on first try | Check previous test didn't create old codes |
| 503 errors | Check FEATURE_OTP_EMAIL_ENABLED=true, all env vars set |
| Auto-focus not working | Clear browser cache, test in incognito |
| Feature appears disabled | Check FEATURE_OTP_EMAIL_ENABLED and all credentials |

---

## Summary

After completing these 13 scenarios + manual checks, the OTP system is verified as:
- ✅ Functionally complete
- ✅ Secure against common attacks
- ✅ User-friendly with good error handling
- ✅ Rate-limited correctly
- ✅ Logging safely (no secrets exposed)
- ✅ Ready for production
