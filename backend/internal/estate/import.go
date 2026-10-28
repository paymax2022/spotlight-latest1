package estate

// Legacy-data import (UAT EST-UAT-0432..0441, ESTD-D034). Schema:
// 20271068001010_estate_import_batches.sql. Flag: FEATURE_ESTATE_IMPORT_ENABLED.
//
// Flow: DryRunImport validates every row, dedupes on natural keys and on the
// operator's external refs, plans insert/update/link/unchanged per row against
// the live estate and stores the raw payload + counts + per-row exception
// report as a 'dry_run' batch — writing nothing to estate tables.
// CommitImport (Idempotency-Key required) re-plans the SAME payload inside one
// transaction under an estate row lock and applies every valid row; error
// rows are isolated in the exception report and never block valid ones (except
// a failed opening-balance control total, which refuses the whole commit).
// Re-importing a changed export later is the delta re-apply: unchanged refs
// skip, changed refs update, new refs insert.
//
// Scope (honest): units, resident memberships (mapped to EXISTING platform
// accounts by email/phone — the importer never creates auth accounts) and
// positive opening dues balances, which become ordinary pending
// estate_dues_invoices: an invoice is a receivable, not a money movement, so no
// ledger entry is due until it is paid through the normal PayDues path. Credit
// (prepaid) balances, leases/deposits/rent receivables, historical payments,
// visitor logs and election history are NOT importable here and are reported
// as row exceptions or out of scope.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const maxImportRows = 5000

// Import entities (estate_import_refs.entity).
const (
	importEntityUnit     = "unit"
	importEntityResident = "resident"
	importEntityBalance  = "opening_balance"
)

// Planned row actions.
const (
	importInsert    = "insert"
	importUpdate    = "update"
	importLink      = "link"
	importUnchanged = "unchanged"
	importError     = "error"
)

var (
	ErrImportEmpty               = errors.New("estate: import has no rows")
	ErrImportTooLarge            = fmt.Errorf("estate: import exceeds %d rows — split it into batches", maxImportRows)
	ErrImportBatchNotFound       = errors.New("estate: import batch not found")
	ErrImportAlreadyCommitted    = errors.New("estate: import batch already committed with a different Idempotency-Key")
	ErrImportControlTotal        = errors.New("estate: opening-balance control total does not match the importable rows — commit refused")
	ErrImportEstateNotImportable = errors.New("estate: imports are only allowed while the estate is pending or active")
)

// ImportRequest is the dry-run body. Rows are kept raw so one malformed row
// becomes a row exception instead of failing the whole request.
type ImportRequest struct {
	SourceRef        string            `json:"source_ref"`
	Units            []json.RawMessage `json:"units"`
	Residents        []json.RawMessage `json:"residents"`
	OpeningBalances  []json.RawMessage `json:"opening_balances"`
	ControlTotalKobo *int64            `json:"control_total_kobo,omitempty"`
}

// ImportUnit is one legacy unit row.
type ImportUnit struct {
	ExternalRef     string `json:"external_ref"`
	UnitLabel       string `json:"unit_label"`
	Block           string `json:"block,omitempty"`
	Floor           string `json:"floor,omitempty"`
	PropertyType    string `json:"property_type,omitempty"`
	OccupancyStatus string `json:"occupancy_status,omitempty"`
}

// ImportResident is one legacy resident row. Identity maps to an existing
// platform account by email (preferred) or phone.
type ImportResident struct {
	ExternalRef    string `json:"external_ref"`
	Email          string `json:"email,omitempty"`
	Phone          string `json:"phone,omitempty"`
	UnitRef        string `json:"unit_ref,omitempty"`
	Relationship   string `json:"relationship,omitempty"` // occupant (default) | owner | tenant
	ResidencyStart string `json:"residency_start,omitempty"`
	ResidencyEnd   string `json:"residency_end,omitempty"`
}

// ImportOpeningBalance is one outstanding prior dues balance, in kobo.
type ImportOpeningBalance struct {
	ExternalRef string      `json:"external_ref"`
	ResidentRef string      `json:"resident_ref"`
	UnitRef     string      `json:"unit_ref,omitempty"`
	Category    string      `json:"category,omitempty"`
	AmountKobo  json.Number `json:"amount_kobo"`
	DueDate     string      `json:"due_date"`
}

// ImportException is one row of the exception report.
type ImportException struct {
	Entity      string `json:"entity"`
	Row         int    `json:"row"` // 0-based index within its entity array; -1 = batch level
	ExternalRef string `json:"external_ref,omitempty"`
	Code        string `json:"code"`
	Message     string `json:"message"`
}

// ImportEntityCounts are the per-entity dry-run / commit counts.
type ImportEntityCounts struct {
	Received  int `json:"received"`
	Insert    int `json:"insert"`
	Update    int `json:"update"`
	Link      int `json:"link"`
	Unchanged int `json:"unchanged"`
	Error     int `json:"error"`
}

// ImportSummary is returned by dry-run and commit.
type ImportSummary struct {
	Units                   ImportEntityCounts `json:"units"`
	Residents               ImportEntityCounts `json:"residents"`
	OpeningBalances         ImportEntityCounts `json:"opening_balances"`
	OpeningBalanceTotalKobo int64              `json:"opening_balance_total_kobo"`
	ControlTotalKobo        *int64             `json:"control_total_kobo,omitempty"`
	ControlTotalMatches     *bool              `json:"control_total_matches,omitempty"`
	Destination             map[string]int64   `json:"destination"`
}

