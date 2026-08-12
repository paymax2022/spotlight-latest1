# Registration Validation Sync — Mobile ↔ Backend

This document describes how mobile client-side validation syncs with backend validation to prevent errors and provide immediate feedback to users.

## Architecture

```
Mobile (RN)                          Backend (Next.js)
─────────────────────────────────────────────────────
┌──────────────────┐                ┌──────────────────┐
│ wizard.tsx       │ ──PATCH───────> │ route.ts         │
│ (validateNext)   │ (edits)         │ (error handler)  │
└──────────────────┘                └──────────────────┘
       ↓                                   ↓
┌──────────────────┐                ┌──────────────────┐
│ validation.ts    │                │ store.ts         │
│ (validateStep)   │                │ (saveStep)       │
│ (validateField)  │                │ (validateField)  │
└──────────────────┘                └──────────────────┘
       ↓                                   ↓
  show errors                      return 400 if invalid
  to user                          return 200 if valid
```

## Validation Layers

### Layer 1: Client-Side (Mobile) — Immediate Feedback

**File:** `src/features/registration/lib/validation.ts`

Validates required fields **before** sending to backend:
- Prevents sending incomplete data
- Shows errors immediately (no network wait)
- Mirrors backend validation rules exactly

**Functions:**
- `validateField(field, value)` — validates one field against its type and requirements
- `validateStep(step, formData)` — validates all fields in a step
- `validateRequiredFields(step, formData, edits)` — validates only required fields
- `areAllRequiredFieldsFilled(step, formData, edits)` — returns boolean

**Used in:** `app/registration/[id]/wizard.tsx`
```typescript
const handleNext = () => {
  // Client-side validation first
  const errors = validateRequiredFields(step, draft?.formData ?? {}, edits);
  if (Object.keys(errors).length > 0) {
    setErrors(errors);  // Show to user, don't send to backend
    return;
  }

  // All required fields filled, send to backend
  saveStep.mutate({ stepKey: step.key, values: edits }, {
    onSuccess: (res) => {
      // Backend may have additional validation (format, constraints, etc.)
      if (!res.validation.isValid) {
        setErrors(res.validation.errors);  // Show backend errors if any
        return;
      }
      // Step validated, move to next
      setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    },
    onError: (err) => {
      // Handle network/server errors (400, 500, etc.)
      console.error('Save failed:', err.message);
      // Show generic error banner
    },
  });
};
```

### Layer 2: Backend Validation — Final Gate

**File:** `frontend-web/src/server/registration/store.ts`

Validates the saved step data:
- Runs validation after merging edits with draft
- Returns 200 with validation errors if invalid (allows user to fix)
- Returns 200 with validated draft if valid
- Returns 4xx/5xx for malformed requests

**Validation Rules:**
1. **Required fields** — checked for all step fields marked `required: true`
2. **Type validation** — email, tel, date, number formats
3. **Step-specific rules:**
   - `account_gate`: password length ≥8, password confirmation match
   - `emergency_contact`: emergency phone ≠ applicant phone
   - `contest_selection`: selected contest valid, state/city pairs match

### Layer 3: Error Handler — Consistent Responses

**File:** `frontend-web/src/server/registration/error-handler.ts`

Maps all errors to appropriate HTTP status codes:
- 400 — malformed request (invalid ID, missing JSON)
- 401 — authentication required
- 403 — user doesn't own this application
- 404 — application not found
- 500 — unexpected server error

## Field Types & Validation

| Type | Required Check | Additional Validation | Error Message |
|------|---|---|---|
| `text` | value.trim().length > 0 | none | "{label} is required." |
| `email` | value.trim().length > 0 | matches `/.+@.+\..+/` | "Please enter a valid email for {label}." |
| `tel` | value.trim().length > 0 | matches `+?[0-9][0-9\-\s]{6,}` | "Please enter a valid phone number for {label}." |
| `select` | value in options | value in field.options | "Please select a valid option for {label}." |
| `multi_select` | arr.length > 0 | all items in options | "Please select valid options for {label}." |
| `checkbox` | value === true | none | "{label} is required." |
| `date` | value.trim().length > 0 | valid ISO date | "{label} must be a valid date." |
| `number` | value !== '' | Number.isNaN(num) === false | "{label} must be a number." |
| `file` | hasUploadValue(value) | file object shape | "{label} is required." |

