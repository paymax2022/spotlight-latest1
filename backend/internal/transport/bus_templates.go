package transport

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"time"

	"github.com/google/uuid"
)

// ─── RECURRING DEPARTURE TEMPLATES (bus provider marketplace) ─────────────────
//
// ADR-020 deferred item. A departure template is a provider-owned weekly
// recurring pattern ("Lagos→Abuja, Mon/Wed/Fri at 07:30, 14 seats, ₦12,000").
// Providers create/list/toggle/delete templates for routes they own; the
// transport-scheduler worker periodically calls MaterializeBusDepartures to
// project each active template forward into concrete bus_schedules rows over a
// rolling horizon. Materialization is idempotent via the partial unique index
// bus_schedules(template_id, departure_time) WHERE template_id IS NOT NULL, so
// re-running the worker never duplicates a departure.

// hhmmRe matches the 'HH:MM' local depart_time. Hour/minute ranges are validated
// separately by parseDepartHHMM (regex alone would accept 99:99).
var hhmmRe = regexp.MustCompile(`^\d{2}:\d{2}$`)

// CreateDepartureTemplate creates a recurring departure pattern on a route the
// caller owns. Ownership mirrors CreateProviderSchedule (providerForUser →
// assertRouteOwned). Fares are self-serve trusted at materialization time.
func (s *Service) CreateDepartureTemplate(ctx context.Context, userID, routeID string, req BusDepartureTemplateRequest) (map[string]any, error) {
	providerID, err := s.providerForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if err := s.assertRouteOwned(ctx, routeID, providerID); err != nil {
		return nil, err
	}
	if err := validateDaysOfWeek(req.DaysOfWeek); err != nil {
		return nil, err
	}
	if !hhmmRe.MatchString(req.DepartTime) {
		return nil, codedErr(http.StatusBadRequest, CodeInvalidState, "depart_time must be 'HH:MM'")
	}
	if _, _, ok := parseDepartHHMM(req.DepartTime); !ok {
		return nil, codedErr(http.StatusBadRequest, CodeInvalidState, "depart_time hour/minute out of range")
	}
	if req.TotalSeats < 1 || req.TotalSeats > 80 {
		return nil, codedErr(http.StatusBadRequest, CodeInvalidState, "total_seats must be between 1 and 80")
	}
	if req.FareKobo < 0 {
		return nil, codedErr(http.StatusBadRequest, CodeInvalidState, "fare_kobo must be >= 0")
	}
	horizon := req.HorizonDays
	if horizon == 0 {
		horizon = 14 // matches the column default
	}
	if horizon < 1 || horizon > 60 {
		return nil, codedErr(http.StatusBadRequest, CodeInvalidState, "horizon_days must be between 1 and 60")
	}
	id := uuid.New().String()
	const q = `
		INSERT INTO bus_departure_templates
			(id, provider_id, route_id, days_of_week, depart_time, total_seats, fare_kobo, horizon_days, active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)`
	if _, err := s.db.Exec(ctx, q,
		id, providerID, routeID, intSliceToInt32(req.DaysOfWeek), req.DepartTime,
		req.TotalSeats, req.FareKobo, horizon,
	); err != nil {
		return nil, fmt.Errorf("transport: create departure template: %w", err)
	}
	s.recordModeEvent(ctx, userID, "bus.provider.template.create", "bus_departure_template", id, "", "active",
		map[string]any{"route_id": routeID, "days_of_week": req.DaysOfWeek, "depart_time": req.DepartTime, "fare_kobo": req.FareKobo})
	return s.departureTemplateRow(ctx, id)
}

