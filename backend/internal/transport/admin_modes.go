package transport

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

// ─── Admin: multi-modal lists + status patch + per-mode KPIs ─────────────────
//
// Generic, audited list/patch helpers for parcel/towing/mover/car-hire rows.
// Couriers/operators/providers are surfaced via the existing /admin/transport/drivers
// queue (they are drivers). Bus admin CRUD lives in bus.go / bus_handler.go.

// ModeStatusPatchRequest is the admin status-patch body for mode rows.
type ModeStatusPatchRequest struct {
	Status string `json:"status" binding:"required"`
	Reason string `json:"reason"`
}

// ListParcels (admin) lists parcels filtered by status. Joins user_profiles /
// drivers for display names and settlements for escrow state — the admin
// console's ParcelRow contract needs all three, none of which live on
// parcels itself.
func (a *AdminService) ListParcels(ctx context.Context, status string) ([]map[string]any, error) {
	db := a.svc.db
	q := `
		SELECT p.id, p.sender_id, COALESCE(NULLIF(up.full_name,''), up.display_name) AS sender_name,
		       p.courier_id, d.name AS courier_name,
		       p.status, p.category, p.size, p.speed,
		       p.pickup_address, p.dropoff_address,
		       p.fare_kobo, p.declared_value_kobo, p.proof_url,
		       st.status AS settlement_status,
		       p.created_at, p.updated_at
		FROM parcels p
		LEFT JOIN user_profiles up ON up.id = p.sender_id
		LEFT JOIN drivers d ON d.id = p.courier_id
		LEFT JOIN settlements st ON st.id = p.settlement_id`
	args := []any{}
	if status != "" {
		q += ` WHERE p.status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY p.created_at DESC LIMIT 200`
	rows, err := db.Query(ctx, q, args...)
	return scanParcelList(ctx, rows, err)
}

// PatchParcelStatus (admin) force-sets a parcel status (audited, e.g. disputed/failed).
func (a *AdminService) PatchParcelStatus(ctx context.Context, adminID, id string, req ModeStatusPatchRequest) error {
	return a.patchModeStatus(ctx, adminID, "parcels", "parcel", id, req)
}

// ListTowingJobs (admin) lists towing jobs filtered by status. Joins
// user_profiles / drivers for display names and settlements for escrow
// state. calloutKobo has no per-job column (no breakdown of fare_kobo is
// persisted) — it is approximated from the current active towing pricing
// config's base_fare_kobo, the same "callout" component CreateTowingJob
// itself starts from (see towing.go's loadPricingConfig(ctx,"default",
// "towing") calls). That is a live config read, not a stored fact, so it
// reflects today's rate even for older jobs.
func (a *AdminService) ListTowingJobs(ctx context.Context, status string) ([]map[string]any, error) {
	db := a.svc.db
	q := `
		SELECT t.id, t.user_id, COALESCE(NULLIF(up.full_name,''), up.display_name) AS customer_name,
		       t.operator_id, d.name AS operator_name,
		       t.status, t.service_type,
		       t.pickup_address, t.dest_address,
		       t.fare_kobo, st.status AS settlement_status,
		       t.created_at, t.updated_at
		FROM towing_jobs t
		LEFT JOIN user_profiles up ON up.id = t.user_id
		LEFT JOIN drivers d ON d.id = t.operator_id
		LEFT JOIN settlements st ON st.id = t.settlement_id`
	args := []any{}
	if status != "" {
		q += ` WHERE t.status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY t.created_at DESC LIMIT 200`
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var calloutKobo int64
	if cfg, err := a.svc.loadPricingConfig(ctx, "default", "towing"); err == nil {
		calloutKobo = cfg.BaseFareKobo
	}

	var out []map[string]any
	for rows.Next() {
		var id, uid, status, serviceType, pickup string
		var customerName, operator, operatorName, dest, settlementStatus *string
		var fare int64
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &uid, &customerName, &operator, &operatorName, &status, &serviceType,
			&pickup, &dest, &fare, &settlementStatus, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "user_id": uid, "customer_name": customerName,
			"operator_id": operator, "operator_name": operatorName,
			"status": status, "service_type": serviceType,
			"pickup_address": pickup, "dest_address": dest,
			"callout_kobo": calloutKobo, "fare_kobo": fare,
			"escrow_status": escrowStatusFromSettlement(settlementStatus),
			"created_at":    createdAt, "updated_at": updatedAt,
		})
	}
	return out, nil
}

