# Mobile App — Local Supabase Testing Guide

**Objective:** Verify all mobile features are connected to and working with local Supabase  
**Date:** 2026-08-12

---

## Quick Start Test (5 minutes)

### 1. Verify Supabase Connectivity

#### Check PostgreSQL Database
```bash
PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres -c "\dt public.*" | grep registrations
```

Expected output:
```
 registrations                | table | postgres
 registration_status_events   | table | postgres
```

#### Check REST API (Direct)
```bash
curl -s http://127.0.0.1:54321/rest/v1/registrations | head -20
```

Expected output:
```
[]
```

### 2. Test Mobile App Authentication

**Steps:**
1. Open mobile app at http://localhost:8083
2. Tap "Sign Up" or "Log In"
3. Enter test credentials:
   - Email: `test@local.com`
   - Password: `Test@123456`
4. Click "Sign Up"

**Expected Result:**
- ✅ Account created or logged in
- ✅ Redirected to dashboard
- ✅ User profile visible

**Verify in Supabase:**
```bash
PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres \
  -c "SELECT id, email FROM auth.users LIMIT 5;"
```

### 3. Test Registration Flow (End-to-End)

**Mobile App Steps:**
1. Login with test account
2. Navigate to "Registrations" or "Contests"
3. Find a contest to register for
4. Tap "Register"
5. Fill out the multi-step form:
   - Personal Info (name, email, date of birth)
   - Contact Info (phone, address)
   - Other required fields
6. Tap "Submit Registration"
7. See confirmation message

**Expected Result:**
- ✅ Form submits without errors
- ✅ GET `/api/registration/applications` returns empty (no data yet)
- ✅ POST `/api/registration/applications` succeeds with 201
- ✅ Registration saved to Supabase

**Verify in Supabase:**
```bash
# Check if registration was saved
PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres \
  -c "SELECT id, reference, status, form_data FROM public.registrations;"

# Should show your registration with:
# - id: UUID
# - reference: SPOT-XXXXX-ABC
# - status: draft or submitted
# - form_data: JSON with form answers
```

### 4. Test Admin Dashboard Display

**Steps:**
1. Open admin dashboard: http://localhost:3001/admin/competitions/participants
2. Look for registered participants in the table

**Expected Result:**
- ✅ Table loads (or shows "No participants yet")
- ✅ If registrations exist: can see name, email, status
- ✅ Can search by name or reference
- ✅ Can filter by status
- ✅ Can view details by clicking "View" button

**Note:** There's currently a rendering issue with the admin dashboard. If you don't see participants, check:
1. Registration was saved: `curl http://127.0.0.1:54321/rest/v1/registrations`
2. Should return: `[{"id":"...", "reference":"...", ...}]`

---

## Complete Feature Test (30 minutes)

### Test Group 1: Authentication & Session

**Test 1.1: Sign Up**
```
✅ Can create new account
✅ Email verification works (or mocked)
✅ Can set password
✅ Redirects to dashboard
```

**Test 1.2: Log In**
```
✅ Can log in with email/password
✅ Session persists across app restarts
✅ Can log out
✅ Login state clears on logout
```

**Test 1.3: Session Recovery**
```
✅ Token auto-refresh works
✅ Can stay logged in for extended use
✅ Expired tokens trigger re-login
```

### Test Group 2: Registration Module

**Test 2.1: Registration Creation**
```bash
# Before test
BEFORE=$(curl -s http://127.0.0.1:54321/rest/v1/registrations | wc -l)

# Test: Register a contestant via mobile app

# After test
AFTER=$(curl -s http://127.0.0.1:54321/rest/v1/registrations | wc -l)

# Verify: $AFTER > $BEFORE
```

**Test 2.2: Form Validation**
```
✅ Required fields are validated client-side
✅ Cannot submit invalid data
✅ Error messages are clear
✅ Validation matches backend rules
```

**Test 2.3: Status Tracking**
```bash
# Get registration status
REGISTRATION_ID=$(curl -s http://127.0.0.1:54321/rest/v1/registrations | \
  jq -r '.[0].id')

# Check status
curl -s http://127.0.0.1:54321/rest/v1/registrations?id=eq.$REGISTRATION_ID | \
  jq '.[] | {status, current_step, completion_percent}'

# Expected: draft, submitted, awaiting_payment, etc.
```

### Test Group 3: Real-time Features

**Test 3.1: Real-time Updates**
- Open mobile app in two browser windows
- In one window: Make a change (register, update profile)
- In other window: Watch for real-time update
- ✅ Changes appear without refresh

**Test 3.2: Marketplace Real-time**
- Open marketplace in two tabs
- Update inventory in admin/backend
- ✅ Prices/availability update in both tabs

### Test Group 4: Wallet & Transactions

**Test 4.1: Wallet Balance**
```bash
# Query wallet data
PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres \
  -c "SELECT user_id, balance_kobo FROM wallet LIMIT 5;"
```

**Test 4.2: View Transactions**
- ✅ Can see transaction history
- ✅ Amounts display correctly
- ✅ Timestamps are accurate

