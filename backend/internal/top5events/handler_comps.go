package top5events

// Organiser comp / attendee-export / announcement handlers. Routes are attached
// via RegisterComps so the wiring layer can gate them behind
// FEATURE_EVENTS_COMPS (flag off => comps/announcements 404 and the attendees
// ?format=csv branch 404s; plain attendees JSON is unaffected).

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/httperr"
)

// RegisterComps attaches the comp + announcement routes and activates the
// ?format=csv branch of the (unconditionally registered) attendees route.
func (h *Handler) RegisterComps(member *gin.RouterGroup) {
	h.compsEnabled = true
	member.POST("/:id/comps", h.IssueComps)
	member.POST("/:id/announcements", h.Announce)
}

// compsStatus maps comp/export/announce sentinels to HTTP statuses.
func compsStatus(err error) int {
	switch {
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrForbidden):
		return http.StatusForbidden
	case errors.Is(err, ErrSoldOut), errors.Is(err, ErrNotPurchasable):
		return http.StatusConflict
	case errors.Is(err, ErrValidation):
		return http.StatusBadRequest
	}
	return http.StatusInternalServerError
}

func compsFail(c *gin.Context, err error) {
	status := compsStatus(err)
	if status == http.StatusInternalServerError {
		log.Printf("[top5events] comps %s %s: %v", c.Request.Method, c.Request.URL.Path, err)
	}
	c.JSON(status, gin.H{"error": httperr.Msg(c, status, err)})
}

type compRequest struct {
	TierID     string   `json:"tier_id"`
	Recipients []string `json:"recipients"`
	Note       string   `json:"note"`
}

// IssueComps issues zero-value guest tickets to the given recipient handles.
func (h *Handler) IssueComps(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	key := idemKey(c)
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	var req compRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	if strings.TrimSpace(req.TierID) == "" || len(req.Recipients) == 0 {
		compsFail(c, fmt.Errorf("%w: tier_id and at least one recipient required", ErrValidation))
		return
	}
	out, err := h.svc.IssueComp(c.Request.Context(), u, c.Param("id"), req.TierID, req.Recipients, req.Note, key)
	if err != nil {
		compsFail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": out})
}

type announceRequest struct {
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

// Announce sends an organiser announcement to every distinct ticket holder.
func (h *Handler) Announce(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	key := idemKey(c)
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	var req announceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	n, err := h.svc.Announce(c.Request.Context(), u, c.Param("id"), req.Subject, req.Body, key)
	if err != nil {
		compsFail(c, err)
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"success": true, "data": gin.H{"recipient_count": n}})
}

// attendeesCSV serves the CSV export branch of GET /:id/attendees.
func (h *Handler) attendeesCSV(c *gin.Context, userID string) {
	if !h.compsEnabled {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	id := c.Param("id")
	b, err := h.svc.AttendeesCSV(c.Request.Context(), userID, id)
	if err != nil {
		compsFail(c, err)
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="attendees-%s.csv"`, id))
	c.Data(http.StatusOK, "text/csv; charset=utf-8", b)
}
