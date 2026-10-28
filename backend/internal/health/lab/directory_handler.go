package healthlab

import (
	"errors"
	"net/http"
	"strconv"

	"spotlight/backend/go-common/ginutil"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// optFloat reads an optional float query param within [min,max]; ok=false means a
// malformed value (the response is already written).
func optFloat(c *gin.Context, name string, min, max float64) (*float64, bool) {
	raw := c.Query(name)
	if raw == "" {
		return nil, true
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || v < min || v > max {
		ginutil.FailOK(c, http.StatusBadRequest, name+" is out of range")
		return nil, false
	}
	return &v, true
}

// ListLabs — GET /labs?home_collection=true&lat=&lng=  (discoverable MLSCN labs, HL-2)
func (h *Handler) ListLabs(c *gin.Context) {
	lat, ok := optFloat(c, "lat", -90, 90)
	if !ok {
		return
	}
	lng, ok := optFloat(c, "lng", -180, 180)
	if !ok {
		return
	}
	if (lat == nil) != (lng == nil) {
		ginutil.FailOK(c, http.StatusBadRequest, "lat and lng must be supplied together")
		return
	}
	labs, err := h.svc.ListLabs(c.Request.Context(), c.Query("home_collection") == "true", lng, lat)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "labs": labs})
}

// GetLab — GET /labs/:id
func (h *Handler) GetLab(c *gin.Context) {
	id, ok := uuidPathID(c, "lab id")
	if !ok {
		return
	}
	lab, err := h.svc.GetLab(c.Request.Context(), id)
	if errors.Is(err, ErrLabNotFound) {
		failErr(c, http.StatusNotFound, err)
		return
	}
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "lab": lab})
}

// GetTest — GET /tests/:id
func (h *Handler) GetTest(c *gin.Context) {
	id, ok := uuidPathID(c, "test id")
	if !ok {
		return
	}
	t, err := h.svc.GetTest(c.Request.Context(), id)
	if errors.Is(err, ErrTestNotFound) {
		failErr(c, http.StatusNotFound, err)
		return
	}
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "test": t})
}

// GetPackage — GET /packages/:id
func (h *Handler) GetPackage(c *gin.Context) {
	id, ok := uuidPathID(c, "package id")
	if !ok {
		return
	}
	p, err := h.svc.GetPackage(c.Request.Context(), id)
	if errors.Is(err, ErrPackageNotFound) {
		failErr(c, http.StatusNotFound, err)
		return
	}
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "package": p})
}

// ListLabReviews — GET /labs/:id/reviews
func (h *Handler) ListLabReviews(c *gin.Context) {
	id, ok := uuidPathID(c, "lab id")
	if !ok {
		return
	}
	reviews, err := h.svc.ListReviews(c.Request.Context(), id)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "reviews": reviews})
}

// SubmitReview — POST /reviews  {order_id, rating, body}
func (h *Handler) SubmitReview(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var in struct {
		OrderID string `json:"order_id"`
		Rating  int    `json:"rating"`
		Body    string `json:"body"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	if _, err := uuid.Parse(in.OrderID); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "order_id must be a uuid")
		return
	}
	rv, err := h.svc.SubmitReview(c.Request.Context(), uid, in.OrderID, in.Rating, in.Body)
	switch {
	case err == nil:
		c.JSON(http.StatusCreated, gin.H{"success": true, "review": rv})
	case errors.Is(err, ErrOrderNotFound):
		failErr(c, http.StatusNotFound, err)
	case errors.Is(err, ErrInvalidRating), errors.Is(err, ErrReviewBodyTooLong):
		failErr(c, http.StatusBadRequest, err)
	case errors.Is(err, ErrReviewNotEligible), errors.Is(err, ErrAlreadyReviewed):
		failErr(c, http.StatusConflict, err)
	default:
		failErr(c, http.StatusInternalServerError, err)
	}
}
