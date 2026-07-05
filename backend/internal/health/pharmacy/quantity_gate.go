package healthpharmacy

// Server-side rolling-window quantity caps (Symptom-Search PRD §5.5). The
// mobile stepper caps at max_qty_per_window COSMETICALLY; production fails
// closed HERE, at order creation, before any funds are held.
//
// Seam style mirrors ReviewCaseOpener: an optional, nil-safe collaborator
// injected at wiring time (finance_routes wires it only when the symptom-
// search flag is on — flag off ⇒ nil gate ⇒ CreateOrder behavior unchanged).
// Unlike the review opener (best-effort, post-payment), the quantity gate is
// BLOCKING: it runs after the idempotent-replay short-circuit and the catalog
// pricing loop, immediately before escrow.Hold — a capped line rejects the
// order with 422 QTY_CAP_EXCEEDED and no money moves.
//
// Cap semantics: order lines are product-keyed (pharmacy_order_lines has no
// sku_id), so the cap keys on the PRODUCT via its pharmacy_skus rows — the
// strictest non-null max_qty_per_window among the product's active SKUs wins,
// with that SKU's qty_window_days as the rolling window. Only products with
// at least one capped SKU are gated. The window sum counts the user's ordered
// quantity across all their orders in the window EXCLUDING terminally
// unwound ones (CANCELLED / REFUNDED — the schema's equivalents of the PRD's
// "cancelled/rejected"; a review-case REJECT lands the order in exactly
// those states via the refund path).

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CodeQtyCapExceeded is the machine-readable 422 code the clients key on
// (contracts/openapi.yaml QuantityCapError).
const CodeQtyCapExceeded = "QTY_CAP_EXCEEDED"

// QuantityGate is the optional per-SKU quantity-cap seam. nil is safe (no
// gating — pre-hardening behavior unchanged).
type QuantityGate interface {
	// CheckQuantity returns nil when patientID may order qty more units of
	// productID, a *QuantityCapError when the rolling-window cap rejects it,
	// or a plain error on infrastructure failure (fail-closed upstream).
	CheckQuantity(ctx context.Context, patientID, productID string, qty int) error
}

// SetQuantityGate injects the optional quantity-cap seam at wiring time.
func (s *Service) SetQuantityGate(g QuantityGate) { s.qty = g }

// QuantityCapError carries the structured 422 payload (code, cap, window,
// remaining allowance) per the contract.
type QuantityCapError struct {
	ProductID  string
	MaxQty     int
	WindowDays int
	Requested  int
	Remaining  int
}

func (e *QuantityCapError) Error() string {
	return fmt.Sprintf("pharmacy: quantity cap exceeded for this item — limit %d per %d days, %d remaining (requested %d)",
		e.MaxQty, e.WindowDays, e.Remaining, e.Requested)
}

// checkQuantityCaps runs every order line through the gate (nil-safe no-op).
// Called from CreateOrder after the replay short-circuit and pricing loop,
// BEFORE escrow.Hold — the cap rejects the order before money moves.
func (s *Service) checkQuantityCaps(ctx context.Context, patientID string, lines []OrderLineInput) error {
	if s.qty == nil {
		return nil
	}
	for _, li := range lines {
		if err := s.qty.CheckQuantity(ctx, patientID, li.ProductID, li.Quantity); err != nil {
			return err
		}
	}
	return nil
}

// failCreateOrder maps a CreateOrder error onto the 422 body: a quantity-cap
// rejection gets the structured QuantityCapError shape (code + remaining);
// everything else keeps the plain {success,error} envelope.
func failCreateOrder(c *gin.Context, err error) {
	var qe *QuantityCapError
	if errors.As(err, &qe) {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"success":     false,
			"code":        CodeQtyCapExceeded,
			"error":       qe.Error(),
			"product_id":  qe.ProductID,
			"max_qty":     qe.MaxQty,
			"window_days": qe.WindowDays,
			"remaining":   qe.Remaining,
		})
		return
	}
	fail(c, http.StatusUnprocessableEntity, err.Error())
}

// ─── Production gate (pgx, same money-path DB convention as the service) ─────

// PgxQuantityGate enforces the cap against pharmacy_skus (cap definition) and
// pharmacy_orders/pharmacy_order_lines (window consumption).
type PgxQuantityGate struct{ db *pgxpool.Pool }

func NewPgxQuantityGate(db *pgxpool.Pool) *PgxQuantityGate { return &PgxQuantityGate{db: db} }

func (g *PgxQuantityGate) CheckQuantity(ctx context.Context, patientID, productID string, qty int) error {
	if qty <= 0 {
		return nil // CreateOrder validates positivity itself
	}
	// Strictest capped SKU of the product; ties broken by the SHORTER window
	// being stricter is not true in general, so ties prefer the LONGER window
	// (more conservative: same cap spread over more days).
	const qCap = `
		SELECT max_qty_per_window, qty_window_days
		FROM pharmacy_skus
		WHERE product_id = $1 AND active = true AND max_qty_per_window IS NOT NULL
		ORDER BY max_qty_per_window ASC, qty_window_days DESC
		LIMIT 1`
	var maxQty, windowDays int
	err := g.db.QueryRow(ctx, qCap, productID).Scan(&maxQty, &windowDays)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // no capped SKU ⇒ product is not gated
	}
	if err != nil {
		return fmt.Errorf("pharmacy: quantity cap lookup: %w", err)
	}

	// Summed consumption in the rolling window, excluding terminally unwound
	// orders (CANCELLED / REFUNDED).
	const qUsed = `
		SELECT COALESCE(SUM(l.quantity), 0)
		FROM pharmacy_order_lines l
		JOIN pharmacy_orders o ON o.id = l.order_id
		WHERE o.patient_id = $1
		  AND l.product_id = $2
		  AND o.state NOT IN ('CANCELLED','REFUNDED')
		  AND o.created_at >= now() - make_interval(days => $3)`
	var used int
	if err := g.db.QueryRow(ctx, qUsed, patientID, productID, windowDays).Scan(&used); err != nil {
		return fmt.Errorf("pharmacy: quantity cap window sum: %w", err)
	}

	if used+qty > maxQty {
		remaining := maxQty - used
		if remaining < 0 {
			remaining = 0
		}
		return &QuantityCapError{
			ProductID: productID, MaxQty: maxQty, WindowDays: windowDays,
			Requested: qty, Remaining: remaining,
		}
	}
	return nil
}
