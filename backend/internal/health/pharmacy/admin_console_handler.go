package healthpharmacy

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
)

const keyData = "data"

// adminList writes the admin envelope ({success, data}) the console unwraps.
func adminList(c *gin.Context, rows any, err error) {
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyData: rows})
}

// enumQuery returns ?name= when it is empty or in allowed, else writes 400.
func enumQuery(c *gin.Context, name string, allowed map[string]bool) (string, bool) {
	v := c.Query(name)
	if v != "" && !allowed[v] {
		ginutil.FailOK(c, http.StatusBadRequest, name+" is not a recognised value")
		return "", false
	}
	return v, true
}

// AdminPcnApplications — GET /pcn/applications?status=&q=
func (h *Handler) AdminPcnApplications(c *gin.Context) {
	st, ok := enumQuery(c, "status", pcnStatuses)
	if !ok {
		return
	}
	rows, err := h.svc.AdminListPcnApplications(c.Request.Context(), st, c.Query("q"))
	adminList(c, rows, err)
}

// AdminCatalog — GET /catalog?status=&pom=pom|otc&q=
func (h *Handler) AdminCatalog(c *gin.Context) {
	st, ok := enumQuery(c, "status", catalogStatuses)
	if !ok {
		return
	}
	pom, ok := enumQuery(c, "pom", map[string]bool{"pom": true, catalogOTC: true})
	if !ok {
		return
	}
	rows, err := h.svc.AdminListCatalog(c.Request.Context(), st, pom, c.Query("q"))
	adminList(c, rows, err)
}

// AdminRxAudit — GET /rx-audit?status=&q=
func (h *Handler) AdminRxAudit(c *gin.Context) {
	st, ok := enumQuery(c, "status", rxAuditStatuses)
	if !ok {
		return
	}
	rows, err := h.svc.AdminRxAudit(c.Request.Context(), st, c.Query("q"))
	adminList(c, rows, err)
}

// AdminControlledLog — GET /controlled-log?q=
func (h *Handler) AdminControlledLog(c *gin.Context) {
	rows, err := h.svc.AdminControlledLog(c.Request.Context(), c.Query("q"))
	adminList(c, rows, err)
}

// AdminPayouts — GET /payouts?payout_status=&q=
func (h *Handler) AdminPayouts(c *gin.Context) {
	st, ok := enumQuery(c, "payout_status", map[string]bool{statusPending: true, statusApproved: true, "paid": true,
		"kyc_hold": true, statusRejected: true})
	if !ok {
		return
	}
	rows, err := h.svc.AdminListPayouts(c.Request.Context(), st, c.Query("q"))
	adminList(c, rows, err)
}

// AdminReporting — GET /reporting?period=7d|30d|90d&format=json|csv
func (h *Handler) AdminReporting(c *gin.Context) {
	if _, ok := requireUser(c); !ok {
		return
	}
	format := c.DefaultQuery("format", "json")
	if format != "json" && format != "csv" {
		ginutil.FailOK(c, http.StatusBadRequest, "format must be json or csv")
		return
	}
	r, err := h.svc.AdminReporting(c.Request.Context(), c.Query("period"))
	if err != nil {
		if errors.Is(err, ErrBadPeriod) {
			ginutil.FailOK(c, http.StatusBadRequest, err.Error())
			return
		}
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	if format == "csv" {
		c.Header("Content-Type", "text/csv; charset=utf-8")
		c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="pharmacy-report-%s.csv"`, r.Period))
		c.Status(http.StatusOK)
		if err := WriteReportCSV(c.Writer, r); err != nil {
			_ = c.Error(err)
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyData: r})
}
