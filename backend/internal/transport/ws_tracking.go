package transport

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/maps"
	platformRedis "spotlight/backend/internal/platform/redis"
	"spotlight/backend/internal/platform/ws"
)

// ErrNotTripDriver is returned when a non-driver tries to stream a trip's position.
var ErrNotTripDriver = errors.New("transport: caller is not the trip driver")

// fanoutChannel carries trip position updates between backend instances so a
// rider connected to instance B receives updates from a driver posting to A.
const fanoutChannel = "ws:trip:fanout"

// PositionUpdate is the real-time payload pushed to a trip's participants.
type PositionUpdate struct {
	TripID          string   `json:"tripId"`
	Lat             float64  `json:"lat"`
	Lng             float64  `json:"lng"`
	Heading         *float64 `json:"heading,omitempty"`
	SpeedMPS        *float64 `json:"speedMps,omitempty"`
	SnappedPolyline string   `json:"snappedPolyline,omitempty"` // encoded; client decodes for the path
	TS              int64    `json:"ts"`
}

// TrackPoint is one raw GPS sample streamed by the driver app.
type TrackPoint struct {
	Lat     float64  `json:"lat" binding:"required"`
	Lng     float64  `json:"lng" binding:"required"`
	Heading *float64 `json:"heading,omitempty"`
	SpeedMPS *float64 `json:"speed_mps,omitempty"`
}

type tripTrace struct {
	points  []maps.Point
	updated time.Time
}

// TripTracker turns a driver's raw GPS stream into smoothed, real-time position
// pushes to the trip's rider + driver. GPS is ingested over an authenticated HTTP
// endpoint; the snapped position is fanned out over the WebSocket hub (and Redis
// pub/sub across instances). Snapping uses the provider-agnostic MapService
// (OSRM/OpenStack map-matching) — never a client-side maps API.
type TripTracker struct {
	db    *pgxpool.Pool
	hub   *ws.Hub
	maps  maps.MapService            // optional; when nil, positions are sent un-snapped
	redis *platformRedis.Client      // optional; when nil, fan-out is in-process only

	mu     sync.Mutex
	traces map[string]*tripTrace // tripID → recent points (for map-matching)
}

// NewTripTracker builds the tracker. mapsvc and redis may be nil.
func NewTripTracker(db *pgxpool.Pool, hub *ws.Hub, mapsvc maps.MapService, redis *platformRedis.Client) *TripTracker {
	return &TripTracker{db: db, hub: hub, maps: mapsvc, redis: redis, traces: map[string]*tripTrace{}}
}

// Start launches the cross-instance fan-out subscriber (no-op without Redis).
func (t *TripTracker) Start(ctx context.Context) {
	if t == nil || t.redis == nil {
		return
	}
	go t.subscribeLoop(ctx)
}

// participants returns the rider and (optional) driver user-ids for a trip.
func (t *TripTracker) participants(ctx context.Context, tripID string) (rider string, driver string, err error) {
	var d *string
	err = t.db.QueryRow(ctx, `SELECT rider_id, driver_id FROM trips WHERE id=$1`, tripID).Scan(&rider, &d)
	if err != nil {
		return "", "", err
	}
	if d != nil {
		driver = *d
	}
	return rider, driver, nil
}

// Ingest records one driver GPS sample, snaps the recent trace, and fans the
// position out to the trip's rider + driver in real time. Only the trip's driver
// may stream; anyone else gets ErrNotTripDriver.
func (t *TripTracker) Ingest(ctx context.Context, tripID, callerID string, p TrackPoint) error {
	rider, driver, err := t.participants(ctx, tripID)
	if err != nil {
		return err
	}
	if driver == "" || callerID != driver {
		return ErrNotTripDriver
	}

	// Append to the per-trip trace (used for map-matching), bounded + swept.
	t.mu.Lock()
	tr := t.traces[tripID]
	if tr == nil {
		tr = &tripTrace{}
		t.traces[tripID] = tr
	}
	tr.points = append(tr.points, maps.Point{Lat: p.Lat, Lng: p.Lng})
	if len(tr.points) > 30 {
		tr.points = tr.points[len(tr.points)-30:]
	}
	tr.updated = time.Now()
	trace := append([]maps.Point(nil), tr.points...)
	t.sweepLocked()
	t.mu.Unlock()

	// Snap the recent trace to roads (best-effort; never blocks the update).
	snapped := ""
	if t.maps != nil && len(trace) >= 2 {
		if poly, perr := t.maps.MatchToRoad(ctx, trace); perr == nil {
			snapped = poly.Encoded
		}
	}

	// Best-effort: keep the driver's last position fresh for driver "near me".
	if driver != "" {
		_, _ = t.db.Exec(ctx,
			`UPDATE drivers SET current_lat=$1, current_lng=$2, updated_at=NOW() WHERE user_id=$3`,
			p.Lat, p.Lng, driver)
	}

	msg := ws.Message{Type: "trip.position", Payload: PositionUpdate{
		TripID: tripID, Lat: p.Lat, Lng: p.Lng, Heading: p.Heading, SpeedMPS: p.SpeedMPS,
		SnappedPolyline: snapped, TS: time.Now().UnixMilli(),
	}}
	recipients := []string{rider}
	if driver != "" {
		recipients = append(recipients, driver)
	}
	t.fanout(ctx, recipients, msg)
	return nil
}

// fanout delivers to recipients. With Redis, publish once and let every instance
// (including this one) deliver via the subscriber — avoids double-delivery.
func (t *TripTracker) fanout(ctx context.Context, recipients []string, msg ws.Message) {
	if t.redis != nil {
		if b, err := json.Marshal(fanoutEnvelope{Recipients: recipients, Message: msg}); err == nil {
			_ = t.redis.Publish(ctx, fanoutChannel, b).Err()
			return
		}
	}
	for _, uid := range recipients {
		t.hub.SendToUser(uid, msg)
	}
}

type fanoutEnvelope struct {
	Recipients []string   `json:"recipients"`
	Message    ws.Message `json:"message"`
}

func (t *TripTracker) subscribeLoop(ctx context.Context) {
	sub := t.redis.Subscribe(ctx, fanoutChannel)
	defer func() { _ = sub.Close() }()
	for msg := range sub.Channel() {
		var env fanoutEnvelope
		if err := json.Unmarshal([]byte(msg.Payload), &env); err != nil {
			continue
		}
		for _, uid := range env.Recipients {
			t.hub.SendToUser(uid, env.Message) // delivers only to locally-connected clients
		}
	}
}

// sweepLocked drops traces idle for >30m so memory stays bounded. Caller holds mu.
func (t *TripTracker) sweepLocked() {
	if len(t.traces) < 256 {
		return
	}
	cutoff := time.Now().Add(-30 * time.Minute)
	for id, tr := range t.traces {
		if tr.updated.Before(cutoff) {
			delete(t.traces, id)
		}
	}
}
