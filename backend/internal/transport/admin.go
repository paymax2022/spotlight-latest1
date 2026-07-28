package transport

import (
	"context"
	"encoding/json"
	"net/http"
)

// AdminService wraps the transport Service for admin operations. Every mutation
// writes a transport_audit_log row (actor, action, entity, old/new, reason).
type AdminService struct {
	svc *Service
}

func NewAdminService(svc *Service) *AdminService { return &AdminService{svc: svc} }

// rawJSON decodes a JSONB column into a generic value for the audit feed.
func rawJSON(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return string(b)
	}
	return v
}

// ─── Dashboard / reports ─────────────────────────────────────────────────────

// Dashboard returns top-line mobility KPIs.
func (a *AdminService) Dashboard(ctx context.Context) (map[string]any, error) {
	db := a.svc.db
	var totalTrips, completed, cancelled, activeDrivers, openIncidents int
	db.QueryRow(ctx, `SELECT COUNT(*) FROM trips`).Scan(&totalTrips)
	db.QueryRow(ctx, `SELECT COUNT(*) FROM trips WHERE phase='completed'`).Scan(&completed)
	db.QueryRow(ctx, `SELECT COUNT(*) FROM trips WHERE phase IN ('cancelled','no_show')`).Scan(&cancelled)
	db.QueryRow(ctx, `SELECT COUNT(*) FROM drivers WHERE status IN ('online','on_trip') AND verification_status='approved'`).Scan(&activeDrivers)
	db.QueryRow(ctx, `SELECT COUNT(*) FROM safety_incidents WHERE status IN ('open','investigating','escalated')`).Scan(&openIncidents)

	var gbv, revenue, driverEarnings int64
	db.QueryRow(ctx, `SELECT COALESCE(SUM(total_kobo),0) FROM settlements WHERE module_type='transport' AND status='settled'`).Scan(&gbv)
	db.QueryRow(ctx, `SELECT COALESCE(SUM(fee_kobo),0) FROM settlements WHERE module_type='transport' AND status='settled'`).Scan(&revenue)
	db.QueryRow(ctx, `SELECT COALESCE(SUM(provider_kobo),0) FROM settlements WHERE module_type='transport' AND status='settled'`).Scan(&driverEarnings)

	completionRate, cancelRate := 0.0, 0.0
	if totalTrips > 0 {
		completionRate = float64(completed) / float64(totalTrips)
		cancelRate = float64(cancelled) / float64(totalTrips)
	}
	out := map[string]any{
		"total_trips":      totalTrips,
		"completed_trips":  completed,
		"cancelled_trips":  cancelled,
		"gbv_kobo":         gbv,
		"revenue_kobo":     revenue,
		"driver_earnings_kobo": driverEarnings,
		"completion_rate":  completionRate,
		"cancel_rate":      cancelRate,
		"open_safety_incidents": openIncidents,
		"active_drivers":   activeDrivers,
	}
	// Per-mode KPIs (parcel/bus/towing/movers/car-hire). Defensive: skip if the
	// mode tables are absent (e.g. migration not yet applied).
	if kpis := a.ModeKPIs(ctx); kpis != nil {
		out["modes"] = kpis
	}
	return out, nil
}

// ReportsSummary rolls up revenue/commission/trip/cancellation figures.
func (a *AdminService) ReportsSummary(ctx context.Context) (map[string]any, error) {
	db := a.svc.db
	var settledCount int
	var totalKobo, feeKobo, providerKobo int64
	db.QueryRow(ctx, `
		SELECT COUNT(*), COALESCE(SUM(total_kobo),0), COALESCE(SUM(fee_kobo),0), COALESCE(SUM(provider_kobo),0)
		FROM settlements WHERE module_type='transport' AND status='settled'`).
		Scan(&settledCount, &totalKobo, &feeKobo, &providerKobo)
	var totalTrips, cancelled int
	db.QueryRow(ctx, `SELECT COUNT(*) FROM trips`).Scan(&totalTrips)
	db.QueryRow(ctx, `SELECT COUNT(*) FROM trips WHERE phase IN ('cancelled','no_show')`).Scan(&cancelled)
	cancelRate := 0.0
	if totalTrips > 0 {
		cancelRate = float64(cancelled) / float64(totalTrips)
	}
	return map[string]any{
		"settled_trips":     settledCount,
		"gross_revenue_kobo": totalKobo,
		"commission_kobo":   feeKobo,
		"driver_payout_kobo": providerKobo,
		"total_trips":       totalTrips,
		"cancelled_trips":   cancelled,
		"cancel_rate":       cancelRate,
	}, nil
}

