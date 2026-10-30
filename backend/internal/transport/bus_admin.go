package transport

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
)

// Admin bus console reads + route-level fare approval. Rows are camelCase and
// shaped to frontend-admin's BusRoute / BusSchedule types.

// busOperatorNameSQL resolves a display name for a route's operator: the
// marketplace provider's business name, else the legacy operator's profile.
const busOperatorNameSQL = `COALESCE(p.business_name, NULLIF(up.full_name,''), up.display_name, '')`

// BusScheduleAdminFilter is GET /admin/transport/bus/schedules.
type BusScheduleAdminFilter struct {
	RouteID      string
	ProviderID   string
	Status       string
	FareApproved *bool
	From, To     string // YYYY-MM-DD, inclusive, on departure_time
	Limit        int
	Offset       int
}

// busScheduleStatuses mirrors the bus_schedules.status CHECK constraint.
var busScheduleStatuses = strings.Fields("scheduled boarding departed completed cancelled")

func validBusScheduleStatus(st string) bool { return slices.Contains(busScheduleStatuses, st) }

// busScheduleAdminRow is one row of GET /admin/transport/bus/schedules.
type busScheduleAdminRow struct {
	ID           string `json:"id"`
	RouteID      string `json:"routeId"`
	RouteLabel   string `json:"routeLabel"`
	OperatorName string `json:"operatorName"`
	DepartAt     string `json:"departAt"`
	FareKobo     int64  `json:"fareKobo"`
	FareApproved bool   `json:"fareApproved"`
	SeatsTotal   int    `json:"seatsTotal"`
	SeatsBooked  int    `json:"seatsBooked"`
	Status       string `json:"status"`
}

// busFareAudit is the audit payload of a fare-approval transition.
type busFareAudit struct {
	FareApproved bool   `json:"fare_approved"`
	FareKobo     *int64 `json:"fare_kobo,omitempty"`
	ViaRoute     string `json:"via_route,omitempty"`
}

// buildBusScheduleAdminWhere validates the filter and returns the WHERE clause
// (leading " WHERE …" or "") with its positional args. Pure, so it is unit-tested.
func buildBusScheduleAdminWhere(f BusScheduleAdminFilter) (string, []any, error) {
	var conds []string
	var args []any
	add := func(cond string, v any) {
		args = append(args, v)
		conds = append(conds, fmt.Sprintf(cond, len(args)))
	}
	if f.RouteID != "" {
		add("s.route_id::text = $%d", f.RouteID)
	}
	if f.ProviderID != "" {
		add("r.provider_id::text = $%d", f.ProviderID)
	}
	if f.Status != "" {
		if !validBusScheduleStatus(f.Status) {
			return "", nil, codedErr(http.StatusBadRequest, CodeInvalidState, "unknown schedule status")
		}
		add("s.status = $%d", f.Status)
	}
	if f.FareApproved != nil {
		add("s.fare_approved = $%d", *f.FareApproved)
	}
	for _, d := range []struct{ v, op string }{{f.From, ">="}, {f.To, "<="}} {
		if d.v == "" {
			continue
		}
		if _, err := time.Parse("2006-01-02", d.v); err != nil {
			return "", nil, codedErr(http.StatusBadRequest, "INVALID_DATE", "from/to must be YYYY-MM-DD")
		}
		add("s.departure_time::date "+d.op+" $%d::date", d.v)
	}
	if len(conds) == 0 {
		return "", args, nil
	}
	return " WHERE " + strings.Join(conds, " AND "), args, nil
}