// ImportBatch is the stored dry-run / commit record.
type ImportBatch struct {
	ID           string            `json:"id"`
	EstateID     string            `json:"estate_id"`
	SourceRef    string            `json:"source_ref,omitempty"`
	Status       string            `json:"status"`
	Summary      ImportSummary     `json:"summary"`
	Exceptions   []ImportException `json:"exceptions"`
	CommitResult *ImportSummary    `json:"commit_result,omitempty"`
	CreatedBy    string            `json:"created_by"`
	CreatedAt    time.Time         `json:"created_at"`
	CommittedAt  *time.Time        `json:"committed_at,omitempty"`
	Replayed     bool              `json:"replayed,omitempty"`
}

// ── validation (pure) ────────────────────────────────────────────────────────

const (
	legacyOther          = "other"
	occupancyOccupied    = "occupied"
	occupancyVacant      = "vacant"
	duesCategoryFacility = "facility"
	invoiceStatusPending = "pending"
	invoiceStatusOverdue = "overdue"
)

var (
	importPropertyTypes = PropertyTypes
	importOccupancy     = map[string]bool{occupancyVacant: true, occupancyOccupied: true, "reserved": true}
	importRelationships = map[string]bool{"occupant": true, "owner": true, "tenant": true}
	importDuesCategory  = map[string]bool{
		"service_charge": true, "security_levy": true, "waste": true, "water": true, "electricity": true,
		"rent": true, duesCategoryFacility: true, "penalty": true, legacyOther: true,
	}
)

type unitRow struct {
	idx int
	u   ImportUnit
}

type residentRow struct {
	idx        int
	r          ImportResident
	start, end *time.Time
}

type balanceRow struct {
	idx    int
	b      ImportOpeningBalance
	amount int64
	due    time.Time
}

type validated struct {
	units      []unitRow
	residents  []residentRow
	balances   []balanceRow
	exceptions []ImportException
	received   [3]int
}

func exc(entity string, idx int, ref, code, msg string) ImportException {
	return ImportException{Entity: entity, Row: idx, ExternalRef: ref, Code: code, Message: msg}
}

func decodeStrict(raw json.RawMessage, v any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	d.UseNumber()
	return d.Decode(v)
}

func parseImportDate(s string) (*time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return &t, nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil, fmt.Errorf("date %q must be YYYY-MM-DD or RFC3339", s)
	}
	return &t, nil
}

func unitKey(label, block string) string {
	return strings.ToLower(strings.TrimSpace(label)) + "\x00" + strings.ToLower(strings.TrimSpace(block))
}