// ─── Drivers ─────────────────────────────────────────────────────────────────

func (a *AdminService) ListDrivers(ctx context.Context, status string) ([]map[string]any, error) {
	db := a.svc.db
	q := `SELECT id, user_id, name, vehicle_type, status, rating, verification_status, completed_trips, cancelled_trips, created_at FROM drivers`
	args := []any{}
	if status != "" {
		q += ` WHERE verification_status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT 200`
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, uid, name, vtype, st, vstatus string
		var rating float64
		var completed, cancelled int
		var createdAt any
		if err := rows.Scan(&id, &uid, &name, &vtype, &st, &rating, &vstatus, &completed, &cancelled, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "user_id": uid, "name": name, "vehicle_type": vtype, "status": st,
			"rating": rating, "verification_status": vstatus, "completed_trips": completed,
			"cancelled_trips": cancelled, "created_at": createdAt,
		})
	}
	return out, nil
}

func (a *AdminService) DriverDetail(ctx context.Context, driverID string) (map[string]any, error) {
	db := a.svc.db
	var uid string
	if err := db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, driverID).Scan(&uid); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "driver not found")
	}
	return a.svc.DriverMeFull(ctx, uid)
}

// SetVerification is a guarded driver-verification transition (audited).
func (a *AdminService) SetVerification(ctx context.Context, adminID, driverID, newStatus, reason string) error {
	db := a.svc.db
	var oldStatus string
	if err := db.QueryRow(ctx, `SELECT verification_status FROM drivers WHERE id=$1`, driverID).Scan(&oldStatus); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "driver not found")
	}
	// Guarded: only draft/submitted/under_review may move to a decision.
	allowed := map[string]bool{"draft": true, "submitted": true, "under_review": true}
	terminalReentry := map[string]bool{"approved": true, "rejected": true, "suspended": true}
	if !allowed[oldStatus] && !terminalReentry[oldStatus] {
		return codedErr(http.StatusConflict, CodeInvalidState, "cannot change verification from "+oldStatus)
	}
	if _, err := db.Exec(ctx, `UPDATE drivers SET verification_status=$1, updated_at=NOW() WHERE id=$2`, newStatus, driverID); err != nil {
		return err
	}
	// A rejected/suspended driver is forced offline.
	if newStatus == "rejected" || newStatus == "suspended" {
		db.Exec(ctx, `UPDATE drivers SET status='offline' WHERE id=$1`, driverID)
	}
	return writeAudit(ctx, db, adminID, "driver.verification", "driver", driverID,
		map[string]any{"verification_status": oldStatus}, map[string]any{"verification_status": newStatus}, reason)
}

// ─── Vehicles ────────────────────────────────────────────────────────────────

