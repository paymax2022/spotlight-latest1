package healthlab

import (
	"context"
	"errors"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Home-collection field work: a phlebotomist's route, bedside checklist, tube
// scan (chain of custody) and drop-off at the lab — all persisted. HL-2 gates
// every action to ACTIVE phlebotomist staff of the order's lab (or the lab owner);
// a foreign actor gets the uniform ErrOrderNotFound, never a state oracle.

var (
	ErrBarcodeInUse        = errors.New("lab: that barcode is already on another sample")
	ErrBadBarcode          = errors.New("lab: barcode must be 6-32 letters, digits or dashes")
	ErrChecklistIncomplete = errors.New("lab: complete every required checklist step before logging the sample")
	ErrNoPhlebotomist      = errors.New("lab: no phlebotomist has been assigned to this order yet")
	ErrBadCollectionInput  = errors.New("lab: invalid collection details")
	ErrBadCollectionStatus = errors.New("lab: status must be en_route or arrived")
)

var barcodePattern = regexp.MustCompile(`^[A-Z0-9][A-Z0-9-]{5,31}$`)

// validateCollectionDetails checks (and normalises) the home-collection fields
// before any money moves. WALK_IN ignores them entirely.
func validateCollectionDetails(in *CreateOrderInput) error {
	if in.CollectionMethod != CollectHome {
		in.CollectionAddress, in.CollectionLat, in.CollectionLng, in.ScheduledFor = "", nil, nil, nil
		return nil
	}
	in.CollectionAddress = strings.TrimSpace(in.CollectionAddress)
	if in.CollectionAddress == "" || len([]rune(in.CollectionAddress)) > 300 {
		return fmt.Errorf("%w: a home collection needs an address (up to 300 characters)", ErrBadCollectionInput)
	}
	if (in.CollectionLat == nil) != (in.CollectionLng == nil) {
		return fmt.Errorf("%w: lat and lng must be supplied together", ErrBadCollectionInput)
	}
	if in.CollectionLat != nil && (*in.CollectionLat < -90 || *in.CollectionLat > 90 || *in.CollectionLng < -180 || *in.CollectionLng > 180) {
		return fmt.Errorf("%w: coordinates out of range", ErrBadCollectionInput)
	}
	if in.ScheduledFor != nil {
		now := time.Now()
		if in.ScheduledFor.Before(now.Add(-10*time.Minute)) || in.ScheduledFor.After(now.Add(90*24*time.Hour)) {
			return fmt.Errorf("%w: choose a time within the next 90 days", ErrBadCollectionInput)
		}
	}
	return nil
}

// ChecklistItem is one bedside step. The template is server-owned so the app and
// the evidence trail can never disagree about what "complete" means.
type ChecklistItem struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Required bool   `json:"required"`
	Done     bool   `json:"done"`
}

func checklistTemplate(fasting bool) []ChecklistItem {
	items := []ChecklistItem{{ID: "identity", Label: "Verify patient identity (name and date of birth)", Required: true}}
	if fasting {
		items = append(items, ChecklistItem{ID: "fasting", Label: "Confirm the fasting / preparation requirements were met", Required: true})
	}
	return append(items,
		ChecklistItem{ID: "hygiene", Label: "Sanitise hands and put on gloves", Required: true},
		ChecklistItem{ID: "tubes", Label: "Draw the correct tubes for the ordered tests", Required: true},
		ChecklistItem{ID: "label", Label: "Label the tubes and affix the barcode at the patient's side", Required: true},
		ChecklistItem{ID: "comfort", Label: "Confirm the patient is comfortable and apply a dressing", Required: false},
	)
}

// Assignment is one home-collection stop on a phlebotomist's route.
type Assignment struct {
	OrderID      string     `json:"order_id"`
	PatientName  string     `json:"patient_name"`
	Address      string     `json:"address"`
	Lat          *float64   `json:"lat,omitempty"`
	Lng          *float64   `json:"lng,omitempty"`
	ScheduledFor *time.Time `json:"scheduled_for,omitempty"`
	TestSummary  string     `json:"test_summary"`
	SampleType   string     `json:"sample_type"`
	Status       string     `json:"status"` // assigned | en_route | arrived | collected | dropped_off
	DistanceM    *float64   `json:"distance_m,omitempty"`
}

