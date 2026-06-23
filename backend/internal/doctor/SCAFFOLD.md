# Doctor module — scaffolding guide for the remaining ~290 endpoints

The MVP slice (tag `doctor-mvp`, ~30 endpoints) is fully implemented across:

- `model.go` — request/response structs (camelCase JSON to match the mobile client)
- `repository.go` — pgx data access, scoped to the owning doctor's `user_id`
- `service.go` — business logic, idempotency, the money path
- `handler.go` — Gin handlers (parse → auth → service → JSON)
- routes wired in `internal/app/finance_routes.go` under `/api/v1/doctor`,
  guarded by `cfg.FeatureDoctorEnabled` and `middleware.RequireAuthContext`.

Every other endpoint in `contracts/doctor.openapi.yaml` follows the **identical**
pattern and maps 1:1 onto a `doctor_*` table already present in
`supabase/migrations/20260625000000_doctor_module.sql`. No new migration is needed.

`routes_remaining.go` lists the full inventory by tag group and registers a few
clearly-marked `501` stubs that demonstrate the shape. Do **not** hand-write all
~290 at once — implement per phase, deleting each stub as the real route lands.

---

## Iron-rule checklist for EVERY new endpoint

- Read/write is scoped to `userID` (the authenticated doctor). RLS enforces this
  in the DB too, but always pass `user_id` in the `WHERE` clause as defence-in-depth.
- Mutations that write a row with a `idempotency_key UNIQUE` column **must** read
  the `Idempotency-Key` header, pass it down, and `ON CONFLICT (idempotency_key)
  DO NOTHING` + replay the prior row (return 409 where the canonical module does).
- Any **money** mutation (payouts, invoices, anything that moves value) must, in
  this order: require + dedupe on the Idempotency-Key → tier-limit check
  (fail-closed) → balanced double-entry via `ledger.Service` (kobo `int64`, never
  floats) → persist the request row referencing the ledger (no balance column) →
  emit an audit row (`repo.InsertAudit`) → return. Mirror `Service.RequestPayout`.
- Append-only audit (`doctor_compliance_audit`, `doctor_prescription_audit`):
  INSERT only, never UPDATE/DELETE.

---

## Worked example 1 — a READ: `GET /doctor/vacations` (doctor-batch1)

**model.go**

```go
type Vacation struct {
    ID        string     `json:"id"`
    UserID    string     `json:"userId"`
    StartDate time.Time  `json:"startDate"`
    EndDate   time.Time  `json:"endDate"`
    Note      *string    `json:"note,omitempty"`
    Active    bool       `json:"active"`
    CreatedAt time.Time  `json:"createdAt"`
}
```

**repository.go**

```go
func (r *Repository) ListVacations(ctx context.Context, userID string) ([]Vacation, error) {
    const q = `SELECT id, user_id, start_date, end_date, note, active, created_at
               FROM doctor_vacations WHERE user_id = $1 ORDER BY start_date DESC`
    rows, err := r.db.Query(ctx, q, userID)
    if err != nil { return nil, err }
    defer rows.Close()
    out := []Vacation{}
    for rows.Next() {
        v := Vacation{}
        if err := rows.Scan(&v.ID, &v.UserID, &v.StartDate, &v.EndDate, &v.Note, &v.Active, &v.CreatedAt); err != nil {
            return nil, err
        }
        out = append(out, v)
    }
    return out, rows.Err()
}
```

**service.go**

```go
func (s *Service) ListVacations(ctx context.Context, userID string) ([]Vacation, error) {
    return s.repo.ListVacations(ctx, userID)
}
```

**handler.go**

```go
func (h *Handler) ListVacations(c *gin.Context) {
    uid, ok := h.userID(c); if !ok { return }
    res, err := h.svc.ListVacations(c.Request.Context(), uid)
    if err != nil { h.fail(c, err); return }
    c.JSON(http.StatusOK, res)
}
```

**route** (in `finance_routes.go`, inside the `cfg.FeatureDoctorEnabled` block):

```go
docGroup.GET("/vacations", doctorHandler.ListVacations)
```