func (a *AdminService) ListVehicles(ctx context.Context, status string) ([]Vehicle, error) {
	db := a.svc.db
	q := `SELECT id, driver_id, plate_number, make, model, year, color, category, capacity,
	             inspection_status, insurance_status, status, created_at, updated_at FROM vehicles`
	args := []any{}
	if status != "" {
		q += ` WHERE status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT 200`
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Vehicle
	for rows.Next() {
		var v Vehicle
		if err := rows.Scan(&v.ID, &v.DriverID, &v.PlateNumber, &v.Make, &v.Model, &v.Year, &v.Color,
			&v.Category, &v.Capacity, &v.InspectionStatus, &v.InsuranceStatus, &v.Status, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

func (a *AdminService) SetVehicleStatus(ctx context.Context, adminID, vehicleID string, req VehicleStatusRequest) error {
	db := a.svc.db
	var oldStatus, oldInspection, oldInsurance string
	if err := db.QueryRow(ctx, `SELECT status, inspection_status, insurance_status FROM vehicles WHERE id=$1`, vehicleID).
		Scan(&oldStatus, &oldInspection, &oldInsurance); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "vehicle not found")
	}
	if _, err := db.Exec(ctx, `
		UPDATE vehicles SET
			status=COALESCE(NULLIF($1,''), status),
			inspection_status=COALESCE(NULLIF($2,''), inspection_status),
			insurance_status=COALESCE(NULLIF($3,''), insurance_status),
			updated_at=NOW()
		WHERE id=$4`, req.Status, req.InspectionStatus, req.InsuranceStatus, vehicleID); err != nil {
		return err
	}
	return writeAudit(ctx, db, adminID, "vehicle.status", "vehicle", vehicleID,
		map[string]any{"status": oldStatus, "inspection_status": oldInspection, "insurance_status": oldInsurance},
		map[string]any{"status": req.Status, "inspection_status": req.InspectionStatus, "insurance_status": req.InsuranceStatus}, req.Reason)
}

// ─── Trips / dispatch ────────────────────────────────────────────────────────

func (a *AdminService) ListTrips(ctx context.Context, phase string) ([]map[string]any, error) {
	db := a.svc.db
	q := `SELECT id, rider_id, driver_id, phase, status, fare_kobo, final_fare_kobo, safety_status, created_at FROM trips`
	args := []any{}
	if phase != "" {
		q += ` WHERE phase=$1`
		args = append(args, phase)
	}
	q += ` ORDER BY created_at DESC LIMIT 200`
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, rider, phase, status, safety string
		var driver *string
		var fare int64
		var finalFare *int64
		var createdAt any
		if err := rows.Scan(&id, &rider, &driver, &phase, &status, &fare, &finalFare, &safety, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "rider_id": rider, "driver_id": driver, "phase": phase, "status": status,
			"fare_kobo": fare, "final_fare_kobo": finalFare, "safety_status": safety, "created_at": createdAt,
		})
	}
	return out, nil
}

// DispatchLive returns active trips + online drivers + stuck/SOS flags.
func (a *AdminService) DispatchLive(ctx context.Context) (map[string]any, error) {
	activeTrips, err := a.ListTrips(ctx, "")
	if err != nil {
		return nil, err
	}
	// Filter to in-flight phases.
	var inflight []map[string]any
	for _, t := range activeTrips {
		switch t["phase"] {
		case "completed", "cancelled", "no_show":
		default:
			inflight = append(inflight, t)
		}
	}
	drivers, err := a.svc.NearbyDrivers(ctx, 0, 0, 1e12) // all online approved drivers
	if err != nil {
		return nil, err
	}
	var sosCount int
	a.svc.db.QueryRow(ctx, `SELECT COUNT(*) FROM trips WHERE safety_status<>'normal' AND phase NOT IN ('completed','cancelled')`).Scan(&sosCount)
	return map[string]any{
		"active_trips":  inflight,
		"online_drivers": drivers,
		"sos_flags":     sosCount,
	}, nil
}

// ManualAssign assigns a driver to a trip (audited).
func (a *AdminService) ManualAssign(ctx context.Context, adminID, tripID, driverID, reason string) error {
	db := a.svc.db
	var oldDriver *string
	var phase string
	if err := db.QueryRow(ctx, `SELECT driver_id, phase FROM trips WHERE id=$1`, tripID).Scan(&oldDriver, &phase); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "trip not found")
	}
	var vstatus string
	if err := db.QueryRow(ctx, `SELECT verification_status FROM drivers WHERE id=$1`, driverID).Scan(&vstatus); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "driver not found")
	}
	if vstatus != "approved" {
		return codedErr(http.StatusUnprocessableEntity, CodeNotApproved, "driver not approved")
	}
	if _, err := db.Exec(ctx, `UPDATE trips SET driver_id=$1, phase='driver_assigned', status='accepted', updated_at=NOW() WHERE id=$2`, driverID, tripID); err != nil {
		return err
	}
	db.Exec(ctx, `UPDATE drivers SET status='on_trip', updated_at=NOW() WHERE id=$1`, driverID)
	a.svc.recordEvent(ctx, tripID, "manual_assign", adminID, TripPhase(phase), PhaseDriverAssigned, map[string]any{"driver_id": driverID})
	return writeAudit(ctx, db, adminID, "dispatch.assign", "trip", tripID,
		map[string]any{"driver_id": oldDriver}, map[string]any{"driver_id": driverID}, reason)
}

