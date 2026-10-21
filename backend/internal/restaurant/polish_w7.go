package restaurant

// Wave 7 polish: service-fee policy (C-010), prep-time fan-out (D-008), tracking ETA
// (E-014), dispute evidence (F-005b), rider incident reports (F-006).

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// ---------------------------------------------------------------- C-010 service fee policy

// Service-fee rounding modes (restaurants.service_fee_round_mode). The unit is ₦1.
const (
	FeeRoundNone    = "none"
	FeeRoundNearest = "nearest_naira"
	FeeRoundUp      = "up_naira"
	FeeRoundDown    = "down_naira"
	koboPerNaira    = int64(100)
)

// ApplyServiceFeePolicy rounds the bp-derived service fee to a whole naira per mode and
// then clamps it into [minKobo, maxKobo] (nil = unbounded). Pure, integer-only. A zero
// fee stays zero: a restaurant with no service fee configured never gets a floor
// charged. Clamping runs last so the bounds always hold exactly.
func ApplyServiceFeePolicy(feeKobo int64, minKobo, maxKobo *int64, mode string) int64 {
	if feeKobo <= 0 {
		return 0
	}
	switch mode {
	case FeeRoundNearest:
		feeKobo = (feeKobo + koboPerNaira/2) / koboPerNaira * koboPerNaira
	case FeeRoundUp:
		feeKobo = (feeKobo + koboPerNaira - 1) / koboPerNaira * koboPerNaira
	case FeeRoundDown:
		feeKobo = feeKobo / koboPerNaira * koboPerNaira
	}
	if minKobo != nil && feeKobo < *minKobo {
		feeKobo = *minKobo
	}
	if maxKobo != nil && feeKobo > *maxKobo {
		feeKobo = *maxKobo
	}
	return feeKobo
}

// serviceFeePolicyKobo applies the restaurant's stored policy to a computed fee. A read
// failure (or a deployment whose migration has not landed) leaves the fee unchanged —
// the policy only refines the bp fee, it never blocks an order.
func (s *Service) serviceFeePolicyKobo(ctx context.Context, restaurantID string, feeKobo int64) int64 {
	if feeKobo <= 0 || s.db == nil {
		return feeKobo
	}
	var minK, maxK *int64
	var mode string
	if err := s.db.QueryRow(ctx,
		`SELECT service_fee_min_kobo, service_fee_max_kobo, COALESCE(service_fee_round_mode,'none') FROM restaurants WHERE id=$1`,
		restaurantID).Scan(&minK, &maxK, &mode); err != nil {
		return feeKobo
	}
	return ApplyServiceFeePolicy(feeKobo, minK, maxK, mode)
}

// ---------------------------------------------------------------- D-008 prep-time fan-out

// EventPrepTimeChanged tells a customer with an open order that the kitchen's prep ETA moved.
const EventPrepTimeChanged = "restaurant.order.prep_time_changed"

var openOrderStatuses = []string{string(OrderPending), string(OrderConfirmed), string(OrderPreparing)}

// NotifyOpenOrdersPrepChanged tells every customer whose order at restaurantID is still
// being prepared the new prep ETA (FOOD-UAT-D-008). Best-effort: notification failures
// are logged inside notify and never fail the prep edit. Returns customers notified.
func (s *Service) NotifyOpenOrdersPrepChanged(ctx context.Context, restaurantID string, prepMinutes int) int {
	rows, err := s.db.Query(ctx,
		`SELECT id::text, customer_id::text FROM orders WHERE restaurant_id=$1 AND status = ANY($2)`,
		restaurantID, openOrderStatuses)
	if err != nil {
		return 0
	}
	type ord struct{ id, customer string }
	var open []ord
	for rows.Next() {
		var o ord
		if rows.Scan(&o.id, &o.customer) == nil {
			open = append(open, o)
		}
	}
	rows.Close()
	for _, o := range open {
		s.notify(ctx, Notification{UserID: o.customer, Event: EventPrepTimeChanged,
			Title: "Prep time updated",
			Body:  fmt.Sprintf("The kitchen now estimates about %d minutes to prepare your order.", prepMinutes),
			Data:  map[string]any{"order_id": o.id, "prep_minutes": prepMinutes}})
	}
	return len(open)
}

// ---------------------------------------------------------------- E-014 tracking ETA

// riderAvgKmh is the fallback average courier speed when no road-distance provider is wired.
const riderAvgKmh = 20.0

