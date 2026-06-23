package estate

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"
	platformRedis "spotlight/backend/internal/platform/redis"
)

// AddressGeocoder resolves a typed address to a pin + Plus Code. Satisfied by
// maps.LocationGeocoder (the provider-agnostic MapService). Optional.
type AddressGeocoder interface {
	Geocode(ctx context.Context, address string) (lat, lng float64, plusCode string, err error)
}

// Service manages estates, visitor passes, and private elections.
type Service struct {
	db       *pgxpool.Pool
	redis    *goredis.Client
	geocoder AddressGeocoder
	ledger   LedgerPoster // optional; required only for the dues money path
	tiers    TierEnforcer // optional; fail-closed tier-limit check on money out
}

func NewService(db *pgxpool.Pool, redis *goredis.Client) *Service {
	return &Service{db: db, redis: redis}
}

// WithGeocoder attaches an address geocoder so new estates get a pin
// (geo_lat/geo_lng + plus_code) automatically, which syncs into merchant_locations.
func (s *Service) WithGeocoder(g AddressGeocoder) *Service {
	s.geocoder = g
	return s
}

// CreateEstate creates a new estate and assigns the creator as estate_admin.
func (s *Service) CreateEstate(ctx context.Context, adminID string, req CreateEstateRequest) (*Estate, error) {
	e := &Estate{
		ID:        uuid.New().String(),
		Name:      req.Name,
		Address:   req.Address,
		AdminID:   adminID,
		CreatedAt: time.Now(),
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("estate: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	const insertEstate = `INSERT INTO estates (id, name, address, admin_id) VALUES ($1,$2,$3,$4)`
	if _, err := tx.Exec(ctx, insertEstate, e.ID, e.Name, e.Address, e.AdminID); err != nil {
		return nil, fmt.Errorf("estate: insert estate: %w", err)
	}
	const insertResident = `INSERT INTO estate_residents (estate_id, user_id, unit, role) VALUES ($1,$2,'',  'estate_admin')`
	if _, err := tx.Exec(ctx, insertResident, e.ID, adminID); err != nil {
		return nil, fmt.Errorf("estate: insert admin resident: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("estate: commit: %w", err)
	}

	// Best-effort: geocode the address to a pin so "near me" works. The UPDATE
	// fires the merchant_locations sync trigger. A geocode failure never fails
	// estate creation (the pin can be set later via /maps/locations).
	if s.geocoder != nil && e.Address != "" {
		if lat, lng, plus, gerr := s.geocoder.Geocode(ctx, e.Address); gerr == nil {
			_, _ = s.db.Exec(ctx,
				`UPDATE estates SET geo_lat=$2, geo_lng=$3, plus_code=$4 WHERE id=$1`,
				e.ID, lat, lng, plus)
		}
	}
	return e, nil
}

// AddResident adds a verified resident to an estate (admin only).
func (s *Service) AddResident(ctx context.Context, estateID, adminID, userID, unit string) (*Resident, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	r := &Resident{
		ID:       uuid.New().String(),
		EstateID: estateID,
		UserID:   userID,
		Unit:     unit,
		Role:     "resident",
	}
	const q = `
		INSERT INTO estate_residents (id, estate_id, user_id, unit, role)
		VALUES ($1,$2,$3,$4,'resident')
		ON CONFLICT (estate_id, user_id) DO UPDATE SET unit = EXCLUDED.unit
		RETURNING id, estate_id, user_id, unit, role, created_at`
	return r, s.db.QueryRow(ctx, q, r.ID, r.EstateID, r.UserID, r.Unit).Scan(
		&r.ID, &r.EstateID, &r.UserID, &r.Unit, &r.Role, &r.CreatedAt,
	)
}

// IssueVisitorPass creates a visitor QR pass for a resident.
func (s *Service) IssueVisitorPass(ctx context.Context, estateID, issuerID string, req IssuePassRequest) (*VisitorPass, error) {
	if err := s.assertResident(ctx, estateID, issuerID); err != nil {
		return nil, err
	}
	if req.ValidUntil.Before(req.ValidFrom) {
		return nil, fmt.Errorf("estate: valid_until must be after valid_from")
	}
	p := &VisitorPass{
		ID:          uuid.New().String(),
		EstateID:    estateID,
		IssuedBy:    issuerID,
		VisitorName: req.VisitorName,
		Purpose:     req.Purpose,
		QRCode:      uuid.New().String(),
		ValidFrom:   req.ValidFrom,
		ValidUntil:  req.ValidUntil,
		Status:      "active",
		CreatedAt:   time.Now(),
	}
	const q = `
		INSERT INTO visitor_passes (id, estate_id, issued_by, visitor_name, purpose, qr_code, valid_from, valid_until, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')`
	_, err := s.db.Exec(ctx, q, p.ID, p.EstateID, p.IssuedBy, p.VisitorName, p.Purpose, p.QRCode, p.ValidFrom, p.ValidUntil)
	return p, err
}

// ScanVisitorPass marks a pass as used. Only estate security (admin) can scan.
func (s *Service) ScanVisitorPass(ctx context.Context, estateID, scannerID, qrCode string) (*VisitorPass, error) {
	if err := s.assertEstateAdmin(ctx, estateID, scannerID); err != nil {
		return nil, err
	}
	now := time.Now()
	const q = `
		UPDATE visitor_passes SET status='used', used_at=$1
		WHERE qr_code=$2 AND estate_id=$3 AND status='active' AND valid_from <= $1 AND valid_until >= $1
		RETURNING id, estate_id, issued_by, visitor_name, purpose, qr_code, valid_from, valid_until, used_at, status, created_at`
	p := &VisitorPass{}
	if err := s.db.QueryRow(ctx, q, now, qrCode, estateID).Scan(
		&p.ID, &p.EstateID, &p.IssuedBy, &p.VisitorName, &p.Purpose,
		&p.QRCode, &p.ValidFrom, &p.ValidUntil, &p.UsedAt, &p.Status, &p.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("estate: pass not found, already used, or expired")
	}
	return p, nil
}

// CreateElection creates a new election within an estate (admin only).
func (s *Service) CreateElection(ctx context.Context, estateID, creatorID string, req CreateElectionRequest) (*Election, error) {
	if err := s.assertEstateAdmin(ctx, estateID, creatorID); err != nil {
		return nil, err
	}
	if req.EndsAt.Before(req.StartsAt) {
		return nil, fmt.Errorf("estate: ends_at must be after starts_at")
	}
	if len(req.Candidates) < 2 {
		return nil, fmt.Errorf("estate: election must have at least 2 candidates")
	}

	el := &Election{
		ID:          uuid.New().String(),
		EstateID:    estateID,
		Title:       req.Title,
		Description: req.Description,
		StartsAt:    req.StartsAt,
		EndsAt:      req.EndsAt,
		Status:      "draft",
		CreatedBy:   creatorID,
		CreatedAt:   time.Now(),
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("estate: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	const insertEl = `INSERT INTO elections (id, estate_id, title, description, starts_at, ends_at, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,'draft',$7)`
	if _, err := tx.Exec(ctx, insertEl, el.ID, el.EstateID, el.Title, el.Description, el.StartsAt, el.EndsAt, el.CreatedBy); err != nil {
		return nil, fmt.Errorf("estate: insert election: %w", err)
	}
	for _, c := range req.Candidates {
		c.ID = uuid.New().String()
		c.ElectionID = el.ID
		const insertC = `INSERT INTO election_candidates (id, election_id, name, bio) VALUES ($1,$2,$3,$4)`
		if _, err := tx.Exec(ctx, insertC, c.ID, c.ElectionID, c.Name, c.Bio); err != nil {
			return nil, fmt.Errorf("estate: insert candidate: %w", err)
		}
	}
	return el, tx.Commit(ctx)
}

// CastVote casts a vote in an open election using a Redlock-protected atomic check.
// Enforces one-vote-per-resident via UNIQUE(election_id, voter_id).
func (s *Service) CastVote(ctx context.Context, estateID, electionID, voterID string, req CastVoteRequest) (*Vote, error) {
	// Verify voter is a resident.
	if err := s.assertResident(ctx, estateID, voterID); err != nil {
		return nil, err
	}
	// Verify election is open.
	var status string
	var startsAt, endsAt time.Time
	if err := s.db.QueryRow(ctx, `SELECT status, starts_at, ends_at FROM elections WHERE id=$1 AND estate_id=$2`, electionID, estateID).
		Scan(&status, &startsAt, &endsAt); err != nil {
		return nil, fmt.Errorf("estate: election not found")
	}
	now := time.Now()
	if status != "open" || now.Before(startsAt) || now.After(endsAt) {
		return nil, fmt.Errorf("estate: election is not currently open for voting")
	}

	// Acquire Redlock to prevent duplicate concurrent submissions.
	lockKey := fmt.Sprintf("election:%s:voter:%s", electionID, voterID)
	if s.redis != nil {
		ok, token, err := platformRedis.AcquireLock(ctx, s.redis, lockKey, 10*time.Second)
		if err != nil || !ok {
			return nil, fmt.Errorf("estate: vote lock contention — try again")
		}
		defer platformRedis.ReleaseLock(ctx, s.redis, lockKey, token)
	}

	v := &Vote{
		ID:          uuid.New().String(),
		ElectionID:  electionID,
		VoterID:     voterID,
		CandidateID: req.CandidateID,
		CastAt:      time.Now(),
	}
	const q = `
		INSERT INTO election_votes (id, election_id, voter_id, candidate_id)
		VALUES ($1,$2,$3,$4)`
	if _, err := s.db.Exec(ctx, q, v.ID, v.ElectionID, v.VoterID, v.CandidateID); err != nil {
		return nil, fmt.Errorf("estate: vote already cast or candidate invalid")
	}
	return v, nil
}

// GetResults returns the tally for a closed/tallied election.
func (s *Service) GetResults(ctx context.Context, estateID, electionID string) ([]Candidate, error) {
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM elections WHERE id=$1 AND estate_id=$2`, electionID, estateID).Scan(&status); err != nil {
		return nil, fmt.Errorf("estate: election not found")
	}
	if status != "closed" && status != "tallied" {
		return nil, fmt.Errorf("estate: results only available after election closes")
	}
	const q = `
		SELECT ec.id, ec.election_id, ec.name, ec.bio, COUNT(ev.id) AS votes
		FROM election_candidates ec
		LEFT JOIN election_votes ev ON ev.candidate_id = ec.id
		WHERE ec.election_id = $1
		GROUP BY ec.id ORDER BY votes DESC`
	rows, err := s.db.Query(ctx, q, electionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Candidate
	for rows.Next() {
		var c Candidate
		if err := rows.Scan(&c.ID, &c.ElectionID, &c.Name, &c.Bio, &c.Votes); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ── Block 28: Security gate / guard app ───────────────────────────────────────

// ListGates returns all active gates for an estate.
func (s *Service) ListGates(ctx context.Context, estateID string) ([]Gate, error) {
	const q = `SELECT id, estate_id, name, gate_type, active, created_at FROM estate_gates WHERE estate_id=$1 AND active=TRUE ORDER BY name`
	rows, err := s.db.Query(ctx, q, estateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Gate
	for rows.Next() {
		var g Gate
		if err := rows.Scan(&g.ID, &g.EstateID, &g.Name, &g.GateType, &g.Active, &g.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// LookupCode resolves a numeric or QR code to an access code record.
// Returns blacklisted status and whether entry is allowed.
func (s *Service) LookupCode(ctx context.Context, estateID, numericCode, qrCode string) (*CheckinPayload, error) {
	var c AccessCode
	var residentUnit string

	q := `SELECT id, estate_id, issued_by, visitor_name, COALESCE(visitor_phone,''), COALESCE(vehicle_plate,''),
		COALESCE(purpose,''), code_type, numeric_code, qr_code::TEXT, valid_from, valid_until,
		used_count, max_uses, status, blacklisted, created_at
		FROM visitor_access_codes WHERE estate_id=$1`
	if numericCode != "" {
		q += " AND numeric_code=$2"
	} else {
		q += " AND qr_code=$2::UUID"
	}
	lookup := numericCode
	if lookup == "" {
		lookup = qrCode
	}
	if err := s.db.QueryRow(ctx, q, estateID, lookup).Scan(
		&c.ID, &c.EstateID, &c.IssuedBy, &c.VisitorName, &c.VisitorPhone,
		&c.VehiclePlate, &c.Purpose, &c.CodeType, &c.NumericCode, &c.QRCode,
		&c.ValidFrom, &c.ValidUntil, &c.UsedCount, &c.MaxUses, &c.Status, &c.Blacklisted, &c.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("access code not found")
	}

	// Resolve the issuing resident's unit for display.
	_ = s.db.QueryRow(ctx,
		`SELECT COALESCE(unit,'') FROM estate_residents WHERE estate_id=$1 AND user_id=$2`,
		estateID, c.IssuedBy,
	).Scan(&residentUnit)

	allowed := c.Status == "active" &&
		!c.Blacklisted &&
		c.ValidFrom.Before(time.Now()) &&
		c.ValidUntil.After(time.Now()) &&
		c.UsedCount < c.MaxUses

	return &CheckinPayload{
		Code:         &c,
		ResidentUnit: residentUnit,
		Blacklisted:  c.Blacklisted,
		Allowed:      allowed,
	}, nil
}

// CheckInVisitor records a gate arrival and increments used_count.
func (s *Service) CheckInVisitor(ctx context.Context, estateID, guardID string, req GuardCheckinRequest) (*CheckinPayload, error) {
	payload, err := s.LookupCode(ctx, estateID, req.NumericCode, req.QRCode)
	if err != nil {
		return nil, err
	}
	if !payload.Allowed {
		return payload, fmt.Errorf("entry denied: %s", denyReason(payload.Code))
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx,
		`UPDATE visitor_access_codes SET used_count=used_count+1,
		status=CASE WHEN used_count+1 >= max_uses THEN 'used' ELSE status END
		WHERE id=$1`, payload.Code.ID,
	)
	if err != nil {
		return nil, err
	}

	checkinID := uuid.New().String()
	_, err = tx.Exec(ctx,
		`INSERT INTO visitor_checkins (id, code_id, guard_id, gate_id, event, captured_at, photo_url)
		VALUES ($1,$2,$3,$4,'arrived',NOW(),$5)`,
		checkinID, payload.Code.ID, guardID, req.GateID, req.PhotoURL,
	)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	payload.CheckinID = checkinID
	return payload, nil
}

// CheckOutVisitor records a gate departure.
func (s *Service) CheckOutVisitor(ctx context.Context, estateID, guardID, codeID, gateID string) error {
	// Verify code belongs to this estate.
	var cnt int
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM visitor_access_codes WHERE id=$1 AND estate_id=$2`, codeID, estateID,
	).Scan(&cnt); err != nil || cnt == 0 {
		return fmt.Errorf("code not found in this estate")
	}
	_, err := s.db.Exec(ctx,
		`INSERT INTO visitor_checkins (id, code_id, guard_id, gate_id, event, captured_at)
		VALUES ($1,$2,$3,$4,'checked_out',NOW())`,
		uuid.New().String(), codeID, guardID, gateID,
	)
	return err
}

// SubmitIncidentReport saves a guard incident report.
func (s *Service) SubmitIncidentReport(ctx context.Context, estateID, guardID string, req SubmitIncidentRequest) (*IncidentReport, error) {
	rep := &IncidentReport{
		ID: uuid.New().String(), EstateID: estateID, GuardID: guardID,
		GateID: req.GateID, IncidentType: req.IncidentType,
		Description: req.Description, EvidenceURL: req.EvidenceURL,
		Escalated: req.Escalated, CreatedAt: time.Now(),
	}
	const q = `INSERT INTO gate_incident_reports (id, estate_id, guard_id, gate_id, incident_type, description, evidence_url, escalated) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	_, err := s.db.Exec(ctx, q, rep.ID, rep.EstateID, rep.GuardID, nilIfEmpty(rep.GateID), rep.IncidentType, rep.Description, nilIfEmpty(rep.EvidenceURL), rep.Escalated)
	return rep, err
}

// HandoverShift closes the current shift and optionally starts the next.
func (s *Service) HandoverShift(ctx context.Context, estateID, guardID string, req HandoverRequest) (*GuardShift, error) {
	// Close existing open shift if any.
	_, _ = s.db.Exec(ctx,
		`UPDATE guard_shifts SET ended_at=NOW(), handover_notes=$1, relieved_by=$2
		WHERE estate_id=$3 AND guard_id=$4 AND ended_at IS NULL`,
		req.HandoverNotes, nilIfEmpty(req.RelievedBy), estateID, guardID,
	)
	// Open new shift.
	shift := &GuardShift{
		ID: uuid.New().String(), GuardID: guardID, GateID: req.GateID,
		EstateID: estateID, StartedAt: time.Now(), CreatedAt: time.Now(),
	}
	_, err := s.db.Exec(ctx,
		`INSERT INTO guard_shifts (id, guard_id, gate_id, estate_id, started_at) VALUES ($1,$2,$3,$4,NOW())`,
		shift.ID, shift.GuardID, shift.GateID, shift.EstateID,
	)
	return shift, err
}

// GetExpectedVisitors returns access codes valid within the next 4 hours.
func (s *Service) GetExpectedVisitors(ctx context.Context, estateID string) ([]AccessCode, error) {
	const q = `SELECT id, estate_id, issued_by, visitor_name, COALESCE(visitor_phone,''), COALESCE(vehicle_plate,''),
		COALESCE(purpose,''), code_type, numeric_code, qr_code::TEXT, valid_from, valid_until,
		used_count, max_uses, status, blacklisted, created_at
		FROM visitor_access_codes
		WHERE estate_id=$1 AND status='active' AND valid_from <= NOW() + INTERVAL '4 hours' AND valid_until > NOW()
		ORDER BY valid_from LIMIT 100`
	rows, err := s.db.Query(ctx, q, estateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AccessCode
	for rows.Next() {
		var c AccessCode
		if err := rows.Scan(&c.ID, &c.EstateID, &c.IssuedBy, &c.VisitorName, &c.VisitorPhone,
			&c.VehiclePlate, &c.Purpose, &c.CodeType, &c.NumericCode, &c.QRCode,
			&c.ValidFrom, &c.ValidUntil, &c.UsedCount, &c.MaxUses, &c.Status, &c.Blacklisted, &c.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// SyncOfflineLogs bulk-inserts offline gate events (idempotent via client_id UNIQUE).
func (s *Service) SyncOfflineLogs(ctx context.Context, estateID, guardID string, logs []OfflineLogEntry) (int, error) {
	synced := 0
	for _, l := range logs {
		payloadJSON, _ := json.Marshal(l.Payload)
		_, err := s.db.Exec(ctx,
			`INSERT INTO offline_gate_logs (id, estate_id, guard_id, client_id, event_type, payload, captured_at)
			VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
			ON CONFLICT (client_id) DO NOTHING`,
			estateID, guardID, l.ClientID, l.EventType, payloadJSON, l.CapturedAt,
		)
		if err == nil {
			synced++
		}
	}
	return synced, nil
}

// ListIncidents returns recent incidents for an estate (admin only).
func (s *Service) ListIncidents(ctx context.Context, estateID, adminID string) ([]IncidentReport, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	const q = `SELECT id, estate_id, guard_id, COALESCE(gate_id::TEXT,''), incident_type, description, COALESCE(evidence_url,''), escalated, created_at
		FROM gate_incident_reports WHERE estate_id=$1 ORDER BY created_at DESC LIMIT 100`
	rows, err := s.db.Query(ctx, q, estateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IncidentReport
	for rows.Next() {
		var r IncidentReport
		if err := rows.Scan(&r.ID, &r.EstateID, &r.GuardID, &r.GateID, &r.IncidentType, &r.Description, &r.EvidenceURL, &r.Escalated, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// denyReason returns a human-readable string for why entry is denied.
func denyReason(c *AccessCode) string {
	if c == nil {
		return "code not found"
	}
	if c.Blacklisted {
		return "visitor is blacklisted"
	}
	if c.Status == "revoked" {
		return "code has been revoked"
	}
	if c.Status == "expired" || c.ValidUntil.Before(time.Now()) {
		return "code has expired"
	}
	if c.UsedCount >= c.MaxUses {
		return "code has reached maximum uses"
	}
	return "code is not yet valid"
}

// nilIfEmpty returns nil if s is empty, otherwise returns &s.
func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ── Block 27: Extended visitor access codes ───────────────────────────────────

// generateNumericCode produces a random 6-digit string, retrying on collision.
func generateNumericCode() string {
	return fmt.Sprintf("%06d", uuid.New().ID()%1_000_000)
}

// CreateAccessCode issues a typed visitor access code with a unique 6-digit numeric code.
func (s *Service) CreateAccessCode(ctx context.Context, estateID, userID string, req CreateAccessCodeRequest) (*AccessCode, error) {
	if _, err := s.getResidentID(ctx, estateID, userID); err != nil {
		return nil, err
	}
	if req.MaxUses < 1 {
		req.MaxUses = 1
	}
	if req.ValidUntil.Before(req.ValidFrom) {
		return nil, fmt.Errorf("valid_until must be after valid_from")
	}

	// Retry up to 5 times to get a unique numeric code.
	var code *AccessCode
	for i := 0; i < 5; i++ {
		numeric := generateNumericCode()
		qrID := uuid.New().String()
		c := &AccessCode{
			ID: uuid.New().String(), EstateID: estateID, IssuedBy: userID,
			VisitorName: req.VisitorName, VisitorPhone: req.VisitorPhone,
			VehiclePlate: req.VehiclePlate, Purpose: req.Purpose,
			CodeType: req.CodeType, NumericCode: numeric, QRCode: qrID,
			ValidFrom: req.ValidFrom, ValidUntil: req.ValidUntil,
			MaxUses: req.MaxUses, Status: "active", CreatedAt: time.Now(),
			Recurrence: req.Recurrence,
		}
		const q = `
			INSERT INTO visitor_access_codes
				(id, estate_id, issued_by, visitor_name, visitor_phone, vehicle_plate, purpose,
				 code_type, numeric_code, qr_code, valid_from, valid_until, recurrence, max_uses)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`
		_, err := s.db.Exec(ctx, q,
			c.ID, estateID, userID, req.VisitorName, req.VisitorPhone, req.VehiclePlate, req.Purpose,
			req.CodeType, numeric, qrID, req.ValidFrom, req.ValidUntil, req.Recurrence, req.MaxUses,
		)
		if err != nil {
			// If duplicate numeric code, retry.
			continue
		}
		code = c
		break
	}
	if code == nil {
		return nil, fmt.Errorf("failed to generate unique access code, try again")
	}
	return code, nil
}

// ListAccessCodes returns visitor access codes for the caller, filtered by status.
func (s *Service) ListAccessCodes(ctx context.Context, estateID, userID, status string) ([]AccessCode, error) {
	if _, err := s.getResidentID(ctx, estateID, userID); err != nil {
		return nil, err
	}
	q := `SELECT id, estate_id, issued_by, visitor_name, COALESCE(visitor_phone,''), COALESCE(vehicle_plate,''),
		COALESCE(purpose,''), code_type, numeric_code, qr_code::TEXT, valid_from, valid_until,
		used_count, max_uses, status, blacklisted, created_at
		FROM visitor_access_codes WHERE estate_id=$1 AND issued_by=$2`
	args := []any{estateID, userID}
	if status != "" {
		q += " AND status=$3"
		args = append(args, status)
	}
	q += " ORDER BY created_at DESC LIMIT 100"
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AccessCode
	for rows.Next() {
		var c AccessCode
		if err := rows.Scan(&c.ID, &c.EstateID, &c.IssuedBy, &c.VisitorName, &c.VisitorPhone,
			&c.VehiclePlate, &c.Purpose, &c.CodeType, &c.NumericCode, &c.QRCode,
			&c.ValidFrom, &c.ValidUntil, &c.UsedCount, &c.MaxUses, &c.Status, &c.Blacklisted, &c.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetAccessCode returns a single access code by ID.
func (s *Service) GetAccessCode(ctx context.Context, estateID, userID, codeID string) (*AccessCode, error) {
	if _, err := s.getResidentID(ctx, estateID, userID); err != nil {
		return nil, err
	}
	var c AccessCode
	const q = `SELECT id, estate_id, issued_by, visitor_name, COALESCE(visitor_phone,''), COALESCE(vehicle_plate,''),
		COALESCE(purpose,''), code_type, numeric_code, qr_code::TEXT, valid_from, valid_until,
		used_count, max_uses, status, blacklisted, created_at
		FROM visitor_access_codes WHERE id=$1 AND estate_id=$2`
	err := s.db.QueryRow(ctx, q, codeID, estateID).Scan(
		&c.ID, &c.EstateID, &c.IssuedBy, &c.VisitorName, &c.VisitorPhone,
		&c.VehiclePlate, &c.Purpose, &c.CodeType, &c.NumericCode, &c.QRCode,
		&c.ValidFrom, &c.ValidUntil, &c.UsedCount, &c.MaxUses, &c.Status, &c.Blacklisted, &c.CreatedAt,
	)
	return &c, err
}

// RevokeCode sets a code status to revoked.
func (s *Service) RevokeCode(ctx context.Context, estateID, userID, codeID string) error {
	_, err := s.db.Exec(ctx,
		`UPDATE visitor_access_codes SET status='revoked' WHERE id=$1 AND estate_id=$2 AND issued_by=$3`,
		codeID, estateID, userID,
	)
	return err
}

// ExtendCode pushes the valid_until date forward.
func (s *Service) ExtendCode(ctx context.Context, estateID, userID, codeID string, validUntil time.Time) error {
	if validUntil.Before(time.Now()) {
		return fmt.Errorf("new valid_until must be in the future")
	}
	_, err := s.db.Exec(ctx,
		`UPDATE visitor_access_codes SET valid_until=$1 WHERE id=$2 AND estate_id=$3 AND issued_by=$4`,
		validUntil, codeID, estateID, userID,
	)
	return err
}

// BlacklistVisitor marks a visitor code as blacklisted (estate admin only).
func (s *Service) BlacklistVisitor(ctx context.Context, estateID, adminID, codeID string) error {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return err
	}
	_, err := s.db.Exec(ctx,
		`UPDATE visitor_access_codes SET blacklisted=TRUE, status='revoked' WHERE id=$1 AND estate_id=$2`,
		codeID, estateID,
	)
	return err
}

// GetCheckinHistory returns all gate events for a code.
func (s *Service) GetCheckinHistory(ctx context.Context, estateID, userID, codeID string) ([]Checkin, error) {
	if _, err := s.getResidentID(ctx, estateID, userID); err != nil {
		return nil, err
	}
	// Verify the code belongs to this user.
	var ownerID string
	if err := s.db.QueryRow(ctx,
		`SELECT issued_by FROM visitor_access_codes WHERE id=$1 AND estate_id=$2`, codeID, estateID,
	).Scan(&ownerID); err != nil || ownerID != userID {
		return nil, fmt.Errorf("access denied or code not found")
	}
	const q = `SELECT id, code_id, guard_id, COALESCE(gate_id,''), event, captured_at, COALESCE(photo_url,'')
		FROM visitor_checkins WHERE code_id=$1 ORDER BY captured_at DESC`
	rows, err := s.db.Query(ctx, q, codeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Checkin
	for rows.Next() {
		var ch Checkin
		if err := rows.Scan(&ch.ID, &ch.CodeID, &ch.GuardID, &ch.GateID, &ch.Event, &ch.CapturedAt, &ch.PhotoURL); err != nil {
			return nil, err
		}
		out = append(out, ch)
	}
	return out, rows.Err()
}

// ── Block 26: Resident home dashboard ─────────────────────────────────────────

// GetDashboard returns the aggregated estate dashboard for a resident.
func (s *Service) GetDashboard(ctx context.Context, estateID, userID string) (*EstateDashboard, error) {
	resID, err := s.getResidentID(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}

	dash := &EstateDashboard{
		EstateID:         estateID,
		UpcomingMeetings: []DashboardMeeting{},
		Announcements:    []DashboardAnnouncement{},
		SecurityAlerts:   []DashboardSecurityAlert{},
	}

	// Estate name + resident unit.
	_ = s.db.QueryRow(ctx, `
		SELECT e.name, COALESCE(er.unit,'')
		FROM estates e
		JOIN estate_residents er ON er.estate_id = e.id
		WHERE e.id=$1 AND er.id=$2`, estateID, resID,
	).Scan(&dash.EstateName, &dash.ResidentUnit)

	// Active visitor passes.
	_ = s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM visitor_passes WHERE estate_id=$1 AND issued_by=$2 AND status='active' AND valid_until > NOW()`,
		estateID, userID,
	).Scan(&dash.ActiveVisitorCodes)

	// Open elections.
	_ = s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM elections WHERE estate_id=$1 AND status='open'`,
		estateID,
	).Scan(&dash.OpenElections)

	// Vehicles registered by this resident.
	_ = s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM resident_vehicles WHERE resident_id=$1`, resID,
	).Scan(&dash.VehicleCount)

	// Household members.
	_ = s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM household_members WHERE resident_id=$1`, resID,
	).Scan(&dash.HouseholdCount)

	// Property occupancy status.
	_ = s.db.QueryRow(ctx, `
		SELECT ep.occupancy_status
		FROM estate_properties ep
		WHERE ep.estate_id=$1 AND (ep.landlord_id=$2 OR ep.tenant_id=$2)
		LIMIT 1`, estateID, userID,
	).Scan(&dash.PropertyStatus)

	return dash, nil
}

// ── Block 25: Resident profiles ───────────────────────────────────────────────

// getResidentID resolves the estate_residents.id for a given (estateID, userID) pair.
func (s *Service) getResidentID(ctx context.Context, estateID, userID string) (string, error) {
	var id string
	if err := s.db.QueryRow(ctx,
		`SELECT id FROM estate_residents WHERE estate_id=$1 AND user_id=$2`, estateID, userID,
	).Scan(&id); err != nil {
		return "", fmt.Errorf("estate: not a member of this estate")
	}
	return id, nil
}

// UpsertProfile creates or updates the extended profile for a resident.
func (s *Service) UpsertProfile(ctx context.Context, estateID, userID string, req UpsertProfileRequest) (*ResidentProfile, error) {
	resID, err := s.getResidentID(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}
	if req.Visibility == "" {
		req.Visibility = "members"
	}
	if req.OccupancyType == "" {
		req.OccupancyType = "resident"
	}

	ecJSON, _ := marshalJSON(req.EmergencyContact)
	nokJSON, _ := marshalJSON(req.NextOfKin)

	p := &ResidentProfile{}
	const q = `
		INSERT INTO resident_profiles
			(id, resident_id, bio, profile_photo_url, phone, alt_phone, emergency_contact, next_of_kin,
			 occupancy_type, lease_start, lease_end, agreement_url, ownership_doc_url, visibility)
		VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (resident_id) DO UPDATE SET
			bio=EXCLUDED.bio, profile_photo_url=EXCLUDED.profile_photo_url,
			phone=EXCLUDED.phone, alt_phone=EXCLUDED.alt_phone,
			emergency_contact=EXCLUDED.emergency_contact, next_of_kin=EXCLUDED.next_of_kin,
			occupancy_type=EXCLUDED.occupancy_type, lease_start=EXCLUDED.lease_start,
			lease_end=EXCLUDED.lease_end, agreement_url=EXCLUDED.agreement_url,
			ownership_doc_url=EXCLUDED.ownership_doc_url, visibility=EXCLUDED.visibility,
			updated_at=NOW()
		RETURNING id, resident_id, COALESCE(bio,''), COALESCE(profile_photo_url,''),
			COALESCE(phone,''), COALESCE(alt_phone,''),
			occupancy_type, COALESCE(visibility,'members'), created_at, updated_at`
	err = s.db.QueryRow(ctx, q,
		resID, req.Bio, req.ProfilePhotoURL, req.Phone, req.AltPhone,
		ecJSON, nokJSON, req.OccupancyType, req.LeaseStart, req.LeaseEnd,
		req.AgreementURL, req.OwnershipDocURL, req.Visibility,
	).Scan(&p.ID, &p.ResidentID, &p.Bio, &p.ProfilePhotoURL, &p.Phone, &p.AltPhone,
		&p.OccupancyType, &p.Visibility, &p.CreatedAt, &p.UpdatedAt)
	return p, err
}

// GetProfile returns the extended profile for a resident.
func (s *Service) GetProfile(ctx context.Context, estateID, userID string) (*ResidentProfile, error) {
	resID, err := s.getResidentID(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}
	p := &ResidentProfile{}
	const q = `
		SELECT id, resident_id, COALESCE(bio,''), COALESCE(profile_photo_url,''),
			COALESCE(phone,''), COALESCE(alt_phone,''),
			occupancy_type, COALESCE(visibility,'members'), created_at, updated_at
		FROM resident_profiles WHERE resident_id=$1`
	if err := s.db.QueryRow(ctx, q, resID).Scan(&p.ID, &p.ResidentID, &p.Bio, &p.ProfilePhotoURL,
		&p.Phone, &p.AltPhone, &p.OccupancyType, &p.Visibility, &p.CreatedAt, &p.UpdatedAt,
	); err != nil {
		// Return an empty profile if none exists yet.
		return &ResidentProfile{ResidentID: resID, Visibility: "members", OccupancyType: "resident"}, nil
	}
	return p, nil
}

// AddHouseholdMember registers a family member under a resident.
func (s *Service) AddHouseholdMember(ctx context.Context, estateID, userID string, req AddHouseholdMemberRequest) (*HouseholdMember, error) {
	resID, err := s.getResidentID(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}
	m := &HouseholdMember{
		ID: uuid.New().String(), ResidentID: resID,
		FullName: req.FullName, Relationship: req.Relationship,
		IDType: req.IDType, IDNumber: req.IDNumber, PhotoURL: req.PhotoURL,
		CreatedAt: time.Now(),
	}
	if req.DOB != "" {
		m.DOB = &req.DOB
	}
	const q = `
		INSERT INTO household_members (id, resident_id, full_name, relationship, dob, id_type, id_number, photo_url)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	_, err = s.db.Exec(ctx, q, m.ID, m.ResidentID, m.FullName, m.Relationship, m.DOB, m.IDType, m.IDNumber, m.PhotoURL)
	return m, err
}

// ListHouseholdMembers returns all household members for a resident.
func (s *Service) ListHouseholdMembers(ctx context.Context, estateID, userID string) ([]HouseholdMember, error) {
	resID, err := s.getResidentID(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}
	const q = `SELECT id, resident_id, full_name, relationship, dob::TEXT, COALESCE(id_type,''), COALESCE(id_number,''), COALESCE(photo_url,''), created_at FROM household_members WHERE resident_id=$1 ORDER BY created_at`
	rows, err := s.db.Query(ctx, q, resID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []HouseholdMember
	for rows.Next() {
		var m HouseholdMember
		var dob *string
		if err := rows.Scan(&m.ID, &m.ResidentID, &m.FullName, &m.Relationship, &dob, &m.IDType, &m.IDNumber, &m.PhotoURL, &m.CreatedAt); err != nil {
			return nil, err
		}
		m.DOB = dob
		out = append(out, m)
	}
	return out, rows.Err()
}

// DeleteHouseholdMember removes a household member.
func (s *Service) DeleteHouseholdMember(ctx context.Context, estateID, userID, memberID string) error {
	resID, err := s.getResidentID(ctx, estateID, userID)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `DELETE FROM household_members WHERE id=$1 AND resident_id=$2`, memberID, resID)
	return err
}

// AddDomesticStaff registers a domestic worker under a resident.
func (s *Service) AddDomesticStaff(ctx context.Context, estateID, userID string, req AddDomesticStaffRequest) (*DomesticStaff, error) {
	resID, err := s.getResidentID(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}
	st := &DomesticStaff{
		ID: uuid.New().String(), ResidentID: resID,
		FullName: req.FullName, Role: req.Role,
		PhotoURL: req.PhotoURL, IDType: req.IDType, IDNumber: req.IDNumber, Phone: req.Phone,
		Status: "active", CreatedAt: time.Now(),
	}
	const q = `INSERT INTO domestic_staff (id, resident_id, full_name, role, photo_url, id_type, id_number, phone, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')`
	_, err = s.db.Exec(ctx, q, st.ID, st.ResidentID, st.FullName, st.Role, st.PhotoURL, st.IDType, st.IDNumber, st.Phone)
	return st, err
}

// ListDomesticStaff returns all staff registered by a resident.
func (s *Service) ListDomesticStaff(ctx context.Context, estateID, userID string) ([]DomesticStaff, error) {
	resID, err := s.getResidentID(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}
	const q = `SELECT id, resident_id, full_name, role, COALESCE(photo_url,''), COALESCE(id_type,''), COALESCE(id_number,''), COALESCE(phone,''), status, created_at FROM domestic_staff WHERE resident_id=$1 ORDER BY full_name`
	rows, err := s.db.Query(ctx, q, resID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DomesticStaff
	for rows.Next() {
		var st DomesticStaff
		if err := rows.Scan(&st.ID, &st.ResidentID, &st.FullName, &st.Role, &st.PhotoURL, &st.IDType, &st.IDNumber, &st.Phone, &st.Status, &st.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, rows.Err()
}

// UpdateStaffStatus changes status of a domestic staff member.
func (s *Service) UpdateStaffStatus(ctx context.Context, estateID, userID, staffID, status string) error {
	resID, err := s.getResidentID(ctx, estateID, userID)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `UPDATE domestic_staff SET status=$1 WHERE id=$2 AND resident_id=$3`, status, staffID, resID)
	return err
}

// AddVehicle registers a vehicle under a resident.
func (s *Service) AddVehicle(ctx context.Context, estateID, userID string, req AddVehicleRequest) (*ResidentVehicle, error) {
	resID, err := s.getResidentID(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}
	v := &ResidentVehicle{
		ID: uuid.New().String(), ResidentID: resID,
		Plate: req.Plate, Make: req.Make, Model: req.Model, Color: req.Color, DocURL: req.DocURL,
		CreatedAt: time.Now(),
	}
	const q = `
		INSERT INTO resident_vehicles (id, resident_id, plate, make, model, color, doc_url)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (resident_id, plate) DO UPDATE SET make=EXCLUDED.make, model=EXCLUDED.model, color=EXCLUDED.color, doc_url=EXCLUDED.doc_url`
	_, err = s.db.Exec(ctx, q, v.ID, v.ResidentID, v.Plate, v.Make, v.Model, v.Color, v.DocURL)
	return v, err
}

// ListVehicles returns all vehicles for a resident.
func (s *Service) ListVehicles(ctx context.Context, estateID, userID string) ([]ResidentVehicle, error) {
	resID, err := s.getResidentID(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}
	const q = `SELECT id, resident_id, plate, COALESCE(make,''), COALESCE(model,''), COALESCE(color,''), COALESCE(doc_url,''), verified, verified_by, verified_at, created_at FROM resident_vehicles WHERE resident_id=$1 ORDER BY created_at`
	rows, err := s.db.Query(ctx, q, resID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ResidentVehicle
	for rows.Next() {
		var v ResidentVehicle
		if err := rows.Scan(&v.ID, &v.ResidentID, &v.Plate, &v.Make, &v.Model, &v.Color, &v.DocURL, &v.Verified, &v.VerifiedBy, &v.VerifiedAt, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// VerifyVehicle marks a vehicle as estate-verified (admin only).
func (s *Service) VerifyVehicle(ctx context.Context, estateID, adminID, vehicleID string) error {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return err
	}
	now := time.Now()
	_, err := s.db.Exec(ctx,
		`UPDATE resident_vehicles SET verified=TRUE, verified_by=$1, verified_at=$2 WHERE id=$3`,
		adminID, now, vehicleID,
	)
	return err
}

// marshalJSON serialises a value to JSON bytes for JSONB columns.
func marshalJSON(v any) ([]byte, error) {
	return json.Marshal(v)
}

// ── Block 24: Onboarding & property selection ─────────────────────────────────

// GenerateInviteCode creates a shareable join code (estate admin only).
func (s *Service) GenerateInviteCode(ctx context.Context, estateID, adminID string, req GenerateInviteCodeRequest) (*InviteCode, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if req.ExpiresAt.Before(time.Now()) {
		return nil, fmt.Errorf("estate: expires_at must be in the future")
	}
	// Generate a compact alphanumeric code (12 chars).
	raw := uuid.New().String()
	code := raw[:8] // first 8 hex chars of a UUID — unique enough for estate scale

	ic := &InviteCode{
		ID:        uuid.New().String(),
		EstateID:  estateID,
		CreatedBy: adminID,
		Code:      code,
		MaxUses:   req.MaxUses,
		ExpiresAt: req.ExpiresAt,
		CreatedAt: time.Now(),
	}
	const q = `
		INSERT INTO estate_invite_codes (id, estate_id, created_by, code, max_uses, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6)`
	_, err := s.db.Exec(ctx, q, ic.ID, ic.EstateID, ic.CreatedBy, ic.Code, ic.MaxUses, ic.ExpiresAt)
	return ic, err
}

// JoinWithInviteCode validates and redeems an invite code, then adds the user as a resident.
func (s *Service) JoinWithInviteCode(ctx context.Context, userID, code string) (*Resident, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("estate: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var ic InviteCode
	const lookup = `
		SELECT id, estate_id, max_uses, used_count, expires_at
		FROM estate_invite_codes WHERE code=$1 FOR UPDATE`
	if err := tx.QueryRow(ctx, lookup, code).Scan(
		&ic.ID, &ic.EstateID, &ic.MaxUses, &ic.UsedCount, &ic.ExpiresAt,
	); err != nil {
		return nil, fmt.Errorf("estate: invalid invite code")
	}
	if time.Now().After(ic.ExpiresAt) {
		return nil, fmt.Errorf("estate: invite code has expired")
	}
	if ic.UsedCount >= ic.MaxUses {
		return nil, fmt.Errorf("estate: invite code has reached maximum uses")
	}

	// Increment use count.
	if _, err := tx.Exec(ctx, `UPDATE estate_invite_codes SET used_count=used_count+1 WHERE id=$1`, ic.ID); err != nil {
		return nil, fmt.Errorf("estate: update invite code: %w", err)
	}

	// Insert resident (idempotent via ON CONFLICT).
	r := &Resident{
		ID:       uuid.New().String(),
		EstateID: ic.EstateID,
		UserID:   userID,
		Role:     "resident",
	}
	const insertR = `
		INSERT INTO estate_residents (id, estate_id, user_id, unit, role)
		VALUES ($1,$2,$3,'','resident')
		ON CONFLICT (estate_id, user_id) DO NOTHING
		RETURNING id, estate_id, user_id, unit, role, created_at`
	_ = tx.QueryRow(ctx, insertR, r.ID, r.EstateID, r.UserID).Scan(
		&r.ID, &r.EstateID, &r.UserID, &r.Unit, &r.Role, &r.CreatedAt,
	)
	return r, tx.Commit(ctx)
}

// RequestAccess creates a pending join request for an estate.
func (s *Service) RequestAccess(ctx context.Context, estateID, userID, message string) (*JoinRequest, error) {
	jr := &JoinRequest{
		ID:        uuid.New().String(),
		EstateID:  estateID,
		UserID:    userID,
		Message:   message,
		Status:    "pending",
		CreatedAt: time.Now(),
	}
	const q = `
		INSERT INTO estate_join_requests (id, estate_id, user_id, message)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (estate_id, user_id) DO UPDATE SET message=EXCLUDED.message, status='pending'
		RETURNING id, estate_id, user_id, message, status, reviewed_by, reviewed_at, created_at`
	err := s.db.QueryRow(ctx, q, jr.ID, jr.EstateID, jr.UserID, jr.Message).Scan(
		&jr.ID, &jr.EstateID, &jr.UserID, &jr.Message, &jr.Status,
		&jr.ReviewedBy, &jr.ReviewedAt, &jr.CreatedAt,
	)
	return jr, err
}

// ReviewJoinRequest approves or rejects a pending join request.
func (s *Service) ReviewJoinRequest(ctx context.Context, estateID, adminID, requestID, decision string) (*JoinRequest, error) {
	if decision != "approved" && decision != "rejected" {
		return nil, fmt.Errorf("estate: decision must be 'approved' or 'rejected'")
	}
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("estate: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	jr := &JoinRequest{}
	now := time.Now()
	const update = `
		UPDATE estate_join_requests
		SET status=$1, reviewed_by=$2, reviewed_at=$3
		WHERE id=$4 AND estate_id=$5 AND status='pending'
		RETURNING id, estate_id, user_id, message, status, reviewed_by, reviewed_at, created_at`
	if err := tx.QueryRow(ctx, update, decision, adminID, now, requestID, estateID).Scan(
		&jr.ID, &jr.EstateID, &jr.UserID, &jr.Message, &jr.Status,
		&jr.ReviewedBy, &jr.ReviewedAt, &jr.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("estate: join request not found or already reviewed")
	}

	if decision == "approved" {
		resID := uuid.New().String()
		const insertR = `
			INSERT INTO estate_residents (id, estate_id, user_id, unit, role)
			VALUES ($1,$2,$3,'','resident')
			ON CONFLICT (estate_id, user_id) DO NOTHING`
		if _, err := tx.Exec(ctx, insertR, resID, estateID, jr.UserID); err != nil {
			return nil, fmt.Errorf("estate: create resident on approval: %w", err)
		}
	}
	return jr, tx.Commit(ctx)
}

// ListJoinRequests returns pending join requests for an estate (admin only).
func (s *Service) ListJoinRequests(ctx context.Context, estateID, adminID, status string) ([]JoinRequest, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	const q = `
		SELECT id, estate_id, user_id, message, status, reviewed_by, reviewed_at, created_at
		FROM estate_join_requests WHERE estate_id=$1 AND ($2='' OR status=$2)
		ORDER BY created_at DESC`
	rows, err := s.db.Query(ctx, q, estateID, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []JoinRequest
	for rows.Next() {
		var jr JoinRequest
		if err := rows.Scan(&jr.ID, &jr.EstateID, &jr.UserID, &jr.Message, &jr.Status, &jr.ReviewedBy, &jr.ReviewedAt, &jr.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, jr)
	}
	return out, rows.Err()
}

// GetMyJoinRequest returns the current user's join request for an estate.
func (s *Service) GetMyJoinRequest(ctx context.Context, estateID, userID string) (*JoinRequest, error) {
	jr := &JoinRequest{}
	const q = `
		SELECT id, estate_id, user_id, message, status, reviewed_by, reviewed_at, created_at
		FROM estate_join_requests WHERE estate_id=$1 AND user_id=$2`
	err := s.db.QueryRow(ctx, q, estateID, userID).Scan(
		&jr.ID, &jr.EstateID, &jr.UserID, &jr.Message, &jr.Status,
		&jr.ReviewedBy, &jr.ReviewedAt, &jr.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("estate: no join request found")
	}
	return jr, nil
}

// ListEstates lists all estates (for search/discovery).
func (s *Service) ListEstates(ctx context.Context, search string) ([]Estate, error) {
	const q = `
		SELECT id, name, address, admin_id, created_at FROM estates
		WHERE ($1='' OR name ILIKE '%' || $1 || '%' OR address ILIKE '%' || $1 || '%')
		ORDER BY name LIMIT 50`
	rows, err := s.db.Query(ctx, q, search)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Estate
	for rows.Next() {
		var e Estate
		if err := rows.Scan(&e.ID, &e.Name, &e.Address, &e.AdminID, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// AddProperty creates a new unit/property within an estate (admin only).
func (s *Service) AddProperty(ctx context.Context, estateID, adminID string, req AddPropertyRequest) (*EstateProperty, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	p := &EstateProperty{
		ID:              uuid.New().String(),
		EstateID:        estateID,
		UnitLabel:       req.UnitLabel,
		PropertyType:    req.PropertyType,
		Floor:           req.Floor,
		Block:           req.Block,
		OccupancyStatus: "vacant",
		CreatedAt:       time.Now(),
	}
	const q = `
		INSERT INTO estate_properties (id, estate_id, unit_label, property_type, floor, block, occupancy_status)
		VALUES ($1,$2,$3,$4,$5,$6,'vacant')`
	_, err := s.db.Exec(ctx, q, p.ID, p.EstateID, p.UnitLabel, p.PropertyType, p.Floor, p.Block)
	return p, err
}

// ListProperties lists all properties in an estate.
func (s *Service) ListProperties(ctx context.Context, estateID, memberID string) ([]EstateProperty, error) {
	if err := s.assertResident(ctx, estateID, memberID); err != nil {
		return nil, err
	}
	const q = `
		SELECT id, estate_id, unit_label, property_type, floor, block, occupancy_status, landlord_id, tenant_id, created_at
		FROM estate_properties WHERE estate_id=$1 ORDER BY block, floor, unit_label`
	rows, err := s.db.Query(ctx, q, estateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EstateProperty
	for rows.Next() {
		var p EstateProperty
		if err := rows.Scan(&p.ID, &p.EstateID, &p.UnitLabel, &p.PropertyType, &p.Floor, &p.Block, &p.OccupancyStatus, &p.LandlordID, &p.TenantID, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ClaimOwnership submits a document-backed ownership claim for a property.
func (s *Service) ClaimOwnership(ctx context.Context, propertyID, userID, docURL string) (*OwnershipClaim, error) {
	c := &OwnershipClaim{
		ID:              uuid.New().String(),
		PropertyID:      propertyID,
		UserID:          userID,
		OwnershipDocURL: docURL,
		Status:          "pending",
		CreatedAt:       time.Now(),
	}
	const q = `
		INSERT INTO property_ownership_claims (id, property_id, user_id, ownership_doc_url)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (property_id, user_id) DO UPDATE SET ownership_doc_url=EXCLUDED.ownership_doc_url, status='pending'
		RETURNING id, property_id, user_id, ownership_doc_url, status, verified_by, verified_at, reject_reason, created_at`
	err := s.db.QueryRow(ctx, q, c.ID, c.PropertyID, c.UserID, c.OwnershipDocURL).Scan(
		&c.ID, &c.PropertyID, &c.UserID, &c.OwnershipDocURL, &c.Status,
		&c.VerifiedBy, &c.VerifiedAt, &c.RejectReason, &c.CreatedAt,
	)
	return c, err
}

// ReviewOwnershipClaim approves or rejects an ownership claim.
func (s *Service) ReviewOwnershipClaim(ctx context.Context, claimID, adminID, estateID, decision, rejectReason string) (*OwnershipClaim, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	now := time.Now()
	c := &OwnershipClaim{}
	const q = `
		UPDATE property_ownership_claims oc
		SET status=$1, verified_by=$2, verified_at=$3, reject_reason=$4
		FROM estate_properties ep
		WHERE oc.id=$5 AND ep.id=oc.property_id AND ep.estate_id=$6
		RETURNING oc.id, oc.property_id, oc.user_id, oc.ownership_doc_url, oc.status, oc.verified_by, oc.verified_at, oc.reject_reason, oc.created_at`
	err := s.db.QueryRow(ctx, q, decision, adminID, now, rejectReason, claimID, estateID).Scan(
		&c.ID, &c.PropertyID, &c.UserID, &c.OwnershipDocURL, &c.Status,
		&c.VerifiedBy, &c.VerifiedAt, &c.RejectReason, &c.CreatedAt,
	)
	return c, err
}

// CreateTenancyRequest submits a tenancy application for a property.
func (s *Service) CreateTenancyRequest(ctx context.Context, propertyID string, req TenancyRequestBody, tenantID string) (*TenancyRequest, error) {
	tr := &TenancyRequest{
		ID:           uuid.New().String(),
		PropertyID:   propertyID,
		TenantID:     tenantID,
		LandlordID:   req.LandlordID,
		LeaseStart:   req.LeaseStart,
		LeaseEnd:     req.LeaseEnd,
		AgreementURL: req.AgreementURL,
		Status:       "pending",
		CreatedAt:    time.Now(),
	}
	const q = `
		INSERT INTO tenancy_requests (id, property_id, tenant_id, landlord_id, lease_start, lease_end, agreement_url)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (property_id, tenant_id) DO UPDATE SET landlord_id=EXCLUDED.landlord_id, lease_start=EXCLUDED.lease_start, lease_end=EXCLUDED.lease_end, agreement_url=EXCLUDED.agreement_url, status='pending'
		RETURNING id, property_id, tenant_id, landlord_id, lease_start::TEXT, COALESCE(lease_end::TEXT,''), COALESCE(agreement_url,''), status, reviewed_at, created_at`
	err := s.db.QueryRow(ctx, q, tr.ID, tr.PropertyID, tr.TenantID, tr.LandlordID, tr.LeaseStart, tr.LeaseEnd, tr.AgreementURL).Scan(
		&tr.ID, &tr.PropertyID, &tr.TenantID, &tr.LandlordID, &tr.LeaseStart, &tr.LeaseEnd, &tr.AgreementURL,
		&tr.Status, &tr.ReviewedAt, &tr.CreatedAt,
	)
	return tr, err
}

// ReviewTenancyRequest allows a landlord to approve or reject a tenancy request.
func (s *Service) ReviewTenancyRequest(ctx context.Context, requestID, landlordID, estateID, decision string) (*TenancyRequest, error) {
	now := time.Now()
	tr := &TenancyRequest{}
	const q = `
		UPDATE tenancy_requests tr SET status=$1, reviewed_at=$2
		FROM estate_properties ep
		WHERE tr.id=$3 AND tr.landlord_id=$4 AND ep.id=tr.property_id AND ep.estate_id=$5 AND tr.status='pending'
		RETURNING tr.id, tr.property_id, tr.tenant_id, tr.landlord_id, tr.lease_start::TEXT, COALESCE(tr.lease_end::TEXT,''), COALESCE(tr.agreement_url,''), tr.status, tr.reviewed_at, tr.created_at`
	if err := s.db.QueryRow(ctx, q, decision, now, requestID, landlordID, estateID).Scan(
		&tr.ID, &tr.PropertyID, &tr.TenantID, &tr.LandlordID, &tr.LeaseStart, &tr.LeaseEnd,
		&tr.AgreementURL, &tr.Status, &tr.ReviewedAt, &tr.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("estate: tenancy request not found, not your request, or already reviewed")
	}

	// On approval, set tenant on property and mark occupied.
	if decision == "approved" {
		_, _ = s.db.Exec(ctx,
			`UPDATE estate_properties SET tenant_id=$1, occupancy_status='occupied' WHERE id=$2`,
			tr.TenantID, tr.PropertyID,
		)
	}
	return tr, nil
}

func (s *Service) assertEstateAdmin(ctx context.Context, estateID, userID string) error {
	return s.assertRoles(ctx, estateID, userID, "estate_admin")
}

func (s *Service) assertResident(ctx context.Context, estateID, userID string) error {
	return s.assertRoles(ctx, estateID, userID, "resident", "estate_admin")
}

func (s *Service) assertRoles(ctx context.Context, estateID, userID string, roles ...string) error {
	const q = `SELECT role FROM estate_residents WHERE estate_id=$1 AND user_id=$2`
	var role string
	if err := s.db.QueryRow(ctx, q, estateID, userID).Scan(&role); err != nil {
		return fmt.Errorf("estate: not a member of this estate")
	}
	for _, r := range roles {
		if role == r {
			return nil
		}
	}
	return fmt.Errorf("estate: insufficient role")
}
