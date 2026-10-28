// Package finance is the telemedicine admin console's READ-ONLY view of doctor
// earnings, payouts, invoices, settlement disputes and commission configuration
// (contracts/telemedicine-admin-finance.openapi.yaml).
//
// It never writes: no payout, wallet, ledger or dispute row is created, updated
// or deleted here. Settlement disputes are read-only because the doctor module
// only ever defines the "open" state — there is no admin workflow state to move
// a dispute to, and inventing one would be a schema/behaviour change owned by the
// doctor module. Money is integer kobo throughout.
package finance

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/httperr"
)

// reader is what the handlers need; store implements it and tests fake it.
type reader interface {
	summary(ctx context.Context, w window) (Summary, error)
	payouts(ctx context.Context, status, doctorUserID *string, w window, pg page) (list[Payout], error)
	payout(ctx context.Context, id string) (PayoutDetail, error)
	earnings(ctx context.Context, doctorUserID *string, w window, pg page) (list[DoctorEarnings], error)
	invoices(ctx context.Context, doctorUserID, status *string, w window, pg page) (list[Invoice], error)
	disputes(ctx context.Context, status, payoutID *string, pg page) (list[Dispute], error)
	dispute(ctx context.Context, id string) (DisputeDetail, error)
	commissionConfig(ctx context.Context) (CommissionConfigView, error)
}

type handler struct{ rd reader }

// Register mounts the finance oversight routes under g, which is already the
// /api/v1/telemedicine/admin group with authentication applied. Every route is a
// GET behind view (telemedicine.admin.view). manage is accepted for the shared
// admin contract but intentionally unused: this surface has no mutations.
func Register(g *gin.RouterGroup, db *pgxpool.Pool, view, manage gin.HandlerFunc) {
	_ = manage
	var q querier
	if db != nil {
		q = db
	}
	registerRoutes(g, store{db: q}, view)
}

func registerRoutes(g *gin.RouterGroup, rd reader, view gin.HandlerFunc) {
	h := handler{rd: rd}
	f := g.Group("/finance")
	f.GET("/summary", view, h.getSummary)
	f.GET("/payouts", view, h.listPayouts)
	f.GET("/payouts/:id", view, h.getPayout)
	f.GET("/earnings", view, h.listEarnings)
	f.GET("/invoices", view, h.listInvoices)
	f.GET("/disputes", view, h.listDisputes)
	f.GET("/disputes/:id", view, h.getDispute)
	f.GET("/commission-config", view, h.getCommissionConfig)
}

func fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errBadParam):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid query parameter"})
	case errors.Is(err, errNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

func ok(c *gin.Context, v any) { c.JSON(http.StatusOK, gin.H{"data": v}) }

func (h handler) getSummary(c *gin.Context) {
	w, err := parseWindow(c.Query("from"), c.Query("to"))
	if err != nil {
		fail(c, err)
		return
	}
	out, err := h.rd.summary(c.Request.Context(), w)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, out)
}

func (h handler) listPayouts(c *gin.Context) {
	status, err := parsePayoutStatus(c.Query("status"))
	if err != nil {
		fail(c, err)
		return
	}
	doc, err := parseUUIDParam(c.Query("doctor_user_id"))
	if err != nil {
		fail(c, err)
		return
	}
	w, err := parseWindow(c.Query("from"), c.Query("to"))
	if err != nil {
		fail(c, err)
		return
	}
	pg, err := parsePage(c.Query("limit"), c.Query("offset"))
	if err != nil {
		fail(c, err)
		return
	}
	out, err := h.rd.payouts(c.Request.Context(), status, doc, w, pg)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, out)
}

func (h handler) getPayout(c *gin.Context) {
	id, err := parseUUIDParam(c.Param("id"))
	if err != nil || id == nil {
		fail(c, errBadParam)
		return
	}
	out, err := h.rd.payout(c.Request.Context(), *id)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, out)
}

func (h handler) listEarnings(c *gin.Context) {
	doc, err := parseUUIDParam(c.Query("doctor_user_id"))
	if err != nil {
		fail(c, err)
		return
	}
	w, err := parseWindow(c.Query("from"), c.Query("to"))
	if err != nil {
		fail(c, err)
		return
	}
	pg, err := parsePage(c.Query("limit"), c.Query("offset"))
	if err != nil {
		fail(c, err)
		return
	}
	out, err := h.rd.earnings(c.Request.Context(), doc, w, pg)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, out)
}

func (h handler) listInvoices(c *gin.Context) {
	doc, err := parseUUIDParam(c.Query("doctor_user_id"))
	if err != nil {
		fail(c, err)
		return
	}
	status, err := parseFreeStatus(c.Query("status"))
	if err != nil {
		fail(c, err)
		return
	}
	w, err := parseWindow(c.Query("from"), c.Query("to"))
	if err != nil {
		fail(c, err)
		return
	}
	pg, err := parsePage(c.Query("limit"), c.Query("offset"))
	if err != nil {
		fail(c, err)
		return
	}
	out, err := h.rd.invoices(c.Request.Context(), doc, status, w, pg)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, out)
}

func (h handler) listDisputes(c *gin.Context) {
	status, err := parseFreeStatus(c.Query("status"))
	if err != nil {
		fail(c, err)
		return
	}
	pg, err := parsePage(c.Query("limit"), c.Query("offset"))
	if err != nil {
		fail(c, err)
		return
	}
	out, err := h.rd.disputes(c.Request.Context(), status, nil, pg)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, out)
}

func (h handler) getDispute(c *gin.Context) {
	id, err := parseUUIDParam(c.Param("id"))
	if err != nil || id == nil {
		fail(c, errBadParam)
		return
	}
	out, err := h.rd.dispute(c.Request.Context(), *id)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, out)
}

func (h handler) getCommissionConfig(c *gin.Context) {
	out, err := h.rd.commissionConfig(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, out)
}
