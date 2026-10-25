package estate

// LIVE-DB tests for the legacy-data import (ESTD-D034 / EST-UAT-0432..0441).
// Reuses the estate live-DB harness (estateDuesTestPool, seedDuesUser,
// seedEstate, seedResident, auditCount).
// Run:
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/estate/... -run TestLiveDB_Import -v

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

// TestLiveDB_Import_DryRunCommitAndReplay covers the happy path end to end:
// dry-run writes nothing but a batch row; commit applies units/residents/
// opening balances idempotently and replays on a retried key.
//
//nolint:gocognit,gocyclo // end-to-end live fixture; assertions kept inline for readability
func TestLiveDB_Import_DryRunCommitAndReplay(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	adminID := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, adminID)
	residentUser := seedDuesUser(t, ctx, pool)
	residentEmail := residentUser + "@seed.test"

	control := int64(250000)
	req := ImportRequest{
		SourceRef:        "legacy-export-1",
		ControlTotalKobo: &control,
		Units: []json.RawMessage{
			raw(t, ImportUnit{ExternalRef: "U-101", UnitLabel: "A-101", Block: "A", PropertyType: "apartment"}),
			raw(t, ImportUnit{ExternalRef: "U-102", UnitLabel: "A-102", Block: "A"}),
		},
		Residents: []json.RawMessage{
			raw(t, ImportResident{ExternalRef: "R-1", Email: residentEmail, UnitRef: "U-101", Relationship: "owner", ResidencyStart: "2021-03-01"}),
		},
		OpeningBalances: []json.RawMessage{
			raw(t, map[string]any{"external_ref": "BAL-1", "resident_ref": "R-1", "unit_ref": "U-101",
				"category": "service_charge", "amount_kobo": 250000, "due_date": "2026-12-31"}),
		},
	}

	batch, err := svc.DryRunImport(ctx, estateID, adminID, req)
	if err != nil {
		t.Fatalf("dry-run: %v", err)
	}
	if batch.Status != "dry_run" || len(batch.Exceptions) != 0 {
		t.Fatalf("dry-run batch: status=%q exceptions=%+v", batch.Status, batch.Exceptions)
	}
	if batch.Summary.Units.Insert != 2 || batch.Summary.Residents.Insert != 1 || batch.Summary.OpeningBalances.Insert != 1 {
		t.Fatalf("dry-run counts: %+v", batch.Summary)
	}
	if batch.Summary.ControlTotalMatches == nil || !*batch.Summary.ControlTotalMatches {
		t.Fatalf("control total should match 250000: %+v", batch.Summary)
	}
	// Dry-run wrote nothing to estate tables.
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM estate_properties WHERE estate_id=$1`, estateID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("dry-run created %d units", n)
	}

	// Commit without an Idempotency-Key fails closed.
	if _, err := svc.CommitImport(ctx, estateID, batch.ID, adminID, ""); !errors.Is(err, ErrIdempotencyRequired) {
		t.Fatalf("commit without key = %v, want ErrIdempotencyRequired", err)
	}
	committed, err := svc.CommitImport(ctx, estateID, batch.ID, adminID, "import-commit-"+uuid.New().String())
	if err != nil {
		t.Fatalf("commit: %v", err)
	}
	if committed.Status != "committed" || committed.CommitResult == nil {
		t.Fatalf("committed batch: %+v", committed)
	}
	// Rows landed: 2 units, 1 membership with imported residency dates,
	// 1 pending invoice at the control total.
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM estate_properties WHERE estate_id=$1`, estateID).Scan(&n); err != nil || n != 2 {
		t.Fatalf("imported units = %d, want 2", n)
	}
	var unitLabel string
	var resStart *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT unit, residency_start FROM estate_residents WHERE estate_id=$1 AND user_id=$2`,
		estateID, residentUser).Scan(&unitLabel, &resStart); err != nil {
		t.Fatalf("imported membership: %v", err)
	}
	if unitLabel != "A-101" || resStart == nil || resStart.Format("2006-01-02") != "2021-03-01" {
		t.Fatalf("membership unit/dates = %q/%v", unitLabel, resStart)
	}
	var invKobo int64
	var invStatus string
	if err := pool.QueryRow(ctx,
		`SELECT amount_kobo, status FROM estate_dues_invoices WHERE estate_id=$1 AND resident_id=$2`,
		estateID, residentUser).Scan(&invKobo, &invStatus); err != nil {
		t.Fatalf("imported invoice: %v", err)
	}
	if invKobo != 250000 || invStatus != "pending" {
		t.Fatalf("opening balance invoice = %d/%s, want 250000/pending", invKobo, invStatus)
	}
	// Owner occupancy was recorded on the unit.
	var landlord *string
	if err := pool.QueryRow(ctx, `SELECT landlord_id::TEXT FROM estate_properties WHERE estate_id=$1 AND unit_label='A-101'`, estateID).Scan(&landlord); err != nil {
		t.Fatalf("unit landlord: %v", err)
	}
	if landlord == nil || *landlord != residentUser {
		t.Fatalf("landlord = %v, want %s", landlord, residentUser)
	}
	// Refs recorded for delta re-apply.
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM estate_import_refs WHERE estate_id=$1`, estateID).Scan(&n); err != nil || n != 4 {
		t.Fatalf("import refs = %d, want 4 (2 units + 1 resident + 1 balance)", n)
	}
	if n := auditCount(t, ctx, pool, estateID, batch.ID, "estate.import.committed"); n != 1 {
		t.Fatalf("commit audit rows = %d, want 1", n)
	}

	// Idempotent replay: same key returns the stored result.
	key, err := func() (string, error) {
		var k string
		err := pool.QueryRow(ctx, `SELECT commit_idempotency_key FROM estate_import_batches WHERE id=$1`, batch.ID).Scan(&k)
		return k, err
	}()
	if err != nil {
		t.Fatalf("read commit key: %v", err)
	}
	replay, err := svc.CommitImport(ctx, estateID, batch.ID, adminID, key)
	if err != nil {
		t.Fatalf("replay commit: %v", err)
	}
	if !replay.Replayed {
		t.Fatal("retried commit did not report replayed")
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM estate_dues_invoices WHERE estate_id=$1`, estateID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("replayed commit duplicated rows: invoices = %d", n)
	}
	// A different key on a committed batch is refused.
	if _, err := svc.CommitImport(ctx, estateID, batch.ID, adminID, "different-key-123456"); !errors.Is(err, ErrImportAlreadyCommitted) {
		t.Fatalf("commit with different key = %v, want ErrImportAlreadyCommitted", err)
	}
}

// TestLiveDB_Import_DedupeAndDelta covers natural-key dedupe (existing native
// rows are linked, never duplicated) and the delta re-apply (same ref + new
// payload updates; unchanged refs skip).
func TestLiveDB_Import_DedupeAndDelta(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	adminID := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, adminID)
	userID := seedDuesUser(t, ctx, pool)

	// A native unit that an import row must dedupe onto, and a native member.
	if _, err := pool.Exec(ctx,
		`INSERT INTO estate_properties (estate_id, unit_label, block) VALUES ($1,'B-201','B')`, estateID); err != nil {
		t.Fatalf("seed native unit: %v", err)
	}
	seedResident(t, ctx, pool, estateID, userID, "resident")

	req := ImportRequest{
		Units: []json.RawMessage{
			raw(t, ImportUnit{ExternalRef: "LU-1", UnitLabel: "B-201", Block: "B"}), // → link
			raw(t, ImportUnit{ExternalRef: "LU-2", UnitLabel: "B-202", Block: "B"}), // → insert
		},
		Residents: []json.RawMessage{
			raw(t, ImportResident{ExternalRef: "LR-1", Email: userID + "@seed.test", UnitRef: "LU-1"}), // → link
		},
	}
	b1, err := svc.DryRunImport(ctx, estateID, adminID, req)
	if err != nil {
		t.Fatalf("dry-run 1: %v", err)
	}
	if b1.Summary.Units.Link != 1 || b1.Summary.Units.Insert != 1 || b1.Summary.Residents.Link != 1 {
		t.Fatalf("dedupe counts: %+v", b1.Summary)
	}
	if _, err := svc.CommitImport(ctx, estateID, b1.ID, adminID, "delta-1-"+uuid.New().String()); err != nil {
		t.Fatalf("commit 1: %v", err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM estate_properties WHERE estate_id=$1`, estateID).Scan(&n); err != nil || n != 2 {
		t.Fatalf("units after dedupe import = %d, want 2 (no duplicate)", n)
	}

	// Delta re-apply: same payload → everything unchanged; one changed row → update.
	b2, err := svc.DryRunImport(ctx, estateID, adminID, req)
	if err != nil {
		t.Fatalf("dry-run 2: %v", err)
	}
	if b2.Summary.Units.Unchanged != 2 || b2.Summary.Residents.Unchanged != 1 {
		t.Fatalf("re-import should be all unchanged: %+v", b2.Summary)
	}

	req2 := ImportRequest{
		Units: []json.RawMessage{
			raw(t, ImportUnit{ExternalRef: "LU-1", UnitLabel: "B-201", Block: "B"}),
			raw(t, ImportUnit{ExternalRef: "LU-2", UnitLabel: "B-202", Block: "B", OccupancyStatus: "occupied"}), // changed
		},
	}
	b3, err := svc.DryRunImport(ctx, estateID, adminID, req2)
	if err != nil {
		t.Fatalf("dry-run 3: %v", err)
	}
	if b3.Summary.Units.Unchanged != 1 || b3.Summary.Units.Update != 1 {
		t.Fatalf("delta counts: %+v", b3.Summary)
	}
	if _, err := svc.CommitImport(ctx, estateID, b3.ID, adminID, "delta-3-"+uuid.New().String()); err != nil {
		t.Fatalf("commit 3: %v", err)
	}
	var occ string
	if err := pool.QueryRow(ctx, `SELECT occupancy_status FROM estate_properties WHERE estate_id=$1 AND unit_label='B-202'`, estateID).Scan(&occ); err != nil {
		t.Fatalf("read updated unit: %v", err)
	}
	if occ != "occupied" {
		t.Fatalf("delta update did not apply: occupancy = %q", occ)
	}
}

