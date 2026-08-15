# Registration Module

## Overview

This module handles the registration wizard and application lifecycle for contests. It uses an in-memory store with disk persistence to maintain application drafts.

## Architecture

### Store Behavior

- **In-Memory Storage**: Applications are stored in `globalThis` for fast access
- **Disk Persistence**: Store is persisted to a temp file (`/tmp/spotlight-registration-store-*.json`) to survive server restarts
- **No Database**: Currently doesn't use Supabase; keep this in mind when debugging missing applications
- **Fallback**: Store loads from disk on startup; if disk file is missing, starts empty

### Key Concepts

1. **Application ID**: UUID generated when draft is created via `startRegistrationDraft()`
2. **Draft**: Contains form data, status, completion %, fraud flags
3. **Steps**: Schema-driven form steps built from contest definition and draft state
4. **Status Timeline**: Immutable event log tracking status changes

## Common Issues & Debugging

### "Application not found" (404)

**Cause**: Mobile app requesting draft that doesn't exist in store
- Happens when store was cleared (server restart, disk file deleted)
- Mobile client has stale draft ID from previous session
- Draft was never created (network error during `startRegistrationDraft`)

**Fix**:
1. Check console for warnings: `[registration/store] draft not found for ID: ...`
2. Start a fresh application: `GET /api/registration/applications` → create new draft
3. Verify store file exists: check `/tmp/spotlight-registration-store-*.json`

### "Failed to load registration application: 500"

**Cause**: Unhandled error in GET/PATCH handlers
- Malformed request (invalid ID, missing params)
- Store access failure
- Form validation error

**Fix**:
1. Check terminal logs for `[registration-error]` with full stack trace
2. Ensure request includes valid `applicationId` in URL path
3. For PATCH, verify request body has `stepKey` and `values`

## API Endpoints

### GET `/api/registration/applications/{id}`
- Fetch draft and build schema-driven steps
- Requires: valid application ID, authenticated user who owns the draft
- Returns: 404 if draft missing, 403 if user doesn't own it

### PATCH `/api/registration/applications/{id}`
- Save step data and validate
- Requires: valid application ID, authenticated user, body with `stepKey` and `values`
- Returns: updated draft with validation results

### POST `/api/registration/applications/{id}/submit`
- Submit application (all steps validated)
- Returns: submitted draft or validation errors

## Error Handling

All errors follow this pattern:
1. Log with full context (endpoint, userId, applicationId, stepKey, stack)
2. Return appropriate HTTP status and message
3. Never expose internal errors to client (wrap or simplify message)

See `error-handler.ts` for centralized error handling.

## To Move to Database

When migrating from in-memory store to Supabase:

1. Add `registrations` table with columns:
   - `id` (UUID primary key)
   - `user_id` (foreign key to auth.users)
   - `contest_slug` (string)
   - `status` (enum: draft, submitted, etc.)
   - `form_data` (jsonb)
   - `completion_percent` (int)
   - `fraud_flags` (jsonb array)
   - `created_at` / `updated_at` / `submitted_at` (timestamps)

2. Update `getRegistrationDraft()` to query Supabase instead of memory
3. Update `saveRegistrationStep()` to use Supabase update
4. Remove disk persistence code (lines 54-123 in store.ts)
5. Update error messages to reference Supabase constraints

## Best Practices

1. **Always validate IDs**: Use `validateApplicationId()` from `error-handler.ts`
2. **Always log context**: Include endpoint, userId, applicationId in logs
3. **Never assume state**: Check draft exists before accessing properties
4. **Fail fast**: Return 4xx errors for client issues, log and return 5xx for server issues
5. **Test with fresh store**: Clear `/tmp/spotlight-registration-store-*.json` to test from scratch
