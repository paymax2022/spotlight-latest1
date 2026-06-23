# Doctor Module — Go-Live Runbook (SANDBOX → PRODUCTION)

The doctor (provider) module ships **mock-first**: by default every API function
resolves demo data via a local `wait()` helper so the app runs with **no backend**.
A single runtime flag flips the whole module to the live backend without touching
any screen, hook, type, or constant.

## How the switch works

- Central config lives in **`src/api/doctor.client.ts`**:
  ```ts
  export const DOCTOR_USE_MOCK =
    (process.env.EXPO_PUBLIC_DOCTOR_USE_MOCK ?? 'true') !== 'false';
  export const DOCTOR_API_PREFIX = '/api/v1/doctor';
  ```
- **Default is MOCK.** Unset, empty, or any value other than the exact string
  `'false'` keeps the module on demo data. Only `EXPO_PUBLIC_DOCTOR_USE_MOCK=false`
  switches to the live backend. (Same convention as the Realtor module's
  `EXPO_PUBLIC_REALTOR_USE_MOCK`.)
- Every doctor api function branches:
  ```ts
  export async function getAppointments(status?: ConsultStatus) {
    if (DOCTOR_USE_MOCK) return wait(DEMO_APPOINTMENTS);  // demo, unchanged
    return doctorGet<DoctorAppointment[]>('/appointments', { status }); // live
  }
  ```
  Mutations carry the idempotency key through:
  ```ts
  if (DOCTOR_USE_MOCK) { /* demo result */ return wait(result); }
  return doctorPost<R>('/payouts', input, input.idempotencyKey);
  ```
- Live HTTP goes through the shared authenticated axios instance (`src/api/client.ts`),
  so the Supabase access token is attached as `Authorization: Bearer <token>` and
  401s trigger sign-out + redirect to `/(auth)/login` automatically.

## Going live — exact steps

1. **Set the environment** (e.g. in `.env`, EAS secrets, or the build profile):
   ```
   EXPO_PUBLIC_DOCTOR_USE_MOCK=false
   EXPO_PUBLIC_API_BASE_URL=https://api.spotlight.ng     # backend hosting /api/v1/doctor
   EXPO_PUBLIC_SUPABASE_URL=...                           # already required by the app
   EXPO_PUBLIC_SUPABASE_ANON_KEY=...
   ```
2. **Auth must work end-to-end.** The user must have a live Supabase session; the
   request interceptor reads `supabase.auth.getSession()` and attaches the Bearer
   token. The Go backend validates it via `RequireAuthContext` + RBAC permission
   middleware. Without a session the call goes out unauthenticated and the backend
   should 401 (→ the app signs the user out).
3. **Backend must implement every endpoint** under `DOCTOR_API_PREFIX`
   (`/api/v1/doctor/...`). The complete build list is in
   **`docs/DOCTOR_ENDPOINT_INVENTORY.md`** (method, path, request, response,
   idempotent?).
4. **Honour the Idempotency-Key on every mutation.** The client sends
   `Idempotency-Key: <input.idempotencyKey>` on all POST/PUT/PATCH/DELETE writes.
   The backend must dedupe on it (replay the prior result for a repeated key) per
   the iron rules in `CLAUDE.md`.
5. **Money is integers in kobo end-to-end.** Every `*Kobo` field is a minor-unit
   integer — never a float, never a string for math. The backend must return kobo
   integers and post balanced double-entry ledger entries for any money mutation
   (payouts, withdrawals, settlement disputes).

## Response envelope the backend must match

The client unwraps responses as **`res.data.data ?? res.data`**:
- Preferred: `{ "data": <payload> }` (the payload is returned).
- Also accepted: the bare `<payload>` (returned as-is).
Either shape works; pick one and be consistent. For list endpoints, return the
array directly as the payload (the client expects `T[]`, not a paginated wrapper,
unless the screen's type already models pagination).

## 401 handling

A `401` on any doctor call is caught by the shared response interceptor in
`src/api/client.ts`: it calls `supabase.auth.signOut()` and redirects to
`/(auth)/login`. Backends should return `401` for expired/invalid tokens and
`403` for authenticated-but-unauthorised (RBAC) so the user is not logged out on
a mere permission gap.

## Client-side-only functions (no live branch — intentional)

These are pure helpers / device probes and do **not** call the backend in any mode:
`formatKobo`, `checkOverbooking`, `computeConsultCountdown`, `computePetDosage`,
`checkPrescriptionWarnings`, `checkPetRxWarnings`, `getEdgeState`,
`searchDiagnosisCodes`, `searchDrugCatalogue`, `getDrugAlternatives`,
`checkLabCoverage`, and `runDeviceCheck` (WebRTC probe). Leave them as-is.

## Uploads (R2)

`uploadProfilePhoto`, `uploadDocument`, `renewLicence`, `sendAttachment`,
`uploadDisputeEvidence` post file metadata to the live endpoints in production.
The actual binary upload is a presigned Cloudflare R2 PUT owned by the backend
(`@aws-sdk/client-s3`, bucket `spotlight-open-mic`). The live branch here records
metadata; wire the presign flow on the backend per `CLAUDE.md`.

## Emergency dispatch (DEMO-guarded)

`escalateToHospital`, `escalateToAmbulance`, `notifyEmergencyContact` are **demo-safe**:
in mock mode they never dispatch. The live branch posts to the emergency endpoints,
which **must** route to a vetted emergency-services provider before real go-live.
Treat these as feature-flagged and reviewed separately.

## Pre-launch checklist

- [ ] `EXPO_PUBLIC_DOCTOR_USE_MOCK=false` only in environments with a live backend.
- [ ] `cd frontend-web && npx tsc --noEmit` (web) and the RN typecheck are clean.
- [ ] `npm run test:regression` green before and after (per `CLAUDE.md`).
- [ ] `npm run test:money` green — ledger / idempotency / tier-limit invariants
      hold for every money mutation (payouts, withdrawals, disputes).
- [ ] Feature-flag the doctor module rollout (no flag, no merge).
- [ ] All DB migrations are additive-only (no DROP, no rename, no type narrowing).
- [ ] `npm run contract:check` — backend matches `contracts/openapi.yaml`.
- [ ] Idempotency-Key dedupe verified on a representative mutation.
- [ ] 401 → sign-out path verified against the live backend.
- [ ] Default (flag unset) still renders the full app on demo data.
