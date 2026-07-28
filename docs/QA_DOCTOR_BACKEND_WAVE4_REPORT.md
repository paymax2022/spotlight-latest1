# QA Review — Doctor Backend WAVE 4 (Static / No-Toolchain)

**Reviewer:** QA/Go static reviewer (verification of record — the implementing agent
crashed before reporting).
**Date:** 2026-06-21
**Scope:** `backend/internal/doctor/{model_ops.go, repository_ops.go, service_ops.go,
handler_ops.go}` + Wave 4 route additions in `backend/internal/app/finance_routes.go`.
**Method:** Static read-through only. **No Go toolchain available** — `go build`,
`go vet`, `go test` were NOT executed. Compile-shape verified by hand
(handler→service→repo symbol resolution, struct/column matching, route-tree analysis).

---

## 1. Summary verdict

**PASS — no blockers found.** Wave 4 is internally consistent and compile-shaped.
Every `h.svc.X` resolves to a `service_ops.go` method; every `s.repo.X` resolves to a
`repository_ops.go` (or existing) method; all bound request structs and shared helpers
exist exactly once; all Wave 4 tables/columns exist in the migration; routing is
gin-v1.10-safe for the Wave 4 families.

| Severity | Count | Items |
|----------|-------|-------|
| BLOCKER  | 0     | — |
| MAJOR    | 0     | — |
| MINOR    | 2     | M1 (RescheduleAppointment status semantics), M2 (pre-existing param-name conflict outside Wave 4 scope — informational) |

**Caveat:** verdict is the result of exhaustive static analysis. It is NOT a substitute
for `go build ./...`. Run the CI block in §11 before merge.

---

## 2. Compile-shape: handler → service → repo resolution (KEY OUTPUT)

Every Wave 4 handler call was traced to its service method and on to its repo method.
**All resolve. No unresolved call.**