// ListBusSchedulesAdmin pages every schedule (any status / approval) newest
// departure first, with seats booked = active (non-cancelled/refunded) tickets.
func (a *AdminService) ListBusSchedulesAdmin(ctx context.Context, f BusScheduleAdminFilter) (map[string]any, error) {
	where, args, err := buildBusScheduleAdminWhere(f)
	if err != nil {
		return nil, err
	}
	const from = `
		FROM bus_schedules s
		JOIN bus_routes r ON r.id = s.route_id
		LEFT JOIN bus_providers p ON p.id = r.provider_id
		LEFT JOIN user_profiles up ON up.id = r.operator_id`
	var total int
	if err := a.svc.db.QueryRow(ctx, `SELECT COUNT(*)`+from+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	q := `
		SELECT s.id::text, s.route_id::text, r.origin_terminal, r.dest_terminal, ` + busOperatorNameSQL + `,
		       s.departure_time, s.fare_kobo, s.fare_approved, s.total_seats, s.status,
		       COALESCE((SELECT COUNT(*) FROM bus_tickets t
		                 WHERE t.schedule_id = s.id AND t.status NOT IN ('cancelled','refunded')), 0)` +
		from + where +
		fmt.Sprintf(" ORDER BY s.departure_time DESC, s.id LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)
	rows, err := a.svc.db.Query(ctx, q, append(args, f.Limit, f.Offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []busScheduleAdminRow{}
	for rows.Next() {
		var r busScheduleAdminRow
		var origin, dest string
		var dep time.Time
		if err := rows.Scan(&r.ID, &r.RouteID, &origin, &dest, &r.OperatorName, &dep, &r.FareKobo,
			&r.FareApproved, &r.SeatsTotal, &r.Status, &r.SeatsBooked); err != nil {
			return nil, err
		}
		r.RouteLabel = origin + " → " + dest
		r.DepartAt = dep.UTC().Format(time.RFC3339)
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"schedules": out, "total": total, "limit": f.Limit, "offset": f.Offset}, nil
}

// busRouteFareApproval is the PATCH /bus/routes/:id/approve-fare response.
type busRouteFareApproval struct {
	OK            bool     `json:"ok"`
	RouteID       string   `json:"routeId"`
	ApprovedCount int      `json:"approvedCount"`
	ScheduleIDs   []string `json:"scheduleIds"`
}

// ApproveBusRouteFares approves every still-bookable (scheduled/boarding)
// schedule on a route whose fare is unapproved, in one transaction with one
// audit row per schedule plus a route-level summary row.

func (a *AdminService) ApproveBusRouteFares(ctx context.Context, adminID, routeID, reason string) (*busRouteFareApproval, error) {
	if strings.TrimSpace(reason) == "" {
		return nil, codedErr(http.StatusBadRequest, CodeInvalidState, "a reason is required to approve fares")
	}
	tx, err := a.svc.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM bus_routes WHERE id::text=$1)`, routeID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "route not found")
	}
	rows, err := tx.Query(ctx, `
		UPDATE bus_schedules SET fare_approved=TRUE
		WHERE route_id::text=$1 AND fare_approved=FALSE AND status IN ('scheduled','boarding')
		RETURNING id::text, fare_kobo`, routeID)
	if err != nil {
		return nil, err
	}
	type approvedFare struct {
		id   string
		fare int64
	}
	var approved []approvedFare
	for rows.Next() {
		var f approvedFare
		if err := rows.Scan(&f.id, &f.fare); err != nil {
			rows.Close()
			return nil, err
		}
		approved = append(approved, f)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(approved))
	for _, f := range approved {
		ids = append(ids, f.id)
		fare := f.fare
		if err := writeAudit(ctx, tx, adminID, "bus.fare.approve", "bus_schedule", f.id,
			busFareAudit{FareApproved: false},
			busFareAudit{FareApproved: true, FareKobo: &fare, ViaRoute: routeID}, reason); err != nil {
			return nil, err
		}
	}
	if err := writeAudit(ctx, tx, adminID, "bus.route.fares.approve", "bus_route", routeID, nil,
		map[string]any{"approved_schedule_ids": ids, "approved_count": len(ids)}, reason); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &busRouteFareApproval{OK: true, RouteID: routeID, ApprovedCount: len(ids), ScheduleIDs: ids}, nil
}

// AdminBusListSchedules pages schedules (route/operator/status/approval/date filters).
func (h *AdminHandler) AdminBusListSchedules(c *gin.Context) {
	limit, offset := ginutil.PageParams(c, 50, 200)
	f := BusScheduleAdminFilter{
		RouteID: c.Query("route_id"), ProviderID: c.Query("provider_id"), Status: c.Query("status"),
		FareApproved: ginutil.BoolParam(c, "fare_approved"), From: c.Query("from"), To: c.Query("to"),
		Limit: limit, Offset: offset,
	}
	res, err := h.svc.ListBusSchedulesAdmin(c.Request.Context(), f)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// AdminBusApproveRouteFares approves every pending schedule fare on a route.
func (h *AdminHandler) AdminBusApproveRouteFares(c *gin.Context) {
	var req CancelRequest
	_ = c.ShouldBindJSON(&req)
	res, err := h.svc.ApproveBusRouteFares(c.Request.Context(), ginutil.UserID(c), c.Param("id"), req.Reason)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}