### Test Group 5: Profile Management

**Test 5.1: View Profile**
- ✅ Current user profile displays
- ✅ All fields visible
- ✅ Avatar loads

**Test 5.2: Edit Profile**
- ✅ Can update name
- ✅ Can update email
- ✅ Can upload new avatar
- ✅ Changes saved to Supabase

### Test Group 6: Connect (Discovery)

**Test 6.1: Browse Users**
- ✅ Can swipe through profiles
- ✅ Loading indicator shows during fetch
- ✅ Profile cards display correctly

**Test 6.2: Like/Match**
- ✅ Can like a profile
- ✅ Like saved to Supabase
- ✅ Match notifications work

**Test 6.3: Boost Purchase**
- ✅ Can purchase boost
- ✅ Wallet debited correctly
- ✅ Boost activated

---

## Data Verification Queries

### View All Registrations
```bash
PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres \
  -c "SELECT id, reference, status, completion_percent FROM public.registrations ORDER BY created_at DESC;"
```

### View Registration Details
```bash
PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres \
  -c "SELECT reference, form_data FROM public.registrations WHERE reference='SPOT-XXXXX-ABC';"
```

### Check Status Events
```bash
PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres \
  -c "SELECT * FROM public.registration_status_events ORDER BY created_at DESC LIMIT 10;"
```

### View Users
```bash
PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres \
  -c "SELECT id, email, created_at FROM auth.users LIMIT 10;"
```

### Check Wallet
```bash
PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres \
  -c "SELECT user_id, current_balance_kobo FROM wallet LIMIT 5;"
```

---

## Common Issues & Fixes

### Issue: "Supabase is not configured"
**Cause:** Missing `.env` variables  
**Fix:** Verify `.env` has:
```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH
```
**Restart:** Kill and restart Expo dev server

### Issue: "Failed to fetch registrations: PGRST205"
**Cause:** PostgREST schema cache issue  
**Fix:**
```bash
docker restart supabase_rest_spotlight
```

### Issue: "Cannot create registration - 401 Unauthorized"
**Cause:** Not authenticated  
**Fix:** Log in first, verify JWT token is valid

### Issue: "Registration saved but not visible in admin"
**Cause:** Admin dashboard JWT issue  
**Fix:** See admin dashboard debugging guide  
**Workaround:** Query via REST API directly:
```bash
curl http://127.0.0.1:54321/rest/v1/registrations
```

---

## Performance Benchmarks

### Expected Response Times (Local)
- Authentication: < 500ms
- List registrations: < 200ms
- Create registration: < 300ms
- Real-time updates: < 100ms

### Data Points to Track
- Number of registrations
- Total bandwidth used
- Average response time
- Error rate

---

## Success Criteria

✅ **Mobile Supabase Integration is Complete When:**

1. ✅ Authentication works (sign up, login, logout)
2. ✅ Registrations save to local Supabase
3. ✅ Can create, read, update registration status
4. ✅ Real-time updates work (Realtime API)
5. ✅ Wallet balance queryable
6. ✅ Profile management works
7. ✅ All RLS policies enforced
8. ✅ No errors in console
9. ✅ Admin dashboard displays data (once rendering fixed)
10. ✅ End-to-end flow works (register → admin views → status updated)

---

## Test Results Template

```
TEST DATE: 2026-08-12
TESTED BY: [Your Name]
ENV: Local Supabase (http://127.0.0.1:54321)

Authentication:
  [✅/❌] Sign up works
  [✅/❌] Log in works
  [✅/❌] Session persists
  [✅/❌] Log out works

Registration:
  [✅/❌] Can create registration
  [✅/❌] Data saved to Supabase
  [✅/❌] Validation works
  [✅/❌] Can submit application
  [✅/❌] Status tracked

Wallet:
  [✅/❌] Can view balance
  [✅/❌] Can see transactions
  [✅/❌] Real-time updates

Profile:
  [✅/❌] Can view profile
  [✅/❌] Can edit profile
  [✅/❌] Changes persist

Other:
  [✅/❌] Connect discovery works
  [✅/❌] Real-time features work
  [✅/❌] No console errors

BLOCKERS: [List any issues]
NOTES: [Additional observations]
```

---

## Manual Testing Script (Automated)

Run this to test all APIs:

```bash
#!/bin/bash
set -e

SUPABASE_URL="http://127.0.0.1:54321"
API_BASE="http://localhost:3000"

echo "Testing Supabase connectivity..."
curl -s "$SUPABASE_URL/rest/v1/registrations" | wc -l

echo "Testing API connectivity..."
curl -s "$API_BASE/api/registration/contests" | wc -l

echo "Testing authentication..."
curl -s -X POST "$API_BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@local.com","password":"Test@123"}' | head -50

echo "All tests completed!"
```

---

## Next Steps

1. Run quick start test (5 min)
2. If successful, run complete feature test (30 min)
3. Document results in template above
4. Report any blockers
5. Fix issues and re-test
