package estate

// occupancy.go — the unit occupancy registry (UAT lane estate-a, module M03: EST-UAT-0043, 0044,
// 0045, 0046, 0048, 0051, 0052).
//
// Before this file the module knew that a person belonged to an estate (estate_residents, one row per
// estate+user with a free-text unit label) and that a unit had a landlord_id and a tenant_id column,
// but it could not answer the questions M03 asks: how many people live in this unit, who occupies it
// right now, from when to when, whether anybody checked the documents that say so. Every one of those
// was a string comparison or a self-declared label.
//
// The rules therefore live in the database (estate_unit_occupants, its capacity trigger, and the two
// SECURITY DEFINER writers in 20271099000060) and this file is the thin, typed front door to them:
//   - AdmitOccupant / ReleaseOccupant are the only ways occupancy changes, so an admin assigning a
//     tenant, a landlord approving a tenancy, a reviewed ownership claim and a bulk import all pass the
//     same capacity, overlap and membership checks instead of each inventing its own subset.
//   - The admitting writer is promotion-only for estate membership and refuses to revive a banned or
//     deleted account, which is what the tenancy approval used to get wrong by demoting an estate admin.
//   - SetUnitCapacity can only be lowered to a number the unit is not already over.
//   - VerifyOccupancyProof is the reviewer identity EST-UAT-0051 was missing; replacing a document
//     resets the state in the database, so a re-declaration never inherits an old approval.
//
// Schema: supabase/migrations/20271099000060_estate_occupancy_integrity.sql.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"spotlight/backend/go-common/dbutil"
)

// DefaultUnitCapacity is what a unit accepts when nobody has configured it. Six is a household, not a
// hotel room; it is also what the migration's column default says, so the two must not drift.
const DefaultUnitCapacity = 6

// PropertyTypes is the domain estate_properties_property_type_check enforces. It lives here rather
// than beside the column so the unit routes and the CSV importer read one list instead of two that
// can drift.
var PropertyTypes = map[string]bool{"apartment": true, "house": true, "commercial": true, "land": true, legacyOther: true}

// claimStatuses is property_ownership_claims_status_check, spelled out once so the queue filter can
// refuse a value the table could never hold.
var claimStatuses = map[string]bool{"pending": true, "approved": true, "rejected": true}

// Occupancy kinds (estate_unit_occupants.occupancy_type). resident_profiles.occupancy_type accepts a
// fourth value, 'landlord', which only a self-declaration can produce — the registry has no landlord
// kind because a landlord is defined by the units they own, not by an occupancy row.
const (
	OccupancyResident  = "resident"
	OccupancyTenant    = "tenant"
	OccupancyHomeowner = "homeowner"
)

// Occupancy proof states (resident_profiles.proof_status).
const (
	ProofUnverified = "unverified"
	ProofPending    = "pending"
	ProofVerified   = "verified"
	ProofRejected   = "rejected"
)

// NotifEstateOccupancyAdmitted tells a person they have been recorded against a unit;
// NotifEstateOccupancyReleased tells them the registration has ended;
// NotifEstateOccupancyProofReviewed tells them their documents have been reviewed.
const (
	NotifEstateOccupancyAdmitted      = "estate_occupancy_admitted"
	NotifEstateOccupancyReleased      = "estate_occupancy_released"
	NotifEstateOccupancyProofReviewed = "estate_occupancy_proof_reviewed"
)