| handler_ops.go call | service_ops.go method | repo method(s) | Resolved |
|---|---|---|---|
| `h.svc.ListChatThreads(ctx,uid)` | `ListChatThreads` (svc:83) | `repo.ListChatThreads` (ops:26) | ✅ |
| `h.svc.ListChatMessages(ctx,uid,threadId)` | `ListChatMessages` (svc:87) | `repo.ListChatMessages` (ops:63) → `getChatThread` (ops:49) | ✅ |
| `h.svc.SendChatMessage(ctx,uid,threadId,idem,req)` | `SendChatMessage` (svc:91) | `repo.InsertChatMessage` (ops:89) → `getChatMessageByID/ByIdem` | ✅ |
| `h.svc.GetCallSession(ctx,uid,apptId)` | `GetCallSession` (svc:100) | `repo.GetCallSessionForAppointment` (ops:146) | ✅ |
| `h.svc.StartCallSession(ctx,uid,apptId,idem,raw)` | `StartCallSession` (svc:107) | `repo.StartCallSession` (ops:180) | ✅ |
| `h.svc.EndCallSession(ctx,uid,apptId,idem,raw)` | `EndCallSession` (svc:121) | `repo.GetCallSessionForAppointment` + `repo.EndCallSession` (ops:201) | ✅ |
| `h.svc.ListBlockedDates(ctx,uid)` | `ListBlockedDates` (svc:139) | `repo.ListBlockedDates` (ops:229) | ✅ |
| `h.svc.CreateBlockedDate(ctx,uid,idem,raw)` | `CreateBlockedDate` (svc:143) | `repo.InsertBlockedDate` (ops:252) | ✅ |
| `h.svc.GetVacation(ctx,uid)` | `GetVacation` (svc:159) | `repo.GetVacation` (ops:267) | ✅ |
| `h.svc.SetVacation(ctx,uid,idem,raw)` | `SetVacation` (svc:163) | `repo.SetVacation` (ops:282) | ✅ |
| `h.svc.ListRecurringRules(ctx,uid)` | `ListRecurringRules` (svc:175) | `repo.ListRecurringRules` (ops:309) | ✅ |
| `h.svc.SaveRecurringRule(ctx,uid,idem,raw)` | `SaveRecurringRule` (svc:179) | `repo.SaveRecurringRule` (ops:330) | ✅ |
| `h.svc.ListReminders(ctx,uid)` | `ListReminders` (svc:192) | `repo.ListReminders` (ops:355) | ✅ |
| `h.svc.SaveReminderSettings(ctx,uid,idem,raw)` | `SaveReminderSettings` (svc:196) | `repo.SaveReminder` (ops:378) | ✅ |
| `h.svc.SetTimezone(ctx,uid,idem,raw)` | `SetTimezone` (svc:212) | `repo.SetTimezone` (ops:424) → `repo.GetProfile` (repository.go:30) | ✅ |
| `h.svc.ListConsultQueue(ctx,uid)` | `ListConsultQueue` (svc:223) | `repo.ListConsultQueue` (ops:438) | ✅ |
| `h.svc.ListAppointmentRequests(ctx,uid)` | `ListAppointmentRequests` (svc:227) | `repo.ListAppointmentRequests` (ops:459) | ✅ |
| `h.svc.GetAppointmentRequest(ctx,uid,id)` | `GetAppointmentRequest` (svc:231) | `repo.GetAppointmentRequest` (ops:480) | ✅ |
| `h.svc.AcceptAppointment(ctx,uid,apptId,idem,raw)` | `AcceptAppointment` (svc:236) | `repo.TransitionAppointment` (ops:496) → `repo.GetAppointment` (repository.go:174) | ✅ |
| `h.svc.RejectAppointment(...)` | `RejectAppointment` (svc:244) | `repo.TransitionAppointment` | ✅ |
| `h.svc.RescheduleAppointment(...)` | `RescheduleAppointment` (svc:254) | `repo.TransitionAppointment` | ✅ |
| `h.svc.SubmitHMOClaim(ctx,uid,idem,raw)` | `SubmitHMOClaim` (svc:270) | `repo.InsertHMOClaim` (ops:534) → `repo.GetHMOClaim` (repository_clinical.go:1058) | ✅ |
| `h.svc.DisputeHMOClaim(ctx,uid,id,idem,raw)` | `DisputeHMOClaim` (svc:279) | `repo.DisputeHMOClaim` (ops:565) | ✅ |
| `h.svc.GetClinicPortfolio(ctx,uid)` | `GetClinicPortfolio` (svc:290) | `repo.GetClinicPortfolio` (ops:584) | ✅ |
| `h.svc.SetActiveClinic(ctx,uid,idem,raw)` | `SetActiveClinic` (svc:294) | `repo.SetActiveClinic` (ops:597) | ✅ |
| `h.svc.UpdateClinicSchedule(ctx,uid,clinicId,idem,raw)` | `UpdateClinicSchedule` (svc:309) | `repo.UpdateClinicSchedule` (ops:612) | ✅ |

**Arity / type spot-checks:** every signature aligns (e.g. `EndCallSession(ctx, userID,
appointmentID, idemKey string, raw json.RawMessage)` in svc:121 vs handler call at
handler_ops.go:104; repo `EndCallSession(ctx, userID, sessionID, status string, detail
[]byte)` at ops:201 vs svc call at svc:134). The service correctly resolves
appointment→session id before calling repo `EndCallSession` (svc:125-134).

**Bound request structs (ShouldBindJSON):** only one in Wave 4 —
`SendChatMessageRequest` (handler_ops.go:50), defined in model_ops.go:56. ✅
All other mutations read the raw body via `h.rawBody` (defined handler_account.go:21)
and parse through `parseOpsPatch` (svc:55). ✅

**Shared helpers used by Wave 4 — all exist exactly once (no redeclaration):**
`h.userID` (handler.go:21), `h.fail` (handler.go:32), `h.idemKey` (handler.go:47),
`h.rawBody` (handler_account.go:21), `strOrDefault` (repository.go:896), `derefStr`
(service.go:225), `jsonOrEmptyObject` (repository.go:850). Sentinels `ErrNotFound`
(repository.go:26), `ErrIdempotencyRequired` (service.go:40), `ErrInvalidAmount`
(service.go:41). ✅