// TrackingETAMinutes estimates minutes to drop-off from the rider's current position:
// road ETA when a RouteDistancer is wired, else straight-line distance at riderAvgKmh.
// When the order has no delivery coordinates it falls back to the placement ETA
// (prep + delivery estimate stored on the order). nil = unknown.
func (s *Service) TrackingETAMinutes(ctx context.Context, orderID string, riderLat, riderLng float64) *int {
	var dLat, dLng *float64
	var placementEta *float64
	if err := s.db.QueryRow(ctx,
		`SELECT delivery_latitude::float8, delivery_longitude::float8, eta_minutes::float8 FROM orders WHERE id=$1`,
		orderID).Scan(&dLat, &dLng, &placementEta); err != nil {
		return nil
	}
	if dLat != nil && dLng != nil {
		var eta float64
		if s.distancer != nil {
			if _, e, err := s.distancer.RouteDistanceKmEta(ctx, riderLat, riderLng, *dLat, *dLng); err == nil && e > 0 {
				eta = e
			}
		}
		if eta == 0 {
			eta = HaversineKm(riderLat, riderLng, *dLat, *dLng) / riderAvgKmh * 60
		}
		m := int(eta + 0.5)
		if m < 1 {
			m = 1
		}
		return &m
	}
	if placementEta != nil && *placementEta > 0 {
		m := int(*placementEta + 0.5)
		return &m
	}
	return nil
}

// ---------------------------------------------------------------- F-005b dispute evidence

// MaxDisputeEvidence bounds attachments per dispute.
const MaxDisputeEvidence = 10

