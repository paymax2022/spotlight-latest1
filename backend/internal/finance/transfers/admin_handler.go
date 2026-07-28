package transfers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// AdminHandler exposes the finance-admin transfer console endpoints. RBAC is
// applied at the route layer (middleware.RequirePermission "finance.admin.transfers").
type AdminHandler struct {
	svc *Service
}

// NewAdminHandler builds the admin transfers handler.
func NewAdminHandler(svc *Service) *AdminHandler { return &AdminHandler{svc: svc} }

// List handles GET /api/finance/admin/transfers.
func (h *AdminHandler) List(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	f := AdminTransferFilter{
		Status:     c.Query("status"),
		Provider:   c.Query("provider"),
		SourceType: c.Query("source_type"),
		Limit:      limit,
		Offset:     offset,
	}
	rows, err := h.svc.AdminListTransfers(c.Request.Context(), f)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"transfers": rows})
}

// Get handles GET /api/finance/admin/transfers/:id.
func (h *AdminHandler) Get(c *gin.Context) {
	detail, err := h.svc.AdminGetTransfer(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, detail)
}

// Retry handles POST /api/finance/admin/transfers/:id/retry.
func (h *AdminHandler) Retry(c *gin.Context) {
	bt, err := h.svc.AdminRetry(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, bt)
}

// Reverse handles POST /api/finance/admin/transfers/:id/reverse.
func (h *AdminHandler) Reverse(c *gin.Context) {
	bt, err := h.svc.AdminReverse(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, bt)
}

// ProviderHealth handles GET /api/finance/admin/transfers/provider-health.
func (h *AdminHandler) ProviderHealth(c *gin.Context) {
	health, err := h.svc.AdminProviderHealth(c.Request.Context())
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"providers": health})
}