**Imports:** `net/http`+`gin` (handler_ops), `context`+`encoding/json`+`time`
(service_ops), `encoding/json`+`time` (model_ops), `context`+`errors`+`time`+
`uuid`+`pgx/v5` (repository_ops) — all used, none missing. Braces balanced in all four
files (verified by structural read). ✅

---

## 3. Duplicate-symbol sweep (whole doctor package)

`uniq -d` over all top-level func/method signatures and all `type` declarations across
the package: **EMPTY — no duplicates.** Specifically confirmed the at-risk names are
each defined once and NOT re-declared by the ops files: `strOrDefault`, `derefStr`,
`jsonOrEmptyObject`, `parseClinicalPatch`, `rawBody`, `ErrNotFound`,
`ErrIdempotencyRequired`, `ErrInvalidAmount`. Wave 4's new helpers `parseOpsPatch`
(svc:55), `parseOpsDate` (svc:66) and type `opsPatch` (svc:25) are unique to the
package. No type collisions (`ChatThread`, `ChatMessage`, `CallSession`, `BlockedDate`,
`Vacation`, `RecurringRule`, `Reminder`, `ConsultQueueEntry`, `AppointmentRequest`,
`ClinicPortfolio` are all new and singular). ✅

---

## 4. Route wiring + gin v1.10 safety (per-family)

All 27 Wave 4 routes (finance_routes.go:904-943) map to an existing `handler_ops`
method (cross-checked against §2). gin v1.10 panics only when (a) two **different**
param names occupy the same tree position, or (b) a param conflicts with a catch-all.
A static segment coexisting with a **single** consistently-named `:param` at the same
position is allowed (already proven in-repo by Wave 1-3 pairs such as
`/referrals/incoming` + `/referrals/:id`, `/lab-results/inbox` + `/lab-results/:resultId`,
`/pharmacy/fulfilments` + `/pharmacy/:fulfilmentId`, which boot successfully).

| Family | Routes | Param name(s) | Verdict |
|--------|--------|---------------|---------|
| `/chat` | `GET /chat/threads`, `GET\|POST /chat/:threadId/messages` | static `threads` + single `:threadId` | ✅ SAFE |
| `/calls` | `GET /calls/:appointmentId`, `POST .../join`, `POST .../leave` | single `:appointmentId` | ✅ SAFE |
| `/schedule/*` | blocked-dates (GET/POST), vacation (GET/PUT), recurring (GET/PUT), reminders (GET/PUT), timezone (PUT) | all static segments, no params | ✅ SAFE |
| `/queue` | `GET /queue` | none | ✅ SAFE |
| `/appointment-requests` | `GET /appointment-requests`, `GET /appointment-requests/:id` | single `:id` | ✅ SAFE |
| `/appointments/:appointmentId/*` (Wave 4) | `accept`, `reject`, `request-reschedule`, `reschedule` | `:appointmentId` — **same name** as MVP `/status`, `/notes`, GET `:appointmentId` | ✅ SAFE — no collision with MVP |
| `/hmo/claims` | `POST /hmo/claims`, `POST /hmo/claims/:id/dispute` | `:id` — **matches** existing `GET /hmo/claims/:id` | ✅ SAFE (handler reads `c.Param("id")`, see note) |
| `/clinics` | `GET /clinics`, `POST /clinics/active`, `PATCH /clinics/:clinicId/schedule` | static `active` + single `:clinicId` | ✅ SAFE |

**No duplicate method+path** across the full 221-route doctor group (each Wave 4
`METHOD path` pair is unique; `/appointments/:appointmentId/reschedule` and
`/request-reschedule` are distinct paths that intentionally share the
`RescheduleAppointment` handler).