// validateImport decodes and validates every row and dedupes within the
// batch. Rows with problems are reported and dropped; `now` decides whether a
// residency has already ended. Pure — no DB.
//
//nolint:gocognit,gocyclo // row-level import validation is one linear pass over the request
func validateImport(req ImportRequest, now time.Time) validated {
	var v validated
	v.received = [3]int{len(req.Units), len(req.Residents), len(req.OpeningBalances)}

	seenUnitRef, seenUnitKey := map[string]bool{}, map[string]bool{}
	for i, raw := range req.Units {
		var u ImportUnit
		if err := decodeStrict(raw, &u); err != nil {
			v.exceptions = append(v.exceptions, exc(importEntityUnit, i, "", "malformed_row", "row is not a valid unit object"))
			continue
		}
		u.ExternalRef, u.UnitLabel = strings.TrimSpace(u.ExternalRef), strings.TrimSpace(u.UnitLabel)
		u.Block, u.Floor = strings.TrimSpace(u.Block), strings.TrimSpace(u.Floor)
		if u.PropertyType == "" {
			u.PropertyType = "apartment"
		}
		if u.OccupancyStatus == "" {
			u.OccupancyStatus = occupancyVacant
		}
		switch {
		case u.ExternalRef == "" || len(u.ExternalRef) > 200:
			v.exceptions = append(v.exceptions, exc(importEntityUnit, i, u.ExternalRef, "missing_external_ref", "external_ref is required (1-200 chars)"))
		case u.UnitLabel == "" || len(u.UnitLabel) > 100:
			v.exceptions = append(v.exceptions, exc(importEntityUnit, i, u.ExternalRef, "invalid_unit_label", "unit_label is required (1-100 chars)"))
		case len(u.Block) > 50 || len(u.Floor) > 20:
			v.exceptions = append(v.exceptions, exc(importEntityUnit, i, u.ExternalRef, "field_too_long", "block max 50 chars, floor max 20 chars"))
		case !importPropertyTypes[u.PropertyType]:
			v.exceptions = append(v.exceptions, exc(importEntityUnit, i, u.ExternalRef, "invalid_property_type", "property_type must be apartment, house, commercial, land or other"))
		case !importOccupancy[u.OccupancyStatus]:
			v.exceptions = append(v.exceptions, exc(importEntityUnit, i, u.ExternalRef, "invalid_occupancy_status", "occupancy_status must be vacant, occupied or reserved"))
		case seenUnitRef[u.ExternalRef]:
			v.exceptions = append(v.exceptions, exc(importEntityUnit, i, u.ExternalRef, "duplicate_in_batch", "external_ref appears more than once in this batch"))
		case seenUnitKey[unitKey(u.UnitLabel, u.Block)]:
			v.exceptions = append(v.exceptions, exc(importEntityUnit, i, u.ExternalRef, "duplicate_unit_in_batch", "another row in this batch has the same unit_label + block"))
		default:
			seenUnitRef[u.ExternalRef], seenUnitKey[unitKey(u.UnitLabel, u.Block)] = true, true
			v.units = append(v.units, unitRow{idx: i, u: u})
		}
	}

	seenResRef, seenIdentity := map[string]bool{}, map[string]bool{}
	for i, raw := range req.Residents {
		var r ImportResident
		if err := decodeStrict(raw, &r); err != nil {
			v.exceptions = append(v.exceptions, exc(importEntityResident, i, "", "malformed_row", "row is not a valid resident object"))
			continue
		}
		r.ExternalRef = strings.TrimSpace(r.ExternalRef)
		r.Email, r.Phone = strings.ToLower(strings.TrimSpace(r.Email)), strings.TrimSpace(r.Phone)
		r.UnitRef = strings.TrimSpace(r.UnitRef)
		if r.Relationship == "" {
			r.Relationship = "occupant"
		}
		identity := "e:" + r.Email
		if r.Email == "" {
			identity = "p:" + r.Phone
		}
		start, serr := parseImportDate(r.ResidencyStart)
		end, eerr := parseImportDate(r.ResidencyEnd)
		switch {
		case r.ExternalRef == "" || len(r.ExternalRef) > 200:
			v.exceptions = append(v.exceptions, exc(importEntityResident, i, r.ExternalRef, "missing_external_ref", "external_ref is required (1-200 chars)"))
		case r.Email == "" && r.Phone == "":
			v.exceptions = append(v.exceptions, exc(importEntityResident, i, r.ExternalRef, "missing_identity", "email or phone is required to map the resident to a platform account"))
		case !importRelationships[r.Relationship]:
			v.exceptions = append(v.exceptions, exc(importEntityResident, i, r.ExternalRef, "invalid_relationship", "relationship must be occupant, owner or tenant"))
		case serr != nil || eerr != nil:
			v.exceptions = append(v.exceptions, exc(importEntityResident, i, r.ExternalRef, "invalid_date", "residency dates must be YYYY-MM-DD or RFC3339"))
		case start != nil && end != nil && end.Before(*start):
			v.exceptions = append(v.exceptions, exc(importEntityResident, i, r.ExternalRef, "invalid_residency_dates", "residency_end is before residency_start"))
		case end != nil && end.Before(now):
			v.exceptions = append(v.exceptions, exc(importEntityResident, i, r.ExternalRef, "historical_residency_out_of_scope", "residency has ended — historical residency import is not supported"))
		case seenResRef[r.ExternalRef]:
			v.exceptions = append(v.exceptions, exc(importEntityResident, i, r.ExternalRef, "duplicate_in_batch", "external_ref appears more than once in this batch"))
		case seenIdentity[identity]:
			v.exceptions = append(v.exceptions, exc(importEntityResident, i, r.ExternalRef, "duplicate_identity_in_batch", "another row in this batch has the same email/phone"))
		default:
			seenResRef[r.ExternalRef], seenIdentity[identity] = true, true
			v.residents = append(v.residents, residentRow{idx: i, r: r, start: start, end: end})
		}
	}

	seenBalRef := map[string]bool{}
	for i, raw := range req.OpeningBalances {
		var b ImportOpeningBalance
		if err := decodeStrict(raw, &b); err != nil {
			v.exceptions = append(v.exceptions, exc(importEntityBalance, i, "", "malformed_row", "row is not a valid opening balance object"))
			continue
		}
		b.ExternalRef, b.ResidentRef, b.UnitRef = strings.TrimSpace(b.ExternalRef), strings.TrimSpace(b.ResidentRef), strings.TrimSpace(b.UnitRef)
		if b.Category == "" {
			b.Category = legacyOther
		}
		amount, aerr := strconv.ParseInt(b.AmountKobo.String(), 10, 64)
		due, derr := parseImportDate(b.DueDate)
		switch {
		case b.ExternalRef == "" || len(b.ExternalRef) > 200:
			v.exceptions = append(v.exceptions, exc(importEntityBalance, i, b.ExternalRef, "missing_external_ref", "external_ref is required (1-200 chars)"))
		case b.ResidentRef == "":
			v.exceptions = append(v.exceptions, exc(importEntityBalance, i, b.ExternalRef, "missing_resident_ref", "resident_ref is required"))
		case aerr != nil:
			v.exceptions = append(v.exceptions, exc(importEntityBalance, i, b.ExternalRef, "invalid_amount", "amount_kobo must be an integer number of kobo"))
		case amount < 0:
			v.exceptions = append(v.exceptions, exc(importEntityBalance, i, b.ExternalRef, "credit_balance_unsupported", "credit (prepaid) balances need a ledger posting and are not importable — settle them manually"))
		case amount == 0:
			v.exceptions = append(v.exceptions, exc(importEntityBalance, i, b.ExternalRef, "zero_balance", "zero balance — nothing to import"))
		case !importDuesCategory[b.Category]:
			v.exceptions = append(v.exceptions, exc(importEntityBalance, i, b.ExternalRef, "invalid_category", "category is not a valid dues category"))
		case derr != nil || due == nil:
			v.exceptions = append(v.exceptions, exc(importEntityBalance, i, b.ExternalRef, "invalid_due_date", "due_date is required (YYYY-MM-DD or RFC3339)"))
		case seenBalRef[b.ExternalRef]:
			v.exceptions = append(v.exceptions, exc(importEntityBalance, i, b.ExternalRef, "duplicate_in_batch", "external_ref appears more than once in this batch"))
		default:
			seenBalRef[b.ExternalRef] = true
			v.balances = append(v.balances, balanceRow{idx: i, b: b, amount: amount, due: *due})
		}
	}
	return v
}

