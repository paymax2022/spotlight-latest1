package maps

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// orchestrator.go — the heart of MapService v2: the cheapest-accurate-first
// resolution chain (MAPSERVICE.md §4). Runs only when v2Enabled. Every step is
// nil-safe; selection is deterministic and emitted as a ResolutionEvent (MS-7).
//
//	gazetteer → cache → prediction → coverage-ordered providers (OSM↔Google/HERE)
//	with confidence escalation (τ) and a NEEDS_PIN floor (τ_floor).

// ctxUserID extracts the authenticated user id from context if a middleware set
// it (used by the predictor). Empty when unknown — prediction is simply skipped.
type ctxKey string

const CtxUserID ctxKey = "user_id"

func userIDFromCtx(ctx context.Context) string {
	if v, ok := ctx.Value(CtxUserID).(string); ok {
		return v
	}
	return ""
}

// forwardV2 is the v2 ForwardGeocode resolution chain.
func (s *Service) forwardV2(ctx context.Context, address, surface, requestType string, near *Point) (GeoResult, error) {
	norm := NormalizeQuery(address)
	th := s.v2cfg.thresholdsFor(requestType)
	userID := userIDFromCtx(ctx)
	areaCell := ""
	if near != nil {
		areaCell = CellKey(near.Lat, near.Lng)
	}

	// 1. Gazetteer — our verified points. Zero external cost (MS-2).
	if r, ok, err := s.gaz.Lookup(ctx, norm, areaCell); err == nil && ok {
		r.Source = SourceGazetteer
		s.emit(ctx, requestType, surface, "gazetteer", r, false, 0, false, userID)
		return r, nil
	}

	// 2. Cache — OSM-licensed write-through. Any hit is acceptable (MS-2).
	if hit, ok := s.cache.Get(ctx, norm); ok {
		mx.cacheHitInc()
		s.emit(ctx, requestType, surface, "cache", hit, false, 0, false, userID)
		return hit, nil
	}
	mx.cacheMissInc()

	// 3. Prediction — from the user's own history. Zero external cost (MS-2).
	if userID != "" {
		if r, ok, err := s.predictor.Predict(ctx, userID, norm, near); err == nil && ok && r.Confidence >= th.Escalate {
			r.Source = SourcePrediction
			s.emit(ctx, requestType, surface, "prediction", r, false, 0, false, userID)
			return r, nil
		}
	}

	// 4. Coverage-aware provider order (MS-3).
	tier := TierFair
	if areaCell != "" {
		tier = s.coverage.Tier(ctx, areaCell)
	}
	order := s.v2cfg.orderFor(tier)

	// 5. Escalate through the chain until confidence ≥ τ (stop spending early).
	var best GeoResult
	haveBest, escalated, paidCalls := false, false, 0
	for _, name := range order {
		gc, ok := s.reg.Geocoders[name]
		if !ok {
			continue
		}
		if !s.guard.Allow(ctx, name, PrimGeocode) { // budget/circuit (MS-6)
			continue
		}
		if haveBest {
			escalated = true
		}
		s.usage.Record(ctx, name, PrimGeocode)
		paidCalls++
		start := time.Now()
		r, err := gc.Geocode(ctx, address)
		s.guard.Observe(ctx, name, err == nil, time.Since(start).Milliseconds())
		if err != nil {
			continue
		}
		if r.PlusCode == "" {
			r.PlusCode = s.codec.Encode(r.Lat, r.Lng)
		}
		if r.H3Cell == "" {
			r.H3Cell = PointCellKey(r.Lat, r.Lng)
		}
		if !haveBest || r.Confidence > best.Confidence {
			best, haveBest = r, true
		}
		if r.Confidence >= th.Escalate {
			break // good enough — stop escalating
		}
	}

	// 6. NEEDS_PIN — never hard-fail (MS-6).
	if !haveBest || best.Confidence < th.PinFloor {
		s.emit(ctx, requestType, surface, "needs_pin", best, escalated, paidCalls, true, userID)
		return GeoResult{}, ErrNeedsPin
	}

	// 7. Cache write-through (OSM-licensed only) (MS-7). Uses per-source TTL when
	// the wired cache is CacheV2 (cachePut prefers PutWithSource), else fixed TTL.
	if best.Cacheable {
		if err := s.cachePut(ctx, norm, best); err != nil {
			// non-fatal; license guard may refuse non-OSM results
			_ = err
		}
	}

	// 8. Self-improvement + audit (MS-3, MS-7).
	_ = s.coverage.Observe(ctx, CellKey(best.Lat, best.Lng), string(best.Source), escalated, best.Confidence)
	s.emit(ctx, requestType, surface, string(best.Source), best, escalated, paidCalls, false, userID)
	return best, nil
}