---

## Worked example 2 — a MUTATION: `POST /doctor/vacations` (doctor-batch1)

Note: `doctor_vacations` has **no** `idempotency_key` column, so it is a plain
insert. For tables that DO have one (most `doctor_*` write tables), add the
header read + `ON CONFLICT (idempotency_key) DO NOTHING` + replay, exactly like
`Repository.InsertPrescription` / `InsertLabOrder`.

**model.go**

```go
type CreateVacationRequest struct {
    StartDate time.Time `json:"startDate" binding:"required"`
    EndDate   time.Time `json:"endDate"   binding:"required"`
    Note      *string   `json:"note,omitempty"`
}
```

**repository.go**

```go
func (r *Repository) InsertVacation(ctx context.Context, userID string, req CreateVacationRequest) (*Vacation, error) {
    id := uuid.New().String()
    const q = `INSERT INTO doctor_vacations (id, user_id, start_date, end_date, note)
               VALUES ($1,$2,$3,$4,$5)`
    if _, err := r.db.Exec(ctx, q, id, userID, req.StartDate, req.EndDate, req.Note); err != nil {
        return nil, err
    }
    return &Vacation{ID: id, UserID: userID, StartDate: req.StartDate,
        EndDate: req.EndDate, Note: req.Note, Active: true}, nil
}
```

**service.go**

```go
func (s *Service) CreateVacation(ctx context.Context, userID string, req CreateVacationRequest) (*Vacation, error) {
    return s.repo.InsertVacation(ctx, userID, req)
}
```

**handler.go**

```go
func (h *Handler) CreateVacation(c *gin.Context) {
    uid, ok := h.userID(c); if !ok { return }
    var req CreateVacationRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()}); return
    }
    res, err := h.svc.CreateVacation(c.Request.Context(), uid, req)
    if err != nil { h.fail(c, err); return }
    c.JSON(http.StatusCreated, res)
}
```

**route**:

```go
docGroup.POST("/vacations", doctorHandler.CreateVacation)
```

---

## Tables ↔ tag-group map (for fan-out)

| Tag group         | Count | Primary tables                                                                 |
|-------------------|-------|--------------------------------------------------------------------------------|
| doctor-mvp ✅     | 30    | profiles, verifications, availability, appointments, clinical_notes, prescriptions(+items), lab_orders(+tests)/results(+values)/interpretations, payouts, notifications, settings, compliance_audit |
| doctor-profile    | 11    | doctor_profiles (profile_draft/completed_steps), clinics (active_clinic_id)     |
| doctor-onboarding | 9     | doctor_legal_consents, doctor_app_permissions, doctor_merchant_upgrades         |
| doctor-phase2     | 26    | doctor_chat_threads/_messages, doctor_call_sessions/_disputes, consult_queue    |
| doctor-phase3     | 23    | doctor_record_access_log/_restrictions/_shares, reviews, quality_scores         |
| doctor-batch1     | 30    | doctor_blocked_dates, _vacations, _recurring_rules, _reminders                  |
| doctor-batch2     | 25    | doctor_pharmacy_fulfilments/_substitutes/_messages, _drug_deliveries, _refill_requests |
| doctor-batch3     | 27    | lab tables (extended), doctor_hmo_plan_coverage/_preauth_requests/_covered_services |
| doctor-batch4     | 37    | doctor_hmo_claims/_support_messages/_fraud_warnings, referrals/incoming/opinion/care_team |
| doctor-batch5     | 35    | doctor_follow_up_plans, _care_plans, _chronic_monitoring, _adherence_checks, emergency_* |
| doctor-batch6     | 30    | doctor_notification_preferences, earnings (ledger projection), quality scores   |
| doctor-batch7     | 30    | doctor_support_tickets/_disputes/_messages, compliance, mandatory_training, safety_issues, data_privacy_settings, devices |
| vet               | (in batches) | doctor_vet_profiles, _pets(+vaccinations), _pet_prescriptions/_lab_orders/_lab_results/_products/_recommendations/_fulfilments |
