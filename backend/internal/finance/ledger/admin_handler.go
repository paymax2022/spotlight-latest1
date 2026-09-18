package ledger

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// AdminHandler exposes the centralized, read-only admin transactions console.
// RBAC is applied at the route layer (middleware.RequirePermission
// "finance.admin.transactions.view"). This surface never writes to
// ledger_entries — it is reporting only.
type AdminHandler struct {
	svc *Service
}

// NewAdminHandler builds the ledger admin handler.
func NewAdminHandler(svc *Service) *AdminHandler { return &AdminHandler{svc: svc} }

// dateLayouts tried, in order, when parsing from/to query params. Accepts a
// bare date (UI date-picker) or a full RFC3339 timestamp.
var dateLayouts = []string{time.RFC3339, "2006-01-02"}

func parseDateParam(v string) time.Time {
	if v == "" {
		return time.Time{}
	}
	for _, layout := range dateLayouts {
		if t, err := time.Parse(layout, v); err == nil {
			return t
		}
	}
	return time.Time{}
}

// ListTransactions handles GET /api/finance/admin/transactions. Query params:
// type, account_type, user_id, search, from, to (date or RFC3339),
// min_amount_kobo, max_amount_kobo, limit, offset.
func (h *AdminHandler) ListTransactions(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	minAmt, _ := strconv.ParseInt(c.Query("min_amount_kobo"), 10, 64)
	maxAmt, _ := strconv.ParseInt(c.Query("max_amount_kobo"), 10, 64)
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	f := AdminTransactionFilter{
		Type:          c.Query("type"),
		AccountType:   c.Query("account_type"),
		UserID:        c.Query("user_id"),
		Search:        c.Query("search"),
		From:          parseDateParam(c.Query("from")),
		To:            parseDateParam(c.Query("to")),
		MinAmountKobo: minAmt,
		MaxAmountKobo: maxAmt,
		Limit:         limit,
		Offset:        offset,
	}

	page, err := h.svc.AdminListTransactions(c.Request.Context(), f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":     true,
		"rows":        page.Rows,
		"total":       page.Total,
		"limit":       f.Limit,
		"offset":      f.Offset,
		"note_source": "source_inferred is a best-effort guess parsed from the reference string (SPLIT_PART on ':'); it is NOT an authoritative module field.",
	})
}

// GetTransaction handles GET /api/finance/admin/transactions/:id — the
// comprehensive single-transaction detail view: every column on the row
// (including idempotency_key, raw metadata, currency) plus every OTHER
// ledger_entries row sharing the same reference (the other leg(s) of the same
// balanced double-entry movement), so an operator sees the whole transaction.
func (h *AdminHandler) GetTransaction(c *gin.Context) {
	detail, err := h.svc.AdminGetTransaction(c.Request.Context(), c.Param("id"))
	if err != nil {
		if err == ErrTransactionNotFound {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "transaction not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":     true,
		"transaction": detail,
		"note_source": "source_inferred is a best-effort guess parsed from the reference string (SPLIT_PART on ':'); it is NOT an authoritative module field.",
	})
}
