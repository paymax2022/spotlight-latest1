package healthpharmacy_test

// LIVE-DB test for patient Rx upload records. Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"
)

func TestLiveDB_RxUploadRecordIsIdempotentAndScoped(t *testing.T) {
	pool := ownerOrdersPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	key := "pharmacy-rx/" + f.patient + "/test-object.jpg"
	u1, err := f.svc.RecordRxUpload(ctx, f.patient, key, "image/jpeg", "Ada Patient", "night shift")
	if err != nil {
		t.Fatalf("record: %v", err)
	}
	u2, err := f.svc.RecordRxUpload(ctx, f.patient, key, "image/jpeg", "Ada Patient", "night shift")
	if err != nil || u2.ID != u1.ID {
		t.Fatalf("a retried record must return the same row: %v %+v", err, u2)
	}
	if u1.State != "VERIFYING" {
		t.Fatalf("state = %s, want VERIFYING", u1.State)
	}
	mine, err := f.svc.MyRxUploads(ctx, f.patient)
	if err != nil || len(mine) != 1 {
		t.Fatalf("patient should see exactly their 1 upload: %v %+v", err, mine)
	}
	theirs, err := f.svc.MyRxUploads(ctx, f.other)
	if err != nil || len(theirs) != 0 {
		t.Fatalf("another user must see none: %v %+v", err, theirs)
	}
}
