package top5events_test

// Live-DB coverage for the UAT events-a remediation wave:
//   - CreateEvent input validation (EVT-073/074/075)
//   - GetEvent returning the tier list the buyer disclosure renders (EVT-053/054)
//   - ListEvents q/from/to/sort discovery filters (EVT-048/049/050)
//   - GoLive refusing an event whose run has already ended (EVT-075)

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/top5events"
)

func seedEventRow(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID, title, venue, category string, start, end time.Time, state string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO events (id, organizer_id, organiser_id, title, venue, category, state, starts_at, ends_at)
		 VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8)`,
		id, ownerID, title, venue, category, state, start, end); err != nil {
		t.Fatalf("seed event %q: %v", title, err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM event_ticket_tiers WHERE event_id=$1`, id)
		_, _ = pool.Exec(bg, `DELETE FROM events WHERE id=$1`, id)
	})
	return id
}

func TestLiveDB_CreateEvent_Validation(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)

	base := top5events.Event{Title: "Valid", StartsAt: time.Now().Add(24 * time.Hour), EndsAt: time.Now().Add(30 * time.Hour)}
	if _, err := svc.CreateEvent(ctx, owner, base); err != nil {
		t.Fatalf("valid create rejected: %v", err)
	}

	cases := []struct {
		name string
		mut  func(e *top5events.Event)
	}{
		{"empty title", func(e *top5events.Event) { e.Title = " " }},
		{"one-char title", func(e *top5events.Event) { e.Title = "x" }},
		{"end before start", func(e *top5events.Event) { e.EndsAt = e.StartsAt.Add(-time.Hour) }},
		{"end equal start", func(e *top5events.Event) { e.EndsAt = e.StartsAt }},
		{"past start", func(e *top5events.Event) { e.StartsAt = time.Now().Add(-48 * time.Hour) }},
	}
	for _, tc := range cases {
		e := base
		tc.mut(&e)
		if _, err := svc.CreateEvent(ctx, owner, e); !errors.Is(err, top5events.ErrValidation) {
			t.Fatalf("%s: want ErrValidation, got %v", tc.name, err)
		}
	}
}

func TestLiveDB_GetEvent_ReturnsTiers(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedEventRow(t, ctx, pool, owner, "Tiered Detail", "Landmark, Lagos", "tech",
		time.Now().Add(24*time.Hour), time.Now().Add(30*time.Hour), "LIVE")
	seedTier(t, ctx, pool, ev, 1000, 10, 3)
	seedTier(t, ctx, pool, ev, 5000, 5, 5)

	got, err := svc.GetEvent(ctx, ev)
	if err != nil {
		t.Fatalf("GetEvent: %v", err)
	}
	if len(got.Tiers) != 2 {
		t.Fatalf("want 2 tiers, got %d", len(got.Tiers))
	}
	if got.Tiers[0].PriceKobo != 1000 {
		t.Fatalf("tiers not ordered by price asc: %+v", got.Tiers[0])
	}
}

func TestLiveDB_ListEvents_SearchWindowSort(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	other := seedTicketTokenUser(t, ctx, pool)

	soon := time.Now().Add(48 * time.Hour)
	later := time.Now().Add(96 * time.Hour)
	a := seedEventRow(t, ctx, pool, owner, "EvATest Lagos Jazz Night", "Eko Hotel, Lagos", "music", soon, soon.Add(4*time.Hour), "LIVE")
	b := seedEventRow(t, ctx, pool, owner, "EvATest Abuja Dev Summit", "Transcorp, EvATestville", "tech", later, later.Add(8*time.Hour), "LIVE")
	hidden := seedEventRow(t, ctx, pool, other, "EvATest Hidden Draft", "Somewhere", "music", soon, soon.Add(2*time.Hour), "DRAFT")
	seedTier(t, ctx, pool, a, 9000, 10, 0)
	seedTier(t, ctx, pool, b, 1000, 10, 0)

	// q matches title and venue, excludes other callers' drafts. Assertions are
	// membership/exclusion, not exact equality — the dev DB is shared with
	// other lanes' fixtures.
	contains := func(list []top5events.EventSummary, id string) bool {
		for _, e := range list {
			if e.ID == id {
				return true
			}
		}
		return false
	}
	got, err := svc.ListEvents(ctx, uuid.NewString(), top5events.EventListFilter{Q: "EvATest Lagos Jazz"})
	if err != nil {
		t.Fatalf("list q: %v", err)
	}
	if !contains(got, a) || contains(got, b) || contains(got, hidden) {
		t.Fatalf("q title: want a only of {a,b,hidden}, got %+v", got)
	}
	got, err = svc.ListEvents(ctx, uuid.NewString(), top5events.EventListFilter{Q: "EvATestville"})
	if err != nil {
		t.Fatalf("list q venue: %v", err)
	}
	if !contains(got, b) || contains(got, a) || contains(got, hidden) {
		t.Fatalf("q venue: want b only of {a,b,hidden}, got %+v", got)
	}

	// date window
	win := soon.Add(24 * time.Hour)
	got, err = svc.ListEvents(ctx, "", top5events.EventListFilter{From: &win})
	if err != nil {
		t.Fatalf("list from: %v", err)
	}
	for _, e := range got {
		if e.StartsAt.Before(win) {
			t.Fatalf("from filter leaked %v", e.StartsAt)
		}
	}

	// sort by cheapest active tier price
	got, err = svc.ListEvents(ctx, "", top5events.EventListFilter{Sort: "price_asc"})
	if err != nil {
		t.Fatalf("list sort: %v", err)
	}
	ai, bi := -1, -1
	for i, e := range got {
		if e.ID == a {
			ai = i
		}
		if e.ID == b {
			bi = i
		}
	}
	if ai == -1 || bi == -1 || bi > ai {
		t.Fatalf("price_asc want b (₦10) before a (₦90): ai=%d bi=%d", ai, bi)
	}

	// category + q combine
	got, err = svc.ListEvents(ctx, "", top5events.EventListFilter{Category: "music", Q: "EvATest"})
	if err != nil {
		t.Fatalf("list combined: %v", err)
	}
	if !contains(got, a) || contains(got, b) || contains(got, hidden) {
		t.Fatalf("category+q want a only of {a,b,hidden}, got %+v", got)
	}
}

func TestLiveDB_GoLive_RejectsEndedEvent(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	// Seed directly — CreateEvent validation would (correctly) refuse a fully
	// past row, so this constructs the legacy-shape event that predates it.
	ev := seedEventRow(t, ctx, pool, owner, "Already Ended", "Venue", "music",
		time.Now().Add(-48*time.Hour), time.Now().Add(-24*time.Hour), "APPROVED")
	if err := svc.GoLive(ctx, owner, ev); !errors.Is(err, top5events.ErrValidation) {
		t.Fatalf("want ErrValidation for ended event, got %v", err)
	}
}
