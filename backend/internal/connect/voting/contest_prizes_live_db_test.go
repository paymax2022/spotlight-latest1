package connectvoting

// LIVE-DB test for the prize rail: what the console writes as a contest's
// "price to be won", and what the phone reads back.
//
// Why live, not mocked: the prize arrives from TWO tables that are only
// reconcilable through the mirror's id identity. The per-position rows live in
// public.voting_contest_prizes and key off connect_contests (20270213000000 —
// deliberately renamed there because the legacy public.contest_prizes table has
// a different shape), while the free-text prize the contest form writes lives on
// the LEGACY row: contests.prize_pool (20260404210000). 20261223000000 preserves
// `id` across the two planes, which is what lets one detail query read both
// without a new column. A fake database would happily accept a query that forgets
// that, and mobile would just show no prize.
//
// GATED ON TEST_DATABASE_URL only (see railTestPool):
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/connect/voting/ -run TestLiveDB_ContestPrizes -v

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// seedPrizeContest creates a mirrored contest carrying the given headline prize
// ("" = the admin left the field empty). Cleanup is registered prize-first and
// pool-close LAST, because t.Cleanup runs LIFO (see the go-test-cleanup-ordering
// note: registering close first is what leaks fixtures).
func seedPrizeContest(t *testing.T, pool *pgxpool.Pool, prizeText string) string {
	t.Helper()
	ctx := context.Background()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.contests (id, name, slug, status, prize_pool)
		VALUES ($1, $2, $3, 'active', $4)`,
		id, "ZZ prize fixture "+id[:8], "zz-prize-"+id[:8], prizeText); err != nil {
		t.Fatalf("seed mirrored contest: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.voting_contest_prizes WHERE connect_contest_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.connect_contests WHERE id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.contests WHERE id = $1`, id)
	})
	return id
}

func TestLiveDB_ContestPrizesReachThePhone(t *testing.T) {
	pool := railTestPool(t)
	ctx := context.Background()

	const headline = "₦500,000 + a management deal"
	id := seedPrizeContest(t, pool, headline)

	// Inserted OUT OF ORDER — position 2 first. contest-details.tsx draws the gold
	// dot on the FIRST entry it receives, so a query without ORDER BY position
	// hands the runner-up the winner's spot, and nothing else in the stack notices.
	type seedPrize struct {
		pos  int
		desc string
		kobo int64
	}
	for _, p := range []seedPrize{{2, "Runner-up", 10_000_000}, {1, "Winner", 50_000_000}} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO public.voting_contest_prizes
				(connect_contest_id, position, prize_description, prize_value_kobo)
			VALUES ($1, $2, $3, $4)`, id, p.pos, p.desc, p.kobo); err != nil {
			t.Fatalf("seed prize position %d: %v", p.pos, err)
		}
	}

	svc := NewService(NewRepository(pool), nil, nil, nil, nil)

	got, err := svc.GetContest(ctx, id)
	if err != nil {
		t.Fatalf("GetContest: %v", err)
	}

	// 1. The headline prize crosses from the legacy row through the id identity.
	if got.PrizeText != headline {
		t.Errorf("contests.prize_pool did not reach the detail payload: got %q want %q", got.PrizeText, headline)
	}

	// 2. The per-position prizes arrive position-ordered, with their values.
	if len(got.Prizes) != 2 {
		t.Fatalf("expected 2 prizes, got %d: %+v", len(got.Prizes), got.Prizes)
	}
	if got.Prizes[0].Position != 1 || got.Prizes[0].Description != "Winner" {
		t.Errorf("prizes are not ordered by position: %+v", got.Prizes)
	}
	if got.Prizes[0].ValueKobo == nil || *got.Prizes[0].ValueKobo != 50_000_000 {
		t.Errorf("winner prize value: %+v", got.Prizes[0].ValueKobo)
	}
	if got.Prizes[1].Position != 2 || got.Prizes[1].Description != "Runner-up" {
		t.Errorf("second prize: %+v", got.Prizes[1])
	}

	// 3. The wire names. connectVoting.mapper.ts reads exactly these keys, and a
	//    renamed json tag compiles fine in Go while blanking the mobile section.
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	for _, want := range []string{`"prize_text"`, `"prizes"`, `"position":1`, `"description":"Winner"`, `"value_kobo":50000000`} {
		if !strings.Contains(string(raw), want) {
			t.Errorf("payload missing %s — body: %s", want, raw)
		}
	}

	// 4. A contest nobody gave a prize to is not an error and does not reserve
	//    space on the phone: both fields are omitted, so the section stays hidden
	//    instead of rendering an empty "Prizes" heading.
	quietID := seedPrizeContest(t, pool, "")
	quiet, err := svc.GetContest(ctx, quietID)
	if err != nil {
		t.Fatalf("GetContest(prizeless): %v", err)
	}
	if len(quiet.Prizes) != 0 {
		t.Errorf("prizeless contest returned prizes: %+v", quiet.Prizes)
	}
	if quiet.PrizeText != "" {
		t.Errorf("prizeless contest returned prize text: %q", quiet.PrizeText)
	}
	quietRaw, err := json.Marshal(quiet)
	if err != nil {
		t.Fatalf("marshal prizeless: %v", err)
	}
	for _, absent := range []string{`"prizes"`, `"prize_text"`} {
		if strings.Contains(string(quietRaw), absent) {
			t.Errorf("prizeless payload should omit %s — body: %s", absent, quietRaw)
		}
	}
}

// The mirror is what makes the legacy prize readable at all: if the bridge ever
// stops preserving ids, the detail query must degrade to "no prize", never to a
// failed request or another contest's prize.
func TestLiveDB_ContestPrizeTextWithoutLegacyRow(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB prize test")
	}
	pool := railTestPool(t)
	ctx := context.Background()

	// Inserted straight into connect_contests: no legacy row, so no prize to find.
	id := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.connect_contests (id, title, status) VALUES ($1, $2, 'open')`,
		id, "ZZ direct fixture "+id[:8]); err != nil {
		t.Fatalf("seed direct contest: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.connect_contests WHERE id = $1`, id)
	})

	svc := NewService(NewRepository(pool), nil, nil, nil, nil)
	got, err := svc.GetContest(ctx, id)
	if err != nil {
		t.Fatalf("GetContest must succeed without a legacy row: %v", err)
	}
	if got.PrizeText != "" || len(got.Prizes) != 0 {
		t.Errorf("a contest with no legacy row and no prizes reported %q / %+v", got.PrizeText, got.Prizes)
	}
}
