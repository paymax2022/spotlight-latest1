package healthpharmacy_test

// LIVE-DB test for the patient consult thread. Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"
)

func TestLiveDB_ConsultThreadIsPerPatient(t *testing.T) {
	pool := ownerOrdersPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	if _, err := f.svc.SendConsultMessage(ctx, f.patient, "first"); err != nil {
		t.Fatalf("send: %v", err)
	}
	if _, err := f.svc.SendConsultMessage(ctx, f.patient, "second"); err != nil {
		t.Fatalf("send: %v", err)
	}
	if _, err := f.svc.SendConsultMessage(ctx, f.other, "someone else"); err != nil {
		t.Fatalf("send other: %v", err)
	}
	got, err := f.svc.ConsultThread(ctx, f.patient)
	if err != nil {
		t.Fatalf("thread: %v", err)
	}
	if len(got) != 2 || got[0].Body != "first" || got[1].Body != "second" || got[0].FromPharmacist {
		t.Fatalf("want the patient's own 2 messages oldest-first, got %+v", got)
	}
}