// TestLiveDB_Import_ExceptionsAndGates covers the exception report, the
// control-total refusal, unknown refs and the estate-status gate.
func TestLiveDB_Import_ExceptionsAndGates(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil)
	adminID := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, adminID)

	req := ImportRequest{
		Residents: []json.RawMessage{
			raw(t, ImportResident{ExternalRef: "RX-1", Email: "ghost@nowhere.test"}), // no account
			raw(t, ImportResident{ExternalRef: "RX-2", Email: "x@y.test", UnitRef: "NOPE"}),
		},
		OpeningBalances: []json.RawMessage{
			raw(t, map[string]any{"external_ref": "BX-1", "resident_ref": "NOPE", "amount_kobo": 100, "due_date": "2026-01-01"}),
		},
	}
	b, err := svc.DryRunImport(ctx, estateID, adminID, req)
	if err != nil {
		t.Fatalf("dry-run: %v", err)
	}
	codes := map[string]bool{}
	for _, e := range b.Exceptions {
		codes[e.Code] = true
	}
	if !codes["identity_not_found"] || !codes["unit_ref_unknown"] || !codes["resident_ref_unknown"] {
		t.Fatalf("exception codes = %v", codes)
	}

	// Control total that cannot match refuses the commit (422), not the dry-run.
	bad := int64(999999)
	b2, err := svc.DryRunImport(ctx, estateID, adminID, ImportRequest{
		ControlTotalKobo: &bad,
		Units:            []json.RawMessage{raw(t, ImportUnit{ExternalRef: "C-1", UnitLabel: "C-1"})},
	})
	if err != nil {
		t.Fatalf("dry-run with bad control: %v", err)
	}
	if b2.Summary.ControlTotalMatches == nil || *b2.Summary.ControlTotalMatches {
		t.Fatal("control total unexpectedly matched")
	}
	if _, err := svc.CommitImport(ctx, estateID, b2.ID, adminID, "ctl-"+uuid.New().String()); !errors.Is(err, ErrImportControlTotal) {
		t.Fatalf("commit with bad control = %v, want ErrImportControlTotal", err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM estate_properties WHERE estate_id=$1 AND unit_label='C-1'`, estateID).Scan(&n); err != nil || n != 0 {
		t.Fatal("refused commit still wrote rows")
	}

	// Suspended estate: imports refused (they require pending|active).
	if _, err := svc.TransitionEstate(ctx, estateID, adminID, LifecycleSuspend, "suspend for import gate test"); err != nil {
		t.Fatalf("suspend: %v", err)
	}
	if _, err := svc.DryRunImport(ctx, estateID, adminID, ImportRequest{
		Units: []json.RawMessage{raw(t, ImportUnit{ExternalRef: "D-1", UnitLabel: "D-1"})},
	}); !errors.Is(err, ErrImportEstateNotImportable) {
		t.Fatalf("dry-run on suspended estate = %v, want ErrImportEstateNotImportable", err)
	}
}
