package admin

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler exposes the stays-admin control plane: supplier connectivity config, the
// dedup mapping queue, and property moderation. Every route is RBAC-gated at the
// router (stays.admin.*); this handler performs the parameterized data ops.
type Handler struct {
	db *pgxpool.Pool
}

// NewHandler constructs the admin handler.
func NewHandler(db *pgxpool.Pool) *Handler { return &Handler{db: db} }

// --- supplier connectivity config (stays.admin.supplier) ---

// ListSuppliers (admin): GET /suppliers
func (h *Handler) ListSuppliers(c *gin.Context) {
	rows, err := h.db.Query(c.Request.Context(), `
		SELECT id, source_rail, supplier_code, adapter, active, created_at
		FROM public.stays_supplier_config ORDER BY source_rail, supplier_code`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	var out []gin.H
	for rows.Next() {
		var id, rail, code, adapter string
		var active bool
		var createdAt any
		if err := rows.Scan(&id, &rail, &code, &adapter, &active, &createdAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		out = append(out, gin.H{"id": id, "source_rail": rail, "supplier_code": code, "adapter": adapter, "active": active, "created_at": createdAt})
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// UpsertSupplier (admin): POST /suppliers {source_rail, supplier_code, adapter, active}
func (h *Handler) UpsertSupplier(c *gin.Context) {
	var body struct {
		SourceRail   string `json:"source_rail" binding:"required"`
		SupplierCode string `json:"supplier_code" binding:"required"`
		Adapter      string `json:"adapter" binding:"required"`
		Active       bool   `json:"active"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	_, err := h.db.Exec(c.Request.Context(), `
		INSERT INTO public.stays_supplier_config (source_rail, supplier_code, adapter, active)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (source_rail, supplier_code)
		DO UPDATE SET adapter = EXCLUDED.adapter, active = EXCLUDED.active, updated_at = now()`,
		body.SourceRail, body.SupplierCode, body.Adapter, body.Active)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

// --- dedup mapping queue (stays.admin.mapping) ---

// ListMappingQueue (admin): GET /mapping-queue?status=
func (h *Handler) ListMappingQueue(c *gin.Context) {
	status := c.DefaultQuery("status", "PENDING_REVIEW")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := h.db.Query(c.Request.Context(), `
		SELECT id, source_rail, supplier_code, supplier_property_ref,
		       candidate_rail, candidate_supplier_code, candidate_supplier_property_ref,
		       confidence, status, mapped_property_id
		FROM public.stays_mapping_record
		WHERE ($1 = '' OR status = $1)
		ORDER BY confidence DESC LIMIT $2`, status, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	var out []gin.H
	for rows.Next() {
		var id, rail, code, ref, cRail, cCode, cRef, st string
		var conf float64
		var mapped *string
		if err := rows.Scan(&id, &rail, &code, &ref, &cRail, &cCode, &cRef, &conf, &st, &mapped); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		out = append(out, gin.H{
			"id": id, "source_rail": rail, "supplier_code": code, "supplier_property_ref": ref,
			"candidate_rail": cRail, "candidate_supplier_code": cCode, "candidate_supplier_property_ref": cRef,
			"confidence": conf, "status": st, "mapped_property_id": mapped,
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// DecideMapping (admin): POST /mapping-queue/:id/decision {status, mapped_property_id}
func (h *Handler) DecideMapping(c *gin.Context) {
	var body struct {
		Status           string `json:"status" binding:"required"` // MAPPED | REJECTED
		MappedPropertyID string `json:"mapped_property_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	_, err := h.db.Exec(c.Request.Context(), `
		UPDATE public.stays_mapping_record
		SET status = $2, mapped_property_id = NULLIF($3,''), updated_at = now()
		WHERE id = $1`, c.Param("id"), body.Status, body.MappedPropertyID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

// --- property moderation (stays.admin.moderation) ---

// ModerateProperty (admin): POST /properties/:id/status {status}
func (h *Handler) ModerateProperty(c *gin.Context) {
	var body struct {
		Status string `json:"status" binding:"required"` // ACTIVE | SUSPENDED | PENDING_REVIEW | DRAFT
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ct, err := h.db.Exec(c.Request.Context(), `
		UPDATE public.stays_property SET status = $2, updated_at = now() WHERE id = $1`,
		c.Param("id"), body.Status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if ct.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "property not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}