// ─── Pricing / commission ────────────────────────────────────────────────────

func (a *AdminService) GetPricing(ctx context.Context, zone, serviceType string) (*PricingConfig, error) {
	return a.svc.loadPricingConfig(ctx, zone, serviceType)
}

func (a *AdminService) PatchPricing(ctx context.Context, adminID string, req PricingPatchRequest) (*PricingConfig, error) {
	zone := req.Zone
	if zone == "" {
		zone = "default"
	}
	st := req.ServiceType
	if st == "" {
		st = "ride_hailing"
	}
	old, err := a.svc.queryPricing(ctx, zone, st)
	if err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "pricing config not found")
	}
	db := a.svc.db
	const q = `
		UPDATE transport_pricing_config SET
			base_fare_kobo=COALESCE($3, base_fare_kobo),
			per_km_kobo=COALESCE($4, per_km_kobo),
			per_min_kobo=COALESCE($5, per_min_kobo),
			min_fare_kobo=COALESCE($6, min_fare_kobo),
			fare_floor_pct=COALESCE($7, fare_floor_pct),
			fare_ceiling_pct=COALESCE($8, fare_ceiling_pct),
			driver_profit_floor_kobo=COALESCE($9, driver_profit_floor_kobo),
			surge_multiplier=COALESCE($10, surge_multiplier),
			cancellation_fee_kobo=COALESCE($11, cancellation_fee_kobo),
			waiting_fee_per_min_kobo=COALESCE($12, waiting_fee_per_min_kobo),
			active=COALESCE($13, active),
			updated_by=$14, updated_at=NOW()
		WHERE zone=$1 AND service_type=$2`
	if _, err := db.Exec(ctx, q, zone, st,
		req.BaseFareKobo, req.PerKMKobo, req.PerMinKobo, req.MinFareKobo, req.FareFloorPct, req.FareCeilingPct,
		req.DriverProfitFloorKobo, req.SurgeMultiplier, req.CancellationFeeKobo, req.WaitingFeePerMinKobo, req.Active, adminID,
	); err != nil {
		return nil, err
	}
	updated, _ := a.svc.queryPricing(ctx, zone, st)
	writeAudit(ctx, db, adminID, "pricing.update", "pricing_config", zone+":"+st, old, updated, req.Reason)
	return updated, nil
}

