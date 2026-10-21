package restaurant

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
)

// RequireServiceable is route middleware for POST /restaurant/:id/delivery-quote
// and POST /restaurant/:id/orders. It reads the destination from the body without
// consuming it (lat/lng, delivery_lat/delivery_lng, or delivery_location) and
// refuses with 400 not_serviceable when it is outside the restaurant's zone.
// Bodies with no coordinates, or malformed ones, pass through so the real handler
// owns validation; the check is permissive when no limit is configured.
// Kept as middleware because handler.go / service.go belong to another change set.
func (h *Handler) RequireServiceable() gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{keyError: "unreadable request body"})
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(raw))
		var b struct {
			Lat         *float64 `json:"lat"`
			Lng         *float64 `json:"lng"`
			DeliveryLat *float64 `json:"delivery_lat"`
			DeliveryLng *float64 `json:"delivery_lng"`
			Location    *LatLng  `json:"delivery_location"`
		}
		if json.Unmarshal(raw, &b) != nil {
			c.Next()
			return
		}
		var lat, lng *float64
		switch {
		case b.Lat != nil && b.Lng != nil:
			lat, lng = b.Lat, b.Lng
		case b.DeliveryLat != nil && b.DeliveryLng != nil:
			lat, lng = b.DeliveryLat, b.DeliveryLng
		case b.Location != nil:
			lat, lng = &b.Location.Lat, &b.Location.Lng
		}
		if lat == nil {
			c.Next()
			return
		}
		ok, dist, err := h.svc.CheckServiceable(c.Request.Context(), c.Param("id"), *lat, *lng)
		if ok {
			c.Next()
			return
		}
		var se *ServiceabilityError
		if errors.As(err, &se) {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
				keyError:          "not_serviceable",
				"code":            "not_serviceable",
				"max_km_bps":      se.MaxKmBps,
				"max_distance_km": float64(se.MaxKmBps) / kmBps,
				"distance_km_bps": dist,
			})
			return
		}
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{keyError: "serviceability check failed"})
	}
}
