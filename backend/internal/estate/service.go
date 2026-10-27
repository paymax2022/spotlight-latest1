package estate

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	platformRedis "spotlight/backend/internal/platform/redis"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/go-common/dbutil"
)

// AddressGeocoder resolves a typed address to a pin + Plus Code. Satisfied by
// maps.LocationGeocoder (the provider-agnostic MapService). Optional.
type AddressGeocoder interface {
	Geocode(ctx context.Context, address string) (lat, lng float64, plusCode string, err error)
}

// Service manages estates, visitor passes, and private elections.
type Service struct {
	// guardGrantsOn (FEATURE_ESTATE_GUARD_GRANTS) switches guard/gate authz from
	// "any resident" to "estate_admin or a live staff grant", and narrows
	// ListEstates to the caller's own estates. Off (default): both behave exactly
	// as before PR #876, so existing guards keep working until grants exist.
	guardGrantsOn bool

	db       *pgxpool.Pool
	redis    *goredis.Client
	geocoder AddressGeocoder
	ledger   LedgerPoster // optional; required only for the dues money path
	tiers    TierEnforcer // optional; fail-closed tier-limit check on money out
	kyc      KYCVerifier  // optional; required only when an election requires KYC
	notifier Notifier     // optional; push delivery (in-app feed works without it)
	llm      LLMGenerator // optional; required only for AI note-taking (Block 33)
	// dualControl gates the ESTD-D027 maker-checker flow (dual_control.go).
	dualControl bool

	// verificationRequired creates new estates in 'pending' (platform review
	// queue, EST-UAT-0418) instead of 'active'. FEATURE_ESTATE_VERIFICATION_REQUIRED.
	verificationRequired bool

	// merchantGate authorises estate creation. When nil (the default, and
	// whenever FEATURE_ESTATE_MERCHANT_GATE is off) CreateEstate keeps its
	// historical behaviour and any authenticated user may create an estate. When
	// set, it is consulted and a creator without an approved estate-management
	// merchant identity is refused.
	merchantGate EstateMerchantGate
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

// WithVerificationRequired makes CreateEstate open new estates as 'pending'
// applications that a platform operator must verify before any estate write
// is accepted (see lifecycle.go). Off = estates are created 'active'.
func (s *Service) WithVerificationRequired(on bool) *Service {
	s.verificationRequired = on
	return s
}

// ErrEstateNameRequired — an estate must be given a name a resident can read. Gin's
// binding:"required,min=2" counts three spaces as a name, so the refusal EST-UAT-0022 asks for has
// to happen here, where the value is about to be stored.
var ErrEstateNameRequired = errors.New("estate: a name is required")

// CreateEstate creates a new estate and assigns the creator as estate_admin.
func (s *Service) CreateEstate(ctx context.Context, adminID string, req CreateEstateRequest) (*Estate, error) {
	name := strings.TrimSpace(req.Name)
	if len([]rune(name)) < 2 {
		return nil, ErrEstateNameRequired
	}
	// SP-01: an approved estate-management merchant may create estates. When a
	// gate is wired (FEATURE_ESTATE_MERCHANT_GATE on), it fails closed: an error
	// or a false decision blocks creation so privileges are never self-granted.
	if s.merchantGate != nil {
		ok, err := s.merchantGate.CanCreateEstate(ctx, adminID)
		if err != nil {
			return nil, fmt.Errorf("estate: merchant gate check: %w", err)
		}
		if !ok {
			return nil, ErrEstateManagerApprovalRequired
		}
	}
	status := EstateStatusActive
	if s.verificationRequired {
		status = EstateStatusPending
	}
	tz := strings.TrimSpace(req.Timezone)
	if tz == "" {
		tz = DefaultEstateTimezone
	}
	if err := validateEstateTimezone(tz); err != nil {
		return nil, err
	}
	// EST-UAT-0023: a normalised (name, address) twin that is still live sends this application to
	// the platform review queue instead of standing up a second live estate over the first one.
	dupeID, dupeFound, derr := s.estateDuplicateLookup(ctx, name, req.Address)
	if derr != nil {
		return nil, derr
	}
	duplicateSuspected := dupeFound
	if duplicateSuspected {
		status = EstateStatusPending
	}
	e := &Estate{
		ID:                 uuid.New().String(),
		Name:               name,
		Address:            req.Address,
		AdminID:            adminID,
		Status:             status,
		CreatedAt:          time.Now(),
		Timezone:           tz,
		DuplicateSuspected: duplicateSuspected,
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("estate: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const insertEstate = `INSERT INTO estates (id, name, address, admin_id, status, timezone, duplicate_suspected)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`
	if _, err := tx.Exec(ctx, insertEstate, e.ID, e.Name, e.Address, e.AdminID, e.Status, e.Timezone, e.DuplicateSuspected); err != nil {
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
	if duplicateSuspected {
		_ = s.audit(ctx, e.ID, adminID, "ESTATE_CREATE_DUPLICATE_SUSPECTED", "estate", e.ID,
			map[string]any{"matched_estate_id": dupeID})
		s.notify(ctx, e.ID, adminID, NotifEstateStatusChanged, "Estate needs review",
			"An estate with the same name and address already exists, so this one was sent for platform review before it goes live.",
			map[string]any{"estate_id": e.ID, "status": status, "duplicate_of": dupeID})
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
		return nil, errors.New("estate: valid_until must be after valid_from")
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
// On a successful scan the issuing resident is alerted (Block 43
// visitor_arrived) so a gate check-in requiring live resident awareness reaches
// them (EST-UAT-0348). Fire-and-forget: a notification failure never fails the
// gate scan itself.
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
		return nil, errors.New("estate: pass not found, already used, or expired")
	}
	s.notify(ctx, estateID, p.IssuedBy, NotifVisitorArrived,
		"Visitor arrived: "+p.VisitorName,
		fmt.Sprintf("%s has been checked in at the gate (%s).", p.VisitorName, p.Purpose),
		map[string]any{"pass_id": p.ID, "visitor_name": p.VisitorName})
	return p, nil
}

// CreateElection creates a new election within an estate (admin only), in draft.
func (s *Service) CreateElection(ctx context.Context, estateID, creatorID string, req CreateElectionRequest) (*Election, error) {
	if err := s.assertEstateAdmin(ctx, estateID, creatorID); err != nil {
		return nil, err
	}
	if req.EndsAt.Before(req.StartsAt) {
		return nil, errors.New("estate: ends_at must be after starts_at")
	}
	kind := req.Kind
	if kind == "" {
		kind = ElectionKindBinding
	}
	if !validKind(kind) {
		return nil, fmt.Errorf("estate: invalid kind %q", kind)
	}
	weighting := req.Weighting
	if weighting == "" {
		weighting = WeightingOnePersonOneVote
	}
	if !validWeighting(weighting) {
		return nil, fmt.Errorf("estate: invalid weighting %q", weighting)
	}
	quorumType := req.QuorumType
	if quorumType == "" {
		quorumType = QuorumTypeNone
	}
	if !validQuorumType(quorumType) {
		return nil, fmt.Errorf("estate: invalid quorum_type %q", quorumType)
	}
	if quorumType == QuorumTypePercent && (req.QuorumValue < 1 || req.QuorumValue > 100) {
		return nil, errors.New("estate: a percent quorum must be between 1 and 100")
	}
	if quorumType == QuorumTypeCount && req.QuorumValue < 1 {
		return nil, errors.New("estate: a count quorum must be at least 1 ballot")
	}
	tieBreak := req.TieBreak
	if tieBreak == "" {
		tieBreak = TieBreakNone
	}
	if !validTieBreak(tieBreak) {
		return nil, fmt.Errorf("estate: invalid tie_break %q", tieBreak)
	}
	nominatedLater := req.NominationOpensAt != nil || req.NominationClosesAt != nil
	if len(req.Candidates) < 2 && !nominatedLater {
		return nil, errors.New("estate: an election needs at least 2 candidates, or a nomination window to gather them")
	}
	if nominatedLater && req.NominationOpensAt != nil && req.NominationClosesAt != nil && !req.NominationClosesAt.After(*req.NominationOpensAt) {
		return nil, errors.New("estate: nomination_closes_at must be after nomination_opens_at")
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
		Kind:        kind,
		Weighting:   weighting,
		QuorumType:  quorumType,
		QuorumValue: req.QuorumValue,
		TieBreak:    tieBreak,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("estate: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const insertEl = `
		INSERT INTO elections (id, estate_id, title, description, starts_at, ends_at, status, created_by,
		                       kind, weighting, quorum_type, quorum_value, tie_break,
		                       nomination_opens_at, nomination_closes_at)
		VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,$11,$12,$13,$14)`
	if _, err := tx.Exec(ctx, insertEl, el.ID, el.EstateID, el.Title, el.Description, el.StartsAt, el.EndsAt,
		el.CreatedBy, el.Kind, el.Weighting, el.QuorumType, el.QuorumValue, el.TieBreak,
		req.NominationOpensAt, req.NominationClosesAt); err != nil {
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
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("estate: commit: %w", err)
	}
	return el, nil
}

// CastVote casts a vote in an open election using a Redlock-protected atomic check.
// One ballot per voter — or per held unit in a one_vote_per_unit election — is enforced by
// the partial unique keys on election_votes, inside estate_cast_vote.
func (s *Service) CastVote(ctx context.Context, estateID, electionID, voterID string, req CastVoteRequest) (*Vote, error) {
	if err := s.assertResident(ctx, estateID, voterID); err != nil {
		return nil, err
	}
	// Dues-gating: a resident under a soft or hard dues restriction may not vote
	// (Block 30 matrix + Block 31 payment-gated voting). Fail-closed.
	if err := s.enforceNotRestricted(ctx, estateID, voterID, ActionVote); err != nil {
		return nil, err
	}
	// Per-election eligibility gate (Block 31): KYC / payment / resident-type rules, plus
	// the frozen roll once one exists — a mid-poll revocation must answer "no" here rather
	// than letting the voter discover it as a database error (EST-UAT-0219).
	elig, err := s.EligibilityOnRoll(ctx, estateID, electionID, voterID)
	if err != nil {
		return nil, err
	}
	if !elig.Eligible {
		return nil, fmt.Errorf("estate: not eligible to vote in this election: %s", strings.Join(elig.Reasons, ", "))
	}
	var status string
	var startsAt, endsAt time.Time
	if err := s.db.QueryRow(ctx, `SELECT status, starts_at, ends_at FROM elections WHERE id=$1 AND estate_id=$2`, electionID, estateID).
		Scan(&status, &startsAt, &endsAt); err != nil {
		return nil, errors.New("estate: election not found")
	}
	now := time.Now()
	if status == "cancelled" {
		return nil, errors.New("estate: this election has been cancelled")
	}
	if status != "open" || now.Before(startsAt) || now.After(endsAt) {
		return nil, errors.New("estate: election is not currently open for voting")
	}

	// Acquire Redlock to prevent duplicate concurrent submissions.
	lockKey := fmt.Sprintf("election:%s:voter:%s", electionID, voterID)
	if s.redis != nil {
		ok, token, err := platformRedis.AcquireLock(ctx, s.redis, lockKey, 10*time.Second)
		if err != nil || !ok {
			return nil, errors.New("estate: vote lock contention — try again")
		}
		defer func() { _ = platformRedis.ReleaseLock(ctx, s.redis, lockKey, token) }()
	}

	v := &Vote{
		ID:          uuid.New().String(),
		ElectionID:  electionID,
		VoterID:     voterID,
		CandidateID: strings.TrimSpace(req.CandidateID),
		UnitID:      strings.TrimSpace(req.UnitID),
		CastAt:      time.Now(),
	}
	v.Abstained = v.CandidateID == ""
	// ESTB-D003: the choice and the identity no longer share a row. estate_cast_vote
	// writes the participation registry and the anonymous ballot in one statement, so
	// a ballot can never exist without its participation row (or the reverse). The
	// partial unique keys still make a double vote impossible (per voter, or per unit in a
	// weighted election); the function raises 23505 on replay, 23503 for a foreign
	// candidate or missing election, 42501 for a cancelled election or a voter off the
	// frozen roll, 55000 outside the window, and 23514 for a weighting violation.
	const q = `SELECT ballot_id, participation_id FROM estate_cast_vote($1,$2,$3,$4)`
	var candidateArg, unitArg any
	if v.CandidateID != "" {
		candidateArg = v.CandidateID
	}
	if v.UnitID != "" {
		unitArg = v.UnitID
	}
	var ballotID, participationID string
	err = s.db.QueryRow(ctx, q, electionID, voterID, candidateArg, unitArg).Scan(&ballotID, &participationID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			switch pgErr.Code {
			case "23505":
				return nil, errors.New("estate: you have already voted in this election")
			case "23503":
				return nil, errors.New("estate: invalid candidate for this election")
			case "42501":
				return nil, errors.New("estate: this election is cancelled, or you are not on the published roll")
			case "55000":
				return nil, errors.New("estate: election is not currently open for voting")
			case "23514":
				return nil, errors.New("estate: that ballot does not match how this election counts votes")
			}
		}
		return nil, err
	}
	v.ID = ballotID
	return v, nil
}

// GetResults returns the tally for a closed/tallied election.
// ESTATE-AUTHZ: caller must be a resident/member — results are estate-private
// (previously unauthenticated: any authed user could read any estate's tally).
// The count itself comes from Service.tally, the same query the outcome, the certified
// result and a recount run, so no two read paths can disagree about who won.
func (s *Service) GetResults(ctx context.Context, estateID, electionID, userID string) ([]Candidate, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM elections WHERE id=$1 AND estate_id=$2`, electionID, estateID).Scan(&status); err != nil {
		return nil, errors.New("estate: election not found")
	}
	if status != "closed" && status != "tallied" {
		return nil, errors.New("estate: results only available after election closes")
	}
	return s.tally(ctx, electionID)
}

// SendElectionReminders notifies residents who have NOT yet voted in an open
// election (EST-UAT-0352). Ballot privacy is preserved by construction: the
// query selects only voter ids (never candidate_id / vote content), and the
// notification body contains no ballot data. Estate admin only. Returns the
// number of reminders delivered to the feed.
func (s *Service) SendElectionReminders(ctx context.Context, estateID, adminID, electionID string) (int, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return 0, err
	}
	var title, status string
	var endsAt time.Time
	if err := s.db.QueryRow(ctx,
		`SELECT title, status, ends_at FROM elections WHERE id=$1 AND estate_id=$2`,
		electionID, estateID).Scan(&title, &status, &endsAt); err != nil {
		return 0, errors.New("estate: election not found")
	}
	if status != "open" {
		return 0, fmt.Errorf("estate: cannot send reminders for a %s election", status)
	}
	rows, err := s.db.Query(ctx, `
		SELECT r.user_id FROM estate_residents r
		WHERE r.estate_id=$1 AND r.deleted_at IS NULL
		  AND NOT EXISTS (SELECT 1 FROM election_votes v WHERE v.election_id=$2 AND v.voter_id=r.user_id)`,
		estateID, electionID)
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		s.notify(ctx, estateID, id, NotifElectionReminder, "Election open: "+title,
			"Voting is open and you have not cast a ballot yet.",
			map[string]any{"election_id": electionID, "ends_at": endsAt})
	}
	_ = s.audit(ctx, estateID, adminID, "ELECTION_REMIND", "election", electionID, map[string]any{keyReminded: len(ids)})
	return len(ids), nil
}

// ListGates — Block 28: Security gate / guard app
// ListGates returns all active gates for an estate.
// ESTATE-AUTHZ: member-only — the gate layout is estate security posture.
func (s *Service) ListGates(ctx context.Context, estateID, userID string) ([]Gate, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
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
// ESTATE-AUTHZ: member-only — this resolves visitor PII (name/phone/plate) plus
// the issuing resident's unit; the numeric code space is small enough to brute
// force, so it must not be callable cross-estate (previously unauthenticated).
func (s *Service) LookupCode(ctx context.Context, estateID, userID, numericCode, qrCode string) (*CheckinPayload, error) {
	if err := s.assertGate(ctx, estateID, userID, guardRoles...); err != nil {
		return nil, err
	}
	return s.lookupCode(ctx, estateID, numericCode, qrCode)
}

// lookupCode is the ungated inner query — callers must authorize first.
func (s *Service) lookupCode(ctx context.Context, estateID, numericCode, qrCode string) (*CheckinPayload, error) {
	var c AccessCode
	var residentUnit string

	q := `SELECT id, estate_id, issued_by, visitor_name, COALESCE(visitor_phone,''), COALESCE(vehicle_plate,''),
		COALESCE(purpose,''), code_type, numeric_code, qr_code::TEXT, valid_from, valid_until,
		used_count, max_uses, status, blacklisted, require_host_approval, COALESCE(gate_id::TEXT,''), created_at
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
		&c.ValidFrom, &c.ValidUntil, &c.UsedCount, &c.MaxUses, &c.Status, &c.Blacklisted,
		&c.RequireHostApproval, &c.GateID, &c.CreatedAt,
	); err != nil {
		return nil, errors.New("access code not found")
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
// ESTATE-AUTHZ: member-only — was callable by any authed user, letting them
// consume someone else's visitor codes and forge gate events.
func (s *Service) CheckInVisitor(ctx context.Context, estateID, guardID string, req GuardCheckinRequest) (*CheckinPayload, error) {
	if err := s.assertGate(ctx, estateID, guardID, guardRoles...); err != nil {
		return nil, err
	}
	payload, err := s.lookupCode(ctx, estateID, req.NumericCode, req.QRCode)
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
	defer func() { _ = tx.Rollback(ctx) }()

	// SP-02: a code flagged require_host_approval is admitted only against a host
	// approval decided within arrivalApprovalTTL, and each approval admits ONCE:
	// it is consumed here, in the same transaction as the code use, so a
	// multi-use code needs a fresh approval per visit and two concurrent admits
	// cannot share one approval (FOR UPDATE SKIP LOCKED + consumed_at).
	if payload.Code.RequireHostApproval {
		var approvalID string
		err := tx.QueryRow(ctx,
			`UPDATE visitor_arrival_requests SET consumed_at = NOW()
			 WHERE id = (SELECT id FROM visitor_arrival_requests
			             WHERE access_code_id = $1 AND status = 'approved' AND consumed_at IS NULL
			               AND decided_at >= NOW() - make_interval(secs => $2)
			             ORDER BY decided_at DESC LIMIT 1
			             FOR UPDATE SKIP LOCKED)
			 RETURNING id`, payload.Code.ID, arrivalApprovalTTL.Seconds()).Scan(&approvalID)
		if errors.Is(err, pgx.ErrNoRows) {
			return payload, errors.New("entry denied: awaiting host approval")
		}
		if err != nil {
			return nil, err
		}
	}

	// Atomic consumption claim (EST-UAT-0094): the UPDATE re-asserts every
	// admission predicate in the same statement that increments used_count, so
	// two guards scanning one code concurrently cannot both win — the loser's
	// UPDATE matches zero rows. The earlier read-then-write admitted both.
	tag, err := tx.Exec(ctx,
		`UPDATE visitor_access_codes SET used_count=used_count+1,
		status=CASE WHEN used_count+1 >= max_uses THEN 'used' ELSE status END
		WHERE id=$1 AND status='active' AND blacklisted=FALSE
		  AND valid_from <= NOW() AND valid_until >= NOW()
		  AND used_count < max_uses`, payload.Code.ID,
	)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		// State moved under us — re-read for an accurate deny reason.
		payload, lerr := s.lookupCode(ctx, estateID, req.NumericCode, req.QRCode)
		if lerr != nil || payload == nil {
			return nil, errors.New("entry denied: code no longer valid")
		}
		return payload, fmt.Errorf("entry denied: %s", denyReason(payload.Code))
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

	// Block 47: immutable audit of the gate scan/admission.
	if err := s.auditTx(ctx, tx, estateID, guardID, "GATE_CHECKIN", "access_code", payload.Code.ID, map[string]any{
		"checkin_id": checkinID, "gate_id": req.GateID,
	}); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	// Alert the issuing resident that their visitor is at the gate
	// (EST-UAT-0348). Fire-and-forget — never fails the check-in.
	s.notify(ctx, estateID, payload.Code.IssuedBy, NotifVisitorArrived,
		"Visitor arrived: "+payload.Code.VisitorName,
		payload.Code.VisitorName+" has arrived at the gate.",
		map[string]any{"code_id": payload.Code.ID, "checkin_id": checkinID, "gate_id": req.GateID})

	payload.CheckinID = checkinID
	return payload, nil
}

// CheckOutVisitor records a gate departure.
// ESTATE-AUTHZ: member-only (was callable by any authed user).
func (s *Service) CheckOutVisitor(ctx context.Context, estateID, guardID, codeID, gateID string) error {
	if err := s.assertGate(ctx, estateID, guardID, guardRoles...); err != nil {
		return err
	}
	var cnt int
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM visitor_access_codes WHERE id=$1 AND estate_id=$2`, codeID, estateID,
	).Scan(&cnt); err != nil || cnt == 0 {
		return errors.New("code not found in this estate")
	}
	_, err := s.db.Exec(ctx,
		`INSERT INTO visitor_checkins (id, code_id, guard_id, gate_id, event, captured_at)
		VALUES ($1,$2,$3,$4,'checked_out',NOW())`,
		uuid.New().String(), codeID, guardID, gateID,
	)
	return err
}

// SubmitIncidentReport saves a guard incident report.
// ESTATE-AUTHZ: member-only (was callable by any authed user — forged incident
// reports into any estate's security log).
func (s *Service) SubmitIncidentReport(ctx context.Context, estateID, guardID string, req SubmitIncidentRequest) (*IncidentReport, error) {
	if err := s.assertGate(ctx, estateID, guardID, guardRoles...); err != nil {
		return nil, err
	}
	rep := &IncidentReport{
		ID: uuid.New().String(), EstateID: estateID, GuardID: guardID,
		GateID: req.GateID, IncidentType: req.IncidentType,
		Description: req.Description, EvidenceURL: req.EvidenceURL,
		Escalated: req.Escalated, CreatedAt: time.Now(),
	}
	const q = `INSERT INTO gate_incident_reports (id, estate_id, guard_id, gate_id, incident_type, description, evidence_url, escalated) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	_, err := s.db.Exec(ctx, q, rep.ID, rep.EstateID, rep.GuardID, dbutil.StrPtr(rep.GateID), rep.IncidentType, rep.Description, dbutil.StrPtr(rep.EvidenceURL), rep.Escalated)
	return rep, err
}

// HandoverShift closes the current shift and optionally starts the next.
// ESTATE-AUTHZ: member-only (was callable by any authed user — forged shifts).
func (s *Service) HandoverShift(ctx context.Context, estateID, guardID string, req HandoverRequest) (*GuardShift, error) {
	if err := s.assertGate(ctx, estateID, guardID, guardRoles...); err != nil {
		return nil, err
	}
	_, _ = s.db.Exec(ctx,
		`UPDATE guard_shifts SET ended_at=NOW(), handover_notes=$1, relieved_by=$2
		WHERE estate_id=$3 AND guard_id=$4 AND ended_at IS NULL`,
		req.HandoverNotes, dbutil.StrPtr(req.RelievedBy), estateID, guardID,
	)
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
// ESTATE-AUTHZ: member-only — this is a bulk PII + credential feed (visitor
// names/phones/plates and the numeric entry codes); previously any authed user
// could pull it for any estate id.
func (s *Service) GetExpectedVisitors(ctx context.Context, estateID, userID string) ([]AccessCode, error) {
	if err := s.assertGate(ctx, estateID, userID, guardRoles...); err != nil {
		return nil, err
	}
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
// ESTATE-AUTHZ: member-only (was callable by any authed user — forged logs).
func (s *Service) SyncOfflineLogs(ctx context.Context, estateID, guardID string, logs []OfflineLogEntry) (int, error) {
	if err := s.assertGate(ctx, estateID, guardID, guardRoles...); err != nil {
		return 0, err
	}
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

// generateNumericCode produces a random 6-digit string, retrying on collision.
func generateNumericCode() string {
	// Cryptographically random 6 digits (was uuid.ID()-derived, which is not a CSPRNG
	// and predictable). Brute-forcing the code space is further contained by the
	// member-only lookup + per-estate rate limit mounted on the guard routes.
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%06d", uuid.New().ID()%1_000_000) // never fail issuance; still random-ish
	}
	n := binary.BigEndian.Uint32(b[:]) % 1_000_000
	return fmt.Sprintf("%06d", n)
}

// CreateAccessCode issues a typed visitor access code with a unique 6-digit numeric code.
func (s *Service) CreateAccessCode(ctx context.Context, estateID, userID string, req CreateAccessCodeRequest) (*AccessCode, error) {
	if _, err := s.getResidentID(ctx, estateID, userID); err != nil {
		return nil, err
	}
	// Dues-restriction enforcement: only a HARD restriction blocks issuing visitor
	// codes; a soft-restricted resident may still let guests in (Block 30 matrix).
	if err := s.enforceNotRestricted(ctx, estateID, userID, ActionVisitor); err != nil {
		return nil, err
	}
	if req.MaxUses < 1 {
		req.MaxUses = 1
	}
	if req.ValidUntil.Before(req.ValidFrom) {
		return nil, errors.New("valid_until must be after valid_from")
	}

	// Retry up to 5 times to get a unique numeric code.
	var code *AccessCode
	for range 5 {
		numeric := generateNumericCode()
		qrID := uuid.New().String()
		c := &AccessCode{
			ID: uuid.New().String(), EstateID: estateID, IssuedBy: userID,
			VisitorName: req.VisitorName, VisitorPhone: req.VisitorPhone,
			VehiclePlate: req.VehiclePlate, Purpose: req.Purpose,
			CodeType: req.CodeType, NumericCode: numeric, QRCode: qrID,
			ValidFrom: req.ValidFrom, ValidUntil: req.ValidUntil,
			MaxUses: req.MaxUses, Status: "active", CreatedAt: time.Now(),
			Recurrence:          req.Recurrence,
			RequireHostApproval: req.RequireHostApproval,
			GateID:              req.GateID,
		}
		const q = `
			INSERT INTO visitor_access_codes
				(id, estate_id, issued_by, visitor_name, visitor_phone, vehicle_plate, purpose,
				 code_type, numeric_code, qr_code, valid_from, valid_until, recurrence, max_uses,
				 require_host_approval, gate_id)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NULLIF($16,'')::uuid)`
		_, err := s.db.Exec(ctx, q,
			c.ID, estateID, userID, req.VisitorName, req.VisitorPhone, req.VehiclePlate, req.Purpose,
			req.CodeType, numeric, qrID, req.ValidFrom, req.ValidUntil, req.Recurrence, req.MaxUses,
			req.RequireHostApproval, req.GateID,
		)
		if err != nil {
			continue
		}
		code = c
		break
	}
	if code == nil {
		return nil, errors.New("failed to generate unique access code, try again")
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
		return errors.New("new valid_until must be in the future")
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
	var ownerID string
	if err := s.db.QueryRow(ctx,
		`SELECT issued_by FROM visitor_access_codes WHERE id=$1 AND estate_id=$2`, codeID, estateID,
	).Scan(&ownerID); err != nil || ownerID != userID {
		return nil, errors.New("access denied or code not found")
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

// alertSeverity maps an emergency-alert kind to a dashboard severity bucket.
// Pure (no DB) so the mapping is unit-testable.
func alertSeverity(kind string) string {
	switch kind {
	case "fire", "medical", "panic":
		return "critical"
	case "security", "theft", "domestic":
		return "high"
	default:
		return "medium"
	}
}

// GetDashboard returns the aggregated estate dashboard for a resident in a
// SINGLE database round-trip (Block 26 acceptance: no N+1). All scalar counts
// and the property/payment summary are scalar subqueries; the meeting,
// announcement and security-alert lists are aggregated as JSON in the same query.
func (s *Service) GetDashboard(ctx context.Context, estateID, userID string) (*EstateDashboard, error) {
	// $2 = estate_residents.id (membership check + resident-keyed counts),
	// $3 = auth user id (user-keyed counts). getResidentID fails if not a member.
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

	const q = `
SELECT
  COALESCE((SELECT name FROM estates WHERE id=$1),'')                                                                       AS estate_name,
  COALESCE((SELECT unit FROM estate_residents WHERE id=$2),'')                                                              AS resident_unit,
  (SELECT COUNT(*) FROM visitor_passes WHERE estate_id=$1 AND issued_by=$3 AND status='active' AND valid_until > NOW())     AS active_visitor_codes,
  (SELECT COUNT(*) FROM elections WHERE estate_id=$1 AND status='open')                                                     AS open_elections,
  (SELECT COUNT(*) FROM estate_repair_requests WHERE estate_id=$1 AND reporter_id=$3 AND status NOT IN ('completed','cancelled')) AS open_repairs,
  (SELECT COUNT(*) FROM resident_vehicles WHERE resident_id=$2)                                                             AS vehicle_count,
  (SELECT COUNT(*) FROM household_members WHERE resident_id=$2)                                                             AS household_count,
  COALESCE((SELECT occupancy_status FROM estate_properties WHERE estate_id=$1 AND (landlord_id=$3 OR tenant_id=$3) LIMIT 1),'') AS property_status,
  (SELECT amount_kobo FROM estate_dues_invoices WHERE estate_id=$1 AND resident_id=$3 AND status IN ('pending','overdue') ORDER BY due_date LIMIT 1) AS pending_amount,
  (SELECT to_char(due_date AT TIME ZONE 'UTC','YYYY-MM-DD') FROM estate_dues_invoices WHERE estate_id=$1 AND resident_id=$3 AND status IN ('pending','overdue') ORDER BY due_date LIMIT 1) AS pending_due,
  (SELECT category FROM estate_dues_invoices WHERE estate_id=$1 AND resident_id=$3 AND status IN ('pending','overdue') ORDER BY due_date LIMIT 1) AS pending_label,
  COALESCE((SELECT json_agg(m) FROM (
      SELECT id::text AS id, title,
             to_char(starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS starts_at,
             COALESCE(location,'') AS location
      FROM estate_meetings WHERE estate_id=$1 AND status='scheduled' AND starts_at > NOW()
      ORDER BY starts_at LIMIT 2) m), '[]'::json)                                                                          AS meetings,
  COALESCE((SELECT json_agg(a) FROM (
      SELECT id::text AS id, title, body,
             to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
      FROM estate_announcements WHERE estate_id=$1
      ORDER BY created_at DESC LIMIT 3) a), '[]'::json)                                                                     AS announcements,
  COALESCE((SELECT json_agg(s) FROM (
      SELECT id::text AS id, COALESCE(description, kind) AS description, kind,
             to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
      FROM estate_emergency_alerts WHERE estate_id=$1 AND created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC LIMIT 5) s), '[]'::json)                                                                     AS security_alerts`

	var (
		pendingAmount              *int64
		pendingDue, pendingLabel   *string
		meetingsJSON, announceJSON []byte
		alertsJSON                 []byte
	)
	if err := s.db.QueryRow(ctx, q, estateID, resID, userID).Scan(
		&dash.EstateName, &dash.ResidentUnit, &dash.ActiveVisitorCodes, &dash.OpenElections,
		&dash.OpenRepairs, &dash.VehicleCount, &dash.HouseholdCount, &dash.PropertyStatus,
		&pendingAmount, &pendingDue, &pendingLabel,
		&meetingsJSON, &announceJSON, &alertsJSON,
	); err != nil {
		return nil, fmt.Errorf("estate: dashboard query: %w", err)
	}

	if pendingAmount != nil {
		p := &DashboardPayment{AmountKobo: *pendingAmount}
		if pendingDue != nil {
			p.DueDate = *pendingDue
		}
		if pendingLabel != nil {
			p.Label = *pendingLabel
		}
		dash.PendingPayment = p
	}
	if len(meetingsJSON) > 0 {
		_ = json.Unmarshal(meetingsJSON, &dash.UpcomingMeetings)
	}
	if len(announceJSON) > 0 {
		_ = json.Unmarshal(announceJSON, &dash.Announcements)
	}
	// Security alerts carry a kind we map to a severity bucket in Go.
	if len(alertsJSON) > 0 {
		var raw []struct {
			ID          string `json:"id"`
			Description string `json:"description"`
			Kind        string `json:"kind"`
			CreatedAt   string `json:"created_at"`
		}
		if json.Unmarshal(alertsJSON, &raw) == nil {
			for _, a := range raw {
				dash.SecurityAlerts = append(dash.SecurityAlerts, DashboardSecurityAlert{
					ID: a.ID, Description: a.Description, Severity: alertSeverity(a.Kind), CreatedAt: a.CreatedAt,
				})
			}
		}
	}

	return dash, nil
}

// getResidentID resolves the estate_residents.id for a given (estateID, userID) pair.
// Fails closed on banned/deleted membership, mirroring assertRoles — this was
// previously missing here, which let a banned or deleted member keep reading/
// writing their own dashboard, profile, household, vehicles, and settings data
// via any of the ~17 call sites that resolve membership through this helper
// instead of assertResident/assertEstateAdmin. ESTATE-AUTHZ-003 (UAT).
func (s *Service) getResidentID(ctx context.Context, estateID, userID string) (string, error) {
	var id string
	var banned, deleted bool
	if err := s.db.QueryRow(ctx,
		`SELECT id, banned_at IS NOT NULL, deleted_at IS NOT NULL FROM estate_residents WHERE estate_id=$1 AND user_id=$2`, estateID, userID,
	).Scan(&id, &banned, &deleted); err != nil {
		return "", errors.New("estate: not a member of this estate")
	}
	if deleted {
		return "", errors.New("estate: this account has been deleted")
	}
	if banned {
		return "", errors.New("estate: this account is banned from the estate")
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

	ecJSON, _ := json.Marshal(req.EmergencyContact)
	nokJSON, _ := json.Marshal(req.NextOfKin)

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
	if err := s.assertNoLegalHold(ctx, estateID); err != nil {
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

// GetResidentCard assembles the resident ID card payload.
// The QR value encodes "<estate_id>:<resident_id>" for gate scanner verification.
func (s *Service) GetResidentCard(ctx context.Context, estateID, userID string) (*ResidentCard, error) {
	var card ResidentCard
	const q = `
		SELECT r.id, r.estate_id, e.name, r.unit, r.role,
		       COALESCE(rp.occupancy_type,'resident'), COALESCE(rp.profile_photo_url,''),
		       COALESCE(NULLIF(btrim(au.first_name || ' ' || au.last_name), ''), au.email, '')
		FROM estate_residents r
		JOIN estates e ON e.id = r.estate_id
		LEFT JOIN resident_profiles rp ON rp.resident_id = r.id
		JOIN public.platform_users au ON au.id = r.user_id::uuid
		WHERE r.estate_id = $1 AND r.user_id = $2`
	if err := s.db.QueryRow(ctx, q, estateID, userID).Scan(
		&card.ResidentID, &card.EstateID, &card.EstateName, &card.Unit, &card.Role,
		&card.OccupancyType, &card.ProfilePhotoURL, &card.FullName,
	); err != nil {
		return nil, errors.New("estate: resident not found in this estate")
	}
	card.QRValue = card.EstateID + ":" + card.ResidentID
	card.IssuedAt = time.Now().UTC().Format(time.RFC3339)
	return &card, nil
}

// GenerateInviteCode creates a shareable join code (estate admin only). The code carries the role it
// grants, so an admin can invite a co-manager without leaving the estate (EST-UAT-0028).
func (s *Service) GenerateInviteCode(ctx context.Context, estateID, adminID string, req GenerateInviteCodeRequest) (*InviteCode, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if req.ExpiresAt.Before(time.Now()) {
		return nil, errors.New("estate: expires_at must be in the future")
	}
	role := strings.TrimSpace(req.Role)
	if role == "" {
		role = RoleResident
	}
	if role != RoleResident && role != RoleEstateAdmin {
		return nil, errors.New("estate: role must be resident or estate_admin")
	}
	// Generate a compact alphanumeric code (12 chars).
	raw := uuid.New().String()
	code := raw[:8] // first 8 hex chars of a UUID — unique enough for estate scale

	ic := &InviteCode{
		ID:        uuid.New().String(),
		EstateID:  estateID,
		CreatedBy: adminID,
		Code:      code,
		Role:      role,
		MaxUses:   req.MaxUses,
		ExpiresAt: req.ExpiresAt,
		CreatedAt: time.Now(),
	}
	const q = `
		INSERT INTO estate_invite_codes (id, estate_id, created_by, code, max_uses, expires_at, role)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`
	_, err := s.db.Exec(ctx, q, ic.ID, ic.EstateID, ic.CreatedBy, ic.Code, ic.MaxUses, ic.ExpiresAt, role)
	if err != nil {
		return nil, fmt.Errorf("estate: create invite code: %w", err)
	}
	_ = s.audit(ctx, estateID, adminID, "ESTATE_INVITE_CODE_CREATED", "invite_code", ic.ID,
		map[string]any{"role": role, "max_uses": ic.MaxUses, "expires_at": ic.ExpiresAt.Format(time.RFC3339)})
	return ic, nil
}

// JoinWithInviteCode validates and redeems an invite code, then adds the user with the role the code
// carries.
func (s *Service) JoinWithInviteCode(ctx context.Context, userID, code string) (*Resident, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("estate: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var ic InviteCode
	const lookup = `
		SELECT id, estate_id, max_uses, used_count, expires_at, role
		FROM estate_invite_codes WHERE code=$1 FOR UPDATE`
	if err := tx.QueryRow(ctx, lookup, code).Scan(
		&ic.ID, &ic.EstateID, &ic.MaxUses, &ic.UsedCount, &ic.ExpiresAt, &ic.Role,
	); err != nil {
		return nil, errors.New("estate: invalid invite code")
	}
	if time.Now().After(ic.ExpiresAt) {
		return nil, errors.New("estate: invite code has expired")
	}
	if ic.UsedCount >= ic.MaxUses {
		return nil, errors.New("estate: invite code has reached maximum uses")
	}
	// Lifecycle gate (ESTD-D025): this route has no :id, so LifecycleGate cannot
	// see the estate — a suspended/pending/closed estate takes no new members.
	if err := s.AssertEstateWritable(ctx, ic.EstateID); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `UPDATE estate_invite_codes SET used_count=used_count+1 WHERE id=$1`, ic.ID); err != nil {
		return nil, fmt.Errorf("estate: update invite code: %w", err)
	}

	// Insert resident. A manager code promotes an existing member; nothing an invite redeems can
	// demote an admin or touch a removed or banned membership — those decisions belong to the admin
	// routes, not to a code holder.
	role := ic.Role
	if role == "" {
		role = RoleResident
	}
	r := &Resident{
		ID:       uuid.New().String(),
		EstateID: ic.EstateID,
		UserID:   userID,
		Role:     role,
	}
	const insertR = `
		INSERT INTO estate_residents (id, estate_id, user_id, unit, role)
		VALUES ($1,$2,$3,'',$4)
		ON CONFLICT (estate_id, user_id) DO UPDATE
		SET role = CASE WHEN estate_residents.role = 'estate_admin'
		                THEN estate_residents.role ELSE EXCLUDED.role END
		WHERE estate_residents.deleted_at IS NULL AND estate_residents.banned_at IS NULL
		RETURNING id, estate_id, user_id, unit, role, created_at`
	err = tx.QueryRow(ctx, insertR, r.ID, r.EstateID, r.UserID, role).Scan(
		&r.ID, &r.EstateID, &r.UserID, &r.Unit, &r.Role, &r.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("estate: this estate membership is no longer active")
	}
	if err != nil {
		return nil, fmt.Errorf("estate: join by invite: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("estate: commit join: %w", err)
	}
	_ = s.audit(ctx, ic.EstateID, userID, "ESTATE_MEMBER_JOINED_BY_INVITE", "resident", r.ID,
		map[string]any{"role": r.Role, "invite_code_id": ic.ID})
	return r, nil
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
		return nil, errors.New("estate: decision must be 'approved' or 'rejected'")
	}
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("estate: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

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
		return nil, errors.New("estate: join request not found or already reviewed")
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
		return nil, errors.New("estate: no join request found")
	}
	return jr, nil
}

// ListEstates lists only the estates the caller belongs to (as a resident/admin or
// via a live staff grant). SP-01: it previously returned every estate's name,
// address and admin_id to any authenticated caller — a cross-estate disclosure.
func (s *Service) ListEstates(ctx context.Context, callerID, search string) ([]Estate, error) {
	if !s.guardGrantsOn {
		return s.listAllEstates(ctx, search)
	}
	if callerID == "" {
		return nil, ErrNotMember
	}
	const q = `
		SELECT e.id, e.name, COALESCE(e.address,''), e.admin_id, e.created_at FROM estates e
		WHERE (
			EXISTS (SELECT 1 FROM estate_residents er WHERE er.estate_id = e.id AND er.user_id = $2)
			OR EXISTS (SELECT 1 FROM estate_staff_grants g
			           WHERE g.estate_id = e.id AND g.user_id = $2
			             AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > NOW()))
		)
		AND ($1='' OR e.name ILIKE '%' || $1 || '%' OR e.address ILIKE '%' || $1 || '%')
		ORDER BY e.name LIMIT 50`
	rows, err := s.db.Query(ctx, q, search, callerID)
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

// listAllEstates is ListEstates before PR #876 (every estate, for discovery). It
// stays the behaviour while FEATURE_ESTATE_GUARD_GRANTS is off. Two changes:
// COALESCE(address) — the old query failed the whole list on one NULL address —
// and status='active' — pending/suspended/closed estates are not publicly
// discoverable (ESTD-D025; members still see their own via ListEstates).
func (s *Service) listAllEstates(ctx context.Context, search string) ([]Estate, error) {
	const q = `
		SELECT id, name, COALESCE(address,''), admin_id, created_at FROM estates
		WHERE status = 'active'
		  AND ($1='' OR name ILIKE '%' || $1 || '%' OR address ILIKE '%' || $1 || '%')
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
	// Unit keys must be unique within an estate (EST-UAT-0038). There is no DB
	// unique constraint yet (pending migration — see
	// docs/qa/estate-uat-443/migrations-estate-a/), so enforce in code.
	var dupID string
	err := s.db.QueryRow(ctx,
		`SELECT id FROM estate_properties
		 WHERE estate_id=$1 AND unit_label=$2 AND COALESCE(block,'')=COALESCE($3,'') AND archived=FALSE
		 LIMIT 1`,
		estateID, req.UnitLabel, req.Block,
	).Scan(&dupID)
	if err == nil {
		return nil, fmt.Errorf("estate: unit %q already exists in this estate", req.UnitLabel)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("estate: check duplicate unit: %w", err)
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
	_, err = s.db.Exec(ctx, q, p.ID, p.EstateID, p.UnitLabel, p.PropertyType, p.Floor, p.Block)
	return p, err
}

// ListProperties lists all properties in an estate.
func (s *Service) ListProperties(ctx context.Context, estateID, memberID string) ([]EstateProperty, error) {
	if err := s.assertResident(ctx, estateID, memberID); err != nil {
		return nil, err
	}
	const q = `
		SELECT id, estate_id, unit_label, property_type, COALESCE(floor,''), COALESCE(block,''), occupancy_status, landlord_id, tenant_id, archived, created_at
		FROM estate_properties WHERE estate_id=$1 AND archived=FALSE ORDER BY block, floor, unit_label`
	rows, err := s.db.Query(ctx, q, estateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EstateProperty
	for rows.Next() {
		var p EstateProperty
		if err := rows.Scan(&p.ID, &p.EstateID, &p.UnitLabel, &p.PropertyType, &p.Floor, &p.Block, &p.OccupancyStatus, &p.LandlordID, &p.TenantID, &p.Archived, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ClaimOwnership submits a document-backed ownership claim for a property.
func (s *Service) ClaimOwnership(ctx context.Context, propertyID, userID, docURL string) (*OwnershipClaim, error) {
	if strings.TrimSpace(docURL) == "" {
		return nil, errors.New("estate: ownership_doc_url is required")
	}
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
// The landlord is resolved SERVER-SIDE from the property — trusting the
// request body's landlord_id let any user file a request naming THEMSELVES
// the landlord, then self-approve it through ReviewTenancyRequest to claim
// the unit's tenancy and gain estate membership.
func (s *Service) CreateTenancyRequest(ctx context.Context, estateID, propertyID string, req TenancyRequestBody, tenantID string) (*TenancyRequest, error) {
	if tenantID == "" {
		return nil, errors.New("estate: unauthenticated")
	}
	// Bind the property to the route's estate and pull its real landlord.
	var propEstate, landlordID string
	if err := s.db.QueryRow(ctx,
		`SELECT estate_id, COALESCE(landlord_id::TEXT,'') FROM estate_properties WHERE id=$1`, propertyID,
	).Scan(&propEstate, &landlordID); err != nil {
		return nil, errors.New("estate: property not found")
	}
	if propEstate != estateID {
		return nil, errors.New("estate: property does not belong to this estate")
	}
	if landlordID == "" {
		return nil, errors.New("estate: property has no landlord to review the request")
	}
	tr := &TenancyRequest{
		ID:           uuid.New().String(),
		PropertyID:   propertyID,
		TenantID:     tenantID,
		LandlordID:   landlordID,
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

// ReviewTenancyRequest allows the property's landlord to approve or reject a
// tenancy request. Approval side-effects (property occupancy + resident
// membership) commit in the SAME transaction as the status flip — previously
// they ran as separate error-discarding Execs, so a partial approval could
// occupy the unit without admitting the tenant (or vice versa).
func (s *Service) ReviewTenancyRequest(ctx context.Context, requestID, landlordID, estateID, decision string) (*TenancyRequest, error) {
	if decision != "approved" && decision != "rejected" {
		return nil, errors.New("estate: decision must be 'approved' or 'rejected'")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	now := time.Now()
	tr := &TenancyRequest{}
	const q = `
		UPDATE tenancy_requests tr SET status=$1, reviewed_at=$2
		FROM estate_properties ep
		WHERE tr.id=$3 AND tr.landlord_id=$4 AND ep.id=tr.property_id AND ep.estate_id=$5 AND tr.status='pending'
		RETURNING tr.id, tr.property_id, tr.tenant_id, tr.landlord_id, tr.lease_start::TEXT, COALESCE(tr.lease_end::TEXT,''), COALESCE(tr.agreement_url,''), tr.status, tr.reviewed_at, tr.created_at`
	if err := tx.QueryRow(ctx, q, decision, now, requestID, landlordID, estateID).Scan(
		&tr.ID, &tr.PropertyID, &tr.TenantID, &tr.LandlordID, &tr.LeaseStart, &tr.LeaseEnd,
		&tr.AgreementURL, &tr.Status, &tr.ReviewedAt, &tr.CreatedAt,
	); err != nil {
		return nil, errors.New("estate: tenancy request not found, not your request, or already reviewed")
	}

	// On approval: mark property occupied and upsert a resident record for the tenant.
	if decision == "approved" {
		if _, err := tx.Exec(ctx,
			`UPDATE estate_properties SET tenant_id=$1, occupancy_status='occupied' WHERE id=$2 AND estate_id=$3`,
			tr.TenantID, tr.PropertyID, estateID,
		); err != nil {
			return nil, fmt.Errorf("estate: mark property occupied: %w", err)
		}
		// estate_residents.role CHECK allows only 'resident'/'estate_admin';
		// an approved tenant is admitted as a 'resident' (the tenant/owner
		// distinction lives in resident_profiles.occupancy_type).
		if _, err := tx.Exec(ctx,
			`INSERT INTO estate_residents (id, estate_id, user_id, unit, role)
			 VALUES ($1,$2,$3,'','resident')
			 ON CONFLICT (estate_id, user_id) DO UPDATE SET role='resident'`,
			uuid.New().String(), estateID, tr.TenantID,
		); err != nil {
			return nil, fmt.Errorf("estate: admit approved tenant: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
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
	const q = `SELECT role, banned_at IS NOT NULL, deleted_at IS NOT NULL FROM estate_residents WHERE estate_id=$1 AND user_id=$2`
	var role string
	var banned, deleted bool
	if err := s.db.QueryRow(ctx, q, estateID, userID).Scan(&role, &banned, &deleted); err != nil {
		return errors.New("estate: not a member of this estate")
	}
	if deleted {
		return errors.New("estate: this account has been deleted")
	}
	if banned {
		return errors.New("estate: this account is banned from the estate")
	}
	if slices.Contains(roles, role) {
		return nil
	}
	return errors.New("estate: insufficient role")
}