// PatchTowingStatus (admin) force-sets a towing status (audited).
func (a *AdminService) PatchTowingStatus(ctx context.Context, adminID, id string, req ModeStatusPatchRequest) error {
	return a.patchModeStatus(ctx, adminID, "towing_jobs", "towing_job", id, req)
}

// ListMoverJobs (admin) lists mover jobs filtered by status, joined against
// user_profiles for the customer's display name and against mover_bids for a
// per-job bid count — the same row shape MoverJobDetail returns for one job.
// acceptedAmountKobo only ever reflects an actually-accepted bid:
// MoverAcceptBid overwrites quote_amount_kobo with the accepted bid's amount
// (see movers.go), so before acceptance quote_amount_kobo is just the
// customer's initial ask and must not be reported as "accepted".
func (a *AdminService) ListMoverJobs(ctx context.Context, status string) ([]map[string]any, error) {
	db := a.svc.db
	q := `
		SELECT mj.id, mj.user_id, COALESCE(NULLIF(up.full_name,''), up.display_name) AS customer_name,
		       mj.provider_id, mj.status, mj.pickup_address, mj.dropoff_address, mj.truck_size,
		       mj.helpers, mj.move_at,
		       CASE WHEN mj.accepted_bid_id IS NOT NULL THEN mj.quote_amount_kobo END AS accepted_amount_kobo,
		       mj.escrow_status,
		       (SELECT COUNT(*) FROM mover_bids b WHERE b.job_id = mj.id) AS bids_count,
		       mj.created_at, mj.updated_at
		FROM mover_jobs mj
		LEFT JOIN user_profiles up ON up.id = mj.user_id`
	args := []any{}
	if status != "" {
		q += ` WHERE mj.status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY mj.created_at DESC LIMIT 200`
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, uid, status, pickup, dropoff, truckSize, escrow string
		var customerName, provider *string
		var helpers, bidsCount int
		var moveAt *time.Time
		var acceptedAmount *int64
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &uid, &customerName, &provider, &status, &pickup, &dropoff, &truckSize,
			&helpers, &moveAt, &acceptedAmount, &escrow, &bidsCount, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "user_id": uid, "customer_name": customerName, "provider_id": provider,
			"status": status, "pickup_address": pickup, "dropoff_address": dropoff, "truck_size": truckSize,
			"helpers": helpers, "move_at": moveAt,
			"accepted_amount_kobo": acceptedAmount,
			"escrow_status":        moverEscrowStatus(escrow),
			"bids_count":           bidsCount,
			"created_at":           createdAt, "updated_at": updatedAt,
		})
	}
	return out, nil
}

// MoverJobDetail (admin) returns one mover job's full row plus its bids
// (joined against drivers for each bidder's display name) — the per-job
// modal getMoverJob() opens from the admin movers list. Mirrors
// ListMoverJobs's accepted-amount gating and escrow-status mapping so the
// list and detail views never disagree about the same job.
func (a *AdminService) MoverJobDetail(ctx context.Context, id string) (map[string]any, error) {
	db := a.svc.db
	const q = `
		SELECT mj.id, mj.user_id, COALESCE(NULLIF(up.full_name,''), up.display_name) AS customer_name,
		       mj.provider_id, mj.status, mj.pickup_address, mj.dropoff_address, mj.truck_size,
		       mj.helpers, mj.move_at,
		       CASE WHEN mj.accepted_bid_id IS NOT NULL THEN mj.quote_amount_kobo END AS accepted_amount_kobo,
		       mj.escrow_status, mj.inventory, mj.created_at, mj.updated_at
		FROM mover_jobs mj
		LEFT JOIN user_profiles up ON up.id = mj.user_id
		WHERE mj.id=$1`
	var (
		jid, uid, status, pickup, dropoff, truckSize, escrow string
		customerName, provider                               *string
		helpers                                              int
		moveAt                                               *time.Time
		acceptedAmount                                       *int64
		inventory                                            []byte
		createdAt, updatedAt                                 time.Time
	)
	if err := db.QueryRow(ctx, q, id).Scan(&jid, &uid, &customerName, &provider, &status, &pickup, &dropoff,
		&truckSize, &helpers, &moveAt, &acceptedAmount, &escrow, &inventory, &createdAt, &updatedAt); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "mover job not found")
	}
	bids, err := a.listMoverBidsAdmin(ctx, jid)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id": jid, "user_id": uid, "customer_name": customerName, "provider_id": provider,
		"status": status, "pickup_address": pickup, "dropoff_address": dropoff, "truck_size": truckSize,
		"helpers": helpers, "move_at": moveAt,
		"accepted_amount_kobo": acceptedAmount,
		"escrow_status":        moverEscrowStatus(escrow),
		"inventory":            inventoryDisplay(inventory), "created_at": createdAt, "updated_at": updatedAt,
		"bids_count": len(bids), "bids": bids,
	}, nil
}