**Param-name discipline note (handler_ops.go:371-374, 423):** `DisputeHMOClaim`
correctly reads `c.Param("id")` to match the existing `:id` segment (OpenAPI spells it
`{claimId}` — value identical; documented inline). `UpdateClinicSchedule` reads
`c.Param("clinicId")`, matching its route. No mismatched `c.Param` keys found.

**Path-spelling vs contracts/doctor.openapi.yaml:** spellings align; the only
intentional divergence is `:id` vs `{claimId}` on the dispute route (documented,
required by gin position-uniqueness). The `routes_remaining.go` stubs (incl.
`/chat/threads`, `/hmo/claims`) are **NOT registered** — `RegisterRemaining` has zero
call sites — so they cannot double-register or panic.

---

## 5. Scoping (8 repo funcs — WHERE clauses quoted)

All Wave 4 reads/writes are scoped to `user_id` (defence-in-depth atop RLS), or to a
parent row already proven to belong to the doctor.

1. `ListChatThreads` (ops:30): `WHERE user_id = $1`
2. `getChatThread` (ops:53): `WHERE id = $1 AND user_id = $2` (gate for messages)
3. `ListChatMessages` (ops:69): `WHERE thread_id = $1 AND user_id = $2` (+ thread gate first)
4. `GetCallSessionForAppointment` (ops:150): `WHERE appointment_id = $1 AND user_id = $2`
5. `EndCallSession` (ops:214): `WHERE id = $1 AND user_id = $2`
6. `TransitionAppointment` (ops:499): `WHERE id = $1 AND user_id = $2` (+ mirror UPDATE ops:524 `WHERE appointment_id = $1 AND user_id = $2`)
7. `InsertHMOClaim` (ops:537): INSERT carries `user_id`; replay `getHMOClaimByIdem` (ops:553): `WHERE user_id = $1 AND idempotency_key = $2`
8. `UpdateClinicSchedule` (ops:623): `WHERE user_id = $1`

**No unscoped Wave 4 query found.** ✅

---

## 6. Idempotency (mutation → mechanism)

| Mutation | Table has `idempotency_key`? | Mechanism |
|----------|------------------------------|-----------|
| SendChatMessage | YES (UNIQUE) | header required (svc:92) → `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` + replay via `getChatMessageByIdem` (ops:99-108) |
| SubmitHMOClaim | YES (UNIQUE) | header required (svc:271) → `ON CONFLICT (idempotency_key) DO NOTHING` + replay (ops:539-546) |
| StartCallSession | no | header required + status-guarded: reuses an existing non-ended session (ops:182-188) |
| EndCallSession | no | header required + scoped status-set UPDATE → no-op replay (ops:201-222) |
| CreateBlockedDate | no | header required; plain scoped additive INSERT (append-log semantics) |
| SetVacation | no | header required; scoped UPSERT (one row/doctor) — overwrite is idempotent (ops:282) |
| SaveRecurringRule | no | header required; additive INSERT (rule history) |
| SaveReminderSettings | no | header required; scoped UPSERT keyed on `(user_id, reminder_type)` (ops:378) |
| SetTimezone | no | header required; scoped UPDATE — idempotent overwrite |
| Accept/Reject/Reschedule | no | header required; status-guarded scoped UPDATE (ops:496) |
| DisputeHMOClaim | no | header required; status-set scoped UPDATE → idempotent |
| SetActiveClinic / UpdateClinicSchedule | no | header required; scoped UPDATE / jsonb-merge — idempotent |

All 13 mutations require the `Idempotency-Key` header (service returns
`ErrIdempotencyRequired` when blank). Tables with the unique column use header +
ON CONFLICT replay; the rest are status-guarded or overwrite-idempotent scoped UPDATEs.
✅ Consistent with the iron rule.

---

## 7. Struct ↔ column (Wave 4 tables)

Migration `20260625000000_doctor_module.sql` DDL confirmed against repo SELECT/INSERT
column lists. **All match — no mismatches, no missing tables.**