func (a *AdminService) ListCommission(ctx context.Context) ([]CommissionConfig, error) {
	rows, err := a.svc.db.Query(ctx, `SELECT tier, provider_pct, platform_pct, active FROM transport_commission_config ORDER BY tier`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CommissionConfig
	for rows.Next() {
		var c CommissionConfig
		if err := rows.Scan(&c.Tier, &c.ProviderPct, &c.PlatformPct, &c.Active); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

func (a *AdminService) PatchCommission(ctx context.Context, adminID, tier string, req CommissionPatchRequest) (*CommissionConfig, error) {
	db := a.svc.db
	var old CommissionConfig
	if err := db.QueryRow(ctx, `SELECT tier, provider_pct, platform_pct, active FROM transport_commission_config WHERE tier=$1`, tier).
		Scan(&old.Tier, &old.ProviderPct, &old.PlatformPct, &old.Active); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "commission tier not found")
	}
	// Provider + platform pct must sum to 1.0 (DB enforces too).
	newProvider := old.ProviderPct
	newPlatform := old.PlatformPct
	if req.ProviderPct != nil {
		newProvider = *req.ProviderPct
		newPlatform = 1.0 - newProvider
	}
	if req.PlatformPct != nil {
		newPlatform = *req.PlatformPct
		newProvider = 1.0 - newPlatform
	}
	if newProvider < 0 || newPlatform < 0 {
		return nil, codedErr(http.StatusBadRequest, "INVALID_SPLIT", "commission split must be between 0 and 1")
	}
	if _, err := db.Exec(ctx, `
		UPDATE transport_commission_config SET provider_pct=$2, platform_pct=$3, active=COALESCE($4, active), updated_by=$5, updated_at=NOW()
		WHERE tier=$1`, tier, newProvider, newPlatform, req.Active, adminID); err != nil {
		return nil, err
	}
	updated := &CommissionConfig{Tier: tier, ProviderPct: newProvider, PlatformPct: newPlatform, Active: true}
	writeAudit(ctx, db, adminID, "commission.update", "commission_config", tier, old, updated, req.Reason)
	return updated, nil
}

// ─── Safety center ───────────────────────────────────────────────────────────

func (a *AdminService) ListIncidents(ctx context.Context, status string) ([]SafetyIncident, error) {
	db := a.svc.db
	q := `SELECT id, user_id, trip_id, type, severity, lat, lng, description, status, assigned_admin, resolution_note, created_at FROM safety_incidents`
	args := []any{}
	if status != "" {
		q += ` WHERE status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT 200`
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SafetyIncident
	for rows.Next() {
		var i SafetyIncident
		if err := rows.Scan(&i.ID, &i.UserID, &i.TripID, &i.Type, &i.Severity, &i.Lat, &i.Lng,
			&i.Description, &i.Status, &i.AssignedAdmin, &i.ResolutionNote, &i.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, nil
}

func (a *AdminService) PatchIncident(ctx context.Context, adminID, incidentID string, req SafetyIncidentPatchRequest) error {
	db := a.svc.db
	var oldStatus string
	if err := db.QueryRow(ctx, `SELECT status FROM safety_incidents WHERE id=$1`, incidentID).Scan(&oldStatus); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "incident not found")
	}
	if _, err := db.Exec(ctx, `
		UPDATE safety_incidents SET
			status=COALESCE(NULLIF($2,''), status),
			assigned_admin=COALESCE(NULLIF($3,'')::uuid, assigned_admin),
			resolution_note=COALESCE(NULLIF($4,''), resolution_note),
			updated_at=NOW()
		WHERE id=$1`, incidentID, req.Status, req.AssignedAdmin, req.ResolutionNote); err != nil {
		return err
	}
	// Clear the trip safety hold if the incident is resolved.
	if req.Status == "resolved" || req.Status == "closed" {
		db.Exec(ctx, `UPDATE trips SET safety_status='resolved' WHERE id=(SELECT trip_id FROM safety_incidents WHERE id=$1)`, incidentID)
	}
	return writeAudit(ctx, db, adminID, "safety.update", "safety_incident", incidentID,
		map[string]any{"status": oldStatus}, map[string]any{"status": req.Status, "resolution_note": req.ResolutionNote}, "")
}

// ─── Audit feed ──────────────────────────────────────────────────────────────

func (a *AdminService) AuditFeed(ctx context.Context) ([]map[string]any, error) {
	rows, err := a.svc.db.Query(ctx, `
		SELECT id, admin_id, action, entity_type, entity_id, old_value, new_value, reason, created_at
		FROM transport_audit_log ORDER BY created_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, adminID, action, etype string
		var eid, reason *string
		var oldVal, newVal []byte
		var createdAt any
		if err := rows.Scan(&id, &adminID, &action, &etype, &eid, &oldVal, &newVal, &reason, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "admin_id": adminID, "action": action, "entity_type": etype,
			"entity_id": eid, "old_value": rawJSON(oldVal), "new_value": rawJSON(newVal),
			"reason": reason, "created_at": createdAt,
		})
	}
	return out, nil
}