// rowHash fingerprints a normalised row so a re-import of an unchanged legacy
// record is a no-op (delta re-apply).
func rowHash(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		b = []byte(fmt.Sprintf("%#v", v))
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// ── planning (reads only) ────────────────────────────────────────────────────

type dbtx interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

type plannedUnit struct {
	row      unitRow
	action   string
	targetID string
	hash     string
}

type plannedResident struct {
	row       residentRow
	action    string
	targetID  string // estate_residents.id
	userID    string
	unitLabel string
	unitID    string
	hash      string
}

type plannedBalance struct {
	row      balanceRow
	action   string
	targetID string // estate_dues_invoices.id
	userID   string
	unitID   string
	hash     string
}

type importPlan struct {
	units      []plannedUnit
	residents  []plannedResident
	balances   []plannedBalance
	exceptions []ImportException
	summary    ImportSummary
}

func lookupRef(ctx context.Context, q dbtx, estateID, entity, ref string) (string, string, bool, error) {
	var target, hash string
	err := q.QueryRow(ctx, `SELECT target_id::TEXT, row_hash FROM estate_import_refs WHERE estate_id=$1 AND entity=$2 AND external_ref=$3`,
		estateID, entity, ref).Scan(&target, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", false, nil
	}
	return target, hash, err == nil, err
}

func resolveIdentity(ctx context.Context, q dbtx, email, phone string) (string, string, error) {
	sql, arg := `SELECT id::TEXT AS id FROM auth.users WHERE lower(email)=$1 LIMIT 2`, email
	if email == "" {
		sql, arg = `SELECT id::TEXT AS id FROM user_profiles WHERE phone=$1 AND phone<>'' LIMIT 2`, phone
	}
	var n int
	var id *string
	if err := q.QueryRow(ctx, `SELECT count(*), min(id) FROM (`+sql+`) t`, arg).Scan(&n, &id); err != nil {
		return "", "", err
	}
	switch {
	case n == 0:
		return "", "identity_not_found", nil
	case n > 1:
		return "", "identity_ambiguous", nil
	}
	return *id, "", nil
}

// planImport plans every validated row against the live estate. q may be the
// pool (dry-run) or the commit transaction. Insert targets get fresh ids here
// so later rows (residents → units, balances → residents) can reference them.
//
//nolint:gocognit,gocyclo // per-entity decision table; splitting it scatters one audit-visible plan
func planImport(ctx context.Context, q dbtx, estateID string, v validated, control *int64) (*importPlan, error) {
	p := &importPlan{exceptions: append([]ImportException(nil), v.exceptions...)}
	p.summary.Units.Received, p.summary.Residents.Received, p.summary.OpeningBalances.Received = v.received[0], v.received[1], v.received[2]
	fail := func(entity string, idx int, ref, code, msg string) {
		p.exceptions = append(p.exceptions, exc(entity, idx, ref, code, msg))
	}

	type unitInfo struct{ id, label string }
	units := map[string]unitInfo{} // external ref → planned/mapped unit
	for _, ur := range v.units {
		u := ur.u
		pu := plannedUnit{row: ur, hash: rowHash(u)}
		target, hash, mapped, err := lookupRef(ctx, q, estateID, importEntityUnit, u.ExternalRef)
		if err != nil {
			return nil, fmt.Errorf("estate: import lookup unit ref: %w", err)
		}
		// Native (or other-ref) active unit with the same natural key.
		var nativeID string
		err = q.QueryRow(ctx, `SELECT id::TEXT FROM estate_properties
			WHERE estate_id=$1 AND lower(unit_label)=lower($2) AND lower(COALESCE(block,''))=lower($3) AND archived=FALSE LIMIT 1`,
			estateID, u.UnitLabel, u.Block).Scan(&nativeID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("estate: import natural-key lookup: %w", err)
		}
		switch {
		case mapped:
			var exists bool
			if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM estate_properties WHERE id=$1 AND estate_id=$2 AND archived=FALSE)`, target, estateID).Scan(&exists); err != nil {
				return nil, err
			}
			if !exists {
				fail(importEntityUnit, ur.idx, u.ExternalRef, "mapped_target_missing", "the unit this ref was imported to has been archived or removed")
				continue
			}
			pu.targetID = target
			switch {
			case hash == pu.hash:
				pu.action = importUnchanged
			case nativeID != "" && nativeID != target:
				fail(importEntityUnit, ur.idx, u.ExternalRef, "unit_key_conflict", "another unit already uses this unit_label + block")
				continue
			default:
				pu.action = importUpdate
			}
		case nativeID != "":
			// Dedupe: adopt the existing unit, never create a duplicate. Fields
			// are not overwritten — the native record is the latest authorised state.
			pu.action, pu.targetID = importLink, nativeID
		default:
			pu.action, pu.targetID = importInsert, uuid.New().String()
		}
		units[u.ExternalRef] = unitInfo{id: pu.targetID, label: u.UnitLabel}
		p.units = append(p.units, pu)
	}
	unitByRef := func(ref string) (unitInfo, bool, error) {
		if ref == "" {
			return unitInfo{}, true, nil
		}
		if ui, ok := units[ref]; ok {
			return ui, true, nil
		}
		target, _, mapped, err := lookupRef(ctx, q, estateID, importEntityUnit, ref)
		if err != nil || !mapped {
			return unitInfo{}, false, err
		}
		var label string
		if err := q.QueryRow(ctx, `SELECT unit_label FROM estate_properties WHERE id=$1 AND archived=FALSE`, target).Scan(&label); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return unitInfo{}, false, nil
			}
			return unitInfo{}, false, err
		}
		return unitInfo{id: target, label: label}, true, nil
	}

	residents := map[string]string{} // external ref → user id
	seenUser := map[string]bool{}
	for _, rr := range v.residents {
		r := rr.r
		pr := plannedResident{row: rr, hash: rowHash(r)}
		ui, ok, err := unitByRef(r.UnitRef)
		if err != nil {
			return nil, fmt.Errorf("estate: import resolve unit_ref: %w", err)
		}
		if !ok {
			fail(importEntityResident, rr.idx, r.ExternalRef, "unit_ref_unknown", "unit_ref matches no valid unit in this batch or a previous import")
			continue
		}
		pr.unitID, pr.unitLabel = ui.id, ui.label
		userID, code, err := resolveIdentity(ctx, q, r.Email, r.Phone)
		if err != nil {
			return nil, fmt.Errorf("estate: import resolve identity: %w", err)
		}
		if code != "" {
			msg := "no platform account matches this email/phone — invite the resident to sign up, then re-import"
			if code == "identity_ambiguous" {
				msg = "more than one platform account matches this phone — supply an email"
			}
			fail(importEntityResident, rr.idx, r.ExternalRef, code, msg)
			continue
		}
		if seenUser[userID] {
			fail(importEntityResident, rr.idx, r.ExternalRef, "duplicate_identity_in_batch", "another row in this batch maps to the same platform account")
			continue
		}
		pr.userID = userID
		target, hash, mapped, err := lookupRef(ctx, q, estateID, importEntityResident, r.ExternalRef)
		if err != nil {
			return nil, fmt.Errorf("estate: import lookup resident ref: %w", err)
		}
		var memberID string
		var banned, deleted bool
		err = q.QueryRow(ctx, `SELECT id::TEXT, banned_at IS NOT NULL, deleted_at IS NOT NULL FROM estate_residents WHERE estate_id=$1 AND user_id=$2`,
			estateID, userID).Scan(&memberID, &banned, &deleted)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("estate: import membership lookup: %w", err)
		}
		switch {
		case memberID != "" && (banned || deleted):
			fail(importEntityResident, rr.idx, r.ExternalRef, "membership_banned_or_deleted", "this account's membership is banned or deleted — resolve it before importing")
			continue
		case mapped && memberID == "":
			fail(importEntityResident, rr.idx, r.ExternalRef, "mapped_target_missing", "the membership this ref was imported to no longer exists")
			continue
		case mapped && memberID != target:
			fail(importEntityResident, rr.idx, r.ExternalRef, "identity_changed", "this ref was previously imported for a different platform account")
			continue
		case mapped:
			pr.targetID = target
			if hash == pr.hash {
				pr.action = importUnchanged
			} else {
				pr.action = importUpdate
			}
		case memberID != "":
			pr.action, pr.targetID = importLink, memberID
		default:
			pr.action, pr.targetID = importInsert, uuid.New().String()
		}
		seenUser[userID] = true
		residents[r.ExternalRef] = userID
		p.residents = append(p.residents, pr)
	}

	var total int64
	for _, br := range v.balances {
		b := br.b
		pb := plannedBalance{row: br, hash: rowHash(struct {
			B ImportOpeningBalance
			A int64
		}{b, br.amount})}
		userID, ok := residents[b.ResidentRef]
		if !ok {
			target, _, mapped, err := lookupRef(ctx, q, estateID, importEntityResident, b.ResidentRef)
			if err != nil {
				return nil, fmt.Errorf("estate: import lookup resident ref: %w", err)
			}
			if mapped {
				if err := q.QueryRow(ctx, `SELECT user_id::TEXT FROM estate_residents WHERE id=$1 AND deleted_at IS NULL`, target).Scan(&userID); err == nil {
					ok = true
				} else if !errors.Is(err, pgx.ErrNoRows) {
					return nil, err
				}
			}
		}
		if !ok {
			fail(importEntityBalance, br.idx, b.ExternalRef, "resident_ref_unknown", "resident_ref matches no valid resident in this batch or a previous import")
			continue
		}
		ui, uok, err := unitByRef(b.UnitRef)
		if err != nil {
			return nil, fmt.Errorf("estate: import resolve unit_ref: %w", err)
		}
		if !uok {
			fail(importEntityBalance, br.idx, b.ExternalRef, "unit_ref_unknown", "unit_ref matches no valid unit in this batch or a previous import")
			continue
		}
		pb.userID, pb.unitID = userID, ui.id
		target, hash, mapped, err := lookupRef(ctx, q, estateID, importEntityBalance, b.ExternalRef)
		if err != nil {
			return nil, fmt.Errorf("estate: import lookup balance ref: %w", err)
		}
		switch {
		case mapped && hash == pb.hash:
			pb.action, pb.targetID = importUnchanged, target
		case mapped:
			var status string
			var paid bool
			err := q.QueryRow(ctx, `SELECT status, EXISTS(SELECT 1 FROM estate_payments WHERE invoice_id=$1) FROM estate_dues_invoices WHERE id=$1`, target).Scan(&status, &paid)
			if errors.Is(err, pgx.ErrNoRows) {
				fail(importEntityBalance, br.idx, b.ExternalRef, "mapped_target_missing", "the invoice this ref was imported to no longer exists")
				continue
			}
			if err != nil {
				return nil, err
			}
			if paid || (status != invoiceStatusPending && status != invoiceStatusOverdue) {
				fail(importEntityBalance, br.idx, b.ExternalRef, "invoice_already_settled", "the imported invoice has payments or is settled/waived — the change must be made as a correction, not a re-import")
				continue
			}
			pb.action, pb.targetID = importUpdate, target
		default:
			pb.action, pb.targetID = importInsert, uuid.New().String()
		}
		total += br.amount
		p.balances = append(p.balances, pb)
	}

	count := func(c *ImportEntityCounts, action string) {
		switch action {
		case importInsert:
			c.Insert++
		case importUpdate:
			c.Update++
		case importLink:
			c.Link++
		case importUnchanged:
			c.Unchanged++
		}
	}
	for _, u := range p.units {
		count(&p.summary.Units, u.action)
	}
	for _, r := range p.residents {
		count(&p.summary.Residents, r.action)
	}
	for _, b := range p.balances {
		count(&p.summary.OpeningBalances, b.action)
	}
	for _, e := range p.exceptions {
		switch e.Entity {
		case importEntityUnit:
			p.summary.Units.Error++
		case importEntityResident:
			p.summary.Residents.Error++
		case importEntityBalance:
			p.summary.OpeningBalances.Error++
		}
	}
	p.summary.OpeningBalanceTotalKobo = total
	if control != nil {
		ok := *control == total
		p.summary.ControlTotalKobo, p.summary.ControlTotalMatches = control, &ok
		if !ok {
			p.exceptions = append(p.exceptions, exc(importEntityBalance, -1, "", "control_total_mismatch",
				fmt.Sprintf("control total %d kobo ≠ importable opening balances %d kobo", *control, total)))
		}
	}
	dest, err := destinationCounts(ctx, q, estateID)
	if err != nil {
		return nil, err
	}
	p.summary.Destination = dest
	return p, nil
}

// destinationCounts are the estate-side aggregates an operator compares with
// the legacy source (EST-UAT-0440).
func destinationCounts(ctx context.Context, q dbtx, estateID string) (map[string]int64, error) {
	var units, residents, openInv, openKobo, imported int64
	err := q.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM estate_properties WHERE estate_id=$1 AND archived=FALSE),
		(SELECT count(*) FROM estate_residents WHERE estate_id=$1 AND deleted_at IS NULL),
		(SELECT count(*) FROM estate_dues_invoices WHERE estate_id=$1 AND status IN ('pending','overdue')),
		(SELECT COALESCE(sum(amount_kobo),0)::BIGINT FROM estate_dues_invoices WHERE estate_id=$1 AND status IN ('pending','overdue')),
		(SELECT count(*) FROM estate_import_refs WHERE estate_id=$1)`, estateID).
		Scan(&units, &residents, &openInv, &openKobo, &imported)
	if err != nil {
		return nil, fmt.Errorf("estate: import destination counts: %w", err)
	}
	return map[string]int64{
		"units": units, "residents": residents, "open_invoices": openInv,
		"open_invoice_total_kobo": openKobo, "imported_refs": imported,
	}, nil
}

// ── apply (commit transaction only) ──────────────────────────────────────────

func upsertRef(ctx context.Context, tx dbtx, estateID, entity, ref, target, hash, batchID string) error {
	_, err := tx.Exec(ctx, `INSERT INTO estate_import_refs (estate_id, entity, external_ref, target_id, row_hash, last_batch_id)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (estate_id, entity, external_ref) DO UPDATE
		SET target_id=EXCLUDED.target_id, row_hash=EXCLUDED.row_hash, last_batch_id=EXCLUDED.last_batch_id, updated_at=NOW()`,
		estateID, entity, ref, target, hash, batchID)
	return err
}

//nolint:gocognit // apply mirrors the plan's entity order inside one transaction
func applyImport(ctx context.Context, tx dbtx, estateID, batchID string, p *importPlan) error {
	for _, pu := range p.units {
		u := pu.row.u
		var err error
		switch pu.action {
		case importInsert:
			_, err = tx.Exec(ctx, `INSERT INTO estate_properties (id, estate_id, unit_label, property_type, floor, block, occupancy_status)
				VALUES ($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),$7)`, pu.targetID, estateID, u.UnitLabel, u.PropertyType, u.Floor, u.Block, u.OccupancyStatus)
		case importUpdate:
			_, err = tx.Exec(ctx, `UPDATE estate_properties SET unit_label=$2, property_type=$3, floor=NULLIF($4,''), block=NULLIF($5,''), occupancy_status=$6
				WHERE id=$1`, pu.targetID, u.UnitLabel, u.PropertyType, u.Floor, u.Block, u.OccupancyStatus)
		}
		if err != nil {
			return fmt.Errorf("estate: import unit %q: %w", u.ExternalRef, err)
		}
		if pu.action != importUnchanged {
			if err := upsertRef(ctx, tx, estateID, importEntityUnit, u.ExternalRef, pu.targetID, pu.hash, batchID); err != nil {
				return err
			}
		}
	}
	for _, pr := range p.residents {
		r := pr.row.r
		var err error
		switch pr.action {
		case importInsert:
			_, err = tx.Exec(ctx, `INSERT INTO estate_residents (id, estate_id, user_id, unit, role, residency_start, residency_end)
				VALUES ($1,$2,$3,$4,'resident',$5,$6)`, pr.targetID, estateID, pr.userID, pr.unitLabel, pr.row.start, pr.row.end)
		case importUpdate:
			_, err = tx.Exec(ctx, `UPDATE estate_residents SET unit=$2, residency_start=$3, residency_end=$4 WHERE id=$1`,
				pr.targetID, pr.unitLabel, pr.row.start, pr.row.end)
		case importLink:
			// Fill blanks only — never overwrite what the member/admin set natively.
			_, err = tx.Exec(ctx, `UPDATE estate_residents SET
				unit = CASE WHEN unit='' THEN $2 ELSE unit END,
				residency_start = COALESCE(residency_start, $3),
				residency_end   = COALESCE(residency_end, $4)
				WHERE id=$1`, pr.targetID, pr.unitLabel, pr.row.start, pr.row.end)
		}
		if err != nil {
			return fmt.Errorf("estate: import resident %q: %w", r.ExternalRef, err)
		}
		if pr.action != importUnchanged && pr.unitID != "" {
			if err := applyOccupancy(ctx, tx, pr.unitID, pr.userID, r.Relationship, pr.action == importLink); err != nil {
				return fmt.Errorf("estate: import occupancy %q: %w", r.ExternalRef, err)
			}
		}
		if pr.action != importUnchanged {
			if err := upsertRef(ctx, tx, estateID, importEntityResident, r.ExternalRef, pr.targetID, pr.hash, batchID); err != nil {
				return err
			}
		}
	}
	for _, pb := range p.balances {
		b := pb.row.b
		var err error
		switch pb.action {
		case importInsert:
			// The two occupancy exemptions (EST-UAT-0048 vacant unit, EST-UAT-0045 out-of-term resident)
			// refuse a NEW charge against a unit that is empty or whose billed person is not in residence
			// today. A legacy estate carries both constantly: arrears that survived a move-out, balances
			// for units it has already re-let. Refusing those would drop receivables the source still says
			// are owed, so an import commit is recorded as the explicit override the rules ask for, with
			// the batch named as the reason and the batch row as the audit trail.
			overrideReason := "opening balance carried over by import batch " + batchID
			_, err = tx.Exec(ctx, `INSERT INTO estate_dues_invoices (id, estate_id, property_id, resident_id, category, amount_kobo, due_date, status,
			                                        vacancy_override, vacancy_override_reason, term_override, term_override_reason)
				VALUES ($1,$2,NULLIF($3,'')::UUID,$4,$5,$6,$7,'pending',TRUE,$8,TRUE,$8)`,
				pb.targetID, estateID, pb.unitID, pb.userID, b.Category, pb.row.amount, pb.row.due, overrideReason)
		case importUpdate:
			_, err = tx.Exec(ctx, `UPDATE estate_dues_invoices SET property_id=NULLIF($2,'')::UUID, resident_id=$3, category=$4, amount_kobo=$5, due_date=$6
				WHERE id=$1 AND status IN ('pending','overdue')`, pb.targetID, pb.unitID, pb.userID, b.Category, pb.row.amount, pb.row.due)
		}
		if err != nil {
			return fmt.Errorf("estate: import opening balance %q: %w", b.ExternalRef, err)
		}
		if pb.action != importUnchanged {
			if err := upsertRef(ctx, tx, estateID, importEntityBalance, b.ExternalRef, pb.targetID, pb.hash, batchID); err != nil {
				return err
			}
		}
	}
	return nil
}

// applyOccupancy records owner/tenant/occupant on the unit. fillOnly keeps an
// existing native assignment intact.
//
// Deliberate limit (estate-a M03): this writes the unit's party columns directly instead of calling
// estate_occupancy_admit(). The admitting writer demands an estate_admin actor and enforces the unit's
// capacity, and an import is run by a platform operator on behalf of an estate whose legacy roll may
// already be over a capacity nobody configured — so honouring the source is the job here, and refusing
// rows would lose them. The consequence is that a legacy import does NOT create occupancy registrations:
// until those estates are re-admitted through the occupancy surface, the capacity count and the
// "who is in this unit" register see only what the app recorded natively. Recorded as a defect rather
// than silently accepted.
func applyOccupancy(ctx context.Context, tx dbtx, unitID, userID, relationship string, fillOnly bool) error {
	var q string
	switch relationship {
	case "owner":
		q = `UPDATE estate_properties SET landlord_id=$2 WHERE id=$1`
		if fillOnly {
			q += ` AND landlord_id IS NULL`
		}
	case "tenant":
		q = `UPDATE estate_properties SET tenant_id=$2, occupancy_status='occupied' WHERE id=$1`
		if fillOnly {
			q += ` AND tenant_id IS NULL`
		}
	default:
		_, err := tx.Exec(ctx, `UPDATE estate_properties SET occupancy_status='occupied' WHERE id=$1 AND occupancy_status='vacant'`, unitID)
		return err
	}
	_, err := tx.Exec(ctx, q, unitID, userID)
	return err
}

// ── service entry points ─────────────────────────────────────────────────────

func assertImportable(status string) error {
	if status == EstateStatusPending || status == EstateStatusActive {
		return nil
	}
	return fmt.Errorf("%w (estate is %s)", ErrImportEstateNotImportable, status)
}

// DryRunImport validates + plans an import and stores it as a dry-run batch.
// Nothing is written to estate tables. Authorisation is the caller's job
// (platform RBAC estate.admin.import or estate_admin membership — see
// Handler.authorizeImport).
func (s *Service) DryRunImport(ctx context.Context, estateID, actorID string, req ImportRequest) (*ImportBatch, error) {
	n := len(req.Units) + len(req.Residents) + len(req.OpeningBalances)
	if n == 0 {
		return nil, ErrImportEmpty
	}
	if n > maxImportRows {
		return nil, ErrImportTooLarge
	}
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM estates WHERE id=$1`, estateID).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrEstateNotFound
		}
		return nil, err
	}
	if err := assertImportable(status); err != nil {
		return nil, err
	}
	plan, err := planImport(ctx, s.db, estateID, validateImport(req, time.Now()), req.ControlTotalKobo)
	if err != nil {
		return nil, err
	}
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("estate: import marshal payload: %w", err)
	}
	summary, err := json.Marshal(plan.summary)
	if err != nil {
		return nil, fmt.Errorf("estate: marshal import summary: %w", err)
	}
	exceptions, err := json.Marshal(nonNilExceptions(plan.exceptions))
	if err != nil {
		return nil, fmt.Errorf("estate: marshal import exceptions: %w", err)
	}
	b := &ImportBatch{ID: uuid.New().String(), EstateID: estateID, SourceRef: strings.TrimSpace(req.SourceRef), Status: "dry_run",
		Summary: plan.summary, Exceptions: nonNilExceptions(plan.exceptions), CreatedBy: actorID}
	if err := s.db.QueryRow(ctx, `INSERT INTO estate_import_batches (id, estate_id, source_ref, status, payload, summary, exceptions, created_by)
		VALUES ($1,$2,NULLIF($3,''),'dry_run',$4,$5,$6,$7) RETURNING created_at`,
		b.ID, estateID, b.SourceRef, payload, summary, exceptions, actorID).Scan(&b.CreatedAt); err != nil {
		return nil, fmt.Errorf("estate: insert import batch: %w", err)
	}
	_ = s.audit(ctx, estateID, actorID, "estate.import.dry_run", "estate_import_batch", b.ID, map[string]any{
		"summary": plan.summary, "exceptions": len(plan.exceptions), "source_ref": b.SourceRef,
	})
	return b, nil
}

func nonNilExceptions(e []ImportException) []ImportException {
	if e == nil {
		return []ImportException{}
	}
	return e
}

// GetImportBatch returns a stored batch (with its exception report).
func (s *Service) GetImportBatch(ctx context.Context, estateID, batchID string) (*ImportBatch, error) {
	b := &ImportBatch{}
	var summary, exceptions, result []byte
	var source *string
	err := s.db.QueryRow(ctx, `SELECT id::TEXT, estate_id::TEXT, source_ref, status, summary, exceptions, commit_result, created_by::TEXT, created_at, committed_at
		FROM estate_import_batches WHERE id=$1 AND estate_id=$2`, batchID, estateID).
		Scan(&b.ID, &b.EstateID, &source, &b.Status, &summary, &exceptions, &result, &b.CreatedBy, &b.CreatedAt, &b.CommittedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrImportBatchNotFound
	}
	if err != nil {
		return nil, err
	}
	if source != nil {
		b.SourceRef = *source
	}
	_ = json.Unmarshal(summary, &b.Summary)
	_ = json.Unmarshal(exceptions, &b.Exceptions)
	b.Exceptions = nonNilExceptions(b.Exceptions)
	if len(result) > 0 {
		b.CommitResult = &ImportSummary{}
		_ = json.Unmarshal(result, b.CommitResult)
	}
	return b, nil
}

// CommitImport applies a dry-run batch. The Idempotency-Key makes a retried
// commit return the stored result; a batch commits at most once. The payload
// is re-planned inside the transaction under an estate row lock, so rows that
// changed since the dry-run are planned against the live state.
func (s *Service) CommitImport(ctx context.Context, estateID, batchID, actorID, idemKey string) (*ImportBatch, error) {
	if strings.TrimSpace(idemKey) == "" {
		return nil, ErrIdempotencyRequired
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("estate: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var status string
	if err := tx.QueryRow(ctx, `SELECT status FROM estates WHERE id=$1 FOR UPDATE`, estateID).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrEstateNotFound
		}
		return nil, err
	}
	var batchStatus string
	var storedKey *string
	var payload []byte
	err = tx.QueryRow(ctx, `SELECT status, commit_idempotency_key, payload FROM estate_import_batches WHERE id=$1 AND estate_id=$2 FOR UPDATE`,
		batchID, estateID).Scan(&batchStatus, &storedKey, &payload)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrImportBatchNotFound
	}
	if err != nil {
		return nil, err
	}
	if batchStatus == "committed" {
		_ = tx.Rollback(ctx)
		if storedKey != nil && *storedKey == idemKey {
			b, err := s.GetImportBatch(ctx, estateID, batchID)
			if b != nil {
				b.Replayed = true
			}
			return b, err
		}
		return nil, ErrImportAlreadyCommitted
	}
	if err := assertImportable(status); err != nil {
		return nil, err
	}
	var req ImportRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, fmt.Errorf("estate: import decode payload: %w", err)
	}
	plan, err := planImport(ctx, tx, estateID, validateImport(req, time.Now()), req.ControlTotalKobo)
	if err != nil {
		return nil, err
	}
	if plan.summary.ControlTotalMatches != nil && !*plan.summary.ControlTotalMatches {
		return nil, ErrImportControlTotal
	}
	if err := applyImport(ctx, tx, estateID, batchID, plan); err != nil {
		return nil, err
	}
	after, err := destinationCounts(ctx, tx, estateID)
	if err != nil {
		return nil, err
	}
	plan.summary.Destination = after
	result, err := json.Marshal(plan.summary)
	if err != nil {
		return nil, fmt.Errorf("estate: marshal commit result: %w", err)
	}
	exceptions, err := json.Marshal(nonNilExceptions(plan.exceptions))
	if err != nil {
		return nil, fmt.Errorf("estate: marshal import exceptions: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE estate_import_batches SET status='committed', commit_result=$2, exceptions=$3,
		commit_idempotency_key=$4, committed_by=$5, committed_at=NOW() WHERE id=$1`,
		batchID, result, exceptions, idemKey, actorID); err != nil {
		return nil, fmt.Errorf("estate: mark import committed: %w", err)
	}
	if err := s.auditTx(ctx, tx, estateID, actorID, "estate.import.committed", "estate_import_batch", batchID, map[string]any{
		"summary": plan.summary, "exceptions": len(plan.exceptions),
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("estate: commit import: %w", err)
	}
	return s.GetImportBatch(ctx, estateID, batchID)
}