func haversineM(lat1, lng1, lat2, lng2 float64) float64 {
	const r = 6371000.0
	rad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat, dLng := rad(lat2-lat1), rad(lng2-lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(rad(lat1))*math.Cos(rad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * r * math.Asin(math.Sqrt(a))
}

func sampleTypeFor(specimens []string) string {
	for _, sp := range specimens {
		switch strings.ToLower(strings.TrimSpace(sp)) {
		case "blood", "urine", "stool", "swab", "saliva":
			return strings.ToLower(strings.TrimSpace(sp))
		}
	}
	return "blood"
}

func assignmentStatus(sampleState, collectionStatus string) string {
	switch SampleState(sampleState) {
	case SampleHandedOver, SampleAccessioned:
		return "dropped_off"
	case SampleCollected, SampleInCustody, SampleBreached, SampleRecollectRequired:
		return "collected"
	}
	switch collectionStatus {
	case "EN_ROUTE":
		return "en_route"
	case "ARRIVED":
		return "arrived"
	}
	return "assigned"
}

// isLabPhlebotomist: the lab owner, or an ACTIVE 'phlebotomist' affiliation.
func (s *Service) isLabPhlebotomist(ctx context.Context, actorID, providerID string) (bool, error) {
	return s.isLabAffiliated(ctx, actorID, providerID, labRolePhlebotomist)
}

// fieldOrder loads an order the caller may work as a phlebotomist: they are the
// assignee, or it is unassigned and they are active phlebotomist staff of its lab.
func (s *Service) fieldOrder(ctx context.Context, userID, orderID string) (*Order, *string, error) {
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, nil, err
	}
	var assignee *string
	if err := s.db.QueryRow(ctx, `SELECT assigned_phlebotomist_id::text FROM lab_orders WHERE id = $1`, orderID).Scan(&assignee); err != nil {
		return nil, nil, err
	}
	ok, err := s.isLabPhlebotomist(ctx, userID, o.LabProviderID)
	if err != nil {
		return nil, nil, err
	}
	if !ok || (assignee != nil && *assignee != userID) {
		return nil, nil, ErrOrderNotFound
	}
	return o, assignee, nil
}

// ListAssignments is the caller's route: home collections assigned to them, plus
// the unassigned pool of labs they staff. lat/lng (optional) add distances.
func (s *Service) ListAssignments(ctx context.Context, userID string, lat, lng *float64) ([]Assignment, error) {
	rows, err := s.db.Query(ctx, `
		SELECT o.id, COALESCE(o.collection_status,''), o.collection_address, o.collection_lat, o.collection_lng,
		       o.scheduled_for, COALESCE(sm.state,''),
		       COALESCE(NULLIF(btrim(up.full_name),''), NULLIF(btrim(up.display_name),''), '')
		FROM lab_orders o
		LEFT JOIN lab_samples sm ON sm.order_id = o.id
		LEFT JOIN user_profiles up ON up.id = o.patient_id
		WHERE o.collection_method = 'HOME'
		  AND o.state IN ('SCHEDULED','SAMPLE_COLLECTED','IN_TRANSIT','ACCESSIONED')
		  AND (o.state <> 'ACCESSIONED' OR o.updated_at > now() - interval '24 hours')
		  AND (o.assigned_phlebotomist_id = $1
		       OR (o.assigned_phlebotomist_id IS NULL AND EXISTS (
		             SELECT 1 FROM lab_staff ls
		             WHERE ls.lab_provider_id = o.lab_provider_id AND ls.user_id = $1
		               AND ls.status = 'ACTIVE' AND ls.role = 'phlebotomist')))
		ORDER BY COALESCE(o.scheduled_for, o.created_at) ASC LIMIT 100`, userID)
	if err != nil {
		return nil, err
	}
	type row struct {
		a                 Assignment
		collStatus, state string
		full              string
	}
	var raw []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.a.OrderID, &r.collStatus, &r.a.Address, &r.a.Lat, &r.a.Lng, &r.a.ScheduledFor, &r.state, &r.full); err != nil {
			rows.Close()
			return nil, err
		}
		raw = append(raw, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]Assignment, 0, len(raw))
	for _, r := range raw {
		a := r.a
		a.PatientName = shortAuthor(r.full)
		a.Status = assignmentStatus(r.state, r.collStatus)
		lines, err := s.db.Query(ctx, `
			SELECT l.test_name, COALESCE(t.specimen,'')
			FROM lab_order_lines l LEFT JOIN lab_tests t ON t.id = l.test_id
			WHERE l.order_id = $1 ORDER BY l.test_name`, a.OrderID)
		if err != nil {
			return nil, err
		}
		var names, specimens []string
		for lines.Next() {
			var n, sp string
			if err := lines.Scan(&n, &sp); err != nil {
				lines.Close()
				return nil, err
			}
			names, specimens = append(names, n), append(specimens, sp)
		}
		lines.Close()
		switch len(names) {
		case 0:
		case 1:
			a.TestSummary = names[0]
		default:
			a.TestSummary = fmt.Sprintf("%s (+%d more)", names[0], len(names)-1)
		}
		a.SampleType = sampleTypeFor(specimens)
		if lat != nil && lng != nil && a.Lat != nil && a.Lng != nil {
			d := haversineM(*lat, *lng, *a.Lat, *a.Lng)
			a.DistanceM = &d
		}
		out = append(out, a)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].DistanceM != nil && out[j].DistanceM != nil && out[i].Status == out[j].Status {
			return *out[i].DistanceM < *out[j].DistanceM
		}
		return false
	})
	return out, nil
}

