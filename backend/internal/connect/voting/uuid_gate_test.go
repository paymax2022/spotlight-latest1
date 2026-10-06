package connectvoting

// DB-free tests for the malformed-uuid→ErrNotFound gates (wave-6 prod probe).
// Before the gates, a non-uuid :id reached Postgres uuid comparisons and the
// driver error surfaced as a bare 500 on like/unlike/share/supporters/results/
// stages. Every service method below must refuse a malformed id with the
// module's not-found sentinel BEFORE touching the database — the Service is
// built on a nil pool, so any query attempt would panic and fail the test.
//
// The nonexistent-but-well-formed path (nil roster entry → ErrNotFound) needs
// Postgres and is covered by the live verification probe; the gates here pin
// the malformed half of the contract DB-free.

import (
	"context"
	"errors"
	"testing"
)

func TestMalformedUUID_NotFound_NoDBTouch(t *testing.T) {
	svc := &Service{} // nil pool: any query would panic — the gate must win first
	ctx := context.Background()
	bad := "not-a-uuid"

	cases := []struct {
		name string
		call func() error
	}{
		{"Results", func() error { _, err := svc.Results(ctx, bad); return err }},
		{"GetStages", func() error { _, err := svc.GetStages(ctx, bad); return err }},
		{"LikeContestant", func() error { _, err := svc.LikeContestant(ctx, bad, "u1"); return err }},
		{"UnlikeContestant", func() error { _, err := svc.UnlikeContestant(ctx, bad, "u1"); return err }},
		{"ShareContestant", func() error { _, err := svc.ShareContestant(ctx, bad, "u1"); return err }},
		{"Supporters", func() error { _, err := svc.Supporters(ctx, "u1", bad); return err }},
	}
	for _, tc := range cases {
		err := tc.call()
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("%s: malformed id must yield ErrNotFound, got %v", tc.name, err)
		}
	}
}
