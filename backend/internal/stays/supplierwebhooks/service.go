package supplierwebhooks

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/stays/ari"
)

// Sentinel errors.
var (
	// ErrBadSignature is returned when the HMAC signature does not verify.
	ErrBadSignature = errors.New("supplierwebhooks: invalid signature")
	// ErrDuplicate signals an already-applied event (idempotent no-op).
	ErrDuplicate = errors.New("supplierwebhooks: duplicate event")
)

// Service ingests Rail-B supplier webhooks: ARI pushes (rate.updated /
// availability.updated / restriction.updated / stop_sell.toggled) and reservation
// sync (reservation.*). Ingest is idempotent on (source, external_event_id) — the
// stays_ari_event UNIQUE makes a re-delivered webhook a safe no-op — and signature-
// verified (HMAC-SHA256) before any state is applied.
type Service struct {
	db     *pgxpool.Pool
	ari    *ari.Service
	secret string
}

// NewService constructs the webhooks service. secret is the shared HMAC secret read
// from the environment (never logged). An empty secret disables signature
// enforcement only when explicitly allowed by the handler (sandbox).
func NewService(db *pgxpool.Pool, ariSvc *ari.Service, secret string) *Service {
	return &Service{db: db, ari: ariSvc, secret: secret}
}

// HasSecret reports whether a signing secret is configured.
func (s *Service) HasSecret() bool { return s.secret != "" }

// VerifySignature checks an HMAC-SHA256 hex signature over the raw body. Constant-
// time compare. A "sha256=" prefix is tolerated.
func (s *Service) VerifySignature(body []byte, signature string) error {
	if s.secret == "" {
		return ErrBadSignature // fail-closed when no secret configured
	}
	sig := strings.TrimPrefix(strings.TrimSpace(signature), "sha256=")
	mac := hmac.New(sha256.New, []byte(s.secret))
	mac.Write(body)
	want := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(sig), []byte(want)) {
		return ErrBadSignature
	}
	return nil
}

// Event is the normalised inbound webhook envelope.
type Event struct {
	Source          string         `json:"source"` // supplier_code / channel id
	ExternalEventID string         `json:"external_event_id"`
	EventType       string         `json:"event_type"`
	Payload         map[string]any `json:"payload"`
}