## Mobile-Specific: File Upload Value Shape

Mobile app stores file uploads as objects:
```typescript
{
  previewUrl?: string,   // For preview display
  fileName: string,      // File name
  storageKey: string,    // Cloudflare R2 key
}
```

Backend's `hasUploadValue()` accepts this shape OR a plain string (web preview URL).

## Sync Checklist

When adding a new field to the registration form:

1. ✅ Add field to the contest's `registrationFeeNgn.fields[]` in backend config
2. ✅ Set `required: true` if mandatory
3. ✅ Set `type: 'email' | 'tel' | 'date'` etc. if needs format validation
4. ✅ Backend validation runs automatically (no code change needed)
5. ✅ Mobile app picks up the field from `step.fields` automatically
6. ✅ Mobile client-side validation automatically handles the type and required flag

**No manual sync needed** — backend schema drives both client and server validation.

## Testing Validation

### Mobile (Unit)
```bash
# Test the validation module
npm run test -- src/features/registration/lib/validation.ts
```

### Backend (Unit)
```bash
# Test field validation
npm run test -- frontend-web/tests/unit/registration/validation-*.spec.ts
```

### E2E (Mobile)
```bash
# Test the full wizard flow with validation
npm run test:e2e -- app/registration --headed
```

## Debugging Validation Failures

### "Required field missing" error shows on mobile but not on backend

**Cause:** Mobile is validating a field that backend doesn't require, or vice versa.

**Fix:**
1. Check the field definition: `step.fields.find(f => f.key === fieldKey).required`
2. Run backend validation: inspect `validateStepData(step, formData)`
3. Compare rules: `mobile/validation.ts` should match `frontend-web/validation.ts`

### Backend returns "Application not found" (404) on save

**Cause:** Draft doesn't exist in store (cleared on server restart, or wrong ID sent).

**Fix:**
1. Check mobile app logs for the application ID being used
2. Verify the draft was created: GET `/api/registration/applications`
3. Verify the ID is being passed correctly in PATCH request

### Backend returns validation errors even though mobile passed validation

**Cause:** Backend has additional validation rules not yet in mobile.

**Examples:**
- State/city pair validation (state selected but city empty)
- Emergency phone ≠ applicant phone
- Contest selection constraints

**Fix:**
1. Read the specific error message
2. Update mobile validation to match: edit `mobile/validation.ts` to add the rule
3. Test in mobile app to verify the fix

## Common Patterns

### Optional Field with Type Validation
```typescript
// Field is not required, but if filled, must be valid email
field.required = false;
field.type = 'email';

// Validation:
if (!email) return null;  // Optional, OK to skip
if (!EMAIL_RE.test(email)) return 'Invalid email';  // If filled, must be valid
```

### Dependent Field Validation
```typescript
// example: city field only valid if state is selected
// Handled in backend validation (state/city pair check)
// Mobile should guide user: show city picker only if state selected
// (handled by field conditionals in FieldRenderer)
```

### File Upload in Progress
```typescript
// File field value while uploading:
{ previewUrl: 'data:...' }  // preview (uploading)

// After successful upload:
{ previewUrl: '...', storageKey: 'r2://...' }  // has storage key

// hasUploadValue() accepts both shapes
```

## Future: Supabase Migration

When registration moves to Supabase (instead of in-memory store):

1. Validation rules remain **unchanged** — stored in schema, not code
2. Mobile validation imports rules from: `shared/registration-schema.ts` (auto-generated from Supabase)
3. Backend validation imports rules from: same shared schema
4. Validation stays in sync **automatically** when schema changes

No manual sync needed — one source of truth.
