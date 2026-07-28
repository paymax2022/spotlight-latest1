# Telemedicine Module — Audit & Close-out Plan

_Evidence-based audit (backend code, routes, migrations validated against a live replayed Postgres; mobile reviewed against the API client). Scope: `internal/telemedicine` + `app/services/telemedicine`. Note: the separate, larger `internal/doctor` module is the **provider** build (320 routes) and is out of this audit's scope._

## Verdict

**Backend: built, wired, and data-layer-valid.** **Mobile: not operational — 100% mock.** No OpenAPI contract. So the module is **not** "operational end-to-end."

## What's solid (verified)

- **Routes**: 6 legacy (`/api/finance/telemedicine/*`) + 24 v1 (`/api/v1/telemedicine/*`) — specialties, doctors, availability, reviews, appointments (book/list/get/summary/confirm/reschedule/complete/cancel/review/prescription), and doctor-side (register, dashboard, availability toggle, SOAP notes, licence upload).
- **Service**: 21 methods. Compiles clean (`go build ./...` EXIT 0).
- **Money path looks correct**: `BookAppointment` escrows the consult fee via `settlement.Escrow(... req.IdempotencyKey ...)` (idempotent); `CompleteAppointment` settles **85% provider / 15% platform** via `settlement.Settle`. Cancel path releases escrow.
- **Migrations**: `doctors`, `appointments`, `doctor_availability_slots`, `prescriptions`, `telemedicine_reviews`, `visit_summaries` — all present and **replay clean** (verified in the scratch DB; `doctor_availability_slots` is the de-collided table from the migration remediation).
- **Tests**: 3 files (`block13_test`, `health_premium_test`, `model_test`).

## Open items / TODOs

| # | Severity | Item | Evidence |
|---|---|---|---|
| 1 | **Critical** | **Mobile is fully mock** — `src/api/telemedicine.api.ts` has **no live wiring**; every function returns canned data; screens never call the backend. | File header `TODO(Phase C): replace each function body with the live endpoint`; no `api.get/post` calls. |
| 2 | High | **No OpenAPI contract** for telemedicine (violates the repo's spec-first rule). | No `contracts/telemedicine*.yaml`. |
| 3 | Medium | **"Export PDF visit summary" unimplemented** | `app/services/telemedicine/appointment/[id]/summary.tsx:80` → `TODO(Phase C): export PDF visit summary`. |
| 4 | Medium | **Video consult not wired** — the `consult` screen exists but telemedicine backend has no RTC/call-token endpoint (RTC lives in the `doctor` module). | mobile `app/services/telemedicine/consult` present; no token route in telemedicine. |
| 5 | Low | **Duplicate route surface** — legacy `/finance/telemedicine` overlaps `/api/v1/telemedicine` (older subset). | two route groups register overlapping handlers. |
| 6 | Low | **Notifications not emitted** — no appointment booked/confirmed/reminder push via the notifications queue. | no `notifications`/queue usage in telemedicine service. |
| 7 | Low | **Test depth** — money-path idempotency (double-book / double-settle) and cross-patient isolation not explicitly covered. | only 3 unit/contract tests. |

## Plan of action (close-out, prioritised)

**P1 — make it operational (blocks "done")**
1. **Wire the mobile client to live endpoints.** Rewrite `telemedicine.api.ts` to a dual mock/live module (add `USE_MOCK` flag + `api` client calls + snake↔camel mappers) mapped to the `v1Tele` routes; update the screens/hooks that consume it; typecheck green. _(This is the single biggest gap — same pattern used to wire estate's AI-notes/vendor/admin features.)_
2. **Author `contracts/telemedicine.openapi.yaml`** covering all v1 routes + schemas (Doctor, Appointment, Slot, Prescription, VisitSummary, Review); validate refs.

**P2 — feature completeness**
3. **Visit-summary PDF export** — implement via a backend `GET /appointments/:id/summary/pdf` (R2-presigned, mirroring the estate presign pattern) or client-side PDF; replace the TODO.
4. **Video consult** — wire an RTC token endpoint (reuse the `doctor` module's RTC issuer) or formally document consult as a `doctor`-module responsibility and point the screen there.

**P3 — hardening**
5. **Backend tests** — money path (escrow-on-book idempotent; settle 85/15 exactly once; cancel releases escrow) + cross-patient isolation; validate against the live replayed DB.
6. **Notifications** — emit appointment booked/confirmed/reminder via the notifications queue.
7. **De-duplicate routes** — deprecate or alias the legacy `/finance/telemedicine` group in favour of `/api/v1/telemedicine`.
8. **Go-live checklist** — settlement provider configured, feature flag, ANTHROPIC/RTC keys if used, env matrix.

## Definition of done
- `telemedicine.api.ts` live-mode hits real routes; estate-style typecheck green.
- OpenAPI contract validates and covers every route.
- Money path + isolation tests pass against the live DB; `go test ./internal/telemedicine/...` green.
- PDF export works; consult path either wired or explicitly delegated.
- No placeholder data in live screens when `USE_MOCK=false`.