| Table | Exists | Repo columns vs DDL |
|-------|--------|---------------------|
| `doctor_chat_threads` | ✅ | id, user_id, appointment_id, patient, consult_type, status, last_message, last_message_at, unread_count, created_at, updated_at — exact (ops:28) |
| `doctor_chat_messages` | ✅ | id, thread_id, user_id, author, body, message_kind, attachment_url, attachment_name, created_at + `idempotency_key UNIQUE` — exact (ops:68/99) |
| `doctor_call_sessions` | ✅ | id, user_id, appointment_id, patient, mode, status, provider, room_token, started_at, ended_at, duration_secs, detail, created_at, updated_at — exact (ops:148) |
| `doctor_blocked_dates` | ✅ | id, user_id, blocked_date (`date`), reason, all_day, start_time, end_time, created_at — exact; no `idempotency_key` (correctly plain insert) (ops:231/255) |
| `doctor_vacations` | ✅ | id, user_id, start_date, end_date, note, active, created_at, updated_at — exact (ops:269) |
| `doctor_recurring_rules` | ✅ | id, user_id, rule (jsonb), active, created_at, updated_at — exact (ops:311) |
| `doctor_reminders` | ✅ | id, user_id, reminder_type, settings (jsonb), enabled, created_at, updated_at — exact (ops:357) |
| `doctor_consult_queue` | ✅ | id, user_id, appointment_id, position, status, detail, created_at, updated_at — exact (ops:440) |
| `doctor_appointment_requests` | ✅ | id, user_id, appointment_id, patient, consult_type, status, requested_slot, detail, created_at, updated_at — exact (ops:461) |
| `doctor_hmo_claims` | ✅ | id, user_id, ref, patient_id, appointment_id, status, amount_kobo (`bigint`), detail, idempotency_key (UNIQUE), created_at, updated_at — exact (ops:537) |
| `doctor_profiles` (timezone/active_clinic_id/profile_draft) | ✅ | `timezone text`, `active_clinic_id uuid`, `profile_draft jsonb` all present — used by SetTimezone (ops:425), SetActiveClinic (`::uuid` cast, ops:598), Clinic portfolio (`profile_draft->'clinics'`, ops:586) |

**Clinics:** confirmed there is intentionally **no `doctor_clinics` table** — the
portfolio is projected from `doctor_profiles.active_clinic_id` + `profile_draft->'clinics'`
(documented in model_ops.go:159-167 and repo ops:582). This is an existing-table
projection, not a missing-table runtime error. ✅

**`HMOClaim` struct** (model_clinical.go:262) fields exactly match the
`InsertHMOClaim`/`getHMOClaimByIdem` Scan order (id, user_id, ref, patient_id,
appointment_id, status, amount_kobo, detail, created_at, updated_at). ✅

---

## 8. Call token / WS / AI deferrals (expected)

- **Call-session token issuance:** documented TODO; `room_token` persists the literal
  placeholder `"TODO_PROVIDER_TOKEN_PENDING_INTEGRATION"` (svc:114-116). **No external
  call.** ✅ Expected deferral.
- **Realtime WS / presence push:** explicitly out of scope; only REST persistence is
  wired. TODO comments at svc:80-81 and repo ops:109-110 (thread summary rolled forward
  best-effort, no push). ✅ Expected deferral.
- **AI-assist routes:** NOT wired in Wave 4 (no AI routes in finance_routes.go:904-943,
  none in handler_ops.go). Remain documented in `routes_remaining.go` (un-wired). ✅
  Expected deferral.

---

## 9. Money

No ledger postings anywhere in Wave 4 (no `ledger`, no balance UPDATEs). The only
monetary field is `amount_kobo` (`bigint` DDL / `int64` model `HMOClaim.AmountKobo` /
`opsPatch.AmountKobo`), carried **reporting-only** on HMO claims (HMOs settle
out-of-band, not via the doctor wallet) — documented at svc:275 and repo ops:531-533.
No floats, no string math, no stored-balance writes. ✅ Compliant with the kobo iron rule.

---

## 10. Additive scope