// inventoryDisplay renders mover_jobs.inventory (freeform JSONB — the client
// can submit a string, an object, or an array; RequestMoverQuote never
// validates its shape) as a plain string for the admin console. A raw
// string(bytes) would show a JSON-string value with its quotes still on
// ("\"3-bedroom flat...\""), so a plain JSON string is unwrapped first;
// anything else (object, array, or invalid JSON) falls back to the raw bytes.
func inventoryDisplay(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	return string(raw)
}

// listMoverBidsAdmin returns a mover job's bids joined against drivers for
// the bidder's display name. crew_size defaults to 1 for every row (see
// supabase/migrations/20270200000000_mover_bids_crew_size.sql) — the
// driver-facing bid endpoint doesn't collect it yet.
func (a *AdminService) listMoverBidsAdmin(ctx context.Context, jobID string) ([]map[string]any, error) {
	rows, err := a.svc.db.Query(ctx, `
		SELECT b.id, b.provider_id, d.name, b.amount_kobo, b.crew_size, b.status, b.created_at
		FROM mover_bids b
		LEFT JOIN drivers d ON d.id = b.provider_id
		WHERE b.job_id=$1 ORDER BY b.amount_kobo ASC`, jobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, providerID, status string
		var moverName *string
		var amount int64
		var crewSize int
		var createdAt time.Time
		if err := rows.Scan(&id, &providerID, &moverName, &amount, &crewSize, &status, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "mover_id": providerID, "mover_name": moverName, "amount_kobo": amount,
			"crew_size": crewSize, "accepted": status == "accepted", "created_at": createdAt,
		})
	}
	return out, nil
}

// PatchMoverStatus (admin) force-sets a mover status (audited).
func (a *AdminService) PatchMoverStatus(ctx context.Context, adminID, id string, req ModeStatusPatchRequest) error {
	return a.patchModeStatus(ctx, adminID, "mover_jobs", "mover_job", id, req)
}

// ListCarHireBookings (admin) lists car-hire bookings filtered by status.
// Joins user_profiles / drivers for display names and settlements for escrow
// state.
func (a *AdminService) ListCarHireBookings(ctx context.Context, status string) ([]map[string]any, error) {
	db := a.svc.db
	q := `
		SELECT c.id, c.user_id, COALESCE(NULLIF(up.full_name,''), up.display_name) AS customer_name,
		       c.driver_id, d.name AS driver_name,
		       c.status, c.hire_type, c.vehicle_class, c.chauffeur, c.start_at, c.duration_hours,
		       c.fare_kobo, c.deposit_kobo, st.status AS settlement_status,
		       c.created_at, c.updated_at
		FROM car_hire_bookings c
		LEFT JOIN user_profiles up ON up.id = c.user_id
		LEFT JOIN drivers d ON d.id = c.driver_id
		LEFT JOIN settlements st ON st.id = c.settlement_id`
	args := []any{}
	if status != "" {
		q += ` WHERE c.status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY c.created_at DESC LIMIT 200`
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, uid, status, hireType, vehicleClass string
		var customerName, driver, driverName, settlementStatus *string
		var chauffeur bool
		var startAt time.Time
		var durationHours int
		var fare, deposit int64
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &uid, &customerName, &driver, &driverName, &status, &hireType, &vehicleClass,
			&chauffeur, &startAt, &durationHours, &fare, &deposit, &settlementStatus, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "user_id": uid, "customer_name": customerName,
			"driver_id": driver, "driver_name": driverName,
			"status": status, "hire_type": hireType, "vehicle_class": vehicleClass,
			"chauffeur": chauffeur, "start_at": startAt, "duration_hours": durationHours,
			"fare_kobo": fare, "deposit_kobo": deposit,
			"escrow_status": escrowStatusFromSettlement(settlementStatus),
			"created_at":    createdAt, "updated_at": updatedAt,
		})
	}
	return out, nil
}

