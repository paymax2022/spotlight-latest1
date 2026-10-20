package restaurant

// FOOD-UAT-D-007: merchant-side proof of customer collection. The customer
// shows the 4-digit pickup code (issued when the order went ready); the
// restaurant owner / counter staff enters it here. The code goes through the
// same attempt-limited VerifyOrderCode as the rider path (5 wrong tries lock it
// for 15 minutes, 429), then the order advances via the compare-and-set
// transitionInternal, which settles the rider-less escrow.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// authorizeCounter reports nil when actorID is the restaurant owner or an
// ACTIVE staff member who may progress orders (cashier/kitchen/manager).
func (s *Service) authorizeCounter(ctx context.Context, restaurantID, actorID string) error {
	role, status, err := s.ResolveStaffRole(ctx, restaurantID, actorID)
	if err != nil || role == "" || !Can(role, status, PermProgressOrder) {
		return ErrForbidden
	}
	return nil
}

// VerifyCustomerPickup verifies the customer's pickup code and moves a pickup
// order ready -> picked_up (settling it).
func (s *Service) VerifyCustomerPickup(ctx context.Context, orderID, actorID, code string) error {
	var restaurantID, status, orderType string
	var dbCode *string
	if err := s.db.QueryRow(ctx,
		`SELECT restaurant_id::text, status, COALESCE(order_type,'delivery'), pickup_code FROM orders WHERE id=$1`, orderID).
		Scan(&restaurantID, &status, &orderType, &dbCode); err != nil {
		return ErrOrderNotFoundForVerify
	}
	if err := s.authorizeCounter(ctx, restaurantID, actorID); err != nil {
		return err
	}
	if !OrderType(orderType).IsPickup() {
		return fmt.Errorf("%w: not a pickup order", ErrOrderInvalid)
	}
	if OrderStatus(status) != OrderReady {
		return fmt.Errorf("%w: order is %s, not ready", ErrOrderTransitionConflict, status)
	}
	if dbCode == nil || *dbCode == "" {
		return fmt.Errorf("%w: no pickup code issued", ErrOrderInvalid)
	}
	if err := s.VerifyOrderCode(ctx, orderID, CodeKindPickup, strings.TrimSpace(code), *dbCode); err != nil {
		return err
	}
	if _, err := s.db.Exec(ctx, `UPDATE orders SET picked_up_at=COALESCE(picked_up_at, now()) WHERE id=$1`, orderID); err != nil {
		return err
	}
	return s.transitionInternal(ctx, orderID, actorID, OrderPickedUp)
}

// VerifyTableClose closes a served dine-in order (served -> closed). tableNumber,
// when supplied, must match the order's table (guards against closing the wrong tab).
func (s *Service) VerifyTableClose(ctx context.Context, orderID, actorID, tableNumber string) error {
	var restaurantID, status, orderType string
	var table *string
	if err := s.db.QueryRow(ctx,
		`SELECT restaurant_id::text, status, COALESCE(order_type,'delivery'), table_number FROM orders WHERE id=$1`, orderID).
		Scan(&restaurantID, &status, &orderType, &table); err != nil {
		return ErrOrderNotFoundForVerify
	}
	if err := s.authorizeCounter(ctx, restaurantID, actorID); err != nil {
		return err
	}
	if OrderType(orderType) != OrderTypeDineIn {
		return fmt.Errorf("%w: not a dine-in order", ErrOrderInvalid)
	}
	if want := cleanTableNumber(tableNumber); want != "" && (table == nil || !strings.EqualFold(want, *table)) {
		return fmt.Errorf("%w: table number does not match this order", ErrOrderInvalid)
	}
	if OrderStatus(status) != OrderServed {
		return fmt.Errorf("%w: order is %s, not served", ErrOrderTransitionConflict, status)
	}
	return s.transitionInternal(ctx, orderID, actorID, OrderClosed)
}

// ErrOrderNotFoundForVerify -> 404.
var ErrOrderNotFoundForVerify = errors.New("restaurant: order not found")

func verifyStatus(err error) int {
	switch {
	case errors.Is(err, ErrOrderNotFoundForVerify):
		return http.StatusNotFound
	case errors.Is(err, ErrOrderInvalid):
		return http.StatusBadRequest
	}
	return statusCodeFor(err) // 403 / 409 / 429 / 400 (wrong code)
}

// VerifyCustomerPickup → POST /orders/:orderId/verify-customer-pickup {code}.
func (h *Handler) VerifyCustomerPickup(c *gin.Context) {
	var body struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.VerifyCustomerPickup(c.Request.Context(), c.Param("orderId"), ginutil.UserID(c), body.Code); err != nil {
		st := verifyStatus(err)
		c.JSON(st, gin.H{keyError: httperr.Msg(c, st, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": string(OrderPickedUp)})
}

// VerifyTableClose → POST /orders/:orderId/verify-table-close {table_number?}.
func (h *Handler) VerifyTableClose(c *gin.Context) {
	var body struct {
		TableNumber string `json:"table_number"`
	}
	_ = c.ShouldBindJSON(&body) // body is optional
	if err := h.svc.VerifyTableClose(c.Request.Context(), c.Param("orderId"), ginutil.UserID(c), body.TableNumber); err != nil {
		st := verifyStatus(err)
		c.JSON(st, gin.H{keyError: httperr.Msg(c, st, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": string(OrderClosed)})
}
