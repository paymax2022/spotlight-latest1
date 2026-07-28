# Provider Capability Matrix & Routing

Real endpoints/products per provider, mapped to the gateway ports. Adapters translate these into the normalized `VerificationCheck`.

## Capability matrix

| Gateway port | Dojah | Smile ID | Youverify |
|---|---|---|---|
| **IdNumberPort** (BVN/NIN/vNIN/passport/DL/PVC/phone) | `GET /api/v1/kyc/bvn/full` · `/bvn/advance` · `/nin` · `/nin/advance` · `/vnin` · `/passport` · `/phone_number` · `/nuban` | `enhanced_kyc` / `basic_kyc` (IDApi, no image) | `POST /v2/api/identity/ng/bvn` · `/nin` · `/vnin` · `/passport` · `/drivers_license` · `/pvc` (`isSubjectConsent:true`) |
| **FacialPort** (ID + face match) | Liveness + ID match | `enhanced_kyc + SmartSelfie` (biometric KYC, job) | identity `type: bvn_facial / nin_facial / passport_facial` (returns `face_details.confidence` vs `threshold`) |
| **LivenessPort** (selfie anti-spoof) | Liveness Check API (selfie) | `biometric_kyc` / SmartSelfie (6 anti-spoof models; Web/Mobile SDK) | Liveness SDK |
| **DocumentPort** (OCR + authenticity + face) | Document Analysis API | `doc_verification` / `enhanced_document_verification` (job_type 11) | Document/candidate verification |
| **AmlPort** (AML/PEP) | AML Screening (individual/business) | — (use Dojah/Youverify) | AML Services |

## Auth & environments (from `.env.local`)

- **Dojah** — headers `Authorization: <secret>` + `AppId: <app_id>`; base `sandbox.dojah.io` → live. Server-side only.
- **Smile ID** — `partner_id` + API key + **signature** on every request; `sid_server` 0=sandbox/1=prod; async **callback** to `SMILEID_CALLBACK_URL`; Web SDK uses a server-issued token.
- **Youverify** — `token` secret; base `api.sandbox.youverify.co` → live; **`isSubjectConsent` must be true**; webhooks for async.

## Adapter contract (every adapter implements its port)

- Accept `client_ref` (idempotency) → pass to provider → reuse as the check key.
- Return the normalized `VerificationCheck.result` `{match, confidence, extracted_fields, reason}` — never a raw provider DTO.
- Persist the raw payload to the encrypted blob store; set `raw_payload_ref`.
- Terminal status set by webhook/callback; sync responses set PENDING unless the provider returns an authoritative inline result.

## Routing & failover

- `routing` resolver reads `kyc_routing_rule` (seeded from `KYC_ROUTE_*` env, editable in admin).
- Order = ordered provider list per check type. On adapter error or circuit-breaker-open, advance to the next provider; record a failover event.
- `KYC_FACIAL_MATCH_THRESHOLD` (default 70) gates facial PASS/REVIEW; below threshold → REVIEW, not silent fail.

## Sandbox test notes

- Dojah: use sandbox test NUBAN (e.g. account `3046507407`, bank `011`).
- Smile ID: mock outcomes with `sandbox_result` = `0|1|2`; sandbox always returns simulated doc validity.
- Youverify: use documented sandbox test IDs; consent flag still required.

## Fraud signal (bonus)

Smile ID returns `IDNumberPreviouslyRegistered` + `UserIDsOfPreviousRegistrants` — surface as a **duplicate-identity** flag to the admin fraud queue when an ID was already used by another user.