// PatchCarHireStatus (admin) force-sets a car-hire status (audited).
func (a *AdminService) PatchCarHireStatus(ctx context.Context, adminID, id string, req ModeStatusPatchRequest) error {
	return a.patchModeStatus(ctx, adminID, "car_hire_bookings", "car_hire_booking", id, req)
}

// patchModeStatus updates a row's status across any mode table, audited. Table
// names are constant literals (never user input) so this is injection-safe.
func (a *AdminService) patchModeStatus(ctx context.Context, adminID, table, entityType, id string, req ModeStatusPatchRequest) error {
	db := a.svc.db
	var oldStatus string
	var q string
	switch table {
	case "parcels":
		q = `SELECT status FROM parcels WHERE id=$1`
	case "towing_jobs":
		q = `SELECT status FROM towing_jobs WHERE id=$1`
	case "mover_jobs":
		q = `SELECT status FROM mover_jobs WHERE id=$1`
	case "car_hire_bookings":
		q = `SELECT status FROM car_hire_bookings WHERE id=$1`
	default:
		return codedErr(http.StatusBadRequest, "INVALID_TABLE", "unknown mode")
	}
	if err := db.QueryRow(ctx, q, id).Scan(&oldStatus); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "record not found")
	}
	var upd string
	switch table {
	case "parcels":
		upd = `UPDATE parcels SET status=$1, updated_at=NOW() WHERE id=$2`
	case "towing_jobs":
		upd = `UPDATE towing_jobs SET status=$1, updated_at=NOW() WHERE id=$2`
	case "mover_jobs":
		upd = `UPDATE mover_jobs SET status=$1, updated_at=NOW() WHERE id=$2`
	case "car_hire_bookings":
		upd = `UPDATE car_hire_bookings SET status=$1, updated_at=NOW() WHERE id=$2`
	}
	if _, err := db.Exec(ctx, upd, req.Status, id); err != nil {
		return err
	}
	return writeAudit(ctx, db, adminID, entityType+".status", entityType, id,
		map[string]any{"status": oldStatus}, map[string]any{"status": req.Status}, req.Reason)
}

// scanParcelList scans the parcel admin list shape.
func scanParcelList(ctx context.Context, rows pgx.Rows, err error) ([]map[string]any, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, sender, status, category, size, speed, pickup, dropoff string
		var senderName, courier, courierName, proofURL, settlementStatus *string
		var fare, declaredValue int64
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &sender, &senderName, &courier, &courierName, &status, &category, &size, &speed,
			&pickup, &dropoff, &fare, &declaredValue, &proofURL, &settlementStatus, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "sender_id": sender, "sender_name": senderName,
			"courier_id": courier, "courier_name": courierName,
			"status": status, "category": category, "size": size, "speed": speed,
			"pickup_address": pickup, "dropoff_address": dropoff,
			"fare_kobo": fare, "declared_value_kobo": declaredValue,
			"pod_status": deriveParcelPodStatus(status, proofURL), "pod_proof_url": proofURL,
			"escrow_status": escrowStatusFromSettlement(settlementStatus),
			"created_at":    createdAt, "updated_at": updatedAt,
		})
	}
	return out, nil
}

// escrowStatusFromSettlement maps the shared settlements.status enum
// (escrowed/releasing/settled/disputed/refunded — see the settlements table
// in 20260616220000_fx_conversions.sql) onto the modes' EscrowStatus contract
// (none/held/released/refunded). A nil status means the row has no settlement
// row at all (settlement_id has no FK "by convention", same as parcels'
// insurance_policy_id) — treated as "none" rather than assumed held.
func escrowStatusFromSettlement(status *string) string {
	if status == nil {
		return "none"
	}
	switch *status {
	case "settled":
		return "released"
	case "refunded":
		return "refunded"
	default: // escrowed, releasing, disputed — funds are still held
		return "held"
	}
}

// moverEscrowStatus maps mover_jobs.escrow_status (none/funded/released/
// refunded) onto the shared EscrowStatus contract (none/held/released/
// refunded) — "funded" is this mode's word for escrow being held.
func moverEscrowStatus(status string) string {
	if status == "funded" {
		return "held"
	}
	return status
}