// DisputeEvidence is one attached photo/document.
type DisputeEvidence struct {
	ID         string    `json:"id"`
	DisputeID  string    `json:"dispute_id"`
	UploaderID string    `json:"uploader_id"`
	URL        string    `json:"url"`
	Caption    string    `json:"caption,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

func validEvidenceURL(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != ""
}

// AttachDisputeEvidence lets a party to the dispute's order attach an evidence URL while
// the dispute is still open / in review.
func (s *Service) AttachDisputeEvidence(ctx context.Context, disputeID, actorID, evidenceURL, caption string) (*DisputeEvidence, error) {
	if !validEvidenceURL(evidenceURL) {
		return nil, fmt.Errorf("%w: evidence url must be an http(s) URL", ErrDisputeInvalid)
	}
	d, err := s.loadFoodDispute(ctx, disputeID)
	if err != nil {
		return nil, err
	}
	customer, owner, rider, perr := s.disputeOrderParties(ctx, d.OrderID)
	if perr != nil {
		return nil, perr
	}
	if classifyOrderActor(actorID, customer, owner, rider) == roleNone {
		return nil, fmt.Errorf("%w: not a party to this dispute", ErrForbidden)
	}
	if d.Status != "open" && d.Status != "in_review" {
		return nil, fmt.Errorf("%w: evidence can only be attached to an open dispute", ErrDisputeInvalid)
	}
	var n int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM restaurant_dispute_evidence WHERE dispute_id=$1`, disputeID).Scan(&n); err != nil {
		return nil, err
	}
	if n >= MaxDisputeEvidence {
		return nil, fmt.Errorf("%w: at most %d attachments per dispute", ErrDisputeInvalid, MaxDisputeEvidence)
	}
	ev := &DisputeEvidence{ID: uuid.New().String(), DisputeID: disputeID, UploaderID: actorID,
		URL: strings.TrimSpace(evidenceURL), Caption: strings.TrimSpace(caption), CreatedAt: time.Now()}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO restaurant_dispute_evidence (id, dispute_id, uploader_id, url, caption) VALUES ($1,$2,$3,$4,NULLIF($5,''))`,
		ev.ID, ev.DisputeID, ev.UploaderID, ev.URL, ev.Caption); err != nil {
		return nil, fmt.Errorf("restaurant: attach dispute evidence: %w", err)
	}
	return ev, nil
}

// ListDisputeEvidence returns attachments for a dispute to a party to it.
func (s *Service) ListDisputeEvidence(ctx context.Context, disputeID, actorID string) ([]DisputeEvidence, error) {
	if _, err := s.GetFoodDispute(ctx, disputeID, actorID); err != nil {
		return nil, err
	}
	return s.listDisputeEvidence(ctx, disputeID)
}

func (s *Service) listDisputeEvidence(ctx context.Context, disputeID string) ([]DisputeEvidence, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id::text, dispute_id::text, uploader_id::text, url, COALESCE(caption,''), created_at
		   FROM restaurant_dispute_evidence WHERE dispute_id=$1 ORDER BY created_at`, disputeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DisputeEvidence{}
	for rows.Next() {
		var e DisputeEvidence
		if err := rows.Scan(&e.ID, &e.DisputeID, &e.UploaderID, &e.URL, &e.Caption, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// AttachDisputeEvidence → POST /restaurant/disputes/:id/evidence {url, caption?} (party).
func (h *Handler) AttachDisputeEvidence(c *gin.Context) {
	var body struct {
		URL     string `json:"url" binding:"required"`
		Caption string `json:"caption"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	ev, err := h.svc.AttachDisputeEvidence(c.Request.Context(), c.Param("id"), ginutil.UserID(c), body.URL, body.Caption)
	if err != nil {
		c.JSON(disputeErrCode(err), gin.H{keyError: httperr.Msg(c, disputeErrCode(err), err)})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"evidence": ev})
}

// ListDisputeEvidence → GET /restaurant/disputes/:id/evidence (party).
func (h *Handler) ListDisputeEvidence(c *gin.Context) {
	list, err := h.svc.ListDisputeEvidence(c.Request.Context(), c.Param("id"), ginutil.UserID(c))
	if err != nil {
		c.JSON(disputeErrCode(err), gin.H{keyError: httperr.Msg(c, disputeErrCode(err), err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"evidence": list})
}

// ---------------------------------------------------------------- F-006 rider incidents

// ErrIncidentInvalid: bad kind / description. HTTP 422.
var ErrIncidentInvalid = errors.New("restaurant: invalid incident report")

// EventRiderIncident is the admin-alert notification event.
const EventRiderIncident = "restaurant.rider.incident"

var incidentKinds = map[string]bool{"unsafe_dropoff": true, "accident": true, "harassment": true, "theft": true, "other": true}

// RiderIncident is a rider-filed safety report.
type RiderIncident struct {
	ID          string    `json:"id"`
	OrderID     string    `json:"order_id"`
	RiderID     string    `json:"rider_id"`
	Kind        string    `json:"kind"`
	Description string    `json:"description"`
	Lat         *float64  `json:"lat,omitempty"`
	Lng         *float64  `json:"lng,omitempty"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

// ReportRiderIncident records a safety incident from the order's ASSIGNED rider, writes
// an audit event, and raises an admin alert (notification to every admin the notifier
// resolves for the empty-user "ops" channel plus a warning-severity audit row).
func (s *Service) ReportRiderIncident(ctx context.Context, orderID, riderID, kind, description string, lat, lng *float64) (*RiderIncident, error) {
	kind = strings.TrimSpace(kind)
	description = strings.TrimSpace(description)
	if !incidentKinds[kind] {
		return nil, fmt.Errorf("%w: kind must be one of unsafe_dropoff, accident, harassment, theft, other", ErrIncidentInvalid)
	}
	if len(description) < 5 || len(description) > 2000 {
		return nil, fmt.Errorf("%w: description must be 5-2000 characters", ErrIncidentInvalid)
	}
	_, _, assigned, err := s.orderParties(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if assigned == "" || assigned != riderID {
		return nil, fmt.Errorf("%w: only the assigned rider may report an incident", ErrForbidden)
	}
	if lat != nil && lng != nil && !validGeoPointPair(lat, lng) {
		return nil, fmt.Errorf("%w: invalid coordinates", ErrIncidentInvalid)
	}
	inc := &RiderIncident{ID: uuid.New().String(), OrderID: orderID, RiderID: riderID, Kind: kind,
		Description: description, Lat: lat, Lng: lng, Status: "open", CreatedAt: time.Now()}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO restaurant_rider_incidents (id, order_id, rider_id, kind, description, lat, lng) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		inc.ID, orderID, riderID, kind, description, lat, lng); err != nil {
		return nil, fmt.Errorf("restaurant: record rider incident: %w", err)
	}
	if s.audit != nil {
		s.audit.LogAction(riderID, "", "restaurant.rider.incident", "restaurant", "restaurant_rider_incident", inc.ID,
			nil, map[string]any{"order_id": orderID, "kind": kind}, "", "", "critical")
	}
	s.notify(ctx, Notification{UserID: "", Event: EventRiderIncident,
		Title: "Rider incident reported", Body: kind + ": " + description,
		Data: map[string]any{"incident_id": inc.ID, "order_id": orderID, "rider_id": riderID, "kind": kind}})
	return inc, nil
}

// AdminListRiderIncidents lists incidents (newest first), optionally by status.
func (s *Service) AdminListRiderIncidents(ctx context.Context, status string, limit, offset int) ([]RiderIncident, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id::text, order_id::text, rider_id::text, kind, description, lat, lng, status, created_at
		   FROM restaurant_rider_incidents WHERE ($1='' OR status=$1) ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		status, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RiderIncident{}
	for rows.Next() {
		var r RiderIncident
		if err := rows.Scan(&r.ID, &r.OrderID, &r.RiderID, &r.Kind, &r.Description, &r.Lat, &r.Lng, &r.Status, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ReportRiderIncident → POST /restaurant/orders/:orderId/incident {kind, description, lat?, lng?}.
func (h *Handler) ReportRiderIncident(c *gin.Context) {
	var body struct {
		Kind        string   `json:"kind" binding:"required"`
		Description string   `json:"description" binding:"required"`
		Lat         *float64 `json:"lat"`
		Lng         *float64 `json:"lng"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	inc, err := h.svc.ReportRiderIncident(c.Request.Context(), c.Param("orderId"), ginutil.UserID(c), body.Kind, body.Description, body.Lat, body.Lng)
	if err != nil {
		st := http.StatusBadRequest
		switch {
		case errors.Is(err, ErrForbidden):
			st = http.StatusForbidden
		case errors.Is(err, ErrIncidentInvalid):
			st = http.StatusUnprocessableEntity
		}
		c.JSON(st, gin.H{keyError: httperr.Msg(c, st, err)})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"incident": inc})
}

// AdminListRiderIncidents → GET /api/restaurant/admin/rider-incidents?status=&limit=&offset=.
func (h *Handler) AdminListRiderIncidents(c *gin.Context) {
	limit, offset := ginutil.LimitOffset(c)
	list, err := h.svc.AdminListRiderIncidents(c.Request.Context(), c.Query("status"), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"incidents": list})
}

