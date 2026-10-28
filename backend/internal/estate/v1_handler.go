package estate

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// V1Handler provides v1 API endpoints for estate properties.
// These are aggregated, user-scoped endpoints (no estate_id parameter).
type V1Handler struct {
	db *pgxpool.Pool
}

// NewV1Handler creates a new v1 handler.
func NewV1Handler(db *pgxpool.Pool) *V1Handler {
	return &V1Handler{db: db}
}

// V1Property is the response format for v1 properties endpoint.
type V1Property struct {
	ID              string  `json:"id"`
	EstateID        string  `json:"estate_id"`
	UnitLabel       string  `json:"unit_label"`
	PropertyType    string  `json:"property_type"`
	Floor           *string `json:"floor,omitempty"`
	Block           *string `json:"block,omitempty"`
	OccupancyStatus string  `json:"occupancy_status"`
	LandlordID      *string `json:"landlord_id,omitempty"`
	LandlordName    *string `json:"landlord_name,omitempty"`
	TenantID        *string `json:"tenant_id,omitempty"`
	TenantName      *string `json:"tenant_name,omitempty"`
}

// V1PropertySummary aggregates property statistics.
type V1PropertySummary struct {
	Total        int `json:"total"`
	Occupied     int `json:"occupied"`
	Vacant       int `json:"vacant"`
	Reserved     int `json:"reserved"`
	OccupancyRate int `json:"occupancy_rate"`
}

// V1PropertiesResponse is the response for GET /api/v1/estate/properties.
type V1PropertiesResponse struct {
	Summary    V1PropertySummary `json:"summary"`
	Properties []V1Property      `json:"properties"`
}

// ListProperties lists all properties across estates the user has access to.
// GET /api/v1/estate/properties
func (h *V1Handler) ListProperties(c *gin.Context) {
	userID := ginutil.UserID(c)
	ctx := c.Request.Context()

	resp, err := h.listPropertiesForUser(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}

	c.JSON(http.StatusOK, resp)
}

// listPropertiesForUser fetches all properties across all estates the user has access to.
func (h *V1Handler) listPropertiesForUser(ctx context.Context, userID string) (*V1PropertiesResponse, error) {
	// Get all estates the user has access to (as resident, landlord, tenant, or estate admin).
	// Then aggregate properties from all those estates with landlord/tenant names.
	const q = `
		WITH user_estates AS (
			-- Estates where user is a resident or estate_admin
			SELECT DISTINCT estate_id FROM estate_residents WHERE user_id = $1
			UNION
			-- Estates where user is landlord of a property
			SELECT DISTINCT estate_id FROM estate_properties WHERE landlord_id = $1
			UNION
			-- Estates where user is tenant of a property
			SELECT DISTINCT estate_id FROM estate_properties WHERE tenant_id = $1
		)
		SELECT
			p.id, p.estate_id, p.unit_label, p.property_type,
			NULLIF(p.floor, ''), NULLIF(p.block, ''),
			p.occupancy_status, p.landlord_id, p.tenant_id,
			lu.display_name, tu.display_name
		FROM estate_properties p
		LEFT JOIN auth.users lu ON p.landlord_id = lu.id
		LEFT JOIN auth.users tu ON p.tenant_id = tu.id
		WHERE p.estate_id IN (SELECT estate_id FROM user_estates)
		  AND p.archived = FALSE
		ORDER BY p.estate_id, p.block, p.floor, p.unit_label
	`

	rows, err := h.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var props []V1Property
	var occupied, vacant, reserved int

	for rows.Next() {
		var p V1Property
		var landlordName, tenantName *string

		if err := rows.Scan(
			&p.ID, &p.EstateID, &p.UnitLabel, &p.PropertyType,
			&p.Floor, &p.Block, &p.OccupancyStatus,
			&p.LandlordID, &p.TenantID, &landlordName, &tenantName,
		); err != nil {
			return nil, err
		}

		p.LandlordName = landlordName
		p.TenantName = tenantName
		props = append(props, p)

		// Calculate summary stats
		switch p.OccupancyStatus {
		case "occupied":
			occupied++
		case "vacant":
			vacant++
		case "reserved":
			reserved++
		}
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	total := len(props)
	occupancyRate := 0
	if total > 0 {
		occupancyRate = (occupied * 100) / total
	}

	return &V1PropertiesResponse{
		Summary: V1PropertySummary{
			Total:         total,
			Occupied:      occupied,
			Vacant:        vacant,
			Reserved:      reserved,
			OccupancyRate: occupancyRate,
		},
		Properties: props,
	}, nil
}

// GetProperty retrieves a single property by ID.
// GET /api/v1/estate/properties/:id
func (h *V1Handler) GetProperty(c *gin.Context) {
	userID := ginutil.UserID(c)
	propertyID := c.Param("id")
	ctx := c.Request.Context()

	prop, err := h.getPropertyForUser(ctx, userID, propertyID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "property not found or not accessible"})
		return
	}

	c.JSON(http.StatusOK, prop)
}

// getPropertyForUser fetches a single property if the user has access to it.
func (h *V1Handler) getPropertyForUser(ctx context.Context, userID, propertyID string) (*V1Property, error) {
	const q = `
		WITH user_estates AS (
			SELECT DISTINCT estate_id FROM estate_residents WHERE user_id = $1
			UNION
			SELECT DISTINCT estate_id FROM estate_properties WHERE landlord_id = $1
			UNION
			SELECT DISTINCT estate_id FROM estate_properties WHERE tenant_id = $1
		)
		SELECT
			p.id, p.estate_id, p.unit_label, p.property_type,
			NULLIF(p.floor, ''), NULLIF(p.block, ''),
			p.occupancy_status, p.landlord_id, p.tenant_id,
			lu.display_name, tu.display_name
		FROM estate_properties p
		LEFT JOIN auth.users lu ON p.landlord_id = lu.id
		LEFT JOIN auth.users tu ON p.tenant_id = tu.id
		WHERE p.id = $2
		  AND p.estate_id IN (SELECT estate_id FROM user_estates)
		  AND p.archived = FALSE
	`

	var prop V1Property
	var landlordName, tenantName *string

	err := h.db.QueryRow(ctx, q, userID, propertyID).Scan(
		&prop.ID, &prop.EstateID, &prop.UnitLabel, &prop.PropertyType,
		&prop.Floor, &prop.Block, &prop.OccupancyStatus,
		&prop.LandlordID, &prop.TenantID, &landlordName, &tenantName,
	)
	if err != nil {
		return nil, err
	}

	prop.LandlordName = landlordName
	prop.TenantName = tenantName

	return &prop, nil
}
