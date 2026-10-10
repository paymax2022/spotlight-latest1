package healthlab

// LIVE-DB regression for the security re-audit R1: before the fix a MISSING
// sample id answered the plain "lab: sample not found" error (409 at the
// handler) while a FOREIGN sample id answered ErrOrderNotFound (404) — a
// two-request oracle that let any authenticated caller probe which sample
// UUIDs exist. Both pgx.ErrNoRows branches in lockSample/loadSample now
// return ErrOrderNotFound, so missing and foreign are indistinguishable in
// status AND body through every sample-scoped mutation.
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestLiveDB_SampleMissingVsForeign_UniformNotFound(t *testing.T) {
	pool := labAuthzPool(t)
	ctx := context.Background()
	patientID, ownerID, sciID, phleboID, foreignID, labID := seedLabAuthzFixture(t, ctx, pool)
	prov := authzFakeProv{ownerID: ownerID, providerID: labID, scientistID: sciID, phleboID: phleboID}
	svc := NewService(pool, nil, nil, prov, nil, nil, nil, nil)

	// A live sample that exists but belongs to this lab's order — i.e. foreign
	// to the acting stranger.
	orderID := seedLabOrder(t, ctx, pool, patientID, labID, "SAMPLE_COLLECTED", "WALK_IN")
	existingSampleID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO lab_samples (id, order_id, state, collection_method, barcode_ref, collected_by)
		 VALUES ($1,$2,'COLLECTED','WALK_IN',$3,$4)`,
		existingSampleID, orderID, "BC-ORACLE-"+existingSampleID[:8], ownerID); err != nil {
		t.Fatalf("seed sample: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM lab_custody_events WHERE sample_id=$1`, existingSampleID)
		_, _ = pool.Exec(bg, `DELETE FROM lab_samples WHERE id=$1`, existingSampleID)
	})

	missingSampleID := uuid.New().String() // never inserted — does not exist

	// FlagBreach is sample-scoped: a foreign actor hits loadSample (missing →
	// was "sample not found") vs load-then-staff-gate (foreign → ErrOrderNotFound).
	for _, tc := range []struct {
		name     string
		call     func(sampleID string) error
		endpoint string
	}{
		{"FlagBreach", func(sid string) error {
			_, err := svc.FlagBreach(ctx, foreignID, sid, "probe")
			return err
		}, "POST /samples/:id/breach"},
		{"Handover", func(sid string) error {
			_, err := svc.Handover(ctx, foreignID, sid, uuid.New().String(), "probe")
			return err
		}, "POST /samples/:id/handover"},
	} {
		missErr := tc.call(missingSampleID)
		foreignErr := tc.call(existingSampleID)
		if !errors.Is(missErr, ErrOrderNotFound) {
			t.Fatalf("%s missing sample: want ErrOrderNotFound, got %v", tc.name, missErr)
		}
		if !errors.Is(foreignErr, ErrOrderNotFound) {
			t.Fatalf("%s foreign sample: want ErrOrderNotFound, got %v", tc.name, foreignErr)
		}
		// Identical sentinel ⇒ identical 404 status AND body through
		// failOrderMutation — the two error strings must literally match.
		if missErr.Error() != foreignErr.Error() {
			t.Fatalf("%s on %s leaks sample existence: missing=%q foreign=%q",
				tc.name, tc.endpoint, missErr.Error(), foreignErr.Error())
		}
	}
}
