package restaurant

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode"

	"spotlight/backend/go-common/fsm"
)

// OrderType is the fulfilment mode of an order (FOOD-UAT-D-007).
type OrderType string

const (
	OrderTypeDelivery        OrderType = "delivery"
	OrderTypePickupNow       OrderType = "pickup_now"
	OrderTypePickupScheduled OrderType = "pickup_scheduled"
	OrderTypeDineIn          OrderType = "dine_in"
)

const (
	// pickupScheduledWindow is how far ahead a pickup_scheduled slot may be.
	pickupScheduledWindow = 24 * time.Hour
	maxTableNumberLen     = 20
	maxLandmarkLen        = 200
	maxRecipientPhoneLen  = 20
)

// normalizeOrderType maps an empty client value to delivery (back-compat: every
// pre-existing client omits order_type). Unknown values are returned as-is and
// rejected by validateOrderType.
func normalizeOrderType(s string) OrderType {
	t := OrderType(strings.TrimSpace(s))
	if t == "" {
		return OrderTypeDelivery
	}
	return t
}

// Valid reports whether t is one of the four supported order types.
func (t OrderType) Valid() bool {
	switch t {
	case OrderTypeDelivery, OrderTypePickupNow, OrderTypePickupScheduled, OrderTypeDineIn:
		return true
	}
	return false
}

// IsPickup is true for both counter-collection types.
func (t OrderType) IsPickup() bool {
	return t == OrderTypePickupNow || t == OrderTypePickupScheduled
}

// UsesRider is true only for delivery: pickup and dine-in skip dispatch, the
// delivery fee, the rider tip and the rider settlement leg.
func (t OrderType) UsesRider() bool { return t == OrderTypeDelivery || t == "" }

// validateOrderType checks the per-type request shape (pure, no DB). Errors wrap
// ErrOrderInvalid / ErrScheduledSlotInvalid, both mapped to 400 by escrowErrStatus.
// Delivery coordinates for the delivery type are validated by ValidateDeliveryCoords
// (handler) — pickup and dine-in need no address at all.
func validateOrderType(req PlaceOrderRequest, now time.Time) (OrderType, error) {
	t := normalizeOrderType(req.OrderType)
	if !t.Valid() {
		return t, fmt.Errorf("%w: unknown order_type %q", ErrOrderInvalid, req.OrderType)
	}
	switch t {
	case OrderTypePickupNow:
		if req.ScheduledFor != nil {
			return t, fmt.Errorf("%w: scheduled_for is only valid for pickup_scheduled", ErrOrderInvalid)
		}
	case OrderTypePickupScheduled:
		if req.ScheduledFor == nil {
			return t, fmt.Errorf("%w: pickup_scheduled requires scheduled_for", ErrScheduledSlotInvalid)
		}
		if !req.ScheduledFor.After(now) {
			return t, fmt.Errorf("%w: scheduled_for must be in the future", ErrScheduledSlotInvalid)
		}
		if req.ScheduledFor.After(now.Add(pickupScheduledWindow)) {
			return t, fmt.Errorf("%w: a pickup may be scheduled at most %v ahead", ErrScheduledSlotInvalid, pickupScheduledWindow)
		}
	case OrderTypeDineIn:
		tn := strings.TrimSpace(req.TableNumber)
		if tn == "" {
			return t, fmt.Errorf("%w: dine_in requires table_number", ErrOrderInvalid)
		}
		if len(tn) > maxTableNumberLen {
			return t, fmt.Errorf("%w: table_number is too long", ErrOrderInvalid)
		}
		if req.ScheduledFor != nil {
			return t, fmt.Errorf("%w: scheduled_for is only valid for pickup_scheduled", ErrOrderInvalid)
		}
	}
	return t, nil
}

// cleanTableNumber / cleanRecipientPhone / cleanLandmark normalise free text bound
// for the kitchen's and rider's screens.
func cleanTableNumber(s string) string { return strings.TrimSpace(sanitizeInstructions(s)) }

func cleanLandmark(s string) string {
	out := sanitizeInstructions(s)
	if len(out) > maxLandmarkLen {
		out = strings.TrimSpace(out[:maxLandmarkLen])
	}
	return out
}

