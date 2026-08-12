package marketplace

import (
	"net"
	"net/http"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/middleware"
)

// HandlerConfig holds dependencies for handlers.
type HandlerConfig struct {
	Service *Service
}

// RegisterHandlers registers all marketplace endpoints.
func RegisterHandlers(router *gin.Engine, cfg HandlerConfig) {
	group := router.Group("/api/v1/marketplace")

	// Public endpoints (authenticated)
	group.GET("/listings", middleware.RequireAuth, cfg.ListListings)
	group.GET("/listings/:id", middleware.RequireAuth, cfg.GetListing)
	group.POST("/listings", middleware.RequireAuth, cfg.CreateListing)
	group.PUT("/listings/:id", middleware.RequireAuth, cfg.UpdateListing)
	group.DELETE("/listings/:id", middleware.RequireAuth, cfg.DeleteListing)
	group.GET("/listings/:id/audit", middleware.RequireAuth, cfg.GetAuditTrail)

	// Admin-only endpoints
	adminGroup := router.Group("/api/v1/admin/marketplace")
	adminGroup.Use(middleware.RequireAuth, middleware.RequireAdminRole)

	adminGroup.GET("/listings", cfg.AdminListListings)
	adminGroup.GET("/audit-logs", cfg.AdminGetAuditLogs)
	adminGroup.GET("/metrics", cfg.AdminGetMetrics)
	adminGroup.GET("/activity-feed", cfg.AdminGetActivityFeed)
}

// CreateListing handles POST /api/v1/marketplace/listings
func (cfg HandlerConfig) CreateListing(c *gin.Context) {
	var input CreateListingInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid input: " + err.Error()})
		return
	}

	// Get user ID from auth context
	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User ID not found in context"})
		return
	}

	// Get request context data
	requestID := c.GetString("request_id")
	ipAddress := c.ClientIP()
	userAgent := c.Request.UserAgent()

	// Create listing
	listing, err := cfg.Service.CreateListing(
		c.Request.Context(),
		userID.(string),
		input,
		requestID,
		ipAddress,
		userAgent,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, listing)
}

// GetListing handles GET /api/v1/marketplace/listings/:id
func (cfg HandlerConfig) GetListing(c *gin.Context) {
	listingID := c.Param("id")

	listing, err := cfg.Service.GetListing(c.Request.Context(), listingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, listing)
}

// UpdateListing handles PUT /api/v1/marketplace/listings/:id
func (cfg HandlerConfig) UpdateListing(c *gin.Context) {
	listingID := c.Param("id")

	var input UpdateListingInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid input: " + err.Error()})
		return
	}

	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User ID not found in context"})
		return
	}

	requestID := c.GetString("request_id")
	ipAddress := c.ClientIP()
	userAgent := c.Request.UserAgent()

	listing, err := cfg.Service.UpdateListing(
		c.Request.Context(),
		listingID,
		userID.(string),
		input,
		requestID,
		ipAddress,
		userAgent,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, listing)
}

