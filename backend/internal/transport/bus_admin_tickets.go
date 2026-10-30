package transport

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// BusAdminTicketFilter drives GET /admin/transport/bus/tickets.
type BusAdminTicketFilter struct {
	Query, Status, RefundStatus, ScheduleID, From, To string
	Limit, Offset                                     int
}

func (f *BusAdminTicketFilter) normalize() {
	if f.Limit <= 0 {
		f.Limit = 50
	}
	if f.Limit > 100 {
		f.Limit = 100
	}
	if f.Offset < 0 {
		f.Offset = 0
	}
}

// busAdminTicket is one row of the admin ticket search / refund queue (kobo).
type busAdminTicket struct {
	ID                     string     `json:"id"`
	UserID                 string     `json:"userId"`
	ScheduleID             string     `json:"scheduleId"`
	SeatNumber             int        `json:"seatNumber"`
	PassengerName          string     `json:"passengerName"`
	PassengerPhone         *string    `json:"passengerPhone"`
	Status                 string     `json:"status"`
	BoardingStatus         string     `json:"boardingStatus"`
	PaymentStatus          string     `json:"paymentStatus"`
	RefundStatus           string     `json:"refundStatus"`
	SettleMode             string     `json:"settleMode"`
	PayoutState            string     `json:"payoutState"`
	FareKobo               int64      `json:"fareKobo"`
	CreatedAt              time.Time  `json:"createdAt"`
	CancelledAt            *time.Time `json:"cancelledAt"`
	CancelReason           *string    `json:"cancelReason"`
	DepartureTime          time.Time  `json:"departureTime"`
	RouteLabel             string     `json:"routeLabel"`
	OperatorName           string     `json:"operatorName"`
	SettleUserID           *string    `json:"settleUserId"`
	SettlementStatus       *string    `json:"settlementStatus"`
	ProviderKobo           *int64     `json:"providerKobo"`
	FeeKobo                *int64     `json:"feeKobo"`
	ManualRefundMethod     *string    `json:"manualRefundMethod"`
	ManualRefundReference  *string    `json:"manualRefundReference"`
	ManualRefundResolvedAt *time.Time `json:"manualRefundResolvedAt"`
}

const busAdminTicketCols = `
	SELECT t.id, t.user_id::text, t.schedule_id::text, t.seat_number, t.passenger_name, t.passenger_phone,
	       t.status, t.boarding_status, t.payment_status, t.refund_status, t.settle_mode, t.payout_state,
	       t.fare_kobo, t.created_at, t.cancelled_at, t.cancel_reason,
	       s.departure_time, COALESCE(r.from_city, r.origin_terminal), COALESCE(r.to_city, r.dest_terminal),
	       COALESCE(p.business_name, ''), t.settle_user_id::text,
	       st.status, st.provider_kobo, st.fee_kobo,
	       t.manual_refund_method, t.manual_refund_reference, t.manual_refund_resolved_at
	FROM bus_tickets t
	JOIN bus_schedules s ON s.id = t.schedule_id
	JOIN bus_routes r ON r.id = s.route_id
	LEFT JOIN bus_providers p ON p.id = r.provider_id
	LEFT JOIN settlements st ON st.id = t.settlement_id`

func (a *AdminService) queryBusAdminTickets(ctx context.Context, where string, args []any, limit, offset int) (map[string]any, error) {
	var total int
	if err := a.svc.db.QueryRow(ctx, `SELECT COUNT(*) FROM bus_tickets t`+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	n := len(args)
	q := busAdminTicketCols + where + fmt.Sprintf(" ORDER BY t.created_at DESC, t.id DESC LIMIT $%d OFFSET $%d", n+1, n+2)
	rows, err := a.svc.db.Query(ctx, q, append(args, limit, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []busAdminTicket{}
	for rows.Next() {
		var t busAdminTicket
		var origin, dest string
		if err := rows.Scan(&t.ID, &t.UserID, &t.ScheduleID, &t.SeatNumber, &t.PassengerName, &t.PassengerPhone,
			&t.Status, &t.BoardingStatus, &t.PaymentStatus, &t.RefundStatus, &t.SettleMode, &t.PayoutState,
			&t.FareKobo, &t.CreatedAt, &t.CancelledAt, &t.CancelReason, &t.DepartureTime, &origin, &dest,
			&t.OperatorName, &t.SettleUserID, &t.SettlementStatus, &t.ProviderKobo, &t.FeeKobo,
			&t.ManualRefundMethod, &t.ManualRefundReference, &t.ManualRefundResolvedAt); err != nil {
			return nil, err
		}
		t.RouteLabel = origin + " → " + dest
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"tickets": out, "total": total, "limit": limit, "offset": offset}, nil
}

// ListBusTicketsAdmin is the paginated, filterable ticket search for ops.
func (a *AdminService) ListBusTicketsAdmin(ctx context.Context, f BusAdminTicketFilter) (map[string]any, error) {
	f.normalize()
	conds := []string{}
	args := []any{}
	add := func(cond string, v any) {
		args = append(args, v)
		conds = append(conds, strings.ReplaceAll(cond, "?", fmt.Sprintf("$%d", len(args))))
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		add(`(t.id::text = ? OR t.qr_code = ? OR t.passenger_name ILIKE '%' || ? || '%' OR t.passenger_phone ILIKE '%' || ? || '%')`, q)
	}
	if f.Status != "" {
		add("t.status = ?", f.Status)
	}
	if f.RefundStatus != "" {
		add("t.refund_status = ?", f.RefundStatus)
	}
	if f.ScheduleID != "" {
		add("t.schedule_id::text = ?", f.ScheduleID)
	}
	if f.From != "" {
		add("t.created_at >= ?::date", f.From)
	}
	if f.To != "" {
		add("t.created_at < ?::date + 1", f.To)
	}
	where := ""
	if len(conds) > 0 {
		where = " WHERE " + strings.Join(conds, " AND ")
	}
	return a.queryBusAdminTickets(ctx, where, args, f.Limit, f.Offset)
}

// ListManualBusRefunds is the ops refund queue: every manual_required ticket plus
// pending/failed refunds older than stuckMinutes (the retry sweeper is not
// clearing them).
func (a *AdminService) ListManualBusRefunds(ctx context.Context, stuckMinutes, limit, offset int) (map[string]any, error) {
	f := BusAdminTicketFilter{Limit: limit, Offset: offset}
	f.normalize()
	if stuckMinutes <= 0 {
		stuckMinutes = 30
	}
	where := ` WHERE t.refund_status = 'manual_required'
	   OR (t.refund_status IN ('pending','failed') AND t.cancelled_at < NOW() - make_interval(mins => $1))`
	return a.queryBusAdminTickets(ctx, where, []any{stuckMinutes}, f.Limit, f.Offset)
}