// cleanRecipientPhone keeps digits and a leading '+', dropping everything else.
func cleanRecipientPhone(s string) string {
	var b strings.Builder
	for i, r := range strings.TrimSpace(s) {
		if unicode.IsDigit(r) || (r == '+' && i == 0) {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if len(out) > maxRecipientPhoneLen {
		out = out[:maxRecipientPhoneLen]
	}
	return out
}

// Per-type lifecycle tables. Delivery keeps orderTransitions unchanged.
var pickupTransitions = fsm.Table[OrderStatus]{
	OrderPending:   fsm.Set(OrderConfirmed, OrderCancelled, OrderRejected),
	OrderConfirmed: fsm.Set(OrderPreparing, OrderCancelled, OrderRejected),
	OrderPreparing: fsm.Set(OrderReady, OrderCancelled),
	OrderReady:     fsm.Set(OrderPickedUp, OrderCancelled), // picked_up = customer collected; terminal
}

var dineInTransitions = fsm.Table[OrderStatus]{
	OrderPending:   fsm.Set(OrderConfirmed, OrderCancelled, OrderRejected),
	OrderConfirmed: fsm.Set(OrderPreparing, OrderCancelled, OrderRejected),
	OrderPreparing: fsm.Set(OrderServed, OrderCancelled),
	OrderServed:    fsm.Set(OrderClosed),
}

// canTransitionFor is the order-type-aware lifecycle guard. Delivery (and any
// unknown/legacy empty type) uses the original table.
func canTransitionFor(t OrderType, from, to OrderStatus) bool {
	switch t {
	case OrderTypePickupNow, OrderTypePickupScheduled:
		return pickupTransitions.Can(from, to)
	case OrderTypeDineIn:
		return dineInTransitions.Can(from, to)
	}
	return canTransition(from, to)
}

// settleStatusFor is the status whose arrival releases the escrow for a non-delivery
// order: customer collection for pickup, served for dine-in. "" for delivery (which
// settles on `delivered`, via the proof-of-delivery gate).
func settleStatusFor(t OrderType) OrderStatus {
	switch t {
	case OrderTypePickupNow, OrderTypePickupScheduled:
		return OrderPickedUp
	case OrderTypeDineIn:
		return OrderServed
	}
	return ""
}

// orderTypeOf reads an order's type (legacy rows default to delivery).
func (s *Service) orderTypeOf(ctx context.Context, orderID string) OrderType {
	var t string
	if err := s.db.QueryRow(ctx, `SELECT COALESCE(order_type,'delivery') FROM orders WHERE id=$1`, orderID).Scan(&t); err != nil {
		return OrderTypeDelivery
	}
	return OrderType(t)
}

// hydrateOrderExtras fills order_type/table_number/special_instructions for every
// viewer, and the delivery pin + recipient contact ONLY for the assigned rider
// (role "rider") — the customer already knows them and the kitchen has no use for
// them, so they are not serialised there (PII minimisation, FOOD-UAT-C-012).
// One query for the whole slice. Best-effort: a read failure leaves defaults.
func (s *Service) hydrateOrderExtras(ctx context.Context, orders []Order, role string) {
	if len(orders) == 0 {
		return
	}
	ids := make([]string, len(orders))
	idx := make(map[string]int, len(orders))
	for i := range orders {
		ids[i] = orders[i].ID
		idx[orders[i].ID] = i
	}
	rows, err := s.db.Query(ctx,
		`SELECT id::text, COALESCE(order_type,'delivery'), table_number, COALESCE(special_instructions,''),
		        delivery_latitude::float8, delivery_longitude::float8, delivery_landmark, delivery_recipient_phone
		   FROM orders WHERE id::text = ANY($1)`, ids)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id, ot, si string
		var table, landmark, phone *string
		var lat, lng *float64
		if err := rows.Scan(&id, &ot, &table, &si, &lat, &lng, &landmark, &phone); err != nil {
			return
		}
		o := &orders[idx[id]]
		o.OrderType = OrderType(ot)
		o.TableNumber = table
		o.SpecialInstructions = si
		if role == "rider" {
			o.DeliveryLatitude, o.DeliveryLongitude = lat, lng
			o.DeliveryLandmark, o.DeliveryRecipientPhone = landmark, phone
		}
	}
}

func nullIfEmptyPtr(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}
