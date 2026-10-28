package healthlab

// Live-DB coverage for the phlebotomist field flow: route, claim, checklist,
// bedside scan, breach, drop-off and the patient's tracking view. Skips without
// TEST_DATABASE_URL.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type fieldFixture struct {
	svc                           *Service
	lab, labOwner                 string
	phleb, colleague, patient, xx string
	order                         string
}

func addStaff(t *testing.T, ctx context.Context, pool *pgxpool.Pool, lab, user string) {
	t.Helper()
	if _, err := pool.Exec(ctx,
		`INSERT INTO lab_staff (lab_provider_id, user_id, role) VALUES ($1,$2,'phlebotomist')`, lab, user); err != nil {
		t.Fatalf("seed staff: %v", err)
	}
}

func seedHomeOrder(t *testing.T, ctx context.Context, pool *pgxpool.Pool, patient, lab, state string, fasting bool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO lab_orders (id, patient_id, lab_provider_id, state, collection_method, total_kobo, idempotency_key,
		                         collection_address, collection_lat, collection_lng, scheduled_for)
		 VALUES ($1,$2,$3,$4,'HOME',950000,$5,'12 Ozumba Mbadiwe Ave, Lagos',6.4281,3.4219, now() + interval '1 hour')`,
		id, patient, lab, state, "field-"+id); err != nil {
		t.Fatalf("seed home order: %v", err)
	}
	testID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO lab_tests (id, lab_provider_id, code, name, specimen, price_kobo, fasting_required)
		 VALUES ($1,$2,'LP','Lipid Profile','BLOOD',950000,$3)`, testID, lab, fasting); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO lab_order_lines (id, order_id, test_id, test_name, unit_price_kobo) VALUES ($1,$2,$3,'Lipid Profile',950000)`,
		uuid.New().String(), id, testID); err != nil {
		t.Fatal(err)
	}
	return id
}

func newFieldFixture(t *testing.T, fasting bool) (*fieldFixture, context.Context, *pgxpool.Pool) {
	pool := listEndpointsLivePool(t)
	ctx := t.Context()
	f := &fieldFixture{svc: NewService(pool, nil, nil, nil, nil, nil, nil, nil)}
	f.labOwner, f.phleb, f.colleague, f.patient, f.xx = uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, u := range []string{f.labOwner, f.phleb, f.colleague, f.patient, f.xx} {
		seedLabTestUser(t, ctx, pool, u)
	}
	f.lab = seedDirLab(t, ctx, pool, f.labOwner, true, true, "APPROVED")
	addStaff(t, ctx, pool, f.lab, f.phleb)
	addStaff(t, ctx, pool, f.lab, f.colleague)
	f.order = seedHomeOrder(t, ctx, pool, f.patient, f.lab, "SCHEDULED", fasting)
	return f, ctx, pool
}

func allChecklist(items []ChecklistItem) []string {
	ids := make([]string, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.ID)
	}
	return ids
}

func TestLiveDB_Phlebotomist_RouteClaimAndChecklist(t *testing.T) {
	f, ctx, _ := newFieldFixture(t, true)

	mine, err := f.svc.ListAssignments(ctx, f.phleb, nil, nil)
	if err != nil || len(mine) != 1 || mine[0].OrderID != f.order {
		t.Fatalf("an unassigned order must appear for staff of its lab: %v %+v", err, mine)
	}
	a := mine[0]
	if a.Status != "assigned" || a.Address == "" || a.SampleType != "blood" || a.TestSummary != "Lipid Profile" {
		t.Fatalf("unexpected assignment: %+v", a)
	}
	if stranger, _ := f.svc.ListAssignments(ctx, f.xx, nil, nil); len(stranger) != 0 {
		t.Fatal("a user who is not staff of the lab must see no route")
	}

	lat, lng := 6.43, 3.42
	near, _ := f.svc.ListAssignments(ctx, f.phleb, &lat, &lng)
	if near[0].DistanceM == nil || *near[0].DistanceM > 2000 {
		t.Fatalf("distance must be computed from the supplied position, got %v", near[0].DistanceM)
	}

	if err := f.svc.SetCollectionStatus(ctx, f.xx, f.order, "en_route", nil, nil); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("non-staff cannot update a visit, got %v", err)
	}
	if err := f.svc.SetCollectionStatus(ctx, f.phleb, f.order, "teleporting", nil, nil); !errors.Is(err, ErrBadCollectionStatus) {
		t.Fatalf("unknown status must be refused, got %v", err)
	}
	if err := f.svc.SetCollectionStatus(ctx, f.phleb, f.order, "en_route", &lat, &lng); err != nil {
		t.Fatal(err)
	}
	if again, _ := f.svc.ListAssignments(ctx, f.phleb, nil, nil); len(again) != 1 || again[0].Status != "en_route" {
		t.Fatalf("status must persist: %+v", again)
	}
	if gone, _ := f.svc.ListAssignments(ctx, f.colleague, nil, nil); len(gone) != 0 {
		t.Fatal("once claimed, the order leaves the colleague's pool")
	}
	if err := f.svc.SetCollectionStatus(ctx, f.colleague, f.order, "arrived", nil, nil); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("a colleague cannot act on a claimed visit, got %v", err)
	}

	items, err := f.svc.GetChecklist(ctx, f.phleb, f.order)
	if err != nil {
		t.Fatal(err)
	}
	foundFasting := false
	for _, it := range items {
		if it.ID == "fasting" && it.Required {
			foundFasting = true
		}
	}
	if !foundFasting {
		t.Fatal("a fasting test must add the fasting step")
	}
	if _, err := f.svc.GetChecklist(ctx, f.colleague, f.order); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("a colleague cannot read a claimed visit's checklist, got %v", err)
	}
}

func TestLiveDB_Phlebotomist_ScanBreachAndDropOff(t *testing.T) {
	f, ctx, pool := newFieldFixture(t, false)

	items, _ := f.svc.GetChecklist(ctx, f.phleb, f.order)
	all := allChecklist(items)

	if _, _, err := f.svc.LogCustody(ctx, f.phleb, f.order, "TUBE-0001", true, "", []string{"identity"}); !errors.Is(err, ErrChecklistIncomplete) {
		t.Fatalf("a partial checklist must be refused, got %v", err)
	}
	if _, _, err := f.svc.LogCustody(ctx, f.phleb, f.order, "x", true, "", all); !errors.Is(err, ErrBadBarcode) {
		t.Fatalf("a malformed barcode must be refused, got %v", err)
	}
	if _, _, err := f.svc.LogCustody(ctx, f.xx, f.order, "TUBE-0001", true, "", all); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("non-staff cannot log a sample, got %v", err)
	}

	sampleID, breach, err := f.svc.LogCustody(ctx, f.phleb, f.order, "tube-0001", true, "", all)
	if err != nil || breach || sampleID == "" {
		t.Fatalf("a complete scan must collect the sample: %v breach=%v", err, breach)
	}
	var barcode, orderState string
	_ = pool.QueryRow(ctx, `SELECT barcode_ref FROM lab_samples WHERE id=$1`, sampleID).Scan(&barcode)
	_ = pool.QueryRow(ctx, `SELECT state FROM lab_orders WHERE id=$1`, f.order).Scan(&orderState)
	if barcode != "TUBE-0001" || orderState != "SAMPLE_COLLECTED" {
		t.Fatalf("the scanned barcode must be the sample of record and the order collected: %s %s", barcode, orderState)
	}
	var events int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM lab_custody_events WHERE sample_id=$1`, sampleID).Scan(&events)
	if events < 1 {
		t.Fatal("the chain of custody must be opened with an immutable event")
	}
	var saved []string
	_ = pool.QueryRow(ctx, `SELECT completed_ids FROM lab_collection_checklists WHERE order_id=$1`, f.order).Scan(&saved)
	if len(saved) != len(all) {
		t.Fatalf("the confirmed checklist must be kept as evidence, got %v", saved)
	}

	if _, _, err := f.svc.LogCustody(ctx, f.phleb, f.order, "TUBE-9999", true, "", all); !errors.Is(err, ErrBarcodeMismatch) {
		t.Fatalf("re-scanning a different tube must be a mismatch, got %v", err)
	}
	other := seedHomeOrder(t, ctx, pool, f.patient, f.lab, "SCHEDULED", false)
	if _, _, err := f.svc.LogCustody(ctx, f.phleb, other, "TUBE-0001", true, "", all); !errors.Is(err, ErrBarcodeInUse) {
		t.Fatalf("a barcode already on another sample must be refused, got %v", err)
	}

	if err := f.svc.DropOff(ctx, f.phleb, f.order, "", "TUBE-0002", ""); !errors.Is(err, ErrBarcodeMismatch) {
		t.Fatalf("drop-off with the wrong tube must be refused, got %v", err)
	}
	if err := f.svc.DropOff(ctx, f.phleb, f.order, uuid.NewString(), "TUBE-0001", ""); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("drop-off at another lab must be refused, got %v", err)
	}
	if err := f.svc.DropOff(ctx, f.phleb, f.order, f.lab, "tube-0001", "left with the desk"); err != nil {
		t.Fatal(err)
	}
	var sState, custodian string
	_ = pool.QueryRow(ctx, `SELECT state, custodian_id::text FROM lab_samples WHERE id=$1`, sampleID).Scan(&sState, &custodian)
	if sState != "HANDED_OVER" || custodian != f.labOwner {
		t.Fatalf("custody must pass to the lab's accession desk: %s %s", sState, custodian)
	}
	route, _ := f.svc.ListAssignments(ctx, f.phleb, nil, nil)
	status := ""
	for _, r := range route {
		if r.OrderID == f.order {
			status = r.Status
		}
	}
	if status != "dropped_off" {
		t.Fatalf("the stop must show as dropped off, got %q in %+v", status, route)
	}
}