// SetCollectionStatus lets a phlebotomist mark themselves en route / arrived. The
// first such action claims an unassigned order for them; the optional position is
// remembered so the patient can follow the visit.
func (s *Service) SetCollectionStatus(ctx context.Context, userID, orderID, status string, lat, lng *float64) error {
	var col string
	switch strings.ToLower(status) {
	case "en_route":
		col = "EN_ROUTE"
	case "arrived":
		col = "ARRIVED"
	default:
		return ErrBadCollectionStatus
	}
	if (lat == nil) != (lng == nil) || (lat != nil && (*lat < -90 || *lat > 90 || *lng < -180 || *lng > 180)) {
		return ErrBadCollectionInput
	}
	o, _, err := s.fieldOrder(ctx, userID, orderID)
	if err != nil {
		return err
	}
	if o.State != StateScheduled {
		return fmt.Errorf("lab: order is %s — the visit can only be updated while it is SCHEDULED", o.State)
	}
	ct, err := s.db.Exec(ctx, `
		UPDATE lab_orders SET assigned_phlebotomist_id = $2, collection_status = $3, updated_at = now()
		WHERE id = $1 AND state = 'SCHEDULED' AND (assigned_phlebotomist_id IS NULL OR assigned_phlebotomist_id = $2)`,
		orderID, userID, col)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrOrderNotFound // claimed by a colleague in the meantime
	}
	if lat != nil {
		if _, err := s.db.Exec(ctx, `
			INSERT INTO lab_phlebotomist_locations (user_id, lat, lng) VALUES ($1,$2,$3)
			ON CONFLICT (user_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = now()`,
			userID, *lat, *lng); err != nil {
			return err
		}
	}
	s.audited(userID, o.PatientID, "health.lab.collection."+strings.ToLower(col), orderID, nil, nil)
	return nil
}

// GetChecklist returns the bedside checklist for an order, with any steps the
// phlebotomist has already confirmed.
func (s *Service) GetChecklist(ctx context.Context, userID, orderID string) ([]ChecklistItem, error) {
	if _, _, err := s.fieldOrder(ctx, userID, orderID); err != nil {
		return nil, err
	}
	return s.checklistFor(ctx, orderID)
}

