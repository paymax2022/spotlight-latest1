package estate

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// roleIn returns the caller's role within an estate, or an error if not a member.
func (s *Service) roleIn(ctx context.Context, estateID, userID string) (string, error) {
	var role string
	if err := s.db.QueryRow(ctx,
		`SELECT role FROM estate_residents WHERE estate_id=$1 AND user_id=$2`, estateID, userID,
	).Scan(&role); err != nil {
		return "", fmt.Errorf("estate: not a member of this estate")
	}
	return role, nil
}

// ── Block 31: Tasks ──────────────────────────────────────────────────────────

func (s *Service) CreateTask(ctx context.Context, estateID, adminID string, req CreateTaskRequest) (*Task, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	priority := req.Priority
	if priority == "" {
		priority = "medium"
	}
	t := &Task{
		ID: uuid.New().String(), EstateID: estateID, Title: req.Title,
		Description: req.Description, CreatedBy: adminID, DueDate: req.DueDate,
		Priority: priority, Status: "todo", CreatedAt: time.Now(),
	}
	if req.AssigneeID != "" {
		t.AssigneeID = &req.AssigneeID
	}
	const q = `INSERT INTO estate_tasks (id, estate_id, title, description, assignee_id, created_by, due_date, priority, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'todo')`
	if _, err := s.db.Exec(ctx, q, t.ID, estateID, t.Title, t.Description, t.AssigneeID, adminID, t.DueDate, priority); err != nil {
		return nil, fmt.Errorf("estate: insert task: %w", err)
	}
	// Block 34/43: notify the assignee. Fire-and-forget.
	if t.AssigneeID != nil {
		s.notify(ctx, estateID, *t.AssigneeID, NotifTaskAssigned, "New task: "+t.Title, t.Description, map[string]any{"task_id": t.ID, "priority": priority})
	}
	return t, nil
}