func TestLiveDB_Phlebotomist_BadConditionRaisesBreach(t *testing.T) {
	f, ctx, pool := newFieldFixture(t, false)
	items, _ := f.svc.GetChecklist(ctx, f.phleb, f.order)
	sampleID, breach, err := f.svc.LogCustody(ctx, f.phleb, f.order, "TUBE-BAD1", false, "haemolysed", allChecklist(items))
	if err != nil || !breach {
		t.Fatalf("an unacceptable specimen must raise a breach: %v breach=%v", err, breach)
	}
	var st string
	_ = pool.QueryRow(ctx, `SELECT state FROM lab_samples WHERE id=$1`, sampleID).Scan(&st)
	if st != "RECOLLECT_REQUIRED" {
		t.Fatalf("a breached sample must require recollection, got %s", st)
	}
}

func TestLiveDB_Phlebotomist_PatientTrackingView(t *testing.T) {
	f, ctx, _ := newFieldFixture(t, false)

	if _, err := f.svc.OrderPhlebotomist(ctx, f.patient, f.order, false); !errors.Is(err, ErrNoPhlebotomist) {
		t.Fatalf("before assignment there is nobody to show, got %v", err)
	}
	lat, lng := 6.44, 3.43
	if err := f.svc.SetCollectionStatus(ctx, f.phleb, f.order, "en_route", &lat, &lng); err != nil {
		t.Fatal(err)
	}
	v, err := f.svc.OrderPhlebotomist(ctx, f.patient, f.order, false)
	if err != nil {
		t.Fatal(err)
	}
	if v.ID != f.phleb || v.Status != "en_route" || v.Lat == nil || *v.Lat != lat {
		t.Fatalf("the patient must see the assigned phlebotomist and live position: %+v", v)
	}
	if _, err := f.svc.OrderPhlebotomist(ctx, f.xx, f.order, false); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("a stranger must see not-found, got %v", err)
	}
	owner, err := f.svc.OrderPhlebotomist(ctx, f.labOwner, f.order, false)
	if err != nil {
		t.Fatal(err)
	}
	if owner.Lat != nil || owner.Phone != "" {
		t.Fatal("position and phone are for the patient only")
	}
}
