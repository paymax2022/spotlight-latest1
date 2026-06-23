package transport

import (
	"context"
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

// ListParcels (admin) lists parcels filtered by status.
func (a *AdminService) ListParcels(ctx context.Context, status string) ([]map[string]any, error) {
	db := a.svc.db
	q := `SELECT id, sender_id, courier_id, status, category, size, fare_kobo, created_at FROM parcels`
	args := []any{}
	if status != "" {
		q += ` WHERE status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT 200`
	rows, err := db.Query(ctx, q, args...)
	return scanModeList(ctx, rows, err)
}

// PatchParcelStatus (admin) force-sets a parcel status (audited, e.g. disputed/failed).
func (a *AdminService) PatchParcelStatus(ctx context.Context, adminID, id string, req ModeStatusPatchRequest) error {
	return a.patchModeStatus(ctx, adminID, "parcels", "parcel", id, req)
}

// ListTowingJobs (admin) lists towing jobs filtered by status.
func (a *AdminService) ListTowingJobs(ctx context.Context, status string) ([]map[string]any, error) {
	db := a.svc.db
	q := `SELECT id, user_id, operator_id, status, service_type, fare_kobo, created_at FROM towing_jobs`
	args := []any{}
	if status != "" {
		q += ` WHERE status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT 200`
	rows, err := db.Query(ctx, q, args...)
	return scanModeListSvc(ctx, rows, err)
}

// PatchTowingStatus (admin) force-sets a towing status (audited).
func (a *AdminService) PatchTowingStatus(ctx context.Context, adminID, id string, req ModeStatusPatchRequest) error {
	return a.patchModeStatus(ctx, adminID, "towing_jobs", "towing_job", id, req)
}

// ListMoverJobs (admin) lists mover jobs filtered by status.
func (a *AdminService) ListMoverJobs(ctx context.Context, status string) ([]map[string]any, error) {
	db := a.svc.db
	q := `SELECT id, user_id, provider_id, status, escrow_status, quote_amount_kobo, created_at FROM mover_jobs`
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
	var out []map[string]any
	for rows.Next() {
		var id, uid, status, escrow string
		var provider *string
		var quote *int64
		var createdAt time.Time
		if err := rows.Scan(&id, &uid, &provider, &status, &escrow, &quote, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "user_id": uid, "provider_id": provider, "status": status,
			"escrow_status": escrow, "quote_amount_kobo": quote, "created_at": createdAt,
		})
	}
	return out, nil
}

// PatchMoverStatus (admin) force-sets a mover status (audited).
func (a *AdminService) PatchMoverStatus(ctx context.Context, adminID, id string, req ModeStatusPatchRequest) error {
	return a.patchModeStatus(ctx, adminID, "mover_jobs", "mover_job", id, req)
}

// ListCarHireBookings (admin) lists car-hire bookings filtered by status.
func (a *AdminService) ListCarHireBookings(ctx context.Context, status string) ([]map[string]any, error) {
	db := a.svc.db
	q := `SELECT id, user_id, driver_id, status, hire_type, fare_kobo, deposit_kobo, created_at FROM car_hire_bookings`
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
	var out []map[string]any
	for rows.Next() {
		var id, uid, status, hireType string
		var driver *string
		var fare, deposit int64
		var createdAt time.Time
		if err := rows.Scan(&id, &uid, &driver, &status, &hireType, &fare, &deposit, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "user_id": uid, "driver_id": driver, "status": status,
			"hire_type": hireType, "fare_kobo": fare, "deposit_kobo": deposit, "created_at": createdAt,
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

// scanModeList scans the parcel admin list shape.
func scanModeList(ctx context.Context, rows pgx.Rows, err error) ([]map[string]any, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, sender, status, category, size string
		var courier *string
		var fare int64
		var createdAt time.Time
		if err := rows.Scan(&id, &sender, &courier, &status, &category, &size, &fare, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "sender_id": sender, "courier_id": courier, "status": status,
			"category": category, "size": size, "fare_kobo": fare, "created_at": createdAt,
		})
	}
	return out, nil
}

// scanModeListSvc scans the towing admin list shape.
func scanModeListSvc(ctx context.Context, rows pgx.Rows, err error) ([]map[string]any, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, uid, status, serviceType string
		var operator *string
		var fare int64
		var createdAt time.Time
		if err := rows.Scan(&id, &uid, &operator, &status, &serviceType, &fare, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "user_id": uid, "operator_id": operator, "status": status,
			"service_type": serviceType, "fare_kobo": fare, "created_at": createdAt,
		})
	}
	return out, nil
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