func (s *Service) checklistFor(ctx context.Context, orderID string) ([]ChecklistItem, error) {
	var fasting bool
	if err := s.db.QueryRow(ctx, `
		SELECT COALESCE(bool_or(t.fasting_required), false)
		FROM lab_order_lines l JOIN lab_tests t ON t.id = l.test_id WHERE l.order_id = $1`, orderID).Scan(&fasting); err != nil {
		return nil, err
	}
	var done []string
	err := s.db.QueryRow(ctx, `SELECT completed_ids FROM lab_collection_checklists WHERE order_id = $1`, orderID).Scan(&done)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	have := map[string]bool{}
	for _, id := range done {
		have[id] = true
	}
	items := checklistTemplate(fasting)
	for i := range items {
		items[i].Done = have[items[i].ID]
	}
	return items, nil
}

// LogCustody is the bedside scan: it verifies the checklist, records the tube's
// barcode as the sample of record (collecting the sample on first scan) and opens
// the immutable chain of custody. An unacceptable specimen condition raises a
// custody breach so the order cannot proceed on a compromised sample (HL-6).
func (s *Service) LogCustody(ctx context.Context, userID, orderID, barcode string, conditionOk bool, note string, completed []string) (sampleID string, breach bool, err error) {
	_, _, err = s.fieldOrder(ctx, userID, orderID)
	if err != nil {
		return "", false, err
	}
	barcode = normalizeBarcode(barcode)
	if !barcodePattern.MatchString(barcode) {
		return "", false, ErrBadBarcode
	}
	items, err := s.checklistFor(ctx, orderID)
	if err != nil {
		return "", false, err
	}
	have := map[string]bool{}
	for _, id := range completed {
		have[id] = true
	}
	var missing []string
	for _, it := range items {
		if it.Required && !have[it.ID] {
			missing = append(missing, it.Label)
		}
	}
	if len(missing) > 0 {
		return "", false, fmt.Errorf("%w (missing: %s)", ErrChecklistIncomplete, strings.Join(missing, "; "))
	}
	known := map[string]bool{}
	for _, it := range items {
		known[it.ID] = true
	}
	ids := make([]string, 0, len(completed))
	for _, id := range completed {
		if known[id] {
			ids = append(ids, id)
		}
	}
	if _, err := s.db.Exec(ctx, `
		INSERT INTO lab_collection_checklists (order_id, completed_ids, completed_by) VALUES ($1,$2,$3)
		ON CONFLICT (order_id) DO UPDATE SET completed_ids = EXCLUDED.completed_ids,
		  completed_by = EXCLUDED.completed_by, completed_at = now()`, orderID, ids, userID); err != nil {
		return "", false, err
	}

	sm, err := s.sampleByOrder(ctx, orderID)
	if err != nil {
		return "", false, err
	}
	if sm == nil {
		sm, err = s.collectWith(ctx, userID, orderID, note, barcode)
		if err != nil {
			return "", false, err
		}
		if _, err := s.db.Exec(ctx, `UPDATE lab_orders SET assigned_phlebotomist_id = COALESCE(assigned_phlebotomist_id, $2) WHERE id = $1`, orderID, userID); err != nil {
			return "", false, err
		}
	} else if verr := verifyBarcodeScan(barcode, sm.BarcodeRef); verr != nil {
		return "", false, verr
	}
	if !conditionOk {
		reason := strings.TrimSpace(note)
		if reason == "" {
			reason = "specimen condition not acceptable at collection"
		}
		if _, err := s.FlagBreach(ctx, userID, sm.ID, reason); err != nil {
			return "", false, err
		}
		return sm.ID, true, nil
	}
	return sm.ID, false, nil
}