var (
	// ErrUnitNotFound — no live unit with that id in this estate.
	ErrUnitNotFound = errors.New("estate: unit not found in this estate")
	// ErrNoLiveOccupancy — the person does not currently occupy that unit.
	ErrNoLiveOccupancy = errors.New("estate: this person does not currently occupy that unit")
	// ErrUnitCapacityExceeded — the unit already carries capacity registrations.
	ErrUnitCapacityExceeded = errors.New("estate: this unit is already at capacity")
	// ErrUnitHasAnotherOwner / ErrUnitHasAnotherTenant — the overlap rule (EST-UAT-0044). A unit has
	// one current owner and one current tenant; displacing either is a transfer, not an approval.
	ErrUnitHasAnotherOwner  = errors.New("estate: another member is already recorded as this unit's owner")
	ErrUnitHasAnotherTenant = errors.New("estate: another member is already recorded as this unit's tenant")
	// ErrUnitArchived — an archived unit takes no new occupants.
	ErrUnitArchived = errors.New("estate: this unit is archived")
	// ErrUnitHasLiveOccupants — the register still lists people in the unit, so a flag cannot claim it
	// is vacant or retired (EST-UAT-0044, 0052).
	ErrUnitHasLiveOccupants = errors.New("estate: this unit still has occupants recorded")
	// ErrNotAuthorisedToAdmit / ErrNotAuthorisedToRelease — the writer's privilege decision.
	ErrNotAuthorisedToAdmit   = errors.New("estate: only an estate admin or this unit's landlord can record this occupancy")
	ErrNotAuthorisedToRelease = errors.New("estate: only an estate admin or the occupant can end this occupancy")
	// ErrResidencyNotActive — the target's estate membership is deleted or banned.
	ErrResidencyNotActive = errors.New("estate: this estate membership is no longer active")
	// ErrResidencyNotInEffect — a live registration whose term does not cover today (EST-UAT-0045).
	ErrResidencyNotInEffect = errors.New("estate: your occupancy of this unit is not in effect today")
	// ErrUnknownOccupancyType / ErrInvalidOccupancyWindow / ErrInvalidOccupantUser — caller mistakes.
	ErrUnknownOccupancyType   = errors.New("estate: unknown occupancy type")
	ErrInvalidOccupancyWindow = errors.New("estate: the move-out date cannot precede the move-in date")
	ErrInvalidOccupantUser    = errors.New("estate: a valid user_id is required")
	ErrInvalidCapacity        = errors.New("estate: capacity must be at least 1")
	// ErrInvalidPropertyType — estate_properties.property_type is a closed domain and the database
	// refuses anything outside it with a CHECK violation. Validating it here is what turns that
	// violation into a refused request (ESTA-D032); the importer has always checked the same set.
	ErrInvalidPropertyType = errors.New("estate: property_type must be apartment, house, commercial, land or other")
	// ErrInvalidInvoiceAmount — the caller's arithmetic, not the estate's rule.
	ErrInvalidInvoiceAmount = errors.New("estate: invoice amount must be positive kobo")
	// ErrCapacityBelowOccupants — lowering a unit below who already lives there.
	ErrCapacityBelowOccupants = errors.New("estate: this unit already has more occupants than that capacity")
	// ErrVacantUnitExempt / ErrOutOfTermUnitExempt — the two dues exemptions (EST-UAT-0048, 0045).
	ErrVacantUnitExempt    = errors.New("estate: dues are exempt for a vacant unit")
	ErrOutOfTermUnitExempt = errors.New("estate: dues are exempt while this occupant's term on the unit is not running")
	// ErrBillingOverrideNeedsReason — an override without a reason is not an auditable decision.
	ErrBillingOverrideNeedsReason = errors.New("estate: a reason is required to bill against an occupancy exemption")
	// ErrDuplicateUnitKey — the same block/floor/unit_label already exists live (EST-UAT-0038).
	ErrDuplicateUnitKey = errors.New("estate: a unit with that label already exists in this estate")
	// ErrProofNotFound / ErrProofNeedsDocument / ErrInvalidProofDecision — the review queue.
	ErrProofNotFound        = errors.New("estate: no occupancy declaration on record for that resident")
	ErrProofNeedsDocument   = errors.New("estate: there is no document on record to verify")
	ErrInvalidProofDecision = errors.New("estate: proof decision must be verified or rejected")
	// ErrClaimNotFound / ErrClaimReviewed / ErrInvalidReviewDecision — the ownership claim queue, which
	// used to accept a review of any row, including one that had already been decided.
	ErrClaimNotFound         = errors.New("estate: ownership claim not found in this estate")
	ErrClaimReviewed         = errors.New("estate: ownership claim already reviewed")
	ErrInvalidReviewDecision = errors.New("estate: decision must be 'approved' or 'rejected'")
	// ErrInvalidClaimFilter — ?status= on the queue is an exact match, so a typo would read as
	// "nothing is waiting" to the admin who has to act on it.
	ErrInvalidClaimFilter = errors.New("estate: claim status must be pending, approved or rejected")
	// ErrTenancyNotReviewable covers three caller states the single guarded UPDATE cannot tell apart
	// without a second read: no such row, not addressed to this reviewer, or already decided. It is a
	// 404 on purpose — naming which of the three it is would confirm somebody else's request exists.
	ErrTenancyNotReviewable = errors.New("estate: tenancy request not found, not your request, or already reviewed")
	// ErrUnitNoLandlord — a tenancy request needs the unit's owner to review it, and a unit with nobody
	// on the deed has none. An admin assigns an owner first; the request is not a way around that.
	ErrUnitNoLandlord = errors.New("estate: this unit has no landlord to review the request")
	// ErrPropertyTransferNotFound / ErrTransferAlreadyReviewed — the transfer queue. The review is
	// idempotent-refusing now because approving a decided transfer would move the deed twice.
	ErrPropertyTransferNotFound = errors.New("estate: transfer request not found in this estate")
	ErrTransferAlreadyReviewed  = errors.New("estate: transfer request already reviewed")
	// ErrInvalidOccupancyStatus / ErrInvalidTransferType — the two other free-text enums the property
	// routes accepted straight from the body, which turned a typo into a 500.
	ErrInvalidOccupancyStatus = errors.New("estate: occupancy status must be vacant, occupied or reserved")
	ErrInvalidTransferType    = errors.New("estate: transfer type must be ownership or tenancy")
	// ErrUnitHasDeedOwner / ErrUnitHasOpenInvoices — the other two archive gates (EST-UAT-0052), which
	// were plain sentences and therefore arrived at the caller as an internal error.
	ErrUnitHasDeedOwner    = errors.New("estate: cannot archive a unit that still has an owner on the deed — transfer it first")
	ErrUnitHasOpenInvoices = errors.New("estate: cannot archive a unit with open dues invoices — settle or waive them first")
)

