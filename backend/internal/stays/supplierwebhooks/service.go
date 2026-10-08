package supplierwebhooks

import (
	"context"
	"crypto/hmac"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/stays/ari"
	"spotlight/backend/internal/stays/reservation"
)

const (
	keyError = "error"
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
	want := cryptox.HMACSHA256Hex(s.secret, string(body))
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
		return errors.New("supplierwebhooks: nil pool")
	}
	if ev.Source == "" || ev.ExternalEventID == "" || ev.EventType == "" {
		return errors.New("supplierwebhooks: source, external_event_id, event_type required")
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
		return errors.New("rate.updated: rate_plan_id + date required")
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
		return errors.New("availability.updated: room_type_id + date required")
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
		return errors.New("restriction.updated: rate_plan_id + date_from + date_to required")
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
		return errors.New("stop_sell.toggled: room_type_id + date_from + date_to required")
	}
	stop := boolVal(ev.Payload, "stop_sell")
	e := ari.BulkEdit{DateFrom: from, DateTo: to, StopSell: &stop}
	_, err := s.ari.BulkEditAvailability(ctx, rt, e)
	return err
}

// allowedInboundStates is the set of lifecycle targets a supplier may drive
// inbound. CANCELLED_BY_GUEST is deliberately absent — a supplier cannot speak
// for the guest.
var allowedInboundStates = map[string]bool{
	string(reservation.StateCancelledByHotel): true,
	string(reservation.StateConfirmed):        true,
	string(reservation.StateCompleted):        true,
	string(reservation.StateNoShow):           true,
}

// applyReservation handles reservation.* sync events. The write is FSM-guarded:
// the update carries an `AND state = <current>` predicate derived from
// reservation.InboundSources, so an event can only move a row along a legal
// edge. A stale/duplicate event on a dead row is a consumed no-op; an illegal
// edge off a live row fails the event so ops sees it. A hotel-side cancel
// drives the shared refund machinery before the terminal flip.
func (s *Service) applyReservation(ctx context.Context, ev Event) error {
	rid := str(ev.Payload, "reservation_id")
	state := str(ev.Payload, "state")
	if rid == "" || state == "" {
		return errors.New("reservation.*: reservation_id + state required")
	}
	if !allowedInboundStates[state] {
		return fmt.Errorf("reservation.*: unsupported inbound state %q", state)
	}
	target := reservation.State(state)
	sources := reservation.InboundSources(target)

	var cur string
	if err := s.db.QueryRow(ctx,
		`SELECT state FROM public.stays_reservation WHERE id = $1`, rid).Scan(&cur); err != nil {
		return fmt.Errorf("reservation.*: reservation %s lookup: %w", rid, err)
	}
	if !slices.Contains(sources, cur) {
		// Already-target or terminal source: stale/duplicate event — consume it.
		if cur == state || reservation.State(cur).IsTerminal() {
			return nil
		}
		// Illegal transition on a live row: protocol violation — fail the event.
		return fmt.Errorf("reservation.*: illegal transition %s → %s", cur, state)
	}
	if target == reservation.StateCancelledByHotel {
		return s.applyHotelCancel(ctx, rid, str(ev.Payload, "reason"))
	}
	// Non-cancel flips take the same reservation advisory lock the refund
	// sagas hold — otherwise a flip can commit between a saga's leg posts and
	// its terminal update, leaving a payable-looking row with posted refund
	// legs. State is re-read under the lock.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("reservation.*: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtext($1))`, "stays:reservation:"+rid); err != nil {
		return fmt.Errorf("reservation.*: lock %s: %w", rid, err)
	}
	if err := tx.QueryRow(ctx,
		`SELECT state FROM public.stays_reservation WHERE id = $1`, rid).Scan(&cur); err != nil {
		return fmt.Errorf("reservation.*: reservation %s lookup: %w", rid, err)
	}
	if !slices.Contains(sources, cur) {
		// The row moved while we waited on the lock — re-apply the same rules:
		// already-target or terminal ⇒ consume; illegal on a live row ⇒ fail.
		if cur == state || reservation.State(cur).IsTerminal() {
			return nil
		}
		return fmt.Errorf("reservation.*: illegal transition %s → %s", cur, state)
	}
	ct, err := tx.Exec(ctx, `
		UPDATE public.stays_reservation
		SET state = $2, version = version + 1, updated_at = now()
		WHERE id = $1 AND state = $3`, rid, state, cur)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		// The row moved between lock-read and write — consume the event.
		return nil
	}
	return tx.Commit(ctx)
}

// applyHotelCancel runs a supplier-reported hotel cancel through the shared
// refund machinery (reservation.RefundOps) under the 'stays:refund:<id>' /
// 'stays:hotelcancel:<id>:refund' families, so a raced extranet or guest cancel
// converges rather than double-paying. A refund failure leaves the row
// non-terminal so the event can be re-driven.
func (s *Service) applyHotelCancel(ctx context.Context, reservationID, reason string) error {
	_, err := s.refundOps().CancelByHotel(ctx, reservationID, reason)
	return err
}

// refundOps builds the shared cancel-refund machinery over this service's pool
// (built here so the app wiring keeps its constructor signature).
func (s *Service) refundOps() *reservation.RefundOps {
	return reservation.NewRefundOps(
		reservation.NewRepository(s.db),
		ledger.NewService(ledger.NewRepository(s.db), nil))
}

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

// Handler exposes the Rail-B supplier webhook endpoint. The raw body is read for
// HMAC verification BEFORE JSON parsing, then the event is ingested idempotently.
type Handler struct {
	svc *Service
}

// NewHandler constructs the webhooks handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register wires the webhook route onto the webhooks group. The route is unauthen-
// ticated (no member JWT) and verified by HMAC signature instead.
//
//	POST /internal/webhooks/stays-supplier   (header: X-Stays-Signature)
func (h *Handler) Register(g *gin.RouterGroup) {
	g.POST("/stays-supplier", h.Receive)
}

// Receive verifies the signature, parses the event, and ingests it idempotently.
func (h *Handler) Receive(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "cannot read body"})
		return
	}
	// Signature verification (fail-closed: no secret configured → reject).
	sig := c.GetHeader("X-Stays-Signature")
	if verr := h.svc.VerifySignature(body, sig); verr != nil {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: "invalid signature"})
		return
	}
	var ev Event
	if err := json.Unmarshal(body, &ev); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid json"})
		return
	}
	if err := h.svc.Ingest(c.Request.Context(), ev); err != nil {
		if errors.Is(err, ErrDuplicate) {
			// Idempotent replay — acknowledge so the supplier stops retrying.
			c.JSON(http.StatusOK, gin.H{"data": gin.H{"status": "duplicate"}})
			return
		}
		c.JSON(http.StatusUnprocessableEntity, gin.H{keyError: httperr.Msg(c, http.StatusUnprocessableEntity, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"status": "applied"}})
}
