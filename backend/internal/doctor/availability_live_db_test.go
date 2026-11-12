package doctor

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// availability_live_db_test.go — live-DB guard for the PUT /availability body shape.
// The published contract nests the schedule under "schedule"; binding it flat decoded
// that body to every-default WITHOUT an error and the repository wrote an empty row,
// so a doctor's saved hours vanished behind a "Saved" alert. Only a round trip through
// Postgres pins that the days actually sent are the days stored.
// Runs only with TEST_DATABASE_URL set; owns and removes its fixture.

func TestUpsertAvailability_LandsTheSentSchedule(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping availability live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	ctx := context.Background()

	userID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2)`,
		userID, userID+"@availability.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM auth.users WHERE id=$1`, userID)
	})

	// The body the react-native availability screen sends.
	body := `{"schedule":{"doctorId":"` + userID +
		`","workingDays":[{"day":"mon","enabled":true,"startTime":"09:00","endTime":"17:00"}],` +
		`"breaks":[{"label":"Lunch","startTime":"13:00","endTime":"14:00"}],` +
		`"consultDurationMins":20,"bufferMins":5,"acceptsInstant":true}}`
	var req UpdateAvailabilityRequest
	if err := json.Unmarshal([]byte(body), &req); err != nil {
		t.Fatalf("bind: %v", err)
	}
	if req.Schedule == nil {
		t.Fatal("schedule did not bind")
	}

	got, err := NewRepository(pool).UpsertAvailability(ctx, userID, *req.Schedule)
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if got.ConsultDurationMins != 20 {
		t.Errorf("consultDurationMins = %d, want 20", got.ConsultDurationMins)
	}
	if got.BufferMins != 5 {
		t.Errorf("bufferMins = %d, want 5", got.BufferMins)
	}
	if !got.AcceptsInstant {
		t.Error("acceptsInstant = false, want true")
	}
	var days []struct {
		Day     string `json:"day"`
		Enabled bool   `json:"enabled"`
	}
	if err := json.Unmarshal(got.WorkingDays, &days); err != nil {
		t.Fatalf("working_days is not the expected shape: %v", err)
	}
	if len(days) != 1 || days[0].Day != "mon" || !days[0].Enabled {
		t.Errorf("working_days round trip = %s, want the single enabled mon day sent", got.WorkingDays)
	}
}
