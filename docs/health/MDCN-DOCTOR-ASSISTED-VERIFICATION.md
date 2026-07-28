# MDCN (Medical & Dental) doctor — assisted Mode B verification

Same assisted KYC pattern as the vet/VCN flow, applied to doctors. Per the build
decision, this **augments the existing `doctor_verifications` system of record —
it does not replace it.** The doctor's submit + sanitized status flow stays in the
doctor module; we add the ops decision layer and the Mode B invariants the doctor
flow was missing. The doctor never sees the MDCN portal
(https://portal.mdcn.gov.ng/get-doctor-status): they submit MDCN number + name +
documents in-app, an ops reviewer confirms out-of-band, and discoverability is
granted only on approval.

## What already existed (kept, not replaced)

- `doctor_verifications` (status/kind/mdcn_number/docs/rejection) + `doctor_profiles.verification`
  discoverability gate — the system of record.
- Doctor-facing submit (`POST /api/v1/doctor/verification`), documents
  (`UploadProfileDocument`, R2 presigned uploads), and sanitized status reads
  (`GetVerificationDecision`/`GetAccountStatus`/`GetReviewNotice`).

## Gaps this adds (the assisted Mode B layer)

- **Ops decision layer** — there was no admin approve/reject in code. Added a
  review service + admin console: queue → detail → decide (approve/needs-info/reject).
- **Source-agnostic verifier** — reused the shared `credential` package: added
  `SourceMDCN` + `MDCNAdapter` (`method=ASSISTED`) and exported `CrossCheckIdentity`/
  `HasIdentityFlag` so the doctor module shares one engine with vet/VCN.
- **Identity cross-check** — doctor's on-file name ↔ Paymax KYC snapshot →
  reviewer flags (advisory, never blocking). Computed at review-fetch and persisted
  to `matched_fields` so the queue shows the flag.
- **NDPA access-logged document reads** — `doctor_verification_doc_access_log` +
  signed-URL delivery via the existing doctor R2 presigner (`PresignGet`); every
  read logged (OWNER/REVIEWER) before any URL is returned.
- **Idempotent capability grant** — on approve, `doctor_profiles.verification='approved'`
  + `is_published=true` (HL-2 discoverability), guarded + idempotent, audited.
- **Licence-expiry auto-suspend (HL-2)** — licence expiry captured on approve;
  scheduler job + `SuspendExpiredDoctorLicences` flips expired approved doctors to
  `suspended` + de-lists them. Idempotent.
- **needs_info loop** — added to the lifecycle so the reviewer can request more and
  the doctor re-submits; mobile maps it to the existing resubmit screen.

## Files

Backend (new, augment-in-place):
- `internal/health/credential/verifier.go` — `SourceMDCN` + `MDCNAdapter`.
- `internal/health/credential/model.go` — exported `CrossCheckIdentity` / `HasIdentityFlag`.
- `internal/doctor/repository_mdcn_review.go` — queue, record+docs, guarded
  `DecideMDCN`, profile gate, doc access-log, identity name, expiry sweep.
- `internal/doctor/service_mdcn_review.go` — `MDCNReviewService` (Store interface,
  guarded SM, no-self-approve, idempotent grant, doc signed-URL, sweep).
- `internal/doctor/handler_mdcn_review.go` — admin handlers.
- `internal/doctor/service_mdcn_review_test.go` — SM, no-self-approve, approve
  requires expiry+discipline, idempotency, illegal transition, expiry sweep, NDPA
  doc access-log, identity flag.
- `internal/app/health_doctor_mdcn_routes.go` — wiring (`RegisterDoctorMDCNVerification`),
  registered in the doctor block under `FeatureDoctorEnabled`. Admin routes:
  `/api/health/doctor/admin/verification/*` gated `health.doctor.review`.
- migration `20260815000600_doctor_mdcn_assisted_verification.sql` — additive:
  widen status CHECKs (`needs_info`, `suspended`), add columns (source/method/
  discipline/licence_expiry/matched_fields/reviewer_id/consent_at/decided_at),
  `doctor_verification_doc_access_log`, `health.doctor.review` RBAC seed.

Admin: `app/admin/health/doctor/verification/page.tsx` +
`src/services/healthDoctorVerificationService.ts` + `src/types/healthDoctorVerification.ts`
+ sidebar entry (mirrors the vet console; Approve requires BOTH licence expiry and
discipline).

Mobile: additive edits to the existing `(doctor)` status flow — `needs_info` →
resubmit, `suspended` → renew, removed reviewer/notes/register phrasing from
doctor-facing screens, added "no MDCN portal needed" reassurance.

## Invariants

HL-2 (discoverable only when approved; auto-suspend on licence expiry), HL-12
(immutable audit on decision, document access, suspension via `doctor_compliance_audit`),
NDPA (consent column, access-logged signed-URL docs, result+reference only — no
register copy), object-level authZ (doctor reads own; only `health.doctor.review`
decides; a doctor can NEVER self-approve — `reviewer != owner`), guarded transitions
(atomic `WHERE status=$from`).

## Assumptions

- **Medical & Dental** modelled as one MDCN-verified `doctor` capability with a
  `discipline` (medical|dental) field set/confirmed by the reviewer on approve.
- Identity cross-check compares the doctor's on-file name vs KYC; DOB is
  unverifiable (not stored) — surfaced as a flag, not a block (same as vet).
- Verification document `file_url` is treated as the R2 object key for `PresignGet`.
- Member submit path is unchanged (consent capture column added but is set ops-side
  / future member-path wiring); the assisted ops layer is the focus of this change.
- Go toolchain unavailable in-sandbox — backend verified structurally; admin
  `tsc --noEmit` passed clean; full `go build/test` + mobile `tsc` deferred to CI.