// deriveParcelPodStatus infers proof-of-delivery review state from parcel
// status + proof_url. There is no dedicated pod_status column or review
// workflow: VerifyParcelDropoff (parcel.go) sets proof_url and advances the
// parcel straight from dropoff_verified to delivered inside the same call,
// so a persisted "submitted, awaiting review" state never actually occurs
// today — "submitted" here only covers a parcel that picked up a proof_url
// outside that normal flow (e.g. re-opened after dispute) without yet being
// re-marked delivered.
func deriveParcelPodStatus(status string, proofURL *string) string {
	if proofURL == nil || *proofURL == "" {
		return "pending"
	}
	switch status {
	case "delivered":
		return "approved"
	case "disputed":
		return "rejected"
	default:
		return "submitted"
	}
}

// ModeKPIs returns per-mode counts for the admin dashboard.
func (a *AdminService) ModeKPIs(ctx context.Context) map[string]any {
	db := a.svc.db
	var parcels, parcelsDelivered, busTickets, busBoarded, towing, towingDone, movers, moversDone, carHire, carHireDone int
	db.QueryRow(ctx, `SELECT COUNT(*) FROM parcels`).Scan(&parcels)
	db.QueryRow(ctx, `SELECT COUNT(*) FROM parcels WHERE status='delivered'`).Scan(&parcelsDelivered)
	db.QueryRow(ctx, `SELECT COUNT(*) FROM bus_tickets WHERE status NOT IN ('cancelled','refunded')`).Scan(&busTickets)
	db.QueryRow(ctx, `SELECT COUNT(*) FROM bus_tickets WHERE boarding_status='boarded'`).Scan(&busBoarded)
	db.QueryRow(ctx, `SELECT COUNT(*) FROM towing_jobs`).Scan(&towing)
	db.QueryRow(ctx, `SELECT COUNT(*) FROM towing_jobs WHERE status='completed'`).Scan(&towingDone)
	db.QueryRow(ctx, `SELECT COUNT(*) FROM mover_jobs`).Scan(&movers)
	db.QueryRow(ctx, `SELECT COUNT(*) FROM mover_jobs WHERE status='completion_confirmed'`).Scan(&moversDone)
	db.QueryRow(ctx, `SELECT COUNT(*) FROM car_hire_bookings`).Scan(&carHire)
	db.QueryRow(ctx, `SELECT COUNT(*) FROM car_hire_bookings WHERE status='completed'`).Scan(&carHireDone)
	return map[string]any{
		"parcels_total":      parcels,
		"parcels_delivered":  parcelsDelivered,
		"bus_tickets_active": busTickets,
		"bus_boarded":        busBoarded,
		"towing_total":       towing,
		"towing_completed":   towingDone,
		"movers_total":       movers,
		"movers_completed":   moversDone,
		"car_hire_total":     carHire,
		"car_hire_completed": carHireDone,
	}
}

// ─── Admin mode handlers ─────────────────────────────────────────────────────

func (h *AdminHandler) AdminParcelsList(c *gin.Context) {
	ps, err := h.svc.ListParcels(c.Request.Context(), c.Query("status"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"parcels": ps})
}

func (h *AdminHandler) AdminParcelStatus(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req ModeStatusPatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.PatchParcelStatus(c.Request.Context(), adminID, c.Param("id"), req); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": req.Status})
}

func (h *AdminHandler) AdminTowingList(c *gin.Context) {
	js, err := h.svc.ListTowingJobs(c.Request.Context(), c.Query("status"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"jobs": js})
}

func (h *AdminHandler) AdminTowingStatus(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req ModeStatusPatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.PatchTowingStatus(c.Request.Context(), adminID, c.Param("id"), req); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": req.Status})
}

func (h *AdminHandler) AdminMoversList(c *gin.Context) {
	js, err := h.svc.ListMoverJobs(c.Request.Context(), c.Query("status"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"jobs": js})
}

func (h *AdminHandler) AdminMoverDetail(c *gin.Context) {
	j, err := h.svc.MoverJobDetail(c.Request.Context(), c.Param("id"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, j)
}

func (h *AdminHandler) AdminMoverStatus(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req ModeStatusPatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.PatchMoverStatus(c.Request.Context(), adminID, c.Param("id"), req); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": req.Status})
}

func (h *AdminHandler) AdminCarHireList(c *gin.Context) {
	bs, err := h.svc.ListCarHireBookings(c.Request.Context(), c.Query("status"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"bookings": bs})
}

func (h *AdminHandler) AdminCarHireStatus(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req ModeStatusPatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.PatchCarHireStatus(c.Request.Context(), adminID, c.Param("id"), req); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": req.Status})
}