// ListDepartureTemplates returns every template owned by the caller's provider.
func (s *Service) ListDepartureTemplates(ctx context.Context, userID string) ([]map[string]any, error) {
	providerID, err := s.providerForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT id, provider_id, route_id, days_of_week, depart_time, total_seats, fare_kobo, horizon_days, active, created_at
		FROM bus_departure_templates WHERE provider_id=$1
		ORDER BY created_at DESC LIMIT 200`, providerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var (
			id, provID, routeID, departTime string
			days                            []int32
			totalSeats, horizonDays         int
			fareKobo                        int64
			active                          bool
			createdAt                       time.Time
		)
		if err := rows.Scan(&id, &provID, &routeID, &days, &departTime, &totalSeats, &fareKobo, &horizonDays, &active, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "providerId": provID, "routeId": routeID,
			"daysOfWeek": int32SliceToInt(days), "departTime": departTime,
			"totalSeats": totalSeats, "fareKobo": fareKobo, "horizonDays": horizonDays,
			"active": active, "createdAt": createdAt,
		})
	}
	return out, nil
}

// DeleteDepartureTemplate hard-deletes a template the caller owns. 404 when the
// template does not exist or belongs to another provider. Materialized
// bus_schedules are left intact (template_id becomes a dangling reference the
// SET NULL is NOT applied — schedules already published stay bookable).
func (s *Service) DeleteDepartureTemplate(ctx context.Context, userID, id string) error {
	providerID, err := s.providerForUser(ctx, userID)
	if err != nil {
		return err
	}
	tag, err := s.db.Exec(ctx, `DELETE FROM bus_departure_templates WHERE id=$1 AND provider_id=$2`, id, providerID)
	if err != nil {
		return fmt.Errorf("transport: delete departure template: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return codedErr(http.StatusNotFound, CodeNotFound, "template not found")
	}
	s.recordModeEvent(ctx, userID, "bus.provider.template.delete", "bus_departure_template", id, "active", "deleted", nil)
	return nil
}

// SetDepartureTemplateActive toggles a template on/off (ownership-scoped). An
// inactive template is skipped by MaterializeBusDepartures.
func (s *Service) SetDepartureTemplateActive(ctx context.Context, userID, id string, active bool) (map[string]any, error) {
	providerID, err := s.providerForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	tag, err := s.db.Exec(ctx,
		`UPDATE bus_departure_templates SET active=$3, updated_at=NOW() WHERE id=$1 AND provider_id=$2`,
		id, providerID, active)
	if err != nil {
		return nil, fmt.Errorf("transport: set departure template active: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "template not found")
	}
	newState := "inactive"
	if active {
		newState = "active"
	}
	s.recordModeEvent(ctx, userID, "bus.provider.template.set_active", "bus_departure_template", id, "", newState, nil)
	return s.departureTemplateRow(ctx, id)
}

// departureTemplateRow returns one template (camelCase projection).
func (s *Service) departureTemplateRow(ctx context.Context, id string) (map[string]any, error) {
	const q = `
		SELECT id, provider_id, route_id, days_of_week, depart_time, total_seats, fare_kobo, horizon_days, active, created_at
		FROM bus_departure_templates WHERE id=$1`
	var (
		tid, provID, routeID, departTime string
		days                             []int32
		totalSeats, horizonDays          int
		fareKobo                         int64
		active                           bool
		createdAt                        time.Time
	)
	if err := s.db.QueryRow(ctx, q, id).Scan(
		&tid, &provID, &routeID, &days, &departTime, &totalSeats, &fareKobo, &horizonDays, &active, &createdAt,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "template not found")
	}
	return map[string]any{
		"id": tid, "providerId": provID, "routeId": routeID,
		"daysOfWeek": int32SliceToInt(days), "departTime": departTime,
		"totalSeats": totalSeats, "fareKobo": fareKobo, "horizonDays": horizonDays,
		"active": active, "createdAt": createdAt,
	}, nil
}

// MaterializeBusDepartures is the worker-driven projection: for every active
// template, it inserts concrete bus_schedules rows for each matching weekday in
// the template's rolling horizon. Idempotent via ON CONFLICT on the partial
// unique index — the ON CONFLICT predicate below mirrors the migration's index
// predicate (WHERE template_id IS NOT NULL) EXACTLY. Returns the number of
// schedules actually inserted (skips duplicates and past departures).
//
// defaultHorizonDays is a fallback cap used only when a template's own
// horizon_days is non-positive (which the NOT NULL/CHECK column prevents in
// practice); the per-template horizon is otherwise authoritative.
//
// Timezone: departures are computed in Africa/Lagos wall-clock (depart_time is
// 'HH:MM' local) and stored as timestamptz. If the zoneinfo DB is unavailable we
// fall back to UTC and log — better to materialize slightly-shifted departures
// than none.
//
// fare_approved=TRUE mirrors the existing provider-self-create behavior in
// CreateProviderSchedule: a provider's own declared fare is trusted (no admin
// fare approval step for provider marketplace departures).
func (s *Service) MaterializeBusDepartures(ctx context.Context, defaultHorizonDays int) (int, error) {
	loc, err := time.LoadLocation("Africa/Lagos")
	if err != nil {
		log.Printf("transport: MaterializeBusDepartures: LoadLocation(Africa/Lagos) failed, falling back to UTC: %v", err)
		loc = time.UTC
	}

	rows, err := s.db.Query(ctx, `
		SELECT id, route_id, days_of_week, depart_time, total_seats, fare_kobo, horizon_days
		FROM bus_departure_templates WHERE active = TRUE`)
	if err != nil {
		return 0, fmt.Errorf("transport: MaterializeBusDepartures: load templates: %w", err)
	}
	type tmpl struct {
		id, routeID, departTime string
		days                    []int32
		totalSeats, horizonDays int
		fareKobo                int64
	}
	var templates []tmpl
	for rows.Next() {
		var t tmpl
		if err := rows.Scan(&t.id, &t.routeID, &t.days, &t.departTime, &t.totalSeats, &t.fareKobo, &t.horizonDays); err != nil {
			rows.Close()
			return 0, fmt.Errorf("transport: MaterializeBusDepartures: scan template: %w", err)
		}
		templates = append(templates, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("transport: MaterializeBusDepartures: iterate templates: %w", err)
	}

	now := time.Now()
	base := now.In(loc)
	base = time.Date(base.Year(), base.Month(), base.Day(), 0, 0, 0, 0, loc)

	total := 0
	for _, t := range templates {
		hh, mm, ok := parseDepartHHMM(t.departTime)
		if !ok {
			log.Printf("transport: MaterializeBusDepartures: template %s has invalid depart_time %q, skipping", t.id, t.departTime)
			continue
		}
		dayset := make(map[int]bool, len(t.days))
		for _, d := range t.days {
			dayset[int(d)] = true
		}
		horizon := t.horizonDays
		if horizon <= 0 {
			horizon = defaultHorizonDays
		}
		inserted := 0
		var terr error
		for offset := 0; offset <= horizon; offset++ {
			day := base.AddDate(0, 0, offset)
			// int(Weekday) is 0=Sunday..6=Saturday, matching days_of_week storage.
			if !dayset[int(day.Weekday())] {
				continue
			}
			dep := time.Date(day.Year(), day.Month(), day.Day(), hh, mm, 0, 0, loc)
			if dep.Before(now) { // skip departures already in the past
				continue
			}
			// ON CONFLICT predicate mirrors the migration's partial unique index
			// bus_schedules_template_dep_uniq EXACTLY.
			tag, ierr := s.db.Exec(ctx, `
				INSERT INTO bus_schedules
					(id, route_id, departure_time, total_seats, fare_kobo, fare_approved, status, template_id)
				VALUES ($1,$2,$3,$4,$5,TRUE,'scheduled',$6)
				ON CONFLICT (template_id, departure_time) WHERE template_id IS NOT NULL DO NOTHING`,
				uuid.New().String(), t.routeID, dep, t.totalSeats, t.fareKobo, t.id)
			if ierr != nil {
				terr = ierr
				break
			}
			inserted += int(tag.RowsAffected())
		}
		if terr != nil {
			// Per-template error: log and continue — one bad template must not
			// abort materialization for the rest of the batch.
			log.Printf("transport: MaterializeBusDepartures: template %s: %v", t.id, terr)
			continue
		}
		total += inserted
	}
	return total, nil
}

// ─── Small pure helpers ──────────────────────────────────────────────────────

// validateDaysOfWeek enforces a non-empty subset of 0..6 (Sunday..Saturday).
func validateDaysOfWeek(days []int) error {
	if len(days) == 0 {
		return codedErr(http.StatusBadRequest, CodeInvalidState, "days_of_week must be non-empty")
	}
	for _, d := range days {
		if d < 0 || d > 6 {
			return codedErr(http.StatusBadRequest, CodeInvalidState, "days_of_week values must be 0..6")
		}
	}
	return nil
}

// parseDepartHHMM parses a validated 'HH:MM' string into hour/minute, reporting
// ok=false when either component is out of range (00-23 / 00-59).
func parseDepartHHMM(s string) (hour, min int, ok bool) {
	t, err := time.Parse("15:04", s)
	if err != nil {
		return 0, 0, false
	}
	return t.Hour(), t.Minute(), true
}

// intSliceToInt32 converts a request []int to the []int32 pgx encodes as int4[].
func intSliceToInt32(in []int) []int32 {
	out := make([]int32, len(in))
	for i, v := range in {
		out[i] = int32(v)
	}
	return out
}

// int32SliceToInt converts a scanned int4[] ([]int32) back to []int for JSON.
func int32SliceToInt(in []int32) []int {
	out := make([]int, len(in))
	for i, v := range in {
		out[i] = int(v)
	}
	return out
}