// UnitOccupant is one person's registration against one unit.
type UnitOccupant struct {
	ID             string     `json:"id"`
	EstateID       string     `json:"estate_id"`
	PropertyID     string     `json:"property_id"`
	UnitLabel      string     `json:"unit_label"`
	UserID         string     `json:"user_id"`
	OccupancyType  string     `json:"occupancy_type"`
	EffectiveFrom  *time.Time `json:"effective_from,omitempty"`
	EffectiveUntil *time.Time `json:"effective_until,omitempty"`
	AdmittedBy     string     `json:"admitted_by,omitempty"`
	Note           string     `json:"note,omitempty"`
	// InEffect is computed by the read: the registration is live and today falls inside its term.
	// A registration with no dates is always in effect (EST-UAT-0045's "NULL = unrestricted").
	InEffect  bool       `json:"in_effect"`
	EndedAt   *time.Time `json:"ended_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

// AdmitOccupantRequest is the body for POST /estate/:id/properties/:pid/occupants.
type AdmitOccupantRequest struct {
	UserID         string `json:"user_id" binding:"required"`
	OccupancyType  string `json:"occupancy_type"`
	EffectiveFrom  string `json:"effective_from"`
	EffectiveUntil string `json:"effective_until"`
	Note           string `json:"note"`
	// ReplaceOwner is the explicit displacement the overlap rule demands: an admin who has already
	// reviewed a transfer of the unit sets it; an approval that simply found somebody else on the deed
	// does not, and the writer refuses.
	ReplaceOwner bool `json:"replace_owner"`
}

// SetUnitCapacityRequest is the body for PATCH /estate/:id/properties/:pid/capacity.
type SetUnitCapacityRequest struct {
	Capacity int `json:"capacity" binding:"required,min=1,max=1000"`
}

// VerifyOccupancyProofRequest is the body for POST /estate/:id/profile/occupancy-proof/verify.
// Decision is verified|rejected — the two states that mean an estate has looked at the documents.
type VerifyOccupancyProofRequest struct {
	UserID   string `json:"user_id"`
	Decision string `json:"decision" binding:"required"`
	Note     string `json:"note"`
}

// OccupancyAdmission is what estate_occupancy_admit() reports back.
type OccupancyAdmission struct {
	OccupantID    string `json:"occupant_id"`
	ResidentID    string `json:"resident_id"`
	Role          string `json:"role"`
	OccupancyType string `json:"occupancy_type"`
}

// OccupancyRelease is what estate_occupancy_release() reports back.
type OccupancyRelease struct {
	OccupantID      string `json:"occupant_id"`
	OccupancyStatus string `json:"occupancy_status"`
}

// OccupancyProof is a resident's declared occupancy and what the estate has done about it.
type OccupancyProof struct {
	ResidentID      string     `json:"resident_id"`
	UserID          string     `json:"user_id"`
	Unit            string     `json:"unit"`
	OccupancyType   string     `json:"occupancy_type"`
	ProofStatus     string     `json:"proof_status"`
	OwnershipDocURL string     `json:"ownership_doc_url,omitempty"`
	AgreementURL    string     `json:"agreement_url,omitempty"`
	LeaseStart      *time.Time `json:"lease_start,omitempty"`
	LeaseEnd        *time.Time `json:"lease_end,omitempty"`
	ProofVerifiedBy string     `json:"proof_verified_by,omitempty"`
	ProofVerifiedAt *time.Time `json:"proof_verified_at,omitempty"`
	ProofReviewNote string     `json:"proof_review_note,omitempty"`
}

// parseOccupancyDate accepts the YYYY-MM-DD a date input sends and returns the day it means, or nil
// for "no bound". An unparseable value is a caller mistake, not a zero date.
func parseOccupancyDate(field, value string) (*time.Time, error) {
	v := strings.TrimSpace(value)
	if v == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", v)
	if err != nil {
		return nil, fmt.Errorf("%w: %s must be YYYY-MM-DD", ErrInvalidOccupancyWindow, field)
	}
	return &t, nil
}

// occupancyDateArg renders a parsed bound the way a DATE parameter wants it: a plain date string, or
// NULL. Passing a time.Time for a column-less $n::date would carry a clock time nobody means.
func occupancyDateArg(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.Format("2006-01-02")
}

// mapOccupancyWriterErr turns the SQLSTATE raised by the two occupancy writers, or by the dues
// exemption triggers, into a sentinel the handler can map to a status. Postgres gives no finer signal
// than 23514 / 55000 / 42501 / 22023 for a RAISE inside a trigger or a plpgsql function, so the
// message is the discriminator — and this package owns both ends of it. The strings below are quoted
// from 20271099000060_estate_occupancy_integrity.sql; if one changes there, the matching case here has
// to change with it, which is why they are listed together in one place rather than inlined per call.
func mapOccupancyWriterErr(op string, err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return fmt.Errorf("estate: %s: %w", op, err)
	}
	msg := pgErr.Message
	switch pgErr.Code {
	case "P0002":
		if strings.Contains(msg, "live occupancy") {
			return ErrNoLiveOccupancy
		}
		return ErrUnitNotFound
	case "22023":
		if strings.Contains(msg, "occupancy type") {
			return ErrUnknownOccupancyType
		}
		return ErrInvalidOccupancyWindow
	case "42501":
		if strings.Contains(msg, "end this occupancy") {
			return ErrNotAuthorisedToRelease
		}
		return ErrNotAuthorisedToAdmit
	case "55000":
		switch {
		case strings.Contains(msg, "already has an owner"):
			return ErrUnitHasAnotherOwner
		case strings.Contains(msg, "archived"):
			return ErrUnitArchived
		case strings.Contains(msg, "membership is no longer active"):
			return ErrResidencyNotActive
		}
	case "23514":
		switch pgErr.ConstraintName {
		case "estate_dues_invoices_vacancy_override_reason",
			"estate_dues_invoices_term_override_reason":
			return ErrBillingOverrideNeedsReason
		}
		switch {
		case strings.Contains(msg, "unit is full"):
			return ErrUnitCapacityExceeded
		case strings.Contains(msg, "vacant"):
			return ErrVacantUnitExempt
		case strings.Contains(msg, "term"):
			return ErrOutOfTermUnitExempt
		}
	case "23505":
		switch pgErr.ConstraintName {
		case "estate_unit_occupants_one_live_owner":
			return ErrUnitHasAnotherOwner
		case "estate_unit_occupants_one_live_tenant":
			return ErrUnitHasAnotherTenant
		}
	case "22P02":
		return ErrInvalidOccupantUser
	}
	return fmt.Errorf("estate: %s: %w", op, err)
}

// rowQueryer is the slice of pgx these writers need. Both *pgxpool.Pool and pgx.Tx satisfy it, so an
// admission can be joined to a caller's transaction rather than escaping it — which is what makes
// "the tenancy was approved and the occupant was admitted" one decision instead of two, one of which
// can fail.
type rowQueryer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// occupancyAdmission is one call to estate_occupancy_admit().
type occupancyAdmission struct {
	estateID, propertyID, userID, actorID, kind string
	from, until                                 *time.Time
	note                                        string
	replaceOwner                                bool
}

// admitOccupancy runs the single admitting writer. It is deliberately free of policy of its own: the
// rules are the function's, and this is the typed call plus the error translation.
func admitOccupancy(ctx context.Context, db rowQueryer, a occupancyAdmission) (*OccupancyAdmission, error) {
	const q = `
		SELECT out_occupant_id, out_resident_id, out_role, out_occupancy_type
		FROM estate_occupancy_admit($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9)`
	var out OccupancyAdmission
	err := db.QueryRow(ctx, q, a.estateID, a.propertyID, a.userID, a.actorID, a.kind,
		occupancyDateArg(a.from), occupancyDateArg(a.until),
		dbutil.NullStr(strings.TrimSpace(a.note)), a.replaceOwner,
	).Scan(&out.OccupantID, &out.ResidentID, &out.Role, &out.OccupancyType)
	if err != nil {
		return nil, mapOccupancyWriterErr("admit occupant", err)
	}
	return &out, nil
}

// parseAdmitRequest validates the caller's intent before any write: kind, and the two date bounds in
// the order they have to be in. Shared by the route and the rewired approval paths so a tenancy
// approval gets the same 400-shaped refusal as a direct admission.
func parseAdmitRequest(req AdmitOccupantRequest) (kind string, from, until *time.Time, err error) {
	userID := strings.TrimSpace(req.UserID)
	if userID == "" {
		return "", nil, nil, ErrInvalidOccupantUser
	}
	kind = strings.TrimSpace(req.OccupancyType)
	if kind == "" {
		kind = OccupancyResident
	}
	if kind != OccupancyResident && kind != OccupancyTenant && kind != OccupancyHomeowner {
		return "", nil, nil, fmt.Errorf("%w: %s", ErrUnknownOccupancyType, kind)
	}
	from, err = parseOccupancyDate("effective_from", req.EffectiveFrom)
	if err != nil {
		return "", nil, nil, err
	}
	until, err = parseOccupancyDate("effective_until", req.EffectiveUntil)
	if err != nil {
		return "", nil, nil, err
	}
	if from != nil && until != nil && until.Before(*from) {
		return "", nil, nil, ErrInvalidOccupancyWindow
	}
	return kind, from, until, nil
}

// AdmitOccupant records a person against a unit. It performs no writes of its own: residency,
// registration, party columns, occupancy flag, profile label and audit all happen inside
// estate_occupancy_admit(), so a partial admission (tenant recorded but the unit still flagged vacant,
// or the reverse) is not reachable from here.
func (s *Service) AdmitOccupant(ctx context.Context, estateID, actorID, propertyID string, req AdmitOccupantRequest) (*OccupancyAdmission, error) {
	kind, from, until, err := parseAdmitRequest(req)
	if err != nil {
		return nil, err
	}
	a, err := admitOccupancy(ctx, s.db, occupancyAdmission{
		estateID: estateID, propertyID: propertyID, userID: strings.TrimSpace(req.UserID),
		actorID: actorID, kind: kind, from: from, until: until, note: req.Note,
		replaceOwner: req.ReplaceOwner,
	})
	if err != nil {
		return nil, err
	}

	// The person admitted moves into a unit; they are the one who needs to know. An admin acting for
	// somebody else is not that person.
	if actorID != strings.TrimSpace(req.UserID) {
		s.notify(ctx, estateID, strings.TrimSpace(req.UserID), NotifEstateOccupancyAdmitted, "You are recorded at a new unit",
			fmt.Sprintf("Your %s occupancy of this unit is now on record.", a.OccupancyType),
			map[string]any{"property_id": propertyID, "occupancy_type": a.OccupancyType})
	}
	return a, nil
}

// occupancyRelease is one call to estate_occupancy_release().
type occupancyRelease struct {
	estateID, propertyID, userID, actorID, reason string
}

// releaseOccupancy runs the single releasing writer, inside whatever transaction the caller is in.
// A transfer has to end the displaced party's registration before admitting the incoming one, and that
// pair has to be one decision.
func releaseOccupancy(ctx context.Context, db rowQueryer, r occupancyRelease) (*OccupancyRelease, error) {
	const q = `SELECT out_occupant_id, out_occupancy_status FROM estate_occupancy_release($1,$2,$3,$4,$5)`
	var out OccupancyRelease
	err := db.QueryRow(ctx, q, r.estateID, r.propertyID, strings.TrimSpace(r.userID), r.actorID,
		dbutil.NullStr(strings.TrimSpace(r.reason))).Scan(&out.OccupantID, &out.OccupancyStatus)
	if err != nil {
		return nil, mapOccupancyWriterErr("release occupant", err)
	}
	return &out, nil
}

// ReleaseOccupant ends a person's registration against a unit, keeping the history and recomputing
// whether the unit is still occupied (EST-UAT-0046).
func (s *Service) ReleaseOccupant(ctx context.Context, estateID, actorID, propertyID, userID, reason string) (*OccupancyRelease, error) {
	r, err := releaseOccupancy(ctx, s.db, occupancyRelease{
		estateID: estateID, propertyID: propertyID, userID: userID, actorID: actorID, reason: reason,
	})
	if err != nil {
		return nil, err
	}
	if actorID != userID {
		s.notify(ctx, estateID, userID, NotifEstateOccupancyReleased, "Your occupancy ended",
			"Your registration against this unit has been released.",
			map[string]any{"property_id": propertyID, "occupancy_status": r.OccupancyStatus})
	}
	return r, nil
}

const unitOccupantCols = `o.id, o.estate_id, o.property_id, COALESCE(p.unit_label,''), o.user_id,
	o.occupancy_type, o.effective_from, o.effective_until, COALESCE(o.admitted_by::text,''),
	COALESCE(o.note,''), o.ended_at,
	(o.ended_at IS NULL AND (o.effective_from IS NULL OR o.effective_from <= CURRENT_DATE)
	 AND (o.effective_until IS NULL OR o.effective_until >= CURRENT_DATE)) AS in_effect,
	o.created_at, o.updated_at`

func scanUnitOccupant(row interface{ Scan(dest ...any) error }) (UnitOccupant, error) {
	var o UnitOccupant
	err := row.Scan(&o.ID, &o.EstateID, &o.PropertyID, &o.UnitLabel, &o.UserID, &o.OccupancyType,
		&o.EffectiveFrom, &o.EffectiveUntil, &o.AdmittedBy, &o.Note, &o.EndedAt, &o.InEffect,
		&o.CreatedAt, &o.UpdatedAt)
	return o, err
}

// ListOccupancies answers "who is in this unit" and, with no unit, "which units does this person
// occupy" (EST-UAT-0043). An estate admin may read the estate's whole register, live and released;
// every other member reads only their own, which is the same scoping rule the rest of the module uses
// for personal data.
//
// roleIn rather than assertResident: reading your own occupancy history is how a person finds out why
// the door is shut, so the date gate that refuses member actions must not also hide the record that
// explains it.
func (s *Service) ListOccupancies(ctx context.Context, estateID, actorID, propertyID string, includeEnded bool) ([]UnitOccupant, error) {
	role, err := s.roleIn(ctx, estateID, actorID)
	if err != nil {
		return nil, err
	}
	isAdmin := role == "estate_admin"
	q := `SELECT ` + unitOccupantCols + `
		FROM estate_unit_occupants o
		JOIN estate_properties p ON p.id = o.property_id
		WHERE o.estate_id=$1`
	args := []any{estateID}
	if !isAdmin {
		q += fmt.Sprintf(" AND o.user_id=$%d", len(args)+1)
		args = append(args, actorID)
	}
	if propertyID != "" {
		q += fmt.Sprintf(" AND o.property_id=$%d", len(args)+1)
		args = append(args, propertyID)
	}
	if !includeEnded {
		q += " AND o.ended_at IS NULL"
	}
	q += " ORDER BY o.ended_at NULLS FIRST, o.created_at DESC LIMIT 500"

	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("estate: list occupants: %w", err)
	}
	defer rows.Close()
	out := []UnitOccupant{}
	for rows.Next() {
		o, err := scanUnitOccupant(rows)
		if err != nil {
			return nil, fmt.Errorf("estate: scan occupants: %w", err)
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// SetUnitCapacity changes how many registrations a unit accepts (estate admin only). Raising it is a
// plain write; lowering it below who already lives there is refused here rather than by the trigger,
// because the trigger only fires on the next admission and would leave the unit readable-but-full.
func (s *Service) SetUnitCapacity(ctx context.Context, estateID, adminID, propertyID string, capacity int) (*EstateProperty, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if capacity < 1 {
		return nil, ErrInvalidCapacity
	}
	var live int
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM estate_unit_occupants WHERE property_id=$1 AND estate_id=$2 AND ended_at IS NULL`,
		propertyID, estateID).Scan(&live); err != nil {
		return nil, fmt.Errorf("estate: count occupants: %w", err)
	}
	if capacity < live {
		return nil, fmt.Errorf("%w: %d recorded", ErrCapacityBelowOccupants, live)
	}
	row := s.db.QueryRow(ctx,
		`UPDATE estate_properties SET capacity=$3 WHERE id=$1 AND estate_id=$2 RETURNING `+propertyCols,
		propertyID, estateID, capacity)
	p, err := scanProperty(row)
	if err != nil {
		return nil, ErrUnitNotFound
	}
	_ = s.audit(ctx, estateID, adminID, "UNIT_CAPACITY_SET", "property", propertyID,
		map[string]any{"capacity": capacity, "live_occupants": live})
	return p, nil
}