// DropOff hands the sample to the lab's accession desk: the scanned barcode must
// match the sample of record, then custody moves to the lab owner (HL-6).
func (s *Service) DropOff(ctx context.Context, userID, orderID, labID, barcode, note string) error {
	o, _, err := s.fieldOrder(ctx, userID, orderID)
	if err != nil {
		return err
	}
	if labID != "" && labID != o.LabProviderID {
		return ErrOrderNotFound
	}
	sm, err := s.sampleByOrder(ctx, orderID)
	if err != nil {
		return err
	}
	if sm == nil {
		return errors.New("lab: log the sample at the bedside before dropping it off")
	}
	if strings.TrimSpace(barcode) == "" {
		return ErrBadBarcode
	}
	if err := verifyBarcodeScan(barcode, sm.BarcodeRef); err != nil {
		return err
	}
	var desk string
	if err := s.db.QueryRow(ctx, `SELECT owner_user_id::text FROM health_providers WHERE id = $1`, o.LabProviderID).Scan(&desk); err != nil {
		return err
	}
	_, err = s.Handover(ctx, userID, sm.ID, desk, note)
	return err
}

// PhlebotomistView is the patient's view of who is coming to collect. Rating data
// does not exist for phlebotomists yet, so none is invented.
type PhlebotomistView struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Credential *LabCredential `json:"credential,omitempty"`
	Phone      string         `json:"phone,omitempty"`
	Lat        *float64       `json:"lat,omitempty"`
	Lng        *float64       `json:"lng,omitempty"`
	Status     string         `json:"status"` // assigned | en_route | arrived | collected | dropped_off
	LocationAt *time.Time     `json:"location_at,omitempty"`
}

// OrderPhlebotomist returns the assigned phlebotomist for the order's patient (or
// owning lab / admin). Position and phone are shared only while the collection is
// still active, and a stale position (older than 15 minutes) is not shown.
func (s *Service) OrderPhlebotomist(ctx context.Context, requesterID, orderID string, isAdmin bool) (*PhlebotomistView, error) {
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, err
	}
	owner, _ := s.labOwner(ctx, o.LabProviderID)
	if !authorizeOrderAccess(requesterID, o.PatientID, owner, isAdmin) {
		return nil, ErrOrderNotFound
	}
	var phleb *string
	var collStatus string
	if err := s.db.QueryRow(ctx, `SELECT assigned_phlebotomist_id::text, COALESCE(collection_status,'') FROM lab_orders WHERE id = $1`, orderID).Scan(&phleb, &collStatus); err != nil {
		return nil, err
	}
	if phleb == nil {
		return nil, ErrNoPhlebotomist
	}
	v := &PhlebotomistView{ID: *phleb}
	var full, phone string
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(NULLIF(btrim(full_name),''), NULLIF(btrim(display_name),''), ''), COALESCE(btrim(phone),'') FROM user_profiles WHERE id = $1`, *phleb).Scan(&full, &phone)
	v.Name = shortAuthor(full)

	var sampleState string
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(state,'') FROM lab_samples WHERE order_id = $1`, orderID).Scan(&sampleState)
	v.Status = assignmentStatus(sampleState, collStatus)

	var ref string
	var verified bool
	var exp *time.Time
	if err := s.db.QueryRow(ctx, `
		SELECT reference_no, verified, expires_at FROM health_credential_docs
		WHERE owner_user_id = $1 AND cred_type = 'MLSCN'
		ORDER BY verified DESC, created_at DESC LIMIT 1`, *phleb).Scan(&ref, &verified, &exp); err == nil {
		st := "pending"
		switch {
		case exp != nil && exp.Before(time.Now()):
			st = "expired"
		case verified:
			st = "verified"
		}
		v.Credential = &LabCredential{Authority: "MLSCN", LicenseNo: ref, Status: st, ExpiresAt: exp}
	}

	active := o.State == StateScheduled || o.State == StateSampleCollected || o.State == StateInTransit
	if active && requesterID == o.PatientID {
		v.Phone = phone
		var lat, lng float64
		var at time.Time
		if err := s.db.QueryRow(ctx, `SELECT lat, lng, updated_at FROM lab_phlebotomist_locations WHERE user_id = $1 AND updated_at > now() - interval '15 minutes'`, *phleb).Scan(&lat, &lng, &at); err == nil {
			v.Lat, v.Lng, v.LocationAt = &lat, &lng, &at
		}
	}
	return v, nil
}
