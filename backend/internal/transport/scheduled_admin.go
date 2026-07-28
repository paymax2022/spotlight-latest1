package transport

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── Admin scheduled-booking ops board ───────────────────────────────────────
//
// Mounted under `adminTr` → /api/finance/admin/transport/scheduled*. Every
// mutation requires a reason_code and writes a transport audit row (writeAudit).
// RBAC is applied at the route (guard("transport.admin.scheduled.*")).

// ─── AdminService methods ────────────────────────────────────────────────────

// AdminScheduledFilter narrows the ops-board list.
type AdminScheduledFilter struct {
	Status string
	Mode   string
	From   *time.Time
	To     *time.Time
}

// ListScheduledAdmin returns bookings for the ops board, filtered by
// status/mode/pickup-window. Ordered so failed_no_driver aging and imminent
// pickups surface first (oldest-updated failures, then soonest pickups).
func (a *AdminService) ListScheduledAdmin(ctx context.Context, f AdminScheduledFilter) ([]*ScheduledBooking, error) {
	q := `SELECT ` + scheduledCols + ` FROM transport_scheduled_bookings WHERE 1=1`
	args := []any{}
	if f.Status != "" {
		args = append(args, f.Status)
		q += fmt.Sprintf(` AND status=$%d`, len(args))
	}
	if f.Mode != "" {
		args = append(args, f.Mode)
		q += fmt.Sprintf(` AND mode=$%d`, len(args))
	}
	if f.From != nil {
		args = append(args, *f.From)
		q += fmt.Sprintf(` AND scheduled_pickup_at >= $%d`, len(args))
	}
	if f.To != nil {
		args = append(args, *f.To)
		q += fmt.Sprintf(` AND scheduled_pickup_at <= $%d`, len(args))
	}
	// failed_no_driver first (aging queue), then by pickup time.
	q += ` ORDER BY (status='failed_no_driver') DESC, scheduled_pickup_at ASC LIMIT 200`
	rows, err := a.svc.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ScheduledBooking
	for rows.Next() {
		b, err := scanScheduled(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// GetScheduledAdmin returns one booking (admin — no owner scope).
func (a *AdminService) GetScheduledAdmin(ctx context.Context, id string) (*ScheduledBooking, error) {
	return a.svc.getScheduledRow(ctx, id)
}

// ForceDispatchScheduled is a manual retry of materialization for a stuck
// booking (audited). It re-drives DispatchScheduled after resetting a
// failed_no_driver booking back to 'scheduled' so the guarded path can run.
func (a *AdminService) ForceDispatchScheduled(ctx context.Context, adminID, id, reason string) (*ScheduledBooking, error) {
	if reason == "" {
		return nil, codedErr(http.StatusUnprocessableEntity, "REASON_REQUIRED", "reason_code required")
	}
	b, err := a.svc.getScheduledRow(ctx, id)
	if err != nil {
		return nil, err
	}
	// From failed_no_driver we reopen to 'scheduled' (attempts reset) so the
	// standard guarded dispatch path can run. From 'scheduled'/'dispatch_pending'
	// we dispatch directly.
	if b.Status == SchedFailedNoDriver {
		const reopen = `
			UPDATE transport_scheduled_bookings
			SET status='scheduled', dispatch_attempts=0, last_dispatch_error=NULL, updated_at=NOW()
			WHERE id=$1 AND status='failed_no_driver'`
		if _, uerr := a.svc.db.Exec(ctx, reopen, id); uerr != nil {
			return nil, uerr
		}
	} else if b.Status != SchedScheduled && b.Status != SchedDispatchPending {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "booking not force-dispatchable from status "+string(b.Status))
	}
	nb, derr := a.svc.DispatchScheduled(ctx, id)
	_ = writeAudit(ctx, a.svc.db, adminID, "scheduled.force_dispatch", "scheduled_booking", id,
		map[string]any{"status": string(b.Status)},
		map[string]any{"attempted": true, "error": errStr(derr)}, reason)
	if derr != nil {
		return nb, derr
	}
	return nb, nil
}

// ReassignScheduled hands a booking's underlying trip/parcel to a specific
// driver where applicable (audited). Applicable only once the booking has
// materialized (dispatched) into a trip/parcel; for a not-yet-dispatched booking
// it records the intended assignment on the payload for the dispatcher to honor.
func (a *AdminService) ReassignScheduled(ctx context.Context, adminID, id, driverID, reason string) (*ScheduledBooking, error) {
	if reason == "" {
		return nil, codedErr(http.StatusUnprocessableEntity, "REASON_REQUIRED", "reason_code required")
	}
	if driverID == "" {
		return nil, codedErr(http.StatusUnprocessableEntity, "DRIVER_REQUIRED", "driver_id required")
	}
	b, err := a.svc.getScheduledRow(ctx, id)
	if err != nil {
		return nil, err
	}
	switch {
	case b.MaterializedKind != nil && *b.MaterializedKind == "trip" && b.MaterializedRef != nil:
		// Delegate to the existing dispatch manual-assign path on the real trip.
		if aerr := a.ManualAssign(ctx, adminID, *b.MaterializedRef, driverID, reason); aerr != nil {
			return nil, aerr
		}
	default:
		// Not yet a trip — stash the preferred driver on the payload so the
		// dispatcher can honor it, and record the intent.
		if _, uerr := a.svc.db.Exec(ctx,
			`UPDATE transport_scheduled_bookings
			 SET mode_payload = jsonb_set(mode_payload, '{preferred_driver_id}', to_jsonb($2::text), true), updated_at=NOW()
			 WHERE id=$1`, id, driverID); uerr != nil {
			return nil, uerr
		}
	}
	_ = writeAudit(ctx, a.svc.db, adminID, "scheduled.reassign", "scheduled_booking", id,
		map[string]any{"materialized_ref": b.MaterializedRef},
		map[string]any{"driver_id": driverID}, reason)
	return a.svc.getScheduledRow(ctx, id)
}

// CancelScheduledAdmin is the admin cancel path (audited) — reuses the shared
// FSM-guarded cancel + refund. reason is required.
func (a *AdminService) CancelScheduledAdmin(ctx context.Context, adminID, id, reason string) (*ScheduledBooking, error) {
	if reason == "" {
		return nil, codedErr(http.StatusUnprocessableEntity, "REASON_REQUIRED", "reason_code required")
	}
	b, err := a.svc.getScheduledRow(ctx, id)
	if err != nil {
		return nil, err
	}
	nb, cerr := a.svc.cancelScheduledInternal(ctx, b, adminID, reason, "scheduled.admin_cancelled")
	_ = writeAudit(ctx, a.svc.db, adminID, "scheduled.admin_cancel", "scheduled_booking", id,
		map[string]any{"status": string(b.Status), "settlement_id": b.SettlementID},
		map[string]any{"status": string(SchedCancelled), "refunded": b.SettlementID != nil}, reason)
	if cerr != nil {
		return nb, cerr
	}
	return nb, nil
}

func errStr(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// ─── AdminHandler endpoints ──────────────────────────────────────────────────

// AdminScheduledList handles GET /admin/transport/scheduled.
func (h *AdminHandler) AdminScheduledList(c *gin.Context) {
	f := AdminScheduledFilter{Status: c.Query("status"), Mode: c.Query("mode")}
	if v := c.Query("from"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			f.From = &t
		}
	}
	if v := c.Query("to"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			f.To = &t
		}
	}
	items, err := h.svc.ListScheduledAdmin(c.Request.Context(), f)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"bookings": items})
}

