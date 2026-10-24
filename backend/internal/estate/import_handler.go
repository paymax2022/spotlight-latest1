package estate

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// PermissionChecker reports whether a user holds a platform RBAC permission.
// Wired from services.RBACService.CheckPermission in finance_routes.go.
type PermissionChecker func(userID, permission string) bool

// PermImportPlatform is the RBAC slug for platform import operators
// (20271068001010_estate_import_batches.sql).
const PermImportPlatform = "estate.admin.import"

// WithPermissionChecker wires the platform RBAC check used by the import
// routes (which also accept the estate's own estate_admin).
func (h *Handler) WithPermissionChecker(fn PermissionChecker) *Handler {
	h.can = fn
	return h
}

var importErrMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusBadRequest, ErrImportEmpty, ErrImportTooLarge, ErrIdempotencyRequired),
	httperr.R(http.StatusNotFound, ErrEstateNotFound, ErrImportBatchNotFound),
	httperr.R(http.StatusConflict, ErrImportAlreadyCommitted),
	httperr.R(http.StatusUnprocessableEntity, ErrImportControlTotal),
	httperr.R(http.StatusLocked, ErrImportEstateNotImportable),
)

// authorizeImport: platform operators with estate.admin.import, or an
// estate_admin member of the target estate. Writes 400/403 and returns false
// when the caller may not import into this estate.
func (h *Handler) authorizeImport(c *gin.Context) (string, string, bool) {
	estateID, userID := c.Param("estateId"), ginutil.UserID(c)
	if _, err := uuid.Parse(estateID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid estate id"})
		return "", "", false
	}
	if h.can != nil && h.can(userID, PermImportPlatform) {
		return estateID, userID, true
	}
	if err := h.svc.assertEstateAdmin(c.Request.Context(), estateID, userID); err == nil {
		return estateID, userID, true
	}
	c.JSON(http.StatusForbidden, gin.H{keyError: "forbidden"})
	return "", "", false
}

// DryRunImport — POST /estate-admin/estates/:estateId/imports.
func (h *Handler) DryRunImport(c *gin.Context) {
	estateID, userID, ok := h.authorizeImport(c)
	if !ok {
		return
	}
	var req ImportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	b, err := h.svc.DryRunImport(c.Request.Context(), estateID, userID, req)
	if err != nil {
		importErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusCreated, b)
}

// GetImportBatch — GET /estate-admin/estates/:estateId/imports/:batchId.
func (h *Handler) GetImportBatch(c *gin.Context) {
	estateID, _, ok := h.authorizeImport(c)
	if !ok {
		return
	}
	if _, err := uuid.Parse(c.Param("batchId")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid batch id"})
		return
	}
	b, err := h.svc.GetImportBatch(c.Request.Context(), estateID, c.Param("batchId"))
	if err != nil {
		importErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, b)
}

// CommitImport — POST /estate-admin/estates/:estateId/imports/:batchId/commit
// (Idempotency-Key required).
func (h *Handler) CommitImport(c *gin.Context) {
	estateID, userID, ok := h.authorizeImport(c)
	if !ok {
		return
	}
	if _, err := uuid.Parse(c.Param("batchId")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid batch id"})
		return
	}
	b, err := h.svc.CommitImport(c.Request.Context(), estateID, c.Param("batchId"), userID, ginutil.IdempotencyKey(c))
	if err != nil {
		importErrMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, b)
}