// ListOwnershipClaims returns the claim queue (estate admin only). Before this the table could be
// written and reviewed by id but never read, which is why the review route could not be exercised.
func (s *Service) ListOwnershipClaims(ctx context.Context, estateID, adminID, status string) ([]OwnershipClaim, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	status = strings.TrimSpace(status)
	if status != "" && !claimStatuses[status] {
		return nil, ErrInvalidClaimFilter
	}
	q := `SELECT oc.id, oc.property_id, oc.user_id, oc.ownership_doc_url, oc.status, oc.verified_by, oc.verified_at,
		         COALESCE(oc.reject_reason,''), oc.created_at
		FROM property_ownership_claims oc
		JOIN estate_properties ep ON ep.id = oc.property_id
		WHERE ep.estate_id=$1 AND ($2::text IS NULL OR oc.status=$2)
		ORDER BY oc.created_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, q, estateID, dbutil.NullStr(strings.TrimSpace(status)))
	if err != nil {
		return nil, fmt.Errorf("estate: list ownership claims: %w", err)
	}
	defer rows.Close()
	out := []OwnershipClaim{}
	for rows.Next() {
		var c OwnershipClaim
		if err := rows.Scan(&c.ID, &c.PropertyID, &c.UserID, &c.OwnershipDocURL, &c.Status,
			&c.VerifiedBy, &c.VerifiedAt, &c.RejectReason, &c.CreatedAt); err != nil {
			return nil, fmt.Errorf("estate: scan ownership claims: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetOccupancyProof returns one resident's declared occupancy and its verification state. An admin
// reads anybody's; a member reads their own — which is the read the guard-facing card needs.
func (s *Service) GetOccupancyProof(ctx context.Context, estateID, actorID, forUserID string) (*OccupancyProof, error) {
	role, err := s.roleIn(ctx, estateID, actorID)
	if err != nil {
		return nil, err
	}
	target := strings.TrimSpace(forUserID)
	if role != "estate_admin" || target == "" {
		target = actorID
	}
	const q = `
		SELECT r.id, r.user_id, r.unit, COALESCE(rp.occupancy_type,'resident'),
		       COALESCE(rp.proof_status,'unverified'), COALESCE(rp.ownership_doc_url,''),
		       COALESCE(rp.agreement_url,''), rp.lease_start, rp.lease_end,
		       COALESCE(rp.proof_verified_by::text,''), rp.proof_verified_at, COALESCE(rp.proof_review_note,'')
		FROM estate_residents r
		LEFT JOIN resident_profiles rp ON rp.resident_id = r.id
		WHERE r.estate_id=$1 AND r.user_id=$2`
	p := &OccupancyProof{}
	err = s.db.QueryRow(ctx, q, estateID, target).Scan(&p.ResidentID, &p.UserID, &p.Unit, &p.OccupancyType,
		&p.ProofStatus, &p.OwnershipDocURL, &p.AgreementURL, &p.LeaseStart, &p.LeaseEnd,
		&p.ProofVerifiedBy, &p.ProofVerifiedAt, &p.ProofReviewNote)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrProofNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("estate: read occupancy proof: %w", err)
	}
	return p, nil
}

// VerifyOccupancyProof is the reviewer identity and decision EST-UAT-0051 was missing: the label on
// the resident card stops being pure self-declaration the moment an estate admin has looked at the
// document behind it. Rejecting leaves the declaration in place — the resident has to be able to see
// what was refused — but the state says so.
func (s *Service) VerifyOccupancyProof(ctx context.Context, estateID, adminID, userID, decision, note string) (*OccupancyProof, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if decision != ProofVerified && decision != ProofRejected {
		return nil, ErrInvalidProofDecision
	}
	target := strings.TrimSpace(userID)
	// Nothing to look at, nothing to verify: approving an empty declaration is how a queue gets
	// cleared without reading it.
	var hasDoc bool
	err := s.db.QueryRow(ctx, `
		SELECT COALESCE(NULLIF(btrim(rp.ownership_doc_url),''), NULLIF(btrim(rp.agreement_url),'')) IS NOT NULL
		FROM estate_residents r
		JOIN resident_profiles rp ON rp.resident_id = r.id
		WHERE r.estate_id=$1 AND r.user_id=$2`, estateID, target).Scan(&hasDoc)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrProofNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("estate: read proof document: %w", err)
	}
	if !hasDoc {
		return nil, ErrProofNeedsDocument
	}

	const q = `
		UPDATE resident_profiles rp
		SET proof_status=$1, proof_verified_by=$2, proof_verified_at=NOW(), proof_review_note=$3
		FROM estate_residents r
		WHERE rp.resident_id = r.id AND r.estate_id=$4 AND r.user_id=$5
		RETURNING COALESCE(rp.proof_status,'unverified')`
	var status string
	if err := s.db.QueryRow(ctx, q, decision, adminID, dbutil.NullStr(strings.TrimSpace(note)),
		estateID, target).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrProofNotFound
		}
		return nil, fmt.Errorf("estate: record proof decision: %w", err)
	}
	_ = s.audit(ctx, estateID, adminID, "OCCUPANCY_PROOF_"+strings.ToUpper(decision), "resident", target,
		map[string]any{"proof_status": status})
	s.notify(ctx, estateID, target, NotifEstateOccupancyProofReviewed, "Occupancy proof "+status,
		"Your occupancy documents were reviewed and the result is recorded against your profile.",
		map[string]any{"proof_status": status})

	proof, err := s.GetOccupancyProof(ctx, estateID, adminID, target)
	if err != nil {
		return nil, err
	}
	return proof, nil
}