Only the 4 new files (`model_ops.go`, `repository_ops.go`, `service_ops.go`,
`handler_ops.go`) plus 27 route lines appended to the existing doctor block in
`finance_routes.go` (lines 904-943). No existing doctor file modified for Wave 4 logic.
No DB migration change required (all tables pre-existing). DB writes are additive:
INSERTs, scoped UPDATEs, and jsonb-merge (`jsonb_set(..., true)` / `detail || $::jsonb`)
— no DROP, no narrowing, no balance-column write. ✅

---

## 11. Final coverage

- **Total `/api/v1/doctor` routes now registered** (`finance_routes.go`,
  all `docGroup.<METHOD>(...)`): **221** (194 prior + **27 Wave 4**).
- **Inventory** (`mobile-app/reactnative/docs/DOCTOR_ENDPOINT_INVENTORY.md`): **309
  live endpoints**.
- **OpenAPI** (`contracts/doctor.openapi.yaml`): **313 operations**.

**Implemented / total ≈ 221 / 309 ≈ 72%** of the inventory (≈ 71% of the 313 contract
operations). Up from 194/309 (≈ 63%) at end of Wave 3b.

**Still-deferred groups (not wired):**
1. **AI assist** (consult assistant / suggestion endpoints) — still only in
   `routes_remaining.go` (un-wired).
2. **Realtime WS / presence push** (chat + call live channels) — persistence shipped,
   transport deferred (TODO).
3. **Agora/VideoSDK token issuance** — placeholder persisted; adapter pending.
4. Plus the remaining ~88 inventory endpoints across emergency/escalation, advanced
   records sharing, compliance/training tails, and remaining vet/pet long-tail that
   map 1:1 onto already-created `doctor_*` tables (no migration needed to finish).

---

## Prioritized defect list (describe — do NOT apply)

**BLOCKER:** none.

**MAJOR:** none.

**MINOR**

- **M1 — Reschedule status verb semantics (CONFIRMED no DB failure; semantic-only).**
  `RescheduleAppointment` sets the appointment status to `"upcoming"`
  (svc:263 → `TransitionAppointment(..., "upcoming", ...)`) and mirrors the request row
  to `"reschedule_requested"` (repo ops:516-517). **Confirmed:** `doctor_appointments.status`
  is plain `text NOT NULL DEFAULT 'pending'` with **no CHECK constraint**, and
  `doctor_appointment_requests.status` is likewise unconstrained `text`. So the writes
  succeed — **no runtime constraint violation.** The only remaining concern is
  *semantic*: a freshly-rescheduled appointment lands in `"upcoming"` rather than a
  more explicit `"rescheduled"` verb, and both `/request-reschedule` and `/reschedule`
  collapse to the identical effect (documented at svc:251-253). This is acceptable for
  the wave but worth aligning with the mobile `ConsultStatus` vocabulary in a follow-up.
  Severity MINOR (cosmetic/semantic, not a defect).

- **M2 — Pre-existing (NOT Wave 4) gin param-name divergence, informational.**
  Under `/referrals/incoming/`, `GET /referrals/incoming/:id` (line 795) and
  `POST /referrals/incoming/:referralId/accept` (line 796) use **different param names**
  (`:id` vs `:referralId`) at the same tree position. In gin v1.10 this pattern can
  panic at registration depending on registration order. **This is Wave 3a code, out of
  Wave 4 scope** — flagged only because the route-tree sweep surfaced it. It does not
  involve any Wave 4 route. Recommend a follow-up to normalize the param name. (If the
  service currently boots, gin tolerated the order; still worth fixing for robustness.)

---

## Run in CI (the missing self-verification)

```
cd backend && go build ./... && go vet ./internal/doctor/... && go test ./internal/doctor/...
```

This static review found no compile-breakers, but the no-toolchain caveat stands — the
above MUST be green before merge. Priority watch items for the build: the `upcoming`
status CHECK (M1) is a runtime concern that `go build` will NOT catch — exercise the
reschedule path against the real schema or add a migration test.