// AdminScheduledGet handles GET /admin/transport/scheduled/:id.
func (h *AdminHandler) AdminScheduledGet(c *gin.Context) {
	b, err := h.svc.GetScheduledAdmin(c.Request.Context(), c.Param("id"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, b)
}

// scheduledAdminReason is the common body for the audited admin mutations.
type scheduledAdminReason struct {
	ReasonCode string `json:"reason_code" binding:"required"`
	DriverID   string `json:"driver_id"`
}

// AdminScheduledForceDispatch handles POST /admin/transport/scheduled/:id/force-dispatch.
func (h *AdminHandler) AdminScheduledForceDispatch(c *gin.Context) {
	adminID := c.GetString("user_id")
	var body scheduledAdminReason
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b, err := h.svc.ForceDispatchScheduled(c.Request.Context(), adminID, c.Param("id"), body.ReasonCode)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, b)
}

// AdminScheduledReassign handles POST /admin/transport/scheduled/:id/reassign.
func (h *AdminHandler) AdminScheduledReassign(c *gin.Context) {
	adminID := c.GetString("user_id")
	var body scheduledAdminReason
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b, err := h.svc.ReassignScheduled(c.Request.Context(), adminID, c.Param("id"), body.DriverID, body.ReasonCode)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, b)
}

// AdminScheduledCancel handles POST /admin/transport/scheduled/:id/cancel.
func (h *AdminHandler) AdminScheduledCancel(c *gin.Context) {
	adminID := c.GetString("user_id")
	var body scheduledAdminReason
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b, err := h.svc.CancelScheduledAdmin(c.Request.Context(), adminID, c.Param("id"), body.ReasonCode)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, b)
}