// reverseV2 mirrors forwardV2 for reverse geocoding (gazetteer/cache → coverage-
// ordered providers → NEEDS_PIN). The area cell is known from the coordinate.
func (s *Service) reverseV2(ctx context.Context, lat, lng float64, surface, requestType string) (GeoResult, error) {
	th := s.v2cfg.thresholdsFor(requestType)
	userID := userIDFromCtx(ctx)
	areaCell := CellKey(lat, lng)
	key := NormalizeQuery(fmt.Sprintf("%.5f,%.5f", lat, lng))

	if r, ok, err := s.gaz.ReverseLookup(ctx, areaCell, lat, lng); err == nil && ok {
		r.Source = SourceGazetteer
		s.emit(ctx, requestType, surface, "gazetteer", r, false, 0, false, userID)
		return r, nil
	}
	if hit, ok := s.cache.Get(ctx, key); ok {
		mx.cacheHitInc()
		s.emit(ctx, requestType, surface, "cache", hit, false, 0, false, userID)
		return hit, nil
	}
	mx.cacheMissInc()

	order := s.v2cfg.orderFor(s.coverage.Tier(ctx, areaCell))
	var best GeoResult
	haveBest, escalated, paidCalls := false, false, 0
	for _, name := range order {
		gc, ok := s.reg.Geocoders[name]
		if !ok || !s.guard.Allow(ctx, name, PrimReverse) {
			continue
		}
		if haveBest {
			escalated = true
		}
		s.usage.Record(ctx, name, PrimReverse)
		paidCalls++
		start := time.Now()
		r, err := gc.ReverseGeocode(ctx, lat, lng)
		s.guard.Observe(ctx, name, err == nil, time.Since(start).Milliseconds())
		if err != nil {
			continue
		}
		if r.PlusCode == "" {
			r.PlusCode = s.codec.Encode(r.Lat, r.Lng)
		}
		if r.H3Cell == "" {
			r.H3Cell = PointCellKey(r.Lat, r.Lng)
		}
		if !haveBest || r.Confidence > best.Confidence {
			best, haveBest = r, true
		}
		if r.Confidence >= th.Escalate {
			break
		}
	}
	if !haveBest || best.Confidence < th.PinFloor {
		s.emit(ctx, requestType, surface, "needs_pin", best, escalated, paidCalls, true, userID)
		return GeoResult{}, ErrNeedsPin
	}
	if best.Cacheable {
		_ = s.cachePut(ctx, key, best) // per-source TTL via CacheV2 when wired
	}
	_ = s.coverage.Observe(ctx, areaCell, string(best.Source), escalated, best.Confidence)
	s.emit(ctx, requestType, surface, string(best.Source), best, escalated, paidCalls, false, userID)
	return best, nil
}

// emit records a deterministic, auditable ResolutionEvent (MS-7). cost is the
// number of paid provider calls (0 when deflected by gazetteer/cache/prediction).
func (s *Service) emit(ctx context.Context, requestType, surface, chosenSource string, r GeoResult, escalated bool, cost int, pin bool, userID string) {
	tier := TierFair
	cell := r.H3Cell
	if cell == "" && (r.Lat != 0 || r.Lng != 0) {
		cell = CellKey(r.Lat, r.Lng)
	}
	if cell != "" {
		tier = s.coverage.Tier(ctx, cell)
	}
	_ = s.recorder.Record(ctx, ResolutionEvent{
		ID:           uuid.NewString(),
		RequestType:  requestType,
		Surface:      surface,
		H3Cell:       cell,
		Tier:         tier,
		ChosenSource: chosenSource,
		Provider:     r.Provider,
		Confidence:   r.Confidence,
		Escalated:    escalated,
		CostUnit:     cost,
		OutcomePin:   pin,
		UserID:       userID,
		TS:           time.Now(),
	})
}

// RecordConfirmedPin upgrades a confirmed location into the gazetteer and feeds
// the coverage index (MAPSERVICE.md §5/§6 self-improvement). Called by fulfilment
// flows when a courier/user confirms a precise pin. Safe no-op when v2 is off.
func (s *Service) RecordConfirmedPin(ctx context.Context, e GazetteerEntry) error {
	if !s.v2Enabled {
		return nil
	}
	if e.H3Cell == "" {
		e.H3Cell = PointCellKey(e.Lat, e.Lng)
	}
	if e.PlusCode == "" {
		e.PlusCode = s.codec.Encode(e.Lat, e.Lng)
	}
	if err := s.gaz.Upsert(ctx, e); err != nil {
		return err
	}
	// A confirmed pin is the strongest signal — promote the cell's coverage.
	return s.coverage.Observe(ctx, CellKey(e.Lat, e.Lng), "gazetteer", false, 1.0)
}