func (s *Service) ListTasks(ctx context.Context, estateID, userID, status string) ([]Task, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	q := `SELECT id, estate_id, title, COALESCE(description,''), assignee_id, created_by, due_date, priority, status, created_at
		FROM estate_tasks WHERE estate_id=$1`
	args := []any{estateID}
	if status != "" {
		q += " AND status=$2"
		args = append(args, status)
	}
	q += " ORDER BY created_at DESC LIMIT 200"
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Task
	for rows.Next() {
		var t Task
		if err := rows.Scan(&t.ID, &t.EstateID, &t.Title, &t.Description, &t.AssigneeID, &t.CreatedBy, &t.DueDate, &t.Priority, &t.Status, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Service) UpdateTaskStatus(ctx context.Context, estateID, userID, taskID, status string) error {
	// Admin or the task's assignee may move it.
	role, err := s.roleIn(ctx, estateID, userID)
	if err != nil {
		return err
	}
	q := `UPDATE estate_tasks SET status=$1 WHERE id=$2 AND estate_id=$3`
	args := []any{status, taskID, estateID}
	if role != "estate_admin" {
		q += " AND assignee_id=$4"
		args = append(args, userID)
	}
	ct, err := s.db.Exec(ctx, q, args...)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("estate: task not found or not permitted")
	}
	return nil
}

// ── Block 32: Maintenance / Repairs ──────────────────────────────────────────

func (s *Service) CreateRepair(ctx context.Context, estateID, reporterID string, req CreateRepairRequest) (*RepairRequest, error) {
	if err := s.assertResident(ctx, estateID, reporterID); err != nil {
		return nil, err
	}
	urgency := req.Urgency
	if urgency == "" {
		urgency = "medium"
	}
	r := &RepairRequest{
		ID: uuid.New().String(), EstateID: estateID, ReporterID: reporterID,
		Category: req.Category, Description: req.Description, Urgency: urgency,
		Status: "reported", CreatedAt: time.Now(),
	}
	if req.PropertyID != "" {
		r.PropertyID = &req.PropertyID
	}
	const q = `INSERT INTO estate_repair_requests (id, estate_id, property_id, reporter_id, category, description, urgency, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'reported')`
	if _, err := s.db.Exec(ctx, q, r.ID, estateID, r.PropertyID, reporterID, r.Category, r.Description, urgency); err != nil {
		return nil, fmt.Errorf("estate: insert repair: %w", err)
	}
	return r, nil
}

func (s *Service) ListRepairs(ctx context.Context, estateID, userID, status string) ([]RepairRequest, error) {
	role, err := s.roleIn(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}
	q := `SELECT id, estate_id, property_id, reporter_id, category, description, urgency, status, vendor_id, cost_estimate_kobo, created_at
		FROM estate_repair_requests WHERE estate_id=$1`
	args := []any{estateID}
	if role != "estate_admin" {
		q += fmt.Sprintf(" AND reporter_id=$%d", len(args)+1)
		args = append(args, userID)
	}
	if status != "" {
		q += fmt.Sprintf(" AND status=$%d", len(args)+1)
		args = append(args, status)
	}
	q += " ORDER BY created_at DESC LIMIT 200"
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RepairRequest
	for rows.Next() {
		var r RepairRequest
		if err := rows.Scan(&r.ID, &r.EstateID, &r.PropertyID, &r.ReporterID, &r.Category, &r.Description, &r.Urgency, &r.Status, &r.VendorID, &r.CostEstimateKobo, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// AddRepairUpdate appends a status/note to a repair and moves the request status.
func (s *Service) AddRepairUpdate(ctx context.Context, estateID, userID, repairID string, req AddRepairUpdateRequest) (*RepairUpdate, error) {
	// Only admins drive the repair lifecycle.
	if err := s.assertEstateAdmin(ctx, estateID, userID); err != nil {
		return nil, err
	}
	// Verify the repair belongs to this estate (cross-estate isolation).
	var cnt int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM estate_repair_requests WHERE id=$1 AND estate_id=$2`, repairID, estateID).Scan(&cnt); err != nil || cnt == 0 {
		return nil, fmt.Errorf("estate: repair not found in this estate")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	u := &RepairUpdate{ID: uuid.New().String(), RequestID: repairID, Status: req.Status, Note: req.Note, ByUser: &userID, CreatedAt: time.Now()}
	if _, err := tx.Exec(ctx,
		`INSERT INTO repair_updates (id, estate_id, request_id, status, note, by_user) VALUES ($1,$2,$3,$4,$5,$6)`,
		u.ID, estateID, repairID, req.Status, req.Note, userID,
	); err != nil {
		return nil, fmt.Errorf("estate: insert repair update: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE estate_repair_requests SET status=$1 WHERE id=$2 AND estate_id=$3`, req.Status, repairID, estateID); err != nil {
		return nil, fmt.Errorf("estate: update repair status: %w", err)
	}
	return u, tx.Commit(ctx)
}

func (s *Service) ListRepairUpdates(ctx context.Context, estateID, userID, repairID string) ([]RepairUpdate, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	const q = `SELECT id, request_id, status, COALESCE(note,''), by_user, created_at
		FROM repair_updates WHERE request_id=$1 AND estate_id=$2 ORDER BY created_at`
	rows, err := s.db.Query(ctx, q, repairID, estateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RepairUpdate
	for rows.Next() {
		var u RepairUpdate
		if err := rows.Scan(&u.ID, &u.RequestID, &u.Status, &u.Note, &u.ByUser, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// ── Block 33: Facilities / Amenities ─────────────────────────────────────────

func (s *Service) CreateFacility(ctx context.Context, estateID, adminID string, req CreateFacilityRequest) (*Facility, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	kind := req.Kind
	if kind == "" {
		kind = "other"
	}
	f := &Facility{ID: uuid.New().String(), EstateID: estateID, Name: req.Name, Kind: kind, Capacity: req.Capacity, FeeKobo: req.FeeKobo, CreatedAt: time.Now()}
	const q = `INSERT INTO estate_facilities (id, estate_id, name, kind, capacity, fee_kobo) VALUES ($1,$2,$3,$4,$5,$6)`
	if _, err := s.db.Exec(ctx, q, f.ID, estateID, f.Name, kind, f.Capacity, f.FeeKobo); err != nil {
		return nil, fmt.Errorf("estate: insert facility: %w", err)
	}
	return f, nil
}

func (s *Service) ListFacilities(ctx context.Context, estateID, userID string) ([]Facility, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	const q = `SELECT id, estate_id, name, kind, capacity, fee_kobo, created_at FROM estate_facilities WHERE estate_id=$1 ORDER BY name`
	rows, err := s.db.Query(ctx, q, estateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Facility
	for rows.Next() {
		var f Facility
		if err := rows.Scan(&f.ID, &f.EstateID, &f.Name, &f.Kind, &f.Capacity, &f.FeeKobo, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// BookFacility reserves a facility. A soft or hard dues restriction blocks
// booking (Block 30 matrix).
func (s *Service) BookFacility(ctx context.Context, estateID, residentID, facilityID string, req BookFacilityRequest) (*FacilityBooking, error) {
	if err := s.assertResident(ctx, estateID, residentID); err != nil {
		return nil, err
	}
	if !req.EndsAt.After(req.StartsAt) {
		return nil, fmt.Errorf("estate: ends_at must be after starts_at")
	}
	// Dues-restriction enforcement: soft AND hard both block facility booking.
	if err := s.enforceNotRestricted(ctx, estateID, residentID, ActionFacility); err != nil {
		return nil, err
	}
	// Load fee (estate-scoped).
	var fee int64
	if err := s.db.QueryRow(ctx, `SELECT fee_kobo FROM estate_facilities WHERE id=$1 AND estate_id=$2`, facilityID, estateID).Scan(&fee); err != nil {
		return nil, fmt.Errorf("estate: facility not found in this estate")
	}
	b := &FacilityBooking{
		ID: uuid.New().String(), EstateID: estateID, FacilityID: facilityID, ResidentID: residentID,
		StartsAt: req.StartsAt, EndsAt: req.EndsAt, Status: "pending", AmountKobo: fee, CreatedAt: time.Now(),
	}
	const q = `INSERT INTO facility_bookings (id, estate_id, facility_id, resident_id, starts_at, ends_at, status, amount_kobo)
		VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)`
	if _, err := s.db.Exec(ctx, q, b.ID, estateID, facilityID, residentID, b.StartsAt, b.EndsAt, fee); err != nil {
		return nil, fmt.Errorf("estate: insert booking: %w", err)
	}
	// Block 36/43: confirm the booking to the resident. Fire-and-forget.
	s.notify(ctx, estateID, residentID, NotifFacilityBookingConfirmed, "Facility booking received", "Your booking is pending confirmation.", map[string]any{"booking_id": b.ID, "facility_id": facilityID})
	return b, nil
}

func (s *Service) ListMyBookings(ctx context.Context, estateID, residentID string) ([]FacilityBooking, error) {
	if err := s.assertResident(ctx, estateID, residentID); err != nil {
		return nil, err
	}
	const q = `SELECT id, estate_id, facility_id, resident_id, starts_at, ends_at, status, amount_kobo, created_at
		FROM facility_bookings WHERE estate_id=$1 AND resident_id=$2 ORDER BY starts_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, q, estateID, residentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FacilityBooking
	for rows.Next() {
		var b FacilityBooking
		if err := rows.Scan(&b.ID, &b.EstateID, &b.FacilityID, &b.ResidentID, &b.StartsAt, &b.EndsAt, &b.Status, &b.AmountKobo, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// ── Block 34: Announcements / Communication ──────────────────────────────────

func (s *Service) CreateAnnouncement(ctx context.Context, estateID, adminID string, req CreateAnnouncementRequest) (*Announcement, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	kind := req.Kind
	if kind == "" {
		kind = "general"
	}
	a := &Announcement{ID: uuid.New().String(), EstateID: estateID, Title: req.Title, Body: req.Body, Kind: kind, CreatedBy: adminID, CreatedAt: time.Now()}
	const q = `INSERT INTO estate_announcements (id, estate_id, title, body, kind, created_by) VALUES ($1,$2,$3,$4,$5,$6)`
	if _, err := s.db.Exec(ctx, q, a.ID, estateID, a.Title, a.Body, kind, adminID); err != nil {
		return nil, fmt.Errorf("estate: insert announcement: %w", err)
	}
	// Block 37/43: broadcast to all members (in-app feed + push). Fire-and-forget.
	s.notifyMembers(ctx, estateID, NotifAnnouncement, a.Title, a.Body, map[string]any{"announcement_id": a.ID, "kind": kind})
	return a, nil
}

func (s *Service) ListAnnouncements(ctx context.Context, estateID, userID string) ([]Announcement, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	const q = `
		SELECT a.id, a.estate_id, a.title, a.body, a.kind, a.created_by, a.created_at,
			(ar.id IS NOT NULL) AS read
		FROM estate_announcements a
		LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.user_id = $2
		WHERE a.estate_id=$1 ORDER BY a.created_at DESC LIMIT 100`
	rows, err := s.db.Query(ctx, q, estateID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Announcement
	for rows.Next() {
		var a Announcement
		if err := rows.Scan(&a.ID, &a.EstateID, &a.Title, &a.Body, &a.Kind, &a.CreatedBy, &a.CreatedAt, &a.Read); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Service) MarkAnnouncementRead(ctx context.Context, estateID, userID, announcementID string) error {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return err
	}
	// Verify announcement belongs to this estate (cross-estate isolation).
	var cnt int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM estate_announcements WHERE id=$1 AND estate_id=$2`, announcementID, estateID).Scan(&cnt); err != nil || cnt == 0 {
		return fmt.Errorf("estate: announcement not found in this estate")
	}
	_, err := s.db.Exec(ctx,
		`INSERT INTO announcement_reads (id, estate_id, announcement_id, user_id) VALUES (gen_random_uuid(),$1,$2,$3)
		 ON CONFLICT (announcement_id, user_id) DO NOTHING`,
		estateID, announcementID, userID,
	)
	return err
}

// ── Block 35: Emergencies / Incidents ────────────────────────────────────────

func (s *Service) RaiseEmergency(ctx context.Context, estateID, reporterID string, req RaiseEmergencyRequest) (*EmergencyAlert, error) {
	if err := s.assertResident(ctx, estateID, reporterID); err != nil {
		return nil, err
	}
	a := &EmergencyAlert{ID: uuid.New().String(), EstateID: estateID, ReporterID: reporterID, Kind: req.Kind, Description: req.Description, Location: req.Location, Status: "open", CreatedAt: time.Now()}
	const q = `INSERT INTO estate_emergency_alerts (id, estate_id, reporter_id, kind, description, location, status) VALUES ($1,$2,$3,$4,$5,$6,'open')`
	if _, err := s.db.Exec(ctx, q, a.ID, estateID, reporterID, a.Kind, a.Description, a.Location); err != nil {
		return nil, fmt.Errorf("estate: insert emergency: %w", err)
	}
	_ = s.audit(ctx, estateID, reporterID, "EMERGENCY_RAISE", "emergency", a.ID, map[string]any{"kind": a.Kind})
	// Block 38/43: escalate to estate admins + security staff. Fire-and-forget.
	s.notifyMembers(ctx, estateID, NotifEmergencyAlert, "Emergency: "+a.Kind, a.Description,
		map[string]any{"alert_id": a.ID, "kind": a.Kind, "location": a.Location},
		"estate_admin", "estate_security")
	return a, nil
}

func (s *Service) ListEmergencies(ctx context.Context, estateID, userID, status string) ([]EmergencyAlert, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	q := `SELECT id, estate_id, reporter_id, kind, COALESCE(description,''), COALESCE(location,''), status, created_at
		FROM estate_emergency_alerts WHERE estate_id=$1`
	args := []any{estateID}
	if status != "" {
		q += " AND status=$2"
		args = append(args, status)
	}
	q += " ORDER BY created_at DESC LIMIT 100"
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EmergencyAlert
	for rows.Next() {
		var a EmergencyAlert
		if err := rows.Scan(&a.ID, &a.EstateID, &a.ReporterID, &a.Kind, &a.Description, &a.Location, &a.Status, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Service) UpdateEmergencyStatus(ctx context.Context, estateID, adminID, alertID, status string) error {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return err
	}
	ct, err := s.db.Exec(ctx, `UPDATE estate_emergency_alerts SET status=$1 WHERE id=$2 AND estate_id=$3`, status, alertID, estateID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("estate: emergency not found in this estate")
	}
	return nil
}

// ── Block 36: Documents ──────────────────────────────────────────────────────

// CreateDocument records an uploaded document. Upload happens via a prior
// presigned-R2 step; here we validate the declared content type / size against
// the upload guard rails before persisting the object URL.
func (s *Service) CreateDocument(ctx context.Context, estateID, adminID string, req CreateDocumentRequest) (*Document, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if req.SizeBytes > MaxDocumentBytes {
		return nil, fmt.Errorf("estate: document exceeds max size of %d bytes", MaxDocumentBytes)
	}
	if req.ContentType != "" && !allowedContentType(req.ContentType) {
		return nil, fmt.Errorf("estate: content type %q not permitted", req.ContentType)
	}
	category := req.Category
	if category == "" {
		category = "general"
	}
	d := &Document{ID: uuid.New().String(), EstateID: estateID, Title: req.Title, Category: category, FileURL: req.FileURL, ObjectKey: req.ObjectKey, UploadedBy: adminID, Restricted: req.Restricted, CreatedAt: time.Now()}
	const q = `INSERT INTO estate_documents (id, estate_id, title, category, file_url, object_key, uploaded_by, restricted) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	if _, err := s.db.Exec(ctx, q, d.ID, estateID, d.Title, category, d.FileURL, d.ObjectKey, adminID, d.Restricted); err != nil {
		return nil, fmt.Errorf("estate: insert document: %w", err)
	}
	return d, nil
}

// docDownloadAllowed reports whether a caller with the given estate role may
// download a document with the given restricted flag. Restricted documents are
// admin-only, mirroring ListDocuments visibility. Pure (no DB) for unit testing.
func docDownloadAllowed(role string, restricted bool) bool {
	if restricted {
		return role == "estate_admin"
	}
	return true
}

// ResolveDocumentForDownload authorises a download and returns the document's R2
// object key (preferred) and stored file URL, scoped to the estate. The caller
// must be an estate member; restricted documents are admin-only. Returns
// ErrDocumentNotFound / ErrDocumentForbidden as appropriate.
func (s *Service) ResolveDocumentForDownload(ctx context.Context, estateID, userID, docID string) (objectKey, fileURL string, err error) {
	role, err := s.roleIn(ctx, estateID, userID)
	if err != nil {
		return "", "", err
	}
	var (
		key        *string // object_key is nullable for legacy rows
		furl       string
		restricted bool
	)
	const q = `SELECT object_key, file_url, restricted FROM estate_documents WHERE id=$1 AND estate_id=$2`
	if err := s.db.QueryRow(ctx, q, docID, estateID).Scan(&key, &furl, &restricted); err != nil {
		return "", "", ErrDocumentNotFound
	}
	if !docDownloadAllowed(role, restricted) {
		return "", "", ErrDocumentForbidden
	}
	if key != nil {
		objectKey = *key
	}
	return objectKey, furl, nil
}

func (s *Service) ListDocuments(ctx context.Context, estateID, userID, category string) ([]Document, error) {
	role, err := s.roleIn(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}
	q := `SELECT id, estate_id, title, category, file_url, uploaded_by, restricted, created_at
		FROM estate_documents WHERE estate_id=$1`
	args := []any{estateID}
	// Non-admins never see restricted documents.
	if role != "estate_admin" {
		q += " AND restricted=FALSE"
	}
	if category != "" {
		q += fmt.Sprintf(" AND category=$%d", len(args)+1)
		args = append(args, category)
	}
	q += " ORDER BY created_at DESC LIMIT 200"
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Document
	for rows.Next() {
		var d Document
		if err := rows.Scan(&d.ID, &d.EstateID, &d.Title, &d.Category, &d.FileURL, &d.UploadedBy, &d.Restricted, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func allowedContentType(ct string) bool {
	for _, a := range AllowedDocumentTypes {
		if a == ct {
			return true
		}
	}
	return false
}

// ── Block 37: Vendors / Artisans ─────────────────────────────────────────────

func (s *Service) CreateVendor(ctx context.Context, estateID, adminID string, req CreateVendorRequest) (*Vendor, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	category := req.Category
	if category == "" {
		category = "general"
	}
	v := &Vendor{ID: uuid.New().String(), EstateID: estateID, Name: req.Name, Category: category, Phone: req.Phone, Status: "pending", CreatedAt: time.Now()}
	if req.UserID != "" {
		v.UserID = &req.UserID
	}
	const q = `INSERT INTO estate_vendors (id, estate_id, user_id, name, category, phone, status) VALUES ($1,$2,$3,$4,$5,$6,'pending')`
	if _, err := s.db.Exec(ctx, q, v.ID, estateID, v.UserID, v.Name, category, v.Phone); err != nil {
		return nil, fmt.Errorf("estate: insert vendor: %w", err)
	}
	return v, nil
}

func (s *Service) ListVendors(ctx context.Context, estateID, userID, status string) ([]Vendor, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	q := `SELECT id, estate_id, user_id, name, category, COALESCE(phone,''), status, rating, created_at
		FROM estate_vendors WHERE estate_id=$1`
	args := []any{estateID}
	if status != "" {
		q += " AND status=$2"
		args = append(args, status)
	}
	q += " ORDER BY rating DESC, name LIMIT 200"
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Vendor
	for rows.Next() {
		var v Vendor
		if err := rows.Scan(&v.ID, &v.EstateID, &v.UserID, &v.Name, &v.Category, &v.Phone, &v.Status, &v.Rating, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Service) VerifyVendor(ctx context.Context, estateID, adminID, vendorID, status string) error {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return err
	}
	if status != "verified" && status != "suspended" && status != "pending" {
		return fmt.Errorf("estate: invalid vendor status")
	}
	ct, err := s.db.Exec(ctx, `UPDATE estate_vendors SET status=$1 WHERE id=$2 AND estate_id=$3`, status, vendorID, estateID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("estate: vendor not found in this estate")
	}
	return nil
}

// ── Block 40: Finance dashboard (derived, single round of scalar queries) ────

func (s *Service) FinanceDashboard(ctx context.Context, estateID, adminID string) (*FinanceDashboard, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	d := &FinanceDashboard{EstateID: estateID}
	// Single aggregate query over invoices (no N+1).
	const qInv = `
		SELECT
			COALESCE(SUM(amount_kobo) FILTER (WHERE status IN ('pending','overdue')),0) AS outstanding,
			COUNT(*) FILTER (WHERE status='pending')  AS pending,
			COUNT(*) FILTER (WHERE status='overdue')  AS overdue
		FROM estate_dues_invoices WHERE estate_id=$1`
	if err := s.db.QueryRow(ctx, qInv, estateID).Scan(&d.OutstandingDuesKobo, &d.PendingInvoices, &d.OverdueInvoices); err != nil {
		return nil, fmt.Errorf("estate: finance invoices: %w", err)
	}
	// Single aggregate query over payments.
	const qPay = `
		SELECT
			COALESCE(SUM(amount_kobo) FILTER (WHERE status='successful'),0) AS collected,
			COUNT(*) FILTER (WHERE status='successful' AND created_at >= date_trunc('month', NOW())) AS this_month
		FROM estate_payments WHERE estate_id=$1`
	if err := s.db.QueryRow(ctx, qPay, estateID).Scan(&d.TotalCollectedKobo, &d.PaymentsThisMonth); err != nil {
		return nil, fmt.Errorf("estate: finance payments: %w", err)
	}
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM estate_dues_restrictions WHERE estate_id=$1 AND active`, estateID).Scan(&d.ActiveRestrictions)
	return d, nil
}

// ── Block 43: Notifications (unified feed, derived) ──────────────────────────

func (s *Service) Notifications(ctx context.Context, estateID, userID string) ([]Notification, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	// Per-user persisted feed (Block 43): notifications are written to
	// estate_notifications by the emitting events (announcement, emergency,
	// payment, restriction, task, facility, …).
	const q = `
		SELECT id, category, title, COALESCE(body,''), created_at
		FROM estate_notifications
		WHERE estate_id=$1 AND user_id=$2
		ORDER BY created_at DESC LIMIT 50`
	rows, err := s.db.Query(ctx, q, estateID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Notification
	for rows.Next() {
		var n Notification
		if err := rows.Scan(&n.ID, &n.Kind, &n.Title, &n.Body, &n.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// ── Block 44: Reports & analytics (derived aggregates) ───────────────────────

func (s *Service) Report(ctx context.Context, estateID, adminID string) (*EstateReport, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	r := &EstateReport{EstateID: estateID}
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM estate_residents WHERE estate_id=$1`, estateID).Scan(&r.Residents)
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM estate_repair_requests WHERE estate_id=$1 AND status NOT IN ('completed','cancelled')`, estateID).Scan(&r.OpenRepairs)
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM estate_emergency_alerts WHERE estate_id=$1 AND status <> 'resolved'`, estateID).Scan(&r.OpenEmergencies)
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM estate_announcements WHERE estate_id=$1 AND created_at >= NOW() - INTERVAL '30 days'`, estateID).Scan(&r.Announcements30d)
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM estate_facilities WHERE estate_id=$1`, estateID).Scan(&r.FacilitiesCount)
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM estate_vendors WHERE estate_id=$1 AND status='verified'`, estateID).Scan(&r.VendorsVerified)
	return r, nil
}