// DeleteListing handles DELETE /api/v1/marketplace/listings/:id
func (cfg HandlerConfig) DeleteListing(c *gin.Context) {
	listingID := c.Param("id")

	userID, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User ID not found in context"})
		return
	}

	requestID := c.GetString("request_id")
	ipAddress := c.ClientIP()
	userAgent := c.Request.UserAgent()

	err := cfg.Service.DeleteListing(
		c.Request.Context(),
		listingID,
		userID.(string),
		requestID,
		ipAddress,
		userAgent,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

// GetAuditTrail handles GET /api/v1/marketplace/listings/:id/audit
func (cfg HandlerConfig) GetAuditTrail(c *gin.Context) {
	listingID := c.Param("id")

	limit := 100
	if limitStr := c.Query("limit"); limitStr != "" {
		var l int
		if _, err := (&l).Scan(limitStr); err == nil {
			limit = l
		}
	}

	logs, err := cfg.Service.GetAuditTrail(c.Request.Context(), listingID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, logs)
}

// ListListings handles GET /api/v1/marketplace/listings (paginated, filtered)
func (cfg HandlerConfig) ListListings(c *gin.Context) {
	// TODO: Implement pagination and filtering
	// For now, return empty list
	c.JSON(http.StatusOK, []Listing{})
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin Handlers
// ─────────────────────────────────────────────────────────────────────────────

// AdminListListings handles GET /api/v1/admin/marketplace/listings
func (cfg HandlerConfig) AdminListListings(c *gin.Context) {
	// TODO: Implement admin listing view
	c.JSON(http.StatusOK, []Listing{})
}

// AdminGetAuditLogs handles GET /api/v1/admin/marketplace/audit-logs
func (cfg HandlerConfig) AdminGetAuditLogs(c *gin.Context) {
	// TODO: Implement audit log retrieval
	c.JSON(http.StatusOK, []AuditLog{})
}

// AdminGetMetrics handles GET /api/v1/admin/marketplace/metrics
func (cfg HandlerConfig) AdminGetMetrics(c *gin.Context) {
	// Call stored procedure to get real-time metrics
	rows := cfg.Service.db.QueryRow(c.Request.Context(),
		"SELECT * FROM get_realtime_marketplace_metrics()")

	type Metrics struct {
		TotalActiveListings  int64   `json:"total_active_listings"`
		ListingsCreatedToday int64   `json:"listings_created_today"`
		TotalGMVKobo         int64   `json:"total_gmv_kobo"`
		UniqueSellerToday    int64   `json:"unique_sellers_today"`
		UniqueBuyersToday    int64   `json:"unique_buyers_today"`
		MessagesSentToday    int64   `json:"messages_sent_today"`
		OffersMadeToday      int64   `json:"offers_made_today"`
		RecentActivityCount  int64   `json:"recent_activity_count"`
	}

	metrics := &Metrics{}
	err := rows.Scan(
		&metrics.TotalActiveListings,
		&metrics.ListingsCreatedToday,
		&metrics.TotalGMVKobo,
		&metrics.UniqueSellerToday,
		&metrics.UniqueBuyersToday,
		&metrics.MessagesSentToday,
		&metrics.OffersMadeToday,
		&metrics.RecentActivityCount,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, metrics)
}

// AdminGetActivityFeed handles GET /api/v1/admin/marketplace/activity-feed
func (cfg HandlerConfig) AdminGetActivityFeed(c *gin.Context) {
	const query = `
		SELECT id, event_type, entity_type, entity_id, actor_id, display_text,
		       listing_title, listing_price_kobo, actor_name, severity, created_at
		FROM marketplace_admin_activity
		LIMIT 100
	`

	type ActivityEvent struct {
		ID                string  `json:"id"`
		EventType         string  `json:"event_type"`
		EntityType        string  `json:"entity_type"`
		EntityID          string  `json:"entity_id"`
		ActorID           string  `json:"actor_id"`
		DisplayText       string  `json:"display_text"`
		ListingTitle      *string `json:"listing_title"`
		ListingPriceKobo  *int64  `json:"listing_price_kobo"`
		ActorName         string  `json:"actor_name"`
		Severity          string  `json:"severity"`
		CreatedAt         string  `json:"created_at"`
	}

	rows, err := cfg.Service.db.Query(c.Request.Context(), query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var events []ActivityEvent
	for rows.Next() {
		event := ActivityEvent{}
		err := rows.Scan(
			&event.ID, &event.EventType, &event.EntityType, &event.EntityID,
			&event.ActorID, &event.DisplayText, &event.ListingTitle,
			&event.ListingPriceKobo, &event.ActorName, &event.Severity,
			&event.CreatedAt,
		)
		if err != nil {
			continue
		}
		events = append(events, event)
	}

	c.JSON(http.StatusOK, events)
}

// Helper to get IP address
func getClientIP(c *gin.Context) string {
	ip := c.ClientIP()
	if net.ParseIP(ip) != nil {
		return ip
	}
	return "0.0.0.0"
}