// Ingest persists the event idempotently then applies it. A duplicate (source,
// external_event_id) returns ErrDuplicate and applies nothing (safe replay).
func (s *Service) Ingest(ctx context.Context, ev Event) error {
	if s.db == nil {
		return fmt.Errorf("supplierwebhooks: nil pool")
	}
	if ev.Source == "" || ev.ExternalEventID == "" || ev.EventType == "" {
		return fmt.Errorf("supplierwebhooks: source, external_event_id, event_type required")
	}
	// Idempotent claim — INSERT ... ON CONFLICT DO NOTHING returns 0 rows on replay.
	ct, err := s.db.Exec(ctx, `
		INSERT INTO public.stays_ari_event (source, external_event_id, event_type, payload, status)
		VALUES ($1,$2,$3,$4,'RECEIVED')
		ON CONFLICT (source, external_event_id) DO NOTHING`,
		ev.Source, ev.ExternalEventID, ev.EventType, orMap(ev.Payload))
	if err != nil {
		return fmt.Errorf("supplierwebhooks: claim event: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrDuplicate // already applied
	}

	applyErr := s.apply(ctx, ev)
	status := "APPLIED"
	errStr := ""
	if applyErr != nil {
		status = "FAILED"
		errStr = applyErr.Error()
	}
	_, _ = s.db.Exec(ctx, `
		UPDATE public.stays_ari_event SET status = $3, error = $4
		WHERE source = $1 AND external_event_id = $2`,
		ev.Source, ev.ExternalEventID, status, errStr)
	return applyErr
}

// apply dispatches on event type and applies it to ARI / reservation state.
func (s *Service) apply(ctx context.Context, ev Event) error {
	switch ev.EventType {
	case "rate.updated":
		return s.applyRate(ctx, ev)
	case "availability.updated":
		return s.applyAvailability(ctx, ev)
	case "restriction.updated":
		return s.applyRestriction(ctx, ev)
	case "stop_sell.toggled":
		return s.applyStopSell(ctx, ev)
	default:
		if strings.HasPrefix(ev.EventType, "reservation.") {
			return s.applyReservation(ctx, ev)
		}
		// Unknown type — recorded but ignored (forward-compat).
		return nil
	}
}

// applyRate upserts a per-date rate cell. Payload: {rate_plan_id, date, price_kobo,
// currency}.
func (s *Service) applyRate(ctx context.Context, ev Event) error {
	rp := str(ev.Payload, "rate_plan_id")
	date := str(ev.Payload, "date")
	if rp == "" || date == "" {
		return fmt.Errorf("rate.updated: rate_plan_id + date required")
	}
	return s.ari.SetRateDay(ctx, ari.RateDay{
		RatePlanID: rp,
		Date:       date,
		PriceKobo:  i64(ev.Payload, "price_kobo"),
		Currency:   strDefault(ev.Payload, "currency", "NGN"),
		MinLOS:     1,
	})
}

// applyAvailability upserts a per-date availability cell. Payload: {room_type_id,
// date, allotment, stop_sell}.
func (s *Service) applyAvailability(ctx context.Context, ev Event) error {
	rt := str(ev.Payload, "room_type_id")
	date := str(ev.Payload, "date")
	if rt == "" || date == "" {
		return fmt.Errorf("availability.updated: room_type_id + date required")
	}
	return s.ari.SetAvailabilityDay(ctx, ari.AvailabilityDay{
		RoomTypeID: rt,
		Date:       date,
		Allotment:  int(i64(ev.Payload, "allotment")),
		StopSell:   boolVal(ev.Payload, "stop_sell"),
	})
}

// applyRestriction upserts restriction fields over a date range. Payload:
// {rate_plan_id, date_from, date_to, min_los, max_los, cta, ctd}.
func (s *Service) applyRestriction(ctx context.Context, ev Event) error {
	rp := str(ev.Payload, "rate_plan_id")
	from := str(ev.Payload, "date_from")
	to := str(ev.Payload, "date_to")
	if rp == "" || from == "" || to == "" {
		return fmt.Errorf("restriction.updated: rate_plan_id + date_from + date_to required")
	}
	e := ari.BulkEdit{DateFrom: from, DateTo: to}
	if v, ok := ev.Payload["min_los"]; ok {
		n := int(toInt64(v))
		e.MinLOS = &n
	}
	if v, ok := ev.Payload["max_los"]; ok {
		n := int(toInt64(v))
		e.MaxLOS = &n
	}
	if v, ok := ev.Payload["cta"]; ok {
		b := toBool(v)
		e.CTA = &b
	}
	if v, ok := ev.Payload["ctd"]; ok {
		b := toBool(v)
		e.CTD = &b
	}
	_, err := s.ari.SetRestrictions(ctx, rp, e)
	return err
}

// applyStopSell toggles stop-sell over a room type's availability range. Payload:
// {room_type_id, date_from, date_to, stop_sell}.
func (s *Service) applyStopSell(ctx context.Context, ev Event) error {
	rt := str(ev.Payload, "room_type_id")
	from := str(ev.Payload, "date_from")
	to := str(ev.Payload, "date_to")
	if rt == "" || from == "" || to == "" {
		return fmt.Errorf("stop_sell.toggled: room_type_id + date_from + date_to required")
	}
	stop := boolVal(ev.Payload, "stop_sell")
	e := ari.BulkEdit{DateFrom: from, DateTo: to, StopSell: &stop}
	_, err := s.ari.BulkEditAvailability(ctx, rt, e)
	return err
}

// applyReservation handles reservation.* sync events (e.g. supplier-side cancel).
// Payload: {reservation_id, state}. State changes are applied directly (the supplier
// is authoritative for its own reservation lifecycle on Rail B inbound).
func (s *Service) applyReservation(ctx context.Context, ev Event) error {
	rid := str(ev.Payload, "reservation_id")
	state := str(ev.Payload, "state")
	if rid == "" || state == "" {
		return fmt.Errorf("reservation.*: reservation_id + state required")
	}
	// Only allow transitions into safe inbound states (supplier-driven).
	switch state {
	case "CANCELLED_BY_HOTEL", "CONFIRMED", "COMPLETED", "NO_SHOW":
	default:
		return fmt.Errorf("reservation.*: unsupported inbound state %q", state)
	}
	_, err := s.db.Exec(ctx, `
		UPDATE public.stays_reservation
		SET state = $2, version = version + 1, updated_at = now()
		WHERE id = $1`, rid, state)
	return err
}

// --- payload helpers ---

func orMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

func str(m map[string]any, k string) string {
	if v, ok := m[k]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func strDefault(m map[string]any, k, def string) string {
	if s := str(m, k); s != "" {
		return s
	}
	return def
}

func i64(m map[string]any, k string) int64 {
	if v, ok := m[k]; ok {
		return toInt64(v)
	}
	return 0
}

func boolVal(m map[string]any, k string) bool {
	if v, ok := m[k]; ok {
		return toBool(v)
	}
	return false
}

func toInt64(v any) int64 {
	switch t := v.(type) {
	case float64:
		return int64(t)
	case int64:
		return t
	case int:
		return int64(t)
	}
	return 0
}

func toBool(v any) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return false
}
